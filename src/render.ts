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
import { CHILD_OF, MENTIONS } from "./model.js";
import { layoutTree, isPinned } from "./layout.js";
import { ChannelResolver, nodeType, contrastText, type Shape } from "./visuals.js";
import { lintGraph, type LintWarning } from "./lint.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_H = 34;
const PAD_X = 14;
const MIN_W = 54;

/** What deleting a node's subtree would cost — shown in the delete warning. */
export interface DeleteImpact {
  rootLabel: string;
  nodes: number; // total nodes removed (root + descendants)
  descendants: number; // nodes - 1
  connections: number; // total edges removed
  severed: number; // typed (non child-of) links to nodes that will survive
}

export interface RendererOptions {
  onSelect?: (node: GraphNode | null) => void;
  onSelectEdge?: (edge: GraphEdge | null) => void;
  onLinkModeChange?: (active: boolean) => void;
  onChange?: () => void;
  /** Open the interrogation modal on the selected node or edge (the `I` key). */
  onInterrogate?: (target: GraphNode | GraphEdge) => void;
  /** Confirm a non-trivial subtree delete; resolve false to cancel. */
  confirmDelete?: (impact: DeleteImpact) => Promise<boolean>;
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
  /** Relation types currently hidden on the canvas (view state, not doc state). */
  readonly hiddenRelations = new Set<string>();
  private editing = false;
  private editingIsNew = false;
  private grid = false;
  private gridSize: number;

  private measureCtx = document.createElement("canvas").getContext("2d")!;
  private resolver: ChannelResolver;
  /** Category-error warnings from the last draw (see lint.ts). */
  private lastWarnings: LintWarning[] = [];

