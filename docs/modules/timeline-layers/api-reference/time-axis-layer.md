import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# TimeAxisLayer

<LayerLiveExample highlight="time-axis-layer" size="tall" />

Draws a horizontal time axis with tick marks and labels. Existing fixed-range
callers can keep using `startTimeMs`, `endTimeMs`, the legacy `unit` values,
and `y`. Trace-style timelines can instead use adaptive viewport ticks with
`mode`, `minX`, `maxX`, `minY`, and `maxY`.

```js
import {TimeAxisLayer} from '@deck.gl-community/timeline-layers';

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

### `mode` (`'timestamp' | 'duration'`, optional)

Adaptive-axis label mode. Use `'timestamp'` for absolute Unix timestamps or
`'duration'` for relative trace time. Legacy callers can omit this prop.

### `unit` (`'timestamp' | 'milliseconds' | 'ms' | 's'`, optional)

Legacy `'timestamp'` and `'milliseconds'` values select fixed-range label
formatting. Adaptive axes use `'ms'` or `'s'` to describe the x-axis unit.

### `startTimeMs` (Number, optional)
Start time in milliseconds since epoch for legacy axes, or the time at x=0 for adaptive axes.

### `endTimeMs` (Number, optional)
Legacy axis range end in milliseconds since epoch.

### `tickCount` (Number, optional)
Number of tick marks. Default: `5`.

### `y` (Number, optional)
Y coordinate of the axis line. Default: `0`.

### `color` (Color, optional)
RGBA color for axis lines and labels. Default: `[0, 0, 0, 255]`.

### `bounds` (Bounds, optional)
Override viewport bounds for the axis.

### `minX` / `maxX` (Number, optional)

Clamp adaptive ticks to this x range.

### `minY` / `maxY` (Number, optional)

Vertical extent for adaptive grid lines.

### `minorTickCount` (Number, optional)

Density of adaptive minor ticks between major ticks. Set to `0` to disable.

### `formatTick` (Function, optional)

Receives one adaptive tick and the current tick context. Return a string to use
that label or `undefined` to fall back to the default formatter.

### `coverage` (Number, optional)

Generate ticks beyond the visible viewport to reduce regeneration while panning.
`1` covers exactly the visible viewport width.

### `axisLine` / `tickLabels` (Boolean, optional)

Toggle the horizontal axis line and tick labels independently.

### `textColor` / `gridColor` (Color, optional)

RGBA colors used by adaptive labels and grid lines. Minor ticks use the same
colors with half alpha.

### `fontSize` / `labelY` (Number, optional)

Adaptive tick label size and y position.

### `timeZoneOffsetHours` (Number, optional)

Hour offset applied before timestamp-mode labels are formatted.

## Sub Layers

- `LineLayer` for axis and ticks
- `TextLayer` for labels

## Source

[dev/timeline-layers/src/layers/time-axis-layer.ts](https://github.com/visgl/deck.gl-community/tree/master/dev/timeline-layers/src/layers/time-axis-layer.ts)
