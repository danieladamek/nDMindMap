/**
 * Emergent schema view (Phase 3.3) — "it has become a schema" made visible.
 *
 * A mind map, once nodes carry types/levels and edges carry semantics, *implies*
 * a schema: which kinds of node exist, what dimensions they carry, and — the
 * graph-DB part — the **domain -> range** shape of each relation (which node
 * types it actually connects, source-kind -> target-kind). This module derives
 * that structure from the sketch. It reads only; nothing here mutates the graph.
 *
 * "Kind" is a node's `type` when present, else its abstraction `level`, else
 * `(untyped)` — so the schema stays legible whether the user has been typing
 * nodes, tagging levels, or both. That mirrors how the promotion -> typing ramp
 * is meant to fill in gradually.
 */

import type { Graph, GraphNode } from "./model.js";
import { nodeType, customAttrs } from "./visuals.js";
import { nodeLevel } from "./semantics.js";

export const UNTYPED = "(untyped)";

/** A node's schema "kind": its type, else its level, else "(untyped)". */
export function nodeKind(n: GraphNode): string {
  return nodeType(n) || nodeLevel(n) || UNTYPED;
}

export interface NodeKindSchema {
  kind: string;
  count: number;
  /** Union of free-form dimension keys observed on instances of this kind. */
  dimensions: string[];
  /** Whether the kind came from a node `type` (vs. a level or untyped). */
  fromType: boolean;
}

export interface EdgePattern {
  relation: string;
  domain: string; // source kind
  range: string; // target kind
  count: number;
}

export interface GraphSchema {
  kinds: NodeKindSchema[];
  patterns: EdgePattern[];
}

/** Derive the emergent schema — node kinds + edge domain/range patterns. */
export function deriveSchema(graph: Graph): GraphSchema {
  // Node kinds, insertion-ordered by first appearance.
  const kinds = new Map<string, { count: number; dims: Set<string>; fromType: boolean }>();
  for (const n of graph.nodes.values()) {
    const kind = nodeKind(n);
    let entry = kinds.get(kind);
    if (!entry) {
      entry = { count: 0, dims: new Set(), fromType: nodeType(n) !== "" };
      kinds.set(kind, entry);
    }
    entry.count += 1;
    for (const [k] of customAttrs(n)) entry.dims.add(k);
  }

  // Edge patterns keyed by (relation, domain, range).
  const patterns = new Map<string, EdgePattern>();
  for (const e of graph.edges.values()) {
    const src = graph.nodes.get(e.source);
    const tgt = graph.nodes.get(e.target);
    if (!src || !tgt) continue;
    const domain = nodeKind(src);
    const range = nodeKind(tgt);
    const key = JSON.stringify([e.relation, domain, range]);
    const p = patterns.get(key);
    if (p) p.count += 1;
    else patterns.set(key, { relation: e.relation, domain, range, count: 1 });
  }

  return {
    kinds: [...kinds].map(([kind, v]) => ({ kind, count: v.count, dimensions: [...v.dims], fromType: v.fromType })),
    patterns: [...patterns.values()].sort(
      (a, b) => a.relation.localeCompare(b.relation) || b.count - a.count,
    ),
  };
}
