# Rendering Traces

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

Most applications should render through `DeckTraceGraph`. It remains the full React viewer with
the shared deck shell, legend, grid, overview, time measurement, widgets, and interaction wiring.
Use the low-level deck.gl exports only when you are composing a custom deck shell.

## Render pipeline

1. Load or build a normalized `TraceGraph`.
2. Build one or more `TraceLayout` objects from graphs, settings, and collapse state.
3. Project layout rows, span geometry, dependency geometry, bounds, and optional minimap summaries.
4. Render synchronized header, legend, main timeline, event strip, and minimap views.
5. Feed hover, selection, path, collapse, and time-range changes back through controlled callbacks.

The division of responsibility is:

- `TraceGraph`: normalized runtime data, refs, filtering, search, dependency lookup
- `TraceLayout`: visible rows, geometry, collapse-aware bounds
- `TracePreparedStateLayer`: main-timeline sublayers from already-prepared `TraceViewState`
- `TraceGraphLayer`: graph-to-`TraceViewState` preparation plus main-timeline sublayers
- `TraceStoreLayer`: store-window registration, snapshot materialization, and graph rendering
- `DeckTraceGraph`: React composition and interaction surface

## What the viewer renders

The timeline can render span blocks, labels, local and cross-process dependencies, process and
thread rows, instants, counters, graph-level events, a time axis, a time-measure overlay, and an
overview minimap.

`TraceVisSettings` decides which of those are visible and which changes require structure, geometry,
or render-only work.

## Interaction boundary

Keep mounted viewer state ref-native:

- `selectedSpanRefs` and `onSelectionChange`
- `collapseState` and process/thread collapse callbacks
- highlighted span refs, path refs, and extended selection refs
- `onTimeRangeSelectionChange`
- settings, color scheme, tooltip renderers, and picked-object adapters

Serialize stable source IDs only when crossing an app boundary such as a URL, saved workspace, or
backend query.

## Low-level deck.gl exports

Custom deck shells can use:

- `TracePreparedStateLayer` when the shell already owns `TraceViewState`
- `TraceGraphLayer` when the shell owns normalized `TraceGraph` instances and render state
- `TraceStoreLayer` when the shell owns `TraceChunkStore` window sources
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
[TracePreparedStateLayer](../api-reference/layers/trace-prepared-state-layer.md),
[TraceGraphLayer](../api-reference/layers/trace-graph-layer.md),
[TraceStoreLayer](../api-reference/layers/trace-store-layer.md), and
[TraceLayout](../api-reference/trace/trace-layout.md)
for custom deck composition.
