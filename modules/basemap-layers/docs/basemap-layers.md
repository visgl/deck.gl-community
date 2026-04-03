# basemap-layers

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
</p>

The `@deck.gl-community/basemap-layers` module provides a [deck.gl](https://deck.gl) `BasemapLayer` and supporting helpers for rendering a style-driven basemap with deck.gl sublayers.

In contrast to external basemap integrations such as MapLibre GL, Google Maps, or ArcGIS, `BasemapLayer` is a standard deck.gl `CompositeLayer` subclass. It renders background, raster, vector, and label content using deck.gl layers such as `SolidPolygonLayer`, `MVTLayer`, `TileLayer`, `BitmapLayer`, and `TextLayer`.

Recommended example:

- [BasemapLayer MapView](/examples/layers/basemap-layer-map-view) for the known-good 2D validation path

## What It Exports

From `@deck.gl-community/basemap-layers`:

- `BasemapLayer`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `getBasemapLayers`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `getGlobeBaseLayers`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `getGlobeTopLayers`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `generateLayers`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `resolveBasemapStyle`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />

From `@deck.gl-community/basemap-layers/style-spec`:

- `filterFeatures`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `findFeaturesStyledByLayer`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `parseProperties`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />

## Runtime Model

`BasemapLayer` accepts a style URL or a parsed style object. At runtime it:

1. loads the style definition if needed
2. resolves any TileJSON-backed sources
3. normalizes tile URLs
4. generates deck.gl sublayers for supported style layers

Current runtime support focuses on:

- `background`
- `fill`
- `line`
- `symbol`
- `raster`

This keeps the implementation small and globe-friendly while still covering the main backdrop basemap use cases.

## Why Use It

The `BasemapLayer` approach has both advantages and tradeoffs:

- Notably, it now offers applications that just need a basic basemap the option to do all rendering with deck.gl and avoid external dependencies, potentially leading to smaller bundle sizes and faster application startup.
- Being a true deck.gl layer, it will also support all deck.gl rendering modes, including use with the deck.gl `GlobeView`, which is not supported by any of the existing basemaps.
- It may in some cases render the basemap faster as all rendering is now kept within deck.gl's WebGL context and render loop.
- On the flip side, external basemap libraries are heavily optimized to accelerate map tile loading and are likely to display the first tiles bit faster.

## Goals

A software stack that can render a commercial-quality, world-class basemap is a very complex thing. This module is NOT intended to be a replacement for specialized basemap software. The following goals and non-goals are intended to help set reasonable the expectations for prospective users:

Goals for `BasemapLayer` include:

- **A backdrop basemap** - For the ~90% of deck.gl applications where the key visuals are provided by the remaining deck.gl layers, and the basemap is mainly a “backdrop” that provides visual context.
- **Globe Support** - The `BasemapLayer` works in all deck.gl views, notably in globe mode which is currently not covered by any of the external basemap integrations,
- **Terrain-Adjusted Visualization** - When using 3D basemaps, deck.gl visualizations need to be adjusted to match the terrain. If required, the `BasemapLayer` design will be expanded to support this use case as it is implemented.

Non-goals include:

- Being a complete replacement of a paid basemap for map-critical use cases.
- Full support for map styling
- Full asian character set support
- Perfect label placement
- Matching loading performance of commercial basemap libraries.

Naturally, contributions in the non-goal areas are still welcome.

## Example

```ts
import {Deck, _GlobeView} from '@deck.gl/core';
import {BasemapLayer} from '@deck.gl-community/basemap-layers';
import styleJson from '../../../website/static/mapstyle/deck-light.json';

new Deck({
  views: new _GlobeView(),
  controller: true,
  layers: [
    new BasemapLayer({
      id: 'earth',
      mode: 'globe',
      style: styleJson,
      globe: {
        config: {
          atmosphere: false,
          basemap: true,
          labels: false
        }
      }
    })
  ]
});
```

If you want a flat-map control case before debugging globe mode, start with the [BasemapLayer MapView example](/examples/layers/basemap-layer-map-view).

# Support Concerns

While deck.gl maintainers are very supportive of the `BasemapLayer`, it is kept separate from deck.gl because of concerns that it could become a magnet for a long list of detailed feature requests, clarification discussions and debugging asks from users around the world.

To avoid overwhelming limited support resources this repository is kept separate and clearly marked as not covered by deck.gl maintainers.

## License

MIT License
