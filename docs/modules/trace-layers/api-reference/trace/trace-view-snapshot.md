# TraceViewSnapshot

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceViewSnapshot` is the immutable visibility projection for one exact `TraceDataset`. It is
exported from `@deck.gl-community/trace-layers/trace`.

## Why it exists

Canonical Arrow tables stay filter-free. A snapshot stores only chunk-local typed masks for rows
that are hidden by the active text/source/topology filter plan:

```text
TraceDataset
  + TraceViewSnapshotOptions
  -> buildTraceViewSnapshot(...)
  -> TraceViewSnapshot
  -> new TraceGraph(runtimeSource, snapshot)
```

This keeps filtering cheap and explicit: changing filters builds a new snapshot, while changing
collapse state or view transforms does not.

## Construction

```ts
const traceViewSnapshot = buildTraceViewSnapshot(traceDataset, {
  spanFilters,
  overlappingParentSpanFilter,
  similarDurationChainSpanFilter
});

const traceGraph = new TraceGraph({traceDataset, traceStore}, traceViewSnapshot);
```

Always pass the snapshot built from the same dataset identity that the runtime source exposes.
`TraceGraph` has transitional convenience construction for an unfiltered view, but filtered
callers should build and pass the snapshot explicitly.

## Public fields

| Field                            | Meaning                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `dataset`                        | Canonical immutable dataset retained by identity.                            |
| `spanFilters`                    | Normalized literal-prefix and explicit-regex filters represented by the view. |
| `overlappingParentSpanFilter`    | Normalized overlapping-parent topology filter, or `null`.                    |
| `similarDurationChainSpanFilter` | Normalized similar-duration-chain topology filter, or `null`.                |
| `chunks`                         | Chunk projections sorted by stable chunk slot.                               |
| `filteredSpanCount`              | Total active canonical rows hidden by the view.                              |
| `filteredSpanCountsByFilter`     | Counts attributed to the first filter stage that removed each row.           |

Each `TraceViewChunkSnapshot` contains `chunkIndex`, `rowCount`, `filteredSpanCount`, and an
optional `filterMaskByRow`. A `null` mask means every active row in that chunk is visible.

## Helper functions

| API                                                  | Use                                         |
| ---------------------------------------------------- | ------------------------------------------- |
| `buildTraceViewSnapshot(dataset, options)`           | Build the cache-free visibility projection. |
| `hasTraceViewSnapshotFilters(snapshot)`              | Test whether any active row is hidden.      |
| `hasTraceViewSnapshotTopologyFilters(snapshot)`      | Test whether topology filters are configured. |
| `getTraceViewChunkFilterMask(snapshot, chunkIndex)`  | Borrow the combined chunk-local mask.       |
| `getTraceViewSpanFilterMask(snapshot, spanRef)`      | Read one span's combined filter provenance mask. |

## Rebuild rules

Build a new snapshot when:

- `TraceDataset` identity changes
- text/source filter semantics change
- overlapping-parent or similar-duration-chain filter settings change

Reuse the existing snapshot when only collapse state, selection, viewport, timing transform, or
deck interaction state changes.

Related pages: [Filtering traces](../../developer-guide/filtering-traces.md),
[TraceGraph](./trace-graph.md), and [TraceEngine](./trace-engine.md).
