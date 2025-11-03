# HorizonGraphLayer

Render a single time series using the [horizon graph](https://en.wikipedia.org/wiki/Horizon_graph) visualization technique.

```js
import {HorizonGraphLayer} from '@deck.gl-community/infovis-layers';

new HorizonGraphLayer({
  id: 'horizon',
  data: values,
  bands: 4,
  yAxisScale: 1000,
  positiveColor: [0, 128, 0],
  negativeColor: [0, 0, 255],
  x: 0,
  y: 0,
  width: 800,
  height: 300
});
```

## Properties

Inherits from all [Base Layer](https://deck.gl/docs/api-reference/core/layer) properties.

### `data` (number[] | Float32Array, required)
Array of numeric samples to render.

### `yAxisScale` (Number, optional)
Scale applied to series values. Default: `1000`.

### `bands` (Number, optional)
Number of colored bands. Default: `2`.

### `positiveColor` (Color, optional)
Fill color for positive values. Default: `[0, 128, 0]`.

### `negativeColor` (Color, optional)
Fill color for negative values. Default: `[0, 0, 255]`.

### `x`, `y`, `width`, `height` (Number, optional)
Define the position and size of the chart. Defaults: `x:0`, `y:0`, `width:800`, `height:300`.

## Source

[modules/infovis-layers/src/layers/horizon-graph-layer](https://github.com/visgl/deck.gl/tree/master/modules/infovis-layers/src/layers/horizon-graph-layer)
