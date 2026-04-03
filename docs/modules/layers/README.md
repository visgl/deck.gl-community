# Overview

![deck.gl v9](https://img.shields.io/badge/deck.gl-v9-green.svg?style=flat-square")
![WebGPU not supported](https://img.shields.io/badge/webgpu-no-red.svg?style=flat-square")

This module provides a suite of reusable layers for [deck.gl](https://deck.gl).
The layers in this module are generic primitives that are intended to be usable in both geospatial and non-geospatial visualizations.

:::danger
The deck.gl-community repo is specifically set up to collect useful code that no longer has dedicated maintainers. This means that there is often no one who can respond quickly to issues. The vis.gl / Open Visualization team members who try to keep this running can only put a few hours into it every now and then. It is important to understand this limitation. If your project depends on timely fixes, and you are not able to contribute them yourself, deck.gl-community modules may not be the right choice for you.
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
