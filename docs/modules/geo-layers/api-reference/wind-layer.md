# WindLayer

`WindLayer` renders a time-varying weather vector field as directionally accurate, speed-colored
arrow glyphs. It ports the wind-vector component of Nicolas Belmonte's original deck.gl wind
showcase into an independently reusable, WebGL- and WebGPU-compatible composite layer.

```ts
import {createWindField, parseWindData, WindLayer} from '@deck.gl-community/geo-layers';

const stations = await fetch('/stations.json').then(response => response.json());
const weather = await fetch('/weather.bin').then(response => response.arrayBuffer());
const windField = createWindField(stations, parseWindData(weather, stations.length));

const layer = new WindLayer({
  id: 'wind-vectors',
  windField,
  time: 12.5,
  gridWidth: 64,
  gridHeight: 32,
  speedScale: 0.65,
  elevationScale: 10
});
```

## Properties

- `windField`: A `WindField` returned by `createWindField`.
- `time`: Fractional weather-frame index. Animation wraps at the final frame.
- `gridWidth`, `gridHeight`: Horizontal and vertical arrow sampling resolution.
- `speedScale`: Arrow-length multiplier relative to the geographic sample spacing.
- `widthMinPixels`: Minimum on-screen arrow width.
- `lowColor`, `highColor`: RGBA colors interpolated by observed wind speed.
- `elevationScale`: Multiplier for interpolated station elevation.
- `surfaceOffset`: Vertical separation above the terrain surface, in meters.

## Sub-layers

- `glyphs`: A `SolidPolygonLayer` containing filled directional wind arrows.
- `shafts`: A `PathLayer` containing wind-vector shafts.
- `arrowheads`: A `PathLayer` containing directional arrowheads.

See the [Wind Map example](/examples/geo-layers/wind) for the complete recreation of the original
showcase.

## Historical source

The original implementation lives in deck.gl's
[6.4-release wind showcase](https://github.com/visgl/deck.gl/tree/6.4-release/showcases/wind).
Earlier upstream work includes the
[luma.gl v4 wind-layer port](https://github.com/visgl/deck.gl/pull/794), the
[transform-feedback and instanced-particle update](https://github.com/visgl/deck.gl/pull/1346),
and the [Delaunay interpolation transform update](https://github.com/visgl/deck.gl/pull/2318).
The community port preserves the original station and forecast data while replacing obsolete,
WebGL-only rendering APIs with modern, backend-portable deck.gl sub-layers.
