import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DapSupport } from '../adapter/dap-support';

/** A version reader answering from a table, counting the questions. */
function reader(versions: Record<string, string | undefined>) {
  const asked: string[] = [];
  const read = async (nu: string) => {
    asked.push(nu);
    return versions[nu];
  };
  return { read, asked };
}

test('DapSupport accepts 0.116.0 and later', async () => {
  const { read } = reader({ '/a/nu': '0.116.0', '/b/nu': '0.117.2' });
  const support = new DapSupport(read);
  assert.deepEqual(await support.check('/a/nu'), { kind: 'ok' });
  assert.deepEqual(await support.check('/b/nu'), { kind: 'ok' });
});

test('DapSupport reports an older nu with its version', async () => {
  const { read } = reader({ '/old/nu': '0.115.9' });
  assert.deepEqual(await new DapSupport(read).check('/old/nu'), {
    kind: 'too-old',
    version: '0.115.9',
  });
});

test('DapSupport lets an unreadable version through as unknown', async () => {
  const { read } = reader({});
  assert.deepEqual(await new DapSupport(read).check('/x/nu'), {
    kind: 'unknown',
  });
});

test('DapSupport caches success, but not failure', async () => {
  const versions: Record<string, string> = {
    '/a/nu': '0.116.0',
    '/old/nu': '0.115.0',
  };
  const { read, asked } = reader(versions);
  const support = new DapSupport(read);

  await support.check('/a/nu');
  await support.check('/a/nu');
  await support.check('/old/nu');
  versions['/old/nu'] = '0.116.1'; // upgraded in between
  assert.deepEqual(await support.check('/old/nu'), { kind: 'ok' });

  assert.deepEqual(asked, ['/a/nu', '/old/nu', '/old/nu']);
});
