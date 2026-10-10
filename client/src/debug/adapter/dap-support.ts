// Does a `nu` ship the debugger? Checked once per path.
// Kept free of `vscode` imports so it can be unit tested with node:test.

import { compareVersions } from '../../nushell/version';

/** The first Nushell release that ships `nu --dap`. */
export const MIN_DAP_VERSION = '0.116.0';

/** `nu --version` of a `nu`, as `x.y.z`; undefined when it cannot be asked. */
export type VersionReader = (nu: string) => Promise<string | undefined>;

export type DapSupportResult =
  | { kind: 'ok' }
  | { kind: 'unknown' }
  | { kind: 'too-old'; version: string };

/**
 * Compares `nu --version` against {@link MIN_DAP_VERSION}; nightlies report
 * the upcoming release (e.g. `0.116.0-nightly.3`), so they pass too. Not
 * cached on failure: the user may upgrade `nu` before the next launch.
 */
export class DapSupport {
  /** `nu` paths already known to support `--dap`. */
  private readonly supported = new Set<string>();
  private readonly readVersion: VersionReader;

  constructor(readVersion: VersionReader) {
    this.readVersion = readVersion;
  }

  async check(nu: string): Promise<DapSupportResult> {
    if (this.supported.has(nu)) {
      return { kind: 'ok' };
    }

    const version = await this.readVersion(nu);
    if (!version) {
      return { kind: 'unknown' }; // could not ask: let `nu --dap` speak for itself
    }

    if (compareVersions(version, MIN_DAP_VERSION) >= 0) {
      this.supported.add(nu);
      return { kind: 'ok' };
    }

    return { kind: 'too-old', version };
  }
}
