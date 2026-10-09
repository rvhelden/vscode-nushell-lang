import * as vscode from 'vscode';

import { assetDir, assetPath } from '../shared/assets';
import { makeNonce, renderTemplate } from '../shared/html';
import { AstView, Filters, GraphMessage, GraphPageMessage } from './ast-view';

// The AST panel's graph in a VS Code window of its own. It has no state of its
// own: the panel hands it the tree and the tree page's selection, and passes
// a click on a node back to the tree page. The page is ast-graph.html with
// ast-graph.webview.js, both in out/debug/.

let panel: vscode.WebviewPanel | undefined;
let ready = false;
/** The latest of each, for a window that opens (or loads) after they came. */
let view: AstView | undefined;
let selection: { path: string; filters: Filters } | undefined;

/** Open the window, or bring it back. `onPick` gets the path of a clicked node. */
export async function openGraphWindow(
  title: string,
  onPick: (path: string) => void,
  onClose: () => void,
): Promise<void> {
  if (panel) {
    panel.reveal();
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'nuAstGraph',
    title,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(assetDir())],
    },
  );
  panel.webview.html = astPage(panel.webview, 'ast-graph');

  panel.webview.onDidReceiveMessage((message: GraphPageMessage) => {
    switch (message.type) {
      case 'ready':
        ready = true;
        if (view) {
          post({ type: 'render', view });
        }
        if (selection) {
          post({ type: 'show', ...selection });
        }
        break;
      case 'pick':
        onPick(message.path);
        break;
    }
  });

  panel.onDidDispose(() => {
    panel = undefined;
    ready = false;
    onClose();
  });

  // The new panel is the active editor: move it out
  try {
    await vscode.commands.executeCommand(
      'workbench.action.moveEditorToNewWindow',
    );
  } catch {
    // no auxiliary windows here (e.g. VS Code for the Web): it stays beside
  }
}

export function closeGraphWindow(): void {
  panel?.dispose();
  view = undefined;
  selection = undefined;
}

export function setGraphTitle(title: string): void {
  if (panel) {
    panel.title = title;
  }
}

export function updateGraphView(next: AstView): void {
  view = next;
  post({ type: 'render', view });
}

export function updateGraphSelection(path: string, filters: Filters): void {
  selection = { path, filters };
  post({ type: 'show', ...selection });
}

function post(message: GraphMessage): void {
  if (panel && ready) {
    void panel.webview.postMessage(message);
  }
}

/**
 * One of the AST pages (`ast-panel` or `ast-graph`): its .html template with
 * its bundled script and the stylesheet both share.
 */
export function astPage(webview: vscode.Webview, page: string): string {
  const uri = (file: string) =>
    webview.asWebviewUri(vscode.Uri.file(assetPath(file))).toString();
  return renderTemplate(assetPath(`${page}.html`), {
    nonce: makeNonce(),
    cspSource: webview.cspSource,
    script: uri(`${page}.webview.js`),
    css: uri('ast-graph.css'),
  });
}
