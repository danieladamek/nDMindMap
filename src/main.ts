/**
 * nDMindMap app shell — Phase 1.
 *
 * Keyboard-first capture on a left-to-right mind-map tree. The Renderer owns the
 * capture loop and selection; the shell owns the toolbar, persistence, and the
 * seed document. The `.ndmm.md` file remains the source of truth.
 */

import "./style.css";
import { Graph } from "./model.js";
import { RESERVED_ATTRS } from "./visuals.js";
import { parse, stringify, type MindMapDoc } from "./serialize.js";
import { Renderer } from "./render.js";
import { Inspector } from "./inspector.js";
import { ListView } from "./list.js";
import { deriveSchema } from "./schema.js";
import { InterrogationModal } from "./interrogate.js";
import type { DeleteImpact } from "./render.js";
import type { GraphNode, GraphEdge } from "./model.js";

const SEED = `# nDMindMap: Welcome

## Nodes

- [root] nDMindMap
- [capture] Fast capture
- [graph] Graph-shaped
- [format] Human-readable file
- [nd] n-dimensional nodes
- [rel] Typed relationships
- [levels] Abstraction levels
- [pleasure] Pleasure {level: subjective-experience}
- [dopamine] Dopamine ↑ {level: biomarker}

## Edges

- [capture] --child-of--> [root]
- [graph] --child-of--> [root]
- [format] --child-of--> [root]
- [nd] --child-of--> [graph]
- [rel] --child-of--> [graph]
- [levels] --child-of--> [nd]
- [pleasure] --child-of--> [levels]
- [dopamine] --child-of--> [levels]
- [rel] --lives-in--> [format]
- [pleasure] --proxy-for--> [dopamine]
`;

const IDLE_HINT = "Tab = child · Enter = sibling · F2 = rename · L = link · ↑↓←→ = move · Del = remove";

let doc: MindMapDoc = parse(SEED);
let renderer: Renderer;

const app = document.querySelector<HTMLDivElement>("#app")!;

const toolbar = document.createElement("div");
toolbar.className = "ndmm-toolbar";
toolbar.innerHTML = `
  <span class="brand">nDMindMap <span class="dot">●</span></span>
  <span class="ndmm-filegroup">
    <button id="file-new" title="New map (⌘/Ctrl-N)">New</button>
    <button id="file-open" title="Open a .ndmm.md file (⌘/Ctrl-O)">Open</button>
    <button id="file-save" title="Save (⌘/Ctrl-S)">Save</button>
    <button id="file-saveas" title="Save As… (⌘/Ctrl-Shift-S)">Save As</button>
    <span id="filename" class="ndmm-filename"></span>
  </span>
  <button id="add" title="Add a root node">+ Root</button>
  <button id="link" title="Link the selected node to another (typed relationship) — or press L">+ Link</button>
  <button id="tidy" title="Re-run the tidy layout, clearing hand-placed pins">Tidy</button>
  <button id="undo" title="Undo (⌘/Ctrl-Z)" disabled>↶ Undo</button>
  <button id="redo" title="Redo (⌘/Ctrl-Shift-Z)" disabled>↷ Redo</button>
  <label class="ndmm-toggle" title="Show the outline / list view beside the map"><input type="checkbox" id="list" checked> List</label>
  <label class="ndmm-toggle" title="Show the emergent schema derived from the sketch (node kinds + relation domain→range)"><input type="checkbox" id="schema"> Schema</label>
  <label class="ndmm-toggle" title="Toggle a snap-to grid for hand placement"><input type="checkbox" id="grid"> Grid</label>
  <span class="ndmm-bindgroup" title="Bind a visual channel to a dimension (global attribution); unbound = aesthetic">
    Bind:
    <label>color <select id="bind-color" class="ndmm-bind"></select></label>
    <label>shape <select id="bind-shape" class="ndmm-bind"></select></label>
    <label>size <select id="bind-size" class="ndmm-bind"></select></label>
  </span>
  <span class="spacer"></span>
  <span class="hint" id="status"></span>
`;

const body = document.createElement("div");
body.className = "ndmm-body";
const stage = document.createElement("div");
stage.className = "ndmm-stage";
const legend = document.createElement("div");
legend.className = "ndmm-legend";
legend.style.display = "none";
const filters = document.createElement("div");
filters.className = "ndmm-filters";
filters.style.display = "none";
const lintBanner = document.createElement("div");
lintBanner.className = "ndmm-lint";
lintBanner.style.display = "none";
const schemaPanel = document.createElement("div");
schemaPanel.className = "ndmm-schema";
schemaPanel.style.display = "none";
stage.append(legend, filters, lintBanner, schemaPanel);

