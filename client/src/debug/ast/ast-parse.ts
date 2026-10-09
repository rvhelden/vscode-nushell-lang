// Parsing a document into nushell's AST, without running it.
//
// One `nu` call runs `ast` twice on the source: `--json` for the syntax tree
// and `--flatten` for the token list. The tree only names nested blocks and
// closures by id, so the tokens are the only view of what is inside them.

import { runNu } from '../shared/run-nu';

/** A syntax-highlighting token, as `ast --flatten` reports it. */
export interface AstToken {
  content: string;
  shape: string;
  /** Byte offsets into the source. */
  span: { start: number; end: number };
}

export interface ParsedAst {
  /** The top-level block, as `ast --json` serializes it. */
  block: unknown;
  /** The first parse error, if any. */
  error: unknown;
  tokens: AstToken[];
  /**
   * What to subtract from a span in `block` or `error` to get a byte offset
   * into the source. Those spans are offsets into nu's whole engine state;
   * the tokens' spans are already relative to the source.
   */
  base: number;
}

const AST_COMMAND = [
  'let src = $in',
  'let tree = (ast --json --minify $src)',
  '{block: $tree.block, error: $tree.error, tokens: (ast --flatten --json --minify $src)} | to json --raw',
].join('; ');

/** Parse `source` with `nu`. Rejects when `nu` fails or its output isn't JSON. */
export async function parseAst(
  nu: string,
  source: string,
  cwd: string | undefined,
): Promise<ParsedAst> {
  const stdout = await runNu(nu, AST_COMMAND, source, cwd);
  const raw = JSON.parse(stdout) as Record<string, unknown>;
  const block: unknown = JSON.parse(String(raw.block));
  const error: unknown = JSON.parse(String(raw.error));
  const tokens: unknown = JSON.parse(String(raw.tokens));

  return {
    block,
    error,
    tokens: Array.isArray(tokens) ? (tokens as AstToken[]) : [],
    base: blockBase(block),
  };
}

/** The block's span covers the whole source, so its start is the source's. */
function blockBase(block: unknown): number {
  if (typeof block !== 'object' || block === null) {
    return 0;
  }

  const span = (block as Record<string, unknown>).span as
    | Record<string, unknown>
    | undefined;
  return typeof span?.start === 'number' ? span.start : 0;
}
