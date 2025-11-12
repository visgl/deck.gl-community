# CurvedEdgeLayer

`CurvedEdgeLayer` renders Catmull–Rom spline curves between nodes. It relies on
the reusable [`SplineLayer`](./spline-layer.md) to generate interpolated points
and can optionally show debug control points when `DEBUG` is enabled at build
time.

## Usage

```js
import {CurvedEdgeLayer} from '@deck.gl-community/graph-layers';

const layer = new CurvedEdgeLayer({
  id: 'edges-spline',
  data: edges,
  getLayoutInfo: (edge) => edge.layout,
  getColor: (edge) => edge.color,
  getWidth: (edge) => edge.width,
  positionUpdateTrigger: layoutVersion
});
```

Provide `getLayoutInfo` that returns `{sourcePosition, targetPosition,
controlPoints}`. The layer forwards those values to `SplineLayer`, which computes
smooth curves that pass through the supplied points.

## Properties

All [Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer) apply.
Notable additions include:

### `getLayoutInfo` (function, required)

Accessor returning edge geometry and an array of control points that define the
curve.

### `positionUpdateTrigger` / `colorUpdateTrigger` / `widthUpdateTrigger` (any, optional)

Triggers forwarded to the sublayers so Deck.gl recomputes positions, colors, and
widths when layout state changes.

### `getColor` / `getWidth` (functions or constants, optional)

Styling accessors forwarded to `SplineLayer`. These usually come from a
[`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md).
