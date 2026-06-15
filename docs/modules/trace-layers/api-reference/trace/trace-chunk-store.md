# TraceChunkStore

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceChunkStore` retains normalized trace chunks for time-sliced or otherwise incremental loading.

```ts
import {TraceChunkStore} from '@deck.gl-community/trace-layers/trace';
```

## Responsibilities

`TraceChunkStore` owns:

- the descriptor catalog for one trace identity
- ready and in-flight chunk payload retention
- request deduplication and retry-safe loading
- selection policies for retained versus visible chunks
- registered `TraceWindow` subscriptions
- source-owned window graph-data materialization
- search and navigation across ready loaded rows

It does not parse source formats. Loaders and ingesters must convert raw payloads into
`TraceChunkData` before the store consumes them.

## Main operations

- `add(...)`: finalize one parser-local chunk immediately
- `ensure(...)`: load selected descriptors
- `registerTraceWindows(...)`: retain and update one or more active windows
- `select(...)`: choose the visible descriptor subset for one window and span budget
- `materializeTraceGraphDataForWindow(...)`: ask the caller-owned materializer to build immutable graph data from ready selected chunks
- `getDiagnostics(...)`: read cheap retained-state counters

## Related helpers

- `createChronologicalTraceChunkSpanBudgetPolicy(...)`
- `createStaticTraceChunkStore(...)`
- `traceWindowToTraceChunkSelectionWindow(...)`
- `createStaticTraceGraphRuntimeSource(...)`

Use `TraceChunkStore` when the active visible graph is smaller than the already-known or
already-retained source dataset. See [Loading traces](../../developer-guide/loading-traces.md).
