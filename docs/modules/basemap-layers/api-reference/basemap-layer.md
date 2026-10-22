import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# BasemapLayer

<LayerLiveExample highlight="basemap-layer" />

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

### `fontFamily`

Type: `string | ((fontStack: string[]) => string | Partial<LabelFont> | null) | null`

Draws labels with the browser's fonts instead of the style's `glyphs`. By default, labels are
drawn with the style's glyphs, and a style without `glyphs` maps each symbol layer's `text-font`
to a CSS font (see [Label fonts](/docs/modules/basemap-layers#label-fonts)). Defaults to `null`.

- A string replaces the CSS family list for every label. The weight and style still come from
  `text-font`. `'Monaco, monospace'` restores the font used before `text-font` was read.
- A function receives the evaluated `text-font` names, such as `['Noto Sans Bold']`, and returns a
  CSS family list, or an object with any of `fontFamily`, `fontWeight` (100-900) and `fontStyle`
  (`'normal'` or `'italic'`). Fields it leaves out, and a `null` result, keep the mapped values.
  Pass a stable function: tiles regenerate when it changes.

`getBasemapLayers` and `getGlobeBaseLayers` accept the same `fontFamily` option, and a `glyphs`
option, a `GlyphStore` of the style's `glyphs` URL, to draw labels with the style's glyphs.

### `globe`

Type: `{config?: BasemapGlobeConfig}`

Optional globe-specific toggles:

- `atmosphere`: enable atmosphere overlay helpers
- `basemap`: enable the main globe basemap geometry
- `labels`: enable symbol-label rendering on the globe path

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
