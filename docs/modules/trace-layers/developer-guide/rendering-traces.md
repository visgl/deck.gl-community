# Rendering Traces

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

Most applications should render through `TraceEngine` plus `DeckTraceGraph`. `TraceEngine` owns
mounted interaction, collapse, prepared layout, and prepared scene state below React.
`DeckTraceGraph` remains the full React viewer with the shared deck shell, legend, grid, overview,
time measurement, widgets, and interaction wiring. Use the low-level deck.gl exports only when you
are composing a custom deck shell.

## Render pipeline

1. Load or build normalized `TraceGraphData` or `TraceChunkData`.
2. Wrap graph data and its owning store in `TraceGraph`.
3. Sync durable host inputs into `TraceEngine`.
4. Let the engine build ref-native layouts and prepared scenes.
5. Render those prepared scenes through `DeckTraceGraph` or low-level deck layers.
6. Persist durable refs/process ids from engine updates when interactions change them.

The division of responsibility is:

- `TraceGraph`: normalized runtime data, refs, filtering, search, dependency lookup
- `TraceEngine`: mounted selection, collapse, layout, prepared scene, and diagnostics state
- `TraceLayout`: visible rows, geometry, collapse-aware bounds
- `TracePreparedStateLayer`: main-timeline sublayers from already-prepared `TraceViewState`
- `TraceGraphLayer`: graph-to-`TraceViewState` preparation plus main-timeline sublayers
- `TraceStoreLayer`: store-window registration, source-owned graph-data materialization, and graph rendering
- `DeckTraceGraph`: React composition and interaction surface

## What the viewer renders

The timeline can render span blocks, labels, local and cross-process dependencies, process and
thread rows, instants, counters, graph-level events, a time axis, a time-measure overlay, and an
overview minimap.

`TraceVisSettings` decides which of those are visible and which changes require structure, geometry,
or render-only work.

## Interaction boundary

Keep mounted viewer state ref-native inside `TraceEngine`:

- selected span refs and selected visible dependency refs
- serialized expanded process ids
- highlighted span refs, path refs, and extended selection refs
- settings, color scheme, tooltip renderers, and picked-object adapters

Serialize stable source IDs only when crossing an app boundary such as a URL, saved workspace, or
backend query.

## Low-level deck.gl exports

Custom deck shells can use:

- `TracePreparedStateLayer` when the shell already owns `TraceViewState`
- `TraceGraphLayer` when the shell owns normalized `TraceGraph` instances and render state
- `TraceStoreLayer` when the shell owns `TraceChunkStore` window sources plus a graph-data materializer
- `buildTracevisViewLayout(...)`
- `DeckTraceGraphController`
- `ImperativeDeckController`
- `TimeMeasureLayer`

`TracePreparedStateLayer`, `TraceGraphLayer`, and `TraceStoreLayer` render only the main trace
content: row backgrounds and separators, spans, dependencies, selection overlays, instants,
counters, and critical paths. A custom shell still owns views, legend, grid, overview, run-event
strip, time measurement, widgets, tooltip UI, and controlled interaction state.

```tsx
import {DeckGL} from '@deck.gl/react';
import {TraceGraphLayer} from '@deck.gl-community/trace-layers/layers';

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

Read [DeckTraceGraph](../api-reference/react/deck-trace-graph.md) for the React viewer,
[TraceEngine](../api-reference/trace/trace-engine.md),
[TracePreparedStateLayer](../api-reference/layers/trace-prepared-state-layer.md),
[TraceGraphLayer](../api-reference/layers/trace-graph-layer.md),
[TraceStoreLayer](../api-reference/layers/trace-store-layer.md), and
[TraceLayout](../api-reference/trace/trace-layout.md)
for custom deck composition.
