# Get Started

## Installing

```sh
yarn add @deck.gl/core @deck.gl-community/basemap-layers @deck.gl-community/geo-layers@~9.4.2
```

## Using in deck.gl

To use `BasemapLayer` in a deck application:

```ts
import {Deck} from '@deck.gl/core';
import {BasemapLayer} from '@deck.gl-community/basemap-layers';
import styleJson from '../../../website/static/mapstyle/deck-light.json';

new Deck({
  layers: [
    new BasemapLayer({
      id: 'basemap',
      mode: 'map',
      style: styleJson
    })
  ]
});
```

For globe rendering, switch `mode` to `'globe'` and pass optional globe config:

```ts
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
});
```

## Main Exports

- `BasemapLayer`
- `getBasemapLayers`
- `getGlobeBaseLayers`
- `getGlobeTopLayers`
- `resolveBasemapStyle`

The separate map-style helpers are exported from `@deck.gl-community/basemap-layers/map-style`.

## Local Development

```sh
yarn
yarn --cwd modules/basemap-layers test
yarn lint
```

## Compare with MapLibre

The [split view example](/examples/basemap-layers/split-view) renders the same
OpenFreeMap vector style with `BasemapLayer` and MapLibre GL JS side by side.
Interacting with either pane synchronizes pan, zoom, bearing, and pitch. Use the
shared style selector to compare Liberty, Positron, and Dark.
