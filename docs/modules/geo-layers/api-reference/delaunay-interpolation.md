# DelaunayInterpolation

`DelaunayInterpolation` samples or rasterizes the station-interpolated vector field used by the
wind showcase layers. It replaces the original showcase's off-screen WebGL transform with a
backend-independent implementation suitable for WebGL, WebGPU, preprocessing, and Node.js.

```ts
import {
  createWindField,
  DelaunayInterpolation,
  parseWindData
} from '@deck.gl-community/geo-layers';

const stations = await fetch('/stations.json').then(response => response.json());
const weather = await fetch('/weather.bin').then(response => response.arrayBuffer());
const field = createWindField(stations, parseWindData(weather, stations.length));

const interpolation = new DelaunayInterpolation({field, width: 256});
const sample = interpolation.sample([-97, 38], 12.5);
const raster = interpolation.rasterize(12.5);
```

`sample` returns direction in radians, wind speed, temperature, elevation, and an east/north
velocity vector. Points outside the triangulated station coverage return `null`.

`rasterize` returns `{width, height, data}`, where `data` is a `Float32Array` containing direction,
speed, temperature, and elevation in RGBA component order.

## Related utilities

- `parseWindData(buffer, stationCount, frameCount?)`: Decodes the original station-major binary
  forecast. The default forecast length is 72 hourly frames.
- `getWindBounds(stations)`: Converts positive-west legacy station longitudes into geographic
  bounds.
- `triangulateWindStations(stations)`: Builds a Delaunay triangulation without external
  triangulation dependencies.
- `createWindField(stations, frames, options?)`: Creates a spatially indexed, time-varying wind
  field shared by all three layers.
- `sampleWindField(field, position, time?)`: Samples a field without constructing an interpolation
  wrapper.
