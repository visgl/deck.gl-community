# TracePreparedStateLayer

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TracePreparedStateLayer` is the lowest public trace rendering layer. It accepts already-prepared
`TraceViewState` and renders the main timeline sublayers.

```ts
import {
  TracePreparedStateLayer,
  type TracePreparedStateLayerProps
} from '@deck.gl-community/trace-layers/layers';
```

## Use it when

- your shell already calls `buildTraceViewState`
- you need trace span, dependency, selection, instant, counter, and critical-path layers in an
  existing deck.gl layer stack

The required props are `traceViewState` and caller-owned `settings: TraceVisSettings`. Optional
props forward transient selection, path highlighting, trace color scheme, font family, process
layer handlers, step number, and row-separator visibility.

This layer intentionally does not render legend, grid, overview, run-event strip, time measurement,
widgets, tooltips, or deck views. Use `TraceGraphLayer` when the shell owns `TraceGraph` inputs but
does not already own prepared state. Use `DeckTraceGraph` for the full React viewer.

See [Rendering traces](../../developer-guide/rendering-traces.md).
