/**
 * Explosion Reader (Phase 1) — "explode" a text/markdown document into a map.
 *
 * A document already has structure: headings nest, bullets nest, paragraphs sit
 * under a heading. We turn that into an nDMindMap:
 *   - headings & bullets  → child-of tree (the document outline),
 *   - paragraphs (prose)  → a node **labelled with its first sentence**, full
 *     prose in `note` (default). Set `paragraphsAsNodes: false` to instead fold
 *     prose into the nearest heading's note (a lean outline with no prose nodes),
 *   - every structural node carries a `sec` attribute (its outline number),
 *   - `@[label]` inside a block → a **part-of** edge from that entity to the
 *     paragraph/heading it sits under (matching an existing node by label or
 *     `SecN`, else creating one). Distinct from the interrogation modal's
 *     `mentions`.
 *
 * Everything hangs under a single document root so a whole import stays groupable
 * and collapsible. Pure graph mutation; no I/O, no new dependencies.
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
  nodes: number; // structural + entity nodes created
  edges: number; // part-of edges created
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

/**
 * Parse `text` and add the exploded structure into `graph`. Returns the new
 * document root id plus counts. `title` overrides the derived document label.
 */
export function explodeInto(graph: Graph, text: string, title?: string, opts: ExplodeOptions = {}): ExplodeResult {
  const paragraphsAsNodes = opts.paragraphsAsNodes ?? true;
  const startSize = graph.nodes.size;
  const derived = title || firstHeading(text);
  const docLabel = (derived || "Imported document").trim();
  const root = graph.addNode({ label: docLabel, attrs: { kind: "document" } });
  // When the title came from the document's own first heading, that heading *is*
  // the root — don't also emit a duplicate heading node for it.
  let skipTitleHeading = !title && derived != null;

  // Blocks we create, with the raw source text they came from (for @[ ] resolution).
  const blocks: { node: GraphNode; source: string }[] = [];

  const headingStack: { depth: number; node: GraphNode }[] = [];
  let bulletStack: { indent: number; node: GraphNode }[] = [];
  const currentHeading = (): GraphNode => (headingStack.length ? headingStack[headingStack.length - 1].node : root);

  const appendNote = (node: GraphNode, text: string): void => {
    const prev = typeof node.attrs.note === "string" ? node.attrs.note : "";
    node.attrs.note = prev ? `${prev}\n\n${text}` : text;
  };

  let para: string[] = [];
  const flushPara = (): void => {
    const body = para.join("\n").trim();
    para = [];
    if (!body) return;
    bulletStack = []; // a paragraph breaks any open bullet list
    if (paragraphsAsNodes) {
      // A paragraph → a node labelled with its first sentence, full prose in note.
      const node = graph.addNode({ label: summarize(body), attrs: { kind: "section", note: body } });
      graph.setParent(node.id, currentHeading().id);
      blocks.push({ node, source: body });
    } else {
      // Lean outline: fold prose into the nearest heading's (or root's) note.
      const container = currentHeading();
      appendNote(container, body);
      blocks.push({ node: container, source: body });
    }
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flushPara(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      if (skipTitleHeading && cleanLabel(h[2]) === docLabel) { skipTitleHeading = false; continue; }
      const depth = h[1].length;
      while (headingStack.length && headingStack[headingStack.length - 1].depth >= depth) headingStack.pop();
      const parent = headingStack.length ? headingStack[headingStack.length - 1].node : root;
      const node = graph.addNode({ label: cleanLabel(h[2]), attrs: { kind: "heading" } });
      graph.setParent(node.id, parent.id);
      headingStack.push({ depth, node });
      blocks.push({ node, source: h[2] });
      bulletStack = [];
      continue;
    }

    const b = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (b) {
      flushPara();
      const indent = b[1].replace(/\t/g, "  ").length;
      while (bulletStack.length && bulletStack[bulletStack.length - 1].indent >= indent) bulletStack.pop();
      const parent = bulletStack.length ? bulletStack[bulletStack.length - 1].node : currentHeading();
      const node = graph.addNode({ label: cleanLabel(b[2]), attrs: { kind: "bullet" } });
      graph.setParent(node.id, parent.id);
      bulletStack.push({ indent, node });
      blocks.push({ node, source: b[2] });
      continue;
    }

    para.push(line);
  }
  flushPara();

  // Outline numbers: DFS from the doc root's children. Each node's `sec` is its
  // path of 1-based sibling indices ("1", "1.2", "1.2.3"), for reference and for
  // resolving `@[Sec1.2]` mentions.
  const numberChildren = (parentId: string, prefix: string): void => {
    graph.childrenOf(parentId).forEach((child, i) => {
      const sec = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      child.attrs.sec = sec;
      numberChildren(child.id, sec);
    });
  };
  numberChildren(root.id, "");

  // Resolve @[label] in each block → part-of edge. Match an existing node by
  // label or by `SecN`; otherwise create a floating entity node.
  const byLabel = new Map<string, GraphNode>();
  const bySec = new Map<string, GraphNode>();
  for (const n of graph.nodes.values()) {
    if (n.label) byLabel.set(n.label.toLowerCase(), n);
    const sec = typeof n.attrs.sec === "string" ? n.attrs.sec : "";
    if (sec) bySec.set(`sec${sec}`.toLowerCase(), n);
  }
  let edges = 0;
  for (const { node, source } of blocks) {
    for (const m of source.matchAll(LINK_RE)) {
      const label = m[1].trim();
      if (!label) continue;
      const key = label.toLowerCase();
      let target = byLabel.get(key) ?? bySec.get(key);
      if (!target) {
        target = graph.addNode({ label, attrs: { kind: "entity" } });
        byLabel.set(key, target);
      }
      if (target.id === node.id) continue;
      graph.addEdge({ source: target.id, target: node.id, relation: PART_OF });
      edges += 1;
    }
  }

  return { rootId: root.id, nodes: graph.nodes.size - startSize, edges };
}
