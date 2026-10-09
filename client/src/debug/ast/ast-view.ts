// What the AST panel (ast-panel.ts) exchanges with its tree page
// (webview/main.ts) and its graph window (webview/graph-main.ts).
// Types only, so the webview bundle can import it.

/** Nodes are syntax, tokens are source text, values are the rest (ids, flags). */
export type AstCategory = 'node' | 'token' | 'value';

export interface AstNode {
  kind: string;
  category: AstCategory;
  /** The field of the parent this sits in, e.g. `head` or `arguments[0]`. */
  property?: string;
  /** The nu type the parser inferred, for expressions. */
  type?: string;
  /** Byte offsets into the source. Absent for values and spanless nodes. */
  start?: number;
  end?: number;
  /** A token's text, a value, or the first line of a node's source. */
  text?: string;
  children: AstNode[];
}

/** The tree, and the parse error, if any. */
export interface AstView {
  root: AstNode;
  error?: AstNode;
}

/** Which children the tree shows, and so the graph too. */
export interface Filters {
  tokens: boolean;
  values: boolean;
}

/** Panel -> tree page. Offsets are bytes into the parsed source. */
export type PanelMessage =
  /** A new tree; `keep` when it is a re-parse of the same document, to keep folds. */
  | { type: 'render'; view: AstView; keep: boolean }
  /** No tree to show, and why. */
  | { type: 'status'; text: string }
  /** The editor selection moved: select the node around it. */
  | { type: 'select'; start: number; end: number }
  /** A node was clicked in the graph window: select it. */
  | { type: 'pick'; path: string }
  /** The graph is (no longer) in a window of its own. */
  | { type: 'detached'; detached: boolean };

/** Tree page -> panel. */
export type PageMessage =
  | { type: 'ready' }
  /** Select this byte range in the editor. */
  | { type: 'reveal'; start: number; end: number }
  /** The selection or filters changed; the graph window follows. */
  | { type: 'selected'; path: string; filters: Filters }
  /** Open the graph in a window of its own. */
  | { type: 'detach' };

/** Panel -> graph window. */
export type GraphMessage =
  | { type: 'render'; view: AstView }
  | { type: 'show'; path: string; filters: Filters };

/** Graph window -> panel. */
export type GraphPageMessage =
  | { type: 'ready' }
  | { type: 'pick'; path: string };