const status = toolbar.querySelector<HTMLSpanElement>("#status")!;
status.textContent = IDLE_HINT;

let selectedNodeId: string | null = null;

// List (outline) view — shares selection with the map.
const list = new ListView(body, {
  onSelect: (id) => renderer.selectNode(id),
  onReparent: (childId, parentId) => {
    try {
      if (parentId) doc.graph.setParent(childId, parentId);
      else doc.graph.clearParent(childId);
      renderer.relayout();
      refreshUI();
    } catch (err) {
      status.textContent = `can't re-parent: ${(err as Error).message}`;
    }
  },
  onRename: (id, label) => {
    const n = doc.graph.nodes.get(id);
    if (n && label) n.label = label;
    renderer.relayout();
    refreshUI();
    if (n && id === selectedNodeId) inspector.show(n); // keep the panel in sync
  },
});

body.append(stage);
app.append(toolbar, body);

const inspector = new Inspector(body, {
  onEdit: () => { renderer.relayout(); refreshUI(); },
  onInterrogate: (t) => interrogate(t),
});

// Interrogation modal — a focused, freeform view over one node or edge.
const modal = new InterrogationModal(app, {
  onChange: () => { renderer.relayout(); refreshUI(); },
  onFocusNode: (id) => {
    renderer.selectNode(id);
    const n = doc.graph.nodes.get(id);
    if (n) modal.openNode(n);
  },
  onFocusEdge: (id) => {
    renderer.selectEdgeById(id);
    const e = doc.graph.edges.get(id);
    if (e) modal.openEdge(e);
  },
});

/** Open the interrogation modal on a node or an edge. */
function interrogate(target: GraphNode | GraphEdge): void {
  if ("relation" in target) modal.openEdge(target);
  else modal.openNode(target);
}

// --- confirmation dialog ----------------------------------------------------

/** A modal yes/no dialog. Resolves true on confirm, false on cancel/Esc/backdrop. */
function confirmDialog(opts: { title: string; body: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "ndmm-modal-overlay";
    const panel = document.createElement("div");
    panel.className = "ndmm-modal ndmm-confirm";
    const title = document.createElement("div");
    title.className = "ndmm-confirm-title";
    title.textContent = opts.title;
    const body = document.createElement("div");
    body.className = "ndmm-confirm-body";
    body.textContent = opts.body;
    const actions = document.createElement("div");
    actions.className = "ndmm-confirm-actions";
    const cancel = document.createElement("button");
    cancel.className = "ndmm-confirm-cancel";
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.className = "ndmm-confirm-ok" + (opts.danger ? " is-danger" : "");
    ok.textContent = opts.confirmLabel;

    const close = (v: boolean) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); close(true); }
    };
    cancel.addEventListener("click", () => close(false));
    ok.addEventListener("click", () => close(true));
    overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) close(false); });
    document.addEventListener("keydown", onKey, true);

    actions.append(cancel, ok);
    panel.append(title, body, actions);
    overlay.append(panel);
    app.append(overlay);
    queueMicrotask(() => ok.focus());
  });
}

/** Human-readable blast radius for a subtree delete. */
function deleteMessage(i: DeleteImpact): string {
  const nodeWord = i.nodes === 1 ? "node" : "nodes";
  let head = i.descendants > 0
    ? `Removes ${i.nodes} ${nodeWord} — this one plus ${i.descendants} descendant${i.descendants === 1 ? "" : "s"}`
    : `Removes this node`;
  if (i.connections > 0) head += ` and ${i.connections} connection${i.connections === 1 ? "" : "s"}`;
  head += ".";
  if (i.severed > 0) {
    head += ` This severs ${i.severed} relationship${i.severed === 1 ? "" : "s"} to ${i.severed === 1 ? "a node" : "nodes"} that will remain.`;
  }
  head += " You can undo this (⌘/Ctrl-Z).";
  return head;
}

// --- file handling (New / Open / Save / Save As) ----------------------------
// Uses the File System Access API where available (Chromium) so Save writes back
// to the same file; falls back to download / file-input elsewhere.

