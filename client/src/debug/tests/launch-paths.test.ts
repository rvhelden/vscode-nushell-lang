import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';

import { resolveLaunchPaths } from '../launch/launch-paths';

const ws = path.resolve('/ws');

test('resolveLaunchPaths anchors a relative cwd to the workspace folder', () => {
  assert.deepEqual(resolveLaunchPaths(ws, 'tool.nu', 'scripts'), {
    program: path.join(ws, 'scripts', 'tool.nu'),
    cwd: path.join(ws, 'scripts'),
  });
});

test('resolveLaunchPaths anchors a relative cwd even when program is absolute', () => {
  const program = path.join(ws, 'tool.nu');
  assert.deepEqual(resolveLaunchPaths(ws, program, 'scripts'), {
    program,
    cwd: path.join(ws, 'scripts'),
  });
});

test('resolveLaunchPaths leaves an absolute or missing cwd alone', () => {
  const abs = path.resolve('/elsewhere');
  assert.deepEqual(resolveLaunchPaths(ws, 'tool.nu', abs), {
    program: path.join(abs, 'tool.nu'),
    cwd: abs,
  });
  assert.deepEqual(resolveLaunchPaths(ws, 'tool.nu', undefined), {
    program: path.join(ws, 'tool.nu'),
    cwd: undefined,
  });
});

test('resolveLaunchPaths without a workspace folder leaves relative paths alone', () => {
  assert.deepEqual(resolveLaunchPaths(undefined, 'tool.nu', undefined), {
    program: 'tool.nu',
    cwd: undefined,
  });
  assert.deepEqual(resolveLaunchPaths(undefined, 'tool.nu', 'scripts'), {
    program: path.resolve('scripts', 'tool.nu'),
    cwd: 'scripts',
  });
});
