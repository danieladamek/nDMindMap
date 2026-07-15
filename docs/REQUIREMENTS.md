# nDMindMap — Requirements (living doc)

> Status: **drafting.** Built through interview, not a spec to implement yet.
> Sections marked _⟨open⟩_ are still being filled in. Text marked _[synthesis]_
> is my interpretation of your words — correct it freely.

## 0. One-liner

_[synthesis — confirm/rewrite]_ nDMindMap is a mind-mapping tool that doubles as
an **informal-to-formal graph modeling surface**: you sketch ideas as a familiar
map (shapes, colors, tab-for-child), then progressively add typed nodes and typed
edges until the sketch *becomes a schema* — which can graduate into a real graph
database for scale. The "nD" is that any idea can participate in many typed
relationships and attribute dimensions at once, not just a single parent tree.

## 1. The 20-year gap — why nothing else does this

_[synthesis from your dump — confirm & sharpen]_ Existing tools sit at one of two
extremes:

- **Mind-mappers / outliners** (MindNode, XMind, Obsidian Canvas, Workflowy…):
  fast and informal, but fundamentally **tree-shaped**. Edges are only
  "child-of"; you can't define real relationship types, type your nodes, or
  carry a schema. You can't graduate the artifact into anything rigorous.
- **Graph databases / ontology tools** (Neo4j, Protégé…): rigorous and typed,
  but they demand you **already know the schema** before you can think. There's
  no low-friction sketching mode; you can't brainstorm your way *into* the model.

nDMindMap lives in the **missing middle**: the fast, aesthetic capture of a mind
map, with a smooth ramp from "just colored blobs" → typed nodes/edges →
settled schema → exported graph DB. _⟨open: anything else that has specifically
frustrated you — a moment you remember hitting the wall?⟩_

## 2. Who it's for & when it's used

_⟨open⟩_ You first. Strong hypothesis worth confirming: this is partly a **meta-tool
for your own knowledge-graph work** (you already run Neo4j for the
PTSD–Inflammation KG, and the Here-for-You infra-mapping is graph-shaped) — a
place to *design and interrogate a schema* before committing it to the DB. Is that
a primary use case, or is the audience broader (general brainstormers / thinkers)?

## 3. Core concepts (the data model)

### Nodes / containers
- Have **shape, color, size** — each a *visual channel* that can carry meaning or
  be purely aesthetic ("unassigned").
- **Node type** — flexible, definable, parameterizable.
- **Attributes** — arbitrary key/values, editable in *both* map view and list view.

### Visual channels ↔ meaning (attribution)
- Color / shape / size can be **bound globally** to a meaning (e.g. color = domain,
  size = confidence) — or left unbound (aesthetic only).
- Binding is optional and reversible; a map can be all-aesthetic, all-semantic, or
  mixed.

### Edges (relationships) — this is the heart of "nD"
- Default edge type = **"child-of"** (so it behaves like a normal mind map on day 1).
- Edges are **typed, and typing is open**: new edge types can be defined, and each
  edge (or edge type) can be **parameterized / attributed** — case-by-case and/or
  globally.
- **Promotion:** a one-off case-by-case edge can be converted into a **global,
  selectable edge type**. (Same idea likely applies to node types.)
- Global edge types can carry global attribute settings.
- → A node participates in **many typed relationships at once** = its n dimensions.

### "Dimension" — settled definition
A **dimension is a facet / angle of characterization** of an idea. (User's
example: a biomolecule can be characterized biophysically, architecturally,
functionally, by interaction type, by phenotype association — each is a
dimension.) A facet is:
- **recorded as an attribute** when it's an intrinsic value (e.g. molecular weight
  → the biophysical dimension), and/or
- **recorded as a typed edge** when it's a relationship (e.g. `binds`,
  `associated-with-phenotype` → the interaction / phenotype dimensions), and
- **optionally projected onto a visual channel** (color = functional class, etc.)
  — a channel is just how one chosen dimension is shown in the picture.

So: **facet → recorded as attributes and/or typed edges → optionally projected to
color/shape/size.** An idea sits in many dimensions at once = the "nD."

## 4. Core workflows

### Capture (fast, keyboard-first)
- **Tab** = new child, **Enter/Return** = new sibling (standard mind-map keys).
- _⟨open: what else is on the fast path — rename inline, retype/recolor without the
  mouse, quick-link to an existing node?⟩_

