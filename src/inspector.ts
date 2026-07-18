/**
 * Node inspector (Phase 1.3) — a side panel to edit the selected node's label,
 * **type**, **attributes**, and **visual channels** (shape / color / size).
 *
 * All edits mutate the node object directly (type/shape/color/size are reserved
 * attribute keys; see visuals.ts) and call `onEdit`, which the shell uses to
 * redraw and, later, persist. The inspector holds no graph reference — it only
 * ever touches the one node it was handed.
 */

import type { Graph, GraphNode, GraphEdge, Scalar } from "./model.js";
import { SHAPES, COLORS, SIZES, RESERVED_ATTRS, customAttrs, nodeShape, nodeColor, nodeSizeKey, nodeType } from "./visuals.js";
import { SUGGESTED_LEVELS, EDGE_SEMANTICS, semanticsOf, nodeLevel } from "./semantics.js";
import { lintEdge } from "./lint.js";

/** Visual-channel keys a node type carries as defaults. */
const CHANNEL_KEYS = ["color", "shape", "size"] as const;

export interface InspectorOptions {
  onEdit: () => void;
  /** Open the interrogation modal (freeform focus view) on this node/edge. */
  onInterrogate?: (target: GraphNode | GraphEdge) => void;
}

/** Everything the edge editor needs that isn't on the edge itself. */
export interface EdgeContext {
  relationTypes: string[];
  sourceLabel: string;
  targetLabel: string;
  onDelete: () => void;
}

/** Coerce an edited string to a Scalar, matching the file format's parsing. */
function coerce(raw: string): Scalar {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s !== "" && !Number.isNaN(Number(s))) return Number(s);
  return raw;
}

export class Inspector {
  private el: HTMLElement;
  private node: GraphNode | null = null;
  private edge: GraphEdge | null = null;
  private edgeCtx: EdgeContext | null = null;
  private graph: Graph | null = null;

  constructor(host: HTMLElement, private opts: InspectorOptions) {
    this.el = document.createElement("aside");
    this.el.className = "ndmm-inspector";
    host.append(this.el);
    this.renderEmpty();
  }

  /** Point the inspector at the current graph (its type registry). */
  setGraph(graph: Graph): void {
    this.graph = graph;
  }

  show(node: GraphNode | null): void {
    this.node = node;
    this.edge = null;
    if (node) this.render();
    else this.renderEmpty();
  }

  showEdge(edge: GraphEdge, ctx: EdgeContext): void {
    this.edge = edge;
    this.edgeCtx = ctx;
    this.node = null;
    this.renderEdge(true);
  }

  private renderEmpty(): void {
    this.el.replaceChildren();
    const p = document.createElement("p");
    p.className = "insp-empty";
    p.textContent = "Select a node to edit its type, attributes, and appearance.";
    this.el.append(p);
  }

  private edited(structural = true): void {
    this.opts.onEdit();
    if (structural) { // reflect derived UI (e.g. re-labeled attr rows)
      if (this.edge) this.renderEdge();
      else if (this.node) this.render();
    }
  }

  private field(label: string, tip?: string): HTMLElement {
    const wrap = document.createElement("label");
    wrap.className = "insp-field";
    const span = document.createElement("span");
    span.className = "insp-label";
    span.textContent = label;
    if (tip) span.title = tip;
    wrap.append(span);
    return wrap;
  }

  /** A small caption under a field, explaining what it's for. */
  private help(text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "insp-help";
    el.textContent = text;
    return el;
  }

