# Trace Objects

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

The normalized object family describes what happened in a trace. These objects do not carry render
geometry.

```ts
import type {
  TraceCounter,
  TraceCrossProcessDependency,
  TraceInstant,
  TraceLocalDependency,
  TraceObject,
  TracePath,
  TraceProcess,
  TraceSpan,
  TraceThread
} from '@deck.gl-community/trace-layers/trace';
```

## Major types

| Type | Meaning |
| --- | --- |
| `TraceProcess` | Top-level visible row group such as a process, rank, host, or execution partition |
| `TraceThread` | Child stream such as a thread, queue, CUDA stream, or logical lane |
| `TraceSpan` | Duration-bearing timeline object with one or more timing projections |
| `TraceInstant` | Point-in-time event |
| `TraceCounter` | Sampled value over time |
| `TraceLocalDependency` | Dependency between spans in one process |
| `TraceCrossProcessDependency` | Dependency between spans in different processes |
| `TraceCrossProcessEndpoint` | Stitchable endpoint used before a cross-process dependency is complete |
| `TracePath` | Selected or computed path through spans and visible dependencies |
| `TraceObject` | Union used by selection, tooltip, and generic trace UI surfaces |

## Timing projections

`TraceSpan.timings` lets one logical span carry multiple timing projections. `primaryTimingKey` or a
higher-level timing selection decides which projection layout uses.

## userData

Use optional `userData` for source-specific metadata that must survive normalization without
polluting the shared top-level schema.

See [Data model](../developer-guide/data-model.md) and [Trace IDs and refs](./trace-ids.md).
