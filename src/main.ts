/**
 * nDMindMap app shell — wires the graph model, serializer, and renderer into a
 * minimal working capture surface.
 *
 * This is scaffold, not the finished product: enough to prove the loop
 * (capture → graph → readable file → back) runs end to end. The interesting
 * work lives in model.ts / serialize.ts / render.ts.
 */

import "./style.css";
import { Graph, type GraphNode } from "./model.js";
import { parse, stringify, type MindMapDoc } from "./serialize.js";
import { Renderer } from "./render.js";

const SEED = `# nDMindMap: Welcome

## Nodes

- [root] nDMindMap {kind: root}
- [capture] Fast idea capture {kind: pillar}
- [graph] Graph-shaped, not a tree {kind: pillar}
- [format] Human-readable file {kind: pillar}
- [nd] n-dimensional nodes {kind: idea}
- [rel] Typed relationships {kind: idea}

## Edges

- [root] --relates-to--> [capture]
- [root] --relates-to--> [graph]
- [root] --relates-to--> [format]
- [graph] --enables--> [rel]
- [nd] --lives-in--> [format]
- [rel] --lives-in--> [format]
`;

let doc: MindMapDoc = parse(SEED);

const app = document.querySelector<HTMLDivElement>("#app")!;

const toolbar = document.createElement("div");
toolbar.className = "ndmm-toolbar";
toolbar.innerHTML = `
  <span class="brand">nDMindMap <span class="dot">●</span></span>
  <button id="add">+ Node</button>
  <button id="connect">Connect selected → next click</button>
  <button id="export">Export .ndmm.md</button>
  <button id="import">Import</button>
  <span class="spacer"></span>
  <span class="hint" id="status">drag nodes to arrange · click a node to select</span>
`;

const stage = document.createElement("div");
stage.className = "ndmm-stage";

app.append(toolbar, stage);

let selected: GraphNode | null = null;
const status = toolbar.querySelector<HTMLSpanElement>("#status")!;

let renderer = new Renderer(stage, doc.graph, {
  onSelect: (n) => {
    selected = n;
    status.textContent = n ? `selected: ${n.label} [${n.id}]` : "drag nodes to arrange · click a node to select";
  },
});

toolbar.querySelector("#add")!.addEventListener("click", () => {
  const label = prompt("New idea:");
  if (!label) return;
  const n = doc.graph.addNode({ label });
  if (selected) doc.graph.addEdge({ source: selected.id, target: n.id, relation: "relates-to" });
  status.textContent = `added: ${n.label}`;
});

// "Connect" is a two-step gesture: press the button with a node selected, then
// click the target node.
let connectFrom: string | null = null;
toolbar.querySelector("#connect")!.addEventListener("click", () => {
  if (!selected) { status.textContent = "select a source node first"; return; }
  connectFrom = selected.id;
  status.textContent = `connecting from ${selected.label} — click a target node`;
});
stage.addEventListener("pointerup", () => {
  if (connectFrom && selected && selected.id !== connectFrom) {
    const relation = prompt("Relationship:", "relates-to") || "relates-to";
    doc.graph.addEdge({ source: connectFrom, target: selected.id, relation });
    status.textContent = `linked ${connectFrom} --${relation}--> ${selected.id}`;
    connectFrom = null;
  }
});

toolbar.querySelector("#export")!.addEventListener("click", () => {
  const text = stringify(doc);
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${doc.title.replace(/\s+/g, "-").toLowerCase() || "mindmap"}.ndmm.md`;
  a.click();
  URL.revokeObjectURL(url);
});

toolbar.querySelector("#import")!.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".md,.ndmm.md,text/markdown,text/plain";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    doc = parse(await file.text());
    renderer.stop();
    stage.replaceChildren();
    renderer = new Renderer(stage, doc.graph, {
      onSelect: (n) => { selected = n; },
    });
    status.textContent = `imported: ${doc.title}`;
  });
  input.click();
});

// Expose internals for quick console poking / tests (mirrors RiffRaft's window.__mic).
(window as unknown as { __ndmm: { doc: () => MindMapDoc; Graph: typeof Graph } }).__ndmm = {
  doc: () => doc,
  Graph,
};
