# @deck.gl-community/layers

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/layers.svg)](https://www.npmjs.com/package/@deck.gl-community/layers)
[![NPM Downloads](https://img.shields.io/npm/dw/@deck.gl-community/layers.svg)](https://www.npmjs.com/package/@deck.gl-community/layers)

This module contains a suite of non-official deck.gl layers.

Import the common layers from `@deck.gl-community/layers/common-layers`. The package root also exports them. Import the tree renderer and its types from `@deck.gl-community/layers/vegetation-layers`.
Applications can install `h3-js` and `a5-js` separately when they need those grid libraries. Both are optional peers.

They can be quite useful in applications, however they are not officially supported by the deck.gl team, so use at your own risk.

[`FlameTrailLayer`](../../docs/modules/layers/api-reference/flame-trail-layer.md) renders
3D flames and embers with the TripsLayer API. It requires WebGL2.

[`VolumetricVideoLayer`](../../docs/modules/layers/api-reference/volumetric-video-layer.md)
renders MP4/MOV frames as a time volume with GPU static-pixel removal on WebGL2 and WebGPU.
Run the [local-file example](../../examples/layers/volumetric-video/README.md) to explore it.

[`SplatLayer`](../../docs/modules/layers/api-reference/splat-layer.md) renders prepared Gaussian sources with shared instancing, automatic refinement, deformation and owner picking on WebGL2 and WebGPU. It has no TreeLayer dependency.

[`TreeLayer`](../../docs/modules/layers/api-reference/tree-layer.md) is the canonical procedural tree renderer, with Gaussian foliage and connected woody meshes. It reads `TreeSpec` traits directly from rows or one `getTree` accessor; species proportions, templates and automatic refinement are internal.

## Wind layers

**Status: work in progress.** The package includes reusable layers and interpolation utilities
from Nicolas Belmonte's historical deck.gl wind showcase:

- `WindFieldLayer` renders interpolated, speed-colored wind-direction arrows.
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
  WindFieldLayer
} from '@deck.gl-community/layers/wind-layers';

const windField = createWindField(stations, parseWindData(weather, stations.length));

const layers = [
  new WindFieldLayer({id: 'wind-arrows', windField, time}),
  new ParticleLayer({id: 'wind-particles', windField, time, numParticles: 100_000})
];
```

WebGL2 and WebGPU particle simulation are independently browser-tested. Wind arrows, state
boundaries, station-triangulated terrain, and the original image-derived mountain terrain are
portable with stable deck.gl 9.4.

See the [wind showcase guide](https://deck.gl-community.github.io/docs/modules/geo-layers/developer-guide/wind-showcase)
and [standalone example](https://github.com/visgl/deck.gl-community/tree/master/examples/geo-layers/wind).
