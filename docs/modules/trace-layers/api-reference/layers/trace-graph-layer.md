# TraceGraphLayer

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceGraphLayer` prepares one or more normalized `TraceGraph` instances into `TraceViewState`,
reuses prior prepared state across layer updates, and delegates main-timeline rendering to
`TracePreparedStateLayer`.

```ts
import {TraceGraphLayer, type TraceGraphLayerProps} from '@deck.gl-community/trace-layers/layers';
```

## Required props

- `traceGraphs: readonly TraceGraph[]`
- `settings: TraceVisSettings`

Common caller-owned render inputs include `collapseState`, `selection`, `paths`, `colorScheme`,
`threadLaneLayoutOverrides`, selected span and dependency refs, comparison model matrices, and path
highlighting. Empty `traceGraphs` render no sublayer.

```tsx
<DeckGL
  views={views}
  layers={[
    new TraceGraphLayer({
      id: 'trace',
      traceGraphs,
      settings,
      collapseState,
      selection
    })
  ]}
/>;
```

`TraceGraphLayer` owns trace preparation only. The surrounding deck shell still owns views, legend,
grid, overview, run-event strip, time measurement, widgets, tooltip UI, and controlled interaction
state. Use `TraceStoreLayer` when trace graphs come from registered `TraceChunkStore` windows. Use
`DeckTraceGraph` for the full React viewer.

See [Rendering traces](../../developer-guide/rendering-traces.md).
