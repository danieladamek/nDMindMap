/**
 * nDMindMap renderer — Phase 1: a keyboard-first, left-to-right mind map.
 *
 * Responsibilities:
 *   - lay out the `child-of` tree (via layout.ts) and draw it as pill nodes with
 *     smooth parent→child connectors; draw non-`child-of` edges as dashed
 *     cross-links (the beginnings of the "nD" overlay),
 *   - own selection + the keyboard capture loop (tab = child, enter = sibling,
 *     arrows = navigate, F2 = rename, delete = remove subtree),
 *   - inline-edit labels with a floating <input>,
 *   - let a node be dragged to pin it (free placement, snap-to-grid optional).
 *
 * The renderer mutates the graph directly and calls `onChange` after any edit so
 * the shell can persist / mark dirty. No animation loop — layout is static and
 * recomputed on demand (mind maps don't need a physics sim).
 */

import type { Graph, GraphNode, GraphEdge } from "./model.js";
import { CHILD_OF } from "./model.js";
import { layoutTree, isPinned } from "./layout.js";
import { nodeShape, nodeColor, nodeScale, nodeType, contrastText, type Shape } from "./visuals.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_H = 34;
const PAD_X = 14;
const MIN_W = 54;

export interface RendererOptions {
  onSelect?: (node: GraphNode | null) => void;
  onSelectEdge?: (edge: GraphEdge | null) => void;
  onLinkModeChange?: (active: boolean) => void;
  onChange?: () => void;
  gridSize?: number;
}

export class Renderer {
  private svg: SVGSVGElement;
  private gridRect: SVGRectElement;
  private edgeLayer: SVGGElement;
  private nodeLayer: SVGGElement;
  private editor: HTMLInputElement;

  private selectedId: string | null = null;
  private selectedEdgeId: string | null = null;
  private linkingFrom: string | null = null;
  private editing = false;
  private editingIsNew = false;
  private grid = false;
  private gridSize: number;

  private measureCtx = document.createElement("canvas").getContext("2d")!;

  constructor(private host: HTMLElement, private graph: Graph, private opts: RendererOptions = {}) {
    this.gridSize = opts.gridSize ?? 20;

    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "ndmm-canvas");
    this.svg.setAttribute("tabindex", "-1");
    this.svg.innerHTML = `<defs><pattern id="ndmm-grid" width="${this.gridSize}" height="${this.gridSize}" patternUnits="userSpaceOnUse"><path d="M ${this.gridSize} 0 L 0 0 0 ${this.gridSize}" fill="none" class="ndmm-gridline"/></pattern></defs>`;
    this.gridRect = document.createElementNS(SVG_NS, "rect");
    this.gridRect.setAttribute("class", "ndmm-gridbg");
    this.gridRect.setAttribute("x", "0");
    this.gridRect.setAttribute("y", "0");
    this.gridRect.setAttribute("width", "100%");
    this.gridRect.setAttribute("height", "100%");
    this.gridRect.setAttribute("fill", "url(#ndmm-grid)");
    this.gridRect.style.display = "none";
    this.edgeLayer = document.createElementNS(SVG_NS, "g");
    this.nodeLayer = document.createElementNS(SVG_NS, "g");
    this.svg.append(this.gridRect, this.edgeLayer, this.nodeLayer);
    host.append(this.svg);

    // The stage div owns keyboard focus (a focusable div is universally reliable
    // for key events — more so than a focused <svg>). Keys bubble here whether the
    // svg or the div itself is focused.
    host.setAttribute("tabindex", "-1");

    this.editor = document.createElement("input");
    this.editor.className = "ndmm-edit";
    this.editor.style.display = "none";
    host.append(this.editor);
    this.bindEditor();

    this.bindPointer();
    this.bindKeys();

