# Style Parser

The pure style helpers are exported from:

```ts
import {
  filterFeatures,
  findFeaturesStyledByLayer,
  parseProperties
} from '@deck.gl-community/basemap-layers/style-spec';
```

These helpers do not create deck.gl layers. They only evaluate and filter style-spec data.

## `filterFeatures({features, filter, globalProperties})`

Applies a Mapbox style-spec filter expression to a feature array.

Use this when you already have decoded features and want to apply a style-layer filter expression in user space.

## `findFeaturesStyledByLayer({features, layer, globalProperties})`

Looks up features for a specific `source` and `source-layer` combination and then applies the style layer's filter.

This helper expects features grouped as:

```ts
{
  [sourceName]: {
    [sourceLayerName]: Feature[]
  }
}
```

## `parseProperties(layer, globalProperties)`

Evaluates the paint properties for a style layer at the requested zoom level and returns them as plain JavaScript values.

This is useful when you want to interpret style expressions without rendering through `BasemapLayer`.
