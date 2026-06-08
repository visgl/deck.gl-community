# Data Model

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

Trace layers separate source normalization from runtime lookup and rendering. That split keeps
Chrome Trace, Perfetto, custom warehouse rows, and live streams from leaking format-specific rules
into deck.gl layers.

## The shared pipeline

1. Parse a source format.
2. Normalize processes, threads, spans, dependencies, instants, counters, and events.
3. Cross the ingestion boundary through `JSONTrace`, `TraceGraphData`, or `TraceChunkData`.
4. Construct a `TraceGraph` for ref lookup, filtering, search, and visible graph projection.
5. Build a `TraceLayout` for rows, geometry, and bounds.
6. Render with `DeckTraceGraph` or the low-level deck.gl helpers.

## The important nouns

- `TraceProcess` is the top-level visible row group. It may represent an OS process, rank, host, or another execution partition.
- `TraceThread` is a child stream inside a process. It may represent a thread, queue, CUDA stream, or logical lane.
- `TraceSpan` is the main duration-bearing timeline object.
- `TraceInstant` and `TraceCounter` are point and sampled timeline objects.
- `TraceLocalDependency` and `TraceCrossProcessDependency` connect spans.
- `TraceGraph` is the runtime wrapper around loaded Arrow-backed tables.
- `TraceLayout` is render-ready row structure, geometry, and bounds.

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
- Use `TraceGraphData` when you already have Arrow-backed tables and want the compact runtime form.
- Use `TraceChunkData` when a source returns bounded chunks that a `TraceChunkStore` will retain and
  materialize into visible windows.

See [JSONTrace](../api-reference/json-trace.md), [TraceGraphData](../api-reference/trace-graph-data.md),
[TraceChunkData](../api-reference/trace-chunk-data.md), and [TraceGraph](../api-reference/trace-graph.md).
