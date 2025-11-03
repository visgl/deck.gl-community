# Rectangle node style

Rectangles are rendered with Deck.gl’s `PolygonLayer` and are useful for card-like
nodes or to provide a background behind other primitives. Attribute bindings let
you size and color cards directly from node metadata.

## Properties

Besides the [shared node options](./node-style.md#shared-properties), rectangles
support:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `width` | constant \| accessor \| attribute binding | – (required) | Rectangle width in pixels. |
| `height` | constant \| accessor \| attribute binding | – (required) | Rectangle height in pixels. |
| `fill` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Interior color. |
| `stroke` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Border color. |
| `strokeWidth` | constant \| accessor \| attribute binding | `0` | Border width in pixels. |

## Examples

```js
{
  type: 'rectangle',
  width: {attribute: 'width', fallback: 120},
  height: {attribute: 'height', fallback: 60},
  fill: '#1F2937',
  stroke: '#93C5FD',
  strokeWidth: 1
}
```

You can combine selectors to animate the border as the user interacts with the
node:

```js
{
  type: 'rectangle',
  width: {attribute: 'padding', fallback: 0, scale: (value) => 100 + value * 2},
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
