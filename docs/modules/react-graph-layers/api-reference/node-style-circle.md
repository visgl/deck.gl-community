# CIRCLE

<p align="center">
  <img src="/gatsby/images/node-styles/circle.png" height="100" />
</p>

### `fill` (String | Array | Function, optional)
- Default: `#fff`
- The value can be hex code, color name, or color array `[r, g, b, a]` (each component is in the 0 - 255 range).
If a color value (hex code, color name, or array) is provided, it is used as the global color for all objects.
If a function is provided, it is called on each rectangle to retrieve its color.

### `radius` (Number | Function, optional)
- Default: `1`
- If a number is provided for `radius`, all the circles will have the same radius.
If an accessor function is provided, the function will be called to retrieve the radius of each circle.

### `stroke` (String | Array | Function, optional)
- Default: `[0, 0, 0, 255]`
- The value can be hex code, color name, or color array `[r, g, b, a]` (each component is in the 0 - 255 range).
- If a color value (hex code, color name, or array) is provided, it is used as the global color for all objects.
- If a function is provided, it is called on each rectangle to retrieve its color.

### `strokeWidth` (Number | Function, optional)
- Default: `0`
- The width of the outline of each rectangle.
- If a number is provided, it is used as the outline width for all rectangles.
- If a function is provided, it is called on each rectangle to retrieve its outline width.
