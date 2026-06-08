import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# TimeDeltaLayer

<LayerLiveExample highlight="time-delta-layer" />

Runnable example: [Infovis layer primitives](/examples/infovis-layers/layer-primitives).

Renders a selected time interval as either full-height guide lines or a compact
header label. Trace-style measurement interactions can render the header and
viewport guides from the same start and end values.

```ts
import {TimeDeltaLayer} from '@deck.gl-community/infovis-layers';

const layer = new TimeDeltaLayer({
  id: 'time-measure',
  header: true,
  startTimeMs: selection.startTimeMs,
  endTimeMs: selection.endTimeMs,
  y: 0,
  fontSize: 12
});
```

## Properties

Inherits from all [CompositeLayer](https://deck.gl/docs/api-reference/core/composite-layer) properties.

### `header` (`boolean`, required)

When `true`, render a compact interval label and header guides. When `false`,
render full-height start and end guide lines.

### `startTimeMs` / `endTimeMs` (Number, required)

Interval start and end values in milliseconds.

### `y` (Number, optional)

Y coordinate used by the compact header guide. Default: `0`.

### `yMin` / `yMax` (Number, optional)

Vertical extent used by full-height guide lines. Defaults: `-1e6` and `1e6`.

### `fontSize`, `fontFamily`, `fontSettings`, `fontWeight` (optional)

Text props forwarded to the header label `TextLayer`.

### `color` (Color, optional)

RGBA color used by guide lines and the header label. Default: `[0, 0, 0, 255]`.

## Source

[modules/infovis-layers/src/layers/time-delta-layer.ts](https://github.com/visgl/deck.gl-community/tree/master/modules/infovis-layers/src/layers/time-delta-layer.ts)
