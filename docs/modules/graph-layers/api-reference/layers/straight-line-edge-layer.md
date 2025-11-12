# StraightLineEdgeLayer

`StraightLineEdgeLayer` renders direct connections between nodes using Deck.gl's
`LineLayer`. `GraphLayer` selects it whenever an edge layout returns
`type: 'line'`.

## Usage

```js
import {StraightLineEdgeLayer} from '@deck.gl-community/graph-layers';

const layer = new StraightLineEdgeLayer({
  id: 'edges-straight',
  data: edges,
  getLayoutInfo: (edge) => edge.layout,
  getColor: (edge) => edge.color,
  getWidth: (edge) => edge.width,
  positionUpdateTrigger: layoutVersion
});
```

Supply a `getLayoutInfo` accessor that returns `sourcePosition` and
`targetPosition` for each edge. Color and width props are forwarded to Deck.gl's
`LineLayer` and usually come from a [`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md).

## Properties

`StraightLineEdgeLayer` inherits all [Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer)
and adds the accessors below.

### `data` (array, optional)

Edges to render as straight segments. Defaults to an empty array.

### `getLayoutInfo` (function, required)

Accessor returning `{sourcePosition, targetPosition}` for each datum. Optional
`controlPoints` are ignored.

### `getColor` / `getWidth` (functions or constants, optional)

Forwarded to Deck.gl's `LineLayer` to style each segment. When using a graph
stylesheet, call `stylesheet.getDeckGLAccessor('getColor')` and
`stylesheet.getDeckGLAccessor('getWidth')` to populate these props.

### `positionUpdateTrigger` (any, optional)

Signals that edge geometry changed. Pair it with layout timestamps so Deck.gl
recomputes segments after each layout iteration.
