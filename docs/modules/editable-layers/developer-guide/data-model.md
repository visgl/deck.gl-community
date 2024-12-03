# Data Model

The core editable layers are designed to work with GeoJSON style "features". The basic structure of each row in a table is:

```ts
type Feature = {
  type: 'Feature',
  geometry: {type: '...', coordinates: [...]},
  properties: {
    [columnName: string]
  }
}

## Geometry

## Properties

In general, the properties field in a feature is used to store the non-geometry column values for the row.


## Edit Properties

The editable-layers framework adds certain properties

### `properties.editProperties`

this is an object that contain shape specific properties, consult each edit mode for detailed documentation

### `properties.shape` (deprecated)

The layer stores the type of shape represented by a feature in the `properties.shape` field.

`properties.shape` is now deprecated and replaced by `properties.editProperties.shape`
