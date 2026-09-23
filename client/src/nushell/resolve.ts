import * as vscode from 'vscode';
import * as which from 'which';

import { downloadLatestNushell, downloadedNushell } from './download';

export type NushellSource = 'setting' | 'path' | 'downloaded';

export type Resolution =
  | { kind: 'found'; path: string; source: NushellSource }
  | { kind: 'badSetting'; configured: string }
  | { kind: 'missing' };

type AutoDownload = 'ask' | 'always' | 'never';

function settings(): vscode.WorkspaceConfiguration {
  // Use null for resource to get global/workspace settings
  return vscode.workspace.getConfiguration('nushellLanguageServer', null);
}

/**
 * Find the `nu` used by the language server, the terminal profile and the
 * debugger, in order: the `nushellExecutablePath` setting -> `nu` on PATH ->
 * the copy this extension downloaded.
 */
export function resolveNushell(context: vscode.ExtensionContext): Resolution {
  const configured = settings()
    .get<string>('nushellExecutablePath', 'nu')
    .trim();
  if (configured && configured !== 'nu') {
    const found = which.sync(configured, { nothrow: true });
    if (found) {
      return { kind: 'found', path: found, source: 'setting' };
    }
    // An explicit override that points at nothing is an error, not a reason to fall back silently.
    return { kind: 'badSetting', configured };
  }

  const onPath = which.sync('nu', { nothrow: true });
  if (onPath) {
    return { kind: 'found', path: onPath, source: 'path' };
  }

  const downloaded = downloadedNushell(context);
  if (downloaded) {
    return { kind: 'found', path: downloaded.path, source: 'downloaded' };
  }

  return { kind: 'missing' };
}

let pendingDownload: Promise<string | undefined> | undefined;

/** Download the latest release (one at a time), reporting failures to the user. */
export function downloadNushell(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  if (!pendingDownload) {
    pendingDownload = downloadLatestNushell(context)
      .then((nu) => {
        void vscode.window.showInformationMessage(
          `Nushell downloaded to ${nu}.`,
        );
        return nu;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(
          `Failed to download Nushell: ${message}`,
        );
        return undefined;
      })
      .finally(() => {
        pendingDownload = undefined;
      });
  }
  return pendingDownload;
}

let askedThisSession = false;

/**
 * Resolve `nu`, offering to download it when nothing is configured or on
 * PATH. Returns undefined when there is no usable `nu`.
 */
export async function ensureNushell(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  const resolution = resolveNushell(context);
  if (resolution.kind === 'found') {
    return resolution.path;
  }

  if (resolution.kind === 'badSetting') {
    void vscode.window.showErrorMessage(
      `Nushell executable not found at nushellLanguageServer.nushellExecutablePath (${resolution.configured}). Fix the setting, or reset it to 'nu' to use nu from PATH or a downloaded copy.`,
    );
    return undefined;
  }

  if (pendingDownload) {
    return pendingDownload;
  }

  const mode = settings().get<AutoDownload>('autoDownload', 'ask');
  if (mode === 'always') {
    return downloadNushell(context);
  }

  if (mode === 'never' || askedThisSession) {
    showNotFound();
    return undefined;
  }

  askedThisSession = true;
  const choice = await vscode.window.showInformationMessage(
    `Nushell was not found in your PATH. Download the latest Nushell release for ${process.platform}-${process.arch}?`,
    'Download',
    'Install from website',
    'Configure path',
  );
  switch (choice) {
    case 'Download':
      return downloadNushell(context);
    case 'Install from website':
      void vscode.env.openExternal(vscode.Uri.parse('https://www.nushell.sh/'));
      return undefined;
    case 'Configure path':
      void vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'nushellLanguageServer.nushellExecutablePath',
      );
      return undefined;
    default:
      return undefined;
  }
}

function showNotFound(): void {
  vscode.window
    .showErrorMessage(
      'Nushell executable not found. Install Nushell, or run "Nushell: Download / Update Nushell".',
      'Download',
    )
    .then((selection) => {
      if (selection) {
        void vscode.commands.executeCommand('nushell.downloadNushell');
      }
    });
}
