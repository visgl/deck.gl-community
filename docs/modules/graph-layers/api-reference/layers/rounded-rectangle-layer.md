# RoundedRectangleLayer

`RoundedRectangleLayer` renders rectangles with programmable corner radii. It
extends [`RectangleLayer`](./rectangle-layer.md) and injects a fragment shader
uniform so each instance can round corners independently.

## Usage

```js
import {RoundedRectangleLayer, GraphStylesheetEngine} from '@deck.gl-community/graph-layers';

const roundedStyle = new GraphStylesheetEngine({
  type: 'rounded-rectangle',
  width: 160,
  height: 56,
  cornerRadius: 0.35,
  fill: '#F9FAFB',
  stroke: '#1F2937',
  strokeWidth: 1
});

const layer = new RoundedRectangleLayer({
  id: 'nodes-rounded',
  data: nodes,
  getPosition: (node) => node.position,
  stylesheet: roundedStyle,
  positionUpdateTrigger: layoutVersion
});
```

`GraphLayer` selects this renderer when a node style specifies
`type: 'rounded-rectangle'` in the graph stylesheet.

## Properties

All [`RectangleLayer` props](./rectangle-layer.md#properties) apply, plus the
options below.

### `cornerRadius` (number, optional)

Controls how round each corner should be. The shader expects a normalized value:
`0` renders a sharp corner while `1` approximates a circle. The stylesheet may
supply a constant or accessor via the `cornerRadius` attribute.

### `stylesheet` ([`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md), required)

Must expose `getCornerRadius`, `getWidth`, and `getHeight` accessors so the layer
can size each node and update its shader uniforms.

### `positionUpdateTrigger` (any, optional)

Triggers geometry recomputation when node bounds or positions change. Include
`stylesheet.getDeckGLAccessorUpdateTrigger('getCornerRadius')` when computing the
value manually.
