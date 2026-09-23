import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  findDefs,
  findMainSignature,
  hasRequiredPositional,
} from './script-signatures';

test("findMainSignature returns main's parameter list", () => {
  assert.equal(
    findMainSignature('def main [name: string, --verbose] {\n}'),
    'name: string, --verbose',
  );
});

test('findMainSignature accepts export and def flags', () => {
  assert.equal(findMainSignature('export def --env main [x] {}'), 'x');
});

test('findMainSignature is undefined without a main', () => {
  assert.equal(
    findMainSignature('def maintain [x] {}\ndef greet [] {}'),
    undefined,
  );
});

test('findDefs lists every top-level def except main', () => {
  const source = [
    'def main [] {}',
    'def greet [name: string] {}',
    'export def "my cmd" [a, b] {}',
    'def foo-bar:baz [] {}',
  ].join('\n');
  assert.deepEqual(findDefs(source), [
    { name: 'greet', signature: 'name: string' },
    { name: 'my cmd', signature: 'a, b' },
    { name: 'foo-bar:baz', signature: '' },
  ]);
});

test('hasRequiredPositional is true only for a bare positional', () => {
  assert.equal(hasRequiredPositional(''), false);
  assert.equal(hasRequiredPositional('name: string'), true);
  assert.equal(hasRequiredPositional('--verbose, --tag: string'), false);
  assert.equal(hasRequiredPositional('...rest'), false);
  assert.equal(hasRequiredPositional('count: int = 3'), false);
  assert.equal(hasRequiredPositional('name?: string'), false);
});

test('hasRequiredPositional ignores comment lines in a multi-line signature', () => {
  const signature =
    '\n    # the name to greet\n    name: string # required\n    --verbose\n';
  assert.equal(hasRequiredPositional(signature), true);
  assert.equal(
    hasRequiredPositional('\n    # nothing here\n    --verbose\n'),
    false,
  );
});
