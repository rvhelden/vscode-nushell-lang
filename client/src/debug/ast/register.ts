import * as vscode from 'vscode';

import {
  onActiveEditorChanged,
  onDocumentChanged,
  onSelectionChanged,
  showAstPanel,
} from './ast-panel';

export function register(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('nushell-debug.showAst', showAstPanel),
    vscode.window.onDidChangeActiveTextEditor(onActiveEditorChanged),
    vscode.workspace.onDidChangeTextDocument(onDocumentChanged),
    vscode.window.onDidChangeTextEditorSelection(onSelectionChanged),
  ];
}
