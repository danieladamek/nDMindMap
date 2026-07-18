/**
 * Explosion Reader modal (Phase 1) — load or paste a text/markdown document,
 * read it in a clean rendered view, lightly annotate it, and "explode" it into a
 * hierarchical map (see explode.ts).
 *
 * The Read / Source model is adapted from the GrandsTech Reader (native macOS
 * app): **Read** is a rendered, GitHub-style reading column; **Source** is the
 * raw markdown you edit and annotate. (The GrandsTech Reader's Live/Rich modes
 * ride on CodeMirror/ProseMirror — out of scope for this lean tool.)
 *
 * Annotation is deliberately minimal: select a word or phrase in either view and
 * press "Make node" to wrap it in `@[…]` — so you build links without typing the
 * notation. Nodes/edges are created when you Explode.
 *
 * Phase 2 (deferred): PDF/DOCX ingest and the parallel capture sidebar.
 */

import { renderMarkdown } from "./markdown.js";
import type { LiveEditor } from "./live.js";

/** One row in the link sidebar (a node; `children` are child-of + linked items). */
export interface SidebarItem {
  id: string;
  label: string;
  kind: string;
  sec?: string;
  linked?: boolean; // reached via a part-of link (not a structural child)
  children: SidebarItem[];
}
export interface SidebarData {
  external: SidebarItem[]; // roots outside the paper-derived graph
  sections: SidebarItem[]; // the document outline + linked items
}

export interface ReaderCallbacks {
  /** Explode (docId null) or re-sync (docId set) the document into the map.
   *  Returns the document's root id, which the reader keeps as the active doc. */
  onExplode: (text: string, title: string, paragraphsAsNodes: boolean, docId: string | null) => string;
  /** The current markdown projection of a document, or null if it's gone. */
  projection: (docId: string) => string | null;
  /** The link-sidebar model for a document. */
  sidebar: (docId: string) => SidebarData;
  /** Select a node on the map (from a sidebar click). */
  onSelect: (nodeId: string) => void;
}

type Mode = "read" | "live" | "source";

export class ReaderModal {
  private overlay: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private readPane!: HTMLElement;
  private liveHost!: HTMLElement;
  private titleInput!: HTMLInputElement;
  private splitToggle!: HTMLInputElement;
  private sidebarEl!: HTMLElement;
  private modeButtons: Record<Mode, HTMLButtonElement> = {} as Record<Mode, HTMLButtonElement>;
  private mode: Mode = "source";
  private live: LiveEditor | null = null; // lazily mounted on first Live use
  private currentDocId: string | null = null; // the document this reader is editing
  private explodeBtn!: HTMLButtonElement;
  private newBtn!: HTMLButtonElement;

