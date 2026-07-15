# nDMindMap

A markdown-native, **graph-shaped** idea-capture engine — a [GrandsTech](https://grandstech.com/) product.

Most mind-map tools force your thinking into a tree. nDMindMap treats ideas as a
**graph**: nodes carry open-ended *dimensions* (the "nD"), and links are **typed
relationships**, so one idea can belong to many contexts, and you can traverse
and query by relation. The source of truth is a plain, diffable Markdown file —
your maps live in git, not a proprietary blob.

> Status: **early scaffold (v0.0.1).** The capture → graph → file → back loop
> runs end to end; everything else is open runway.

## Quick start

```bash
npm install
npm run dev      # opens http://localhost:5190
```

- **+ Node** — add an idea (links to the selected node if one is selected)
- **Connect** — select a source node, press Connect, then click a target
- **Export / Import** — round-trip the whole map through `.ndmm.md`
- Drag nodes to arrange; the force layout does the rest

```bash
npm run build      # type-check + production build to dist/
npm run typecheck  # types only
```

## The file format (`.ndmm.md`)

The format *is* the product. It's plain Markdown so a map reads sensibly
anywhere and versions cleanly:

```markdown
# nDMindMap: Welcome

## Nodes

- [root] nDMindMap {kind: root}
- [graph] Graph-shaped, not a tree {kind: pillar}

## Edges

- [root] --relates-to--> [graph]
```

- Nodes: `- [id] Label @x,y {key: value, ...}` — `@x,y` (layout) and `{...}`
  (dimensions) are optional.
- Edges: `- [src] --relation--> [dst] {key: value}` — the relation is a
  first-class, labeled type.

See [`examples/welcome.ndmm.md`](examples/welcome.ndmm.md).

## Architecture

| File | Role |
| --- | --- |
| `src/model.ts` | In-memory `Graph` — nodes, typed edges, `neighbors()` / `where()` query primitives |
| `src/serialize.ts` | Parse / stringify the human-readable `.ndmm.md` source of truth |
| `src/render.ts` | Dependency-free SVG renderer + small force layout, node drag & select |
| `src/main.ts` | App shell — toolbar, capture gestures, import/export |

Storage-agnostic by design: the graph model doesn't know about files, so a
future embedded/graph-DB backend can slot in behind the same interface.

## License

MIT © 2026 Daniel Adamek (GrandsTech)
