# Path rounded rectangle node style

This variant generates the rounded rectangle geometry on the CPU and feeds it to
Deck.gl’s `PolygonLayer`. It trades slightly higher CPU cost for compatibility
with features that rely on actual polygon outlines (e.g. GPU picking or custom
polygon processing).

## Properties

Path rounded rectangles accept the rectangle properties plus:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `cornerRadius` | `number \| function` | `0.1` | Corner rounding factor. As with the shader version, `0` is sharp and `1` is fully rounded. |

The width, height, fill, stroke, and strokeWidth options behave identically to
the [`'rectangle'` node style](./node-style-rectangle.md).

## Examples

```js
{
  type: 'path-rounded-rectangle',
  width: node => 120 + node.children.length * 8,
  height: 48,
  cornerRadius: 0.35,
  fill: '#0B1120',
  stroke: '#38BDF8',
  strokeWidth: 1.5
}
```

Because the geometry is computed per node you can animate the radius as part of
an interaction:

```js
{
  type: 'path-rounded-rectangle',
  width: 96,
  height: 40,
  cornerRadius: {
    default: 0.2,
    hover: 0.5
  },
  fill: '#1E3A8A'
}
```
