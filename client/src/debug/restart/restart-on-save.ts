import * as vscode from 'vscode';

import { isNuDocument } from '../shared/nu-document';
import { activeNuSession } from '../shared/session';

/**
 * Hot restart: saving a .nu file during an active nushell debug session
 * restarts the session, so the adapter re-reads the script from disk.
 */
export function restartIfDebuggingNuScript(doc: vscode.TextDocument): void {
  if (!isRestartOnSaveEnabled()) {
    return;
  }

  if (!isNuDocument(doc)) {
    return;
  }

  if (!activeNuSession()) {
    return;
  }

  void vscode.commands.executeCommand('workbench.action.debug.restart');
}

function isRestartOnSaveEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('nushellDebugger')
    .get<boolean>('restartOnSave', false);
}
