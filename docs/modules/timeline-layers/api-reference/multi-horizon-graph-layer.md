# MultiHorizonGraphLayer

Render multiple horizon graphs stacked vertically. Each series is drawn using an underlying `HorizonGraphLayer` and optional divider lines.

```js
import {MultiHorizonGraphLayer} from '@deck.gl-community/timeline-layers';

new MultiHorizonGraphLayer({
  id: 'multi-horizon',
  data: series,
  getSeries: d => d.values,
  getScale: d => d.scale,
  bands: 2,
  dividerColor: [0, 0, 0],
  dividerWidth: 2,
  width: 800,
  height: 300
});
```

## Properties

Inherits from all [CompositeLayer](https://deck.gl/docs/api-reference/core/composite-layer) properties.

### `data` (Array, required)
Collection of series objects.

### `getSeries` (Accessor, optional)
Extracts the numeric series from each object. Default: `series => series.values`.

### `getScale` (Accessor, optional)
Returns the value scaling factor for each series. Default: `series => series.scale`.

### `bands` (Number, optional)
Number of color bands for each series. Default: `2`.

### `positiveColor` (Color, optional)
Color for positive values. Default: `[0, 128, 0]`.

### `negativeColor` (Color, optional)
Color for negative values. Default: `[0, 0, 255]`.

### `dividerColor` (Color, optional)
Color of the divider lines. Default: `[0, 0, 0]`.

### `dividerWidth` (Number, optional)
Thickness of divider lines in pixels. Default: `2`.

### `x`, `y`, `width`, `height` (Number, optional)
Position and size of the entire chart. Defaults: `x:0`, `y:0`, `width:800`, `height:300`.

## Sub Layers

- One `HorizonGraphLayer` per series
- Optional `SolidPolygonLayer` for divider rectangles

## Source

[modules/timeline-layers/src/layers/horizon-graph-layer](https://github.com/visgl/deck.gl-community/tree/master/modules/timeline-layers/src/layers/horizon-graph-layer)
