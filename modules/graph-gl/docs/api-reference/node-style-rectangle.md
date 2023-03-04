# RECTANGLE

<p align="center">
  <img src="/gatsby/images/node-styles/rectangle.png" height="100" />
</p>

### `width` (Number | Function, required)
- The width of the rectancle.
- If a number is provided, it is used as the width for all objects.
- If a function is provided, it is called on each object to retrieve its width.

### `height` (Number | Function, required)
- The height of the rectangle.
- If a number is provided, it is used as the height for all objects.
- If a function is provided, it is called on each object to retrieve its height.

### `fill` (String | Array | Function, optional)
- Default: `[0, 0, 0, 255]`
- The value can be hex code, color name, or color array `[r, g, b, a]` (each component is in the 0 - 255 range).
If a color value (hex code, color name, or array) is provided, it is used as the global color for all objects.
- If a function is provided, it is called on each object to retrieve its color.

### `stroke` (String | Array | Function, optional)
- Default: `[0, 0, 0, 255]`
- The value can be hex code, color name, or color array `[r, g, b, a]` (each component is in the 0 - 255 range).
- If a color value (hex code, color name, or array) is provided, it is used as the global color for all objects.
- If a function is provided, it is called on each rectangle to retrieve its color.

### `strokeWidth` (Number | Function, optional)
- Default: `0`
The width of the outline of each rectangle.
If a number is provided, it is used as the outline width for all rectangles.
If a function is provided, it is called on each rectangle to retrieve its outline width.


## Source

[Storybook example](TBD/master/stories/node-types/stories.js)
