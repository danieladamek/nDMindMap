/**
 * The human-readable, diffable file format for nDMindMap (`.ndmm.md`).
 *
 * The format IS the source of truth (the RiffRaft philosophy: never let UI
 * simplicity amputate data the format could carry). It is plain Markdown so a
 * map reads sensibly in any editor and versions cleanly in git:
 *
 *   # nDMindMap: <title>
 *
 *   ## Nodes
 *   - [id] Label {key: value, key: value}
 *
 *   ## Edges
 *   - [srcId] --relation--> [dstId] {key: value}
 *
 * Attrs are an optional `{...}` trailer. Layout hints (x/y) round-trip through
 * the `@x,y` marker so a hand-arranged map survives a save.
 */

import { Graph, type GraphNode, type GraphEdge, type Scalar } from "./model.js";

export interface MindMapDoc {
  title: string;
  graph: Graph;
}

function parseScalar(raw: string): Scalar {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s !== "" && !Number.isNaN(Number(s))) return Number(s);
  return s;
}

function parseAttrs(block: string | undefined): Record<string, Scalar> {
  const attrs: Record<string, Scalar> = {};
  if (!block) return attrs;
  for (const pair of block.split(",")) {
    const idx = pair.indexOf(":");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    if (key) attrs[key] = parseScalar(pair.slice(idx + 1));
  }
  return attrs;
}

function stringifyAttrs(attrs: Record<string, Scalar>): string {
  // `note` is multi-line prose — it lives in the `## Notes` section, never inline.
  const keys = Object.keys(attrs).filter((k) => k !== "note");
  if (keys.length === 0) return "";
  return " {" + keys.map((k) => `${k}: ${attrs[k]}`).join(", ") + "}";
}

/** The freeform prose attached to a node or edge (interrogation notes), or "". */
function noteOf(attrs: Record<string, Scalar>): string {
  return typeof attrs.note === "string" ? attrs.note.replace(/\s+$/, "") : "";
}

/** Serialize a doc to the `.ndmm.md` text format. */
export function stringify(doc: MindMapDoc): string {
  const lines: string[] = [];
  lines.push(`# nDMindMap: ${doc.title}`, "");
  lines.push("## Nodes", "");
  for (const n of doc.graph.nodes.values()) {
    const pos = n.x !== undefined && n.y !== undefined ? ` @${Math.round(n.x)},${Math.round(n.y)}` : "";
    lines.push(`- [${n.id}] ${n.label}${pos}${stringifyAttrs(n.attrs)}`);
  }
  lines.push("", "## Edges", "");
  for (const e of doc.graph.edges.values()) {
    lines.push(`- [${e.source}] --${e.relation}--> [${e.target}]${stringifyAttrs(e.attrs)}`);
  }
  // The schema: registered types (only emitted when present).
  if (doc.graph.nodeTypes.size) {
    lines.push("", "## Node Types", "");
    for (const t of doc.graph.nodeTypes.values()) lines.push(`- ${t.name}${stringifyAttrs(t.attrs)}`);
  }
  if (doc.graph.edgeTypes.size) {
    lines.push("", "## Edge Types", "");
    for (const t of doc.graph.edgeTypes.values()) lines.push(`- ${t.name}${stringifyAttrs(t.attrs)}`);
  }
  // Global channel↔dimension bindings.
  const bindingEntries = (["color", "shape", "size"] as const).filter((c) => doc.graph.bindings[c]);
  if (bindingEntries.length) {
    lines.push("", "## Bindings", "");
    for (const c of bindingEntries) lines.push(`- ${c}: ${doc.graph.bindings[c]}`);
  }
  // Freeform interrogation notes — multi-line prose per node/edge, in its own
  // section so it stays diffable and never collides with the inline {attr} trailer.
  const noteBlocks: string[] = [];
  for (const n of doc.graph.nodes.values()) {
    const note = noteOf(n.attrs);
    if (note) noteBlocks.push(`### node [${n.id}]`, "", note, "");
  }
  for (const e of doc.graph.edges.values()) {
    const note = noteOf(e.attrs);
    // Edge ids aren't persisted (they regenerate on load), so key the note by the
    // edge's endpoints/relation signature instead.
    if (note) noteBlocks.push(`### edge [${e.source}] --${e.relation}--> [${e.target}]`, "", note, "");
  }
  if (noteBlocks.length) lines.push("", "## Notes", "", ...noteBlocks);
  lines.push("");
  return lines.join("\n");
}

const NODE_RE = /^-\s*\[([^\]]+)\]\s*(.*?)(?:\s*@(-?\d+),(-?\d+))?(?:\s*\{(.*)\})?\s*$/;
const EDGE_RE = /^-\s*\[([^\]]+)\]\s*--(.*?)-->\s*\[([^\]]+)\](?:\s*\{(.*)\})?\s*$/;
const TYPE_RE = /^-\s*(.*?)(?:\s*\{(.*)\})?\s*$/;

