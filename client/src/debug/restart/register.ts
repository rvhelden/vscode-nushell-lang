import * as vscode from 'vscode';

import { restartIfDebuggingNuScript } from './restart-on-save';

export function register(): vscode.Disposable[] {
  return [vscode.workspace.onDidSaveTextDocument(restartIfDebuggingNuScript)];
}
