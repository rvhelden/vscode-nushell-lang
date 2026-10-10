import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  invalidateRequests,
  nextRequest,
  showLatest,
} from '../visualize/request-generation';

/** A promise to settle by hand, to answer requests out of order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('nextRequest: only the latest request is current', () => {
  const first = nextRequest();
  const second = nextRequest();
  assert.equal(first(), false);
  assert.equal(second(), true);
  invalidateRequests();
  assert.equal(second(), false);
});

test('showLatest drops a slow answer that a newer request overtook', async () => {
  const painted: string[] = [];
  const big = deferred<string>();
  const small = deferred<string>();

  const bigShown = showLatest(
    () => big.promise,
    (v) => painted.push(v),
  );
  const smallShown = showLatest(
    () => small.promise,
    (v) => painted.push(v),
  );

  small.resolve('$small');
  assert.equal(await smallShown, 'shown');
  big.resolve('$big');
  assert.equal(await bigShown, 'stale');

  assert.deepEqual(painted, ['$small']);
});

test('showLatest drops an answer that arrives after a pin change', async () => {
  const painted: string[] = [];
  const answer = deferred<string>();

  const shown = showLatest(
    () => answer.promise,
    (v) => painted.push(v),
  );
  invalidateRequests();
  answer.resolve('$a');

  assert.equal(await shown, 'stale');
  assert.deepEqual(painted, []);
});

test('showLatest swallows the failure of a stale request', async () => {
  const failing = deferred<string>();
  const stale = showLatest(
    () => failing.promise,
    () => {},
  );
  nextRequest();
  failing.reject(new Error('stale reference'));
  assert.equal(await stale, 'stale');
});

test('showLatest passes on the failure of the latest request', async () => {
  await assert.rejects(
    showLatest(
      () => Promise.reject(new Error('out of scope')),
      () => {},
    ),
    /out of scope/,
  );
});
