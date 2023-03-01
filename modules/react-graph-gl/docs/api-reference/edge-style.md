# Edge Style

### Usage

```js
edgeStyle={{
  stroke: 'black',
  strokeWidth: 2,
  decorators: [
    {
      type: EDGE_DECORATOR_TYPE.LABEL,
      text: edge => edge.id,
      color: '#000',
      fontSize: 18,
    },
  ],
}}
```

### `stroke` (String | Array | Function, optional)
- Default: `[255, 255, 255, 255]`
- The value can be hex code, color name, or color array `[r, g, b, a]` (each component is in the 0 - 255 range).
- If a color value (hex code, color name, or array) is provided, it is used as the global color for all edges.
- If a function is provided, it is called on each rectangle to retrieve its color.

### `strokeWidth` (Number | Function, optional)
- Default: `0`
The width of the outline of each rectangle.
If a number is provided, it is used as the outline width for all edges.
If a function is provided, it is called on each rectangle to retrieve its outline width.

### `decorators` (Array, optional)
A set of decorators on edges. Please see more detail in the ['Edge decorators'](/docs/api-reference/edge-style-label) chapter.
