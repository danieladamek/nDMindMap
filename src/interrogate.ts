/**
 * Interrogation modal — a focused, single-element view for *thinking inside* one
 * node or one relationship. Unlike the inspector (which edits structured fields),
 * this is a broad freeform space: brainstorm prose, link to other nodes inline
 * with `[[label]]` (Obsidian-style), traverse the graph by clicking connections,
 * and — for an edge — set its directionality.
 *
 * The prose lives on the element's reserved `note` attr (persisted in the file's
 * `## Notes` section). `[[label]]` tokens resolve to `mentions` edges on commit
 * (node focus only; per the brief, an edge's prose doesn't spawn graph objects).
 * Directionality is the reserved `dir` edge attr (`both` = bidirectional).
 */

import type { Graph, GraphNode, GraphEdge } from "./model.js";
import { MENTIONS } from "./model.js";
import { nodeType } from "./visuals.js";
import { nodeLevel } from "./semantics.js";

export interface InterrogationCallbacks {
  /** Persist + redraw after any graph mutation. */
  onChange: () => void;
  /** Refocus the modal (and selection) on another node / edge. */
  onFocusNode: (id: string) => void;
  onFocusEdge: (id: string) => void;
}

type Focus = { kind: "node"; node: GraphNode } | { kind: "edge"; edge: GraphEdge };

const LINK_RE = /\[\[([^\]]+)\]\]/g;

export class InterrogationModal {
  private overlay: HTMLElement;
  private panel: HTMLElement;
  private graph: Graph | null = null;
  private focus: Focus | null = null;

