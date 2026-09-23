// Pure helpers for picking and verifying a Nushell GitHub release asset.
// Kept free of `vscode` imports so they can be unit tested with node:test.

/** The Rust target triple nushell publishes a build for, or undefined if there is none. */
export function releaseTarget(
  platform: NodeJS.Platform,
  arch: string,
): string | undefined {
  const cpu = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : '';
  if (!cpu) {
    return undefined;
  }

  switch (platform) {
    case 'linux':
      return `${cpu}-unknown-linux-gnu`;
    case 'darwin':
      return `${cpu}-apple-darwin`;
    case 'win32':
      return `${cpu}-pc-windows-msvc`;
    default:
      return undefined;
  }
}

/** Release asset name, e.g. `nu-0.116.0-x86_64-unknown-linux-gnu.tar.gz`. */
export function assetName(version: string, target: string): string {
  const extension = target.endsWith('-windows-msvc') ? 'zip' : 'tar.gz';
  return `nu-${version}-${target}.${extension}`;
}

/** Parse a `SHA256SUMS` file (`<hex>  <file name>` per line) into name -> hash. */
export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match) {
      sums.set(match[2].trim(), match[1].toLowerCase());
    }
  }
  return sums;
}

/** Extract `x.y.z` from `nu --version` output (e.g. `0.116.0` or `0.116.0-nightly.3`). */
export function parseNuVersion(output: string): string | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined;
}

/** Numeric comparison of `x.y.z` versions: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}