### Placement & arranging
- **Snap-to-grid OR free placement** (user's choice).
- **Re-parenting:** drag a node to become a child of another.
- **Auto-arrange / layout optimization:** tree-view-based sorting/optimization, plus
  "other characteristics" TBD (e.g. by type, by attribute, by cluster).

### Dual view: Map ⇄ List
- **Free-flow list / outline mode** alongside the map.
- **Drag from the list to a parent** to build/re-parent structure.
- Attribute + shape + color editing available in **both** views.

### Schema development (the nD payoff)
- Brainstorm node/edge types informally; **promote** the good ones to global types;
  watch an informal map harden into a **schema**.
- **Graduate to a Graph DB** once the schema settles (for scale). **Decision:
  backend-agnostic core** — an abstract internal graph with **export adapters for
  both Neo4j/Cypher and RDF/OWL.** Rationale: keeps optionality; lets category-error
  work lean on OWL later while Neo4j serves the user's existing fluency + scale.
  - **Design constraint this locks in:** model every **edge as a first-class
    object** (own id + type + attrs), never a bare link — the one shape that
    exports natively to Neo4j (relationship-with-properties) *and* reifies to
    RDF-star for OWL. (Already true of `GraphEdge` in `src/model.ts`.)
  - Category-error interrogation stays **tool-level lint**, backend-independent.

### Interrogation (distinctive, exploratory)
- Use the typed map to **sort and categorize abstraction layers**.
- **Category-error detection.** Mechanism (from user's example): every node has a
  **kind / abstraction-level** (subjective experience, biomarker, diagnostic
  construct, molecular entity, …); every edge has **honest semantics** (`is-a` vs
  `proxy-for` vs `measured-by` vs `correlates-with` vs `causes`). A **category
  error = the graph collapsing a level-crossing into an identity** — wiring a
  *proxy* as if it were the thing itself.
  - _Worked example:_ subjective, self-reported **pleasure** ≠ an increase in
    **dopamine** (a neurochemical measure); they're related as `proxy-for`, not
    identity. The **DSM** does this wholesale — diagnoses stand in as proxies for
    ranges of subjective symptoms. Making the level explicit and flagging the
    collapse enables far better individualized assessment/treatment.
  - This is lightweight ontology hygiene (class/instance discipline, edge
    domain/range), implemented as **tool-level "lint," not a backend reasoner.**

## 5. Differentiators & non-goals

**Differentiators**
- The **informal → formal ramp**: mind map that becomes a schema that becomes a
  graph DB. Nobody owns this middle.
- **Open typed edges with promotion** (case-by-case → global).
- **Abstraction-layer / category-error interrogation** as a first-class use.

**Non-goals** _⟨open — confirm⟩_
- Not a DAW-of-mind-maps / not trying to be a full graph-DB IDE.
- Not locked to one backend; the map is the source of truth, the DB is a target.

## 6. Follow-on / parallel efforts

- **Image → nDMindMap capture:** ingest a **hand-drawn or digital image** of a
  mind map, whiteboard, or list and convert it into an editable nDMindMap
  (multimodal/vision). Explicitly a parallel or follow-on track, not blocking the
  core.

## 7. Functional requirements & roadmap

Phased so each phase ships something usable and the lean core (per RiffRaft
philosophy) stays in the UI, not the engine. **What already exists in the
scaffold:** SVG render + layout, drag/select, add-node, connect-nodes (typed
relation), typed-node/typed-edge model with attributes, `.ndmm.md` round-trip.

### Phase 1 — The typed mind map you can capture into fast  ⟵ _build target_
> Goal: it *feels* like nDMindMap, not a generic mind-mapper. Keyboard-first
> capture + node/edge typing + attributes + visual channels, all round-tripping to
> file. This is the seed everything else grows from.

- **P1.1 Keyboard capture.** ✅ **DONE (2026-07-15, verified).** `Tab` = new child,
  `Enter` = new sibling (fluid outliner loop: type → Enter → type), inline rename
  (`F2` / double-click), `←→` = parent/child, `↑↓` = prev/next sibling,
  `Delete`/`Backspace` removes the subtree, `Esc` discards an empty new node.
- **P1.2 Hierarchical (mind-map) layout.** ✅ **DONE (2026-07-15, verified).**
  Left-to-right tidy tree over `child-of` (`layout.ts`), pill nodes with smooth
  connectors, non-`child-of` edges drawn as dashed cross-links (the nD overlay).
  Drag a node to **pin** it (free placement; **Grid** toggle snaps); **Tidy**
  re-runs the layout, clearing pins. _Deferred within P1.2:_ contour-packed sibling
  subtrees (current tidy layout is simple leaf-row centering).
- **P1.3 Node inspector.** ✅ **DONE (2026-07-15, verified).** Right-side panel
  (`inspector.ts`) editing label, **node type**, **shape/color/size** (visual
  channels), and free-form **attributes** (add / rename / remove key–values, with
  scalar coercion). Reserved keys hidden from the free-form list.
- **P1.4 Visual channels render.** ✅ **DONE (2026-07-15, verified).** Shapes
  (rounded / rect / pill / ellipse / diamond), fill color with auto-contrast
  label, size scale (S/M/L); node **type** shown as a small tag above the node.
  (`visuals.ts` is the shared vocabulary.)
- **P1.5 Edge typing UI.** ⟵ _next._ Inline picker to set/define an edge's relation
  type (default `child-of`), replacing the `prompt()`; edges render their type
  label. (Cross-links already render their type; this adds creating/retyping.)
- **P1.6 Persistence.** ✅ **DONE for node fields (2026-07-15, verified).** Type /
  shape / color / size ride as **reserved attribute keys** in `.ndmm.md` (no format
  change) and round-trip idempotently, e.g.
  `- [graph] Graph-shaped @260,136 {type: pillar, shape: diamond, color: #b98cff, size: l, confidence: 0.8}`.
  Edge-type persistence already works; re-confirm once P1.5 lands.

**Phase 1 acceptance:** open app → capture a ~10-node map with the keyboard alone
in under a minute → set a couple of node types, colors, and attributes via the
inspector → add one non-`child-of` typed edge → export, reload → everything
survives byte-faithfully.

### Phase 2 — The nD layer (dimensions, promotion, binding, dual view)
- **Type registries:** node types and edge types as first-class, definable,
  parameterized objects (not just free text).
- **Promotion:** convert a one-off case-by-case type → a global selectable type
  (symmetric for nodes and edges).
- **Visual-channel ↔ meaning binding (global attribution):** bind color/shape/size
  to an attribute or type globally (e.g. color = domain, size = confidence) with a
  **legend**; bindings optional/reversible; unbound = aesthetic.
- **Map ⇄ List dual view:** free-flow outline alongside the map; **drag-from-list-
  to-parent**; attribute/shape/color editing in both.
- **Dimension views:** show/hide/filter by edge type; "project" one chosen
  dimension onto the canvas.

### Phase 3 — Interrogation (the distinctive payoff)
- **Abstraction-level / kind** on nodes + an **edge-semantics vocabulary**
  (`is-a`, `proxy-for`, `measured-by`, `correlates-with`, `causes`, …).
- **Category-error lint** (tool-level): first rule = **proxy-as-identity /
  level-crossing collapse**; surface warnings inline. Then class-vs-instance.
- **Emergent schema view:** derive node-type × edge-type structure (with
  domain/range) from the sketch — the "it has become a schema" moment made visible.

### Phase 4 — Graduation (export & scale)
- **Backend-agnostic export layer** (edges already first-class objects).
- **Neo4j / Cypher exporter** (your fluency + scale) — first.
- **RDF/OWL exporter** (RDF-star reification of edge attrs) — second.
- **Post-export sync:** start **one-way graduation**; round-trip reconciliation
  later if needed.

### Phase 5 (parallel) — Image → nDMindMap capture
- Multimodal ingest of a **hand-drawn / photographed whiteboard / digital image /
  list** → editable nDMindMap. Independent track; does not block P1–P4.

## 8. Quality attributes

_[synthesis — confirm/rank]_ Likely: local-first (your data is a portable
markdown/graph file), sub-second capture, scales toward graph-DB territory,
lossless round-trip between map ⇄ list ⇄ file ⇄ exported DB.

## 9. Open questions / parking lot

**Resolved**
- ✅ Spine confirmed: the "missing middle" — brainstorm your way *into* a formal model.
- ✅ "Dimension" = facet/angle of characterization (attributes and/or typed edges;
  visual channels are projections). _[awaiting final "yes" but effectively settled]_
- ✅ Concrete node example: biomolecule across biophysical/architecture/function/
  interaction/phenotype dimensions.
- ✅ Category-error example: pleasure vs. dopamine; DSM diagnoses as proxies.
- ✅ Graph strategy: **backend-agnostic core**, Neo4j + RDF/OWL exporters; edges as
  first-class objects.

**Still open**
- §1: a specific "hit the wall" memory to anchor the gap (nice-to-have).
- §2: audience — confirmed as a KG meta-tool for your own work; also for general
  thinkers, or you-first?
- Node-type promotion — symmetric with edge-type promotion? (assumed yes)
- Post-export sync: if you keep sketching after graduating to a DB, how do map and
  DB stay reconciled? (round-trip vs. one-way graduation)
- Which category-error lint rules ship first (level-crossing, proxy-as-identity,
  class-vs-instance)?