  private render(): void {
    const n = this.node;
    if (!n) return;
    this.el.replaceChildren();

    // Label
    const labelField = this.field("Label");
    const labelInput = document.createElement("input");
    labelInput.className = "insp-input";
    labelInput.value = n.label;
    labelInput.addEventListener("input", () => { n.label = labelInput.value; this.edited(false); });
    labelField.append(labelInput);

    // Type — a combobox over registered node types, with a Promote action.
    const typeField = this.field("Type", "What kind of thing this node is");
    const typeInput = document.createElement("input");
    typeInput.className = "insp-input";
    typeInput.placeholder = "e.g. concept, biomarker…";
    typeInput.value = nodeType(n);
    typeInput.setAttribute("list", "ndmm-nodetype-list");
    const datalist = document.createElement("datalist");
    datalist.id = "ndmm-nodetype-list";
    for (const t of this.graph?.nodeTypes.keys() ?? []) {
      const o = document.createElement("option");
      o.value = t;
      datalist.append(o);
    }
    typeInput.addEventListener("change", () => {
      const v = typeInput.value.trim();
      if (v) {
        n.attrs.type = v;
        const def = this.graph?.nodeTypes.get(v);
        if (def) this.applyTypeDefaults(n, def.attrs); // assigning a known type styles the node
      } else delete n.attrs.type;
      this.edited();
    });
    const promote = document.createElement("button");
    promote.type = "button";
    promote.className = "insp-promote";
    const known = !!this.graph?.nodeTypes.has(nodeType(n));
    promote.textContent = nodeType(n) ? (known ? "Update type defaults" : "★ Promote to type") : "★ Promote to type";
    promote.disabled = !nodeType(n);
    promote.title = "Register this type globally, capturing the node's color/shape as defaults";
    promote.addEventListener("click", () => {
      const v = typeInput.value.trim();
      if (!v || !this.graph) return;
      const defaults: Record<string, Scalar> = {};
      for (const k of CHANNEL_KEYS) if (k in n.attrs) defaults[k] = n.attrs[k];
      this.graph.registerNodeType(v, defaults);
      n.attrs.type = v;
      this.edited();
    });
    typeField.append(typeInput, datalist, promote);
    typeField.append(this.help("The kind of thing this node is (concept, biomarker, DSM diagnosis…). Promote to reuse it as a global type with default styling."));

    // Abstraction level — the "kind" dimension the interrogation payoff rests on.
    const levelField = this.field("Abstraction level", "How abstract / what layer of reality this sits on");
    const levelInput = document.createElement("input");
    levelInput.className = "insp-input";
    levelInput.placeholder = "e.g. subjective-experience, biomarker…";
    levelInput.value = nodeLevel(n);
    levelInput.setAttribute("list", "ndmm-level-list");
    const levelList = document.createElement("datalist");
    levelList.id = "ndmm-level-list";
    const knownLevels = new Set([...SUGGESTED_LEVELS, ...this.levelsInGraph()]);
    for (const l of knownLevels) {
      const o = document.createElement("option");
      o.value = l;
      levelList.append(o);
    }
    levelInput.addEventListener("change", () => {
      const v = levelInput.value.trim();
      if (v) n.attrs.level = v; else delete n.attrs.level;
      this.edited();
    });
    levelField.append(levelInput, levelList);
    levelField.append(this.help("How abstract the node is — e.g. subjective experience vs. biomarker vs. molecular entity. Lets the lint flag edges that collapse a level crossing into identity."));

    // Shape
    const shapeField = this.field("Shape", "Node outline. Overridden when a channel is bound to a dimension.");
    const shapeSel = document.createElement("select");
    shapeSel.className = "insp-input";
    shapeSel.title = "Node outline shape";
    for (const s of SHAPES) {
      const o = document.createElement("option");
      o.value = s.value; o.textContent = s.label;
      shapeSel.append(o);
    }
    shapeSel.value = nodeShape(n);
    shapeSel.addEventListener("change", () => {
      if (shapeSel.value === "rounded") delete n.attrs.shape; else n.attrs.shape = shapeSel.value;
      this.edited(false);
    });
    shapeField.append(shapeSel);

    // Color swatches
    const colorField = this.field("Color", "Fill colour. Overridden when a channel is bound to a dimension.");
    const swatches = document.createElement("div");
    swatches.className = "insp-swatches";
    const current = nodeColor(n);
    for (const c of COLORS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "insp-swatch" + (c.value === current ? " is-active" : "");
      b.title = c.label;
      b.style.background = c.value || "transparent";
      if (!c.value) b.textContent = "∅";
      b.addEventListener("click", () => {
        if (c.value) n.attrs.color = c.value; else delete n.attrs.color;
        this.edited();
      });
      swatches.append(b);
    }
    colorField.append(swatches);

    // Size segmented
    const sizeField = this.field("Size", "Node size (S / M / L). Overridden when a channel is bound to a dimension.");
    const seg = document.createElement("div");
    seg.className = "insp-segment";
    const curSize = nodeSizeKey(n);
    const SIZE_TITLES: Record<string, string> = { s: "Small", m: "Medium", l: "Large" };
    (Object.keys(SIZES) as (keyof typeof SIZES)[]).forEach((k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "insp-seg-btn" + (k === curSize ? " is-active" : "");
      b.textContent = k.toUpperCase();
      b.title = SIZE_TITLES[k] ?? k;
      b.addEventListener("click", () => {
        if (k === "m") delete n.attrs.size; else n.attrs.size = k;
        this.edited();
      });
      seg.append(b);
    });
    sizeField.append(seg);

    // Attributes (dimensions)
    const attrsField = this.attrsSection("Attributes (dimensions)", n.attrs, customAttrs(n));

    // Interrogate — open the freeform focus view.
    const interrogate = this.interrogateButton(() => this.opts.onInterrogate?.(n));

    // Id (read-only)
    const idNote = document.createElement("div");
    idNote.className = "insp-id";
    idNote.textContent = `id: ${n.id}`;

    this.el.append(labelField, typeField, levelField, shapeField, colorField, sizeField, attrsField, interrogate, idNote);
  }

