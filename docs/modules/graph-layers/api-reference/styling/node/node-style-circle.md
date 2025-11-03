# Circle node style

The circle primitive renders filled disks using Deck.gl’s `ScatterplotLayer`. It
is ideal for compact node markers or when you want the radius to encode a
numerical value. Pair it with attribute bindings to map graph properties
directly onto color and size.

## Properties

In addition to the [shared node style options](./node-style.md#shared-properties),
circle styles understand the following keys:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `fill` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Fill color. Accepts CSS strings, `[r, g, b]`/`[r, g, b, a]` arrays, or bindings such as `fill: '@groupColor'`. |
| `radius` | constant \| accessor \| attribute binding | `1` | Radius in pixels. Accessors can read node data to size circles proportionally. |
| `stroke` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Outline color. |
| `strokeWidth` | constant \| accessor \| attribute binding | `0` | Outline width in pixels. |

All color accessors can return either a color string or an array. Alpha values
are optional—when omitted the color is treated as fully opaque.

## Examples

```js
{
  type: 'circle',
  radius: {attribute: 'degree', fallback: 4, scale: (value) => Math.max(4, value)},
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
    selected: {attribute: 'isSelected', fallback: false, scale: (value) => (value ? 4 : 0)}
  },
  stroke: '#052E16'
}
```
