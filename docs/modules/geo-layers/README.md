# Overview

![deck.gl v9](https://img.shields.io/badge/deck.gl-v9-green.svg?style=flat-square)
![WebGPU partially supported](https://img.shields.io/badge/webgpu-partial-yellow.svg?style=flat-square)

This module provides a suite of geospatial layers for [deck.gl](https://deck.gl).

:::caution
The deck.gl-community repository is semi-maintained. One of its goals is to collect and preserve
valuable deck.gl ecosystem code that does not have a dedicated home. Some modules may no longer
have dedicated maintainers, so responses to issues are not guaranteed.
:::

## Installation

```bash
npm install @deck.gl-community/geo-layers
```

## Background

This module exports geospatial deck.gl layers developed by the community.

## Wind showcase

:::caution Work in progress
The wind-layer API and historical showcase are experimental. `ParticleLayer` has verified WebGL2
and WebGPU GPU simulation. The complete terrain-and-arrows scene remains WebGL2-first because
upstream terrain, polygon, and path support on WebGPU is still in progress.
:::

The [wind showcase guide](./developer-guide/wind-showcase.md) recreates Nicolas Belmonte's
[original deck.gl wind showcase](https://github.com/visgl/deck.gl/tree/master/showcases/wind/src)
using the original 72-hour forecast, smoothed three-dimensional mountain terrain, directional
arrows, and up to one million GPU-animated particles.

```ts
import {
  createWindField,
  parseWindData,
  ParticleLayer,
  WindLayer
} from '@deck.gl-community/geo-layers';

const frames = parseWindData(weatherBuffer, stations.length);
const windField = createWindField(stations, frames);

const layers = [
  new WindLayer({id: 'wind-arrows', windField, time}),
  new ParticleLayer({
    id: 'wind-particles',
    windField,
    time,
    numParticles: 100_000
  })
];
```

Create and share the wind field once; advance `time` without rebuilding the station triangulation,
weather textures, or GPU particle buffers.

## API Reference

- [Wind field and weather data](./api-reference/wind-field.md) documents the original binary
  forecast, positive-west station coordinates, robust triangulation, and geographic interpolation.
- [WindLayer](/docs/modules/geo-layers/api-reference/wind-layer) renders Delaunay-interpolated,
  speed-colored wind arrows.
- [ParticleLayer](/docs/modules/geo-layers/api-reference/particle-layer) animates fading trails
  through a geographic wind field.
- [ElevationLayer](/docs/modules/geo-layers/api-reference/elevation-layer) turns the original
  grayscale elevation map into illuminated, vertically exaggerated 3D terrain.
- [DelaunayCoverLayer](/docs/modules/geo-layers/api-reference/delaunay-cover-layer) renders the
  elevation-colored station triangulation.
- [DelaunayInterpolation](/docs/modules/geo-layers/api-reference/delaunay-interpolation) samples
  or explicitly rasterizes time-varying station measurements independently of the graphics backend.
- [SharedTile2DLayer](/docs/modules/geo-layers/api-reference/shared-tile-2d-layer)
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/experimental-orange.svg?style=flat-square" alt="experimental" />
- [SharedTileset2D](/docs/modules/geo-layers/api-reference/shared-tileset-2d)
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/experimental-orange.svg?style=flat-square" alt="experimental" />
- [TileGridLayer](/docs/modules/geo-layers/api-reference/tile-grid-layer)
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/experimental-orange.svg?style=flat-square" alt="experimental" />
- [TileSourceLayer](/docs/modules/geo-layers/api-reference/tile-source-layer)
- [GlobalGridLayer](/docs/modules/geo-layers/api-reference/global-grid-layer)
- [GlobalGrid](/docs/modules/geo-layers/api-reference/global-grid)

## Examples

- [Wind Map](/examples/geo-layers/wind) recreates Nicolas Belmonte's original deck.gl wind showcase
  using its original 72-hour station forecast and imported, reusable geo-layers.
- [SharedTile2DLayer example](/examples/geo-layers/shared-tile-2d-layer) demonstrates one shared loaders.gl `TileSource` feeding multiple `SharedTile2DLayer`s across multiple views.
  It also shows shared `SharedTileset2D` cache stats rendered through `SharedTileset2D.stats` and uses `TileGridLayer` to visualize tile loading.
