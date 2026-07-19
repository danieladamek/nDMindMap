# nDMindMap — User & Test Guide

> **How to use this document**
> 1. **Capability checklist** — every feature the app currently has is listed as a testable item.
> 2. **Verification & Validation** — each `- [ ]` is a behavior you can exercise and tick off. If the *actual* behavior differs from what's written, **strike the line and add a note** (e.g. `⚑ I want X instead`). "Purpose" says *why* it exists; "Expected behavior" says *what should happen*.
>
> Legend: **V** = verify it works as written · **⚑** = flag if the behavior isn't what you want. Reserved attribute keys the app manages for you (never shown in the free-form editors): `type`, `level`, `shape`, `color`, `size`, `pinned`, `note`, `dir`, `sec`, `kind`.

---

## 1. Introduction — what nDMindMap is

nDMindMap is a **markdown-native, graph-shaped idea-capture engine**. Unlike a plain mind map, every node carries **open-ended dimensions** (typed attributes), and links are **typed relationships** rather than bare parent/child lines. The source of truth is a **plain, diffable `.ndmm.md` Markdown file** that lives in git.

**Core concepts**

- **Node** — an idea/box on the map. Has a `label`, optional `type`, optional abstraction `level`, visual channels (shape/color/size), and any number of free-form **dimensions** (key/value attributes).
- **Child-of tree** — the mind-map spine. `child-of` edges form the outline (parent → children), drawn as smooth connectors.
- **Dimensions (typed cross-links)** — non-`child-of` edges, e.g. `proxy-for`, `causes`, `part-of`, `mentions`. Drawn as dashed, labelled, arrow-tipped curves.
- **Abstraction level** — a node's "kind of thing" (subjective-experience, biomarker, …). Powers the category-error lint.
- **Edge semantics** — honest relation vocabulary (`is-a`, `proxy-for`, `measured-by`, `correlates-with`, `causes`) with level rules.
- **Entity** — a node created from an `@[link]` in prose (a mentioned thing).
- **Document** — a paper exploded into the map; a `document` root with a heading/bullet subtree; the paper is a **projection** of that subtree.

**Feature areas** (each has its own section below): the map canvas · the outline list · the inspector · visual-channel binding + legend · dimension filters · the emergent schema view · the category-error lint · the interrogation modal · the Explosion Reader (Read/Live/Source + link sidebar + paper↔map sync) · file handling · undo/redo.

---

## 2. Toolbar (top bar)

Left-to-right.

### 2.1 Brand `nDMindMap ●`
- **Purpose:** identity; the dot is decorative (accent colour).
- [ ] **V** Non-interactive.

### 2.2 File group — `New`
- **Purpose:** start a blank map.
- [ ] **V** If there are unsaved changes, a **"Discard unsaved changes?"** dialog appears first; Cancel keeps the map, Discard proceeds.
- [ ] **V** Produces an empty, untitled map (no nodes); filename indicator shows `Untitled`; undo history resets.

### 2.3 File group — `Open`
- **Purpose:** open a `.ndmm.md` map file.
- [ ] **V** Warns about unsaved changes first (as New).
- [ ] **V** On Chromium: a native file picker; on other browsers: a file chooser fallback.
- [ ] **V** Loads the map; the filename shows the file's name; undo history resets.

### 2.4 File group — `Save`
- **Purpose:** write the current map back to its file.
- [ ] **V** Disabled (greyed) when there are no unsaved changes.
- [ ] **V** With a known file (opened/saved before): writes back to the same file silently (Chromium).
- [ ] **V** With no file yet: behaves like **Save As**.
- [ ] **V** Keyboard `⌘/Ctrl-S` triggers it from anywhere.

### 2.5 File group — `Save As`
- **Purpose:** choose a new file/location.
- [ ] **V** Chromium: native save picker, suggested name `<title>.ndmm.md`.
- [ ] **V** Non-Chromium: downloads the `.ndmm.md`.
- [ ] **V** Keyboard `⌘/Ctrl-Shift-S`.

### 2.6 File group — filename indicator
- **Purpose:** show the current document name and dirty state.
- [ ] **V** Shows `Untitled` (or the file name) after New/Open/Save.
- [ ] **V** A leading `•` appears when there are unsaved changes and disappears after Save.
- [ ] **V** Closing/reloading the tab with unsaved changes prompts a browser "leave site?" warning.

