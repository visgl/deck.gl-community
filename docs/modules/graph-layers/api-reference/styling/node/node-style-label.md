# Label node style

Labels are rendered with Deck.gl’s `TextLayer` and are typically combined with a
background primitive (circle, rectangle, etc.).

## Properties

Alongside the [shared node options](./node-style.md#shared-properties), labels
support the following keys:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `text` | constant \| accessor \| attribute binding | – (required) | Text to display. Attribute strings such as `text: '@label'` read from node properties. |
| `color` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Font color. |
| `fontSize` | constant \| accessor \| attribute binding | `12` | Font size in pixels. |
| `textAnchor` | constant \| accessor \| attribute binding | `'middle'` | Horizontal alignment: `'start'`, `'middle'`, or `'end'`. |
| `alignmentBaseline` | constant \| accessor \| attribute binding | `'center'` | Vertical alignment: `'top'`, `'center'`, or `'bottom'`. |
| `angle` | constant \| accessor \| attribute binding | `0` | Clockwise rotation in degrees. |
| `textMaxWidth` | constant \| accessor \| attribute binding | `-1` | Maximum width in pixels before wrapping. `-1` disables wrapping. |
| `textWordBreak` | constant \| accessor \| attribute binding | `'break-all'` | Word-breaking mode passed to `TextLayer` (`'break-all'`, `'break-word'`, etc.). |
| `textSizeMinPixels` | constant \| accessor \| attribute binding | `9` | Minimum size the text is allowed to shrink to. |
| `scaleWithZoom` | constant \| accessor \| attribute binding | `true` | Whether the font scales with zoom. Set to `false` to keep screen-space size. |

## Examples

```js
{
  type: 'label',
  text: '@label',
  color: '#E2E8F0',
  fontSize: 16,
  offset: [0, 18],
  alignmentBaseline: 'top'
}
```

Using selectors you can provide contextual hints:

```js
{
  type: 'label',
  text: '@label',
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
