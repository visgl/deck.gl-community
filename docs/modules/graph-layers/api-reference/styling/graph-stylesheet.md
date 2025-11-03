# Graph stylesheet reference

`GraphLayer` now accepts a single `stylesheet` prop that describes how every node, edge, and decorator should render. A stylesheet is a declarative bundle of **style layers** that the [`GraphStyleEngine`](./graph-style-engine.md) normalizes into Deck.gl accessors. Each entry focuses on *what* to draw, while the engine takes care of coercing values, wiring update triggers, and fanning the configuration out across the underlying Deck.gl primitives.

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

`nodes` is always an array—the order controls drawing order. `edges` can be a single style object or an array when you want to stack multiple edge passes. The legacy `nodeStyle`/`edgeStyle` props continue to work but forward to the new structure and will be removed in a future release.

Every style entry is a `GraphStylesheet<TType>` whose `type` narrows the set of supported properties:

- **Node primitives** – `'circle'`, `'rectangle'`, `'rounded-rectangle'`, `'path-rounded-rectangle'`, `'label'`, `'marker'`, `'icon'` (alias of `'marker'`).
- **Edge primitives** – `'edge'`.
- **Edge decorators** – `'edge-label'`, `'flow'`, and `'arrow'`.

Refer to the individual [node](./node/node-style.md) and [edge](./edge/edge-style.md) references for the exact property lists.

## Declarative values

Every property accepts one of the following shapes:

| Shape | Example | Notes |
| --- | --- | --- |
| Constant | `strokeWidth: 2` | Applied verbatim to every rendered object. |
| Attribute binding | `fill: '@statusColor'` | Reads the named graph attribute from nodes/edges. Shortcuts described below. |
| Accessor | `stroke: edge => edge.isCritical ? '#F97316' : '#94A3B8'` | Receives the node or edge datum. The return value is automatically coerced into Deck.gl-friendly formats (CSS colors → `[r, g, b, a]`). |
| Stateful | `strokeWidth: {default: 1, hover: 3}` | Maps interaction states to values. Equivalent selector blocks can be provided via `':hover'` style objects. |

### Attribute bindings

Attribute bindings are the quickest way to connect graph data to visuals. They come in two forms:

```js
// String shorthand: pulls `node.getPropertyValue('group')`
fill: '@group',

// Object form: add fallbacks or remap data with a scale/formatter
strokeWidth: {
  attribute: 'weight',
  fallback: 1,
  scale: value => Math.sqrt(value)
}

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

The `attribute` reads from `GraphNode.getPropertyValue(attribute)`/`GraphEdge.getPropertyValue(attribute)` if available, falling back to the raw datum. Use `fallback` to supply defaults when the attribute is missing. When `scale` is an object the engine instantiates the specified D3 scale; pass a function if you want full control.

### Selectors and interaction states

Selectors let you override properties for specific interaction states. Prefix a state with a colon and supply a nested style object:

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

The built-in states are `default`, `hover`, `dragging`, and `selected`. When you use the map form (`{default: ..., hover: ...}`) the same state names apply.

## Composing stylesheets

Supply the stylesheet via the `stylesheet` prop when constructing `GraphLayer` (or React’s `<GraphLayer />`). The layer merges the declaration with sensible defaults and feeds the result into the renderer:

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

Edge styles may omit the `type` field—`GraphLayer` defaults it to `'edge'`—but supplying it enables TypeScript to infer the correct decorator and property options. Decorators are simply additional stylesheet entries inside the `decorators` array and support the same value shapes and selectors as nodes and edges.
