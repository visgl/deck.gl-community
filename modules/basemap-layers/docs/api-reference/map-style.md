# `map-style` Export

The map-style helpers are exported from the separate package entrypoint:

```ts
import {
  BasemapStyleSchema,
  filterFeatures,
  findFeaturesStyledByLayer,
  MapStyleLoader,
  parseProperties,
  resolveBasemapStyle,
  ResolvedBasemapStyleSchema
} from '@deck.gl-community/basemap-layers/map-style';
```

This entrypoint is intentionally separate from the runtime `@deck.gl-community/basemap-layers` export.

Use `@deck.gl-community/basemap-layers/map-style` when you want map-style validation, resolution, loaders.gl integration, or pure style-expression helpers without constructing `BasemapLayer`.

## Exports

- `filterFeatures`
- `findFeaturesStyledByLayer`
- `parseProperties`
- `resolveBasemapStyle`
- `MapStyleLoader`
- `BasemapSourceSchema`
- `BasemapStyleLayerSchema`
- `BasemapStyleSchema`
- `ResolvedBasemapStyleSchema`

## Zod Schemas

The Zod schemas validate the public map-style data structures and provide strongly typed parsed output:

- `BasemapSourceSchema`
- `BasemapStyleLayerSchema`
- `BasemapStyleSchema`
- `ResolvedBasemapStyleSchema`

```ts
const parsed = BasemapStyleSchema.parse(styleJson);
```

Use `ResolvedBasemapStyleSchema` when validating the result of `resolveBasemapStyle` or `MapStyleLoader`.

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

## `resolveBasemapStyle(style, loadOptions?)`

Resolves a style URL or in-memory style document into a fully normalized style definition:

- validates the input style shape
- fetches the top-level style document when given a URL
- resolves TileJSON-backed sources
- normalizes relative URLs against the style URL or provided `baseUrl`
- returns a `ResolvedBasemapStyle`

If you want a loaders.gl-compatible wrapper around the same behavior, use [`MapStyleLoader`](./map-style-loader).
