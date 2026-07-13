# TraceChunkData

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceChunkData` is the parser-local normalized chunk payload accepted by `TraceChunkStore`.

```ts
import {type TraceChunkData} from '@deck.gl-community/trace-layers/trace';
```

## Required fields

- `type: 'trace-chunk-data'`
- `chunkKey`
- `processes`
- `spanTable`
- `resolvedSameProcessDependencyTable`
- `diagnostics`
- `refState: 'parser-local'`

## Optional fields

- `spanSidecarTable`
- `spanSidecarRows`
- `sourceDependencyTable`
- `rowWindowTable`

## Lifecycle

`TraceChunkData` belongs to the ingestion boundary. Give it to `TraceChunkStore`, then let the
store finalize chunk refs, process/thread owner refs, source-id indexes, dependency indexes, and
retained payload ownership. Dataset assemblers consume ready finalized chunks later; `TraceChunkData`
itself is not the runtime graph.

Use stable `external_span_id` values and source dependency rows when hidden search, URL restore, or
cross-chunk parent navigation must work.

See [Incremental ingestion](../../developer-guide/incremental-ingestion.md) and
[TraceDataset](./trace-dataset.md) plus [TraceChunkStore](./trace-chunk-store.md).
