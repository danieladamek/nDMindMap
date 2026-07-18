/**
 * Explosion Reader modal (Phase 1) — load or paste a text/markdown document,
 * lightly annotate it, and "explode" it into a hierarchical map (see explode.ts).
 *
 * Annotation here is deliberately minimal: select a word or phrase and press
 * "Make node" to wrap it in `@[…]` — so you build links without typing the
 * notation. The actual nodes/edges are created when you Explode.
 *
 * Phase 2 (deferred): PDF/DOCX ingest and the parallel capture sidebar.
 */

export interface ReaderCallbacks {
  /** Build a map from the (possibly annotated) document text. */
  onExplode: (text: string, title: string) => void;
}

export class ReaderModal {
  private overlay: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private titleInput!: HTMLInputElement;

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
    queueMicrotask(() => this.textarea.focus());
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

    // Source row: open a file, and a document-title field.
    const src = document.createElement("div");
    src.className = "ndmm-reader-src";
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
    src.append(openBtn, titleField);

    // The document text.
    this.textarea = document.createElement("textarea");
    this.textarea.className = "ndmm-reader-text";
    this.textarea.placeholder =
      "Paste a document, or Open a file.\n\n" +
      "# Headings and\n- nested bullets\nbecome the outline; paragraphs become Sec1.2.3 nodes.\n\n" +
      "Wrap an entity in @[Label] (or select it and press “Make node”) to link it — those become part-of connections.";

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

    panel.append(head, src, this.textarea, actions);
    this.overlay.append(panel);
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
      this.textarea.focus();
    });
    input.click();
  }

  /** Wrap the current textarea selection in `@[…]`. */
  private makeNodeFromSelection(): void {
    const ta = this.textarea;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) { ta.focus(); return; } // nothing selected
    const sel = ta.value.slice(start, end).trim();
    if (!sel) { ta.focus(); return; }
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const wrapped = `@[${sel}]`;
    ta.value = before + wrapped + after;
    // Re-select the inserted token so repeated words are easy to see.
    ta.focus();
    ta.setSelectionRange(start, start + wrapped.length);
  }

  private explode(): void {
    const text = this.textarea.value.trim();
    if (!text) { this.textarea.focus(); return; }
    this.cb.onExplode(text, this.titleInput.value.trim());
    this.close();
  }
}
