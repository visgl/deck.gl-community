# SplineLayer

`SplineLayer` evaluates Catmull–Rom splines through supplied control points and
renders the result with Deck.gl's `PathLayer`. It is the core renderer used by
[`CurvedEdgeLayer`](./curved-edge-layer.md).

## Usage

```js
import {SplineLayer} from '@deck.gl-community/graph-layers';

const layer = new SplineLayer({
  id: 'spline-layer',
  data: edges,
  getSourcePosition: (edge) => edge.source,
  getTargetPosition: (edge) => edge.target,
  getControlPoints: (edge) => edge.controlPoints,
  getColor: (edge) => edge.color,
  getWidth: (edge) => edge.width
});
```

The layer converts each edge into a flattened list of points for the Catmull–Rom
solver (`cardinal-spline-js`) and caches the resulting paths in component state.

## Properties

All [Deck.gl `CompositeLayer` props](https://deck.gl/docs/api-reference/core/composite-layer)
apply. Additional accessors include:

### `getSourcePosition` / `getTargetPosition` (functions, required)

Return the endpoints of each edge.

### `getControlPoints` (function, required)

Provides intermediate control points for the spline solver. The accessor should
return an array of `[x, y]` coordinates.

### `getColor` / `getWidth` (functions or constants, optional)

Forwarded to the internal `PathLayer` to style the curve.

### `updateTriggers` (object, optional)

Propagated to the sublayer so Deck.gl recomputes paths when layout or styling
changes.
