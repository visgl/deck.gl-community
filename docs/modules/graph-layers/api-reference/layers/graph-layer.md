# GraphLayer

`GraphLayer` is a composite Deck.gl layer that renders graph nodes, edges, and
optional decorators using the declarative [graph stylesheet](../styling/graph-stylesheet.md).
It orchestrates the `GraphEngine` with layout, styling, and interaction state so
that graph applications can focus on supplying data and high-level behavior.

## Usage

```js
import {GraphLayer, JSONLoader, D3ForceLayout} from '@deck.gl-community/graph-layers';

const layer = new GraphLayer({
  id: 'graph',
  data: graphJson,
  graphLoader: JSONLoader,
  layout: new D3ForceLayout(),
  stylesheet: {
    nodes: [
      {type: 'circle', radius: {attribute: 'degree', fallback: 6}},
      {type: 'label', text: '@id', color: '#172B4D', offset: [0, 16]}
    ],
    edges: {
      stroke: {attribute: 'isCritical', fallback: false, scale: value => (value ? '#F97316' : '#CBD5F5')},
      strokeWidth: {default: 1, hover: 3},
      decorators: [{type: 'arrow', size: 8}]
    }
  },
  enableDragging: true
});
```

Provide either a pre-built `graph` or raw `data` plus a `graphLoader`. When the
layer receives new data it rebuilds the internal `GraphEngine`, re-runs the
layout, and updates interactions automatically.

## Properties

`GraphLayer` inherits all standard [Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer)
and adds the graph-specific options below.

### Data sources

#### `data` (object | array, optional)

Raw JSON data used to construct a graph. The structure is passed to
[`graphLoader`](#graphloader-function-optional) whenever `data` changes. Provide
one of `data`, `graph`, or `engine`.

#### `graph` ([`Graph`](../graph.md), optional)

Pre-initialized graph instance to render. Supply this when you manage the graph
lifecycle yourself (e.g. streaming updates). Mutating the graph outside the layer
requires calling [`layer.setNeedsRedraw`](https://deck.gl/docs/api-reference/core/layer#layerupdateneeded)
or updating props so Deck.gl knows to re-render.

#### `graphLoader` (function, optional)

Custom loader that converts raw `data` into a `Graph`. Defaults to the bundled
`JSONLoader`, which expects `{nodes, edges}` collections.

#### `engine` (`GraphEngine`, optional)

Inject an existing engine to reuse layout state across renders. When omitted the
layer constructs a new engine from `graph` or `data`.

#### `layout` ([`GraphLayout`](../layouts/README.md), optional)

Layout algorithm used by the engine. Pass one of the bundled layouts such as
[`D3ForceLayout`](../layouts/d3-force-layout.md) or implement a custom layout that
conforms to the interface.

### Styling

#### `stylesheet` ([`GraphLayerStylesheet`](../styling/graph-stylesheet.md), optional)

Declarative description of node and edge appearance. Supply `nodes` as an array
and `edges` as a single object or array when stacking edge passes. The layer
still accepts the legacy `nodeStyle`/`edgeStyle` props but they are deprecated
and forward to the stylesheet internally.

### Interaction

#### `nodeEvents` (object, optional)

Register interaction callbacks for nodes. Supported keys are `onMouseLeave`,
`onHover`, `onMouseEnter`, `onClick`, and `onDrag`. See the
[interaction reference](../interactions.md) for signatures and usage notes.

#### `edgeEvents` (object, optional)

Interaction callbacks for edges. Supports `onClick` and `onHover`. See the
[interaction reference](../interactions.md).

#### `enableDragging` (boolean, optional)

When `true`, nodes can be repositioned by dragging. The interaction manager
updates the layout and stylesheet state automatically during drags.

### Miscellaneous

#### `pickable` (boolean, optional)

Inherited from `CompositeLayer`. Defaults to `true` so nodes and edges respond to
hover and click events. Disable if you only need a static rendering.

#### `rankGrid` (boolean | object, optional)

Draw grid lines that align with ranked layers in the active layout. Pass `true`
to enable the default configuration or supply an object to customize the
behavior:

```ts
new GraphLayer({
  id: 'dag',
  layout: new D3DagLayout({layering: 'simplex'}),
  rankGrid: {
    enabled: true,
    direction: 'horizontal',
    rankAccessor: 'rank',
    maxLines: 8,
    gridProps: {
      color: [148, 163, 184, 220],
      labelOffset: [8, 0]
    }
  }
});
```

`GraphLayer` samples the layout engine for node positions, maps each rank to an
averaged Y coordinate, and renders the overlay with the reusable `GridLayer`.
When multiple ranks collapse onto the same coordinate the layer redistributes
them across the current viewport bounds so the lines stay readable. The
configuration supports:

- `enabled` (default `true`) – toggle the overlay without changing other
  settings.
- `direction` (`'horizontal' | 'vertical'`, default `'horizontal'`) – orient the
  grid lines to match the DAG orientation.
- `rankAccessor` (string | function) – read the rank field from each node. By
  default the accessor falls back to the `srank` property computed by the DAG
  layout.
- `labelAccessor` (string | function) – override the text shown next to each
  grid line.
- `maxLines` (number, default `8`) – limit how many ranks are rendered.
- `gridProps` – forwarded to the underlying `GridLayer` so you can adjust line
  color, width, label offsets, and similar presentation details.

## Notes

- The layer resolves the stylesheet through the `GraphStyleEngine`, which
  coalesces attribute bindings, selectors, and triggers before delegating to the
  underlying Deck.gl sublayers.
- Reusing the same `GraphEngine` instance across renders preserves layout state
  and interaction history. Provide the `engine` prop to opt into that workflow.
