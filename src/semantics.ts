/**
 * Abstraction levels + the edge-semantics vocabulary (Phase 3.1).
 *
 * The interrogation payoff rests on two dimensions being explicit:
 *
 *   - every node can carry a **kind / abstraction level** (`level` — a reserved
 *     attribute key, like `type`): subjective experience, biomarker, diagnostic
 *     construct, molecular entity, … The vocabulary below is *suggestions*, not
 *     a schema — levels stay open-ended, users type anything.
 *
 *   - edges get **honest semantics**: `is-a` is not `proxy-for` is not
 *     `measured-by`. Each semantic relation declares its **level rule** — whether
 *     its two ends should live on the same abstraction level, are expected to
 *     cross levels, or make no level claim. The category-error lint (P3.2) reads
 *     these rules: a *proxy wired as an identity* is exactly an `is-a`/identity
 *     edge whose ends sit on different levels.
 *
 * Worked example (from REQUIREMENTS §4): self-reported *pleasure* (subjective
 * experience) ≠ a *dopamine* increase (biomarker); they relate as `proxy-for`,
 * not identity. The DSM does this collapse wholesale.
 */

import type { GraphNode } from "./model.js";

/** Suggested abstraction levels, ordered experiential → physical. Open-ended. */
export const SUGGESTED_LEVELS: string[] = [
  "subjective-experience",
  "diagnostic-construct",
  "behavior",
  "biomarker",
  "molecular-entity",
];

/** What a semantic relation claims about the levels of its two ends. */
export type LevelRule =
  | "same" // both ends should live on one abstraction level (identity-ish)
  | "crossing" // honestly bridges levels (a measure standing in for the thing)
  | "any"; // makes no level claim

export interface EdgeSemantic {
  name: string;
  /** One-line meaning, shown as a hint in the edge editor. */
  hint: string;
  levels: LevelRule;
}

/** The honest-semantics vocabulary. Suggestions in the editor; the level rules
 *  feed the category-error lint. */
export const EDGE_SEMANTICS: EdgeSemantic[] = [
  { name: "is-a", hint: "class membership / identity — both ends on the same level", levels: "same" },
  { name: "proxy-for", hint: "an honest stand-in across levels (the measure is not the thing)", levels: "crossing" },
  { name: "measured-by", hint: "phenomenon → the instrument or measure that operationalizes it", levels: "crossing" },
  { name: "correlates-with", hint: "co-varies with — no identity or level claim", levels: "any" },
  { name: "causes", hint: "causal claim — may legitimately cross levels", levels: "any" },
];

/** Look up a relation's declared semantics, if it's in the vocabulary. */
export function semanticsOf(relation: string): EdgeSemantic | undefined {
  return EDGE_SEMANTICS.find((s) => s.name === relation);
}

/** A node's abstraction level ("" when unassigned). */
export function nodeLevel(n: GraphNode): string {
  return typeof n.attrs.level === "string" ? n.attrs.level : "";
}

/** Levels present in a set of nodes (insertion order, deduped). */
export function levelsInUse(nodes: Iterable<GraphNode>): string[] {
  const out = new Set<string>();
  for (const n of nodes) {
    const l = nodeLevel(n);
    if (l) out.add(l);
  }
  return [...out];
}
