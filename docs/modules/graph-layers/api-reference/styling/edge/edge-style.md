# Edge Style

### Usage

```js
edgeStyle={{
  stroke: 'black',
  strokeWidth: 2,
  data: (data) => data,
  visible: true,
  decorators: [
    {
      type: EDGE_DECORATOR_TYPE.LABEL,
      text: edge => edge.id,
      color: '#000',
      fontSize: 18,
    },
    {
      type: EDGE_DECORATOR_TYPE.ARROW,
      color: '#222',
      size: 8,
      offset: [4, 0]
    }
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

### `data` (Function, optional)

Allows setting of the layer data via accessor

### `visible` (Boolean, optional)

Determines if the layer is visible

### `decorators` (Array, optional)

A set of decorators that can be attached to each rendered edge. Supported decorator `type`
values and their style attributes include:

- `EDGE_DECORATOR_TYPE.LABEL`: draws text that follows the edge. Supports `text`, `color`,
  `fontSize`, `textAnchor`, `alignmentBaseline`, `scaleWithZoom`, `textMaxWidth`, `textWordBreak`
  and `textSizeMinPixels`.
- `EDGE_DECORATOR_TYPE.FLOW`: renders animated flow lines. Supports `color`, `width`, `speed` and
  `tailLength`.
- `EDGE_DECORATOR_TYPE.ARROW`: renders arrowheads for directed edges. Supports `color`, `size` and
  `offset`. The `offset` accessor accepts `[along, perpendicular]` distances in layer units, where
  `along` shifts the arrow away from the target node and `perpendicular` offsets it orthogonally
  from the edge.
