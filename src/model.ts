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

let counter = 0;
/** Small, dependency-free id generator. Stable within a session. */
export function newId(prefix = "n"): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}`;
}

export class Graph {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges = new Map<string, GraphEdge>();

  addNode(node: Partial<GraphNode> & { label: string }): GraphNode {
    const n: GraphNode = {
      id: node.id ?? newId("n"),
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
      id: edge.id ?? newId("e"),
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
}
