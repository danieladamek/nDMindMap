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
  const keys = Object.keys(attrs);
  if (keys.length === 0) return "";
  return " {" + keys.map((k) => `${k}: ${attrs[k]}`).join(", ") + "}";
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
  let section: "nodes" | "edges" | "nodetypes" | "edgetypes" | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const titleMatch = line.match(/^#\s*nDMindMap:\s*(.*)$/i);
    if (titleMatch) {
      title = titleMatch[1].trim() || title;
      continue;
    }
    // Type sections must be checked before the generic node/edge headers.
    if (/^##\s*node\s*types/i.test(line)) { section = "nodetypes"; continue; }
    if (/^##\s*edge\s*types/i.test(line)) { section = "edgetypes"; continue; }
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
    }
  }

  return { title, graph };
}
