# Rounded rectangle node style

This primitive uses a custom shader to draw rectangles with smoothly rounded
corners while keeping the geometry lightweight. It is great for pill-shaped or
card-style nodes that should remain crisp at any zoom level.

## Properties

Rounded rectangles share all options from [basic rectangles](./node-style-rectangle.md)
and add the following controls:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `cornerRadius` | `number \| function` | `0.1` | Amount of corner rounding. `0` keeps sharp corners, `1` approaches a circle. Values between 0 and 1 are typical. |
| `radius` | `number \| function` | `1` | Optional radius multiplier for the underlying geometry. It is exposed for compatibility and can be used to expand or shrink the shader’s falloff. |

Because the shape is generated in the shader it remains smooth regardless of the
polygon resolution.

## Examples

```js
{
  type: 'rounded-rectangle',
  width: 140,
  height: 56,
  cornerRadius: 0.5,
  fill: '#111827',
  stroke: '#4ADE80',
  strokeWidth: {
    default: 1,
    selected: 3
  }
}
```

You can also adjust the radius dynamically to highlight specific groups:

```js
{
  type: 'rounded-rectangle',
  width: 110,
  height: 44,
  cornerRadius: node => (node.cluster === 'core' ? 0.35 : 0.15),
  fill: node => node.clusterColor
}
```
