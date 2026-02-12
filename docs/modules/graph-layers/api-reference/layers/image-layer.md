# ImageLayer

`ImageLayer` draws icon-based nodes using Deck.gl's `IconLayer`. It sources icon
positions from `getPosition` and forwards color, size, and icon mapping accessors
from a [`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md).

## Usage

```js
import {ImageLayer, GraphStylesheetEngine} from '@deck.gl-community/graph-layers';

const iconStyle = new GraphStylesheetEngine({
  type: 'icon',
  size: {default: 24, hover: 32},
  fill: '#1F2937',
  icon: (node) => node.iconName
});

const layer = new ImageLayer({
  id: 'nodes-icons',
  data: nodes,
  getPosition: (node) => node.position,
  stylesheet: iconStyle,
  positionUpdateTrigger: layoutVersion
});
```

Provide a stylesheet of type `icon` (the GraphLayer alias for image nodes) so the
layer can resolve `getIcon`, `getSize`, and `getColor` accessors.

## Properties

`ImageLayer` inherits all [Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer).
Key options include:

### `data` (array, optional)

Collection of nodes rendered as icons. Defaults to an empty array.

### `getPosition` (function, required)

Accessor returning the icon anchor position.

### `stylesheet` ([`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md), required)

Provides Deck.gl accessors for icon mapping, colors, and sizes via
`stylesheet.getDeckGLAccessors()`.

### `positionUpdateTrigger` (any, optional)

Forwards layout updates to the sublayer whenever node positions change.
