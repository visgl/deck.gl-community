# ZoomableMarkerLayer

`ZoomableMarkerLayer` draws atlas-based markers that can optionally scale with
zoom. It wraps [`MarkerLayer`](./marker-layer.md) and reads marker, size, and
color accessors from a [`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md).

## Usage

```js
import {ZoomableMarkerLayer, GraphStylesheetEngine} from '@deck.gl-community/graph-layers';

const markerStyle = new GraphStylesheetEngine({
  type: 'marker',
  marker: 'triangle-up',
  size: {default: 12, hover: 16},
  fill: '#312E81',
  scaleWithZoom: true
});

const layer = new ZoomableMarkerLayer({
  id: 'nodes-markers',
  data: nodes,
  getPosition: (node) => node.position,
  stylesheet: markerStyle,
  positionUpdateTrigger: layoutVersion
});
```

When `scaleWithZoom` is true, marker sizes scale by the current viewport zoom so
icons stay readable regardless of zoom level.

## Properties

`ZoomableMarkerLayer` inherits [Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer)
and forwards the relevant values to its `MarkerLayer` sublayer.

### `data` (array, optional)

Nodes rendered as markers. Defaults to an empty array.

### `getPosition` (function, required)

Accessor returning the marker anchor point.

### `stylesheet` ([`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md), required)

Provides marker, color, and size accessors via `stylesheet.getDeckGLAccessors()`.
Also exposes `scaleWithZoom` so the layer can adjust size scaling and update
triggers.

### `positionUpdateTrigger` (any, optional)

Propagates layout updates to the sublayer. Include accessor update triggers when
computing the value manually so Deck.gl knows when markers change size.
