# Edge label decorator

Adds text anchored near the edge’s midpoint. Internally this uses the same
`ZoomableTextLayer` as node labels, so the available options are similar.

## Properties

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `text` | `string \| function` | - (required) | Label content. Functions receive the edge instance. |
| `color` | `string \| number[] \| function` | black (`[0, 0, 0]`) | Font color. |
| `fontSize` | `number \| function` | `12` | Font size in pixels. |
| `textAnchor` | `string \| function` | `'middle'` | Horizontal alignment relative to the computed position. |
| `alignmentBaseline` | `string \| function` | `'center'` | Vertical alignment. |
| `angle` | `number \| function` | Automatic | Rotation in degrees. Defaults to the edge direction; override to lock the angle. |
| `textMaxWidth` | `number \| function` | `-1` | Maximum width before wrapping. `-1` disables wrapping. |
| `textWordBreak` | `string \| function` | `'break-all'` | Word-breaking mode (`'break-word'`, `'break-all'`, etc.). |
| `textSizeMinPixels` | `number \| function` | `9` | Minimum rendered size for zooming out. |
| `scaleWithZoom` | `boolean \| function` | `true` | Whether the label scales with the viewport zoom level. |
| `offset` | `[number, number] \| function` | `null` | Additional pixel offset from the centroid-derived anchor position. |

All properties support selectors (`:hover`, `:selected`, …) and accessors, just
like the base edge style.

## Examples

```js
{
  type: EDGE_DECORATOR_TYPE.LABEL,
  text: edge => `${edge.weight} ms`,
  color: {
    default: '#1F2937',
    hover: '#111827'
  },
  textAnchor: 'start',
  offset: [8, 0]
}
```

To keep labels readable while zooming, disable scaling at small sizes:

```js
{
  type: EDGE_DECORATOR_TYPE.LABEL,
  text: edge => edge.label,
  scaleWithZoom: {
    default: true,
    dragging: false
  },
  textSizeMinPixels: 12
}
```