  /** A prominent "Interrogate" action, shared by the node and edge editors. */
  private interrogateButton(onClick: () => void): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "insp-interrogate";
    btn.textContent = "🔎 Interrogate";
    btn.title = "Open a focused, freeform view to brainstorm and traverse from here (or press I)";
    btn.addEventListener("click", onClick);
    return btn;
  }

  /** Distinct abstraction levels already assigned across the graph. */
  private levelsInGraph(): string[] {
    const out = new Set<string>();
    for (const n of this.graph?.nodes.values() ?? []) {
      const l = nodeLevel(n);
      if (l) out.add(l);
    }
    return [...out];
  }

  /** Copy a node type's default visual channels onto the node. */
  private applyTypeDefaults(n: GraphNode, typeAttrs: Record<string, Scalar>): void {
    for (const k of CHANNEL_KEYS) if (k in typeAttrs) n.attrs[k] = typeAttrs[k];
  }

  private renderEdge(focusRelation = false): void {
    const e = this.edge;
    const ctx = this.edgeCtx;
    if (!e || !ctx) return;
    this.el.replaceChildren();

    // Relation type — combobox over the honest-semantics vocabulary + registered
    // + in-use types, with Promote.
    const registered = [...(this.graph?.edgeTypes.keys() ?? [])];
    const vocab = EDGE_SEMANTICS.map((s) => s.name);
    const allTypes = [...new Set([...vocab, ...registered, ...ctx.relationTypes])].sort();

    const relField = this.field("Relation");
    const relInput = document.createElement("input");
    relInput.className = "insp-input";
    relInput.placeholder = "e.g. proxy-for, measured-by…";
    relInput.value = e.relation;
    relInput.setAttribute("list", "ndmm-edgetype-list");
    const datalist = document.createElement("datalist");
    datalist.id = "ndmm-edgetype-list";
    for (const t of allTypes) {
      const o = document.createElement("option");
      o.value = t;
      datalist.append(o);
    }
    relInput.addEventListener("input", () => {
      e.relation = relInput.value.trim() || "relates-to";
      updateHint();
      this.edited(false);
    });
    const promote = document.createElement("button");
    promote.type = "button";
    promote.className = "insp-promote";
    const known = this.graph?.edgeTypes.has(e.relation);
    promote.textContent = known ? "Registered edge type" : "★ Promote to type";
    promote.disabled = !!known;
    promote.title = "Register this relation as a global, selectable edge type";
    promote.addEventListener("click", () => {
      const v = relInput.value.trim();
      if (!v || !this.graph) return;
      this.graph.registerEdgeType(v);
      e.relation = v;
      this.edited();
    });
    relField.append(relInput, datalist, promote);

    // Semantic hint — what this relation honestly claims (and its level rule).
    const hint = document.createElement("div");
    hint.className = "insp-semantics";
    const updateHint = () => {
      const s = semanticsOf(e.relation);
      if (s) {
        hint.textContent = `${s.hint}`;
        hint.dataset.levels = s.levels;
        hint.style.display = "block";
      } else {
        hint.style.display = "none";
      }
    };
    updateHint();
    relField.append(hint);

    // Quick-pick chips (registered ∪ in-use).
    if (allTypes.length) {
      const chips = document.createElement("div");
      chips.className = "insp-chips";
      for (const t of allTypes) {
        const c = document.createElement("button");
        c.type = "button";
        c.className = "insp-chip" + (t === e.relation ? " is-active" : "") + (this.graph?.edgeTypes.has(t) ? " is-registered" : "");
        c.textContent = t;
        c.addEventListener("click", () => { e.relation = t; this.edited(); });
        chips.append(c);
      }
      relField.append(chips);
    }

    // Connects (read-only)
    const conn = this.field("Connects");
    const connVal = document.createElement("div");
    connVal.className = "insp-conn";
    connVal.textContent = `${ctx.sourceLabel} → ${ctx.targetLabel}`;
    conn.append(connVal);

    // Category-error warning (P3.2) — surfaced with a one-click honest-fix.
    let warnBox: HTMLElement | null = null;
    const warning = this.graph ? lintEdge(this.graph, e) : null;
    if (warning) {
      warnBox = document.createElement("div");
      warnBox.className = "insp-warning";
      const msg = document.createElement("div");
      msg.className = "insp-warning-msg";
      msg.textContent = `⚠ ${warning.message}`;
      const fix = document.createElement("button");
      fix.type = "button";
      fix.className = "insp-warning-fix";
      fix.textContent = `Retype as ${warning.suggestion}`;
      fix.addEventListener("click", () => { e.relation = warning.suggestion; this.edited(); });
      warnBox.append(msg, fix);
    }

    // Parameters (edge attributes — parameterized edges; hide reserved keys)
    const params = this.attrsSection("Parameters", e.attrs, Object.entries(e.attrs).filter(([k]) => !RESERVED_ATTRS.has(k)));

    const interrogate = this.interrogateButton(() => this.opts.onInterrogate?.(e));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "insp-delete-edge";
    del.textContent = "Delete edge";
    del.addEventListener("click", () => ctx.onDelete());

    const idNote = document.createElement("div");
    idNote.className = "insp-id";
    idNote.textContent = `edge: ${e.id}`;

    this.el.append(relField, conn, ...(warnBox ? [warnBox] : []), params, interrogate, del, idNote);
    if (focusRelation) { relInput.focus(); relInput.select(); }
  }

  /** Reusable attributes editor for a node or edge. `pairs` lets the caller
   *  choose which subset to show (nodes hide reserved keys; edges show all). */
  private attrsSection(title: string, attrs: Record<string, Scalar>, pairs: [string, Scalar][]): HTMLElement {
    const field = this.field(title);
    const list = document.createElement("div");
    list.className = "insp-attrs";
    for (const [k, v] of pairs) list.append(this.attrRow(attrs, k, v));
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "insp-add";
    addBtn.textContent = "+ Add attribute";
    addBtn.addEventListener("click", () => {
      let key = "field";
      let i = 1;
      while (key in attrs) key = `field${i++}`;
      attrs[key] = "";
      this.edited();
    });
    field.append(list, addBtn);
    return field;
  }

  private attrRow(attrs: Record<string, Scalar>, key: string, value: Scalar): HTMLElement {
    const row = document.createElement("div");
    row.className = "insp-attr-row";

    const keyInput = document.createElement("input");
    keyInput.className = "insp-input insp-key";
    keyInput.value = key;
    keyInput.addEventListener("change", () => {
      const nk = keyInput.value.trim();
      if (!nk || nk === key) return;
      if (nk in attrs) { keyInput.value = key; return; } // avoid clobbering
      const val = attrs[key];
      delete attrs[key];
      attrs[nk] = val;
      this.edited();
    });

    const valInput = document.createElement("input");
    valInput.className = "insp-input insp-val";
    valInput.value = String(value);
    valInput.addEventListener("input", () => { attrs[key] = coerce(valInput.value); this.edited(false); });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "insp-del";
    del.textContent = "×";
    del.title = "Remove attribute";
    del.addEventListener("click", () => { delete attrs[key]; this.edited(); });

    row.append(keyInput, valInput, del);
    return row;
  }
}
