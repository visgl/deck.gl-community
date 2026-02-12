# GridLayer

`GridLayer` renders labeled reference lines that align with graph ranks or any
other scalar dimension. [`GraphLayer`](./graph-layer.md) uses it to draw the
optional rank grid overlay, but you can reuse the layer to add lightweight axis
markings to custom graph views.

## Usage

```js
import {GridLayer} from '@deck.gl-community/graph-layers';

const rankLines = new GridLayer({
  id: 'ranks',
  data: [
    {label: 'Root', yPosition: 0},
    {label: 'Level 1', yPosition: -200},
    {label: 'Level 2', yPosition: -400}
  ],
  direction: 'horizontal',
  color: [148, 163, 184, 220],
  width: 1,
  labelOffset: [8, 0]
});
```

The layer converts each datum into a `LineLayer` segment and, when `showLabels`
is enabled, an aligned `TextLayer` label.

## Properties

`GridLayer` inherits all standard
[Deck.gl layer props](https://deck.gl/docs/api-reference/core/layer) and adds the
configuration below.

### `data` (array, required)

Array of grid line definitions. Each object can provide:

- `label` – Optional text rendered alongside the line.
- `yPosition` – Coordinate for horizontal lines.
- `xPosition` – Coordinate for vertical lines.

At least one of `yPosition` or `xPosition` must be a finite number for the datum
to render.

### `direction` (`'horizontal' | 'vertical'`, optional)

Controls whether the layer reads `yPosition` or `xPosition`. Defaults to
`'horizontal'`.

### `xMin` / `xMax` / `yMin` / `yMax` (number, optional)

Clamp the extents of the rendered lines. When omitted the layer expands the
bounds using the current viewport so lines stay visible while panning and
zooming.

### `width` (number, optional)

Pixel width for rendered lines. Defaults to `1`.

### `color` (`[r, g, b, a]`, optional)

RGBA color applied to lines and labels. Defaults to a light gray (`[200, 200,
200, 255]`).

### `getLabel` (function, optional)

Accessor that resolves the label for each datum. Falls back to the `label`
property.

### `getColor` (function, optional)

Accessor returning a per-datum color. Return `null` or `undefined` to use the
layer-level `color`.

### `getWidth` (function, optional)

Accessor returning a per-datum width. Return `null` or `undefined` to use the
layer-level `width`.

### `showLabels` (boolean, optional)

Toggles label rendering. Defaults to `true`.

### `labelOffset` (`[x, y]`, optional)

Pixel offset for labels. Defaults to `[8, 0]`, which places text just to the
right of horizontal lines.
