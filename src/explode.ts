/**
 * Explosion Reader — "explode" a text/markdown document into a map, and keep the
 * two in sync (the graph is canonical; the paper is a projection of it).
 *
 * A document already has structure: headings nest, bullets nest, paragraphs sit
 * under a heading. We turn that into an nDMindMap:
 *   - headings & bullets  → child-of tree (the document outline),
 *   - paragraphs (prose)  → a node **labelled with its first sentence**, full
 *     prose in `note` (default). `paragraphsAsNodes: false` folds prose into the
 *     nearest heading's note instead (a lean outline with no prose nodes),
 *   - every structural node carries a `sec` outline number,
 *   - `@[label]` inside a note → a **part-of** edge from that entity to the node
 *     it sits in (matching an existing node by label or `SecN`, else creating an
 *     entity). Distinct from the interrogation modal's `mentions`.
 *
 * Parsing (text → a plain Block tree) is separate from graph mutation so that
 * `explodeInto` (build fresh) and `syncDocument` (reconcile in place, preserving
 * node ids / positions / hand-added edges) can share it. Pure graph mutation; no
 * I/O, no new dependencies.
 */

import type { Graph, GraphNode } from "./model.js";

export const PART_OF = "part-of";
const LINK_RE = /@\[([^\]]+)\]/g;

/** `kind` marks a node's document role (heading / bullet / section / entity). */
export type BlockKind = "document" | "heading" | "bullet" | "section" | "entity";

export interface ExplodeOptions {
  /** true (default): each paragraph becomes a node labelled with its first
   *  sentence, full prose in `note`. false: prose folds into the nearest
   *  heading's note (lean outline). */
  paragraphsAsNodes?: boolean;
}

export interface ExplodeResult {
  rootId: string;
  nodes: number; // structural + entity nodes created (explode) / in the subtree (sync)
  edges: number; // part-of edges present after resolution
}

/** Strip `@[x]` markup down to `x` for a clean on-map label. */
function cleanLabel(text: string): string {
  return text.replace(LINK_RE, "$1").trim();
}

/** A short, readable label for a paragraph: its first sentence, truncated. */
function summarize(text: string): string {
  const clean = cleanLabel(text).replace(/\s+/g, " ").trim();
  const m = clean.match(/^(.*?[.!?])(?:\s|$)/);
  let s = (m ? m[1] : clean).trim();
  if (s.length > 64) s = s.slice(0, 61).trimEnd() + "…";
  return s || "note";
}

