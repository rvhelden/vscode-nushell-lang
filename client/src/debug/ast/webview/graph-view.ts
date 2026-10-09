// The side pane of the AST panel: the subtree under the selected node drawn as
// a top-down graph (with its parent above it), and the node's details.
//
// The subtree is cut off at a chosen depth and a total number of boxes; a node
// whose children were left out gets a `+N` box instead. Boxes are taken level
// by level, so a cut-off tree is shallow everywhere rather than deep on its
// left. Ctrl/Cmd+wheel zooms; until then, a wide tree is shrunk to fit.
// Holding Space over the graph and dragging pans it.

import { escapeHtml } from '../../shared/escape-html';
import type { AstNode } from '../ast-view';
import { Item, spanText, visibleText } from './item';

const PAD = 16;
/** Between siblings. */
const GAP_X = 10;
/** Between a parent's row and its children's. */
const GAP_Y = 36;
/** Labels longer than this are cut; the box's tooltip has the whole one. */
const MAX_LABEL = 24;
/** Most boxes drawn below the selection. */
const MAX_BOXES = 250;
/** Smallest automatic zoom; past this the pane scrolls instead. */
const MIN_FIT = 0.6;

const SIZE = {
  parent: { height: 24, font: 12 },
  main: { height: 36, font: 16 },
  child: { height: 26, font: 12 },
};

/** Depth choices; 0 is the whole subtree. */
export const DEPTHS = [1, 2, 3, 4, 6, 0];

const CATEGORY_NAMES = { node: 'Node', token: 'Token', value: 'Value' };

const measure = document.createElement('canvas').getContext('2d')!;

export interface GraphOptions {
  /** The children shown for an item: the tree's filters apply. */
  childrenOf(item: Item): Item[];
  /** Levels drawn below the selection; 0 for all. */
  depth: number;
  onSelect(item: Item): void;
  onDepth(depth: number): void;
}

interface Box {
  item?: Item;
  label: string;
  tooltip: string;
  category: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: number;
  children: Box[];
  /** The subtree's width, for laying out. */
  span: number;
}

/** A zoom the user chose with Ctrl/Cmd+wheel; undefined fits wide trees. */
let zoom: number | undefined;

/** Space is held: dragging the graph pans it (the cursor is a hand). */
let spaceHeld = false;

// Space is watched on the whole page, as the graph is redrawn on every
// selection. Captured, so the tree doesn't also fold on it.
window.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== ' ' || event.target instanceof HTMLSelectElement) {
      return;
    }

    if (!spaceHeld && !document.querySelector('.graph:hover')) {
      return; // Space elsewhere keeps its usual meaning
    }

    event.preventDefault(); // no page scroll, no fold
    event.stopPropagation();
    setPanMode(true);
  },
  true,
);
window.addEventListener('keyup', (event) => {
  if (event.key === ' ') {
    setPanMode(false);
  }
});
window.addEventListener('blur', () => setPanMode(false));

function setPanMode(on: boolean): void {
  spaceHeld = on;
  document.body.classList.toggle('pan-ready', on);
}

