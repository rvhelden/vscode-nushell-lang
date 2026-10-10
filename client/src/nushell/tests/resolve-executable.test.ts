import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { Lookup, resolveExecutable } from '../resolve-executable';

/** A `which` that knows only these paths (and `nu`, when given). */
function lookupOf(known: Record<string, string>): Lookup {
  return (command) => known[command];
}

test('resolveExecutable reports a stale setting instead of warning itself', () => {
  const resolution = resolveExecutable(
    '/opt/homebrew/bin/nu',
    lookupOf({ nu: '/usr/bin/nu' }),
  );
  assert.deepEqual(resolution, {
    kind: 'found',
    path: '/usr/bin/nu',
    fellBackFrom: '/opt/homebrew/bin/nu',
  });
});

test('resolveExecutable uses a valid setting', () => {
  const resolution = resolveExecutable(
    '/opt/homebrew/bin/nu',
    lookupOf({
      '/opt/homebrew/bin/nu': '/opt/homebrew/bin/nu',
      nu: '/usr/bin/nu',
    }),
  );
  assert.deepEqual(resolution, { kind: 'found', path: '/opt/homebrew/bin/nu' });
});

test('resolveExecutable reads an empty or `nu` setting as PATH', () => {
  for (const configured of ['', 'nu', '  nu  ']) {
    assert.deepEqual(
      resolveExecutable(configured, lookupOf({ nu: '/usr/bin/nu' })),
      { kind: 'found', path: '/usr/bin/nu' },
      JSON.stringify(configured),
    );
  }
});

test('resolveExecutable is missing when nothing is found', () => {
  assert.deepEqual(resolveExecutable('/nope/nu', lookupOf({})), {
    kind: 'missing',
  });
  assert.deepEqual(resolveExecutable('nu', lookupOf({})), { kind: 'missing' });
});

test('resolveExecutable expands ~ in the setting', () => {
  const home = path.join(os.homedir(), 'bin', 'nu');
  assert.deepEqual(resolveExecutable('~/bin/nu', lookupOf({ [home]: home })), {
    kind: 'found',
    path: home,
  });
});
