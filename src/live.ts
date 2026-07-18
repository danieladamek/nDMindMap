/**
 * Obsidian-style **Live** preview editor, lazy-loaded (dynamic import) so
 * CodeMirror only enters the bundle when the reader's Live mode is opened.
 *
 * The live-preview plugin is ported from the GrandsTech Reader
 * (`obsidian-riffraft/native/editor/src/livepreview.js`): it walks the markdown
 * syntax tree and, on every line the selection is NOT on, hides the syntax marks
 * (`#`, `**`, `` ` ``, `>`, link URLs) and styles the content — so those lines
 * read as rendered while the caret's line shows raw markdown. The RiffRaft
 * midi-loop widget is dropped; a highlight for our `@[label]` tokens is added.
 */

import { EditorView, ViewPlugin, Decoration, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { EditorState, type Extension, type Range } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";

class HRWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = "cm-md-hr";
    return hr;
  }
  ignoreEvent(): boolean { return false; }
}

const HIDE_MARKS = new Set(["HeaderMark", "EmphasisMark", "CodeMark", "StrikethroughMark", "LinkMark", "QuoteMark"]);
const STYLE_NODE: Record<string, string> = {
  StrongEmphasis: "cm-md-strong",
  Emphasis: "cm-md-em",
  InlineCode: "cm-md-code",
  Strikethrough: "cm-md-strike",
  Link: "cm-md-link",
};
const HEADING: Record<string, string> = {
  ATXHeading1: "cm-md-h1", ATXHeading2: "cm-md-h2", ATXHeading3: "cm-md-h3",
  ATXHeading4: "cm-md-h4", ATXHeading5: "cm-md-h5", ATXHeading6: "cm-md-h6",
};
const AT_LINK_RE = /@\[[^\]]+\]/g;

function activeLineSet(view: EditorView): Set<number> {
  const set = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number;
    const b = view.state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) set.add(n);
  }
  return set;
}

function buildDecorations(view: EditorView): DecorationSet {
  const w: Range<Decoration>[] = [];
  const active = activeLineSet(view);
  const doc = view.state.doc;

  const lineActive = (from: number, to: number): boolean => {
    const a = doc.lineAt(from).number;
    const b = doc.lineAt(to).number;
    for (let n = a; n <= b; n++) if (active.has(n)) return true;
    return false;
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter: (node) => {
        const name = node.name;
        if (HEADING[name]) {
          const line = doc.lineAt(node.from);
          w.push(Decoration.line({ class: HEADING[name] }).range(line.from));
          return;
        }
        if (name === "Blockquote") {
          let ln = doc.lineAt(node.from).number;
          const end = doc.lineAt(node.to).number;
          for (; ln <= end; ln++) w.push(Decoration.line({ class: "cm-md-quote" }).range(doc.line(ln).from));
          return;
        }
        if (name === "HorizontalRule") {
          if (!lineActive(node.from, node.to)) w.push(Decoration.replace({ widget: new HRWidget(), block: false }).range(node.from, node.to));
          return;
        }
        if (STYLE_NODE[name]) {
          if (node.to > node.from) w.push(Decoration.mark({ class: STYLE_NODE[name] }).range(node.from, node.to));
          return;
        }
        if (HIDE_MARKS.has(name)) {
          if (node.to > node.from && !lineActive(node.from, node.to)) w.push(Decoration.replace({}).range(node.from, node.to));
          return;
        }
        if (name === "URL" || name === "LinkTitle") {
          if (node.to > node.from && !lineActive(node.from, node.to)) w.push(Decoration.replace({}).range(node.from, node.to));
          return;
        }
      },
    });

    // Our @[label] tokens → highlighted chip (styled, never hidden).
    const text = view.state.sliceDoc(from, to);
    for (const m of text.matchAll(AT_LINK_RE)) {
      const start = from + (m.index ?? 0);
      w.push(Decoration.mark({ class: "cm-md-atlink" }).range(start, start + m[0].length));
    }
  }

  return Decoration.set(w, true);
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildDecorations(view); }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) this.decorations = buildDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

const theme: Extension = EditorView.theme({
  "&": { color: "var(--text)", backgroundColor: "var(--node)", border: "1px solid var(--node-stroke)", borderRadius: "9px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "14px", lineHeight: "1.65", padding: "12px 16px", maxHeight: "58vh" },
  ".cm-content": { caretColor: "var(--text)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
});

export interface LiveEditor {
  getDoc(): string;
  setDoc(text: string): void;
  /** Wrap the current selection with `pre`/`post` (used by Make node). */
  wrapSelection(pre: string, post: string): void;
  focus(): void;
  destroy(): void;
}

export function mountLive(parent: HTMLElement, doc: string, onChange: (text: string) => void): LiveEditor {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        livePreview,
        EditorView.lineWrapping,
        theme,
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
      ],
    }),
  });
  (parent as unknown as { cmView?: EditorView }).cmView = view; // debug/introspection handle
  return {
    getDoc: () => view.state.doc.toString(),
    setDoc: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    wrapSelection: (pre, post) => {
      const r = view.state.selection.main;
      if (r.from === r.to) { view.focus(); return; }
      view.dispatch({
        changes: [{ from: r.from, insert: pre }, { from: r.to, insert: post }],
        selection: { anchor: r.from, head: r.to + pre.length + post.length },
      });
      view.focus();
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