  constructor(private host: HTMLElement, private graph: Graph, private opts: RendererOptions = {}) {
    this.gridSize = opts.gridSize ?? 20;
    this.resolver = new ChannelResolver(graph);
    // Prose-link edges start hidden so notes don't clutter the map; the dimension
    // filter chip reveals them on demand.
    this.hiddenRelations.add(MENTIONS);

    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "ndmm-canvas");
    this.svg.setAttribute("tabindex", "-1");
    // The arrowhead marker uses `context-stroke` so it inherits each edge's own
    // colour (crosslink violet, or danger red for a category error). `orient`
    // auto-start-reverse lets one marker serve both ends of a bidirectional edge.
    this.svg.innerHTML = `<defs>` +
      `<pattern id="ndmm-grid" width="${this.gridSize}" height="${this.gridSize}" patternUnits="userSpaceOnUse"><path d="M ${this.gridSize} 0 L 0 0 0 ${this.gridSize}" fill="none" class="ndmm-gridline"/></pattern>` +
      `<marker id="ndmm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker>` +
      `</defs>`;
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
    const scale = this.resolver.scale(n);
    this.measureCtx.font = `${13 * scale}px -apple-system, system-ui, sans-serif`;
    const w = this.measureCtx.measureText(n.label || "…").width;
    const base = Math.max(MIN_W * scale, Math.ceil(w) + PAD_X * 2 * scale);
    // Round shapes need extra width to keep the label inside the outline.
    const shape = this.resolver.shape(n);
    return shape === "diamond" ? base * 1.5 : shape === "ellipse" ? base * 1.3 : base;
  }

  private nodeHeight(n: GraphNode): number {
    const h = NODE_H * this.resolver.scale(n);
    return this.resolver.shape(n) === "diamond" ? h * 1.4 : h;
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
    // Fresh resolver each draw so binding/attr changes always take effect.
    this.resolver = new ChannelResolver(this.graph);
    // Category-error lint, recomputed per draw — always in sync with levels/edges.
    this.lastWarnings = lintGraph(this.graph);
    const warnedEdges = new Set(this.lastWarnings.map((w) => w.edgeId));
    this.edgeLayer.replaceChildren();
    this.nodeLayer.replaceChildren();

    // Cross-links sharing a node pair are fanned apart so their lines and labels
    // don't stack (a single edge stays straight). Group first, then index within.
    const pairGroups = new Map<string, string[]>();
    for (const e of this.graph.edges.values()) {
      if (e.relation === CHILD_OF) continue;
      const key = [e.source, e.target].slice().sort().join("::");
      const g = pairGroups.get(key) ?? [];
      g.push(e.id);
      pairGroups.set(key, g);
    }

    // Edges: child-of as smooth connectors, others as dashed cross-links. Both
    // are now selectable (a tree connector opens the edge editor, where deleting
    // it makes the child a root and retyping it converts it into a dimension).
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
        const d = `M ${px} ${py} C ${mid} ${py}, ${mid} ${cy}, ${cx} ${cy}`;
        const cg = document.createElementNS(SVG_NS, "g");
        cg.setAttribute("class", "ndmm-tree-edge-g" + (e.id === this.selectedEdgeId ? " is-selected" : ""));
        cg.dataset.edgeId = e.id;
        const hit = document.createElementNS(SVG_NS, "path");
        hit.setAttribute("d", d);
        hit.setAttribute("class", "ndmm-tree-hit");
        cg.append(hit);
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        path.setAttribute("class", "ndmm-edge");
        cg.append(path);
        this.edgeLayer.append(cg);
      } else {
        if (this.hiddenRelations.has(e.relation)) continue; // filtered dimension
        const ax = (a.x ?? 0) + this.nodeWidth(a) / 2;
        const ay = a.y ?? 0;
        const bx = (b.x ?? 0) + this.nodeWidth(b) / 2;
        const by = b.y ?? 0;

        // Fan-out: offset the curve's apex perpendicular to the line by this
        // edge's slot in its node-pair group. One edge → offset 0 → straight.
        const key = [e.source, e.target].slice().sort().join("::");
        const group = pairGroups.get(key) ?? [e.id];
        const idx = group.indexOf(e.id);
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len; // unit direction a→b
        const nx = -dy / len, ny = dx / len; // unit normal
        const off = (idx - (group.length - 1) / 2) * 26;

        // Directionality (reserved `dir` attr): pull the arrow end(s) back to the
        // node boundary so the arrowhead clears the box. `both` = bidirectional.
        const bidir = e.attrs.dir === "both";
        const insetB = Math.min(this.nodeWidth(b), this.nodeHeight(b)) / 2 + 4;
        const insetA = bidir ? Math.min(this.nodeWidth(a), this.nodeHeight(a)) / 2 + 4 : 0;
        const sx = ax + ux * insetA, sy = ay + uy * insetA;
        const ex = bx - ux * insetB, ey = by - uy * insetB;

        // Quadratic control at 2× the apex offset so the curve peaks at its middle.
        const cxq = (sx + ex) / 2 + nx * off * 2;
        const cyq = (sy + ey) / 2 + ny * off * 2;
        const d = `M ${sx} ${sy} Q ${cxq} ${cyq} ${ex} ${ey}`;
        // Stagger each sibling edge's label *along* its curve (different t) so a
        // stack of relations on one short edge reads instead of overprinting.
        const t = (idx + 1) / (group.length + 1);
        const mt = 1 - t;
        const mx = mt * mt * sx + 2 * mt * t * cxq + t * t * ex;
        const my = mt * mt * sy + 2 * mt * t * cyq + t * t * ey;

        const cg = document.createElementNS(SVG_NS, "g");
        const warned = warnedEdges.has(e.id);
        cg.setAttribute("class", "ndmm-crosslink-g" + (e.id === this.selectedEdgeId ? " is-selected" : "") + (warned ? " is-warning" : ""));
        cg.dataset.edgeId = e.id;

        // Wide transparent hit path so a thin dashed edge is easy to click.
        const hit = document.createElementNS(SVG_NS, "path");
        hit.setAttribute("d", d);
        hit.setAttribute("class", "ndmm-crosslink-hit");
        cg.append(hit);

        const line = document.createElementNS(SVG_NS, "path");
        line.setAttribute("d", d);
        line.setAttribute("class", "ndmm-crosslink");
        line.setAttribute("marker-end", "url(#ndmm-arrow)");
        if (bidir) line.setAttribute("marker-start", "url(#ndmm-arrow)");
        cg.append(line);

        const label = document.createElementNS(SVG_NS, "text");
        label.setAttribute("x", String(mx));
        label.setAttribute("y", String(my - 4));
        label.setAttribute("class", "ndmm-edge-label");
        label.textContent = warned ? `⚠ ${e.relation || "…"}` : (e.relation || "…");
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
      const scale = this.resolver.scale(n);
      const color = this.resolver.color(n);

      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("class", "ndmm-node" + (n.id === this.selectedId ? " is-selected" : "") + (isPinned(n) ? " is-pinned" : ""));
      g.dataset.id = n.id;

      const shape = this.makeShape(this.resolver.shape(n), x, y, w, h);
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

  /** Programmatic selection (e.g. from the list view). Fires onSelect. */
  selectNode(id: string | null): void {
    this.select(id);
  }

  /** Programmatic edge selection (e.g. from the lint banner). */
  selectEdgeById(id: string): void {
    this.selectEdge(id);
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

  /** Show/hide one relation type on the canvas (dimension filter). Deselects a
   *  hidden edge so the inspector never edits something invisible. */
  toggleRelation(relation: string): void {
    if (this.hiddenRelations.has(relation)) this.hiddenRelations.delete(relation);
    else {
      this.hiddenRelations.add(relation);
      const sel = this.selectedEdgeId ? this.graph.edges.get(this.selectedEdgeId) : null;
      if (sel && sel.relation === relation) this.select(null);
    }
    this.draw();
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

  /** Nodes and edges a subtree delete of `id` would remove. */
  private deleteImpact(id: string): DeleteImpact {
    const subtree = new Set<string>();
    const walk = (nid: string) => { subtree.add(nid); for (const c of this.graph.childrenOf(nid)) walk(c.id); };
    walk(id);
    let connections = 0, severed = 0;
    for (const e of this.graph.edges.values()) {
      const sIn = subtree.has(e.source), tIn = subtree.has(e.target);
      if (!sIn && !tIn) continue;
      connections++;
      // A typed relationship from inside the subtree to a surviving node is a
      // "breakage" worth flagging (the child-of link to the parent is expected).
      if (sIn !== tIn && e.relation !== CHILD_OF) severed++;
    }
    return {
      rootLabel: this.graph.nodes.get(id)?.label || id,
      nodes: subtree.size,
      descendants: subtree.size - 1,
      connections,
      severed,
    };
  }

  private async deleteSelected(): Promise<void> {
    const id = this.selectedId;
    if (!id) return;
    const impact = this.deleteImpact(id);
    // Warn before anything but a lone, unconnected leaf — and show the blast radius.
    const nonTrivial = impact.descendants > 0 || impact.severed > 0 || impact.connections > 1;
    if (nonTrivial && this.opts.confirmDelete) {
      const ok = await this.opts.confirmDelete(impact);
      if (!ok) return;
      if (this.selectedId !== id || !this.graph.nodes.has(id)) return; // changed during confirm
    }
    const parent = this.graph.parentOf(id);
    const siblings = parent ? this.graph.childrenOf(parent.id) : this.graph.roots();
    const idx = siblings.findIndex((s) => s.id === id);
    this.graph.removeSubtree(id);
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
      // These keys are fully handled here; stop them bubbling to the stage's
      // key handler, which would otherwise re-fire once `commitEdit` clears the
      // `editing` guard (a single Return would both commit *and* make a sibling).
      if (e.key === "Enter" && !e.shiftKey) {
        // Return just *commits* the label and drops back to the selected node.
        // A second Return (canvas-focused) is what creates a sibling — so you
        // can finish a label without spawning an empty node you didn't want.
        e.preventDefault();
        e.stopPropagation();
        this.commitEdit();
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        const id = this.selectedId;
        this.commitEdit();
        if (id) this.addChild(id);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
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
        case "i":
        case "I":
          if (this.selectedEdgeId) {
            const ed = this.graph.edges.get(this.selectedEdgeId);
            if (ed) { e.preventDefault(); this.opts.onInterrogate?.(ed); }
          } else if (sel) {
            const n = this.graph.nodes.get(sel);
            if (n) { e.preventDefault(); this.opts.onInterrogate?.(n); }
          }
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
          else void this.deleteSelected();
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

  /** Create a new, unparented root node and start editing it. Public so the
   *  toolbar's +Root can call it directly (dispatching a synthetic key event to
   *  `document` never reached the stage's own key listener). */
  createRoot(): void {
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
    // Double-click-to-edit is detected here on `pointerdown`, not via the native
    // `dblclick`/`click` events: selecting a node redraws and `replaceChildren()`
    // removes the pointer target before `pointerup`, so the browser fires neither
    // `click` nor `dblclick`. Two pointerdowns on the same node, though, do arrive.
    let lastDownId: string | null = null;
    let lastDownTime = 0;
    const DOUBLE_MS = 400;
    // Re-parent gesture: grab a child-of connector and drag its child onto a new
    // parent. A press without a drag still falls through to selecting the edge.
    let reparent: { childId: string; edgeId: string } | null = null;
    let reparentMoved = false;
    let rpStartX = 0, rpStartY = 0;
    let rubber: SVGLineElement | null = null;
    let dropTarget: SVGGElement | null = null;
    const clearDrop = () => { dropTarget?.classList.remove("is-drop-target"); dropTarget = null; };

    this.svg.addEventListener("pointerdown", (e) => {
      this.host.focus(); // stage owns the keyboard while focused
      if (this.linkingFrom) return; // click handler completes/cancels the link
      // Child-of connector → arm a re-parent drag (checked before the generic
      // edge bail-out below, since tree edges also carry data-edge-id).
      const treeEdge = (e.target as Element).closest(".ndmm-tree-edge-g") as SVGGElement | null;
      if (treeEdge?.dataset.edgeId) {
        const edge = this.graph.edges.get(treeEdge.dataset.edgeId);
        if (edge && edge.relation === CHILD_OF) {
          reparent = { childId: edge.source, edgeId: edge.id };
          reparentMoved = false;
          rpStartX = e.clientX; rpStartY = e.clientY;
          this.svg.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
      }
      if ((e.target as Element).closest("[data-edge-id]")) return; // edge → let click select it
      const target = (e.target as Element).closest(".ndmm-node") as SVGGElement | null;
      if (!target?.dataset.id) { this.select(null); lastDownId = null; return; }
      const n = this.graph.nodes.get(target.dataset.id);
      if (!n) return;
      // Second press on the same node within the window → edit its label (F2).
      if (lastDownId === n.id && e.timeStamp - lastDownTime < DOUBLE_MS) {
        // Suppress the pointerdown's default focus, which fires *after* this
        // handler and would otherwise steal focus back from the editor we're
        // about to open (its blur then commits and closes it instantly).
        e.preventDefault();
        lastDownId = null;
        this.startEdit(n.id);
        return; // don't arm a drag
      }
      lastDownId = n.id;
      lastDownTime = e.timeStamp;
      dragging = n.id;
      moved = false;
      this.select(n.id);
      const pt = this.toLocal(e);
      offX = pt.x - (n.x ?? 0);
      offY = pt.y - (n.y ?? 0);
      this.svg.setPointerCapture(e.pointerId);
    });

    this.svg.addEventListener("pointermove", (e) => {
      if (reparent) {
        if (!reparentMoved && Math.hypot(e.clientX - rpStartX, e.clientY - rpStartY) < 4) return;
        reparentMoved = true;
        const child = this.graph.nodes.get(reparent.childId);
        if (!child) return;
        const pt = this.toLocal(e);
        if (!rubber) {
          rubber = document.createElementNS(SVG_NS, "line");
          rubber.setAttribute("class", "ndmm-reparent-line");
          rubber.style.pointerEvents = "none"; // never intercept elementFromPoint hit-testing
          this.svg.append(rubber); // above the layers; not cleared by draw()
        }
        const cx = (child.x ?? 0) + this.nodeWidth(child) / 2;
        rubber.setAttribute("x1", String(cx));
        rubber.setAttribute("y1", String(child.y ?? 0));
        rubber.setAttribute("x2", String(pt.x));
        rubber.setAttribute("y2", String(pt.y));
        // Highlight a valid drop target (not the child itself or its descendants).
        const el = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest(".ndmm-node") as SVGGElement | null;
        const id = el?.dataset.id;
        const valid = !!id && id !== reparent.childId && !this.graph.isDescendant(id, reparent.childId);
        if (el !== dropTarget) {
          clearDrop();
          if (valid && el) { dropTarget = el; el.classList.add("is-drop-target"); }
        }
        return;
      }
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
      if (reparent) {
        this.svg.releasePointerCapture(e.pointerId);
        rubber?.remove(); rubber = null;
        clearDrop();
        const r = reparent;
        reparent = null;
        if (!reparentMoved) { this.selectEdge(r.edgeId); return; } // a press without a drag = select
        const el = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest(".ndmm-node") as SVGGElement | null;
        const targetId = el?.dataset.id;
        if (targetId && targetId !== r.childId && !this.graph.isDescendant(targetId, r.childId)) {
          try {
            this.graph.setParent(r.childId, targetId);
            this.changed();
            this.relayout();
            this.select(r.childId);
          } catch { this.relayout(); }
        } else {
          this.relayout(); // invalid drop → snap back
        }
        return;
      }
      if (dragging) {
        this.svg.releasePointerCapture(e.pointerId);
        if (moved) this.changed();
      }
      dragging = null;
    };
    this.svg.addEventListener("pointerup", end);
    this.svg.addEventListener("pointercancel", end);

    // Selection also on `click` — pointerdown drives drag + double-click, but not
    // every input path (some automation / assistive tech) emits pointer events,
    // whereas click is universal. Idempotent with the pointerdown selection above.
    this.svg.addEventListener("click", (e) => {
      // A double-click ends with a trailing `click`; if it just opened the label
      // editor, don't steal focus back to the stage (which would blur+commit and
      // close the editor instantly). While editing, the click is inert here.
      if (this.editing) return;
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

  /** Legend data for the currently bound channels (post-draw). */
  legendData(): ReturnType<ChannelResolver["legend"]> {
    return this.resolver.legend();
  }

  /** Category-error warnings from the last draw. */
  warnings(): LintWarning[] {
    return this.lastWarnings;
  }

  focusCanvas(): void {
    this.host.focus();
  }

  destroy(): void {
    this.editor.remove();
    this.svg.remove();
  }
}
