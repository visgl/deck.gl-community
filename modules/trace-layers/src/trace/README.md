# trace

`trace` owns the normalized trace model, chunk ingestion boundary, immutable dataset runtime,
filtering, search, layout, and mounted engine contracts used by trace-layers.

## Trace Data Format

"Processes" and "Threads" are the basic hierarchical model. Same-process dependencies connect
spans inside one process; cross-process dependencies connect spans across processes.

Examples:

- On a single CPU, processes and threads are often just that.
- In a distributed system, `process` is often a CPU or GPU, a `thread` is a stream of
  operations of some type, and a `cross-process dependency` is an RPC between CPUs/GPUs.
- In a distributed compute workload, processes might represent ranks and threads might represent
  streams of operations on a GPU or its associated control CPU.

## Arrow Storage

Span tables contain fixed canonical columns plus optional declared attribute columns. Ingestion
passes tuple paths from `collectTraceColorSchemeAttributePaths(...)` into
`buildArrowTraceSpanTableFromColumns(...)`; only primitive leaves and homogeneous primitive arrays
with at most eight items are projected. Nested paths become Arrow structs, and undeclared nested
user data is not retained in attribute columns.

`TraceGraph.getSpanAttribute(spanRef, path)` reads those declared columns directly and returns
`undefined` when a path is absent from the loaded schema. Full `userDataJson` remains in the Arrow
sidecar table only for cards, exports, detail views, and debugging. Chunk and graph transport use
`spanSidecarTable` / `spanSidecarTableMap`; JS `spanSidecarRows` and `spanSidecarMap` are not runtime
fallbacks.

Dependency rendering and layout consume canonical scalar getters or prepared render projections.
Ref-native same-process dependency tables may omit compatibility `dependencyId`, `startSpanId`, and
`endSpanId` string columns when they store `dependencyRef`, `startSpanRef`, and `endSpanRef`.
TraceGraph derives those strings lazily for compatibility callers; omitted same-process dependency ids
materialize as `same-process-dependency-ref(<SameProcessDependencyRef>)`. Legacy/object-built tables may
continue storing the string columns.

`TraceDataset.sameProcessDependencyTableMap` and `TraceDataset.crossProcessDependencyTable`
are the canonical dependency rows. Runtime `TraceGraph` borrows them by identity. Directional
selection and traversal scan those columns on demand instead of retaining a second per-span
adjacency table; span sidecars carry detail payloads, not authoritative dependency refs.

`TraceGraph.getDependencySource(ref)` returns lightweight runtime sources. Cross-process dependency
sources stay render-native; callers that need endpoint ids, topology, keywords, or user data must
materialize explicitly from the canonical Arrow table with
`materializeTraceCrossProcessDependencyFromArrowRow(...)` at a card or export boundary.

## Dataset Runtime

The runtime flow is:

```text
TraceChunkData -> TraceChunk -> TraceDataset -> TraceViewSnapshot -> TraceGraph
```

`TraceDataset` owns canonical Arrow chunks, dependency tables, refs, events, time extents, and
stats. `TraceViewSnapshot` owns filtered visibility masks. `TraceGraph` borrows both by identity
and exposes query, filtering, search, card, dependency, and layout accessors.

## Chunked Traces

`TraceChunkStore` keeps descriptor metadata separate from loaded payloads so callers can retain a
large catalog while loading only one active time window. `loadWindow(...)` replaces the prior
window, cancels obsolete queued work, and reports ready chunk and advertised-span counts directly
as payloads finish loading; progress surfaces should use that callback instead of scanning loaded
chunks.

Active-window `onChunksArrived` notifications are throttled readiness batches intended for
incremental graph or table updates. They carry newly ready chunk keys and aggregate window state,
but are not the primary progress-counter path.

## License

`trace` is licensed under the repository MIT license.
