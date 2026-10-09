// Turning `ast --json` / `ast --flatten` output into the tree the AST panel
// shows (see ast-view.ts). Kept free of `vscode` imports so it can be unit
// tested with node:test.
//
// The JSON is nushell's internal AST, not a stable interface, so nothing here
// depends on particular node types. It recognizes a few shapes:
// - an expression `{expr: {Variant: …}, span, ty}` -> a node named `Variant`
// - an enum variant `{Variant: …}` (one capitalized key) -> a node `Variant`
// - a span `{start, end, span_source}` -> a token
// - a list -> its items, as `key[i]` children of the list's owner
// - any other object -> a node named after its key (`pipelines[0]` -> Pipeline)
// - anything else -> a value
//
// The tree only names nested blocks and closures by id. The flattened tokens
// cover everything, so each is added to the deepest node around it: that is
// how the contents of a closure show up.

import { AstToken, ParsedAst } from './ast-parse';
import { AstNode, AstView } from './ast-view';

/** Keys that are internal bookkeeping, not syntax. */
const SKIPPED = new Set(['span_id', 'ir_block', 'parser_info']);

/** Longest `text` kept for a node; the source is shown in the editor. */
const NODE_TEXT_LENGTH = 80;

type Json = Record<string, unknown>;

interface Context {
  base: number;
  source: Buffer;
  /** Tokens by `start:end`, removed once a span in the tree claims one. */
  tokens: Map<string, AstToken[]>;
}

export function buildAst(parsed: ParsedAst, source: string): AstView {
  const context: Context = {
    base: parsed.base,
    source: Buffer.from(source, 'utf8'),
    tokens: new Map(),
  };
  for (const token of parsed.tokens) {
    const key = `${token.span.start}:${token.span.end}`;
    context.tokens.set(key, [...(context.tokens.get(key) ?? []), token]);
  }

  const block = isObject(parsed.block) ? { ...parsed.block } : {};
  delete block.signature; // a script's own signature is always empty
  const root = objectNode('Block', undefined, block, context);
  root.start = 0;
  root.end = context.source.length;
  root.text = undefined;

  for (const token of [...context.tokens.values()].flat()) {
    insertToken(root, tokenNode(token, context));
  }
  sortBySource(root);

  const error = isEmpty(parsed.error)
    ? undefined
    : build('error', parsed.error, context)[0];
  return { root, error };
}

/** The node(s) for `value` as the `key` field of its parent. */
function build(key: string, value: unknown, context: Context): AstNode[] {
  if (isEmpty(value) || SKIPPED.has(key)) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      build(`${key}[${index}]`, item, context),
    );
  }

  if (!isObject(value)) {
    return [
      { kind: key, category: 'value', text: String(value), children: [] },
    ];
  }

  if (isSpan(value)) {
    const span = relativeSpan(value, context);
    if (!span) {
      return []; // another file's span, e.g. in a `use`d module
    }

    const token = context.tokens.get(`${span.start}:${span.end}`)?.shift();
    return [
      {
        kind: token ? shapeName(token.shape) : 'Span',
        category: 'token',
        property: key,
        ...span,
        text: textOf(span, context),
        children: [],
      },
    ];
  }

  if (isExpression(value)) {
    return [expressionNode(key, value, context)];
  }

  const variant = variantOf(value);
  if (variant) {
    const [name, inner] = variant;
    const node = payloadNode(name, key, inner, context);
    return [withSpan(node, context)];
  }

  return [withSpan(objectNode(kindName(key), key, value, context), context)];
}

function expressionNode(
  key: string,
  value: Expression,
  context: Context,
): AstNode {
  const [name, inner] = variantOf(value.expr) ?? [
    String(value.expr),
    undefined,
  ];
  const node = payloadNode(name, key, inner, context);
  node.type = typeName(value.ty);
  const span = relativeSpan(value.span, context);
  if (span) {
    Object.assign(node, span);
    node.text = snippet(textOf(span, context));
  }

  return node;
}

/** A node named `kind` for a variant's payload: fields, items, or a value. */
function payloadNode(
  kind: string,
  property: string | undefined,
  inner: unknown,
  context: Context,
): AstNode {
  if (isObject(inner) && !isSpan(inner) && !isExpression(inner)) {
    return objectNode(kind, property, inner, context);
  }

  const node: AstNode = { kind, category: 'node', property, children: [] };
  if (Array.isArray(inner)) {
    node.children = inner.flatMap((item, index) =>
      build(`[${index}]`, item, context),
    );
  } else if (isObject(inner)) {
    node.children = build(
      isExpression(inner) ? 'expr' : 'span',
      inner,
      context,
    );
  } else if (inner !== undefined && inner !== null) {
    node.children = [
      { kind: 'value', category: 'value', text: String(inner), children: [] },
    ];
  }

  return node;
}

