# TraceStreamSession

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceStreamSession` is the mutable ingestion session for live or replayed trace updates. It
publishes immutable graph snapshots that renderers can consume safely.

```ts
import {createTraceStreamSession, type TraceStreamChunk} from '@deck.gl-community/trace-layers/trace';
```

## Input contract

`TraceStreamChunk` describes normalized streaming operations such as:

- process upserts
- thread upserts
- span updates
- local dependency updates
- instant updates
- counter updates
- replacement snapshots

Custom sources should emit these chunks instead of mutating React state or deck objects directly.

## Output contract

Published snapshots contain immutable `TraceGraphData` and `TraceGraph` values. Render only those
published snapshots; keep the session's mutable ingestion state upstream.

## Built-in producers

- `streamChromeTraceEventChunks(...)`
- `streamChromeTraceFileChunks(...)`
- `streamChromeTraceArrowChunks(...)`
- `consumeChromeTraceEventStream(...)`
- `consumeChromeTraceFileStream(...)`
- `consumeChromeTraceArrowStream(...)`

## Invariants

The default session keeps process order first-seen stable, row order append-only stable, and upserts
non-reordering. Deletes and rolling eviction are outside the default contract.

See [Loading traces](../../developer-guide/loading-traces.md) and
[Working with Chrome Trace](../../developer-guide/chrome-trace.md).
