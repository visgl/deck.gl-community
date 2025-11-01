# Label node style

Labels are rendered with Deck.gl’s `TextLayer` and are typically combined with a
background primitive (circle, rectangle, etc.).

## Properties

Alongside the [shared node options](./node-style.md#shared-properties), labels
support the following keys:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `text` | `string \| function` | – (required) | Text to display. Functions receive the node instance. |
| `color` | `string \| number[] \| function` | black (`[0, 0, 0]`) | Font color. |
| `fontSize` | `number \| function` | `12` | Font size in pixels. |
| `textAnchor` | `string \| function` | `'middle'` | Horizontal alignment: `'start'`, `'middle'`, or `'end'`. |
| `alignmentBaseline` | `string \| function` | `'center'` | Vertical alignment: `'top'`, `'center'`, or `'bottom'`. |
| `angle` | `number \| function` | `0` | Clockwise rotation in degrees. |
| `textMaxWidth` | `number \| function` | `-1` | Maximum width in pixels before wrapping. `-1` disables wrapping. |
| `textWordBreak` | `string \| function` | `'break-all'` | Word-breaking mode passed to `TextLayer` (`'break-all'`, `'break-word'`, etc.). |
| `textSizeMinPixels` | `number \| function` | `9` | Minimum size the text is allowed to shrink to. |
| `scaleWithZoom` | `boolean \| function` | `true` | Whether the font scales with zoom. Set to `false` to keep screen-space size. |

## Examples

```js
{
  type: NODE_TYPE.LABEL,
  text: node => node.label,
  color: '#E2E8F0',
  fontSize: 16,
  offset: [0, 18],
  alignmentBaseline: 'top'
}
```

Using selectors you can provide contextual hints:

```js
{
  type: NODE_TYPE.LABEL,
  text: node => node.label,
  color: {
    default: '#64748B',
    hover: '#F8FAFC'
  },
  textMaxWidth: 160,
  textWordBreak: 'break-word',
  ':selected': {
    fontSize: 20,
    scaleWithZoom: false
  }
}
```
