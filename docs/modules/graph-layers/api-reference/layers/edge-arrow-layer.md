# EdgeArrowLayer

`EdgeArrowLayer` draws arrowheads at the end of directed edges. It uses Deck.gl's
`SimpleMeshLayer` with a 2D arrow mesh and positions each arrow according to the
edge geometry returned by `getLayoutInfo`.

## Usage

```js
import {EdgeArrowLayer} from '@deck.gl-community/graph-layers';

const layer = new EdgeArrowLayer({
  id: 'edges-arrows',
  data: edges,
  getLayoutInfo: (edge) => edge.layout,
  stylesheet: decoratorStylesheet,
  positionUpdateTrigger: layoutVersion
});
```

Only edges that report `isDirected()` or include a boolean `directed` property
receive arrowheads. The layer resolves color, size, and offset accessors from a
[`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md) configured with
`type: 'arrow'`.

## Properties

`EdgeArrowLayer` inherits all [Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer).
Key options include:

### `data` (array, optional)

Edges to decorate. Non-directed edges are filtered out automatically.

### `getLayoutInfo` (function, required)

Accessor returning `{sourcePosition, targetPosition, controlPoints}` for each
edge. The layer computes the tangent at the target to orient the arrowhead.

### `stylesheet` ([`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md), required)

Provides `getColor`, `getSize`, and optional `getOffset` accessors. Sizes are used
to scale the mesh uniformly; offsets let you pull arrows back from the terminal
node or push them perpendicular to the edge.

### `positionUpdateTrigger` (any, optional)

Signals that edge geometry changed. Combine it with stylesheet update triggers
so Deck.gl recomputes arrow positions and orientations.