/* eslint-disable @typescript-eslint/no-explicit-any */
const fsa = window as unknown as {
  showOpenFilePicker?: (o?: unknown) => Promise<any[]>;
  showSaveFilePicker?: (o?: unknown) => Promise<any>;
};
const FILE_TYPES = [{ description: "nDMindMap", accept: { "text/markdown": [".md"] } }];

let fileHandle: any = null;
let savedSnapshot = stringify(doc); // serialized doc as of the last save
let currentName = "Untitled";

function isDirty(): boolean {
  return stringify(doc) !== savedSnapshot;
}

function markSaved(): void {
  savedSnapshot = stringify(doc);
  updateFileUI();
}

function updateFileUI(): void {
  const dirty = isDirty();
  const nameEl = toolbar.querySelector<HTMLSpanElement>("#filename");
  if (nameEl) nameEl.textContent = (dirty ? "• " : "") + currentName;
  const saveBtn = toolbar.querySelector<HTMLButtonElement>("#file-save");
  if (saveBtn) saveBtn.disabled = !dirty;
}

function suggestedFileName(): string {
  const base = (doc.title || currentName || "mindmap").trim().replace(/\s+/g, "-").toLowerCase() || "mindmap";
  return `${base}.ndmm.md`;
}

function confirmDiscard(action: string): Promise<boolean> {
  return confirmDialog({
    title: "Discard unsaved changes?",
    body: `“${currentName}” has unsaved changes. ${action} will discard them — Cancel to save first.`,
    confirmLabel: "Discard",
    danger: true,
  });
}

async function writeHandle(handle: any, text: string): Promise<void> {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

async function newFile(): Promise<void> {
  if (isDirty() && !(await confirmDiscard("Starting a new map"))) return;
  applyDoc(parse("# nDMindMap: Untitled\n"));
  fileHandle = null;
  currentName = "Untitled";
  resetHistory();
  markSaved();
  status.textContent = "New map";
}

async function openFile(): Promise<void> {
  if (isDirty() && !(await confirmDiscard("Opening a file"))) return;
  if (fsa.showOpenFilePicker) {
    let handle: any;
    try {
      [handle] = await fsa.showOpenFilePicker({ types: FILE_TYPES });
    } catch { return; } // user cancelled the picker
    const file = await handle.getFile();
    applyDoc(parse(await file.text()));
    fileHandle = handle;
    currentName = handle.name;
    resetHistory();
    markSaved();
    status.textContent = `opened: ${currentName}`;
  } else {
    openViaInput();
  }
}

async function saveFile(): Promise<void> {
  if (!fileHandle) { await saveAsFile(); return; }
  try {
    await writeHandle(fileHandle, stringify(doc));
    markSaved();
    status.textContent = `saved: ${currentName}`;
  } catch (err) {
    status.textContent = `save failed: ${(err as Error).message}`;
  }
}

async function saveAsFile(): Promise<void> {
  const text = stringify(doc);
  if (fsa.showSaveFilePicker) {
    let handle: any;
    try {
      handle = await fsa.showSaveFilePicker({ suggestedName: suggestedFileName(), types: FILE_TYPES });
    } catch { return; } // user cancelled
    await writeHandle(handle, text);
    fileHandle = handle;
    currentName = handle.name;
    markSaved();
    status.textContent = `saved: ${currentName}`;
  } else {
    downloadFallback(text);
    currentName = suggestedFileName();
    markSaved();
  }
}

/** Fallback save for browsers without the File System Access API. */
function downloadFallback(text: string): void {
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedFileName();
  a.click();
  URL.revokeObjectURL(url);
}

/** Fallback open for browsers without the File System Access API. */
function openViaInput(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".md,.ndmm.md,text/markdown,text/plain";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    applyDoc(parse(await file.text()));
    fileHandle = null;
    currentName = file.name;
    resetHistory();
    markSaved();
    status.textContent = `opened: ${currentName}`;
  });
  input.click();
}

/** One refresh for everything that mirrors graph state (bind UI, legend, list). */
function refreshUI(): void {
  refreshBindingUI();
  refreshFilters();
  refreshLint();
  refreshSchema();
  list.render(doc.graph, selectedNodeId);
  scheduleHistory(); // coalesce edits into an undo checkpoint
  updateFileUI(); // reflect dirty state / filename
}

// --- undo / redo (serialized-snapshot history) -----------------------------
// The `.ndmm.md` text is the source of truth, so a snapshot is just stringify()
// and restoring is parse() + remount — the same path as import. Edits within a
// ~400ms burst coalesce into one checkpoint.
let undoStack: string[] = [];
let redoStack: string[] = [];
let baseline = stringify(doc);
let histTimer: number | undefined;

