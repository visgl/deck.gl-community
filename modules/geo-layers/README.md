# @deck.gl-community/geo-layers

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/geo-layers.svg)](https://www.npmjs.com/package/@deck.gl-community/geo-layers)
[![NPM Downloads](https://img.shields.io/npm/dw/@deck.gl-community/geo-layers.svg)](https://www.npmjs.com/package/@deck.gl-community/geo-layers)

This module contains a suite of non-official deck.gl layers.

They can be quite useful in applications, however they are not officially supported by the deck.gl team, so use at your own risk.

## Wind layers

**Status: work in progress.** The package includes reusable layers and interpolation utilities
from Nicolas Belmonte's historical deck.gl wind showcase:

- `WindLayer` renders interpolated, speed-colored wind-direction arrows.
- `ParticleLayer` animates GPU-resident particles through the wind field using WebGL2 transform
  feedback or WebGPU compute, without per-frame particle readbacks.
- `ElevationLayer` renders the original elevation image as illuminated 3D mountain terrain.
- `DelaunayCoverLayer` renders elevation-colored station-triangulated terrain.
- `DelaunayInterpolation` samples or rasterizes the same field.
- `parseWindData`, `triangulateWindStations`, `createWindField`, `getWindBounds`, and
  `sampleWindField` load and interpolate the original station-major, 72-hour weather forecast.

```ts
import {
  createWindField,
  parseWindData,
  ParticleLayer,
  WindLayer
} from '@deck.gl-community/geo-layers';

const windField = createWindField(stations, parseWindData(weather, stations.length));

const layers = [
  new WindLayer({id: 'wind-arrows', windField, time}),
  new ParticleLayer({id: 'wind-particles', windField, time, numParticles: 100_000})
];
```

WebGL2 and WebGPU particle simulation are independently browser-tested. Wind arrows, state
boundaries, and station-triangulated terrain are portable; complete rendering of the original
mountain scene remains in progress because upstream `TerrainLayer` does not yet support WebGPU.

See the [wind showcase guide](https://deck.gl-community.github.io/docs/modules/geo-layers/developer-guide/wind-showcase)
and [standalone example](https://github.com/visgl/deck.gl-community/tree/master/examples/geo-layers/wind).
