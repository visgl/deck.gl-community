# LabelLayer

`LabelLayer` renders text for graph nodes using the reusable
[`ZoomableTextLayer`](./zoomable-text-layer.md). It resolves text, color, and size
accessors from a [`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md)
so labels stay in sync with the active graph stylesheet.

## Usage

```js
import {LabelLayer, GraphStylesheetEngine} from '@deck.gl-community/graph-layers';

const labelStyle = new GraphStylesheetEngine({
  type: 'label',
  text: (node) => node.label,
  color: '#0F172A',
  fontSize: {default: 14, hover: 16},
  scaleWithZoom: true,
  textAnchor: 'middle',
  alignmentBaseline: 'top'
});

const layer = new LabelLayer({
  id: 'nodes-labels',
  data: nodes,
  getPosition: (node) => node.position,
  stylesheet: labelStyle,
  positionUpdateTrigger: layoutVersion
});
```

When `scaleWithZoom` is true, font sizes are scaled with the current viewport
zoom so labels remain legible at multiple zoom levels.

## Properties

All [Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer) apply.
Layer-specific options include:

### `data` (array, optional)

Nodes to label. Defaults to an empty array.

### `getPosition` (function, required)

Accessor that returns the label anchor position.

### `stylesheet` ([`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md), required)

Provides text, color, font size, and alignment accessors via
`stylesheet.getDeckGLAccessors()`.

### `positionUpdateTrigger` (any, optional)

Signals to Deck.gl that label positions changed, ensuring text moves with the
rest of the graph.