### 2.7 `📖 Read`
- **Purpose:** open the **Explosion Reader** (§12).
- [ ] **V** Opens the reader modal.

### 2.8 `+ Root`
- **Purpose:** add a new, unparented root node.
- [ ] **V** Creates a root node and immediately opens its inline label editor.

### 2.9 `+ Link`
- **Purpose:** draw a typed relationship (dimension) from the selected node.
- [ ] **V** With no node selected: a status hint tells you to select one first.
- [ ] **V** With a node selected: enters "link mode" (crosshair cursor); the next node you click becomes the target and the **edge editor** opens to name the relation.
- [ ] **V** Keyboard `L` does the same when a node is selected.

### 2.10 `Tidy`
- **Purpose:** re-run the automatic layout.
- [ ] **V** Clears all hand-placed pins and re-lays the tree tidily.

### 2.11 `↶ Undo` / `↷ Redo`
- **Purpose:** step backward/forward through edits.
- [ ] **V** Disabled when there's nothing to undo/redo.
- [ ] **V** Undo reverts the last change; Redo re-applies it.
- [ ] **V** Keyboard `⌘/Ctrl-Z` (undo), `⌘/Ctrl-Shift-Z` or `Ctrl-Y` (redo).
- [ ] **V** While typing in a text field, `⌘/Ctrl-Z` does the field's *native* text undo, not app undo.
- [ ] **⚑** Granularity: a burst of edits within ~400ms coalesces into one undo step (so "create a node then name it" may be two steps).

### 2.12 `List` toggle
- **Purpose:** show/hide the outline list (§6).
- [ ] **V** Checked shows the left outline panel; unchecked hides it.

### 2.13 `Schema` toggle
- **Purpose:** show/hide the emergent schema overlay (§10).
- [ ] **V** Checked shows the schema panel over the map; unchecked hides it.

### 2.14 `Grid` toggle
- **Purpose:** snap-to-grid for hand placement.
- [ ] **V** Checked shows a grid pattern and snaps dragged nodes to it.

### 2.15 `Bind: color / shape / size`
- **Purpose:** globally map a visual channel to a **dimension** (attribution).
- [ ] **V** Each dropdown lists `—` (unbound), `type`, `level`, and every free-form attribute key in use.
- [ ] **V** Binding e.g. `color → level` colours every node by its level; a **Legend** (§9) appears mapping values → colours.
- [ ] **V** `shape` and `size` behave the same (size buckets numeric values into S/M/L; non-numeric cycle).
- [ ] **V** Setting a channel back to `—` returns nodes to their own per-node aesthetic value.

### 2.16 Status/hint text (right)
- **Purpose:** contextual hint / last-action feedback.
- [ ] **V** Shows capture hints when idle and messages after actions (e.g. "exploded into N nodes", "synced document").

---

## 3. The Map (canvas)

The central pane. Nodes are boxes; the `child-of` spine is smooth connectors; dimensions are dashed labelled curves.

### 3.1 Node rendering
- [ ] **V** A node shows its label; its **type** (if any) appears as a small tag above it.
- [ ] **V** Shape/color/size reflect the node's own channels, or the bound dimension when a channel is bound.
- [ ] **V** A **pinned** (hand-placed) node has a dashed outline.
- [ ] **V** The selected node has a highlighted (accent) outline.

### 3.2 Select a node
- [ ] **V** Click a node → selects it; the inspector (§7) shows its fields; the matching list row highlights.
- [ ] **V** Click empty canvas → deselects.

### 3.3 Double-click a node → rename
- **Purpose:** quick label edit (same as F2).
- [ ] **V** Double-clicking a node opens the inline editor with the label selected; typing replaces it.

### 3.4 Drag a node → move & pin
- [ ] **V** Dragging a node moves it and marks it **pinned** (dashed outline); the layout leaves pinned nodes alone.
- [ ] **V** With **Grid** on, movement snaps to the grid.

### 3.5 Child-of connector — click to select
- **Purpose:** edit/route the tree link.
- [ ] **V** Clicking a `child-of` connector selects it and opens the **edge editor**.
- [ ] **V** In the editor, **Delete edge** makes the child a root; **retyping** the relation converts the link into a dimension (typed cross-link).

