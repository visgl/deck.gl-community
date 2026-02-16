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

## ImmutableFeatureCollection

`ImmutableFeatureCollection` is the utility class that edit modes use internally to produce structurally-shared updates. You can also use it directly if you need to build custom edit logic:

```ts
import {ImmutableFeatureCollection} from '@deck.gl-community/editable-layers';

const ifc = new ImmutableFeatureCollection(featureCollection);

// Replace a position within a feature's geometry
const updated = ifc
  .replacePosition(featureIndex, positionIndexes, newPosition)
  .getObject();

// Add a new feature
const withNew = ifc
  .addFeature(newFeature)
  .getObject();

// Remove a feature
const without = ifc
  .deleteFeature(featureIndex)
  .getObject();
```

Key methods:

| Method | Description |
| --- | --- |
| `replacePosition(featureIndex, positionIndexes, position)` | Replace a coordinate within a feature's geometry |
| `removePosition(featureIndex, positionIndexes)` | Remove a coordinate from a feature's geometry |
| `addPosition(featureIndex, positionIndexes, position)` | Insert a coordinate into a feature's geometry |
| `replaceGeometry(featureIndex, geometry)` | Replace a feature's entire geometry |
| `addFeature(feature)` | Append a feature to the collection |
| `deleteFeature(featureIndex)` | Remove a feature from the collection |
| `getObject()` | Return the plain GeoJSON `FeatureCollection` |

Each mutation method returns a **new** `ImmutableFeatureCollection` — the original is never modified.
