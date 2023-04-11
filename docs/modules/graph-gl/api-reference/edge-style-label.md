# LABEL

<p align="center">
  <img src="/gatsby/images/edge-styles/label.png" height="200" />
</p>

### `text` (String | Function, required)
- The text of the label.
- If a string is provided for `text`, all the edges will have the same text.
- If an accessor function is provided, the function will be called to retrieve the text of each edge.

### `color` (String | Array | Function, optional)
- Default: `[255, 255, 255, 255]`
- The value can be hex code, color name, or color array `[r, g, b, a]` (each component is in the 0 - 255 range).
- If a color value (hex code, color name, or array) is provided, it is used as the global color for all edges.
- If a function is provided, it is called on each edge to retrieve its color.

### `fontSize` (Number | Function, optional)
- Default: `12`
- If a number is provided for `fontSize`, all the labels will have the same font size.
- If an accessor function is provided, the function will be called to retrieve the font size of each label.

### `textAnchor` (String | Function, optional)
- Default: `middle`
- The text anchor. Available options include 'start', 'middle' and 'end'.

- If a string is provided, it is used as the text anchor for all edges.
- If a function is provided, it is called on each edge to retrieve its text anchor.

### `alignmentBaseline` (String | Function, optional)
- Default: `center`
The alignment baseline. Available options include 'top', 'center' and 'bottom'.
- If a string is provided, it is used as the alignment baseline for all edges.
- If a function is provided, it is called on each edge to retrieve its alignment baseline.
