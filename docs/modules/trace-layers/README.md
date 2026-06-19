# @deck.gl-community/trace-layers

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`@deck.gl-community/trace-layers` turns normalized trace data into interactive deck.gl timelines.
The package has four public entrypoints:

| Entry point | Use it for |
| --- | --- |
| `@deck.gl-community/trace-layers/trace` | Normalized trace data, loading, runtime refs, filtering, layout, and style contracts |
| `@deck.gl-community/trace-layers/layers` | Low-level trace graph/store/prepared-state layers, controllers, view layout, and measurement layer |
| `@deck.gl-community/trace-layers/react` | React viewer components such as `DeckTraceGraph` |
| `@deck.gl-community/trace-layers/loaders` | Low-level request and Arrow transport helpers |

Start with the [developer guide](./developer-guide/README.md) when you need to build or debug an
integration. Use the [API reference](./api-reference/README.md) when you already know the exported
class or type you need.

## Typical flow

1. Parse or build normalized trace data.
2. Construct a `TraceGraph`.
3. Render with `TraceGraphLayer` or `TraceStoreLayer`, or let `DeckTraceGraph` build the full viewer for you.
4. Keep selection, collapse state, settings, and persistence in the host application.

`DeckTraceGraph` remains the full React viewer. Custom deck.gl shells use `TraceGraphLayer` for
normalized graphs, `TraceStoreLayer` for `TraceChunkStore` windows, or `TracePreparedStateLayer`
for caller-prepared `TraceViewState`.

The full viewer example lives at
[`examples/trace-layers/tracevis`](https://github.com/visgl/deck.gl-community/tree/master/examples/trace-layers/tracevis).
The layers-only example lives at
[`examples/trace-layers/trace-graph-layer`](https://github.com/visgl/deck.gl-community/tree/master/examples/trace-layers/trace-graph-layer).
