# Graph stylesheet reference

`GraphLayer` accepts a single `stylesheet` prop that describes how every node,
edge, and decorator should render. A stylesheet is a declarative bundle of
**style layers** that the [`GraphStyleEngine`](./graph-style-engine.md) normalizes
into Deck.gl accessors. Each entry focuses on *what* to draw, while the engine
coerces values, wires update triggers, and fans the configuration out across the
underlying Deck.gl primitives.

## Top-level structure

```ts
import type {GraphLayerProps} from '@deck.gl-community/graph-layers';

const stylesheet: NonNullable<GraphLayerProps['stylesheet']> = {
  nodes: [
    {type: 'circle', radius: 10, fill: '#2563EB'},
    {type: 'label', text: '@id', color: '#0F172A'}
  ],
  edges: {
    stroke: '#CBD5F5',
    strokeWidth: 1.5,
    decorators: [{type: 'arrow', size: 8}]
  }
};
```

`nodes` is always an array—the order controls drawing order. `edges` can be a
single style object or an array when you want to stack multiple edge passes. The
legacy `nodeStyle`/`edgeStyle` props continue to work but forward to the new
structure and will be removed in a future release.

Every style entry is a `GraphStylesheet<TType>` whose `type` narrows the set of
supported properties:

- **Node primitives** – `'circle'`, `'rectangle'`, `'rounded-rectangle'`,
  `'path-rounded-rectangle'`, `'label'`, `'marker'`, `'icon'` (alias of
  `'marker'`).
- **Edge primitives** – `'edge'`.
- **Edge decorators** – `'edge-label'`, `'flow'`, and `'arrow'`.

## Declarative values

Every property accepts one of the following shapes:

| Shape | Example | Notes |
| --- | --- | --- |
| Constant | `strokeWidth: 2` | Applied verbatim to every rendered object. |
| Attribute binding | `fill: '@statusColor'` | Reads the named graph attribute from nodes/edges. Shortcuts described below. |
| Accessor | `stroke: edge => edge.isCritical ? '#F97316' : '#94A3B8'` | Receives the node or edge datum. The return value is automatically coerced into Deck.gl-friendly formats (CSS colors → `[r, g, b, a]`). |
| Stateful | `strokeWidth: {default: 1, hover: 3}` | Maps interaction states to values. Equivalent selector blocks can be provided via `':hover'` style objects. |

### Attribute bindings

Attribute bindings are the quickest way to connect graph data to visuals. They
come in two forms:

```js
// String shorthand: pulls `node.getPropertyValue('group')`
fill: '@group',

// Object form: add fallbacks or remap data with a scale/formatter
strokeWidth: {
  attribute: 'weight',
  fallback: 1,
  scale: value => Math.sqrt(value)
},

// Declarative scale mapping (uses d3-scale under the hood)
color: {
  attribute: 'region',
  scale: {
    type: 'ordinal',
    domain: ['Americas', 'EMEA', 'APAC'],
    range: ['#2563EB', '#10B981', '#F97316']
  }
}
```

The `attribute` reads from `GraphNode.getPropertyValue(attribute)`/
`GraphEdge.getPropertyValue(attribute)` if available, falling back to the raw
datum. Use `fallback` to supply defaults when the attribute is missing. When
`scale` is an object the engine instantiates the specified D3 scale; pass a
function if you want full control.

### Selectors and interaction states

Selectors override properties for specific interaction states. Prefix a state
with a colon and supply a nested style object:

```js
const edgeStyle = {
  stroke: '#CBD5F5',
  strokeWidth: 1,
  ':hover': {
    stroke: '#2563EB',
    strokeWidth: 2
  },
  ':selected': {
    strokeWidth: 4
  }
};
```

The built-in states are `default`, `hover`, `dragging`, and `selected`. When you
use the map form (`{default: ..., hover: ...}`) the same state names apply.

## Node styles

Node visuals are composed by stacking one or more style layers under the
`stylesheet.nodes` array:

```js
const stylesheet = {
  nodes: [
    {type: 'circle', radius: {attribute: 'degree', fallback: 6, scale: value => 4 + value}},
    {type: 'label', text: '@id', color: '#172B4D', offset: [0, 16]}
  ]
};
```

Entries are drawn in array order (earlier entries render beneath later entries).

### Shared node properties

Every node style understands these keys in addition to its type-specific
properties:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string literal | – | Selects the primitive (`'circle'`, `'rectangle'`, `'label'`, etc.). |
| `data` | `(nodes: any[]) => any` | `nodes => nodes` | Replace the data object passed to Deck.gl when a sublayer needs derived data. |
| `visible` | `boolean` | `true` | Toggle the sublayer without removing it from the stylesheet. |
| `opacity` | number \| accessor \| attribute binding | `1` | Multiplies the alpha channel produced by the primitive. |
| `offset` | `[number, number]` \| accessor \| attribute binding | `null` | Pixel offset from the layout position. Positive Y moves up. |