  constructor(host: HTMLElement, private cb: ReaderCallbacks) {
    this.overlay = document.createElement("div");
    this.overlay.className = "ndmm-modal-overlay";
    this.overlay.style.display = "none";
    this.overlay.addEventListener("pointerdown", (e) => { if (e.target === this.overlay) this.close(); });
    this.overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); this.close(); } });
    host.append(this.overlay);
    this.build();
  }

  get isOpen(): boolean {
    return this.overlay.style.display !== "none";
  }

  open(): void {
    // If we're editing an existing document, load its current projection so the
    // reader reflects any edits made on the map (graph → paper).
    if (this.currentDocId) {
      const proj = this.projection(this.currentDocId);
      if (proj !== null) this.textarea.value = proj;
      else this.currentDocId = null; // the document was deleted
    }
    this.refreshActions();
    this.renderSidebar();
    this.overlay.style.display = "flex";
    void this.setMode(this.textarea.value.trim() && this.currentDocId ? "read" : this.mode);
  }

  /** Reflect whether we're creating a new document or syncing the active one. */
  private refreshActions(): void {
    const editing = this.currentDocId !== null;
    this.explodeBtn.textContent = editing ? "🔄 Sync to map" : "💥 Explode into map";
    this.explodeBtn.title = editing
      ? "Reconcile your edits back into the map (updates in place — no duplicate)"
      : "Build a new map from this document";
    this.newBtn.style.display = editing ? "inline-flex" : "none";
  }

  private get projection(): (docId: string) => string | null {
    return this.cb.projection;
  }

  close(): void {
    this.syncFromLive();
    this.overlay.style.display = "none";
  }

  /** The canonical document text is the textarea; pull the latest from Live. */
  private syncFromLive(): void {
    if (this.live && this.mode === "live") this.textarea.value = this.live.getDoc();
  }

  private build(): void {
    const panel = document.createElement("div");
    panel.className = "ndmm-modal ndmm-reader";

    // Header.
    const head = document.createElement("div");
    head.className = "ndmm-modal-head";
    const left = document.createElement("div");
    const kicker = document.createElement("div");
    kicker.className = "ndmm-modal-kicker";
    kicker.textContent = "📖 Explosion Reader";
    const title = document.createElement("div");
    title.className = "ndmm-modal-title";
    title.textContent = "Explode a document into a map";
    left.append(kicker, title);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ndmm-modal-close";
    close.textContent = "✕";
    close.title = "Close (Esc)";
    close.addEventListener("click", () => this.close());
    head.append(left, close);

    // Source row: mode toggle, open a file, and a document-title field.
    const src = document.createElement("div");
    src.className = "ndmm-reader-src";

    const seg = document.createElement("div");
    seg.className = "ndmm-reader-modes";
    const MODE_LABEL: Record<Mode, string> = { read: "Read", live: "Live", source: "Source" };
    const MODE_TIP: Record<Mode, string> = {
      read: "Clean rendered view",
      live: "Obsidian-style live preview — rendered, raw revealed on the caret's line",
      source: "Raw markdown — edit & annotate",
    };
    (["read", "live", "source"] as Mode[]).forEach((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = MODE_LABEL[m];
      b.title = MODE_TIP[m];
      b.addEventListener("click", () => { void this.setMode(m); });
      this.modeButtons[m] = b;
      seg.append(b);
    });

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "ndmm-reader-open";
    openBtn.textContent = "Open .md / .txt…";
    openBtn.addEventListener("click", () => this.openFile());

    // Start a fresh document instead of syncing the active one.
    this.newBtn = document.createElement("button");
    this.newBtn.type = "button";
    this.newBtn.className = "ndmm-reader-open";
    this.newBtn.textContent = "＋ New document";
    this.newBtn.style.display = "none";
    this.newBtn.title = "Stop editing the current document and explode a new one";
    this.newBtn.addEventListener("click", () => {
      this.currentDocId = null;
      this.textarea.value = "";
      this.titleInput.value = "";
      this.refreshActions();
      this.renderSidebar();
      void this.setMode("source");
    });

    const titleField = document.createElement("label");
    titleField.className = "ndmm-reader-title";
    titleField.append("Title ");
    this.titleInput = document.createElement("input");
    this.titleInput.className = "insp-input";
    this.titleInput.placeholder = "defaults to the first heading";
    titleField.append(this.titleInput);

    src.append(seg, openBtn, this.newBtn, titleField);

    // Panes: the rendered Read view and the raw Source textarea (one shown).
    const panes = document.createElement("div");
    panes.className = "ndmm-reader-panes";

    this.readPane = document.createElement("article");
    this.readPane.className = "ndmm-md ndmm-reader-read";

    this.liveHost = document.createElement("div");
    this.liveHost.className = "ndmm-reader-live";
    this.liveHost.style.display = "none";

    this.textarea = document.createElement("textarea");
    this.textarea.className = "ndmm-reader-text";
    this.textarea.placeholder =
      "Paste a document, or Open a file.\n\n" +
      "# Headings and\n- nested bullets\nbecome the outline; paragraphs become Sec1.2.3 nodes.\n\n" +
      "Wrap an entity in @[Label] (or select it and press “Make node”) to link it — those become part-of connections.";

    panes.append(this.readPane, this.liveHost, this.textarea);

    // Link sidebar (right column): external items + the document outline.
    this.sidebarEl = document.createElement("aside");
    this.sidebarEl.className = "ndmm-reader-sidebar";

    // Body: text panes (left) + link sidebar (right).
    const body = document.createElement("div");
    body.className = "ndmm-reader-body";
    body.append(panes, this.sidebarEl);

    // Actions.
    const actions = document.createElement("div");
    actions.className = "ndmm-reader-actions";
    const makeNode = document.createElement("button");
    makeNode.type = "button";
    makeNode.className = "ndmm-reader-makenode";
    makeNode.textContent = "＋ Make node from selection";
    makeNode.title = "Wrap the selected text in @[…] so it becomes a linked node on explode";
    makeNode.addEventListener("click", () => this.makeNodeFromSelection());
    const hint = document.createElement("span");
    hint.className = "ndmm-reader-hint";
    hint.textContent = "select a word, then Make node";
    const spacer = document.createElement("span");
    spacer.className = "ndmm-reader-spacer";
    const splitLabel = document.createElement("label");
    splitLabel.className = "ndmm-reader-split";
    splitLabel.title = "On: each paragraph becomes a node (labelled by its first sentence). Off: prose folds into the heading's note (lean outline).";
    this.splitToggle = document.createElement("input");
    this.splitToggle.type = "checkbox";
    this.splitToggle.checked = true;
    splitLabel.append(this.splitToggle, document.createTextNode(" Split paragraphs"));
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ndmm-reader-cancel";
    cancel.textContent = "Close";
    cancel.addEventListener("click", () => this.close());
    this.explodeBtn = document.createElement("button");
    this.explodeBtn.type = "button";
    this.explodeBtn.className = "ndmm-reader-explode";
    this.explodeBtn.textContent = "💥 Explode into map";
    this.explodeBtn.addEventListener("click", () => this.explode());
    actions.append(makeNode, hint, spacer, splitLabel, cancel, this.explodeBtn);

    panel.append(head, src, body, actions);
    this.overlay.append(panel);
  }

  // --- link sidebar ---------------------------------------------------------

  /** Rebuild the right-bar: external items + the document outline with links. */
  private renderSidebar(): void {
    this.sidebarEl.replaceChildren();
    if (!this.currentDocId) { this.sidebarEl.style.display = "none"; return; }
    this.sidebarEl.style.display = "";
    const data = this.cb.sidebar(this.currentDocId);

    const zone = (title: string, sub: string, items: SidebarItem[], emptyText: string): HTMLElement => {
      const z = document.createElement("div");
      z.className = "ndmm-sb-zone";
      const h = document.createElement("div");
      h.className = "ndmm-sb-head";
      h.textContent = title;
      const s = document.createElement("div");
      s.className = "ndmm-sb-sub";
      s.textContent = sub;
      z.append(h, s);
      if (!items.length) {
        const e = document.createElement("div");
        e.className = "ndmm-sb-empty";
        e.textContent = emptyText;
        z.append(e);
      } else {
        for (const it of items) this.appendItem(z, it, 0);
      }
      return z;
    };

    this.sidebarEl.append(
      zone("External items", "not embedded in the text", data.external, "none yet"),
      zone("Sections", "outline + linked items", data.sections, "explode a document to populate"),
    );
  }

  private appendItem(container: HTMLElement, item: SidebarItem, depth: number): void {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "ndmm-sb-item" + (item.linked ? " is-linked" : "");
    row.style.paddingLeft = `${8 + depth * 14}px`;
    if (item.sec) {
      const sec = document.createElement("span");
      sec.className = "ndmm-sb-sec";
      sec.textContent = item.sec;
      row.append(sec);
    }
    const label = document.createElement("span");
    label.className = "ndmm-sb-label";
    label.textContent = item.label || "(unnamed)";
    row.append(label);
    if (item.linked || item.kind === "entity") {
      const tag = document.createElement("span");
      tag.className = "ndmm-sb-tag";
      tag.textContent = "link";
      row.append(tag);
    }
    row.addEventListener("click", () => this.cb.onSelect(item.id));
    container.append(row);
    for (const c of item.children) this.appendItem(container, c, depth + 1);
  }

  private async setMode(m: Mode): Promise<void> {
    this.syncFromLive(); // capture Live edits before switching away
    this.mode = m;
    for (const key of ["read", "live", "source"] as Mode[]) this.modeButtons[key].classList.toggle("is-active", key === m);

    if (m === "live") await this.ensureLive();
    if (m === "live" && this.live) this.live.setDoc(this.textarea.value);
    if (m === "read") this.readPane.innerHTML = renderMarkdown(this.textarea.value);

    this.readPane.style.display = m === "read" ? "block" : "none";
    this.liveHost.style.display = m === "live" ? "block" : "none";
    this.textarea.style.display = m === "source" ? "block" : "none";

    if (m === "source") queueMicrotask(() => this.textarea.focus());
    else if (m === "live") queueMicrotask(() => this.live?.focus());
  }

  /** Lazy-load CodeMirror + the live-preview editor on first Live use. */
  private async ensureLive(): Promise<void> {
    if (this.live) return;
    const { mountLive } = await import("./live.js");
    this.live = mountLive(this.liveHost, this.textarea.value, (text) => { this.textarea.value = text; });
  }

  private openFile(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.txt,.markdown,text/markdown,text/plain";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.textarea.value = await file.text();
      if (!this.titleInput.value.trim()) {
        this.titleInput.value = file.name.replace(/\.(md|markdown|txt)$/i, "");
      }
      void this.setMode("read"); // show the freshly-loaded document rendered
    });
    input.click();
  }

  /** Wrap the current selection in `@[…]`, in whichever view is active. */
  private makeNodeFromSelection(): void {
    if (this.mode === "live" && this.live) {
      this.live.wrapSelection("@[", "]"); // Live's onChange keeps the textarea synced
      return;
    }
    if (this.mode === "source") {
      const ta = this.textarea;
      const { selectionStart: a, selectionEnd: b, value } = ta;
      const sel = value.slice(a, b).trim();
      if (!sel) { ta.focus(); return; }
      const wrapped = `@[${sel}]`;
      ta.value = value.slice(0, a) + wrapped + value.slice(b);
      ta.focus();
      ta.setSelectionRange(a, a + wrapped.length);
      return;
    }
    // Read mode: wrap the first occurrence of the selected text in the source.
    const sel = (window.getSelection()?.toString() ?? "").trim();
    if (!sel) return;
    const idx = this.textarea.value.indexOf(sel);
    if (idx === -1) return;
    this.textarea.value = this.textarea.value.slice(0, idx) + `@[${sel}]` + this.textarea.value.slice(idx + sel.length);
    this.readPane.innerHTML = renderMarkdown(this.textarea.value); // reflect the new link chip
  }

  private explode(): void {
    this.syncFromLive();
    const text = this.textarea.value.trim();
    if (!text) { void this.setMode("source"); this.textarea.focus(); return; }
    // Explode a new document, or sync edits back into the active one (no dup).
    // Stay open so the link sidebar reflects the result and you keep editing.
    this.currentDocId = this.cb.onExplode(text, this.titleInput.value.trim(), this.splitToggle.checked, this.currentDocId);
    this.refreshActions();
    this.renderSidebar();
  }
}
