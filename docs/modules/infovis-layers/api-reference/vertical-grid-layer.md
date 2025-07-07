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
