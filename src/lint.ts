/**
 * Category-error lint (Phase 3.2) — tool-level "lint," not a backend reasoner.
 *
 * Rule 1 — **proxy-as-identity / level-crossing collapse.** An edge whose
 * semantics claim *identity* (`is-a`: both ends on the same abstraction level)
 * but whose ends actually sit on *different* levels has collapsed a level
 * crossing into an identity. That is the DSM-style error from REQUIREMENTS §4:
 * wiring a *proxy* / *measure* as if it were the thing itself.
 *
 * The lint reads the level rules declared in `semantics.ts`, so adding a new
 * `same`-level relation to the vocabulary extends the rule for free. It never
 * mutates the graph — it only reports.
 */

import type { Graph, GraphEdge } from "./model.js";
import { semanticsOf, nodeLevel } from "./semantics.js";

export interface LintWarning {
  edgeId: string;
  rule: "level-crossing-collapse";
  message: string;
  /** A relation that would make the edge honest (crosses levels). */
  suggestion: string;
}

/** Evaluate one edge. Returns a warning, or null if it's clean / not applicable. */
export function lintEdge(graph: Graph, edge: GraphEdge): LintWarning | null {
  const sem = semanticsOf(edge.relation);
  if (!sem || sem.levels !== "same") return null; // only identity-claiming relations
  const src = graph.nodes.get(edge.source);
  const tgt = graph.nodes.get(edge.target);
  if (!src || !tgt) return null;
  const sl = nodeLevel(src);
  const tl = nodeLevel(tgt);
  if (!sl || !tl || sl === tl) return null; // need two *different* stated levels
  return {
    edgeId: edge.id,
    rule: "level-crossing-collapse",
    message:
      `Level-crossing collapse: "${src.label || src.id}" (${sl}) is wired as ` +
      `identical to "${tgt.label || tgt.id}" (${tl}) — but those are different ` +
      `abstraction levels. If one is an honest stand-in for the other, say ` +
      `proxy-for or measured-by, not ${edge.relation}.`,
    suggestion: "proxy-for",
  };
}

/** Scan the whole graph for category errors. */
export function lintGraph(graph: Graph): LintWarning[] {
  const out: LintWarning[] = [];
  for (const e of graph.edges.values()) {
    const w = lintEdge(graph, e);
    if (w) out.push(w);
  }
  return out;
}
