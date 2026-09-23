import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitArgs } from './split-args';

test('splitArgs splits on whitespace', () => {
  assert.deepEqual(splitArgs('alice 3 --verbose'), ['alice', '3', '--verbose']);
});

test('splitArgs keeps quoted values together and drops the quotes', () => {
  assert.deepEqual(splitArgs(`"hello world" 'x y' z`), [
    'hello world',
    'x y',
    'z',
  ]);
});

test('splitArgs of an empty line is empty', () => {
  assert.deepEqual(splitArgs(''), []);
  assert.deepEqual(splitArgs('   '), []);
});
