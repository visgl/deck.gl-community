# @deck.gl-community/trace-layers

TypeScript and React package for building high-performance trace viewers from normalized trace
graphs.

Public entrypoints:

- `@deck.gl-community/trace-layers`: aggregate package export.
- `@deck.gl-community/trace-layers/trace`: Chrome trace parsing, normalized trace objects,
  Arrow-backed runtime graphs, `TraceEngine`, layout, filtering, and color schemes.
- `@deck.gl-community/trace-layers/layers`: trace-specific deck.gl layers, controllers, and rendering
  helpers.
- `@deck.gl-community/trace-layers/react`: React viewer components such as `DeckTraceGraph`, `TraceSpanCard`, and
  inspector surfaces.

`TraceDataset` owns immutable columnar runtime storage. `TraceViewSnapshot` owns filtered
visibility. `TraceGraph` is the dataset-backed query facade. `TraceEngine` owns mounted trace-view
interaction, collapse, layout, `TraceRenderSnapshot`, and diagnostics state below React.
`DeckTraceGraph` renders one mounted engine as the full React trace viewer. Custom deck.gl shells
can render dataset-backed graphs directly with `TraceGraphLayer`, render `TraceChunkStoreWindow`
sources with `TraceStoreLayer`, or render already-prepared trace view state with
`TracePreparedStateLayer`.

Start with the
[Getting Started](../../docs/modules/trace-layers/developer-guide/getting-started.md) guide and the
[Rendering traces](../../docs/modules/trace-layers/developer-guide/rendering-traces.md) guide.
Maintainers changing the portable source layout should also read
[PORTABLE_SOURCE_LAYOUT.md](./PORTABLE_SOURCE_LAYOUT.md).
