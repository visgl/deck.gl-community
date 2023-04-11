# FLOW

<p align="center">
  <img src="/gatsby/images/edge-styles/flows.gif" height="200" />
</p>

### `color` (String | Array | Function, optional)
- Default: `[255, 255, 255, 255]`
- The value can be hex code, color name, or color array `[r, g, b, a]` (each component is in the 0 - 255 range).
- If a color value (hex code, color name, or array) is provided, it is used as the global color for all edges.
- If a function is provided, it is called on each edge to retrieve its color.

### `speed` (Number | Function, optional)
- Default: `0`
- Unit: number of moving segment pass through the line per second.
- If a number is provided for `speed`, all the flow will have the same speed.
- If an accessor function is provided, the function will be called to retrieve the speed for each flow.

### `width` (Number | Function, optional)
- Default: `1`
- If a number is provided for `width`, all the flow will have the same width.
- If an accessor function is provided, the function will be called to retrieve the width for each flow.

### `tailLength` (Number | Function, optional)
- Default: `1`
- If a number is provided for `tailLength`, all the flow will have the same length for the fading tail.
- If an accessor function is provided, the function will be called to retrieve the length of the fading tail for each flow.