All other properties accept the same declarative value shapes listed above:
constants, attribute bindings such as `fill: '@statusColor'`, functions, or
state maps.

### Node primitives

Use the dedicated reference pages for the properties understood by each
primitive:

- [Circle](./node/node-style-circle.md) – disk markers.
- [Rectangle](./node/node-style-rectangle.md) – axis-aligned boxes.
- [Rounded rectangle](./node/node-style-rounded-rectangle.md) – shader-based rectangles with adjustable corners.
- [Path rounded rectangle](./node/node-style-path-rounded-rectangle.md) – polygon-backed rectangles, useful for precise picking.
- [Marker](./node/node-style-marker.md) – vector markers from the bundled set (alias: `'icon'`).
- [Label](./node/node-style-label.md) – text rendered with `TextLayer`.

Mix primitives to create layered nodes. For example:

```js
const stylesheet = {
  nodes: [
    {
      type: 'rounded-rectangle',
      width: 120,
      height: 48,
      cornerRadius: 0.4,
      fill: {
        default: '#0F172A',
        hover: '#1E293B'
      },
      stroke: '#38BDF8',
      strokeWidth: {attribute: 'isSelected', scale: value => (value ? 4 : 1)}
    },
    {type: 'label', text: '@label', color: '#F8FAFC', fontSize: 18}
  ]
};
```

## Edge styles

Edges are styled via the `stylesheet.edges` prop on `GraphLayer`. The legacy
`edgeStyle` prop forwards to this shape but will be removed in a future release.
Similar to nodes, a `GraphStylesheet` definition is normalized by the
`GraphStyleEngine`, which resolves colors, attribute bindings, and interaction
states before feeding them into Deck.gl’s `LineLayer`.

```js
const stylesheet = {
  edges: {
    stroke: {attribute: 'isCritical', fallback: false, scale: value => (value ? '#F97316' : '#94A3B8')},
    strokeWidth: {
      default: 1,
      hover: 3,
      selected: {attribute: 'weight', fallback: 2, scale: value => Math.min(6, 2 + value)}
    },
    decorators: [
      {type: 'edge-label', text: '@id', color: '#000', fontSize: 18},
      {type: 'arrow', color: '#222', size: 8, offset: [4, 0]}
    ]
  }
};
```

### Shared edge properties

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `stroke` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Line color. Accepts CSS strings, `[r, g, b, a]` arrays, or bindings such as `stroke: '@color'`. |
| `strokeWidth` | constant \| accessor \| attribute binding | `0` | Line width in pixels. |
| `data` | `(edges: any[]) => any` | `edges => edges` | Override the data object passed to the Deck.gl layer. |
| `visible` | `boolean` | `true` | Toggle the entire edge layer on/off. |
| `decorators` | `Array` | `[]` | Additional visual adornments such as labels or animated flow indicators. |

Edge styles honor the same selectors as node styles (`:hover`, `:dragging`, and
`:selected`). Selector blocks can override any property, including decorators.

### Edge decorators

Decorators add auxiliary visuals that travel along the edge path. Each decorator
is an object with a `type` field. Supported values include:

- [`'edge-label'`](./edge/edge-style-label.md) – draws text that follows the edge. Supports `text`, `color`, `fontSize`, `textAnchor`, `alignmentBaseline`, `scaleWithZoom`, `textMaxWidth`, `textWordBreak`, and `textSizeMinPixels`.
- [`'flow'`](./edge/edge-style-flow.md) – animated flow segments to communicate direction or magnitude. Supports `color`, `width`, `speed`, and `tailLength`.
- `'arrow'` – renders arrowheads for directed edges. Supports `color`, `size`, and `offset`. The `offset` accessor accepts `[along, perpendicular]` distances in layer units, where `along` shifts the arrow away from the target node and `perpendicular` offsets it orthogonally from the edge.

Decorators are also processed by the stylesheet engine, so they can use
selectors and accessors just like the main edge style.

## Composing stylesheets

Supply the stylesheet via the `stylesheet` prop when constructing `GraphLayer`
(or React’s `<GraphLayer />`). The layer merges the declaration with sensible
defaults and feeds the result into the renderer:

```js
new GraphLayer({
  stylesheet: {
    nodes: [
      {type: 'circle', radius: 12, fill: '@groupColor'},
      {type: 'label', text: '@id', color: '#0F172A'}
    ],
    edges: {
      stroke: {
        attribute: 'weight',
        scale: {type: 'linear', domain: [0, 10], range: ['#CBD5F5', '#1E3A8A']}
      },
      strokeWidth: {attribute: 'weight', fallback: 1, scale: value => 0.5 + value * 0.2},
      decorators: [{type: 'edge-label', text: '@weight'}]
    }
  }
});
```

Edge styles may omit the `type` field—`GraphLayer` defaults it to `'edge'`—but
supplying it enables TypeScript to infer the correct decorator and property
options. Decorators are simply additional stylesheet entries inside the
`decorators` array and support the same value shapes and selectors as nodes and
edges.
