import * as path from 'path';
import * as vscode from 'vscode';

import { ensureNushell, resolveNushell } from '../../nushell/resolve';
import { assetDir } from '../shared/assets';
import { isNuDocument } from '../shared/nu-document';
import {
  astPage,
  closeGraphWindow,
  openGraphWindow,
  setGraphTitle,
  updateGraphSelection,
  updateGraphView,
} from './ast-graph-window';
import { buildAst } from './ast-model';
import { parseAst } from './ast-parse';
import { PageMessage, PanelMessage } from './ast-view';

// The singleton webview showing the AST of a Nushell script, as nu's own
// parser (`ast`) sees it: a tree table and a graph of the selected node. It
// follows the active .nu editor, re-parses as the script is edited, and keeps
// its selection in step with the editor's both ways. The page is
// ast-panel.html with ast-panel.webview.js (esbuild's bundle of webview/),
// both in out/debug/. The graph can also go in a window of its own
// (ast-graph-window.ts); messages between the two pages pass through here.

/** Wait for a pause in typing before re-parsing. */
const REPARSE_DELAY_MS = 300;

let panel: vscode.WebviewPanel | undefined;
let ready = false; // the page is listening for messages
let tracked: vscode.TextDocument | undefined;
/** The parse on the page, and the text it was made from: spans index into it. */
let shown: { document: vscode.TextDocument; source: Buffer } | undefined;
let generation = 0; // drops a parse that finishes after a newer one started
let reparseTimer: NodeJS.Timeout | undefined;
/** The range the page last selected, so its echo isn't sent back. */
let revealed: vscode.Range | undefined;

/** The command: show the AST of `uri` (from the editor toolbar) or the active editor. */
export function showAstPanel(uri?: vscode.Uri): void {
  const document = documentFor(uri);
  if (!document) {
    void vscode.window.showInformationMessage(
      'Open a Nushell script to show its AST.',
    );
    return;
  }

  if (!ensureNushell()) {
    return;
  }

  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside, true);
  } else {
    panel = createPanel();
  }

  track(document);
}

/** Follow the user to another Nushell script. */
export function onActiveEditorChanged(
  editor: vscode.TextEditor | undefined,
): void {
  if (!panel || !editor) {
    return;
  }

  if (editor.document === tracked || !isNuDocument(editor.document)) {
    return;
  }

  track(editor.document);
}

/** Re-parse the shown script once typing pauses. */
export function onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
  if (!panel || event.document !== tracked) {
    return;
  }

  clearTimeout(reparseTimer);
  reparseTimer = setTimeout(() => void refresh(), REPARSE_DELAY_MS);
}

/** Select the node around the editor's selection. */
export function onSelectionChanged(
  event: vscode.TextEditorSelectionChangeEvent,
): void {
  if (!panel || !ready || event.textEditor.document !== shown?.document) {
    return;
  }

  const selection = event.selections[0];
  if (revealed && selection.isEqual(revealed)) {
    return; // the page selected this itself
  }

  revealed = undefined;
  post({
    type: 'select',
    start: byteOffset(selection.start),
    end: byteOffset(selection.end),
  });
}

function documentFor(
  uri: vscode.Uri | undefined,
): vscode.TextDocument | undefined {
  if (uri) {
    return vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString(),
    );
  }

  const document = vscode.window.activeTextEditor?.document;
  return document && isNuDocument(document) ? document : undefined;
}

function createPanel(): vscode.WebviewPanel {
  const created = vscode.window.createWebviewPanel(
    'nuAst',
    'Nushell AST',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(assetDir())],
    },
  );

  created.webview.html = astPage(created.webview, 'ast-panel');

  created.webview.onDidReceiveMessage((message: PageMessage) => {
    switch (message.type) {
      case 'ready':
        ready = true;
        void refresh();
        break;
      case 'reveal':
        void reveal(message.start, message.end);
        break;
      case 'selected':
        updateGraphSelection(message.path, message.filters);
        break;
      case 'detach':
        void detachGraph();
        break;
    }
  });

  created.onDidDispose(() => {
    clearTimeout(reparseTimer);
    panel = undefined; // first: closing the graph window posts to it
    closeGraphWindow();
    ready = false;
    tracked = undefined;
    shown = undefined;
  });

  return created;
}

/** Move the graph out of the panel, into a window of its own. */
async function detachGraph(): Promise<void> {
  post({ type: 'detached', detached: true });
  await openGraphWindow(
    graphTitle(),
    (path) => post({ type: 'pick', path }),
    () => post({ type: 'detached', detached: false }),
  );
}

function graphTitle(): string {
  return tracked
    ? `AST Graph: ${path.basename(tracked.fileName)}`
    : 'Nushell AST Graph';
}

function track(document: vscode.TextDocument): void {
  tracked = document;
  if (panel) {
    panel.title = `AST: ${path.basename(document.fileName)}`;
  }
  setGraphTitle(graphTitle());

  void refresh();
}

async function refresh(): Promise<void> {
  const document = tracked;
  if (!panel || !ready || !document) {
    return;
  }

  const resolution = resolveNushell();
  if (resolution.kind !== 'found') {
    post({
      type: 'status',
      text: 'Nushell was not found, so the script cannot be parsed.',
    });
    return;
  }

  const run = ++generation;
  const source = document.getText();
  const cwd =
    document.uri.scheme === 'file'
      ? path.dirname(document.uri.fsPath) // so `use ./lib.nu` resolves
      : undefined;

  let message: PanelMessage;
  try {
    const parsed = await parseAst(resolution.path, source, cwd);
    const keep = shown?.document === document;
    message = { type: 'render', view: buildAst(parsed, source), keep };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    message = {
      type: 'status',
      text: `nu could not parse the script: ${reason}`,
    };
  }

  if (run !== generation || !panel) {
    return;
  }

  if (message.type === 'render') {
    shown = { document, source: Buffer.from(source, 'utf8') };
    updateGraphView(message.view);
  }

  post(message);
  if (message.type === 'render') {
    selectAtCursor(document);
  }
}

/** Start out on the node the cursor is in. */
function selectAtCursor(document: vscode.TextDocument): void {
  const editor = vscode.window.visibleTextEditors.find(
    (candidate) => candidate.document === document,
  );
  if (!editor) {
    return;
  }

  post({
    type: 'select',
    start: byteOffset(editor.selection.start),
    end: byteOffset(editor.selection.end),
  });
}

function post(message: PanelMessage): void {
  void panel?.webview.postMessage(message);
}

/** Select a node's source, given as byte offsets into the parsed text. */
async function reveal(start: number, end: number): Promise<void> {
  if (!shown) {
    return;
  }

  const { document } = shown;
  const range = new vscode.Range(position(start), position(end));
  revealed = range;

  const visible = vscode.window.visibleTextEditors.find(
    (editor) => editor.document === document,
  );
  const editor = await vscode.window.showTextDocument(document.uri, {
    viewColumn: visible?.viewColumn ?? vscode.ViewColumn.One,
    selection: range,
    preserveFocus: true, // keep the keyboard in the tree
  });
  editor.revealRange(
    range,
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
}

/** Byte offset into the parsed text -> editor position. */
function position(offset: number): vscode.Position {
  const { document, source } = shown!;
  return document.positionAt(
    source.subarray(0, offset).toString('utf8').length,
  );
}

/** Editor position -> byte offset into the parsed text. */
function byteOffset(at: vscode.Position): number {
  const { document } = shown!;
  const chars = document.offsetAt(at);
  return Buffer.byteLength(document.getText().slice(0, chars), 'utf8');
}
