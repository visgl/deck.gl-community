# VerticalGridLayer

```ts
export type VerticalGridLayerProps = LayerProps & {
  xMin: number; // Start time in milliseconds since epoch
  xMax: number; // End time in milliseconds since epoch
  tickCount?: number; // Optional: Number of tick marks (default: 5)
  yMin?: number; // Minimum Y-coordinate for grid lines
  yMax?: number; // Maximum Y-coordinate for grid lines
  width?: number; // Optional: Width of the grid lines (default: 1)
  color?: [number, number, number, number]; // Optional: RGBA color for grid lines (default: [200, 200, 200, 255])
};
```

Render evenly spaced vertical grid lines along the x-axis.

```js
import {VerticalGridLayer} from '@deck.gl-community/infovis-layers';

new VerticalGridLayer({
  id: 'grid',
  xMin: 0,
  xMax: 1000,
  tickCount: 5,
  yMin: -100,
  yMax: 100,
  color: [200, 200, 200, 255]
});
```

## Properties

Inherits from all [CompositeLayer](https://deck.gl/docs/api-reference/core/composite-layer) properties.

### `xMin` (Number, required)

Start time in milliseconds since epoch.

### `xMax` (Number, required)

End time in milliseconds since epoch.

### `tickCount` (Number, optional)

Number of grid lines to draw. Default: `5`.

### `yMin`, `yMax` (Number, optional)

Vertical range of grid lines. Defaults: `-1e6` to `1e6`.

### `width` (Number, optional)

Line width in pixels. Default: `1`.

### `color` (Color, optional)

RGBA color for grid lines. Default: `[200, 200, 200, 255]`.

## Sub Layers

- `LineLayer` for grid lines

## Source

[modules/infovis-layers/src/layers/vertical-grid-layer.ts](https://github.com/visgl/deck.gl/tree/master/modules/infovis-layers/src/layers/vertical-grid-layer.ts)
