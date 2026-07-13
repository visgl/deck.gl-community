# TraceDataset

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceDataset` is the immutable Arrow-backed storage snapshot consumed by the trace runtime.
Source adapters emit parser-local `TraceChunkData`; `TraceChunkStore` finalizes those payloads
into canonical chunks; dataset assemblers publish one `TraceDataset`; and `TraceGraph` borrows
that dataset for query, filtering, layout, and rendering.

```ts
import {
  buildTraceDatasetFromReadyTraceChunks,
  buildTraceViewSnapshot,
  TraceGraph,
  type TraceDataset
} from '@deck.gl-community/trace-layers/trace';
```

## Flow

```text
source records
  -> TraceChunkData
  -> finalized TraceChunk
  -> TraceDataset
  -> TraceViewSnapshot
  -> TraceGraph
  -> TraceLayout / TraceRenderSnapshot
```

`TraceDataset` is the row-heavy owner in that flow. It keeps canonical Arrow tables and stable
numeric refs without duplicating a second per-span object graph.

## Main fields

- `revision`, `name`, optional `spanLayout`
- `processes`
- finalized `chunks`
- optional sparse active `spanRefs` for selected/window datasets
- `sameProcessDependencyTableMap`
- optional `spanSidecarTableMap`
- `crossProcessDependencyTable`
- graph-global `events`
- optional unresolved `crossProcessEndpointsBySpanRef`
- `timeExtents`, `stats`, `ownerRefSnapshot`, and `processSpanTableMap`

Dense datasets omit `spanRefs`: every row in every retained chunk is active. Window datasets may
reuse canonical chunks by identity while exposing only active refs selected for the visible window.

## Construction

- Static data: use `createStaticTraceGraphRuntimeSource(...)`, then read
  `runtimeSource.traceDataset`.
- Selected ready chunks: use `buildTraceDatasetFromReadyTraceChunks(...)`.
- Time-window chunks: use `buildTraceChunkWindowDataset(...)`.
- Append-only selected ready chunk growth: use `appendTraceDatasetFromReadyTraceChunks(...)`.

Build one `TraceViewSnapshot` from the dataset, then construct `TraceGraph` with the same dataset
and snapshot. Filtering changes the view snapshot, not the canonical dataset tables.

See [TraceChunkData](./trace-chunk-data.md), [TraceChunkStore](./trace-chunk-store.md),
[TraceViewSnapshot](./trace-view-snapshot.md), [TraceGraph](./trace-graph.md), and
[Data model](../../developer-guide/data-model.md).
