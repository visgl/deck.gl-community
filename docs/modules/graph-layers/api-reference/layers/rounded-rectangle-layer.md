import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# RoundedRectangleLayer

<LayerLiveExample highlight="rounded-rectangle-layer" size="tall" />

`RoundedRectangleLayer` renders rectangles with programmable corner radii. It
CPU-tessellates each rounded outline and renders it through deck.gl's
dual-backend `PolygonLayer`, so the same geometry works on WebGL2 and WebGPU.

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

The options below control the generated polygon geometry.

### `cornerRadius` (number, optional)

Controls the radius of each CPU-tessellated corner in the layer's coordinate
units. The stylesheet may supply a constant or accessor.

### `stylesheet` ([`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md), required)

Must expose `getCornerRadius`, `getWidth`, and `getHeight` accessors so the layer
can rebuild each node polygon when its style changes.

### `positionUpdateTrigger` (any, optional)

Triggers geometry recomputation when node bounds or positions change. Include
`stylesheet.getDeckGLAccessorUpdateTrigger('getCornerRadius')` when computing the
value manually.