function scheduleHistory(): void {
  if (histTimer !== undefined) clearTimeout(histTimer);
  histTimer = window.setTimeout(commitHistory, 400);
}

function commitHistory(): void {
  if (histTimer !== undefined) { clearTimeout(histTimer); histTimer = undefined; }
  const cur = stringify(doc);
  if (cur === baseline) return; // view-only change, or nothing new
  undoStack.push(baseline);
  if (undoStack.length > 100) undoStack.shift();
  baseline = cur;
  redoStack = [];
  updateHistoryButtons();
}

/** Reset history to the current doc (after import). */
function resetHistory(): void {
  if (histTimer !== undefined) { clearTimeout(histTimer); histTimer = undefined; }
  undoStack = [];
  redoStack = [];
  baseline = stringify(doc);
  updateHistoryButtons();
}

/** Swap in a new document and remount the renderer. Pure view/graph swap — it
 *  touches neither undo history nor file state (callers own those). */
function applyDoc(d: MindMapDoc): void {
  doc = d;
  modal.close();
  renderer.destroy();
  renderer = mount(doc.graph);
  selectedNodeId = null;
  inspector.show(null);
  renderer.focusCanvas();
  refreshBindingUI();
  refreshFilters();
  refreshLint();
  refreshSchema();
  list.render(doc.graph, selectedNodeId);
}

/** Replace the live doc with a serialized snapshot (undo/redo). */
function loadSnapshot(text: string): void {
  applyDoc(parse(text));
}

function undo(): void {
  commitHistory(); // flush any pending burst first
  const prev = undoStack.pop();
  if (prev === undefined) return;
  redoStack.push(baseline);
  baseline = prev;
  loadSnapshot(prev);
  updateHistoryButtons();
  status.textContent = "Undid last change";
}

function redo(): void {
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(baseline);
  baseline = next;
  loadSnapshot(next);
  updateHistoryButtons();
  status.textContent = "Redid change";
}

function updateHistoryButtons(): void {
  const u = toolbar.querySelector<HTMLButtonElement>("#undo");
  const r = toolbar.querySelector<HTMLButtonElement>("#redo");
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}

