import {
  commands,
  env,
  Uri,
  window,
  workspace,
  WorkspaceConfiguration,
} from 'vscode';
import * as which from 'which';

import { Resolution, resolveExecutable } from './resolve-executable';
import { NUSHELL_DOWNLOAD_PAGE } from './version';

const CONFIG_SECTION = 'nushellLanguageServer';
const EXECUTABLE_SETTING = 'nushellExecutablePath';

function settings(): WorkspaceConfiguration {
  // Use null for resource to get global/workspace settings
  return workspace.getConfiguration(CONFIG_SECTION, null);
}

/**
 * Find the `nu` used by the language server, the terminal profile and the
 * debugger, in order: the `nushellExecutablePath` setting -> `nu` on PATH.
 */
export function resolveNushell(): Resolution {
  return resolveExecutable(
    settings().get<string>(EXECUTABLE_SETTING, 'nu'),
    (command) => which.sync(command, { nothrow: true }) ?? undefined,
    (configured) => {
      void window.showWarningMessage(
        `Nushell executable not found at ${CONFIG_SECTION}.${EXECUTABLE_SETTING} (${configured}). Falling back to 'nu' on PATH.`,
      );
    },
  );
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
