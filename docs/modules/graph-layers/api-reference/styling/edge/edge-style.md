# Edge stylesheets

Edges are styled via the `stylesheet.edges` prop on
`GraphLayer` (the legacy `edgeStyle` prop continues to work but is deprecated). Similar to nodes, a `GraphStylesheet` definition is normalized by
the `GraphStyleEngine`, which resolves colors, accessors, and interaction states
before feeding them into Deck.gl’s `LineLayer`.

```js
const stylesheet = {
  edges: {
    stroke: edge => (edge.isCritical ? '#F97316' : '#94A3B8'),
    strokeWidth: {
      default: 1,
      hover: 3,
      selected: 4
    },
    decorators: [
      {
        type: 'edge-label',
        text: edge => edge.id,
        color: '#000',
        fontSize: 18
      },
      {
        type: 'arrow',
        color: '#222',
        size: 8,
        offset: [4, 0]
      }
    ]
  }
};
```

## Shared properties

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `stroke` | `string \| number[] \| function` | black (`[0, 0, 0]`) | Line color. Accepts CSS strings or `[r, g, b, a]` arrays. |
| `strokeWidth` | `number \| function` | `0` | Line width in pixels. Accessors receive the edge object. |
| `data` | `function(edge) -> any` | `edge => edge` | Overrides the data object passed to the Deck.gl layer. |
| `visible` | `boolean` | `true` | Toggles the entire edge layer on/off. |
| `decorators` | `Array` | `[]` | Additional visual adornments such as labels or animated flow indicators. |

### Interaction selectors

Edge styles honor the same selectors as node styles: `:hover`, `:dragging`, and
`:selected`. Selector blocks can override any property, including decorators.

```js
const stylesheet = {
  edges: {
    stroke: '#CBD5F5',
    strokeWidth: 1,
    ':hover': {
      stroke: '#2563EB',
      strokeWidth: 2
    }
  }
};
```

### `decorators` (Array, optional)

Decorators add auxiliary visuals that travel along the edge path. Each decorator
is an object with a `type` field.
A set of decorators that can be attached to each rendered edge. Supported decorator `type`
values and their style attributes include:

The following decorator types are available:

* [`'edge-label'`](./edge-style-label.md) - draws text that follows the edge. Supports `text`, `color`,
  `fontSize`, `textAnchor`, `alignmentBaseline`, `scaleWithZoom`, `textMaxWidth`, `textWordBreak`
  and `textSizeMinPixels`..
* [`'flow'`](./edge-style-flow.md) - animated flow segments to
  communicate direction or magnitude. Supports `color`, `width`, `speed` and
  `tailLength`.
* `'arrow'`: renders arrowheads for directed edges. Supports `color`, `size` and
  `offset`. The `offset` accessor accepts `[along, perpendicular]` distances in layer units, where
  `along` shifts the arrow away from the target node and `perpendicular` offsets it orthogonally
  from the edge.

Decorators are also processed by the stylesheet engine, so they can use
selectors and accessors just like the main edge style.
