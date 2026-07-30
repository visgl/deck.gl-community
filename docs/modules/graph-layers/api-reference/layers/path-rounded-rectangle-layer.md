import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# PathBasedRoundedRectangleLayer

<LayerLiveExample highlight="path-rounded-rectangle-layer" size="tall" />

`PathBasedRoundedRectangleLayer` renders rounded rectangles by tessellating a
polygon path. `RoundedRectangleLayer` now extends this implementation, so both
style names generate explicit geometry with `generateRoundedCorners` and use
deck.gl's standard dual-backend polygon shaders.

## Usage

```js
import {PathBasedRoundedRectangleLayer, GraphStylesheetEngine} from '@deck.gl-community/graph-layers';

const roundedStyle = new GraphStylesheetEngine({
  type: 'path-rounded-rectangle',
  width: 160,
  height: 56,
  cornerRadius: 12,
  fill: '#FEF2F2',
  stroke: '#B91C1C',
  strokeWidth: 1
});

const layer = new PathBasedRoundedRectangleLayer({
  id: 'nodes-rounded-path',
  data: nodes,
  getPosition: (node) => node.position,
  stylesheet: roundedStyle,
  positionUpdateTrigger: layoutVersion
});
```

Use this renderer directly for the explicit `path-rounded-rectangle` graph style;
the regular `rounded-rectangle` style shares the same portable implementation.

## Properties

All [`RectangleLayer` props](./rectangle-layer.md#properties) apply. Additional
details include:

### `stylesheet` ([`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md), required)

Must supply `width`, `height`, and `cornerRadius` accessors so the layer can
rebuild the rounded path for each node.

### `positionUpdateTrigger` (any, optional)

Forwards position and size updates to the sublayer. Include the accessor update
triggers from the stylesheet when computing the value manually.
