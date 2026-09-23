import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assetName,
  compareVersions,
  parseNuVersion,
  parseSha256Sums,
  releaseTarget,
} from './release';

test('releaseTarget maps supported platforms to nushell target triples', () => {
  assert.equal(releaseTarget('linux', 'x64'), 'x86_64-unknown-linux-gnu');
  assert.equal(releaseTarget('linux', 'arm64'), 'aarch64-unknown-linux-gnu');
  assert.equal(releaseTarget('darwin', 'arm64'), 'aarch64-apple-darwin');
  assert.equal(releaseTarget('darwin', 'x64'), 'x86_64-apple-darwin');
  assert.equal(releaseTarget('win32', 'x64'), 'x86_64-pc-windows-msvc');
  assert.equal(releaseTarget('win32', 'arm64'), 'aarch64-pc-windows-msvc');
});

test('releaseTarget returns undefined for unsupported platforms', () => {
  assert.equal(releaseTarget('linux', 'ia32'), undefined);
  assert.equal(releaseTarget('freebsd', 'x64'), undefined);
});

test('assetName uses zip on Windows and tar.gz elsewhere', () => {
  assert.equal(
    assetName('0.116.0', 'x86_64-unknown-linux-gnu'),
    'nu-0.116.0-x86_64-unknown-linux-gnu.tar.gz',
  );
  assert.equal(
    assetName('0.116.0', 'x86_64-pc-windows-msvc'),
    'nu-0.116.0-x86_64-pc-windows-msvc.zip',
  );
});

test('parseSha256Sums reads hash and file name pairs', () => {
  const hash = 'A'.repeat(64);
  const sums = parseSha256Sums(
    `${hash}  nu-0.116.0-x86_64-pc-windows-msvc.zip\n\nnot a line\n`,
  );
  assert.equal(sums.size, 1);
  assert.equal(
    sums.get('nu-0.116.0-x86_64-pc-windows-msvc.zip'),
    'a'.repeat(64),
  );
});

test('parseNuVersion extracts x.y.z', () => {
  assert.equal(parseNuVersion('0.116.0\n'), '0.116.0');
  assert.equal(parseNuVersion('0.117.0-nightly.3'), '0.117.0');
  assert.equal(parseNuVersion('garbage'), undefined);
});

test('compareVersions compares numerically', () => {
  assert.ok(compareVersions('0.115.1', '0.116.0') < 0);
  assert.ok(compareVersions('0.116.0', '0.116.0') === 0);
  assert.ok(compareVersions('0.120.0', '0.116.0') > 0);
  assert.ok(compareVersions('1.0.0', '0.999.9') > 0);
});
