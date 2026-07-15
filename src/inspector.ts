/**
 * Node inspector (Phase 1.3) — a side panel to edit the selected node's label,
 * **type**, **attributes**, and **visual channels** (shape / color / size).
 *
 * All edits mutate the node object directly (type/shape/color/size are reserved
 * attribute keys; see visuals.ts) and call `onEdit`, which the shell uses to
 * redraw and, later, persist. The inspector holds no graph reference — it only
 * ever touches the one node it was handed.
 */

import type { GraphNode, Scalar } from "./model.js";
import { SHAPES, COLORS, SIZES, customAttrs, nodeShape, nodeColor, nodeSizeKey, nodeType } from "./visuals.js";

export interface InspectorOptions {
  onEdit: () => void;
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

  constructor(host: HTMLElement, private opts: InspectorOptions) {
    this.el = document.createElement("aside");
    this.el.className = "ndmm-inspector";
    host.append(this.el);
    this.renderEmpty();
  }

  show(node: GraphNode | null): void {
    this.node = node;
    if (node) this.render();
    else this.renderEmpty();
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
    if (structural) this.render(); // reflect derived UI (e.g. re-labeled attr rows)
  }

  private field(label: string): HTMLElement {
    const wrap = document.createElement("label");
    wrap.className = "insp-field";
    const span = document.createElement("span");
    span.className = "insp-label";
    span.textContent = label;
    wrap.append(span);
    return wrap;
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

    // Type
    const typeField = this.field("Type");
    const typeInput = document.createElement("input");
    typeInput.className = "insp-input";
    typeInput.placeholder = "e.g. concept, biomarker…";
    typeInput.value = nodeType(n);
    typeInput.addEventListener("input", () => {
      const v = typeInput.value.trim();
      if (v) n.attrs.type = v; else delete n.attrs.type;
      this.edited(false);
    });
    typeField.append(typeInput);

    // Shape
    const shapeField = this.field("Shape");
    const shapeSel = document.createElement("select");
    shapeSel.className = "insp-input";
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
    const colorField = this.field("Color");
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
    const sizeField = this.field("Size");
    const seg = document.createElement("div");
    seg.className = "insp-segment";
    const curSize = nodeSizeKey(n);
    (Object.keys(SIZES) as (keyof typeof SIZES)[]).forEach((k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "insp-seg-btn" + (k === curSize ? " is-active" : "");
      b.textContent = k.toUpperCase();
      b.addEventListener("click", () => {
        if (k === "m") delete n.attrs.size; else n.attrs.size = k;
        this.edited();
      });
      seg.append(b);
    });
    sizeField.append(seg);

    // Attributes (dimensions)
    const attrsField = this.field("Attributes (dimensions)");
    const list = document.createElement("div");
    list.className = "insp-attrs";
    for (const [k, v] of customAttrs(n)) {
      list.append(this.attrRow(n, k, v));
    }
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "insp-add";
    addBtn.textContent = "+ Add attribute";
    addBtn.addEventListener("click", () => {
      let key = "field";
      let i = 1;
      while (key in n.attrs) key = `field${i++}`;
      n.attrs[key] = "";
      this.edited();
    });
    attrsField.append(list, addBtn);

    // Id (read-only)
    const idNote = document.createElement("div");
    idNote.className = "insp-id";
    idNote.textContent = `id: ${n.id}`;

    this.el.append(labelField, typeField, shapeField, colorField, sizeField, attrsField, idNote);
  }

  private attrRow(n: GraphNode, key: string, value: Scalar): HTMLElement {
    const row = document.createElement("div");
    row.className = "insp-attr-row";

    const keyInput = document.createElement("input");
    keyInput.className = "insp-input insp-key";
    keyInput.value = key;
    keyInput.addEventListener("change", () => {
      const nk = keyInput.value.trim();
      if (!nk || nk === key) return;
      if (nk in n.attrs) { keyInput.value = key; return; } // avoid clobbering
      const val = n.attrs[key];
      delete n.attrs[key];
      n.attrs[nk] = val;
      this.edited();
    });

    const valInput = document.createElement("input");
    valInput.className = "insp-input insp-val";
    valInput.value = String(value);
    valInput.addEventListener("input", () => { n.attrs[key] = coerce(valInput.value); this.edited(false); });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "insp-del";
    del.textContent = "×";
    del.title = "Remove attribute";
    del.addEventListener("click", () => { delete n.attrs[key]; this.edited(); });

    row.append(keyInput, valInput, del);
    return row;
  }
}
