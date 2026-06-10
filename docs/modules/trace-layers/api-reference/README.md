# API Reference

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

These pages document the major public contracts exported by `@deck.gl-community/trace-layers`.
Small helper functions are described on the page for the class or type they support.

The folders mirror the package entrypoints used in import paths.

## React

- [DeckTraceGraph](./react/deck-trace-graph.md)

## Layers

- [TracePreparedStateLayer](./layers/trace-prepared-state-layer.md)
- [TraceGraphLayer](./layers/trace-graph-layer.md)
- [TraceStoreLayer](./layers/trace-store-layer.md)
- [DeckTraceGraphController](./layers/deck-trace-graph-controller.md)
- [ImperativeDeckController](./layers/imperative-deck-controller.md)
- [TimeMeasureLayer](./layers/time-measure-layer.md)

## Trace

### Data, runtime, and layout

- [JSONTrace](./trace/json-trace.md)
- [TraceGraphData](./trace/trace-graph-data.md)
- [TraceChunkData](./trace/trace-chunk-data.md)
- [TraceChunkStore](./trace/trace-chunk-store.md)
- [TraceStreamSession](./trace/trace-stream-session.md)
- [TraceGraph](./trace/trace-graph.md)
- [TraceLayout](./trace/trace-layout.md)

### Shared types

- [TraceVisSettings](./trace/trace-vis-settings.md)
- [Trace objects](./trace/trace-objects.md)
- [Trace IDs and refs](./trace/trace-ids.md)
- [Trace style and color schemes](./trace/trace-style.md)

### Source formats

- [ChromeTrace](./trace/chrome-trace.md)
- [Perfetto Arrow parser](./trace/perfetto-trace.md)