/** First `# Heading` text in the document, if any. */
function firstHeading(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^#{1,6}\s+(.*)$/);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

// --- parsing: text → a plain Block tree (no graph) ---------------------------

interface Block {
  kind: "heading" | "bullet" | "section";
  label: string;
  note: string;
  children: Block[];
}

interface ParsedDoc {
  title: string | null;
  rootNote: string;
  blocks: Block[];
}

function parseDocument(text: string, paragraphsAsNodes: boolean, consumeTitleHeading: boolean): ParsedDoc {
  const derived = firstHeading(text);
  let skipTitle = consumeTitleHeading && derived != null;

  let rootNote = "";
  const rootChildren: Block[] = [];
  const headingStack: { depth: number; block: Block }[] = [];
  let bulletStack: { indent: number; block: Block }[] = [];

  const currentHeading = (): Block | null => (headingStack.length ? headingStack[headingStack.length - 1].block : null);
  const headingChildren = (): Block[] => currentHeading()?.children ?? rootChildren;
  const addNote = (target: Block | null, t: string): void => {
    if (target) target.note = target.note ? `${target.note}\n\n${t}` : t;
    else rootNote = rootNote ? `${rootNote}\n\n${t}` : t;
  };

  let para: string[] = [];
  const flushPara = (): void => {
    const body = para.join("\n").trim();
    para = [];
    if (!body) return;
    bulletStack = [];
    if (paragraphsAsNodes) headingChildren().push({ kind: "section", label: summarize(body), note: body, children: [] });
    else addNote(currentHeading(), body);
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flushPara(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      const label = cleanLabel(h[2]);
      if (skipTitle && label === derived) { skipTitle = false; continue; }
      const depth = h[1].length;
      while (headingStack.length && headingStack[headingStack.length - 1].depth >= depth) headingStack.pop();
      const block: Block = { kind: "heading", label, note: "", children: [] };
      (headingStack.length ? headingStack[headingStack.length - 1].block.children : rootChildren).push(block);
      headingStack.push({ depth, block });
      bulletStack = [];
      continue;
    }

    const b = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (b) {
      flushPara();
      const indent = b[1].replace(/\t/g, "  ").length;
      while (bulletStack.length && bulletStack[bulletStack.length - 1].indent >= indent) bulletStack.pop();
      const block: Block = { kind: "bullet", label: cleanLabel(b[2]), note: "", children: [] };
      const into = bulletStack.length ? bulletStack[bulletStack.length - 1].block.children : headingChildren();
      into.push(block);
      bulletStack.push({ indent, block });
      continue;
    }

    para.push(line);
  }
  flushPara();

  return { title: derived, rootNote, blocks: rootChildren };
}

// --- shared graph helpers ----------------------------------------------------

function setNote(node: GraphNode, note: string): void {
  if (note.trim()) node.attrs.note = note; else delete node.attrs.note;
}

/** Outline numbers: DFS from the root's children ("1", "1.2", "1.2.3"). */
function numberSubtree(graph: Graph, rootId: string): void {
  const num = (parentId: string, prefix: string): void => {
    graph.childrenOf(parentId).forEach((child, i) => {
      const sec = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      child.attrs.sec = sec;
      num(child.id, sec);
    });
  };
  num(rootId, "");
}

/** Re-resolve `@[label]` in every subtree node's note → part-of edges. Existing
 *  part-of edges into the subtree are cleared first, so this is idempotent. */
function resolvePartOf(graph: Graph, rootId: string): number {
  const subtree = new Set<string>();
  const collect = (id: string): void => { subtree.add(id); for (const c of graph.childrenOf(id)) collect(c.id); };
  collect(rootId);

  for (const [eid, e] of [...graph.edges]) {
    if (e.relation === PART_OF && subtree.has(e.target)) graph.removeEdge(eid);
  }

  const byLabel = new Map<string, GraphNode>();
  const bySec = new Map<string, GraphNode>();
  for (const n of graph.nodes.values()) {
    if (n.label) byLabel.set(n.label.toLowerCase(), n);
    const sec = typeof n.attrs.sec === "string" ? n.attrs.sec : "";
    if (sec) bySec.set(`sec${sec}`.toLowerCase(), n);
  }

  let edges = 0;
  for (const id of subtree) {
    const node = graph.nodes.get(id);
    const note = node && typeof node.attrs.note === "string" ? node.attrs.note : "";
    for (const m of note.matchAll(LINK_RE)) {
      const label = m[1].trim();
      if (!label) continue;
      const key = label.toLowerCase();
      let target = byLabel.get(key) ?? bySec.get(key);
      if (!target) { target = graph.addNode({ label, attrs: { kind: "entity" } }); byLabel.set(key, target); }
      if (target.id === id) continue;
      const dup = [...graph.edges.values()].some((e) => e.relation === PART_OF && e.source === target!.id && e.target === id);
      if (!dup) { graph.addEdge({ source: target.id, target: id, relation: PART_OF }); edges += 1; }
    }
  }
  return edges;
}

// --- build (explode): Block tree → fresh nodes -------------------------------

function buildFromBlocks(graph: Graph, parentNode: GraphNode, blocks: Block[]): void {
  for (const block of blocks) {
    const node = graph.addNode({ label: block.label, attrs: { kind: block.kind } });
    setNote(node, block.note);
    graph.setParent(node.id, parentNode.id);
    buildFromBlocks(graph, node, block.children);
  }
}

/** Parse `text` and add a fresh document subtree. `title` overrides the label. */
export function explodeInto(graph: Graph, text: string, title?: string, opts: ExplodeOptions = {}): ExplodeResult {
  const split = opts.paragraphsAsNodes ?? true;
  const startSize = graph.nodes.size;
  const parsed = parseDocument(text, split, !title);
  const root = graph.addNode({ label: (title || parsed.title || "Imported document").trim(), attrs: { kind: "document" } });
  setNote(root, parsed.rootNote);
  buildFromBlocks(graph, root, parsed.blocks);
  numberSubtree(graph, root.id);
  const edges = resolvePartOf(graph, root.id);
  return { rootId: root.id, nodes: graph.nodes.size - startSize, edges };
}

// --- sync (reconcile): Block tree → update existing nodes in place -----------

/** Reconcile `blocks` against `parentNode`'s existing children, preserving node
 *  identity (ids, positions, hand-added edges) where they still correspond.
 *  Matching: exact label first, then positional (a rename), else a new node;
 *  unmatched existing children are removed. */
function reconcileBlocks(graph: Graph, parentNode: GraphNode, blocks: Block[]): void {
  const existing = graph.childrenOf(parentNode.id); // child-of children only (never entities)
  const used = new Set<string>();
  const matchOf = new Map<Block, GraphNode>();

  // Pass 1: exact label + kind.
  for (const block of blocks) {
    const m = existing.find((n) => !used.has(n.id) && n.attrs.kind === block.kind && (n.label || "").toLowerCase() === block.label.toLowerCase());
    if (m) { used.add(m.id); matchOf.set(block, m); }
  }
  // Pass 2: next unused of the same kind (treat as a rename/edit).
  for (const block of blocks) {
    if (matchOf.has(block)) continue;
    const m = existing.find((n) => !used.has(n.id) && n.attrs.kind === block.kind);
    if (m) { used.add(m.id); matchOf.set(block, m); }
  }

  const result: { node: GraphNode; block: Block }[] = [];
  for (const block of blocks) {
    let node = matchOf.get(block);
    if (node) { node.label = block.label; setNote(node, block.note); }
    else { node = graph.addNode({ label: block.label, attrs: { kind: block.kind } }); setNote(node, block.note); }
    result.push({ node, block });
  }

  // Remove existing structural children that no longer correspond.
  for (const n of existing) if (!used.has(n.id)) graph.removeSubtree(n.id);
  // Re-attach in the new order (setParent re-appends the child-of edge).
  for (const { node } of result) graph.setParent(node.id, parentNode.id);
  // Recurse.
  for (const { node, block } of result) reconcileBlocks(graph, node, block.children);
}

/** Re-sync an existing document from edited text, updating nodes in place. */
export function syncDocument(graph: Graph, rootId: string, text: string, opts: ExplodeOptions = {}): ExplodeResult {
  const root = graph.nodes.get(rootId);
  if (!root) return explodeInto(graph, text, undefined, opts); // document is gone → fresh
  const split = opts.paragraphsAsNodes ?? true;
  const parsed = parseDocument(text, split, true); // projected text always leads with the `# title`
  root.label = (parsed.title || root.label).trim();
  setNote(root, parsed.rootNote);
  reconcileBlocks(graph, root, parsed.blocks);
  numberSubtree(graph, root.id);
  const edges = resolvePartOf(graph, root.id);
  let nodes = 0;
  const count = (id: string): void => { nodes += 1; for (const c of graph.childrenOf(id)) count(c.id); };
  count(root.id);
  return { rootId, nodes, edges };
}

// --- projection: graph → markdown (the paper is a view of the map) -----------

/** Render a document subtree back to markdown. The inverse of `explodeInto`:
 *  round-tripping a document leaves the same structure. Entity nodes (`@[label]`
 *  targets) are NOT emitted — they already live inline in the notes. */
export function projectDocument(graph: Graph, rootId: string): string {
  const root = graph.nodes.get(rootId);
  if (!root) return "";
  const out: string[] = [];
  const pushProse = (note: unknown): void => {
    if (typeof note === "string" && note.trim()) out.push("", note.trim());
  };

  out.push(`# ${root.label}`.trimEnd());
  pushProse(root.attrs.note);

  const walk = (nodeId: string, headingLevel: number, bulletDepth: number): void => {
    for (const child of graph.childrenOf(nodeId)) {
      const kind = child.attrs.kind;
      if (kind === "heading") {
        const level = Math.min(headingLevel + 1, 6);
        out.push("", `${"#".repeat(level)} ${child.label}`.trimEnd());
        pushProse(child.attrs.note);
        walk(child.id, level, 0);
      } else if (kind === "bullet") {
        out.push(`${"  ".repeat(bulletDepth)}- ${child.label}`);
        pushProse(child.attrs.note);
        walk(child.id, headingLevel, bulletDepth + 1);
      } else if (kind === "entity") {
        continue; // linked entity — lives inline as @[label], not emitted here
      } else {
        pushProse(child.attrs.note); // paragraph / section node: emit its prose
        walk(child.id, headingLevel, bulletDepth);
      }
    }
  };
  walk(root.id, 1, 0);

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Remove a document's structural subtree. Linked entity nodes (roots reached
 *  only by `part-of`) survive and re-link on re-explode. */
export function clearDocument(graph: Graph, rootId: string): void {
  graph.removeSubtree(rootId);
}