### 3.6 Child-of connector — drag to re-parent
- **Purpose:** move a node under a new parent on the map.
- [ ] **V** Pressing a `child-of` connector and dragging shows a **rubber-band line** from the child to the cursor.
- [ ] **V** Valid drop targets (any node that is **not** the child or one of its descendants) **highlight** as you hover.
- [ ] **V** Dropping on a valid node re-parents the child; dropping elsewhere cancels.
- [ ] **V** A press *without* dragging still just selects the connector.

### 3.7 Dimension (cross-link) — click to select
- [ ] **V** Clicking a dashed dimension edge selects it and opens the edge editor.
- [ ] **V** Multiple dimensions between the same pair **fan out** as separate curves with staggered labels (no overprinting).
- [ ] **V** A directed edge shows an **arrowhead**; a bidirectional one (`dir: both`) has arrowheads at both ends.

### 3.8 Keyboard — capture & navigation (canvas focused, not editing)
- [ ] **V** `Tab` — add a child to the selected node (or a root if none) and edit it.
- [ ] **V** `Enter` — add a sibling (or a root if none) and edit it.
- [ ] **V** `F2` — rename the selected node.
- [ ] **V** `L` — start link mode from the selected node.
- [ ] **V** `I` — open the **Interrogation modal** (§11) on the selected node or edge.
- [ ] **V** `Delete`/`Backspace` — delete the selected edge, or delete the selected node's subtree (with the warning dialog, §3.10).
- [ ] **V** `←` select parent · `→` select first child · `↑`/`↓` move selection among siblings.
- [ ] **V** `Esc` — cancel link mode, or deselect.

### 3.9 Inline label editor — Return/Tab behavior
- [ ] **V** While editing a label, `Enter` **commits** the label and returns to the node (it does **not** immediately create a sibling).
- [ ] **V** A **second** `Enter` (canvas focused) creates a sibling.
- [ ] **V** `Tab` in the editor commits and creates a child.
- [ ] **V** `Esc` cancels; a brand-new empty node is removed on cancel.

### 3.10 Delete warning (impact)
- **Purpose:** prevent accidental destructive deletes; show the blast radius.
- [ ] **V** Deleting a node with descendants and/or linked relationships shows a dialog stating how many **nodes**, **connections**, and **severed relationships to surviving nodes** will be removed.
- [ ] **V** A **lone, unconnected leaf** deletes immediately with no dialog.
- [ ] **V** The dialog notes the delete is undoable; Cancel keeps everything, Delete proceeds.
- [ ] **⚑** Deleting a **single dimension edge** (via Delete or the edge editor) does *not* prompt.

---

## 4. Layout behavior

- [ ] **V** New nodes are placed automatically in a tidy left-to-right tree.
- [ ] **V** Hand-dragged nodes stay put (pinned) until **Tidy** clears pins.
- [ ] **V** The canvas scrolls when the map is larger than the viewport.

---

## 5. Link mode (creating dimensions)

- [ ] **V** Triggered by `+ Link` or `L` with a node selected; cursor becomes a crosshair.
- [ ] **V** Clicking a target node creates a `relates-to` edge and opens the edge editor to rename it.
- [ ] **V** Clicking empty space or `Esc` cancels.

---

## 6. Outline list (left panel)

Toggled by the **List** toolbar checkbox.

### 6.1 Rows
- [ ] **V** Shows the `child-of` tree as an indented outline; each row has a colour chip, the label, and a type tag (if typed).
- [ ] **V** The chip reflects the node's effective colour (including a bound colour channel).

### 6.2 Select / rename
- [ ] **V** Click a row → selects that node everywhere (map + inspector).
- [ ] **V** Double-click a row → inline rename.

### 6.3 Drag to re-parent
- [ ] **V** Drag a row onto another row → makes it that row's child.
- [ ] **V** Drop on empty panel space → makes it a root.
- [ ] **V** A cycle-creating drop is rejected with a status message.

---

## 7. Inspector (right panel)

Context-sensitive: shows the selected node, the selected edge, or an empty prompt.

### 7.0 Empty state
- [ ] **V** With nothing selected: "Select a node to edit its type, attributes, and appearance."

### 7.1 Node — `Label`
- [ ] **V** Edits the node's label live; the map and list update.

