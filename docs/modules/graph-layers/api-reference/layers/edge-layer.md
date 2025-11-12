# EdgeLayer

`EdgeLayer` renders graph connections using the reusable edge sublayers that
power [`GraphLayer`](./graph-layer.md). It buckets edges by layout type and
instantiates the matching renderer (`'line'`, `'path'`, or `'spline-curve'`).
Applications can use it directly to visualize graphs without adopting the full
`GraphLayer` orchestration.

## Usage

```js
import {EdgeLayer, GraphStylesheetEngine} from '@deck.gl-community/graph-layers';

const edgeStylesheet = new GraphStylesheetEngine({
  type: 'edge',
  stroke: '#1E40AF',
  strokeWidth: {default: 1.5, hover: 3}
});

const layer = new EdgeLayer({
  id: 'edges',
  data: graphEngine.getEdges(),
  getLayoutInfo: (edge) => ({
    type: edge.layout?.type ?? 'line',
    sourcePosition: edge.layout?.sourcePosition,
    targetPosition: edge.layout?.targetPosition,
    controlPoints: edge.layout?.controlPoints ?? []
  }),
  stylesheet: edgeStylesheet,
  pickable: true
});
```

Pass the layer an iterable of edges and a `getLayoutInfo` accessor that exposes
the geometry for each datum. `GraphLayer`'s
[`EdgeAttachmentHelper`](../../developer-guide/interactions.md#edge-attachment-helper)
returns a compatible accessor if you want to reuse its collision handling.

## Properties

`EdgeLayer` inherits all standard
[Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer) in addition
to the edge-specific options below.

### `data` (array, optional)

Edges to render. Each object is forwarded to `getLayoutInfo` so the layer can
derive its geometry. Defaults to an empty array.

### `getLayoutInfo` (function, optional)

Accessor invoked with each datum. It must return an object containing:

- `type` – One of `'line'`, `'path'`, or `'spline-curve'`. Unknown types are
  ignored.
- `sourcePosition` – `[x, y]` (or `[x, y, z]`) coordinate for the start of the
  segment.
- `targetPosition` – `[x, y]` (or `[x, y, z]`) coordinate for the end of the
  segment.
- `controlPoints` – Array of intermediate points. Straight-line edges can return
  an empty array.

When omitted the layer renders nothing until you provide a function. `GraphLayer`
installs a helper that snaps edges to the visible node geometry.

### `stylesheet` ([`GraphStylesheetEngine`](../internal/graph-stylesheet-engine.md), required)

Runtime stylesheet that maps graph styling declarations to Deck.gl accessors.
Instantiate it with a [`GraphLayerEdgeStyle`](../styling/graph-stylesheet.md#edge-styles)
or reuse the instance that `GraphLayer` supplies to its internal edge layers.

### `positionUpdateTrigger` (any, optional)

Value forwarded to the underlying sublayers so Deck.gl knows when edge
positions change. Supply layout timestamps or state hashes to force re-evaluation
when geometry updates.

### `pickable` (boolean, optional)

Enables Deck.gl picking for the rendered edges. Defaults to `true` so hover and
click interactions work out of the box.

### `visible` (boolean, optional)

Standard Deck.gl visibility flag. `GraphLayer` forwards the value from each
edge style in the graph stylesheet.

## Edge renderers

`EdgeLayer` dispatches to the following renderers based on the `type` returned
from `getLayoutInfo`:

- `'line'` – Uses Deck.gl's `LineLayer` for straight segments.
- `'path'` – Uses `PathLayer` and connects `controlPoints` between the source and
  target positions.
- `'spline-curve'` – Uses the internal `SplineLayer` to draw cubic curves through
  the supplied control points.

You can combine multiple `EdgeLayer` instances with different `data` selectors
and styles to render layered effects (e.g. splines for primary edges, straight
segments for backlinks).
