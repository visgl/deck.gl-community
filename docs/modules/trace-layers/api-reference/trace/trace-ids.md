# Trace IDs And Refs

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

Trace layers use branded source IDs and packed runtime refs to keep identifier domains distinct.

```ts
import {
  brand,
  encodeSpanRef,
  getSpanRefChunkIndex,
  getSpanRefRowIndex,
  type ProcessRef,
  type SpanRef,
  type ThreadRef,
  type TraceSpanId
} from '@deck.gl-community/trace-layers/trace';
```

## Source IDs

Branded source IDs include `TraceProcessId`, `TraceThreadId`, `TraceSpanId`, `TraceInstantId`,
`TraceCounterId`, `TraceDependencyId`, and `TraceCrossProcessEndpointId`. Use them while normalizing
and serializing source-shaped data.

## Runtime refs

Runtime refs include:

- owner refs: `ProcessRef`, `ThreadRef`
- storage refs: `ChunkRef`
- row refs: `SpanRef`, `EventRef`, `InstantRef`, `CounterRef`
- dependency refs: local, cross-process, and visible dependency refs

Use runtime refs for mounted selection, dependency traversal, filtering, layout, and geometry.

## SpanRef

`SpanRef` identifies one exact chunk-local span row. Use `encodeSpanRef(...)`,
`getSpanRefChunkIndex(...)`, and `getSpanRefRowIndex(...)` for packed storage addressing, then use
`TraceGraph` accessors to resolve semantic process and thread ownership.

## Rule of thumb

Persist source IDs. Compute and use refs while data is loaded.

See [Data model](../../developer-guide/data-model.md) and [TraceGraph](./trace-graph.md).