/** Parse `.ndmm.md` text back into a doc. Tolerant of blank lines and prose. */
export function parse(text: string): MindMapDoc {
  const graph = new Graph();
  let title = "Untitled";
  let section: "nodes" | "edges" | "nodetypes" | "edgetypes" | "bindings" | "notes" | null = null;

  // Notes are multi-line: accumulate raw lines under the current `### node/edge`
  // header and flush them onto the target element's `note` attr when it ends. The
  // Notes section is emitted last, so nodes/edges already exist to resolve against.
  let noteTarget: { attrs: Record<string, Scalar> } | null = null;
  let noteLines: string[] = [];
  const flushNote = (): void => {
    if (noteTarget) {
      const body = noteLines.join("\n").replace(/^\n+|\n+$/g, "");
      if (body) noteTarget.attrs.note = body;
    }
    noteTarget = null;
    noteLines = [];
  };
  const findEdge = (src: string, rel: string, tgt: string): GraphEdge | undefined => {
    for (const e of graph.edges.values()) if (e.source === src && e.relation === rel && e.target === tgt) return e;
    return undefined;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    // Inside Notes: sub-headers pick a target, section headers end it, and every
    // other line (blank lines included) is preserved as prose.
    if (section === "notes") {
      const nodeSub = line.match(/^###\s+node\s+\[([^\]]+)\]\s*$/i);
      const edgeSub = line.match(/^###\s+edge\s+\[([^\]]+)\]\s*--(.*?)-->\s*\[([^\]]+)\]\s*$/i);
      if (nodeSub) { flushNote(); noteTarget = graph.nodes.get(nodeSub[1].trim()) ?? null; continue; }
      if (edgeSub) { flushNote(); noteTarget = findEdge(edgeSub[1].trim(), edgeSub[2].trim() || "relates-to", edgeSub[3].trim()) ?? null; continue; }
      if (!/^##\s/.test(line) && !/^#\s/.test(line)) { noteLines.push(rawLine); continue; }
      flushNote(); // a new top-level section begins — fall through to handle it
    }

    if (!line) continue;

    const titleMatch = line.match(/^#\s*nDMindMap:\s*(.*)$/i);
    if (titleMatch) {
      title = titleMatch[1].trim() || title;
      continue;
    }
    // Type sections must be checked before the generic node/edge headers.
    if (/^##\s*node\s*types/i.test(line)) { section = "nodetypes"; continue; }
    if (/^##\s*edge\s*types/i.test(line)) { section = "edgetypes"; continue; }
    if (/^##\s*bindings/i.test(line)) { section = "bindings"; continue; }
    if (/^##\s*notes/i.test(line)) { section = "notes"; continue; }
    if (/^##\s*nodes/i.test(line)) { section = "nodes"; continue; }
    if (/^##\s*edges/i.test(line)) { section = "edges"; continue; }
    if (line.startsWith("#")) { section = null; continue; }

    if (section === "nodes") {
      const m = line.match(NODE_RE);
      if (!m) continue;
      const node: Partial<GraphNode> & { label: string } = {
        id: m[1].trim(),
        label: m[2].trim(),
        attrs: parseAttrs(m[5]),
      };
      if (m[3] !== undefined && m[4] !== undefined) {
        node.x = Number(m[3]);
        node.y = Number(m[4]);
      }
      graph.addNode(node);
    } else if (section === "edges") {
      const m = line.match(EDGE_RE);
      if (!m) continue;
      const edge: Partial<GraphEdge> & { source: string; target: string } = {
        source: m[1].trim(),
        target: m[3].trim(),
        relation: m[2].trim() || "relates-to",
        attrs: parseAttrs(m[4]),
      };
      // Skip dangling edges rather than throw — a partial hand-edit shouldn't
      // break the whole load.
      if (graph.nodes.has(edge.source) && graph.nodes.has(edge.target)) {
        graph.addEdge(edge);
      }
    } else if (section === "nodetypes") {
      const m = line.match(TYPE_RE);
      if (m && m[1].trim()) graph.registerNodeType(m[1].trim(), parseAttrs(m[2]));
    } else if (section === "edgetypes") {
      const m = line.match(TYPE_RE);
      if (m && m[1].trim()) graph.registerEdgeType(m[1].trim(), parseAttrs(m[2]));
    } else if (section === "bindings") {
      const m = line.match(/^-\s*(color|shape|size)\s*:\s*(.+?)\s*$/i);
      if (m) graph.bindings[m[1].toLowerCase() as "color" | "shape" | "size"] = m[2];
    }
  }
  flushNote(); // the final Notes block runs to EOF with no trailing header

  return { title, graph };
}
