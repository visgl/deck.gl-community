# FlowLayer

`FlowLayer` renders animated flow lines between nodes. It wraps the reusable
[`FlowPathLayer`](./flow-path-layer.md) and maps graph stylesheet accessors to the
underlying Deck.gl uniforms.

## Usage

```js
import {FlowLayer} from '@deck.gl-community/graph-layers';

const layer = new FlowLayer({
  id: 'edges-flow',
  data: edges,
  getLayoutInfo: (edge) => edge.layout,
  stylesheet: decoratorStylesheet,
  positionUpdateTrigger: layoutVersion
});
```

Provide a stylesheet with `type: 'flow'` so the layer can resolve `getColor`,
`getWidth`, `getSpeed`, and `getTailLength` accessors.

> **Note:** The current implementation stubs out transform feedback in
> `FlowPathLayer`, so flow animation is not yet available. The layer still
> forwards styling information but throws an error if the transform feedback code
> executes.

## Properties

All [Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer) apply.
Flow-specific options include:

### `data` (array, optional)

Edges to visualize as flows.

### `getLayoutInfo` (function, required)

Accessor returning `{sourcePosition, targetPosition}` for each edge. The layer
forwards these positions to `FlowPathLayer` so it can build line segments.

### `stylesheet` ([`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md), required)

Provides color, width, speed, and tail-length accessors via
`stylesheet.getDeckGLAccessors()`.

### `positionUpdateTrigger` (any, optional)

Signals that layout geometry changed so flow segments recompute.
