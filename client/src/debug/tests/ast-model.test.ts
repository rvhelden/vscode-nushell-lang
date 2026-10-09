import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { buildAst, kindName, snippet } from '../ast/ast-model';
import { ParsedAst } from '../ast/ast-parse';
import { AstNode } from '../ast/ast-view';

// `let x = 1`, shaped like `ast --json` output with its spans based at 100
const source = 'let x = 1';
const parsed: ParsedAst = {
  base: 100,
  block: {
    signature: { name: 'ignored-signature' },
    pipelines: [
      {
        elements: [
          {
            pipe: null,
            expr: {
              expr: {
                Call: {
                  decl_id: 37,
                  head: { start: 100, end: 103, span_source: 'let' },
                  arguments: [
                    {
                      Positional: {
                        expr: { VarDecl: 81 },
                        span: { start: 104, end: 105, span_source: 'x' },
                        span_id: 6,
                        ty: 'Any',
                      },
                    },
                    {
                      Positional: {
                        expr: { Int: 1 },
                        span: { start: 108, end: 109, span_source: '1' },
                        span_id: 7,
                        ty: 'Int',
                      },
                    },
                  ],
                  parser_info: {},
                },
              },
              span: { start: 100, end: 109, span_source: 'let x = 1' },
              span_id: 8,
              ty: 'Any',
            },
            redirection: null,
          },
        ],
      },
    ],
    captures: [],
    span: { start: 100, end: 109, span_source: 'let x = 1' },
  },
  error: null,
  tokens: [
    { content: 'let', shape: 'shape_internalcall', span: { start: 0, end: 3 } },
    { content: 'x', shape: 'shape_vardecl', span: { start: 4, end: 5 } },
    { content: '1', shape: 'shape_int', span: { start: 8, end: 9 } },
  ],
};

/** `kind(property)` for each node, indented by depth: easy to read in a diff. */
function outline(node: AstNode, depth = 0): string[] {
  const property = node.property ? `(${node.property})` : '';
  const span = node.start === undefined ? '' : ` ${node.start}..${node.end}`;
  const text = node.text ? ` ${JSON.stringify(node.text)}` : '';
  return [
    `${'  '.repeat(depth)}${node.category} ${node.kind}${property}${span}${text}`,
    ...node.children.flatMap((child) => outline(child, depth + 1)),
  ];
}

test('buildAst nests expressions, variants, tokens and values', () => {
  assert.deepEqual(outline(buildAst(parsed, source).root), [
    'node Block 0..9',
    '  node Pipeline(pipelines[0]) 0..9 "let x = 1"',
    '    node Element(elements[0]) 0..9 "let x = 1"',
    '      node Call(expr) 0..9 "let x = 1"',
    '        value decl_id "37"',
    '        token internalcall(head) 0..3 "let"',
    '        node Positional(arguments[0]) 4..5 "x"',
    '          node VarDecl(expr) 4..5 "x"',
    '            value value "81"',
    '            token vardecl 4..5 "x"',
    '        node Positional(arguments[1]) 8..9 "1"',
    '          node Int(expr) 8..9 "1"',
    '            value value "1"',
    '            token int 8..9 "1"',
  ]);
});

test('buildAst keeps the type the parser inferred', () => {
  const call = buildAst(parsed, source).root.children[0].children[0]
    .children[0];
  assert.equal(call.kind, 'Call');
  assert.equal(call.type, 'Any');
});

test('buildAst drops spans outside the source', () => {
  const view = buildAst({ ...parsed, base: 105 }, source);
  const lines = outline(view.root);
  assert.ok(!lines.some((line) => line.includes('internalcall(head)')));
});

test('buildAst places a token the tree has no span for in the deepest node around it', () => {
  // `{ $a }` is only `Closure: 299` in the tree; its tokens fill it in
  const closure: ParsedAst = {
    base: 0,
    block: {
      pipelines: [
        {
          elements: [
            {
              expr: {
                expr: { Closure: 299 },
                span: { start: 0, end: 6, span_source: '{ $a }' },
                ty: 'Closure',
              },
            },
          ],
        },
      ],
      span: { start: 0, end: 6, span_source: '{ $a }' },
    },
    error: null,
    tokens: [
      { content: '{ ', shape: 'shape_closure', span: { start: 0, end: 2 } },
      { content: '$a', shape: 'shape_variable', span: { start: 2, end: 4 } },
      { content: ' }', shape: 'shape_closure', span: { start: 4, end: 6 } },
    ],
  };

  const expression = buildAst(closure, '{ $a }').root.children[0].children[0]
    .children[0];
  assert.equal(expression.kind, 'Closure');
  assert.deepEqual(
    expression.children.map((child) => `${child.category} ${child.text}`),
    ['value 299', 'token { ', 'token $a', 'token  }'],
  );
});

test('buildAst reads a parse error with its spans made relative', () => {
  const view = buildAst(
    {
      ...parsed,
      error: {
        Unclosed: [')', { start: 104, end: 105 }, 'Add a matching `)`'],
      },
    },
    source,
  );
  assert.deepEqual(outline(view.error!), [
    'node Unclosed(error) 4..5 "x"',
    '  value [0] ")"',
    '  token vardecl([1]) 4..5 "x"',
    '  value [2] "Add a matching `)`"',
  ]);
});

test('buildAst maps every span of a real AST into the source', () => {
  // The same fixture as script-signatures.test.ts, from nu 0.116
  const fixtures = path.join(__dirname, '../../../src/debug/tests/fixtures');
  const block = JSON.parse(
    readFileSync(path.join(fixtures, 'ast-defs.json'), 'utf8'),
  ) as { span: { start: number } };
  const text = readFileSync(path.join(fixtures, 'ast-defs.nu'), 'utf8');
  const view = buildAst(
    { block, error: null, tokens: [], base: block.span.start },
    text,
  );

  const bytes = Buffer.from(text);
  const check = (node: AstNode): void => {
    if (node.category === 'token') {
      assert.equal(bytes.subarray(node.start, node.end).toString(), node.text);
    }
    node.children.forEach(check);
  };
  check(view.root);

  assert.ok(
    outline(view.root).some((line) =>
      line.includes('"def main [--verbose name: string, ...rest] {}"'),
    ),
  );
});

test('kindName names a list item after its list', () => {
  assert.equal(kindName('pipelines[0]'), 'Pipeline');
  assert.equal(kindName('required_positional[2]'), 'RequiredPositional');
  assert.equal(kindName('signature'), 'Signature');
});

test('snippet keeps the first line and marks what it cut', () => {
  assert.equal(snippet('ls'), 'ls');
  assert.equal(snippet('def f [] {\n  ls\n}'), 'def f [] { …');
  assert.equal(snippet('x'.repeat(100)), `${'x'.repeat(79)}…`);
});
