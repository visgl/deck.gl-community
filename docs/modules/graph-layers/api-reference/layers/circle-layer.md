# CircleLayer

`CircleLayer` renders circular graph nodes for [`GraphLayer`](./graph-layer.md)
using Deck.gl's `ScatterplotLayer`. It resolves fill, stroke, and radius
accessors from a [`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md)
instance so it stays in sync with graph styling rules.

## Usage

```js
import {CircleLayer, GraphStylesheetEngine} from '@deck.gl-community/graph-layers';

const circleStyle = new GraphStylesheetEngine({
  type: 'circle',
  radius: {default: 6, hover: 10},
  fill: '#1D4ED8',
  stroke: '#1E3A8A',
  strokeWidth: 1
});

const layer = new CircleLayer({
  id: 'nodes-circle',
  data: nodes,
  getPosition: (node) => node.position,
  stylesheet: circleStyle,
  positionUpdateTrigger: layoutVersion
});
```

Declare a stylesheet of type `circle` so the layer can derive Deck.gl accessors
such as `getRadius` and `getFillColor`. Supply `positionUpdateTrigger` when node
positions change outside of Deck.gl's shallow equality checks (for example, when
layouts stream new coordinates).

## Properties

`CircleLayer` inherits all [Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer)
and adds the graph-specific options below.

### `data` (array, optional)

Array of graph nodes rendered as circles. Defaults to an empty array.

### `getPosition` (function, optional)

Accessor returning an `[x, y]` (or `[x, y, z]`) coordinate for each datum. If
omitted, the layer renders nothing until you provide one.

### `stylesheet` ([`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md), required)

Runtime stylesheet that yields Deck.gl accessors for radius, fill, stroke, and
width. The layer calls `stylesheet.getDeckGLAccessors()` and forwards the result
to the underlying `ScatterplotLayer`.

### `positionUpdateTrigger` (any, optional)

Value forwarded to the sublayer so Deck.gl knows when positions changed outside
of referential equality. Useful when reusing the same `data` array but mutating
node positions in place.

### `pickable` (boolean, optional)

Inherited from `CompositeLayer`. Enable to surface hover and click events for
circle nodes.
