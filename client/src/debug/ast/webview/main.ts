// Webview client for the Nushell AST panel. Bundled by esbuild into
// ast-panel.webview.js. The panel (ast-panel.ts) posts the tree as messages;
// this draws it as a tree table plus a graph of the selected node, and keeps
// the selection in step with the editor's. The graph sits beside or below the
// tree, or in a window of its own (graph-main.ts); this page owns the
// selection either way and tells the panel, which tells that window.

import { escapeHtml } from '../../shared/escape-html';
import type { AstNode, PageMessage, PanelMessage } from '../ast-view';
import { DEPTHS, renderGraph } from './graph-view';
import {
  indexTree,
  isShown,
  Item,
  shownChildren,
  spanText,
  visibleText,
} from './item';

interface VsCodeApi {
  postMessage(message: PageMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/** Rows this shallow start expanded. */
const OPEN_DEPTH = 3;

/** What the user chose, kept for as long as the panel is open. */
interface Settings {
  tokens: boolean;
  values: boolean;
  /** Where the graph goes: beside the tree or below it. */
  layout: 'side' | 'below';
  /** The tree's share of the width (or height, below). */
  split: number;
  /** Levels the graph draws below the selection; 0 for all. */
  depth: number;
}

const vscode = acquireVsCodeApi();
const settings: Settings = {
  tokens: true,
  values: false,
  layout: 'side',
  split: 0.6,
  depth: 3,
  ...(vscode.getState() as Partial<Settings> | undefined),
};

const main = element('main');
const tree = element('tree');
const rowsBody = element('rows');
const side = element('side');
const errorBar = element('error');
const status = element('status');
const tokensBox = element('show-tokens') as HTMLInputElement;
const valuesBox = element('show-values') as HTMLInputElement;

let items: Item[] = [];
let root: Item | undefined;
let errorNode: AstNode | undefined;
/** Folds the user chose, by path; anything else uses OPEN_DEPTH. */
const folds = new Map<string, boolean>();
let rows: Item[] = [];
let selected: Item | undefined;
/** The graph is in a window of its own, so this page doesn't draw it. */
let detached = false;

tokensBox.checked = settings.tokens;
valuesBox.checked = settings.values;
applyLayout();

window.addEventListener('message', ({ data }: MessageEvent<PanelMessage>) => {
  switch (data.type) {
    case 'render':
      load(data.view.root, data.view.error, data.keep);
      break;
    case 'status':
      showStatus(data.text);
      break;
    case 'select':
      follow(data.start, data.end);
      break;
    case 'pick': {
      const item = items.find((candidate) => candidate.path === data.path);
      if (item) {
        revealInTree(item);
      }
      break;
    }
    case 'detached':
      detached = data.detached;
      applyLayout();
      if (selected ?? root) {
        drawSide(selected ?? root!);
      }
      break;
  }
});

tokensBox.addEventListener('change', () => {
  settings.tokens = tokensBox.checked;
  saveSettings();
  refilter();
});

valuesBox.addEventListener('change', () => {
  settings.values = valuesBox.checked;
  saveSettings();
  refilter();
});

element('layout').addEventListener('click', () => {
  settings.layout = settings.layout === 'side' ? 'below' : 'side';
  saveSettings();
  applyLayout();
  if (selected ?? root) {
    drawSide(selected ?? root!); // laid out for the pane's new size
  }
});
element('detach').addEventListener('click', () =>
  vscode.postMessage({ type: 'detach' }),
);
element('expand-all').addEventListener('click', () => foldAll(true));
element('collapse-all').addEventListener('click', () => foldAll(false));

errorBar.addEventListener('click', () => {
  const span = errorNode && firstSpan(errorNode);
  if (span) {
    vscode.postMessage({ type: 'reveal', start: span.start!, end: span.end! });
  }
});

rowsBody.addEventListener('click', (event) => {
  const item = itemAt(event.target);
  if (!item) {
    return;
  }

  if ((event.target as HTMLElement).classList.contains('twisty')) {
    toggle(item);
    return;
  }

  select(item, { reveal: true });
});

rowsBody.addEventListener('dblclick', (event) => {
  const item = itemAt(event.target);
  if (item) {
    toggle(item);
  }
});

tree.addEventListener('keydown', (event) => {
  if (!selected) {
    return;
  }

  const index = rows.indexOf(selected);
  const kids = visibleChildren(selected);
  let next: Item | undefined;
  switch (event.key) {
    case 'ArrowDown':
      next = rows[index + 1];
      break;
    case 'ArrowUp':
      next = rows[index - 1];
      break;
    case 'Home':
      next = rows[0];
      break;
    case 'End':
      next = rows[rows.length - 1];
      break;
    case 'ArrowRight':
      if (kids.length > 0 && !isOpen(selected)) {
        toggle(selected);
      } else {
        next = kids[0];
      }
      break;
    case 'ArrowLeft':
      if (kids.length > 0 && isOpen(selected)) {
        toggle(selected);
      } else {
        next = selected.parent;
      }
      break;
    case 'Enter':
    case ' ':
      toggle(selected);
      break;
    default:
      return;
  }

  event.preventDefault();
  if (next) {
    select(next, { reveal: true, scroll: true });
  }
});

element('splitter').addEventListener('pointerdown', (event) => {
  const splitter = event.currentTarget as HTMLElement;
  splitter.setPointerCapture(event.pointerId);
  const move = (moved: PointerEvent) => {
    const bounds = main.getBoundingClientRect();
    const share =
      settings.layout === 'side'
        ? (moved.clientX - bounds.left) / bounds.width
        : (moved.clientY - bounds.top) / bounds.height;
    settings.split = Math.min(0.85, Math.max(0.15, share));
    applyLayout();
  };
  splitter.addEventListener('pointermove', move);
  splitter.addEventListener(
    'pointerup',
    () => {
      splitter.removeEventListener('pointermove', move);
      saveSettings();
      if (selected) {
        drawSide(selected); // the graph is laid out for the pane's width
      }
    },
    { once: true },
  );
});

// The graph is laid out for the pane's size
window.addEventListener('resize', () => {
  if (selected ?? root) {
    drawSide(selected ?? root!);
  }
});

vscode.postMessage({ type: 'ready' });

function load(node: AstNode, error: AstNode | undefined, keep: boolean): void {
  const previous = selected?.path;
  if (!keep) {
    folds.clear();
  }

  items = indexTree(node);
  root = items[0];
  errorNode = error;
  status.hidden = true;
  main.hidden = false;
  errorBar.hidden = !error;
  errorBar.textContent = error ? `⚠ Parse error: ${describe(error)}` : '';

  selected = keep ? items.find((item) => item.path === previous) : undefined;
  renderRows();
  drawSide(selected ?? root);
}

function showStatus(text: string): void {
  status.textContent = text;
  status.hidden = false;
  main.hidden = true;
  errorBar.hidden = true;
}

function isVisible(item: Item): boolean {
  return isShown(item, settings);
}

function visibleChildren(item: Item): Item[] {
  return shownChildren(item, settings);
}

function isOpen(item: Item): boolean {
  return folds.get(item.path) ?? item.depth < OPEN_DEPTH;
}

function toggle(item: Item): void {
  if (visibleChildren(item).length === 0) {
    return;
  }

  folds.set(item.path, !isOpen(item));
  if (!isOpen(item) && selected && isAncestor(item, selected)) {
    selected = item; // don't leave the selection inside a folded node
  }

  renderRows();
  drawSide(selected ?? item);
}

function foldAll(open: boolean): void {
  for (const item of items) {
    if (item.children.length > 0) {
      folds.set(item.path, open);
    }
  }

  if (!open && selected) {
    selected = root;
  }

  renderRows();
  if (selected) {
    drawSide(selected);
  }
}

/** A filter changed: keep the selection on something still shown. */
function refilter(): void {
  while (selected && !isVisible(selected)) {
    selected = selected.parent;
  }

  renderRows();
  drawSide(selected ?? root!);
}

function renderRows(): void {
  rows = [];
  if (root) {
    collectRows(root);
  }

  rowsBody.innerHTML = rows.map(rowHtml).join('');
  markSelected();
}

function collectRows(item: Item): void {
  rows.push(item);
  if (!isOpen(item)) {
    return;
  }

  for (const child of visibleChildren(item)) {
    collectRows(child);
  }
}

function rowHtml(item: Item): string {
  const { node } = item;
  const kids = visibleChildren(item).length > 0;
  const twisty = kids ? (isOpen(item) ? '▾' : '▸') : '';
  const indent = item.depth * 14 + 4;
  return (
    `<tr data-id="${item.id}">` +
    `<td class="kind ${node.category}" style="padding-left:${indent}px">` +
    `<span class="twisty">${twisty}</span>${escapeHtml(node.kind)}</td>` +
    `<td>${escapeHtml(node.property ?? '')}</td>` +
    `<td class="dim">${escapeHtml(node.type ?? '')}</td>` +
    `<td class="dim">${spanText(node)}</td>` +
    `<td class="text">${escapeHtml(visibleText(node.text ?? ''))}</td></tr>`
  );
}

function select(
  item: Item,
  options: { reveal?: boolean; scroll?: boolean } = {},
): void {
  selected = item;
  markSelected();
  drawSide(item);

  if (options.scroll) {
    rowsBody
      .querySelector(`tr[data-id="${item.id}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  const { start, end } = item.node;
  if (options.reveal && start !== undefined && end !== undefined) {
    vscode.postMessage({ type: 'reveal', start, end });
  }
}

function markSelected(): void {
  rowsBody.querySelector('tr.selected')?.classList.remove('selected');
  if (selected) {
    rowsBody
      .querySelector(`tr[data-id="${selected.id}"]`)
      ?.classList.add('selected');
  }
}

/** Draw the graph of `item`, here or in the graph window. */
function drawSide(item: Item): void {
  vscode.postMessage({
    type: 'selected',
    path: item.path,
    filters: { tokens: settings.tokens, values: settings.values },
  });
  if (detached) {
    return;
  }

  renderGraph(side, item, {
    childrenOf: visibleChildren,
    depth: DEPTHS.includes(settings.depth) ? settings.depth : 3,
    onSelect: revealInTree,
    onDepth: (depth) => {
      settings.depth = depth;
      saveSettings();
      drawSide(item);
    },
  });
}

/** Select an item from the graph: unfold the tree down to it first. */
function revealInTree(item: Item): void {
  if (unfoldTo(item)) {
    renderRows();
  }

  select(item, { reveal: true, scroll: true });
}

/** The editor selection moved: select the deepest shown node around it. */
function follow(start: number, end: number): void {
  if (!root) {
    return;
  }

  let found = root;
  for (;;) {
    const around = visibleChildren(found).filter((child) =>
      contains(child.node, start, end),
    );
    // At a token boundary the cursor touches two; prefer the one it is in
    const next = around.find((child) => start < child.node.end!) ?? around[0];
    if (!next) {
      break;
    }

    found = next;
  }

  if (found === selected) {
    return;
  }

  if (unfoldTo(found)) {
    renderRows();
  }

  select(found, { scroll: true });
}

function contains(node: AstNode, start: number, end: number): boolean {
  return (
    node.start !== undefined &&
    node.end !== undefined &&
    node.start <= start &&
    end <= node.end
  );
}

/** Open every fold above `item`; true when anything changed. */
function unfoldTo(item: Item): boolean {
  let changed = false;
  for (let parent = item.parent; parent; parent = parent.parent) {
    if (!isOpen(parent)) {
      folds.set(parent.path, true);
      changed = true;
    }
  }

  return changed;
}

function isAncestor(ancestor: Item, item: Item): boolean {
  for (let parent = item.parent; parent; parent = parent.parent) {
    if (parent === ancestor) {
      return true;
    }
  }

  return false;
}

function itemAt(target: EventTarget | null): Item | undefined {
  const row = (target as HTMLElement | null)?.closest('tr');
  return row ? items[Number(row.dataset.id)] : undefined;
}

function firstSpan(node: AstNode): AstNode | undefined {
  if (node.start !== undefined) {
    return node;
  }

  for (const child of node.children) {
    const found = firstSpan(child);
    if (found) {
      return found;
    }
  }

  return undefined;
}

/** `Unclosed: ) — Add a matching …`: the variant and its text values. */
function describe(error: AstNode): string {
  const texts = error.children
    .filter((child) => child.category === 'value')
    .map((child) => child.text);
  return [error.kind, ...texts].join(' — ');
}

function applyLayout(): void {
  main.style.setProperty('--split', `${settings.split * 100}%`);
  main.classList.toggle('below', settings.layout === 'below');
  main.classList.toggle('detached', detached);
  element('layout').textContent = settings.layout === 'side' ? '⬓' : '◫';
  element('layout').title =
    settings.layout === 'side'
      ? 'Show the graph below the tree'
      : 'Show the graph beside the tree';
  element('layout').hidden = detached;
  element('detach').hidden = detached;
}

function saveSettings(): void {
  vscode.setState(settings);
}

function element(id: string): HTMLElement {
  return document.getElementById(id)!;
}
