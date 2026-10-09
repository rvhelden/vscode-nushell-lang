import * as os from 'os';
import * as path from 'path';
import {
  commands,
  env,
  Uri,
  window,
  workspace,
  WorkspaceConfiguration,
} from 'vscode';
import * as which from 'which';

import { NUSHELL_DOWNLOAD_PAGE } from './version';

const CONFIG_SECTION = 'nushellLanguageServer';
const EXECUTABLE_SETTING = 'nushellExecutablePath';

export type NushellSource = 'setting' | 'path';

export type Resolution =
  | { kind: 'found'; path: string; source: NushellSource }
  | { kind: 'missing' };

function settings(): WorkspaceConfiguration {
  // Use null for resource to get global/workspace settings
  return workspace.getConfiguration(CONFIG_SECTION, null);
}

function expandHome(p: string): string {
  if (!(p === '~' || p.startsWith('~/') || p.startsWith('~\\'))) {
    return p;
  }

  return path.join(os.homedir(), p.slice(1));
}

/**
 * Find the `nu` used by the language server, the terminal profile and the
 * debugger, in order: the `nushellExecutablePath` setting -> `nu` on PATH.
 */
export function resolveNushell(): Resolution {
  const configured = settings().get<string>(EXECUTABLE_SETTING, 'nu').trim();

  if (configured && configured !== 'nu') {
    const found = which.sync(expandHome(configured), { nothrow: true });
    if (found) {
      return { kind: 'found', path: found, source: 'setting' };
    }

    void window.showWarningMessage(
      `Nushell executable not found at ${CONFIG_SECTION}.${EXECUTABLE_SETTING} (${configured}). Falling back to 'nu' on PATH.`,
    );
  }

  const onPath = which.sync('nu', { nothrow: true });
  if (onPath) {
    return { kind: 'found', path: onPath, source: 'path' };
  }

  return { kind: 'missing' };
}

/**
 * Resolve `nu`, pointing the user at the Nushell download page when nothing
 * is configured or on PATH. Returns undefined when there is no usable `nu`.
 */
export function ensureNushell(): string | undefined {
  const resolution = resolveNushell();
  if (resolution.kind === 'found') {
    return resolution.path;
  }

  void showNotFound();
  return undefined;
}

async function showNotFound(): Promise<void> {
  const openPage = 'Open download page';
  const configurePath = 'Configure path';
  const choice = await window.showWarningMessage(
    'Nushell was not found in your PATH. Install Nushell, or set the path to nu.',
    openPage,
    configurePath,
  );

  switch (choice) {
    case openPage:
      await env.openExternal(Uri.parse(NUSHELL_DOWNLOAD_PAGE));
      break;
    case configurePath:
      await commands.executeCommand(
        'workbench.action.openSettings',
        `${CONFIG_SECTION}.${EXECUTABLE_SETTING}`,
      );
      break;
  }
}
