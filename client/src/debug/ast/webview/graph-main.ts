// Webview client for the AST graph window: the graph pane of the AST panel,
// in a window of its own. Bundled by esbuild into ast-graph.webview.js. The
// tree page owns the selection: this draws what it is told to show, and a
// click here is sent back as a pick for the tree page to select.

import type { Filters, GraphMessage, GraphPageMessage } from '../ast-view';
import { DEPTHS, renderGraph } from './graph-view';
import { indexTree, Item, shownChildren } from './item';

interface VsCodeApi {
  postMessage(message: GraphPageMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const state = { depth: 3, ...(vscode.getState() as { depth?: number }) };
const side = document.getElementById('side')!;

let items: Item[] = [];
let shown: { path: string; filters: Filters } | undefined;

window.addEventListener('message', ({ data }: MessageEvent<GraphMessage>) => {
  switch (data.type) {
    case 'render':
      items = indexTree(data.view.root);
      break;
    case 'show':
      shown = { path: data.path, filters: data.filters };
      break;
  }

  draw();
});

// The graph is laid out for the window's size
window.addEventListener('resize', () => draw());

vscode.postMessage({ type: 'ready' });

function draw(): void {
  const item =
    items.find((candidate) => candidate.path === shown?.path) ?? items[0];
  if (!item) {
    return;
  }

  const filters = shown?.filters ?? { tokens: true, values: false };
  renderGraph(side, item, {
    childrenOf: (parent) => shownChildren(parent, filters),
    depth: DEPTHS.includes(state.depth) ? state.depth : 3,
    onSelect: (target) =>
      vscode.postMessage({ type: 'pick', path: target.path }),
    onDepth: (depth) => {
      state.depth = depth;
      vscode.setState(state);
      draw();
    },
  });
}
