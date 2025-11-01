# Node stylesheets

GraphGL renders nodes by stacking one or more *style layers* on top of each
other. The [`nodeStyle` prop](../../../../modules/graph-layers/api-reference/graph.md)
accepts an array of style objects. Each object describes one visual layer and is
compiled into a Deck.gl sublayer by the `Stylesheet` helper.

```js
const nodeStyle = [
  {
    type: NODE_TYPE.CIRCLE,
    radius: 10,
    fill: node => (node.degree > 5 ? '#3C9EE7' : '#F06449')
  },
  {
    type: NODE_TYPE.LABEL,
    text: node => node.id,
    color: '#172B4D',
    offset: [0, 16]
  }
];
```

The order in the array controls the drawing order: earlier entries are rendered
first (i.e. they appear underneath later entries).

## How the stylesheet engine works

1. `GraphLayer` receives your style objects and instantiates a `Stylesheet` for
   each entry.
2. Every property is normalized into either a constant value or an accessor
   function. Functions are wrapped so you can return plain JavaScript values
   (strings, arrays, numbers) and the stylesheet will coerce them to the format
   required by the underlying Deck.gl layer.
3. Optional state selectors such as `:hover` or `:selected` are expanded into
   state-aware accessors. At render time the accessor receives a node with a
   `state` field (`default`, `hover`, `dragging`, `selected`) and returns the
   matching style variant.
4. Deck.gl update triggers are wired automatically so that your accessors are
   re-evaluated when their dependencies change.

This pipeline allows you to focus on the *what* of styling while GraphGL takes
care of the *how*.

## Shared properties

The following keys are understood by every node style:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | `NODE_TYPE` constant | – | Selects the visual primitive (circle, rectangle, label, etc.). |
| `data` | `function(node) -> any` | `node => node` | Replaces the data object passed to Deck.gl. Useful when a sublayer needs derived data. |
| `visible` | `boolean` | `true` | Toggles the sublayer on and off without removing it from the style list. |
| `opacity` | `number \| function` | `1` | Multiplies the alpha channel produced by the primitive. Accepts 0–1. |
| `offset` | `[number, number] \| function` | `null` | Pixel offset from the node’s layout position. Positive Y moves up. |

Every style also accepts accessor functions. You can return a literal value or
any function; if you use accessors, GraphGL automatically configures Deck.gl’s
`updateTriggers` so the layer updates when the accessor changes.

```js
{
  type: NODE_TYPE.CIRCLE,
  radius: node => Math.max(4, node.getPropertyValue('weight')),
  fill: {
    default: '#9CA3AF',
    hover: '#60A5FA',
    selected: node => node.groupColor
  }
}
```

## Stateful styling with selectors

Each style object may contain pseudo-selectors whose keys begin with `:`. The
supported selectors map to node interaction states:

| Selector | Applies when… |
| --- | --- |
| `:hover` | the pointer is hovering the node. |
| `:dragging` | the node is currently being dragged. |
| `:selected` | the node has been selected via click/tap. |

Any property placed inside a selector overrides the default variant for that
state. For example, to brighten a node while dragging:

```js
{
  type: NODE_TYPE.CIRCLE,
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

## Available node style types

Use the type-specific reference pages to learn about the properties that each
primitive understands:

* [Circle](./node-style-circle.md) – disk markers.
* [Rectangle](./node-style-rectangle.md) – axis-aligned boxes.
* [Rounded rectangle](./node-style-rounded-rectangle.md) – rectangles with
  adjustable corner radius rendered via shader.
* [Path rounded rectangle](./node-style-path-rounded-rectangle.md) – rectangles
  with rounded corners generated as polygons (useful for hit testing).
* [Marker](./node-style-marker.md) – vector markers from the bundled marker set.
* [Label](./node-style-label.md) – text drawn with `TextLayer`.

Mixing several entries gives you complex node visuals, such as a rounded
rectangle background with a label on top.

```js
const nodeStyle = [
  {
    type: NODE_TYPE.ROUNDED_RECTANGLE,
    width: 120,
    height: 48,
    cornerRadius: 0.4,
    fill: {
      default: '#0F172A',
      hover: '#1E293B'
    },
    stroke: '#38BDF8',
    strokeWidth: node => (node.state === NODE_STATE.SELECTED ? 4 : 1)
  },
  {
    type: NODE_TYPE.LABEL,
    text: node => node.label,
    color: '#F8FAFC',
    fontSize: 18
  }
];
```

With these building blocks you can express most node visuals declaratively and
let GraphGL handle the rendering details.
