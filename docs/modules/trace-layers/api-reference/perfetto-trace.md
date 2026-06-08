# Perfetto Arrow Parser

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`parsePerfettoTraceToArrow(...)` decodes Perfetto protobuf traces into Arrow row streams for tracks,
slices, processes, and threads.

```ts
import {parsePerfettoTraceToArrow} from '@deck.gl-community/trace-layers/trace';
```

## Exported contracts

- `parsePerfettoTraceToArrow(...)`
- `TracksSchema`
- `SlicesSchema`
- `ProcessesSchema`
- `ThreadsSchema`
- `ArrowTraceConsumer`
- `TrackRow`
- `SliceRow`
- `ProcessRow`
- `ThreadRow`

## Use it for

- ingesting Perfetto protobuf traces into an Arrow-oriented normalization path
- inspecting Perfetto track, slice, process, and thread rows before building shared trace objects

The parser output is still source-shaped. Normalize it into `JSONTrace`, `TraceGraphData`, or
`TraceChunkData` before rendering.

See [Data model](../developer-guide/data-model.md) and
[Loading traces](../developer-guide/loading-traces.md).
