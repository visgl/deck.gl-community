# DeckTraceGraph

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`DeckTraceGraph` is the main React component for rendering one or two normalized `TraceGraph`
instances with the shared deck.gl trace renderer.

```tsx
import {DeckTraceGraph} from '@deck.gl-community/trace-layers/react';
```

## Responsibilities

`DeckTraceGraph`:

- accepts primary and optional secondary `TraceGraph` inputs
- consumes `TraceVisSettings`, `TraceStyle`, and optional `TraceColorScheme`
- builds and updates trace layouts
- wires deck.gl hover, selection, zoom, minimap, and time-range interactions
- hosts built-in widgets and host-provided widgets
- exposes customization hooks for tooltips, picked objects, graph-global event cards, JSON output,
  help links, and external OmniBox results

## Common props

The source type is `DeckTraceGraphProps`. The props most integrations own are:

```ts
type DeckTraceGraphProps = {
  traceGraph: TraceGraph;
  secondaryTraceGraph?: TraceGraph;
  traceStyle: TraceStyle;
  settings: TraceVisSettings;
  collapseState: TraceLayoutCollapseState;
  selectedSpanRefs: readonly SpanRef[];
  paths: TracePath[];
  onSelectionChange?: (selection: TraceSelectionChange) => void;
  onAllProcessesExpansionChange: (expand: boolean) => void;
  onProcessCollapseToggle: (request: TraceProcessCollapseToggleRequest) => void;
  onThreadCollapseToggle: (request: TraceThreadCollapseToggleRequest) => void;
  onThreadCollapsePrune: (request: TraceThreadCollapsePruneRequest) => void;
  onTimeRangeSelectionChange: (timeRange: DeckTraceGraphTimeRange | null) => void;
};
```

Selections and collapse state are ref-native while the viewer is mounted. Persist source IDs only
at application boundaries, then resolve them back to refs before rendering.

## Imperative handle

`DeckTraceGraphHandle` exposes imperative navigation for mounted viewers. Use it for host-owned
search, breadcrumbs, or deep-link restore flows rather than mutating deck state from the outside.

## Customization points

- `colorScheme`: source-specific span, thread, process, keyword, and dependency colors
- `renderTraceEventCard`: source-specific graph-global event content
- `resolvePickedTraceObject`: unwrap host-owned deck picking payloads
- `getTooltipReact`: replace tooltip content
- `getJSONForTraceObject`: customize raw-object output
- `externalOmniBoxSearchProvider`: merge host-owned results into search
- `widgets` and `showDefaultWidgets`: compose the control surface

See [Getting started](../developer-guide/getting-started.md) and
[Rendering traces](../developer-guide/rendering-traces.md).
