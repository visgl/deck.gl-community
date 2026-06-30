# DeckTraceGraph

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`DeckTraceGraph` is the main React component for rendering one mounted `TraceEngine` with the
shared deck.gl trace renderer.

```tsx
import {DeckTraceGraph} from '@deck.gl-community/trace-layers/react';
```

## Responsibilities

`DeckTraceGraph`:

- accepts one mounted `TraceEngine`
- reads prepared layouts and scenes from the engine through `useSyncExternalStore`
- dispatches selection and collapse interactions back into the engine
- wires deck.gl hover, selection, zoom, minimap, and time-range interactions
- hosts built-in widgets and host-provided widgets
- exposes customization hooks for tooltips, picked objects, graph-global event cards, JSON output,
  help links, and external OmniBox results

## Common props

The source type is `DeckTraceGraphProps`. The public boundary is intentionally small:

```ts
type DeckTraceGraphProps = {
  engine: TraceEngine;
  className?: string;
  reactConfig?: DeckTraceGraphConfig;
};
```

Sync durable `TraceGraph`, settings, paths, selected refs, color scheme, and default expanded
process ids into `TraceEngineInputs`. Persist source IDs only at application boundaries, then
resolve them back to refs before syncing the engine.

## Imperative handle

`DeckTraceGraphHandle` exposes imperative navigation for mounted viewers. Use it for host-owned
search, breadcrumbs, or deep-link restore flows rather than mutating deck state from the outside.

## Customization points

- `reactConfig.renderTraceEventCard`: source-specific graph-global event content
- `reactConfig.resolvePickedTraceObject`: unwrap host-owned deck picking payloads
- `reactConfig.getTooltipReact`: replace tooltip content
- `reactConfig.getJSONForTraceObject`: customize raw-object output
- `reactConfig.externalOmniBoxSearchProvider`: merge host-owned results into search
- `reactConfig.widgets` and `reactConfig.showDefaultWidgets`: compose the control surface

See [Getting started](../../developer-guide/getting-started.md) and
[Rendering traces](../../developer-guide/rendering-traces.md), plus
[TraceEngine](../trace/trace-engine.md).
