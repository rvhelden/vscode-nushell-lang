// When to restart the language server after `nushellExecutablePath` changes.
// Kept free of `vscode` imports so it can be unit tested with node:test.

/** What the restarter needs to know about, and do to, the language server. */
export interface RestartHooks {
  /** Is a language client running (or starting)? */
  isRunning(): boolean;
  /** The `nu` the running client was started with. */
  runningPath(): string | undefined;
  /** The `nu` the settings point at now; undefined when there is none. */
  resolve(): string | undefined;
  /** Stop the running client and start one on `path`. */
  restart(path: string): Promise<void>;
}

/**
 * Restarts the language server for a changed `nushellExecutablePath`.
 */
export class ServerRestarter {
  private readonly hooks: RestartHooks;
  private readonly delayMs: number;
  private readonly pending = new Set<Promise<void>>();

  constructor(hooks: RestartHooks, delayMs: number) {
    this.hooks = hooks;
    this.delayMs = delayMs;
  }

  /** The setting changed. */
  schedule(): void {
    const run = this.run();
    this.pending.add(run);
    void run.finally(() => this.pending.delete(run));
  }

  /** Settles once every scheduled restart has finished. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  private async run(): Promise<void> {
    const path = this.hooks.resolve();
    if (path) {
      await this.hooks.restart(path);
    }
  }
}
