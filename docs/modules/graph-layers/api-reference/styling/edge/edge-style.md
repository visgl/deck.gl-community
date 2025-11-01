# Edge stylesheets

Edges are styled with a single object passed to the `edgeStyle` prop of
`GraphLayer`. Similar to nodes, the stylesheet engine normalizes colors,
accessors, and interaction states before feeding them into Deck.gl’s `LineLayer`.

```js
const edgeStyle = {
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
      fontSize: 18,

      // text: edge => edge.weight.toFixed(1),
      // color: '#1F2937',
      // offset: [0, 16]

    },
    {
      type: EDGE_DECORATOR_TYPE.ARROW,
      color: '#222',
      size: 8,
      offset: [4, 0]
    }
  ],
}}
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
const edgeStyle = {
  stroke: '#CBD5F5',
  strokeWidth: 1,
  ':hover': {
    stroke: '#2563EB',
    strokeWidth: 2
  }
};
```

### Decorators

Decorators add auxiliary visuals that travel along the edge path. Each decorator
is an object with a `type` field matching one of `EDGE_DECORATOR_TYPE`. The
following decorator types are available:

* [`EDGE_DECORATOR_TYPE.LABEL`](./edge-style-label.md) - text anchored to the
  edge midpoint.
* [`EDGE_DECORATOR_TYPE.FLOW`](./edge-style-flow.md) - animated flow segments to
  communicate direction or magnitude.

<<<<<<< HEAD
### `decorators` (Array, optional)

A set of decorators that can be attached to each rendered edge. Supported decorator `type`
values and their style attributes include:

- `EDGE_DECORATOR_TYPE.LABEL`: draws text that follows the edge. Supports `text`, `color`,
  `fontSize`, `textAnchor`, `alignmentBaseline`, `scaleWithZoom`, `textMaxWidth`, `textWordBreak`
  and `textSizeMinPixels`.
- `EDGE_DECORATOR_TYPE.FLOW`: renders animated flow lines. Supports `color`, `width`, `speed` and
  `tailLength`.
- `EDGE_DECORATOR_TYPE.ARROW`: renders arrowheads for directed edges. Supports `color`, `size` and
  `offset`. The `offset` accessor accepts `[along, perpendicular]` distances in layer units, where
  `along` shifts the arrow away from the target node and `perpendicular` offsets it orthogonally
  from the edge.
=======
Decorators are also processed by the stylesheet engine, so they can use
selectors and accessors just like the main edge style.
>>>>>>> 0464f83 (docs: overhaul graph-layers styling reference)
