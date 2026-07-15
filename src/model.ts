/**
 * nDMindMap graph model.
 *
 * The "nD" is the point: a node is not just a label at an (x, y) — it carries an
 * open bag of typed dimensions (attrs), and edges are *labeled relationships*
 * rather than plain parent/child links. That is what gives the mind map its
 * graph-DB character: you can traverse by relation, query by dimension, and let
 * the same idea belong to many contexts at once.
 *
 * This module is storage-agnostic. The in-memory `Graph` is the runtime object;
 * the on-disk source of truth is the human-readable format in `serialize.ts`.
 */

/** A scalar dimension value. Kept string|number|boolean so the format stays diffable. */
export type Scalar = string | number | boolean;

export interface GraphNode {
  id: string;
  label: string;
  /** Open-ended "dimensions" — domain, status, weight, tags, anything. */
  attrs: Record<string, Scalar>;
  /** Optional layout hint. Absent means "let the layout decide". */
  x?: number;
  y?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** The relationship type, e.g. "relates-to", "depends-on", "contradicts". */
  relation: string;
  attrs: Record<string, Scalar>;
}

/** The default relationship: an edge `[child] --child-of--> [parent]`. */
export const CHILD_OF = "child-of";

/**
 * A registered, first-class type in the document's schema — a node type or an
 * edge type promoted from a one-off. `attrs` carries the type's parameters; for
 * node types this may include default visual channels (color/shape) captured at
 * promotion and applied when the type is assigned to another node.
 */
export interface TypeDef {
  name: string;
  attrs: Record<string, Scalar>;
}

let counter = 0;
/** Small, dependency-free id generator. Stable within a session. */
export function newId(prefix = "n"): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}`;
}

export class Graph {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges = new Map<string, GraphEdge>();
  /** The schema registry — types promoted from one-offs (insertion-ordered). */
  readonly nodeTypes = new Map<string, TypeDef>();
  readonly edgeTypes = new Map<string, TypeDef>();

  /** Register (or update) a global node type. Returns the stored def. */
  registerNodeType(name: string, attrs: Record<string, Scalar> = {}): TypeDef {
    const t: TypeDef = { name, attrs: { ...attrs } };
    this.nodeTypes.set(name, t);
    return t;
  }

  /** Register (or update) a global edge type. Returns the stored def. */
  registerEdgeType(name: string, attrs: Record<string, Scalar> = {}): TypeDef {
    const t: TypeDef = { name, attrs: { ...attrs } };
    this.edgeTypes.set(name, t);
    return t;
  }

  /** Generate an id not already present in `existing`. Guards against the
   *  monotonic `newId` counter colliding with ids loaded from a file (e.g. a
   *  generated "nd" clobbering a user's node whose id is literally "nd"). An
   *  explicitly-supplied id is trusted as-is. */
  private freshId(explicit: string | undefined, prefix: string, existing: Map<string, unknown>): string {
    if (explicit !== undefined) return explicit;
    let id = newId(prefix);
    while (existing.has(id)) id = newId(prefix);
    return id;
  }

  addNode(node: Partial<GraphNode> & { label: string }): GraphNode {
    const n: GraphNode = {
      id: this.freshId(node.id, "n", this.nodes),
      label: node.label,
      attrs: node.attrs ?? {},
      x: node.x,
      y: node.y,
    };
    this.nodes.set(n.id, n);
    return n;
  }

  addEdge(edge: Partial<GraphEdge> & { source: string; target: string }): GraphEdge {
    if (!this.nodes.has(edge.source)) throw new Error(`unknown source node: ${edge.source}`);
    if (!this.nodes.has(edge.target)) throw new Error(`unknown target node: ${edge.target}`);
    const e: GraphEdge = {
      id: this.freshId(edge.id, "e", this.edges),
      source: edge.source,
      target: edge.target,
      relation: edge.relation ?? "relates-to",
      attrs: edge.attrs ?? {},
    };
    this.edges.set(e.id, e);
    return e;
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    for (const [eid, e] of this.edges) {
      if (e.source === id || e.target === id) this.edges.delete(eid);
    }
  }

  removeEdge(id: string): void {
    this.edges.delete(id);
  }

  /** All edges touching a node, in either direction. */
  incident(id: string): GraphEdge[] {
    return [...this.edges.values()].filter((e) => e.source === id || e.target === id);
  }

  /** Neighbours reachable from `id`, optionally filtered by relation. */
  neighbors(id: string, relation?: string): GraphNode[] {
    const out: GraphNode[] = [];
    for (const e of this.edges.values()) {
      if (relation && e.relation !== relation) continue;
      if (e.source === id) {
        const n = this.nodes.get(e.target);
        if (n) out.push(n);
      } else if (e.target === id) {
        const n = this.nodes.get(e.source);
        if (n) out.push(n);
      }
    }
    return out;
  }

  /** Find nodes whose attribute `key` equals `value`. A tiny query primitive. */
  where(key: string, value: Scalar): GraphNode[] {
    return [...this.nodes.values()].filter((n) => n.attrs[key] === value);
  }

  // --- Tree view over the `child-of` relation -------------------------------
  // The mind-map spine. `child-of` edges point child → parent, so a node's
  // parent is the target of its outgoing child-of edge, and its children are the
  // sources of incoming child-of edges.

  /** The parent node in the child-of tree, or null for a root. */
  parentOf(id: string): GraphNode | null {
    for (const e of this.edges.values()) {
      if (e.relation === CHILD_OF && e.source === id) return this.nodes.get(e.target) ?? null;
    }
    return null;
  }

  /** Direct children in the child-of tree (insertion order). */
  childrenOf(id: string): GraphNode[] {
    const out: GraphNode[] = [];
    for (const e of this.edges.values()) {
      if (e.relation === CHILD_OF && e.target === id) {
        const n = this.nodes.get(e.source);
        if (n) out.push(n);
      }
    }
    return out;
  }

  /** Nodes with no parent — the roots of the child-of forest. */
  roots(): GraphNode[] {
    return [...this.nodes.values()].filter((n) => this.parentOf(n.id) === null);
  }

  /** Attach `childId` under `parentId` via a child-of edge, moving it if it
   *  already had a parent. Returns the edge. Guards against cycles. */
  setParent(childId: string, parentId: string): GraphEdge {
    if (childId === parentId) throw new Error("a node cannot be its own parent");
    if (this.isDescendant(parentId, childId)) throw new Error("that move would create a cycle");
    for (const [eid, e] of this.edges) {
      if (e.relation === CHILD_OF && e.source === childId) this.edges.delete(eid);
    }
    return this.addEdge({ source: childId, target: parentId, relation: CHILD_OF });
  }

  /** Is `maybeDescendant` inside the subtree rooted at `ancestorId`? */
  isDescendant(maybeDescendant: string, ancestorId: string): boolean {
    let cur = this.parentOf(maybeDescendant);
    while (cur) {
      if (cur.id === ancestorId) return true;
      cur = this.parentOf(cur.id);
    }
    return false;
  }

  /** Remove a node and its entire child-of subtree. Returns removed ids. */
  removeSubtree(id: string): string[] {
    const removed: string[] = [];
    const walk = (nid: string) => {
      for (const c of this.childrenOf(nid)) walk(c.id);
      removed.push(nid);
      this.removeNode(nid);
    };
    walk(id);
    return removed;
  }
}
