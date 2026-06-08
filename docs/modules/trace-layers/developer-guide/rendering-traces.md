# Rendering Traces

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

Most applications should render through `DeckTraceGraph`. Use the low-level deck.gl exports only
when you are composing a custom deck shell.

## Render pipeline

1. Load or build a normalized `TraceGraph`.
2. Build one or more `TraceLayout` objects from graphs, settings, and collapse state.
3. Project layout rows, span geometry, dependency geometry, bounds, and optional minimap summaries.
4. Render synchronized header, legend, main timeline, event strip, and minimap views.
5. Feed hover, selection, path, collapse, and time-range changes back through controlled callbacks.

The division of responsibility is:

- `TraceGraph`: normalized runtime data, refs, filtering, search, dependency lookup
- `TraceLayout`: visible rows, geometry, collapse-aware bounds
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

- `buildTracevisViewLayout(...)`
- `DeckTraceGraphController`
- `ImperativeDeckController`
- `TimeMeasureLayer`

Read [DeckTraceGraph](../api-reference/deck-trace-graph.md) for the React viewer,
[TraceLayout](../api-reference/trace-layout.md) for geometry, and the low-level API pages for custom
deck composition.
