# Node stylesheets

Nodes render by stacking one or more *style layers* under the `stylesheet.nodes` prop. Each entry is a [`GraphStylesheet`](../graph-stylesheet.md) describing a single primitive such as a circle, rectangle, or label. The [`GraphStyleEngine`](../graph-style-engine.md) turns these declarations into the Deck.gl sublayers that appear on screen.

```js
const stylesheet = {
  nodes: [
    {type: 'circle', radius: {attribute: 'degree', fallback: 6, scale: value => 4 + value}},
    {type: 'label', text: '@id', color: '#172B4D', offset: [0, 16]}
  ]
};
```

Entries are drawn in array order (earlier entries render beneath later entries).

## Shared properties

Every node style understands these keys in addition to its type-specific properties:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string literal | – | Selects the primitive (`'circle'`, `'rectangle'`, `'label'`, etc.). |
| `data` | `(nodes: any[]) => any` | `nodes => nodes` | Replace the data object passed to Deck.gl when a sublayer needs derived data. |
| `visible` | `boolean` | `true` | Toggle the sublayer without removing it from the stylesheet. |
| `opacity` | number \| accessor \| attribute binding | `1` | Multiplies the alpha channel produced by the primitive. |
| `offset` | `[number, number]` \| accessor \| attribute binding | `null` | Pixel offset from the layout position. Positive Y moves up. |

All other properties accept the same [declarative value shapes](../graph-stylesheet.md#declarative-values): constants, attribute bindings such as `fill: '@statusColor'`, functions, or state maps.

## Selectors

Interaction selectors override property values when a node is hovered, dragged, or selected. Add pseudo-keys that start with `:`:

| Selector | Applies when… |
| --- | --- |
| `:hover` | the pointer is hovering the node |
| `:dragging` | the node is being dragged |
| `:selected` | the node is selected via click/tap |

```js
{
  type: 'circle',
  radius: 8,
  fill: '#2563EB',
  ':dragging': {
    fill: '#60A5FA',
    strokeWidth: 2,
    stroke: '#1D4ED8'
  }
}
```

If no selector is present the default variant is used for every state.

## Available node primitives

Use the dedicated reference pages for the properties understood by each primitive:

* [Circle](./node-style-circle.md) – disk markers.
* [Rectangle](./node-style-rectangle.md) – axis-aligned boxes.
* [Rounded rectangle](./node-style-rounded-rectangle.md) – shader-based rectangles with adjustable corners.
* [Path rounded rectangle](./node-style-path-rounded-rectangle.md) – polygon-backed rectangles, useful for precise picking.
* [Marker](./node-style-marker.md) – vector markers from the bundled set (alias: `'icon'`).
* [Label](./node-style-label.md) – text rendered with `TextLayer`.

Mix styles to create layered nodes. For example:

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

With these building blocks you can describe complex visuals declaratively and let the stylesheet engine handle the rendering details.