### 7.2 Node — `Type` (+ datalist + Promote + help)
- **Purpose:** the node's kind; the schema's node vocabulary.
- [ ] **V** Free text with autocomplete over registered types.
- [ ] **V** Assigning a **known** type applies that type's default colour/shape.
- [ ] **V** **★ Promote to type** registers the current type globally, capturing the node's colour/shape as defaults; the button reads "Update type defaults" if already registered.
- [ ] **V** Help caption explains what Type is.

### 7.3 Node — `Abstraction level` (+ datalist + help)
- **Purpose:** how abstract the node is (subjective-experience, biomarker, …); powers the lint.
- [ ] **V** Free text with suggested levels + levels already in use.
- [ ] **V** Help caption explains it.

### 7.4 Node — `Shape`
- [ ] **V** Dropdown: Rounded / Rectangle / Pill / Ellipse / Diamond; changes the node shape.
- [ ] **V** Overridden when a shape channel is bound.

### 7.5 Node — `Color`
- [ ] **V** Swatches (Default + palette); clicking sets the node fill; `∅` clears to default.
- [ ] **V** Overridden when a colour channel is bound.

### 7.6 Node — `Size`
- [ ] **V** Segmented S / M / L; changes the node size.
- [ ] **V** Overridden when a size channel is bound.

### 7.7 Node — `Attributes (dimensions)`
- **Purpose:** open-ended typed data on the node.
- [ ] **V** Lists non-reserved key/value pairs; editable keys and values.
- [ ] **V** Value coercion: `true`/`false` → boolean, numeric strings → number, else string.
- [ ] **V** `+ Add attribute` adds a new row; `×` removes a row.
- [ ] **V** New attribute keys appear in the **Bind** dropdowns (§2.15).

### 7.8 Node — `🔎 Interrogate`
- [ ] **V** Opens the interrogation modal focused on this node (§11).

### 7.9 Node — `id:` note
- [ ] **V** Shows the node's internal id (read-only).

### 7.10 Edge — `Relation` (+ datalist + Promote + chips + semantic hint)
- **Purpose:** the relationship type.
- [ ] **V** Free text; the datalist and chips offer the honest-semantics vocabulary (`is-a`, `proxy-for`, `measured-by`, `correlates-with`, `causes`) plus registered/in-use types.
- [ ] **V** Choosing a vocabulary relation shows a **hint** describing its meaning and its level rule (same / crossing / any).
- [ ] **V** **★ Promote to type** registers the relation as a global edge type.
- [ ] **V** Chips are a quick-pick; the active one is highlighted; registered ones show a ★.

### 7.11 Edge — `Connects`
- [ ] **V** Read-only "source → target" labels.

### 7.12 Edge — category-error warning + fix
- [ ] **V** When an identity-claiming relation (`is-a`) connects two nodes on **different** abstraction levels, a red warning box explains the level-crossing collapse.
- [ ] **V** A **"Retype as proxy-for"** button applies the honest fix and clears the warning.

### 7.13 Edge — `Parameters`
- [ ] **V** Free-form key/value attributes on the edge (reserved keys hidden).

### 7.14 Edge — `🔎 Interrogate` / `Delete edge` / `edge:` id
- [ ] **V** Interrogate opens the modal on the edge (§11).
- [ ] **V** Delete edge removes it (no confirmation).
- [ ] **V** Shows the edge id (read-only).

---

## 8. Dimension filters (map overlay, top-left)

- **Purpose:** show/hide the map by relation type.
- [ ] **V** A "dimensions:" bar shows one chip per non-`child-of` relation in use.
- [ ] **V** Clicking a chip hides that relation's edges (chip becomes struck-through); clicking again shows them.
- [ ] **V** `mentions` edges (created from prose `@[links]`) are **hidden by default**; their chip is struck-through until you reveal them.

---

## 9. Visual channels & Legend (map overlay, bottom-left)

- **Purpose:** read the current channel↔dimension bindings.
- [ ] **V** When any channel is bound (§2.15), a legend appears listing, per channel, each dimension value and the colour/shape/size it maps to.
- [ ] **V** For a numeric size binding, the legend shows the min/max mapping.
- [ ] **V** The legend disappears when no channel is bound.

---

## 10. Emergent Schema panel (map overlay, right)

Toggled by the **Schema** checkbox.

