# TimeAxisLayer

Draws a horizontal time axis with tick marks and labels.

```js
import {TimeAxisLayer} from '@deck.gl-community/infovis-layers';

new TimeAxisLayer({
  id: 'axis',
  startTimeMs: Date.now() - 10000,
  endTimeMs: Date.now(),
  tickCount: 5,
  y: 0
});
```

## Properties

Inherits from all [CompositeLayer](https://deck.gl/docs/api-reference/core/composite-layer) properties.

### `unit` ('timestamp' | 'milliseconds', optional)
Format for tick labels. Default: `'timestamp'`.

### `startTimeMs` (Number, required)
Start time in milliseconds since epoch.

### `endTimeMs` (Number, required)
End time in milliseconds since epoch.

### `tickCount` (Number, optional)
Number of tick marks. Default: `5`.

### `y` (Number, optional)
Y coordinate of the axis line. Default: `0`.

### `color` (Color, optional)
RGBA color for axis lines and labels. Default: `[0, 0, 0, 255]`.

### `bounds` (Bounds, optional)
Override viewport bounds for the axis.

## Sub Layers

- `LineLayer` for axis and ticks
- `TextLayer` for labels

## Source

[modules/infovis-layers/src/layers/time-axis-layer.ts](https://github.com/visgl/deck.gl/tree/master/modules/infovis-layers/src/layers/time-axis-layer.ts)