export function renderGraph(
  container: HTMLElement,
  item: Item,
  options: GraphOptions,
): void {
  const { node } = item;
  const shown = options.childrenOf(item).length;
  const depths = DEPTHS.map(
    (depth) =>
      `<option value="${depth}"${depth === options.depth ? ' selected' : ''}>${depth || 'all'}</option>`,
  );
  container.innerHTML =
    '<div class="side-head">' +
    `<button class="up" title="Select the parent"${item.parent ? '' : ' disabled'}>⌃</button>` +
    `<span class="title ${node.category}">${escapeHtml(node.kind)}</span>` +
    `<span class="dim">${CATEGORY_NAMES[node.category]}</span>` +
    '<span class="spacer"></span>' +
    `<label class="dim">Depth <select class="depth">${depths.join('')}</select></label>` +
    '<button class="fit" title="Fit to the pane (Ctrl/Cmd+wheel zooms, Space+drag pans)">⤢</button></div>' +
    '<div class="graph"></div>' +
    `<dl class="details">${details(item, shown)}</dl>`;

  const graph = container.querySelector<HTMLElement>('.graph')!;
  const { boxes, main, width, height } = layout(item, options);
  graph.innerHTML = svg(boxes, main, width, height);
  const drawing = graph.querySelector('svg')!;

  const scaleNow = () => drawing.width.baseVal.value / width;
  const resize = (scale: number) => {
    drawing.setAttribute('width', String(width * scale));
    drawing.setAttribute('height', String(height * scale));
  };

  /** Fit (or the chosen zoom), centered on the selected node. */
  const apply = () => {
    const fit = Math.min(1, Math.max(MIN_FIT, graph.clientWidth / width));
    const scale = zoom ?? fit;
    resize(scale);
    graph.scrollLeft =
      (main.x + main.width / 2) * scale - graph.clientWidth / 2;
  };
  apply();

  // Ctrl/Cmd+wheel zooms around the pointer
  graph.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      const before = scaleNow();
      zoom = Math.min(2, Math.max(0.2, before * Math.exp(-event.deltaY / 300)));
      const bounds = graph.getBoundingClientRect();
      const offsetX = event.clientX - bounds.left;
      const offsetY = event.clientY - bounds.top;
      const pointX = (graph.scrollLeft + offsetX) / before;
      const pointY = (graph.scrollTop + offsetY) / before;
      resize(zoom);
      graph.scrollLeft = pointX * zoom - offsetX;
      graph.scrollTop = pointY * zoom - offsetY;
    },
    { passive: false },
  );

  enablePanning(graph);

  for (const element of graph.querySelectorAll<SVGElement>('[data-index]')) {
    const target = boxes[Number(element.dataset.index)].item;
    if (target && target !== item) {
      element.addEventListener('click', () => options.onSelect(target));
    }
  }

  container.querySelector('.up')!.addEventListener('click', () => {
    if (item.parent) {
      options.onSelect(item.parent);
    }
  });
  container.querySelector('.fit')!.addEventListener('click', () => {
    zoom = undefined;
    apply();
  });
  container
    .querySelector<HTMLSelectElement>('.depth')!
    .addEventListener('change', (event) =>
      options.onDepth(Number((event.target as HTMLSelectElement).value)),
    );
}

/** Space+drag moves the viewport; the click ending a drag selects nothing. */
function enablePanning(graph: HTMLElement): void {
  let dragged = false;

  graph.addEventListener('pointerdown', (event) => {
    if (!spaceHeld || event.button !== 0) {
      return;
    }

    event.preventDefault();
    graph.setPointerCapture(event.pointerId);
    document.body.classList.add('panning');
    dragged = false;
    const start = {
      x: event.clientX,
      y: event.clientY,
      left: graph.scrollLeft,
      top: graph.scrollTop,
    };

    const move = (moved: PointerEvent) => {
      dragged = true;
      graph.scrollLeft = start.left - (moved.clientX - start.x);
      graph.scrollTop = start.top - (moved.clientY - start.y);
    };
    const end = () => {
      graph.removeEventListener('pointermove', move);
      graph.removeEventListener('pointerup', end);
      graph.removeEventListener('pointercancel', end);
      document.body.classList.remove('panning');
    };
    graph.addEventListener('pointermove', move);
    graph.addEventListener('pointerup', end);
    graph.addEventListener('pointercancel', end);
  });

  graph.addEventListener(
    'click',
    (event) => {
      if (dragged || spaceHeld) {
        event.stopPropagation(); // panning, not selecting a node
      }
      dragged = false;
    },
    true,
  );
}

function layout(
  item: Item,
  options: GraphOptions,
): { boxes: Box[]; main: Box; width: number; height: number } {
  const main = box(item, SIZE.main);
  const boxes: Box[] = [main];

  // Level by level, so a cut-off tree is cut evenly
  let level = [main];
  let depth = 0;
  while (level.length > 0 && (options.depth === 0 || depth < options.depth)) {
    const next: Box[] = [];
    for (const parent of level) {
      const children = options.childrenOf(parent.item!);
      const room = MAX_BOXES - (boxes.length - 1);
      const taken = children.slice(0, Math.max(0, room));
      for (const child of taken) {
        const childBox = box(child, SIZE.child);
        parent.children.push(childBox);
        boxes.push(childBox);
        next.push(childBox);
      }

      addMore(parent, children.length - taken.length, boxes);
    }

    level = next;
    depth++;
  }

  // The deepest drawn level: say what is below it
  for (const parent of level) {
    addMore(parent, options.childrenOf(parent.item!).length, boxes);
  }

  let top = PAD;
  let parentBox: Box | undefined;
  if (item.parent) {
    parentBox = box(item.parent, SIZE.parent);
    parentBox.y = top;
    top += SIZE.parent.height + GAP_Y;
  }

  measureSpan(main);
  place(main, PAD, top);
  if (parentBox) {
    parentBox.x = main.x + main.width / 2 - parentBox.width / 2;
    boxes.push(parentBox);
  }

  const width = Math.max(...boxes.map((b) => b.x + b.width)) + PAD;
  const height = Math.max(...boxes.map((b) => b.y + b.height)) + PAD;
  return { boxes, main, width, height };
}

