---
deckVersion: "10.0"
introduced: "9.0"
---

# Overview

This module provides a suite of reusable layers for [deck.gl](https://deck.gl).
The layers in this module are generic primitives that are intended to be usable in both geospatial and non-geospatial visualizations.

:::caution
The deck.gl-community repository is semi-maintained. One of its goals is to collect and preserve valuable deck.gl ecosystem related code that does not have a dedicated home. Some modules may no longer have dedicated maintainers. This means that there is sometimes no one who can respond quickly to issues.
:::

## Installation

```bash
npm install @deck.gl-community/layers
```

## Package entry points

| Import path | Use it for |
| --- | --- |
| `@deck.gl-community/layers/common-layers` | [Animation](./api-reference/animation-layer.md), [blocks](./api-reference/block-layer.md), [fast text](./api-reference/fast-text-layer.md), orthographic view helpers, paths, markers, [edge markers](./api-reference/edge-marker-layer.md) (experimental), skybox, Gaussian splats, flame trails, volumetric video, and selection pulse |
| `@deck.gl-community/layers/geo-layers` | [Geospatial tile layers](../geo-layers/README.md) and shared tilesets |
| `@deck.gl-community/layers/global-grid-layers` | [Global grid rendering and grid systems](../geo-layers/api-reference/global-grid.md) |
| `@deck.gl-community/layers/effects` | [Scene buffers and shader passes](./api-reference/effect-layers.md#scene-effects) |
| `@deck.gl-community/layers/wind-layers` | [Wind layers and station-data utilities](../geo-layers/developer-guide/wind-showcase.md) |
| `@deck.gl-community/layers/tree-layers` | [Procedural trees and crops](./api-reference/tree-layer.md) |
| `@deck.gl-community/layers/timeline-layers` | [Horizon graphs, timelines, and time axes](../timeline-layers/README.md) |
| `@deck.gl-community/layers/wind-layers/wind-effect` | [Scene wind and WindExtension](./api-reference/wind-effect.md) |
| `@deck.gl-community/layers/source-layers` | [SourceLayer](./api-reference/source-layer.md) and specialized layers for loaders.gl image, vector, raster, point cloud, and tiled data sources |
| `@deck.gl-community/layers/splat-layers` | [Gaussian splat layers and source utilities](./api-reference/splat-layer.md) |

The package root also exports the common layers and tree renderer. The geo overview lists
the application-installed dependencies for the H3 and A5 adapters and the wind layers.


Community layer extensions are available from `@deck.gl-community/layers/extensions`, including
[SelectionPulseExtension](./api-reference/selection-pulse-extension.md) and
[ZoomOpacityExtension](./api-reference/zoom-opacity-extension.md).


## Examples

- [FlameTrailLayer](/examples/layers/flame-trail)
- [EdgeMarkerLayer](/examples/layers/edge-markers)
- [VolumetricVideoLayer](/examples/layers/volumetric-video)
- [Path outline, marker, and dependency arrow](/examples/layers/path-outline-and-markers)
- [SkyboxLayer MapView](/examples/layers/skybox-map-view)
- [SkyboxLayer GlobeView](/examples/layers/skybox-globe)
- [SkyboxLayer FirstPersonView](/examples/layers/skybox-first-person)