  constructor(host: HTMLElement, private cb: InterrogationCallbacks) {
    this.overlay = document.createElement("div");
    this.overlay.className = "ndmm-modal-overlay";
    this.overlay.style.display = "none";
    this.panel = document.createElement("div");
    this.panel.className = "ndmm-modal";
    this.overlay.append(this.panel);
    host.append(this.overlay);

    // Click the backdrop (not the panel) to close.
    this.overlay.addEventListener("pointerdown", (e) => {
      if (e.target === this.overlay) this.close();
    });
    // Esc closes; keep other keys inside the modal.
    this.overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); this.close(); }
    });
  }

  setGraph(graph: Graph): void {
    this.graph = graph;
  }

  get isOpen(): boolean {
    return this.overlay.style.display !== "none";
  }

  openNode(node: GraphNode): void {
    this.commit();
    this.focus = { kind: "node", node };
    this.overlay.style.display = "flex";
    this.render();
  }

  openEdge(edge: GraphEdge): void {
    this.commit();
    this.focus = { kind: "edge", edge };
    this.overlay.style.display = "flex";
    this.render();
  }

  close(): void {
    this.commit();
    this.focus = null;
    this.overlay.style.display = "none";
  }

  /** Persist the current prose and resolve its [[links]] (node focus only). */
  private commit(): void {
    if (!this.focus || !this.graph) return;
    if (this.focus.kind === "node") this.resolveLinks(this.focus.node);
    this.cb.onChange();
  }

  private resolveLinks(node: GraphNode): void {
    if (!this.graph) return;
    const text = typeof node.attrs.note === "string" ? node.attrs.note : "";
    const labels = [...text.matchAll(LINK_RE)].map((m) => m[1].trim()).filter(Boolean);
    for (const label of labels) {
      let target = this.findByLabel(label);
      if (!target) target = this.graph.addNode({ label });
      if (target.id === node.id) continue;
      const exists = [...this.graph.edges.values()].some(
        (e) => e.source === node.id && e.target === target!.id && e.relation === MENTIONS,
      );
      if (!exists) this.graph.addEdge({ source: node.id, target: target.id, relation: MENTIONS });
    }
  }

  private findByLabel(label: string): GraphNode | undefined {
    if (!this.graph) return undefined;
    const want = label.toLowerCase();
    for (const n of this.graph.nodes.values()) if (n.label.toLowerCase() === want) return n;
    return undefined;
  }

  // --- rendering ------------------------------------------------------------

  private render(): void {
    if (!this.focus || !this.graph) return;
    this.panel.replaceChildren();
    if (this.focus.kind === "node") this.renderNode(this.focus.node);
    else this.renderEdge(this.focus.edge);
  }

  private header(kicker: string, title: string): HTMLElement {
    const head = document.createElement("div");
    head.className = "ndmm-modal-head";
    const left = document.createElement("div");
    const k = document.createElement("div");
    k.className = "ndmm-modal-kicker";
    k.textContent = kicker;
    const t = document.createElement("div");
    t.className = "ndmm-modal-title";
    t.textContent = title || "(unnamed)";
    left.append(k, t);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ndmm-modal-close";
    close.textContent = "✕";
    close.title = "Close (Esc)";
    close.addEventListener("click", () => this.close());
    head.append(left, close);
    return head;
  }

  private renderNode(node: GraphNode): void {
    const g = this.graph!;
    this.panel.append(this.header("🔎 Interrogate node", node.label));

    // Kind chips (type / level).
    const meta = document.createElement("div");
    meta.className = "ndmm-modal-meta";
    for (const [k, v] of [["type", nodeType(node)], ["level", nodeLevel(node)]] as const) {
      if (!v) continue;
      const chip = document.createElement("span");
      chip.className = "ndmm-modal-chip";
      chip.textContent = `${k}: ${v}`;
      meta.append(chip);
    }
    if (meta.childNodes.length) this.panel.append(meta);

    // Connections — traversal. Each row: relation + the node at the far end.
    const conns = g.incident(node.id);
    const connWrap = document.createElement("div");
    connWrap.className = "ndmm-modal-section";
    const connTitle = document.createElement("div");
    connTitle.className = "ndmm-modal-section-title";
    connTitle.textContent = `Connections (${conns.length})`;
    connWrap.append(connTitle);
    if (!conns.length) {
      const none = document.createElement("div");
      none.className = "ndmm-modal-empty";
      none.textContent = "no connections yet — add one with a [[link]] below";
      connWrap.append(none);
    }
    for (const e of conns) {
      const outgoing = e.source === node.id;
      const farId = outgoing ? e.target : e.source;
      const far = g.nodes.get(farId);
      const row = document.createElement("div");
      row.className = "ndmm-modal-conn";
      const rel = document.createElement("button");
      rel.type = "button";
      rel.className = "ndmm-modal-rel";
      rel.textContent = `${outgoing ? "→" : "←"} ${e.relation}`;
      rel.title = "Interrogate this relationship";
      rel.addEventListener("click", () => this.cb.onFocusEdge(e.id));
      const far2 = document.createElement("button");
      far2.type = "button";
      far2.className = "ndmm-modal-farnode";
      far2.textContent = far?.label || farId;
      far2.title = "Jump focus to this node";
      far2.addEventListener("click", () => this.cb.onFocusNode(farId));
      row.append(rel, far2);
      connWrap.append(row);
    }
    this.panel.append(connWrap);

    // Freeform prose with inline [[ ]] linking.
    this.panel.append(this.prose(node, "Brainstorm freely. Type [[Some label]] to link this node to another (a new node is created if the label is unknown)."));
  }

  private renderEdge(edge: GraphEdge): void {
    const g = this.graph!;
    const src = g.nodes.get(edge.source);
    const tgt = g.nodes.get(edge.target);
    this.panel.append(this.header("🔎 Interrogate relationship", edge.relation));

    // Endpoints — both clickable to jump focus.
    const ends = document.createElement("div");
    ends.className = "ndmm-modal-ends";
    const mk = (n: GraphNode | undefined, id: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ndmm-modal-farnode";
      b.textContent = n?.label || id;
      b.title = "Jump focus to this node";
      b.addEventListener("click", () => this.cb.onFocusNode(id));
      return b;
    };
    const dir = typeof edge.attrs.dir === "string" ? edge.attrs.dir : "";
    const arrow = document.createElement("span");
    arrow.className = "ndmm-modal-arrow";
    arrow.textContent = dir === "both" ? "↔" : "→";
    ends.append(mk(src, edge.source), arrow, mk(tgt, edge.target));
    this.panel.append(ends);

    // Directionality controls.
    const dirWrap = document.createElement("div");
    dirWrap.className = "ndmm-modal-section";
    const dirTitle = document.createElement("div");
    dirTitle.className = "ndmm-modal-section-title";
    dirTitle.textContent = "Directionality";
    dirWrap.append(dirTitle);
    const dirRow = document.createElement("div");
    dirRow.className = "ndmm-modal-dirs";
    const opts: { label: string; active: boolean; apply: () => void }[] = [
      { label: `${src?.label || "source"} → ${tgt?.label || "target"}`, active: dir !== "both", apply: () => { delete edge.attrs.dir; } },
      { label: "↔ bidirectional", active: dir === "both", apply: () => { edge.attrs.dir = "both"; } },
      { label: "⇄ flip", active: false, apply: () => { const s = edge.source; edge.source = edge.target; edge.target = s; } },
    ];
    for (const o of opts) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ndmm-modal-dir" + (o.active ? " is-active" : "");
      b.textContent = o.label;
      b.addEventListener("click", () => { o.apply(); this.cb.onChange(); this.render(); });
      dirRow.append(b);
    }
    dirWrap.append(dirRow);
    this.panel.append(dirWrap);

    // Freeform prose (no [[ ]] graph effects on an edge, per the brief).
    this.panel.append(this.prose(edge, "Freewrite about this relationship — why it holds, caveats, evidence."));
  }

  /** The shared broad editor, bound to the element's `note` attr. */
  private prose(el: { attrs: Record<string, string | number | boolean> }, hint: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "ndmm-modal-section";
    const title = document.createElement("div");
    title.className = "ndmm-modal-section-title";
    title.textContent = "Notes";
    const ta = document.createElement("textarea");
    ta.className = "ndmm-modal-prose";
    ta.value = typeof el.attrs.note === "string" ? el.attrs.note : "";
    ta.placeholder = hint;
    ta.addEventListener("input", () => {
      const v = ta.value;
      if (v.trim()) el.attrs.note = v; else delete el.attrs.note;
    });
    const help = document.createElement("div");
    help.className = "ndmm-modal-hint";
    help.textContent = hint;
    wrap.append(title, ta, help);
    // Focus the editor for immediate typing.
    queueMicrotask(() => ta.focus());
    return wrap;
  }
}
