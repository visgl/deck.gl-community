import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# Wind field and weather data

:::caution Work in progress
The wind-field data format, interpolation utilities, and wind-layer APIs are experimental and may
change. The particle simulation runs on the graphics device; the field-building and explicit
sampling utilities described here are deliberately backend-independent.
:::

A `WindField` is the shared, indexed weather forecast used by `WindLayer`, `ParticleLayer`,
`ElevationLayer` examples, `DelaunayCoverLayer`, and `DelaunayInterpolation`. Build the field
once and reuse the same object throughout an animation.

<LayerLiveExample highlight="wind-field" size="tall" />

## Import

```ts
import {
  createWindField,
  getWindBounds,
  parseWindData,
  sampleWindField,
  triangulateWindStations,
  type WindBounds,
  type WindField,
  type WindFieldOptions,
  type WindMeasurement,
  type WindSample,
  type WindStation,
  type WindTriangle
} from '@deck.gl-community/geo-layers';
```

## Load the original forecast

```ts
import {
  createWindField,
  parseWindData,
  type WindStation
} from '@deck.gl-community/geo-layers';

const dataUrl =
  'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/wind';

const [stations, weather] = await Promise.all([
  fetch(`${dataUrl}/stations.json`).then(response => response.json()) as Promise<WindStation[]>,
  fetch(`${dataUrl}/weather.bin`).then(response => response.arrayBuffer())
]);

const frames = parseWindData(weather, stations.length);
const windField = createWindField(stations, frames);
```

The original `weather.bin` contains 72 hourly forecast frames. Each weather station stores its
frames consecutively, with three unsigned 16-bit values per frame:
`[direction, speed, temperature]`. `parseWindData` converts this station-major binary layout into
frame-major measurements.

## Station coordinates

The historical dataset uses **positive-west** longitude:

```ts
const station: WindStation = {
  name: 'Denver',
  long: 104.99,
  lat: 39.739,
  elv: 1609
};

const deckPosition = [-station.long, station.lat, station.elv];
```

`createWindField`, `getWindBounds`, `triangulateWindStations`, and the wind layers perform this
conversion internally. Do not pre-negate `station.long` before passing the original dataset to
these utilities.

## `parseWindData(buffer, stationCount, frameCount?)`

```ts
const frames: WindMeasurement[][] = parseWindData(weather, stations.length, 72);
```

- `buffer`: station-major `ArrayBuffer` containing packed `Uint16` measurements.
- `stationCount`: number of weather stations represented in every frame.
- `frameCount`: number of forecast frames; defaults to `72`.
- Returns frame-major `[direction, speed, temperature]` measurements.
- Throws `RangeError` when the dimensions or binary length are invalid.

Direction is measured in eighth-turns: `0` points east, and successive values rotate
counterclockwise by 45 degrees. `sampleWindField` converts the result into radians and an
eastward/northward velocity.

## `createWindField(stations, frames, options?)`

```ts
const windField: WindField = createWindField(stations, frames);

const options: WindFieldOptions = {
  triangles: triangulateWindStations(stations)
};

const fieldWithExistingTriangles = createWindField(stations, frames, options);
```

Creates the shared forecast, computes geographic bounds and observed value ranges, and indexes the
station triangulation for fast repeated sampling. By default, the robust Delaunay triangulation is
computed once with `delaunator`; provide `options.triangles` when reusing a known station mesh.

`WindField` exposes `stations`, `frames`, `triangles`, `bounds`, `speedRange`, and
`temperatureRange`. Its `spatialIndex` is an internal implementation detail, not a public
construction API.

## `sampleWindField(field, position, time?)`

```ts
const sample: WindSample | null = sampleWindField(windField, [-104.99, 39.739], 12.5);

if (sample) {
  console.log(sample.direction, sample.speed, sample.temperature);
  console.log(sample.elevation, sample.velocity);
}
```

Interpolates measurements spatially inside the station triangulation and temporally between
adjacent forecast frames. Fractional times wrap around the forecast; positions outside measured
station coverage return `null` instead of being extrapolated.

`WindSample.direction` is in radians, `velocity` is `[east, north]`, and `elevation` is in meters.

## `triangulateWindStations(stations)`

```ts
const triangles: WindTriangle[] = triangulateWindStations(stations);
```

Returns station-index triples covering the real station hull. Duplicate station coordinates are
ignored. Fewer than three distinct, non-collinear station positions produce an empty triangulation.

## `getWindBounds(stations)`

```ts
const bounds: WindBounds = getWindBounds(stations);
const elevationBounds = [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat];
```

Returns geographic west, south, east, and north limits using deck.gl longitude conventions.

## GPU simulation boundary

`ParticleLayer` turns the shared field into cached weather textures and keeps particle positions in
GPU buffers. WebGL2 uses transform feedback; WebGPU uses compute. Explicitly calling
`sampleWindField` or `DelaunayInterpolation.rasterize` is CPU work and is not necessary for each
animation frame. Do not rebuild the field, triangulation, raster, or particle simulation on every
`requestAnimationFrame`.

See the [complete wind showcase guide](../developer-guide/wind-showcase.md),
[ParticleLayer](./particle-layer.md), and
[original wind showcase](https://github.com/visgl/deck.gl/tree/master/showcases/wind/src).