/** Emergent schema view — node kinds + edge domain/range, derived from the sketch. */
function refreshSchema(): void {
  if (schemaPanel.style.display === "none") return;
  const schema = deriveSchema(doc.graph);
  schemaPanel.replaceChildren();

  const head = document.createElement("div");
  head.className = "ndmm-schema-head";
  head.textContent = "Emergent schema";
  const sub = document.createElement("span");
  sub.className = "ndmm-schema-sub";
  sub.textContent = "derived from the sketch — kind = type, else level";
  head.append(sub);
  schemaPanel.append(head);

  // Node kinds.
  const kindsTitle = document.createElement("div");
  kindsTitle.className = "ndmm-schema-section";
  kindsTitle.textContent = "Node kinds";
  schemaPanel.append(kindsTitle);
  for (const k of schema.kinds) {
    const row = document.createElement("div");
    row.className = "ndmm-schema-kind";
    const name = document.createElement("span");
    name.className = "ndmm-schema-kind-name" + (k.fromType ? " is-type" : "");
    name.textContent = k.kind;
    const count = document.createElement("span");
    count.className = "ndmm-schema-count";
    count.textContent = `×${k.count}`;
    row.append(name, count);
    if (k.dimensions.length) {
      const dims = document.createElement("span");
      dims.className = "ndmm-schema-dims";
      dims.textContent = k.dimensions.join(" · ");
      row.append(dims);
    }
    schemaPanel.append(row);
  }

  // Edge patterns (domain → range).
  const patTitle = document.createElement("div");
  patTitle.className = "ndmm-schema-section";
  patTitle.textContent = "Relations (domain → range)";
  schemaPanel.append(patTitle);
  if (!schema.patterns.length) {
    const none = document.createElement("div");
    none.className = "ndmm-schema-empty";
    none.textContent = "no edges yet";
    schemaPanel.append(none);
  }
  for (const p of schema.patterns) {
    const row = document.createElement("div");
    row.className = "ndmm-schema-pattern";
    row.innerHTML =
      `<span class="ndmm-schema-dom">${escapeHtml(p.domain)}</span>` +
      `<span class="ndmm-schema-rel">--${escapeHtml(p.relation)}--&gt;</span>` +
      `<span class="ndmm-schema-ran">${escapeHtml(p.range)}</span>` +
      `<span class="ndmm-schema-count">×${p.count}</span>`;
    schemaPanel.append(row);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/** Category-error banner — a click jumps to the first offending edge. */
function refreshLint(): void {
  const warnings = renderer?.warnings() ?? [];
  if (!warnings.length) { lintBanner.style.display = "none"; return; }
  lintBanner.style.display = "flex";
  lintBanner.replaceChildren();
  const n = warnings.length;
  const label = document.createElement("span");
  label.className = "ndmm-lint-label";
  label.textContent = `⚠ ${n} category error${n === 1 ? "" : "s"}`;
  const detail = document.createElement("button");
  detail.type = "button";
  detail.className = "ndmm-lint-jump";
  detail.textContent = "review";
  detail.title = "Select the first offending edge";
  detail.addEventListener("click", () => renderer.selectEdgeById(warnings[0].edgeId));
  lintBanner.append(label, detail);
}

/** Dimension filters — one chip per relation type in use; click to show/hide. */
function refreshFilters(): void {
  const types = [...new Set([...renderer.relationTypes(), ...doc.graph.edgeTypes.keys()])].sort();
  if (!types.length) { filters.style.display = "none"; return; }
  filters.style.display = "flex";
  filters.replaceChildren();
  const title = document.createElement("span");
  title.className = "ndmm-filters-title";
  title.textContent = "dimensions:";
  filters.append(title);
  for (const t of types) {
    const hidden = renderer.hiddenRelations.has(t);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ndmm-filter-chip" + (hidden ? " is-hidden" : "");
    chip.textContent = t;
    chip.title = hidden ? `show ${t} edges` : `hide ${t} edges`;
    chip.addEventListener("click", () => {
      renderer.toggleRelation(t);
      refreshFilters();
    });
    filters.append(chip);
  }
}

// --- global attribution (bind color/shape/size to a dimension) -------------

const SHAPE_GLYPHS: Record<string, string> = { rounded: "▢", rect: "▭", pill: "⬭", ellipse: "⬯", diamond: "◇" };
const bindSelects = {
  color: toolbar.querySelector<HTMLSelectElement>("#bind-color")!,
  shape: toolbar.querySelector<HTMLSelectElement>("#bind-shape")!,
  size: toolbar.querySelector<HTMLSelectElement>("#bind-size")!,
};

/** Dimensions a channel can bind to: type, abstraction level, or any attr key in use. */
function dimensionSources(): string[] {
  const keys = new Set<string>();
  for (const n of doc.graph.nodes.values()) {
    for (const k of Object.keys(n.attrs)) {
      if (!RESERVED_ATTRS.has(k)) keys.add(k);
    }
  }
  return ["type", "level", ...[...keys].sort()];
}

/** Rebuild the binding dropdowns + legend from the current graph state. */
function refreshBindingUI(): void {
  const sources = dimensionSources();
  for (const [channel, sel] of Object.entries(bindSelects) as ["color" | "shape" | "size", HTMLSelectElement][]) {
    const current = doc.graph.bindings[channel] ?? "";
    sel.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "—";
    sel.append(none);
    for (const s of sources) {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      sel.append(o);
    }
    // A binding to a dimension no longer in use still shows (and stays valid).
    if (current && !sources.includes(current)) {
      const o = document.createElement("option");
      o.value = current;
      o.textContent = current;
      sel.append(o);
    }
    sel.value = current;
  }

  // Legend for bound channels.
  const data = renderer?.legendData() ?? [];
  if (!data.length) { legend.style.display = "none"; return; }
  legend.style.display = "block";
  legend.replaceChildren();
  for (const group of data) {
    const h = document.createElement("div");
    h.className = "ndmm-legend-title";
    h.textContent = `${group.channel} = ${group.source}`;
    legend.append(h);
    for (const e of group.entries) {
      const row = document.createElement("div");
      row.className = "ndmm-legend-row";
      const chip = document.createElement("span");
      chip.className = "ndmm-legend-chip";
      if (group.channel === "color") chip.style.background = e.channelValue;
      else if (group.channel === "shape") chip.textContent = SHAPE_GLYPHS[e.channelValue] ?? e.channelValue;
      else chip.textContent = e.channelValue.toUpperCase();
      const val = document.createElement("span");
      val.textContent = group.channel === "size" && group.entries.length === 2
        ? `${e.channelValue === "s" ? "min" : "max"} (${e.value})`
        : e.value;
      row.append(chip, val);
      legend.append(row);
    }
  }
}

for (const [channel, sel] of Object.entries(bindSelects) as ["color" | "shape" | "size", HTMLSelectElement][]) {
  sel.addEventListener("change", () => {
    if (sel.value) doc.graph.bindings[channel] = sel.value;
    else delete doc.graph.bindings[channel];
    renderer.relayout();
    refreshUI();
  });
}

function mount(graph: Graph): Renderer {
  inspector.setGraph(graph);
  modal.setGraph(graph);
  return new Renderer(stage, graph, {
    onInterrogate: (t) => interrogate(t),
    confirmDelete: (impact) => confirmDialog({
      title: `Delete “${impact.rootLabel || "(unnamed)"}”?`,
      body: deleteMessage(impact),
      confirmLabel: "Delete",
      danger: true,
    }),
    onSelect: (n) => {
      selectedNodeId = n?.id ?? null;
      status.textContent = n
        ? `${n.label || "(unnamed)"} — Tab child · Enter sibling · F2 rename · L link`
        : IDLE_HINT;
      inspector.show(n);
      list.render(graph, selectedNodeId);
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
    onChange: () => refreshUI(),
  });
}

renderer = mount(doc.graph);
renderer.focusCanvas();
refreshUI();
// The first layout assigns node @x,y positions, so re-baseline history and the
// saved-marker to the laid-out doc — otherwise it reads as dirty on load.
resetHistory();
markSaved();

// --- toolbar --------------------------------------------------------------

toolbar.querySelector("#add")!.addEventListener("click", () => {
  renderer.focusCanvas();
  renderer.createRoot();
});

toolbar.querySelector("#link")!.addEventListener("click", () => {
  if (!renderer.selected) { status.textContent = "Select a node first, then Link (or press L)"; return; }
  renderer.focusCanvas();
  renderer.startLink();
});

toolbar.querySelector("#tidy")!.addEventListener("click", () => renderer.tidy());

toolbar.querySelector("#undo")!.addEventListener("click", () => { undo(); renderer.focusCanvas(); });
toolbar.querySelector("#redo")!.addEventListener("click", () => { redo(); renderer.focusCanvas(); });

// File menu.
toolbar.querySelector("#file-new")!.addEventListener("click", () => void newFile());
toolbar.querySelector("#file-open")!.addEventListener("click", () => void openFile());
toolbar.querySelector("#file-save")!.addEventListener("click", () => void saveFile());
toolbar.querySelector("#file-saveas")!.addEventListener("click", () => void saveAsFile());

// ⌘/Ctrl-S save, ⌘/Ctrl-Shift-S save-as (work regardless of focus);
// ⌘/Ctrl-Z undo, ⌘/Ctrl-Shift-Z (or Ctrl-Y) redo — skipped while a text field
// is focused so the browser's native text undo keeps working there.
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const key = e.key.toLowerCase();
  if (key === "s") { e.preventDefault(); void (e.shiftKey ? saveAsFile() : saveFile()); return; }
  const el = document.activeElement as HTMLElement | null;
  const inField = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  if (inField) return;
  if (key === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (key === "y") { e.preventDefault(); redo(); }
});

// Warn before leaving with unsaved changes.
window.addEventListener("beforeunload", (e) => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ""; }
});

toolbar.querySelector<HTMLInputElement>("#grid")!.addEventListener("change", (e) => {
  renderer.setGrid((e.target as HTMLInputElement).checked);
});

toolbar.querySelector<HTMLInputElement>("#list")!.addEventListener("change", (e) => {
  list.setVisible((e.target as HTMLInputElement).checked);
  if (list.visible) list.render(doc.graph, selectedNodeId);
});

toolbar.querySelector<HTMLInputElement>("#schema")!.addEventListener("change", (e) => {
  schemaPanel.style.display = (e.target as HTMLInputElement).checked ? "block" : "none";
  refreshSchema();
});

// Expose internals for console poking / tests (mirrors RiffRaft's window.__mic).
(window as unknown as { __ndmm: unknown }).__ndmm = {
  doc: () => doc,
  stringify: () => stringify(doc),
  parse: (text: string) => parse(text),
  renderer: () => renderer,
  undo,
  redo,
  history: () => ({ undo: undoStack.length, redo: redoStack.length }),
  Graph,
};
