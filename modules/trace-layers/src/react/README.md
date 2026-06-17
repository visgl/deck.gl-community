# react

`react` is the React/UI layer of `@deck.gl-community/trace-layers`. It renders mounted
`TraceEngine` instances through the shared deck.gl trace layers and exposes reusable inspection
surfaces for host applications.

The package deliberately stops at the viewer boundary. Host applications own file pickers, stores,
SQL integration, backend clients, URL persistence, and domain-specific cards or actions.

## Supported Inputs

Tracevis renders the normalized trace model from `@deck.gl-community/trace-layers/trace`. The
package includes Chrome trace parsing and Perfetto helpers, and custom loaders can target the same
`TraceGraphData` or `JSONTrace` normalization contracts.

## Streaming

The shared trace runtime accepts static or incremental chunk sources. The same `DeckTraceGraph`
surface renders either form once the host publishes immutable graph snapshots into `TraceEngine`.

See [Getting Started](../../../../docs/modules/trace-layers/react/getting-started.md),
[Example Application](../../../../docs/modules/trace-layers/react/example-application.md), and
[Trace loading](../../../../docs/modules/trace-layers/trace/developer-guide/trace-loading.md).
