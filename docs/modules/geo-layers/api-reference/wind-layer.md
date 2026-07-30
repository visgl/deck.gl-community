import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# WindLayer

:::caution Work in progress
The wind arrow API and styling are experimental. Native triangle glyphs and portable line
segments render on WebGL2 and WebGPU; image-based mountain terrain remains in progress.
:::

`WindLayer` renders a Delaunay-interpolated station forecast as directional, speed-colored arrow
glyphs. Its measurements, temporal interpolation, and terrain elevation are shared with
[`ParticleLayer`](./particle-layer.md).

<LayerLiveExample highlight="wind-layer" size="tall" />

## Import

```ts
import {createWindField, parseWindData, WindLayer} from '@deck.gl-community/geo-layers';
```

## Example

```ts
const stations = await fetch('/wind/stations.json').then(response => response.json());
const weather = await fetch('/wind/weather.bin').then(response => response.arrayBuffer());
const windField = createWindField(stations, parseWindData(weather, stations.length));

const arrows = new WindLayer({
  id: 'wind-arrows',
  windField,
  time: 12.5,
  gridWidth: 40,
  gridHeight: 22,
  speedScale: 1.8,
  widthMinPixels: 1.1,
  lowColor: [52, 190, 160, 195],
  highColor: [239, 163, 137, 230],
  elevationScale: 24,
  surfaceOffset: 1_200
});
```

Update `time` with a stable layer `id` to interpolate cyclically between adjacent hourly frames.
Unlike particles, arrow geometry is relatively low resolution and can be refreshed less frequently
than the animation frame rate.

## Properties

- `windField` (`WindField`, required): indexed station forecast returned by
  [`createWindField`](./wind-field.md).
- `time` (`number`, default `0`): fractional, automatically wrapping forecast frame.
- `gridWidth` (`number`, default `64`): arrow samples along longitude.
- `gridHeight` (`number`, default `32`): arrow samples along latitude.
- `speedScale` (`number`, default `0.65`): geographic arrow-length multiplier.
- `widthMinPixels` (`number`, default `1.25`): minimum shaft and arrowhead width.
- `lowColor` (`Color`, default `[70, 190, 168, 190]`): color at the minimum observed speed.
- `highColor` (`Color`, default `[247, 105, 76, 235]`): color at the maximum observed speed.
- `elevationScale` (`number`, default `1`): station-elevation multiplier.
- `surfaceOffset` (`number`, default `200`): elevation above the wind surface, in meters.

## Sub-layers

- `glyphs`: native GLSL/WGSL triangle geometry for filled directional arrows.
- `shafts`: a dual-backend `LineLayer` for arrow shafts.
- `arrowheads`: a dual-backend `LineLayer` for directional arrowhead segments.

## Historical source

The implementation preserves the station data and visual design of
[Nicolas Belmonte's original wind showcase](https://github.com/visgl/deck.gl/tree/master/showcases/wind/src).
Prior work includes the [luma.gl v4 wind-layer port](https://github.com/visgl/deck.gl/pull/794),
the [transform-feedback and instanced-particle update](https://github.com/visgl/deck.gl/pull/1346),
and the [Delaunay interpolation update](https://github.com/visgl/deck.gl/pull/2318).

See the [wind showcase guide](../developer-guide/wind-showcase.md) and the
[Wind Map example](/examples/geo-layers/wind).
