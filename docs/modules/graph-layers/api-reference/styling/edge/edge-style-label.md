# Edge label decorator

Adds text anchored near the edge’s midpoint. Internally this uses the same
`ZoomableTextLayer` as node labels, so the available options are similar.

## Properties

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `text` | constant \| accessor \| attribute binding | – (required) | Label content. Attribute strings such as `text: '@weight'` pull from edge properties. |
| `color` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Font color. |
| `fontSize` | constant \| accessor \| attribute binding | `12` | Font size in pixels. |
| `textAnchor` | constant \| accessor \| attribute binding | `'middle'` | Horizontal alignment relative to the computed position. |
| `alignmentBaseline` | constant \| accessor \| attribute binding | `'center'` | Vertical alignment. |
| `angle` | constant \| accessor \| attribute binding | Automatic | Rotation in degrees. Defaults to the edge direction; override to lock the angle. |
| `textMaxWidth` | constant \| accessor \| attribute binding | `-1` | Maximum width before wrapping. `-1` disables wrapping. |
| `textWordBreak` | constant \| accessor \| attribute binding | `'break-all'` | Word-breaking mode (`'break-word'`, `'break-all'`, etc.). |
| `textSizeMinPixels` | constant \| accessor \| attribute binding | `9` | Minimum rendered size for zooming out. |
| `scaleWithZoom` | constant \| accessor \| attribute binding | `true` | Whether the label scales with the viewport zoom level. |
| `offset` | constant \| accessor \| attribute binding | `null` | Additional pixel offset from the centroid-derived anchor position. |

All properties support selectors (`:hover`, `:selected`, …) and accessors, just
like the base edge style.

## Examples

```js
{
  type: 'edge-label',
  text: {attribute: 'weight', scale: (value) => `${value} ms`},
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
  type: 'edge-label',
  text: '@label',
  scaleWithZoom: {
    default: true,
    dragging: false
  },
  textSizeMinPixels: 12
}
```
