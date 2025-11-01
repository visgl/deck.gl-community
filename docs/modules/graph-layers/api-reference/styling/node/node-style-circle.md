# Circle node style

The circle primitive renders filled disks using Deck.gl’s `ScatterplotLayer`. It
is ideal for compact node markers or when you want the radius to encode a
numerical value.

## Properties

In addition to the [shared node style options](./node-style.md#shared-properties),
circle styles understand the following keys:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `fill` | `string \| number[] \| function` | black (`[0, 0, 0]`) | Fill color. Accepts CSS color strings, `[r, g, b]`/`[r, g, b, a]` arrays, or an accessor. |
| `radius` | `number \| function` | `1` | Radius in pixels. Accessors can read node data to size circles proportionally. |
| `stroke` | `string \| number[] \| function` | black (`[0, 0, 0]`) | Outline color. |
| `strokeWidth` | `number \| function` | `0` | Outline width in pixels. |

All color accessors can return either a color string or an array. Alpha values
are optional—when omitted the color is treated as fully opaque.

## Examples

```js
{
  type: 'circle',
  radius: node => 4 + node.outgoingEdges.length,
  fill: {
    default: '#CBD5F5',
    hover: '#3B82F6'
  },
  stroke: '#1E3A8A',
  strokeWidth: 1.5
}
```

To add a subtle highlight when selecting a node you can combine selectors with
accessors:

```js
{
  type: 'circle',
  radius: 10,
  fill: '#22C55E',
  strokeWidth: {
    default: 0,
    selected: node => (node.state === 'selected' ? 4 : 0)
  },
  stroke: '#052E16'
}
```
