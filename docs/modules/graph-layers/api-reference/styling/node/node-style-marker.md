# Marker node style

Markers render vector icons from the bundled marker set. Under the hood the
style uses a Deck.gl `IconLayer` with zoom-aware sizing logic.

## Properties

Marker styles extend the [shared node options](./node-style.md#shared-properties)
with the following keys:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `marker` | `string \| function` | `'circle'` | Name of the marker glyph. See the list below for supported values. |
| `size` | `number \| function` | `12` | Marker size in pixels before zoom scaling. |
| `fill` | `string \| number[] \| function` | black (`[0, 0, 0]`) | Fill color for the glyph. |
| `scaleWithZoom` | `boolean \| function` | `true` | When `true`, markers grow/shrink with the viewport zoom level. Set to `false` to keep a constant pixel size. |

Supported marker names include:

```
"location-marker-filled", "bell-filled", "bookmark-filled", "bookmark", "cd-filled",
"cd", "checkmark", "circle-check-filled", "circle-check", "circle-filled", "circle-i-filled",
"circle-i", "circle-minus-filled", "circle-minus", "circle-plus-filled", "circle-plus",
"circle-questionmark-filled", "circle-questionmark", "circle-slash-filled", "circle-slash",
"circle-x-filled", "circle-x", "circle", "diamond-filled", "diamond", "flag-filled",
"flag", "gear", "heart-filled", "heart", "bell", "location-marker", "octagonal-star-filled",
"octagonal-star", "person-filled", "person", "pin-filled", "pin", "plus-small", "plus",
"rectangle-filled", "rectangle", "star-filled", "star", "tag-filled", "tag", "thumb-down-filled",
"thumb-down", "thumb-up", "thumb_up-filled", "triangle-down-filled", "triangle-down",
"triangle-left-filled", "triangle-left", "triangle-right-filled", "triangle-right",
"triangle-up-filled", "triangle-up", "x-small", "x"
```

## Examples

```js
{
  type: 'marker',
  marker: node => (node.isOffline ? 'triangle-down-filled' : 'circle-filled'),
  size: 18,
  fill: {
    default: '#6B7280',
    hover: '#F59E0B'
  },
  scaleWithZoom: false
}
```

Use selectors to show different icons for interaction states:

```js
{
  type: 'marker',
  marker: {
    default: 'circle',
    selected: 'star-filled'
  },
  size: 16,
  fill: '#FBBF24'
}
```