/** A `+N` box for children that were left out. */
function addMore(parent: Box, hidden: number, boxes: Box[]): void {
  if (hidden <= 0) {
    return;
  }

  const more = textBox(`+${hidden}`, SIZE.child);
  more.tooltip = `${hidden} more: select ${parent.label} to see them`;
  parent.children.push(more);
  boxes.push(more);
}

/** How wide each subtree is: its own box, or its children side by side. */
function measureSpan(b: Box): number {
  const children =
    b.children.reduce((sum, child) => sum + measureSpan(child), 0) +
    GAP_X * Math.max(0, b.children.length - 1);
  b.span = Math.max(b.width, children);
  return b.span;
}

/** Children left to right under their parent; the parent centered over them. */
function place(b: Box, left: number, y: number): void {
  b.y = y;
  if (b.children.length === 0) {
    b.x = left + (b.span - b.width) / 2;
    return;
  }

  const total =
    b.children.reduce((sum, child) => sum + child.span, 0) +
    GAP_X * (b.children.length - 1);
  let x = left + (b.span - total) / 2;
  const below = y + b.height + GAP_Y;
  for (const child of b.children) {
    place(child, x, below);
    x += child.span + GAP_X;
  }

  const first = b.children[0];
  const last = b.children[b.children.length - 1];
  const center = (first.x + first.width / 2 + last.x + last.width / 2) / 2;
  b.x = center - b.width / 2;
}

function box(item: Item, size: { height: number; font: number }): Box {
  const full = label(item.node);
  const shown =
    full.length > MAX_LABEL ? `${full.slice(0, MAX_LABEL - 1)}…` : full;
  return {
    ...textBox(shown, size),
    item,
    tooltip: `${item.node.kind} ${spanText(item.node)}\n${full}`,
    category: item.node.category,
  };
}

function textBox(text: string, size: { height: number; font: number }): Box {
  measure.font = `${size.font}px ${getComputedStyle(document.body).fontFamily}`;
  return {
    label: text,
    tooltip: text,
    category: 'more',
    x: 0,
    y: 0,
    width: Math.ceil(measure.measureText(text).width) + 18,
    height: size.height,
    font: size.font,
    children: [],
    span: 0,
  };
}

/** What a box says: a node's kind, a token's text, a value's name and value. */
function label(node: AstNode): string {
  switch (node.category) {
    case 'token':
      return visibleText(node.text || node.kind);
    case 'value':
      return `${node.kind} = ${node.text ?? ''}`;
    default:
      return node.kind;
  }
}

function svg(boxes: Box[], main: Box, width: number, height: number): string {
  const edges: string[] = [];
  for (const parent of boxes) {
    for (const child of parent.children) {
      edges.push(edge(parent, child));
    }
  }

  const parentBox = boxes.find((b) => b.item && b.item === main.item?.parent);
  if (parentBox) {
    edges.push(edge(parentBox, main));
  }

  const shapes = boxes.map(
    (b, index) =>
      `<g class="box ${b.category}${b === main ? ' main' : ''}"${b.item ? ` data-index="${index}"` : ''}>` +
      `<title>${escapeHtml(b.tooltip)}</title>` +
      `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="5"/>` +
      `<text x="${b.x + b.width / 2}" y="${b.y + b.height / 2}" font-size="${b.font}">${escapeHtml(b.label)}</text></g>`,
  );

  return (
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">` +
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
    '<path d="M0,0 L10,5 L0,10 z"/></marker></defs>' +
    `${edges.join('')}${shapes.join('')}</svg>`
  );
}

/** A curve from the bottom of `from` to the top of `to`. */
function edge(from: Box, to: Box): string {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height;
  const x2 = to.x + to.width / 2;
  const y2 = to.y;
  const middle = (y1 + y2) / 2;
  return `<path class="edge" d="M${x1},${y1} C${x1},${middle} ${x2},${middle} ${x2},${y2}" marker-end="url(#arrow)"/>`;
}

function details(item: Item, shownChildren: number): string {
  const { node } = item;
  const total = node.children.length;
  const rows: [string, string][] = [
    ['Kind', node.kind],
    ['Property', node.property ?? ''],
    ['Type', node.type ?? ''],
    ['Span', spanText(node)],
    ['Children', total ? `${shownChildren} shown of ${total}` : ''],
    ['Text', node.text ?? ''],
  ];
  return rows
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `<dt>${name}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');
}
