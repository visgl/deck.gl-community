# Data Model

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

Trace layers separate source normalization, columnar storage, visibility, runtime lookup, layout,
and rendering. That split keeps Chrome Trace, Perfetto, custom rows, and live streams from leaking
format-specific rules into deck.gl layers.

## The shared pipeline

1. Parse a source format.
2. Normalize processes, threads, spans, dependencies, instants, counters, and events.
3. Cross the ingestion boundary through `JSONTrace` or parser-local `TraceChunkData`.
4. Finalize chunks into an immutable `TraceDataset`.
5. Build a `TraceViewSnapshot` for text/source visibility.
6. Construct a dataset-backed `TraceGraph` for refs, filtering, search, and visible lookup.
7. Build `TraceLayout` plus `TraceRenderSnapshot`.
8. Render with `DeckTraceGraph` or the low-level deck.gl helpers.

## The important nouns

- `TraceProcess` is the top-level visible row group. It may represent an OS process, rank, host, or another execution partition.
- `TraceThread` is a child stream inside a process. It may represent a thread, queue, CUDA stream, or logical lane.
- `TraceSpan` is the main duration-bearing timeline object.
- `TraceInstant` and `TraceCounter` are point and sampled timeline objects.
- `TraceSameProcessDependency` and `TraceCrossProcessDependency` connect spans.
- `TraceChunkData` is the parser-local chunk handoff.
- `TraceDataset` is the immutable Arrow-backed runtime storage snapshot.
- `TraceViewSnapshot` owns filtered visibility masks for one dataset.
- `TraceGraph` is the runtime query facade over one dataset/view pair.
- `TraceLayout` is visible row structure and bounds.
- `TraceRenderSnapshot` is the prepared render-facing scene/path data.

## IDs versus refs

Source IDs such as `TraceSpanId` survive ingestion and serialization. Runtime refs such as
`SpanRef`, `ProcessRef`, and `ThreadRef` identify exact loaded rows and are the preferred selection,
layout, and dependency keys while a graph is mounted.

Persist source IDs at URL or workspace boundaries. Resolve them back to refs before asking runtime
code for geometry, selection, or dependency traversal.

## Objects do not carry geometry

Normalized trace objects describe what happened. `TraceLayout` describes where those objects draw.
Do not attach span rectangles, dependency polylines, lane positions, or viewport bounds during
ingestion.

## Which ingestion contract to use

- Use `JSONTrace` for a JSON-safe normalized document or simple file/application builders.
- Use `TraceChunkData` when a source returns parser-local chunks that static or incremental runtime
  sources will finalize.
- Use `TraceDataset` as the immutable runtime storage snapshot consumed by `TraceGraph`.
- Use `TraceViewSnapshot` when one dataset needs a filtered visible view.

See [JSONTrace](../api-reference/trace/json-trace.md),
[TraceChunkData](../api-reference/trace/trace-chunk-data.md), and
[TraceDataset](../api-reference/trace/trace-dataset.md),
[TraceGraph](../api-reference/trace/trace-graph.md).
