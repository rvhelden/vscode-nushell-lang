import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  NuDefinition,
  definitionsFromAst,
  needsArgumentPrompt,
  parameterList,
  readDefinitions,
} from '../launch/script-signatures';

// `ast --json --minify $in | get block` of fixtures/ast-defs.nu, from nu
// 0.116. Regenerate it with that command when the AST format changes.
const FIXTURES = path.join(__dirname, '../../../src/debug/tests/fixtures');
const block: unknown = JSON.parse(
  readFileSync(path.join(FIXTURES, 'ast-defs.json'), 'utf8'),
);

test('definitionsFromAst lists the top-level defs, in order', () => {
  assert.deepEqual(
    definitionsFromAst(block).map((def) => def.name),
    ['my cmd', 'greet', 'opt', 'attributed', 'typed', 'multi', 'main'],
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
    attributed: true, // @example ... def attributed [x: int]
    typed: true, // [x: int]: nothing -> int
    multi: true, // [name: string]: nothing -> nothing
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
  assert.equal(signatures['attributed'], 'x: int');
  assert.equal(signatures['typed'], 'x: int');
  assert.equal(signatures['multi'], '\n  name: string   # the name\n');
});

test('parameterList stops at the bracket that closes the parameters', () => {
  const cases: [string, string][] = [
    ['[x: int]', 'x: int'],
    ['(y?: int, --v(-v))', 'y?: int, --v(-v)'],
    ['[x: int]: nothing -> int', 'x: int'],
    [
      '[\n  name: string   # the name\n]: nothing -> nothing',
      '\n  name: string   # the name\n',
    ],
    ['[]: [nothing -> int, string -> int]', ''],
    [
      '[x: list<int> = [1 2], y: int]: nothing -> int',
      'x: list<int> = [1 2], y: int',
    ],
    ['[x # a ] in a comment\n]: any -> any', 'x # a ] in a comment\n'],
    ['[x = "]", y]: any -> any', 'x = "]", y'],
    ["[x = ']', y]: any -> any", "x = ']', y"],
  ];
  for (const [written, expected] of cases) {
    assert.equal(parameterList(written), expected, written);
  }
});

test('needsArgumentPrompt treats `args: []` like no args', () => {
  const required: NuDefinition = {
    name: 'main',
    signature: 'x',
    hasRequired: true,
  };
  const optional: NuDefinition = {
    name: 'main',
    signature: 'x?',
    hasRequired: false,
  };
  assert.equal(needsArgumentPrompt(required, undefined), true);
  assert.equal(needsArgumentPrompt(required, []), true);
  assert.equal(needsArgumentPrompt(required, ['a']), false);
  assert.equal(needsArgumentPrompt(optional, undefined), false);
  assert.equal(needsArgumentPrompt(optional, []), false);
});

test(
  'readDefinitions survives a nu that exits before reading the script',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nu-defs-'));
    const program = path.join(dir, 'big.nu');
    writeFileSync(program, '# padding\n'.repeat(512 * 1024)); // ~5 MB
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', onUncaught);
    try {
      assert.equal(await readDefinitions('/usr/bin/true', program), undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepEqual(uncaught, []);
    } finally {
      process.off('uncaughtException', onUncaught);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

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
