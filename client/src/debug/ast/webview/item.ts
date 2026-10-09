import type { AstNode, Filters } from '../ast-view';

/** A node of the tree, with what the pages need to navigate it. */
export interface Item {
  node: AstNode;
  id: number;
  parent?: Item;
  depth: number;
  /** Stable across re-parses of the same document, and the same on both pages. */
  path: string;
  children: Item[];
}

/** Every node of the tree as an item, root first; `id` is the index. */
export function indexTree(root: AstNode): Item[] {
  const items: Item[] = [];
  const visit = (
    node: AstNode,
    parent: Item | undefined,
    depth: number,
    path: string,
  ): Item => {
    const item: Item = {
      node,
      id: items.length,
      parent,
      depth,
      path,
      children: [],
    };
    items.push(item);

    const seen = new Map<string, number>();
    for (const child of node.children) {
      const label = child.property ?? child.kind;
      const count = seen.get(label) ?? 0;
      seen.set(label, count + 1);
      const suffix = count > 0 ? `~${count}` : '';
      item.children.push(
        visit(child, item, depth + 1, `${path}/${label}${suffix}`),
      );
    }

    return item;
  };

  visit(root, undefined, 0, '');
  return items;
}

export function isShown(item: Item, filters: Filters): boolean {
  switch (item.node.category) {
    case 'token':
      return filters.tokens;
    case 'value':
      return filters.values;
    default:
      return true;
  }
}

export function shownChildren(item: Item, filters: Filters): Item[] {
  return item.children.filter((child) => isShown(child, filters));
}

/** `[start..end)` in bytes, or nothing for a spanless node. */
export function spanText(node: AstNode): string {
  return node.start === undefined ? '' : `[${node.start}..${node.end})`;
}

/** Whitespace a reader would otherwise miss, made visible. */
export function visibleText(text: string): string {
  return text.replace(/\r?\n/g, '⏎').replace(/\t/g, '⇥');
}