function objectNode(
  kind: string,
  property: string | undefined,
  value: Json,
  context: Context,
): AstNode {
  // An object's own span describes it, not a child
  const span = isSpan(value.span)
    ? relativeSpan(value.span, context)
    : undefined;
  const children = Object.entries(value)
    .filter(([key]) => !(key === 'span' && span))
    .flatMap(([key, item]) => build(key, item, context));

  const node: AstNode = { kind, category: 'node', property, children };
  if (span) {
    Object.assign(node, span);
    node.text = snippet(textOf(span, context));
  }

  return node;
}

/** A spanless node covers its children, so following the cursor can find it. */
function withSpan(node: AstNode, context: Context): AstNode {
  if (node.start !== undefined) {
    return node;
  }

  const spans = node.children.filter((child) => child.start !== undefined);
  if (spans.length === 0) {
    return node;
  }

  const start = Math.min(...spans.map((child) => child.start!));
  const end = Math.max(...spans.map((child) => child.end!));
  return {
    ...node,
    start,
    end,
    text: snippet(textOf({ start, end }, context)),
  };
}

function tokenNode(token: AstToken, context: Context): AstNode {
  const span = { start: token.span.start, end: token.span.end };
  return {
    kind: shapeName(token.shape),
    category: 'token',
    ...span,
    text: token.content || textOf(span, context),
    children: [],
  };
}

/** Add a token to the deepest node around it. */
function insertToken(root: AstNode, token: AstNode): void {
  let parent = root;
  for (;;) {
    const inner = parent.children.find(
      (child) =>
        child.category === 'node' &&
        child.start !== undefined &&
        child.start <= token.start! &&
        token.end! <= child.end!,
    );
    if (!inner) {
      break;
    }

    parent = inner;
  }

  parent.children.push(token);
}

/**
 * Children in source order (fields come in struct order: an element's `pipe`
 * before its command). Values have no span and keep their place up front.
 */
function sortBySource(node: AstNode): void {
  node.children.sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
  node.children.forEach(sortBySource);
}

function relativeSpan(
  span: Json,
  context: Context,
): { start: number; end: number } | undefined {
  const start = (span.start as number) - context.base;
  const end = (span.end as number) - context.base;
  if (start < 0 || end > context.source.length || start > end) {
    return undefined;
  }

  return { start, end };
}

function textOf(
  span: { start: number; end: number },
  context: Context,
): string {
  return context.source.subarray(span.start, span.end).toString('utf8');
}

/** The first line of `text`, shortened to fit a table cell. */
export function snippet(text: string): string {
  const lines = text.trim().split('\n');
  const first = lines[0].trimEnd();
  if (first.length > NODE_TEXT_LENGTH) {
    return `${first.slice(0, NODE_TEXT_LENGTH - 1)}…`;
  }

  return lines.length > 1 ? `${first} …` : first;
}

/** `pipelines[0]` -> `Pipeline`, `required_positional[1]` -> `RequiredPositional`. */
export function kindName(key: string): string {
  const list = key.endsWith(']');
  let name = key.replace(/\[\d+\]$/, '');
  if (list && name.endsWith('s')) {
    name = name.slice(0, -1);
  }

  return name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function shapeName(shape: string): string {
  return shape.replace(/^shape_/, '');
}

/** The name of a nu `Type`, which serializes as a string (`Int`) or a variant (`{Table: …}`). */
function typeName(ty: unknown): string | undefined {
  if (typeof ty === 'string') {
    return ty;
  }

  return variantOf(ty)?.[0];
}

function variantOf(value: unknown): [string, unknown] | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const keys = Object.keys(value);
  if (keys.length !== 1 || !/^[A-Z]/.test(keys[0])) {
    return undefined;
  }

  return [keys[0], value[keys[0]]];
}

type Expression = Json & { expr: unknown; span: Json; ty: unknown };

function isExpression(value: Json): value is Expression {
  return 'expr' in value && 'ty' in value && isSpan(value.span);
}

function isSpan(value: unknown): value is Json {
  return (
    isObject(value) &&
    typeof value.start === 'number' &&
    typeof value.end === 'number' &&
    Object.keys(value).every((key) =>
      ['start', 'end', 'span_source'].includes(key),
    )
  );
}

/** Nulls, empty strings and empty containers are left out of the tree. */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return isObject(value) && Object.keys(value).length === 0;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
