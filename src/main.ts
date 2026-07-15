/**
 * nDMindMap app shell — Phase 1.
 *
 * Keyboard-first capture on a left-to-right mind-map tree. The Renderer owns the
 * capture loop and selection; the shell owns the toolbar, persistence, and the
 * seed document. The `.ndmm.md` file remains the source of truth.
 */

import "./style.css";
import { Graph } from "./model.js";
import { parse, stringify, type MindMapDoc } from "./serialize.js";
import { Renderer } from "./render.js";
import { Inspector } from "./inspector.js";

const SEED = `# nDMindMap: Welcome

## Nodes

- [root] nDMindMap
- [capture] Fast capture
- [graph] Graph-shaped
- [format] Human-readable file
- [nd] n-dimensional nodes
- [rel] Typed relationships

## Edges

- [capture] --child-of--> [root]
- [graph] --child-of--> [root]
- [format] --child-of--> [root]
- [nd] --child-of--> [graph]
- [rel] --child-of--> [graph]
- [rel] --lives-in--> [format]
`;

const IDLE_HINT = "Tab = child · Enter = sibling · F2 = rename · L = link · ↑↓←→ = move · Del = remove";

let doc: MindMapDoc = parse(SEED);
let renderer: Renderer;

const app = document.querySelector<HTMLDivElement>("#app")!;

const toolbar = document.createElement("div");
toolbar.className = "ndmm-toolbar";
toolbar.innerHTML = `
  <span class="brand">nDMindMap <span class="dot">●</span></span>
  <button id="add" title="Add a root node">+ Root</button>
  <button id="link" title="Link the selected node to another (typed relationship) — or press L">+ Link</button>
  <button id="tidy" title="Re-run the tidy layout, clearing hand-placed pins">Tidy</button>
  <label class="ndmm-toggle"><input type="checkbox" id="grid"> Grid</label>
  <button id="export">Export</button>
  <button id="import">Import</button>
  <span class="spacer"></span>
  <span class="hint" id="status"></span>
`;

const body = document.createElement("div");
body.className = "ndmm-body";
const stage = document.createElement("div");
stage.className = "ndmm-stage";
body.append(stage);
app.append(toolbar, body);

const status = toolbar.querySelector<HTMLSpanElement>("#status")!;
status.textContent = IDLE_HINT;

const inspector = new Inspector(body, { onEdit: () => renderer.relayout() });

function mount(graph: Graph): Renderer {
  inspector.setGraph(graph);
  return new Renderer(stage, graph, {
    onSelect: (n) => {
      status.textContent = n
        ? `${n.label || "(unnamed)"} — Tab child · Enter sibling · F2 rename · L link`
        : IDLE_HINT;
      inspector.show(n);
    },
    onSelectEdge: (edge) => {
      if (!edge) { inspector.show(null); status.textContent = IDLE_HINT; return; }
      const src = graph.nodes.get(edge.source);
      const tgt = graph.nodes.get(edge.target);
      status.textContent = `edge: ${src?.label ?? edge.source} → ${tgt?.label ?? edge.target}`;
      inspector.showEdge(edge, {
        relationTypes: renderer.relationTypes(),
        sourceLabel: src?.label || edge.source,
        targetLabel: tgt?.label || edge.target,
        onDelete: () => renderer.deleteEdge(edge.id),
      });
    },
    onLinkModeChange: (active) => {
      if (active) status.textContent = "Link mode — click a target node (Esc to cancel)";
    },
    onChange: () => { /* Phase 1: hook for dirty-tracking / autosave later */ },
  });
}

renderer = mount(doc.graph);
renderer.focusCanvas();

// --- toolbar --------------------------------------------------------------

toolbar.querySelector("#add")!.addEventListener("click", () => {
  renderer.focusCanvas();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
});

toolbar.querySelector("#link")!.addEventListener("click", () => {
  if (!renderer.selected) { status.textContent = "Select a node first, then Link (or press L)"; return; }
  renderer.focusCanvas();
  renderer.startLink();
});

toolbar.querySelector("#tidy")!.addEventListener("click", () => renderer.tidy());

toolbar.querySelector<HTMLInputElement>("#grid")!.addEventListener("change", (e) => {
  renderer.setGrid((e.target as HTMLInputElement).checked);
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
    renderer.destroy();
    renderer = mount(doc.graph);
    inspector.show(null);
    renderer.focusCanvas();
    status.textContent = `imported: ${doc.title}`;
  });
  input.click();
});

// Expose internals for console poking / tests (mirrors RiffRaft's window.__mic).
(window as unknown as { __ndmm: unknown }).__ndmm = {
  doc: () => doc,
  stringify: () => stringify(doc),
  renderer: () => renderer,
  Graph,
};
