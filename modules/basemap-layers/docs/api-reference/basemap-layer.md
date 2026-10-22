# BasemapLayer

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
</p>

`@deck.gl-community/basemap-layers` exports a runtime API for loading a MapLibre or Mapbox style document and generating deck.gl sublayers from it.

Recommended example:

- [BasemapLayer MapView](/examples/layers/basemap-layer-map-view) for validating the standard 2D `MapView` render path

## Installation

```sh
yarn add @deck.gl-community/basemap-layers @deck.gl-community/geo-layers@~9.4.2
```

## Main Export

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
</p>

```ts
import {BasemapLayer} from '@deck.gl-community/basemap-layers';
```

`BasemapLayer` is a `CompositeLayer` that:

- accepts a style URL or parsed style object
- resolves TileJSON-backed sources, and fetches the data of GeoJSON sources given by URL
- cuts GeoJSON sources into vector tiles on the client, in a web worker
- generates `background`, `fill`, `line`, `symbol`, and `raster` sublayers
- supports both flat map rendering and globe rendering

## Props

### `style`

Type: `string | BasemapStyle | null`

The style document to render. Pass either:

- a URL string pointing to a style JSON document
- an in-memory MapLibre/Mapbox style object

### `mode`

Type: `'map' | 'globe'`

Controls whether the generated sublayers are optimized for a flat map or a globe. Defaults to `'map'`.

### `loadOptions`

Type: `BasemapLoadOptions | null`

Optional loader configuration used by `resolveBasemapStyle`. This can include:

- `baseUrl` for resolving relative URLs in in-memory styles
- `fetch` for a custom fetch implementation
- `fetchOptions` to customize network requests

### `globe`

Type: `{config?: BasemapGlobeConfig}`

Optional globe-specific toggles:

- `atmosphere`: enable atmosphere overlay helpers
- `basemap`: enable the main globe basemap geometry
- `labels`: enable symbol-label rendering on the globe path

### `separateLabelPlacement`

Type: `boolean`

By default (`false`), the labels of every `BasemapLayer` in a deck are placed together, as the layers of one style: a label is hidden where it overlaps a label placed before it, and the labels of a `BasemapLayer` drawn later (later in the `layers` array) are placed first. Stacking a base style and a labels-only style this way does not draw their labels over each other. Set `true` to place this layer's labels on their own, so that they collide only with each other and never hide, or are hidden by, those of another `BasemapLayer`.

The shared placement takes the `labelPlacementInterval` of the last `BasemapLayer` rendered: give layers that share it the same interval.

## Runtime Helpers

### `getBasemapLayers(options)`

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
</p>

Generates the deck.gl sublayers for an already-resolved style definition. Use this when you want the sublayers without creating a `BasemapLayer` instance.

`BasemapLayer` keeps each source's tiles in a shared tileset across renders. A direct caller that calls `getBasemapLayers` on every render keeps them by passing its own `tilesets` map, keyed by source, and finalizes those tilesets when done.

### `createDemTileset(source, loadOptions?)`

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
</p>

Creates the shared tileset of a `raster-dem` source, for the `tilesets` map of `getBasemapLayers`: each tile is fetched and decoded once for all of the source's `hillshade` layers. The caller finalizes it.

### `getGlobeBaseLayers(options)`

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
</p>

Convenience wrapper around `getBasemapLayers` that forces `mode: 'globe'`.

### `getGlobeTopLayers(options)`

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
</p>

Returns the globe overlay layers that should render after the base globe content.

### `resolveBasemapStyle(style, loadOptions?)`

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
</p>

Loads and normalizes a style document. This resolves:

- remote style JSON URLs
- TileJSON-backed source definitions
- GeoJSON source `data` URLs, fetched into the source's `data`
- relative tile template URLs
- legacy Mapbox `ref` layer inheritance

## Example

```ts
import {Deck, _GlobeView} from '@deck.gl/core';
import {BasemapLayer} from '@deck.gl-community/basemap-layers';
import styleJson from '../../../../website/static/mapstyle/deck-light.json';

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

For a flat-map reference implementation that avoids globe-specific behavior, see the [BasemapLayer MapView example](/examples/layers/basemap-layer-map-view).
