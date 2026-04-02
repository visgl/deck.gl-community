# Overview


![deck.gl v9](https://img.shields.io/badge/deck.gl-v9-green.svg?style=flat-square")
![WebGPU not supported](https://img.shields.io/badge/webgpu-no-red.svg?style=flat-square")

This module provides a suite of geospatial layers for [deck.gl](https://deck.gl).

:::danger
The deck.gl-community repo is specifically set up to collect useful code that no longer has dedicated maintainers. This means that there is often no one who can respond quickly to issues. The vis.gl / Open Visualization team members who try to keep this running can only put a few hours into it every now and then. It is important to understand this limitation. If your project depends on timely fixes, and you are not able to contribute them yourself, deck.gl-community modules may not be the right choice for you.
:::

## Installation

```bash
npm install @deck.gl-community/geo-layers
```

## Background

This modules exports various geospatial deck.gl layers developed by the community that could be of use to others.

## API Reference

- [Tile2DLayer](./api-reference/tile-2d-layer)
- [Tile2DTileset](./api-reference/tile-2d-tileset)
- [TileSourceLayer](./api-reference/tile-source-layer)
- [GlobalGridLayer](./api-reference/global-grid-layer)
- [GlobalGrid](./api-reference/global-grid)

## Examples

- [Shared Tileset](/examples/geo-layers/shared-tile-cockpit) demonstrates one shared loaders.gl `TileSource` feeding multiple `Tile2DLayer`s across multiple views.
  It also shows shared `Tile2DTileset` cache stats rendered through `Tile2DTileset.stats`.
