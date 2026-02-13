# Data Model

Editable layers work with [GeoJSON](https://tools.ietf.org/html/rfc7946) `FeatureCollection` data. The layer reads and writes standard GeoJSON — no proprietary format.

## FeatureCollection

The `data` prop on `EditableGeoJsonLayer` expects a GeoJSON `FeatureCollection`:

```ts
const data = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [-122.43, 37.77]},
      properties: {name: 'My Point'}
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[-122.45, 37.78], [-122.47, 37.76], [-122.43, 37.75], [-122.45, 37.78]]]
      },
      properties: {name: 'My Polygon'}
    }
  ]
};
```

## Geometry Types

All standard GeoJSON geometry types are supported:

| Type               | Description                      | Draw Mode                        |
| ------------------ | -------------------------------- | -------------------------------- |
| `Point`            | Single coordinate                | `DrawPointMode`                  |
| `LineString`       | Ordered list of coordinates      | `DrawLineStringMode`             |
| `Polygon`          | Closed ring(s) of coordinates    | `DrawPolygonMode`, `DrawRectangleMode`, `DrawCircleFromCenterMode`, etc. |
| `MultiPoint`       | Collection of points             | —                                |
| `MultiLineString`  | Collection of line strings       | —                                |
| `MultiPolygon`     | Collection of polygons           | Created automatically via boolean operations |

`GeometryCollection` is **not** supported. If you import GeoJSON containing `GeometryCollection` features, convert them to `Multi*` types first.

## Properties

The `properties` object on each feature stores arbitrary metadata. Editable layers do not modify or depend on user-defined properties — they are passed through untouched during edits.

```ts
{
  type: 'Feature',
  geometry: { ... },
  properties: {
    name: 'Building A',
    category: 'commercial',
    area_sqm: 1250
  }
}
```

## Edit Properties

The editable-layers framework adds shape-specific metadata under `properties.editProperties`. This is populated automatically by draw modes that create circles, ellipses, and rectangles.

### `properties.editProperties`

An object containing information about how the feature was drawn:

```ts
{
  type: 'Feature',
  geometry: {type: 'Polygon', coordinates: [/* ... circle approximation */]},
  properties: {
    editProperties: {
      shape: 'Circle',
      center: [-122.43, 37.77],
      radius: 500
    }
  }
}
```

Fields vary by shape:

| Shape       | Fields                                          |
| ----------- | ----------------------------------------------- |
| `Circle`    | `center`, `radius`                              |
| `Rectangle` | `center`, `width`, `height`                     |
| `Ellipse`   | `center`, `semiMajorAxis`, `semiMinorAxis`, `angle` |

### `properties.shape` (deprecated)

In versions prior to v9.1, the shape type was stored directly in `properties.shape`. This is deprecated — use `properties.editProperties.shape` instead.

## Immutable Updates

When the `onEdit` callback fires, `updatedData` is a **new** `FeatureCollection` object. The layer uses `ImmutableFeatureCollection` internally to produce efficient structural-sharing updates — only the modified features are new objects; unmodified features retain their original references.

```tsx
onEdit: ({updatedData, editType}) => {
  // updatedData is a new FeatureCollection
  // Unmodified features are the same object references
  setFeatures(updatedData);
}
```

This means you can use reference equality checks (e.g., `React.memo`, `useMemo`) to avoid unnecessary re-renders on unmodified features.
