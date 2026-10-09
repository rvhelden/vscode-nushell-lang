import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { definitionsFromAst } from '../launch/script-signatures';

// `ast --json --minify $in | get block` of fixtures/ast-defs.nu, from nu
// 0.116. Regenerate it with that command when the AST format changes.
const FIXTURES = path.join(__dirname, '../../../src/debug/tests/fixtures');
const block: unknown = JSON.parse(
  readFileSync(path.join(FIXTURES, 'ast-defs.json'), 'utf8'),
);

test('definitionsFromAst lists the top-level defs, in order', () => {
  assert.deepEqual(
    definitionsFromAst(block).map((def) => def.name),
    ['my cmd', 'greet', 'opt', 'main'],
  );
});

test('definitionsFromAst takes what nushell parsed as required', () => {
  const required = Object.fromEntries(
    definitionsFromAst(block).map((def) => [def.name, def.hasRequired]),
  );
  assert.deepEqual(required, {
    'my cmd': true, // [a]
    greet: true, // [x: list<int> = [1 2], name # who, to greet]
    opt: false, // (y?: int, --v(-v))
    main: true, // [--verbose name: string, ...rest]
  });
});

test('definitionsFromAst keeps the parameter list as written', () => {
  const signatures = Object.fromEntries(
    definitionsFromAst(block).map((def) => [def.name, def.signature]),
  );
  assert.equal(signatures['main'], '--verbose name: string, ...rest');
  assert.equal(signatures['opt'], 'y?: int, --v(-v)');
  assert.equal(
    signatures['greet'],
    'x: list<int> = [1 2], name # who, to greet\n',
  );
});

test('definitionsFromAst skips what it does not recognize', () => {
  for (const input of [null, 42, {}, { pipelines: 'x' }, { pipelines: [{}] }]) {
    assert.deepEqual(definitionsFromAst(input), [], JSON.stringify(input));
  }

  // A `def` call without a Signature argument (the AST's keys are snake_case).
  const noSignature: unknown =
    JSON.parse(`{"pipelines": [{"elements": [{"expr": {"expr": {"Call": {
    "head": {"span_source": "def"},
    "arguments": [{"Positional": {"expr": {"String": "f"}}}]
  }}}}]}]}`);
  assert.deepEqual(definitionsFromAst(noSignature), []);
});
