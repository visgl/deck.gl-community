# EdgeLabelLayer

`EdgeLabelLayer` renders text annotations along edges. It wraps the reusable
[`ZoomableTextLayer`](./zoomable-text-layer.md), positions labels at the centroid
of the edge geometry, and rotates text to follow the edge direction.

## Usage

```js
import {EdgeLabelLayer} from '@deck.gl-community/graph-layers';

const layer = new EdgeLabelLayer({
  id: 'edges-labels',
  data: edges,
  getLayoutInfo: (edge) => edge.layout,
  stylesheet: decoratorStylesheet,
  positionUpdateTrigger: layoutVersion
});
```

Configure the stylesheet with `type: 'edge-label'` so the layer can resolve text,
color, and font-size accessors.

## Properties

All [Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer) apply.
Edge-specific options include:

### `data` (array, optional)

Edges to label. Defaults to an empty array.

### `getLayoutInfo` (function, required)

Accessor returning `{sourcePosition, targetPosition, controlPoints}`. The layer
computes a centroid across all points and rotates each label to match the edge
heading.

### `stylesheet` ([`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md), required)

Provides Deck.gl text accessors via `stylesheet.getDeckGLAccessors()`, including
`getText`, `getColor`, and `getSize`.

### `positionUpdateTrigger` (any, optional)

Triggers label repositioning when layout geometry changes. Combine with
stylesheet update triggers if text or color changes dynamically.