- **Purpose:** show the schema the sketch implies.
- [ ] **V** **Node kinds** — each kind (a node's `type`, else its `level`, else `(untyped)`) with its instance count and observed dimension keys; type-sourced kinds are accent-coloured.
- [ ] **V** **Relations (domain → range)** — each observed `sourceKind --relation--> targetKind` pattern with a count.
- [ ] **V** Updates live as you edit (type a node, add an edge).

---

## 11. Category-error lint

- **Purpose:** flag "proxy-as-identity" — an `is-a` (identity) edge whose ends sit on different abstraction levels.
- [ ] **V** The offending dimension edge turns **solid red** with a `⚠` badge on its label.
- [ ] **V** A red **banner** at the top of the map shows `⚠ N category error(s)` with a **review** button that selects the first offender.
- [ ] **V** Selecting the edge shows the inspector warning + fix (§7.12).
- [ ] **V** Fixing (retype to a crossing relation) clears the red edge, the badge, and the banner.

---

## 12. Interrogation modal

Opened by the inspector `🔎 Interrogate` button or the `I` key; a focused view over **one** node or edge.

### 12.1 Node focus
- [ ] **V** Header "🔎 Interrogate node" + the node label; **kind chips** show its type/level.
- [ ] **V** **Connections (N)** — one row per incident edge: an arrow (→ outgoing / ← incoming) + the relation, and the node at the far end.
- [ ] **V** Clicking the **relation** chip refocuses the modal on that edge.
- [ ] **V** Clicking the **far node** refocuses the modal on that node (graph traversal).
- [ ] **V** **Notes** — a broad freeform editor bound to the node's note.
- [ ] **V** Typing `@[Label]` and committing (close/refocus) creates a **`mentions`** edge to that node, creating the node if the label is unknown (case-insensitive match).
- [ ] **V** `[[Label]]` is **left literal** (reserved for future links to real Obsidian notes) — it does not create anything.

### 12.2 Edge focus
- [ ] **V** Header "🔎 Interrogate relationship"; both endpoints shown and **clickable** (jump focus to that node).
- [ ] **V** **Directionality** controls: `source → target` (default), `↔ bidirectional` (`dir: both`), `⇄ flip` (swap source/target).
- [ ] **V** Changing directionality updates the map arrowheads.
- [ ] **V** **Notes** editor for the edge; `@[ ]` here has **no** graph side effects (per the brief).

### 12.3 Modal chrome
- [ ] **V** `✕` / backdrop click / `Esc` closes; edits persist (the graph is the source of truth).

---

## 13. Explosion Reader

Opened by `📖 Read`. A two-pane editor: text panes (left) + link sidebar (right). Turns a document into a map and keeps the two in sync (**the map is canonical; the paper is a projection**).

### 13.1 Header & source row
- [ ] **V** Kicker "📖 Explosion Reader" + title.
- [ ] **V** **Mode segmented control: Read / Live / Source** (see below).
- [ ] **V** **Open .md / .txt…** loads a text/markdown file into the editor.
- [ ] **V** **+ New document** (shown only while editing an existing document) abandons the active doc and starts a fresh one.
- [ ] **V** **Title** field — overrides the document label; defaults to the first heading.

### 13.2 Source mode
- [ ] **V** A raw markdown `textarea` you type/paste into.

### 13.3 Read mode
- [ ] **V** A clean rendered markdown column (headings, lists, emphasis, code, quotes, links).
- [ ] **V** `@[Label]` renders as a violet **chip**; with **Link ticks** on, each chip shows a `✓`.
- [ ] **V** Clicking a chip or a heading **cross-highlights** the matching item in the sidebar and scrolls to it.

### 13.4 Live mode (Obsidian-style live preview)
- [ ] **V** A CodeMirror editor (lazy-loaded on first use) where markdown renders inline, and the **caret's line** reveals raw markdown while other lines hide their `#`/`**`/`` ` ``/`>` marks.
- [ ] **V** `@[Label]` shows as a chip; editing updates the document.

### 13.5 Make node / toggles
- [ ] **V** **+ Make node from selection** wraps the selected text (in any view) in `@[…]` so it becomes a linked node on explode.
- [ ] **V** **Link ticks** checkbox toggles the `✓` markers on `@[links]` in Read view.
- [ ] **V** **Split paragraphs** checkbox — ON: each paragraph becomes a node labelled by its first sentence; OFF: prose folds into the nearest heading's note (lean outline).

### 13.6 Link sidebar
- [ ] **V** **External items** — root nodes *not* part of the paper-derived graph (non-entity roots).
- [ ] **V** **Sections** — the document outline nested (with `sec` numbers), and each section's **linked `@[]` items woven in as children**, shown *without* the `@[]` notation and tagged "link".
- [ ] **V** Clicking any sidebar item **selects that node on the map** and cross-highlights the text (§13.3).

### 13.7 Explode / Sync
- [ ] **V** First time: **💥 Explode into map** builds the document subtree; the reader then tracks that document.
- [ ] **V** Re-opening the reader on the active document loads its **current projection** (so edits made on the map show up in the paper).
- [ ] **V** The button becomes **🔄 Sync to map**; syncing **updates the document in place — no duplicate map**.
- [ ] **V** Sync is **non-destructive**: unchanged nodes keep their ids; a renamed heading keeps its id; hand-added edges and pinned positions survive; new sections are added, removed sections are removed.
- [ ] **V** `@[label]` in prose resolves to a **`part-of`** edge to the section it sits in (matching an existing node by label/`SecN`, else creating an entity).
- [ ] **V** **Close** dismisses the reader (edits already applied via Explode/Sync).

### 13.8 What explode produces (node kinds)
- [ ] **V** One `document` root (the title/first heading).
- [ ] **V** `heading` nodes nested by heading depth; `bullet` nodes nested by indent; `section` nodes for paragraphs (Split on).
- [ ] **V** `entity` nodes for `@[links]`, linked by `part-of`.
- [ ] **V** Every structural node carries a `sec` outline number.

---

## 14. File format (`.ndmm.md`)

The saved file is plain Markdown you can read/diff in any editor.

- [ ] **V** `# nDMindMap: <title>` header.
- [ ] **V** `## Nodes` — `- [id] Label @x,y {key: value, …}` (position + attrs optional).
- [ ] **V** `## Edges` — `- [src] --relation--> [dst] {…}`.
- [ ] **V** `## Node Types` / `## Edge Types` — registered types (when present).
- [ ] **V** `## Bindings` — `- color: level` etc. (when present).
- [ ] **V** `## Notes` — multi-line prose per node/edge (`### node [id]` / `### edge [src] --rel--> [dst]`), so `@[links]` and interrogation notes round-trip without cluttering the inline `{…}` trailer.
- [ ] **V** Round-trips: Save then Open reproduces the same map.

---

## 15. Keyboard shortcuts (summary)

| Key | Context | Action |
|---|---|---|
| `Tab` | node selected | add child (+edit) |
| `Enter` | node selected | add sibling (+edit) |
| `Enter` | editing label | commit label (a 2nd Enter makes a sibling) |
| `Tab` | editing label | commit + add child |
| `Esc` | editing / link mode / selection | cancel / deselect |
| `F2` | node selected | rename |
| `L` | node selected | link mode |
| `I` | node/edge selected | interrogate |
| `Delete` / `Backspace` | selection | delete (edge, or node subtree w/ warning) |
| `← → ↑ ↓` | node selected | navigate (parent / child / siblings) |
| `⌘/Ctrl-Z` | canvas | undo |
| `⌘/Ctrl-Shift-Z` / `Ctrl-Y` | canvas | redo |
| `⌘/Ctrl-S` | anywhere | save |
| `⌘/Ctrl-Shift-S` | anywhere | save as |

---

## 16. Known limits / behaviors to confirm (flag these)

- [ ] **⚑** Undo coalesces edits per ~400ms burst (create-then-name = 2 steps).
- [ ] **⚑** Reader **Sync** reconciliation is level-local: a heading **moved to a different parent** or **demoted to a bullet** is delete+recreated (loses its id/edges); same-level renames/reorders preserve identity.
- [ ] **⚑** Removing an `@[link]`'s last reference leaves the **entity node** floating (not auto-pruned).
- [ ] **⚑** Cross-highlight (§13.3) works in **Read** view only; not yet in Live/Source.
- [ ] **⚑** The blank-`@[]`-autofills-a-section helper and per-section on/off toggles from the wireframe are **not yet built**.
- [ ] **⚑** The active reader document is remembered **in-session only** (a page reload forgets which root is "the paper").
- [ ] **⚑** PDF/DOCX ingest is **not** built — the reader takes Markdown/plain text (or paste) only.
- [ ] **⚑** Save/Open native pickers require a Chromium browser; other browsers use download/upload fallbacks.
