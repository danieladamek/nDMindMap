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

export interface ReaderCallbacks {
  /** Build a map from the (possibly annotated) document text. */
  onExplode: (text: string, title: string) => void;
}

type Mode = "read" | "source";

export class ReaderModal {
  private overlay: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private readPane!: HTMLElement;
  private titleInput!: HTMLInputElement;
  private modeButtons: Record<Mode, HTMLButtonElement> = {} as Record<Mode, HTMLButtonElement>;
  private mode: Mode = "source";

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
    this.overlay.style.display = "flex";
    this.setMode(this.textarea.value.trim() ? this.mode : "source");
    queueMicrotask(() => { if (this.mode === "source") this.textarea.focus(); });
  }

  close(): void {
    this.overlay.style.display = "none";
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
    (["read", "source"] as Mode[]).forEach((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = m === "read" ? "Read" : "Source";
      b.title = m === "read" ? "Clean rendered view" : "Raw markdown — edit & annotate";
      b.addEventListener("click", () => this.setMode(m));
      this.modeButtons[m] = b;
      seg.append(b);
    });

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "ndmm-reader-open";
    openBtn.textContent = "Open .md / .txt…";
    openBtn.addEventListener("click", () => this.openFile());

    const titleField = document.createElement("label");
    titleField.className = "ndmm-reader-title";
    titleField.append("Title ");
    this.titleInput = document.createElement("input");
    this.titleInput.className = "insp-input";
    this.titleInput.placeholder = "defaults to the first heading";
    titleField.append(this.titleInput);

    src.append(seg, openBtn, titleField);

    // Panes: the rendered Read view and the raw Source textarea (one shown).
    const panes = document.createElement("div");
    panes.className = "ndmm-reader-panes";

    this.readPane = document.createElement("article");
    this.readPane.className = "ndmm-md ndmm-reader-read";

    this.textarea = document.createElement("textarea");
    this.textarea.className = "ndmm-reader-text";
    this.textarea.placeholder =
      "Paste a document, or Open a file.\n\n" +
      "# Headings and\n- nested bullets\nbecome the outline; paragraphs become Sec1.2.3 nodes.\n\n" +
      "Wrap an entity in @[Label] (or select it and press “Make node”) to link it — those become part-of connections.";

    panes.append(this.readPane, this.textarea);

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
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ndmm-reader-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.close());
    const explode = document.createElement("button");
    explode.type = "button";
    explode.className = "ndmm-reader-explode";
    explode.textContent = "💥 Explode into map";
    explode.addEventListener("click", () => this.explode());
    actions.append(makeNode, hint, spacer, cancel, explode);

    panel.append(head, src, panes, actions);
    this.overlay.append(panel);
  }

  private setMode(m: Mode): void {
    this.mode = m;
    for (const key of ["read", "source"] as Mode[]) this.modeButtons[key].classList.toggle("is-active", key === m);
    const read = m === "read";
    if (read) this.readPane.innerHTML = renderMarkdown(this.textarea.value);
    this.readPane.style.display = read ? "block" : "none";
    this.textarea.style.display = read ? "none" : "block";
    if (!read) queueMicrotask(() => this.textarea.focus());
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
      this.setMode("read"); // show the freshly-loaded document rendered
    });
    input.click();
  }

  /** Wrap the current selection in `@[…]`, in whichever view is active. */
  private makeNodeFromSelection(): void {
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
    const text = this.textarea.value.trim();
    if (!text) { this.setMode("source"); this.textarea.focus(); return; }
    this.cb.onExplode(text, this.titleInput.value.trim());
    this.close();
  }
}
