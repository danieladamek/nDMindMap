/**
 * Left-to-right tidy tree layout over the `child-of` forest.
 *
 * Depth drives x (root on the left, children flow rightward); a post-order sweep
 * assigns each leaf its own row and centers every parent on its children — the
 * classic "tidy tree" arrangement, kept deliberately simple (no sibling-subtree
 * contour packing yet). Nodes the user has **pinned** (dragged by hand) keep
 * their own x/y and are skipped. Non-`child-of` edges are cross-links and don't
 * affect layout.
 */

import type { Graph, GraphNode } from "./model.js";

export interface LayoutOptions {
  originX?: number;
  originY?: number;
  xGap?: number; // horizontal distance between depth levels
  yGap?: number; // vertical distance between adjacent rows
}

const DEFAULTS = { originX: 60, originY: 40, xGap: 200, yGap: 64 };

/** True if the node was hand-placed and should be left where it is. */
export function isPinned(n: GraphNode): boolean {
  return n.attrs.pinned === true;
}

/**
 * Compute tidy-tree positions and write them into each unpinned node's x/y.
 * Returns the content bounds so the caller can size/scroll the canvas.
 */
export function layoutTree(graph: Graph, opts: LayoutOptions = {}): { width: number; height: number } {
  const o = { ...DEFAULTS, ...opts };
  let row = 0; // running leaf-row counter across the whole forest

  const place = (node: GraphNode, depth: number): number => {
    const x = o.originX + depth * o.xGap;
    const children = graph.childrenOf(node.id);

    let y: number;
    if (children.length === 0) {
      y = o.originY + row * o.yGap;
      row += 1;
    } else {
      const ys = children.map((c) => place(c, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2; // center parent on its children
    }

    if (!isPinned(node)) {
      node.x = x;
      node.y = y;
    }
    return isPinned(node) ? (node.y ?? y) : y;
  };

  for (const root of graph.roots()) place(root, 0);

  // Bounds over every node (pinned included) for canvas sizing.
  let maxX = 0;
  let maxY = 0;
  for (const n of graph.nodes.values()) {
    maxX = Math.max(maxX, n.x ?? 0);
    maxY = Math.max(maxY, n.y ?? 0);
  }
  return { width: maxX + o.originX + 160, height: maxY + o.originY + 40 };
}
