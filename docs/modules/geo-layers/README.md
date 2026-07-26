# Overview


![deck.gl v9](https://img.shields.io/badge/deck.gl-v9-green.svg?style=flat-square")
![WebGPU not supported](https://img.shields.io/badge/webgpu-no-red.svg?style=flat-square")

This module provides a suite of geospatial layers for [deck.gl](https://deck.gl).

:::caution
The deck.gl-community repository is semi-maintaned. One of its goals is to collect and preserve valuable deck.gl ecosystem related code that does not have a dedicated home. Some modules may no longer have dedicated maintainers. This means that there is sometimes no one who can respond quickly to issues.
:::

## Installation

```bash
npm install @deck.gl-community/geo-layers
```

## Background

This modules exports various geospatial deck.gl layers developed by the community that could be of use to others.

## API Reference

- [WindLayer](/docs/modules/geo-layers/api-reference/wind-layer) renders Delaunay-interpolated,
  speed-colored wind arrows.
- [ParticleLayer](/docs/modules/geo-layers/api-reference/particle-layer) animates fading trails
  through a geographic wind field.
- [ElevationLayer](/docs/modules/geo-layers/api-reference/elevation-layer) turns the original
  grayscale elevation map into illuminated, vertically exaggerated 3D terrain.
- [DelaunayCoverLayer](/docs/modules/geo-layers/api-reference/delaunay-cover-layer) renders the
  elevation-colored station triangulation.
- [DelaunayInterpolation](/docs/modules/geo-layers/api-reference/delaunay-interpolation) samples
  or rasterizes time-varying station measurements without WebGL-only transforms.
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
