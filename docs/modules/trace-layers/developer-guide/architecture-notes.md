# Architecture Notes

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

The July alignment moves trace-layers to one columnar runtime owner. The intended direction is:

```text
source adapters
  -> TraceChunkData
  -> TraceDataset
  -> TraceViewSnapshot
  -> TraceGraph
  -> TraceLayout
  -> TraceRenderSnapshot
  -> deck layers
```

The practical rules are:

- keep source-specific parsing before `TraceChunkData`
- keep row-heavy runtime state in immutable Arrow-backed `TraceDataset` snapshots
- keep live filtering in `TraceViewSnapshot`, not copied dataset tables
- use `TraceGraph` as the query facade over one dataset/view pair
- keep mounted selection, collapse, layout, and render snapshots inside `TraceEngine`
- let deck layers render prepared `TraceRenderSnapshot` data instead of rebuilding graph objects

`TraceChunkStore` is mutable retained-chunk infrastructure. It owns descriptors, ready payloads,
in-flight loads, and one active `TraceChunkStoreWindow`. Host state should publish immutable
datasets, graphs, summaries, and scalar revisions rather than serializing the store.

The OSS wrapper layers stay public:

- `TracePreparedStateLayer` renders caller-owned `TraceViewState.renderSnapshot`
- `TraceGraphLayer` builds current `TraceViewState` from dataset-backed `TraceGraph` inputs
- `TraceStoreLayer` loads a `TraceChunkStoreWindow`, materializes a `TraceDataset` with
  `withReadyChunks(...)`, wraps it in `TraceGraph`, and delegates to `TraceGraphLayer`

Prefer numeric refs such as `SpanRef`, `ProcessRef`, `ThreadRef`,
`SameProcessDependencyRef`, and `CrossProcessDependencyRef` inside mounted runtime code. Persist
source IDs only at URL, file, workspace, or backend boundaries.
