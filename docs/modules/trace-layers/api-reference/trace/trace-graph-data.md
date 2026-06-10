# TraceGraphData

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceGraphData` is the Arrow-backed normalized graph snapshot used to construct runtime
`TraceGraph` instances efficiently.

```ts
import {buildTraceGraphData, type TraceGraphData} from '@deck.gl-community/trace-layers/trace';
```

## Shape

`TraceGraphData` contains graph metadata plus row-backed chunks. Each chunk carries:

- `chunkIndex` and `chunkRef`
- `chunkKey`
- represented process refs
- `spanTable`
- `localDependencyTable`
- optional span sidecars and other row-aligned tables

Span rows carry explicit `processRef` and `threadRef` owner columns. Resolve ownership through refs
rather than assuming one chunk belongs to one process.

## Use it for

- compact static graph construction
- Arrow transport and materialization
- published streaming snapshots
- visible window snapshots materialized from `TraceChunkStore`

## Main helpers

- `buildTraceGraphData(...)`
- `buildTraceGraphDataFromJSONTrace(...)`
- `buildArrowTraceSpanTableFromRows(...)`
- `buildArrowTraceLocalDependencyTable(...)`
- `serializeArrowTraceJson(...)`
- `deserializeArrowTraceJson(...)`

Use `JSONTrace` when you need a JSON-safe boundary. Use `TraceChunkData` when a store still needs to
finalize parser-local chunks before graph materialization.
