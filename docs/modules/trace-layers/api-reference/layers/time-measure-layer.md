# TimeMeasureLayer

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TimeMeasureLayer` is the low-level deck.gl composite layer for rendering the shared trace
time-range measurement overlay.

```ts
import {TimeMeasureLayer, type TimeMeasureLayerProps} from '@deck.gl-community/trace-layers/layers';
```

## Use it when

- a custom deck shell owns the time-selection interaction
- you need the standard trace measurement overlay without `DeckTraceGraph`

`DeckTraceGraph` already wires this layer into its controlled time-range interaction. Prefer the
viewer component unless you are assembling the deck layer stack yourself.

See [Rendering traces](../../developer-guide/rendering-traces.md).
