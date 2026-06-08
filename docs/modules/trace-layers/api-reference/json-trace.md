# JSONTrace

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`JSONTrace` is the JSON-safe normalized trace document used at ingestion and export boundaries.

```ts
import {buildJSONTrace, materializeJSONTrace} from '@deck.gl-community/trace-layers/trace';
```

## Shape

`JSONTrace` contains:

- `processes`
- `crossDependencies`
- optional graph-global `events`
- optional `timeExtents`
- optional `spanLayout`, usually `'auto'` or `'manual'`

`JSONTraceProcess` owns process-local threads, spans, local dependencies, instants, and counters.
`JSONTrace` adds graph-wide dependencies and events.

## Use it for

- normalized JSON files
- simple application builders
- import/export boundaries
- source-specific loaders before Arrow-backed runtime materialization

Do not use it as a render cache. Geometry belongs in `TraceLayout`, and runtime lookup/filter state
belongs in `TraceGraph`.

## Main helpers

- `buildJSONTrace(...)`
- `materializeJSONTrace(...)`
- `mergeJSONTraces(...)`
- `getJSONTraceTimingBounds(...)`
- `buildTraceChunkDataFromJSONTrace(...)`
- `buildTraceGraphDataFromJSONTrace(...)`

## Manual span layout

When `spanLayout` is `'manual'`, spans may provide thread-relative `layoutTopY` and `layoutHeight`.
Both values must be finite, `layoutTopY >= 0`, and `layoutHeight > 0` for the span to render in
manual mode.

See [Data model](../developer-guide/data-model.md), [TraceGraphData](./trace-graph-data.md), and
[TraceLayout](./trace-layout.md).
