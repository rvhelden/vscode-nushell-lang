// Finding `nu` from the setting and PATH, without reporting anything.
// Kept free of `vscode` imports so it can be unit tested with node:test.

import * as os from 'os';
import * as path from 'path';

export type NushellSource = 'setting' | 'path';

export type Resolution =
  | { kind: 'found'; path: string; source: NushellSource }
  | { kind: 'missing' };

/** Looks a command or path up the way `which` does; undefined when not found. */
export type Lookup = (command: string) => string | undefined;

export function expandHome(p: string): string {
  if (!(p === '~' || p.startsWith('~/') || p.startsWith('~\\'))) {
    return p;
  }

  return path.join(os.homedir(), p.slice(1));
}

/**
 * Find `nu`, in order: the configured path -> `nu` on PATH. `configured` is
 * the `nushellExecutablePath` setting; `''` and `'nu'` mean "use PATH".
 */
export function resolveExecutable(
  configured: string,
  lookup: Lookup,
  onFallback?: (configured: string) => void,
): Resolution {
  const setting = configured.trim();

  if (setting && setting !== 'nu') {
    const found = lookup(expandHome(setting));
    if (found) {
      return { kind: 'found', path: found, source: 'setting' };
    }

    onFallback?.(setting);
  }

  const onPath = lookup('nu');
  if (onPath) {
    return { kind: 'found', path: onPath, source: 'path' };
  }

  return { kind: 'missing' };
}
