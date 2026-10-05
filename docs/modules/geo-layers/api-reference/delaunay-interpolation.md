import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# DelaunayInterpolation

:::caution Work in progress
The wind raster layout and interpolation options may evolve. This utility performs explicit CPU
sampling; GPU particle advection is implemented separately by
[`ParticleLayer`](./particle-layer.md).
:::

`DelaunayInterpolation` samples or rasterizes a station-interpolated geographic wind field. It is
usable in the browser, in Node.js, and as an input-preprocessing step for either graphics backend.

<LayerLiveExample highlight="delaunay-interpolation" size="tall" />

## Import

```ts
import {
  createWindField,
  DelaunayInterpolation,
  parseWindData
} from '@deck.gl-community/geo-layers';
```

## Sample a geographic location

```ts
const stations = await fetch('/wind/stations.json').then(response => response.json());
const weather = await fetch('/wind/weather.bin').then(response => response.arrayBuffer());
const field = createWindField(stations, parseWindData(weather, stations.length));

const interpolation = new DelaunayInterpolation({
  field,
  width: 128,
  height: 64
});

const sample = interpolation.sample([-97, 38], 12.5);

if (sample) {
  console.log(sample.direction, sample.speed, sample.temperature);
  console.log(sample.velocity, sample.elevation);
}
```

Positions outside the triangulated station hull return `null`. Forecast time interpolates between
adjacent frames and wraps at the end of the forecast.

## Rasterize a forecast frame

```ts
const raster = interpolation.rasterize(12.5);
const center = (Math.floor(raster.height / 2) * raster.width + Math.floor(raster.width / 2)) * 4;

const direction = raster.data[center];
const speed = raster.data[center + 1];
const temperature = raster.data[center + 2];
const elevation = raster.data[center + 3];
```

`rasterize` returns [`WindRaster`](./wind-field.md): `{width, height, data}`. Its `Float32Array`
contains row-major `[direction, speed, temperature, elevation]` pixels. Uncovered pixels are zero.

## Constructor properties

- `field` (`WindField`, required): shared indexed station forecast.
- `width` (`number`, default `256`): raster width, at least `2` pixels.
- `height` (`number`, optional): raster height, at least `2` pixels; inferred from the geographic
  aspect ratio when omitted.

## Methods

- `sample(position, time?)`: returns a [`WindSample`](./wind-field.md) or `null`.
- `rasterize(time?)`: returns one lazily generated [`WindRaster`](./wind-field.md).

Do not call `rasterize` for each animated particle or browser frame. `ParticleLayer` caches the
weather textures and performs per-particle movement entirely on the graphics device.

See the [wind showcase guide](../developer-guide/wind-showcase.md) and the
[Wind Map example](/examples/geo-layers/wind).
