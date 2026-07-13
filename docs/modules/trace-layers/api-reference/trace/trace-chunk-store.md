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
- one active `TraceChunkStoreWindow` load
- caller-owned dataset materialization through ready selected chunks
- search and navigation across ready loaded rows

It does not parse source formats. Loaders and ingesters must convert raw payloads into
`TraceChunkData` before the store consumes them.

## Main operations

- `add(...)`: finalize one parser-local chunk immediately
- `ensure(...)`: load selected descriptors
- `loadWindow(...)`: replace the active `TraceChunkStoreWindow` and load matching descriptors
- `clearActiveWindow(...)`: release the active window and cancel obsolete pending work
- `select(...)`: choose the visible descriptor subset for one window and span budget
- `withReadyChunks(...)`: call a caller-owned materializer with ready selected chunks
- `getDiagnostics(...)`: read cheap retained-state counters

## Related helpers

- `createChronologicalTraceChunkSpanBudgetPolicy(...)`
- `createStaticTraceChunkStore(...)`
- `traceWindowToTraceChunkSelectionWindow(...)`
- `createStaticTraceGraphRuntimeSource(...)`

Use `TraceChunkStore` when the active visible dataset is smaller than the already-known or
already-retained source dataset. Pair `withReadyChunks(...)` with
`buildTraceChunkWindowDataset(...)` or another caller-owned `TraceDataset` materializer. See
[Loading traces](../../developer-guide/loading-traces.md).
