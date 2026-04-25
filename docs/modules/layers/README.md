# Overview

![deck.gl v9](https://img.shields.io/badge/deck.gl-v9-green.svg?style=flat-square")
![WebGPU not supported](https://img.shields.io/badge/webgpu-no-red.svg?style=flat-square")

This module provides a suite of reusable layers for [deck.gl](https://deck.gl).
The layers in this module are generic primitives that are intended to be usable in both geospatial and non-geospatial visualizations.

:::caution
The deck.gl-community repository is semi-maintaned. One of its goals is to collect and preserve valuable deck.gl ecosystem related code that does not have a dedicated home. Some modules may no longer have dedicated maintainers. This means that there is sometimes no one who can respond quickly to issues.
:::

## Installation

```bash
npm install @deck.gl-community/layers
```

## History

Various layers developed by deck.gl maintainers that could be of use to others.

## What's New

### `@deck.gl-community/layers` v0.0.0

Release date: 2023

- `TileSourceLayer`
- `DataDrivenTile3DLayer`
- `SkyboxLayer`

## Exports

- `SkyboxLayer`

<p class="badges">
  <img src="https://img.shields.io/badge/From-v9.3-blue.svg?style=flat-square" alt="From v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="Experimental" />
</p>

## Examples

- [SkyboxLayer MapView](/examples/layers/skybox-map-view)
- [SkyboxLayer GlobeView](/examples/layers/skybox-globe)
- [SkyboxLayer FirstPersonView](/examples/layers/skybox-first-person)
