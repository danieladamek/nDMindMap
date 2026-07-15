/**
 * List / outline view (Phase 2) — the map's tree as an indented, free-flow list.
 *
 * Shares selection with the map (click a row = select the node everywhere) and
 * supports the two list-native gestures from the product brief:
 *   - inline rename (double-click a row),
 *   - **drag a row onto another row to re-parent** — or onto the panel
 *     background to make the node a root.
 *
 * The list never mutates the graph itself; every edit goes through callbacks so
 * the shell owns ordering (mutate → relayout → refresh). Rows show the node's
 * *effective* color/type via a ChannelResolver, so bound channels read the same
 * in both views.
 */

import type { Graph, GraphNode } from "./model.js";
import { ChannelResolver, nodeType } from "./visuals.js";

export interface ListOptions {
  onSelect: (id: string) => void;
  onReparent: (childId: string, parentId: string | null) => void;
  onRename: (id: string, label: string) => void;
}

export class ListView {
  private el: HTMLElement;
  private editingId: string | null = null;

  constructor(host: HTMLElement, private opts: ListOptions) {
    this.el = document.createElement("aside");
    this.el.className = "ndmm-list";
    host.append(this.el);
    this.bindPanelDrop();
  }

  setVisible(on: boolean): void {
    this.el.style.display = on ? "block" : "none";
  }

  get visible(): boolean {
    return this.el.style.display !== "none";
  }

  /** Rebuild the outline from the graph. Cheap — call after any change. */
  render(graph: Graph, selectedId: string | null): void {
    if (!this.visible) return;
    this.el.replaceChildren();
    const resolver = new ChannelResolver(graph);

    const addRow = (n: GraphNode, depth: number): void => {
      const row = document.createElement("div");
      row.className = "ndmm-list-row" + (n.id === selectedId ? " is-selected" : "");
      row.style.paddingLeft = `${10 + depth * 16}px`;
      row.dataset.id = n.id;
      row.draggable = true;

      const chip = document.createElement("span");
      chip.className = "ndmm-list-chip";
      const color = resolver.color(n);
      if (color) chip.style.background = color;
      row.append(chip);

      if (this.editingId === n.id) {
        const input = document.createElement("input");
        input.className = "ndmm-list-edit";
        input.value = n.label;
        const commit = () => {
          this.editingId = null;
          this.opts.onRename(n.id, input.value.trim());
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); this.editingId = null; this.opts.onRename(n.id, n.label); }
        });
        input.addEventListener("blur", () => { if (this.editingId === n.id) commit(); });
        row.append(input);
        queueMicrotask(() => { input.focus(); input.select(); });
      } else {
        const label = document.createElement("span");
        label.className = "ndmm-list-label";
        label.textContent = n.label || "…";
        row.append(label);
        const t = nodeType(n);
        if (t) {
          const tag = document.createElement("span");
          tag.className = "ndmm-list-type";
          tag.textContent = t;
          row.append(tag);
        }
      }

      row.addEventListener("click", () => this.opts.onSelect(n.id));
      row.addEventListener("dblclick", () => { this.editingId = n.id; this.opts.onSelect(n.id); });

      row.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("text/ndmm-node", n.id);
        e.dataTransfer!.effectAllowed = "move";
      });
      row.addEventListener("dragover", (e) => {
        if (e.dataTransfer?.types.includes("text/ndmm-node")) {
          e.preventDefault();
          e.stopPropagation();
          row.classList.add("is-droptarget");
        }
      });
      row.addEventListener("dragleave", () => row.classList.remove("is-droptarget"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        row.classList.remove("is-droptarget");
        const dragged = e.dataTransfer?.getData("text/ndmm-node");
        if (dragged && dragged !== n.id) this.opts.onReparent(dragged, n.id);
      });

      this.el.append(row);
      for (const c of graph.childrenOf(n.id)) addRow(c, depth + 1);
    };

    for (const root of graph.roots()) addRow(root, 0);

    const hint = document.createElement("div");
    hint.className = "ndmm-list-hint";
    hint.textContent = "drag a row onto another to re-parent · drop on empty space to make a root";
    this.el.append(hint);
  }

  /** Dropping on the panel background (not a row) makes the node a root. */
  private bindPanelDrop(): void {
    this.el.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes("text/ndmm-node")) {
        e.preventDefault();
        this.el.classList.add("is-droptarget");
      }
    });
    this.el.addEventListener("dragleave", (e) => {
      if (e.target === this.el) this.el.classList.remove("is-droptarget");
    });
    this.el.addEventListener("drop", (e) => {
      e.preventDefault();
      this.el.classList.remove("is-droptarget");
      const dragged = e.dataTransfer?.getData("text/ndmm-node");
      if (dragged) this.opts.onReparent(dragged, null);
    });
  }
}
