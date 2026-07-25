# TraceLayout

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceLayout` is the visible row and geometry layout derived from a filtered dataset-backed graph.

```ts
import {buildTraceLayout, buildTraceLayouts, type TraceLayout} from '@deck.gl-community/trace-layers/trace';
```

## What it contains

- visible process and thread rows
- span, same-process dependency, and cross-process dependency geometry chunks
- geometry caches for reuse
- current and fully expanded bounds
- collapse-aware row state
- optional collapsed activity summaries
- the visible graph/view snapshot the layout reflects

`TraceLayout` describes where normalized trace objects draw. `TraceRenderSnapshot` packages the
foreground scenes, overview scenes, path data, and per-graph derived render data consumed by deck
layers. Neither is an ingestion format.

## Builder APIs

- `buildTraceLayout(...)`: build one layout for one graph
- `buildTraceLayouts(...)`: build aligned layouts for one or more graphs
- `buildTraceLayoutForSpanRefs(...)`: focused relayout for selected span refs
- `rebuildTraceLayoutGeometry(...)`: refresh geometry without rebuilding structure

## Collapse state

`TraceLayoutCollapseState` aligns one `TraceGraphCollapseState` per displayed graph. Use process and
thread refs in mounted state, then serialize IDs only when crossing persistence boundaries with
`serializeTraceGraphCollapseState(...)` and `deserializeTraceGraphCollapseState(...)`.

## Invalidation

Rebuild layout when filtered topology, visible threads, aggregation mode, lane limits, process
layout mode, or density changes. Rebuild geometry when timing projection, min span time, or
same-process dependency geometry changes. Render-only color, fade, and animation changes should not
rebuild the layout.

See [Rendering traces](../../developer-guide/rendering-traces.md) and
[TraceVisSettings](./trace-vis-settings.md).
