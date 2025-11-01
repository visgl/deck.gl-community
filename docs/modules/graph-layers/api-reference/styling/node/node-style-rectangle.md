# Rectangle node style

Rectangles are rendered with Deck.gl’s `PolygonLayer` and are useful for card-like
nodes or to provide a background behind other primitives.

## Properties

Besides the [shared node options](./node-style.md#shared-properties), rectangles
support:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `width` | `number \| function` | – (required) | Rectangle width in pixels. Accessors receive the node instance. |
| `height` | `number \| function` | – (required) | Rectangle height in pixels. |
| `fill` | `string \| number[] \| function` | black (`[0, 0, 0]`) | Interior color. |
| `stroke` | `string \| number[] \| function` | black (`[0, 0, 0]`) | Border color. |
| `strokeWidth` | `number \| function` | `0` | Border width in pixels. |

## Examples

```js
{
  type: NODE_TYPE.RECTANGLE,
  width: 120,
  height: 60,
  fill: '#1F2937',
  stroke: '#93C5FD',
  strokeWidth: 1
}
```

You can combine selectors to animate the border as the user interacts with the
node:

```js
{
  type: NODE_TYPE.RECTANGLE,
  width: node => 100 + node.metadata.padding * 2,
  height: 48,
  fill: {
    default: '#0F172A',
    hover: '#1E293B'
  },
  strokeWidth: {
    default: 1,
    selected: 4
  },
  stroke: '#38BDF8'
}
```
