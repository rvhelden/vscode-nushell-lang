import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { RestartHooks, ServerRestarter } from '../server-restart';

const DELAY = 500;

/** A fake language server: records resolves and restarts, and how many restarts overlap. */
class FakeServer implements RestartHooks {
  running = true;
  path: string | undefined = '/usr/bin/nu';
  configured: string | undefined = '/usr/local/bin/nu';
  resolves = 0;
  restarts: string[] = [];
  active = 0;
  maxActive = 0;
  /** When set, each restart waits for this before finishing. */
  gate: Promise<void> | undefined;

  isRunning(): boolean {
    return this.running;
  }

  runningPath(): string | undefined {
    return this.running ? this.path : undefined;
  }

  resolve(): string | undefined {
    this.resolves++;
    return this.configured;
  }

  async restart(path: string): Promise<void> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await this.gate;
      this.restarts.push(path);
      this.path = path;
      this.running = true;
    } finally {
      this.active--;
    }
  }
}

function withTimers(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      await fn();
    } finally {
      mock.timers.reset();
    }
  };
}

test(
  'ServerRestarter waits for typing to settle before restarting once',
  withTimers(async () => {
    const server = new FakeServer();
    const restarter = new ServerRestarter(server, DELAY);

    for (const partial of ['/usr', '/usr/local/bin', '/usr/local/bin/nu']) {
      server.configured = partial;
      restarter.schedule();
      mock.timers.tick(DELAY / 2);
    }
    mock.timers.tick(DELAY);
    await restarter.idle();

    assert.equal(server.resolves, 1);
    assert.deepEqual(server.restarts, ['/usr/local/bin/nu']);
  }),
);

test(
  'ServerRestarter leaves a stopped server stopped',
  withTimers(async () => {
    const server = new FakeServer();
    server.running = false;
    const restarter = new ServerRestarter(server, DELAY);

    restarter.schedule();
    mock.timers.tick(DELAY);
    await restarter.idle();

    assert.deepEqual(server.restarts, []);
  }),
);

test(
  'ServerRestarter skips a restart when the resolved nu is unchanged',
  withTimers(async () => {
    const server = new FakeServer();
    server.configured = server.path;
    const restarter = new ServerRestarter(server, DELAY);

    restarter.schedule();
    mock.timers.tick(DELAY);
    await restarter.idle();

    assert.deepEqual(server.restarts, []);
  }),
);

test(
  'ServerRestarter runs overlapping restarts one after the other',
  withTimers(async () => {
    const server = new FakeServer();
    let open!: () => void;
    server.gate = new Promise((resolve) => (open = resolve));
    const restarter = new ServerRestarter(server, DELAY);

    server.configured = '/a/nu';
    restarter.schedule();
    mock.timers.tick(DELAY);
    await Promise.resolve(); // let the first restart begin

    server.configured = '/b/nu';
    restarter.schedule();
    mock.timers.tick(DELAY);
    await Promise.resolve();

    open();
    await restarter.idle();

    assert.equal(server.maxActive, 1);
    assert.deepEqual(server.restarts, ['/a/nu', '/b/nu']);
  }),
);
