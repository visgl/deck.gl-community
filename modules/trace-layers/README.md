# @deck.gl-community/trace-layers

TypeScript and React package for building high-performance trace viewers from normalized trace
graphs.

Public entrypoints:

- `@deck.gl-community/trace-layers`: aggregate package export.
- `@deck.gl-community/trace-layers/trace`: Chrome trace parsing, normalized trace objects, Arrow-backed
  runtime graphs, layout, filtering, and color schemes.
- `@deck.gl-community/trace-layers/layers`: trace-specific deck.gl layers, controllers, and rendering
  helpers.
- `@deck.gl-community/trace-layers/react`: React viewer components such as `DeckTraceGraph`, `TraceSpanCard`, and
  inspector surfaces.

`DeckTraceGraph` remains the full React trace viewer. Custom deck.gl shells can render normalized
graphs directly with `TraceGraphLayer`, render `TraceChunkStore` windows with `TraceStoreLayer`, or
render already-prepared trace view state with `TracePreparedStateLayer`.

The package remains private while the final public API settles. Start with the
[Getting Started](../../docs/modules/trace-layers/developer-guide/getting-started.md) guide and the
[Rendering traces](../../docs/modules/trace-layers/developer-guide/rendering-traces.md) guide.