    // First layout once the stage has a real size (CSS grid resolves late).
    const ro = new ResizeObserver(() => this.relayout());
    ro.observe(host);
    this.relayout();
  }

  // --- measurement ----------------------------------------------------------

  private nodeWidth(n: GraphNode): number {
    const scale = nodeScale(n);
    this.measureCtx.font = `${13 * scale}px -apple-system, system-ui, sans-serif`;
    const w = this.measureCtx.measureText(n.label || "…").width;
    const base = Math.max(MIN_W * scale, Math.ceil(w) + PAD_X * 2 * scale);
    // Round shapes need extra width to keep the label inside the outline.
    const shape = nodeShape(n);
    return shape === "diamond" ? base * 1.5 : shape === "ellipse" ? base * 1.3 : base;
  }

  private nodeHeight(n: GraphNode): number {
    const h = NODE_H * nodeScale(n);
    return nodeShape(n) === "diamond" ? h * 1.4 : h;
  }

  /** Build the outline element for a shape, positioned with (x, y) = left-edge /
   *  vertical-center of the bounding box. */
  private makeShape(shape: Shape, x: number, y: number, w: number, h: number): SVGElement {
    const cx = x + w / 2;
    if (shape === "ellipse") {
      const el = document.createElementNS(SVG_NS, "ellipse");
      el.setAttribute("cx", String(cx));
      el.setAttribute("cy", String(y));
      el.setAttribute("rx", String(w / 2));
      el.setAttribute("ry", String(h / 2));
      return el;
    }
    if (shape === "diamond") {
      const el = document.createElementNS(SVG_NS, "polygon");
      el.setAttribute("points", `${x},${y} ${cx},${y - h / 2} ${x + w},${y} ${cx},${y + h / 2}`);
      return el;
    }
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y - h / 2));
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", shape === "rect" ? "0" : shape === "pill" ? String(h / 2) : "8");
    return rect;
  }

  // --- layout + draw --------------------------------------------------------

  /** Recompute tree positions and redraw. */
  relayout(): void {
    const bounds = layoutTree(this.graph);
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(bounds.width, rect.width || 0);
    const h = Math.max(bounds.height, rect.height || 0);
    this.svg.setAttribute("width", String(w));
    this.svg.setAttribute("height", String(h));
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this.draw();
  }

  private draw(): void {
    this.edgeLayer.replaceChildren();
    this.nodeLayer.replaceChildren();

    // Edges: child-of as smooth connectors, others as dashed cross-links.
    for (const e of this.graph.edges.values()) {
      const a = this.graph.nodes.get(e.source);
      const b = this.graph.nodes.get(e.target);
      if (!a || !b) continue;

      if (e.relation === CHILD_OF) {
        // parent (b) right edge → child (a) left edge
        const px = (b.x ?? 0) + this.nodeWidth(b);
        const py = b.y ?? 0;
        const cx = a.x ?? 0;
        const cy = a.y ?? 0;
        const mid = (px + cx) / 2;
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", `M ${px} ${py} C ${mid} ${py}, ${mid} ${cy}, ${cx} ${cy}`);
        path.setAttribute("class", "ndmm-edge");
        this.edgeLayer.append(path);
      } else {
        const ax = (a.x ?? 0) + this.nodeWidth(a) / 2;
        const bx = (b.x ?? 0) + this.nodeWidth(b) / 2;
        const mx = (ax + bx) / 2;
        const my = ((a.y ?? 0) + (b.y ?? 0)) / 2;
        const cg = document.createElementNS(SVG_NS, "g");
        cg.setAttribute("class", "ndmm-crosslink-g" + (e.id === this.selectedEdgeId ? " is-selected" : ""));
        cg.dataset.edgeId = e.id;

        // Wide transparent hit line so a thin dashed edge is easy to click.
        const hit = document.createElementNS(SVG_NS, "line");
        for (const [k, v] of [["x1", ax], ["y1", a.y], ["x2", bx], ["y2", b.y]] as const) hit.setAttribute(k, String(v));
        hit.setAttribute("class", "ndmm-crosslink-hit");
        cg.append(hit);

        const line = document.createElementNS(SVG_NS, "line");
        for (const [k, v] of [["x1", ax], ["y1", a.y], ["x2", bx], ["y2", b.y]] as const) line.setAttribute(k, String(v));
        line.setAttribute("class", "ndmm-crosslink");
        cg.append(line);

        const label = document.createElementNS(SVG_NS, "text");
        label.setAttribute("x", String(mx));
        label.setAttribute("y", String(my - 4));
        label.setAttribute("class", "ndmm-edge-label");
        label.textContent = e.relation || "…";
        cg.append(label);
        this.edgeLayer.append(cg);
      }
    }

    // Nodes.
    for (const n of this.graph.nodes.values()) {
      const w = this.nodeWidth(n);
      const h = this.nodeHeight(n);
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const scale = nodeScale(n);
      const color = nodeColor(n);

      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("class", "ndmm-node" + (n.id === this.selectedId ? " is-selected" : "") + (isPinned(n) ? " is-pinned" : ""));
      g.dataset.id = n.id;

      const shape = this.makeShape(nodeShape(n), x, y, w, h);
      if (color) {
        shape.style.fill = color;
        shape.style.stroke = color;
      }
      g.append(shape);

      // Type tag above the node (a first taste of node typing).
      const t = nodeType(n);
      if (t) {
        const tag = document.createElementNS(SVG_NS, "text");
        tag.setAttribute("x", String(x + w / 2));
        tag.setAttribute("y", String(y - h / 2 - 5));
        tag.setAttribute("class", "ndmm-node-type");
        tag.textContent = t;
        g.append(tag);
      }

      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", String(x + w / 2));
      text.setAttribute("y", String(y));
      text.setAttribute("class", "ndmm-node-label");
      text.style.fontSize = `${13 * scale}px`;
      if (color) text.style.fill = contrastText(color);
      text.textContent = n.label || "…";
      g.append(text);

      this.nodeLayer.append(g);
    }
  }

  // --- selection ------------------------------------------------------------

  private select(id: string | null): void {
    this.selectedId = id;
    this.selectedEdgeId = null;
    this.opts.onSelect?.(id ? this.graph.nodes.get(id) ?? null : null);
    this.draw();
  }

  private selectEdge(id: string): void {
    const e = this.graph.edges.get(id);
    if (!e) return;
    this.selectedEdgeId = id;
    this.selectedId = null;
    this.opts.onSelectEdge?.(e);
    this.draw();
  }

  get selected(): GraphNode | null {
    return this.selectedId ? this.graph.nodes.get(this.selectedId) ?? null : null;
  }

  // --- typed cross-links (P1.5) --------------------------------------------

  /** Arm "link mode": the next node click draws a typed edge from the selected
   *  node to it. Only meaningful with a node selected. */
  startLink(): void {
    if (!this.selectedId) return;
    this.linkingFrom = this.selectedId;
    this.host.classList.add("is-linking");
    this.opts.onLinkModeChange?.(true);
  }

  private cancelLink(): void {
    if (!this.linkingFrom) return;
    this.linkingFrom = null;
    this.host.classList.remove("is-linking");
    this.opts.onLinkModeChange?.(false);
  }

  private completeLink(targetId: string): void {
    const from = this.linkingFrom;
    this.cancelLink();
    if (!from || from === targetId) return;
    const edge = this.graph.addEdge({ source: from, target: targetId, relation: "relates-to" });
    this.changed();
    this.relayout();
    this.selectEdge(edge.id); // opens the edge editor to name the relation
  }

  /** Remove an edge (used by the edge editor's Delete). */
  deleteEdge(id: string): void {
    this.graph.removeEdge(id);
    this.changed();
    this.relayout();
    this.select(null);
  }

  /** Distinct relation types already in use, for the type picker. */
  relationTypes(): string[] {
    const set = new Set<string>();
    for (const e of this.graph.edges.values()) if (e.relation !== CHILD_OF) set.add(e.relation);
    return [...set].sort();
  }

  // --- capture operations ---------------------------------------------------

  private addChild(parentId: string): GraphNode {
    const child = this.graph.addNode({ label: "" });
    this.graph.setParent(child.id, parentId);
    this.changed();
    this.relayout();
    this.select(child.id);
    this.startEdit(child.id, true);
    return child;
  }

  private addSibling(nodeId: string): GraphNode {
    const parent = this.graph.parentOf(nodeId);
    if (parent) return this.addChild(parent.id);
    // A root's sibling is another root (no child-of edge).
    const root = this.graph.addNode({ label: "" });
    this.changed();
    this.relayout();
    this.select(root.id);
    this.startEdit(root.id, true);
    return root;
  }

  private deleteSelected(): void {
    if (!this.selectedId) return;
    const parent = this.graph.parentOf(this.selectedId);
    const siblings = parent ? this.graph.childrenOf(parent.id) : this.graph.roots();
    const idx = siblings.findIndex((s) => s.id === this.selectedId);
    this.graph.removeSubtree(this.selectedId);
    this.changed();
    const next = parent ?? siblings[idx + 1] ?? siblings[idx - 1] ?? this.graph.roots()[0] ?? null;
    this.relayout();
    this.select(next ? next.id : null);
  }

  private changed(): void {
    this.opts.onChange?.();
  }

  // --- inline editor --------------------------------------------------------

  private startEdit(id: string, isNew = false): void {
    const n = this.graph.nodes.get(id);
    if (!n) return;
    this.editing = true;
    this.editingIsNew = isNew;
    this.selectedId = id;

    const w = Math.max(this.nodeWidth(n), 90);
    this.editor.style.display = "block";
    this.editor.style.left = `${n.x ?? 0}px`;
    this.editor.style.top = `${(n.y ?? 0) - NODE_H / 2 - this.host.scrollTop}px`;
    this.editor.style.width = `${w}px`;
    this.editor.style.height = `${NODE_H}px`;
    this.editor.value = n.label;
    this.editor.focus();
    this.editor.select();
  }

  private commitEdit(): void {
    if (!this.editing || !this.selectedId) return;
    const n = this.graph.nodes.get(this.selectedId);
    if (n) {
      n.label = this.editor.value.trim();
      this.changed();
    }
    this.finishEdit();
  }

  private cancelEdit(): void {
    if (this.editing && this.editingIsNew && this.selectedId) {
      const n = this.graph.nodes.get(this.selectedId);
      if (n && !n.label.trim()) {
        const parent = this.graph.parentOf(this.selectedId);
        this.graph.removeSubtree(this.selectedId);
        this.selectedId = parent ? parent.id : null;
        this.changed();
      }
    }
    this.finishEdit();
  }

  private finishEdit(): void {
    this.editing = false;
    this.editingIsNew = false;
    this.editor.style.display = "none";
    this.relayout();
    this.opts.onSelect?.(this.selected);
    this.host.focus();
  }

  private bindEditor(): void {
    this.editor.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const id = this.selectedId;
        this.commitEdit();
        if (id) this.addSibling(id);
      } else if (e.key === "Tab") {
        e.preventDefault();
        const id = this.selectedId;
        this.commitEdit();
        if (id) this.addChild(id);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancelEdit();
      }
    });
    this.editor.addEventListener("blur", () => {
      if (this.editing) this.commitEdit();
    });
  }

  // --- keyboard navigation / capture ---------------------------------------

  private bindKeys(): void {
    // Keys are bound to the focusable stage div, so they fire exactly when the
    // canvas has focus — no global "active" flag to keep in sync. While the inline
    // editor (<input>) is focused, `editing` is true and we bail (its own handler
    // runs), so bubbling from the input never double-fires.
    this.host.addEventListener("keydown", (e) => {
      if (this.editing) return;
      const sel = this.selectedId;
      switch (e.key) {
        case "Tab":
          e.preventDefault();
          if (sel) this.addChild(sel);
          else this.createRoot();
          break;
        case "Enter":
          e.preventDefault();
          if (sel) this.addSibling(sel);
          else this.createRoot();
          break;
        case "l":
        case "L":
          if (sel) { e.preventDefault(); this.startLink(); }
          break;
        case "Escape":
          if (this.linkingFrom) { e.preventDefault(); this.cancelLink(); }
          else if (this.selectedId || this.selectedEdgeId) { e.preventDefault(); this.select(null); }
          break;
        case "F2":
          e.preventDefault();
          if (sel) this.startEdit(sel);
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          if (this.selectedEdgeId) this.deleteEdge(this.selectedEdgeId);
          else this.deleteSelected();
          break;
        case "ArrowLeft": {
          e.preventDefault();
          if (sel) { const p = this.graph.parentOf(sel); if (p) this.select(p.id); }
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          if (sel) { const c = this.graph.childrenOf(sel)[0]; if (c) this.select(c.id); }
          break;
        }
        case "ArrowUp":
          e.preventDefault();
          this.moveSibling(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          this.moveSibling(1);
          break;
      }
    });
  }

  private createRoot(): void {
    const root = this.graph.addNode({ label: "" });
    this.changed();
    this.relayout();
    this.select(root.id);
    this.startEdit(root.id, true);
  }

  private moveSibling(dir: -1 | 1): void {
    if (!this.selectedId) { const r = this.graph.roots()[0]; if (r) this.select(r.id); return; }
    const parent = this.graph.parentOf(this.selectedId);
    const sibs = parent ? this.graph.childrenOf(parent.id) : this.graph.roots();
    const i = sibs.findIndex((s) => s.id === this.selectedId);
    const next = sibs[i + dir];
    if (next) this.select(next.id);
  }

  // --- pointer: select, focus, drag-to-pin ---------------------------------

  private bindPointer(): void {
    let dragging: string | null = null;
    let moved = false;
    let offX = 0;
    let offY = 0;

    this.svg.addEventListener("pointerdown", (e) => {
      this.host.focus(); // stage owns the keyboard while focused
      if (this.linkingFrom) return; // click handler completes/cancels the link
      if ((e.target as Element).closest("[data-edge-id]")) return; // edge → let click select it
      const target = (e.target as Element).closest(".ndmm-node") as SVGGElement | null;
      if (!target?.dataset.id) { this.select(null); return; }
      const n = this.graph.nodes.get(target.dataset.id);
      if (!n) return;
      dragging = n.id;
      moved = false;
      this.select(n.id);
      const pt = this.toLocal(e);
      offX = pt.x - (n.x ?? 0);
      offY = pt.y - (n.y ?? 0);
      this.svg.setPointerCapture(e.pointerId);
    });

    this.svg.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const n = this.graph.nodes.get(dragging);
      if (!n) return;
      moved = true;
      const pt = this.toLocal(e);
      let nx = pt.x - offX;
      let ny = pt.y - offY;
      if (this.grid) {
        nx = Math.round(nx / this.gridSize) * this.gridSize;
        ny = Math.round(ny / this.gridSize) * this.gridSize;
      }
      n.x = nx;
      n.y = ny;
      n.attrs.pinned = true; // hand-placed → pinned, layout leaves it alone
      this.draw();
    });

    const end = (e: PointerEvent) => {
      if (dragging) {
        this.svg.releasePointerCapture(e.pointerId);
        if (moved) this.changed();
      }
      dragging = null;
    };
    this.svg.addEventListener("pointerup", end);
    this.svg.addEventListener("pointercancel", end);

    this.svg.addEventListener("dblclick", (e) => {
      const target = (e.target as Element).closest(".ndmm-node") as SVGGElement | null;
      if (target?.dataset.id) this.startEdit(target.dataset.id);
    });

    // Selection also on `click` — pointerdown drives drag, but not every input
    // path (some automation / assistive tech) emits pointer events, whereas click
    // is universal. Idempotent with the pointerdown selection above.
    this.svg.addEventListener("click", (e) => {
      this.host.focus();
      const nodeEl = (e.target as Element).closest(".ndmm-node") as SVGGElement | null;
      const edgeEl = (e.target as Element).closest("[data-edge-id]") as SVGGElement | null;
      if (this.linkingFrom) {
        if (nodeEl?.dataset.id) this.completeLink(nodeEl.dataset.id);
        else this.cancelLink();
        return;
      }
      if (nodeEl?.dataset.id) this.select(nodeEl.dataset.id);
      else if (edgeEl?.dataset.edgeId) this.selectEdge(edgeEl.dataset.edgeId);
      else this.select(null);
    });
  }

  private toLocal(e: PointerEvent): { x: number; y: number } {
    const rect = this.svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // --- public controls (toolbar) -------------------------------------------

  /** Re-run the tidy layout, clearing all hand-placed pins. */
  tidy(): void {
    for (const n of this.graph.nodes.values()) delete n.attrs.pinned;
    this.changed();
    this.relayout();
  }

  setGrid(on: boolean): void {
    this.grid = on;
    this.gridRect.style.display = on ? "block" : "none";
  }

  focusCanvas(): void {
    this.host.focus();
  }

  destroy(): void {
    this.editor.remove();
    this.svg.remove();
  }
}
