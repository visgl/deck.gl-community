# Get Started

## Installing

```sh
yarn add @deck.gl/core @deck.gl-community/basemap-layers
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
- `generateLayers`

The pure style helpers are exported from `@deck.gl-community/basemap-layers/style-spec`.

## Local Development

```sh
yarn
yarn --cwd modules/basemap-layers test
yarn lint
```
