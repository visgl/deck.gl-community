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

## Layers

### [GlobalClusterLayer](./api-reference/global-cluster-layer.md)

A composite layer that clusters points and displays them with text-based count labels. Provides full support for both 2D maps and 3D globe projections with dynamic clustering adjustments.

- Automatic clustering using Supercluster algorithm
- Dynamic text labels showing actual cluster counts
- Globe support with FOV-based visibility filtering
- Optional dynamic clustering for accurate counts as viewport changes
- Visual scaling with `sizeByCount` option

### [GlobalGridLayer](./api-reference/global-grid-layer.md)

A layer for rendering global grid systems (H3, S2, Geohash, A5, Quadkey).

## Background

This modules exports various geospatial deck.gl layers developed by the community that could be of use to others.
