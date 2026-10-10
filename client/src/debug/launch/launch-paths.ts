// Where a launch's `program` and `cwd` point, before anything reads them.
// Kept free of `vscode` imports so it can be unit tested with node:test.

import * as path from 'path';

export interface LaunchPaths {
  program: string;
  cwd: unknown;
}

/**
 * `program: "scripts/tool.nu"` is relative to the script's working directory,
 * not to the extension host's — resolve it so both we and the adapter read
 * the right file.
 */
export function resolveLaunchPaths(
  folder: string | undefined,
  program: string,
  cwd: unknown,
): LaunchPaths {
  if (path.isAbsolute(program)) {
    return { program, cwd };
  }

  // `cwd` may itself be relative to the workspace folder.
  const bases = [folder, cwd].filter(
    (base): base is string => typeof base === 'string' && base !== '',
  );
  if (bases.length === 0) {
    return { program, cwd }; // nothing to anchor it to: let the adapter report it
  }

  return { program: path.resolve(...bases, program), cwd };
}
