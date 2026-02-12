# RectangleLayer

`RectangleLayer` renders axis-aligned rectangles around graph nodes. It derives
size, fill, and stroke accessors from a [`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md)
and tessellates each rectangle into a polygon for Deck.gl's `PolygonLayer`.

## Usage

```js
import {RectangleLayer, GraphStylesheetEngine} from '@deck.gl-community/graph-layers';

const rectangleStyle = new GraphStylesheetEngine({
  type: 'rectangle',
  width: 120,
  height: 48,
  fill: '#EFF6FF',
  stroke: '#3B82F6',
  strokeWidth: 1
});

const layer = new RectangleLayer({
  id: 'nodes-rectangles',
  data: nodes,
  getPosition: (node) => node.position,
  stylesheet: rectangleStyle,
  positionUpdateTrigger: layoutVersion
});
```

The layer evaluates `getWidth`/`getHeight` on every datum and builds a four-point
polygon centered on the node's position. Width accessors receive the node object
so they can derive dimensions from labels or metadata.

## Properties

In addition to [Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer),
`RectangleLayer` supports the options below.

### `data` (array, optional)

Graph nodes to render. Defaults to an empty array.

### `getPosition` (function, required)

Accessor returning the rectangle center in `[x, y]` (or `[x, y, z]`) format.

### `stylesheet` ([`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md), required)

Supplies Deck.gl accessors for width, height, fill color, stroke color, and line
width. The layer requests individual accessors via `getDeckGLAccessor()` and
wires the results to the underlying `PolygonLayer`.

### `positionUpdateTrigger` (any, optional)

Forwarded to `getPolygon` so Deck.gl recomputes rectangle geometry whenever node
positions or sizes change.

### `pickable` (boolean, optional)

Inherited from `CompositeLayer`. Enable to make rectangles respond to hover and
click events.
