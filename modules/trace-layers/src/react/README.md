# react

`react` is the React/UI layer of `@deck.gl-community/trace-layers`. It renders mounted `TraceEngine` instances
through the shared deck.gl trace layers and exposes reusable inspection surfaces for host
applications.

The package deliberately stops at the viewer boundary. Host applications own file pickers, stores,
backend clients, URL persistence, and domain-specific cards or actions.

## Supported Inputs

Tracevis renders the normalized trace model from `@deck.gl-community/trace-layers/trace`. The package
includes Chrome trace parsing and Perfetto helpers, and custom loaders can target the same
parser-local `TraceChunkData` or `JSONTrace` normalization contracts before publishing an
immutable `TraceDataset`.

## Streaming

The shared trace runtime accepts static or incremental chunk sources. The same `DeckTraceGraph`
surface renders either form once the host publishes immutable dataset-backed graph snapshots into
`TraceEngine`.

See [Getting Started](../../../../docs/modules/trace-layers/developer-guide/getting-started.md),
[Loading traces](../../../../docs/modules/trace-layers/developer-guide/loading-traces.md), and
[DeckTraceGraph](../../../../docs/modules/trace-layers/api-reference/react/deck-trace-graph.md).
