# PathEdgeLayer

`PathEdgeLayer` renders polylines that pass through intermediate control points.
It builds a path array for each edge and hands the result to Deck.gl's
`PathLayer`.

## Usage

```js
import {PathEdgeLayer} from '@deck.gl-community/graph-layers';

const layer = new PathEdgeLayer({
  id: 'edges-curved',
  data: edges,
  getLayoutInfo: (edge) => edge.layout,
  getColor: (edge) => edge.color,
  getWidth: (edge) => edge.width,
  positionUpdateTrigger: layoutVersion
});
```

`getLayoutInfo` must return `{sourcePosition, targetPosition, controlPoints}`.
The layer concatenates the positions into a Deck.gl-compatible path so edges can
bend around obstacles.

## Properties

All [Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer) apply.
Key additions include:

### `getLayoutInfo` (function, required)

Accessor returning an object with `sourcePosition`, `targetPosition`, and
`controlPoints`. Control points can be an empty array for straight segments.

### `positionUpdateTrigger` (any, optional)

Signals that layout geometry changed. Include layout timestamps so Deck.gl knows
when to recompute the path for each edge.

### `getColor` / `getWidth` (functions or constants, optional)

Forwarded to the sublayer to style each segment. These values typically come from
a [`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md).
