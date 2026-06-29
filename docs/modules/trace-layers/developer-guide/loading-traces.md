# Loading Traces

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

The renderer should receive a normal `TraceGraph` regardless of how data arrived. Keep source
retrieval and source-specific normalization upstream of layout and rendering.

## Choose a loading shape

| Shape | Use it when | Shared contract |
| --- | --- | --- |
| Static | One file or response is reasonable to load at once | Build `JSONTrace` or `TraceGraphData`, then create a static runtime source |
| Process-sliced | Retrieval is naturally partitioned by rank, host, worker, or service | Normalize each process slice, then compose the loaded subset |
| Time-sliced | The full trace is too large and users investigate bounded windows | Retain normalized `TraceChunkData` in `TraceChunkStore` |
| Streaming | Data is live or replayed incrementally | Apply `TraceStreamChunk`s and render published snapshots |

## Static files

Static ingestion is the default for Chrome Trace JSON and many custom files:

1. parse raw data
2. normalize to `JSONTrace`
3. materialize normalized chunks
4. construct a `TraceGraph`
5. render it

This is the path shown in [Getting started](./getting-started.md).

## Process-sliced data

Process slicing works when the source already has stable per-process or per-rank payloads. Preserve
stable process and thread IDs, normalize each slice, stitch the cross-process dependencies that are
currently resolvable, then build one graph for the loaded subset.

The tradeoff is dependency completeness: cross-process edges may remain unresolved until both
endpoints are loaded.

## Time-sliced data

Time slicing works when storage advertises bounded time windows or chunk catalogs. Normalize each
response into `TraceChunkData`, let `TraceChunkStore` retain ready and in-flight chunks, then
materialize the active `TraceWindow` into a graph snapshot.

This keeps raw source paging out of the renderer while still allowing search and navigation across
already-loaded hidden rows.

## Streaming data

Streaming sources should target `TraceStreamChunk`, not React state or hand-built deck objects.
`TraceStreamSession` owns mutable ingestion state and publishes immutable snapshots on the cadence
you choose.

Built-in Chrome Trace stream helpers can consume event arrays or file/text chunks and publish
replacement snapshots through the same session contract custom sources use.

## Boundary rule

Keep these layers separate:

1. source retrieval
2. source-specific parsing or normalization
3. shared graph construction or streaming publication
4. layout and rendering

If a layer or React card needs to understand chunk catalogs, query paging, or socket frames, the
loading boundary has leaked too far downstream.
