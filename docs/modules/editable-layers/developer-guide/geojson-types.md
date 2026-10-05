# GeoJSON types

Editable-layers uses Turf.js 7 and the standard GeoJSON types from the `geojson` package.
Import standard types directly from `geojson`; the editable-layers entry point exports
types that describe its supported editing data and events.

## Supported editing geometries

Editable data contains Point, LineString, Polygon and their Multi geometries.
`GeometryCollection` is not supported: it contains `geometries`, while editable
geometries expose `coordinates`.

The package exports:

- `SimpleGeometry`: the union of supported geometries.
- `SimpleFeature` and `SimpleFeatureCollection`: features and collections of supported geometries.
- `SimpleGeometryCoordinates`: the coordinates of a supported geometry.
- `PolygonGeometry`: Polygon or MultiPolygon.

Use these types when building custom edit modes:

```ts
import {GeoJsonEditMode} from '@deck.gl-community/editable-layers';
import type {
  ClickEvent,
  ModeProps,
  SimpleFeatureCollection
} from '@deck.gl-community/editable-layers';

export class MyEditMode extends GeoJsonEditMode {
  handleClick(event: ClickEvent, props: ModeProps<SimpleFeatureCollection>): void {
    // Custom editing logic.
  }
}
```

## Standard GeoJSON types

Import `Position`, individual geometry types, `Feature`, and `FeatureCollection`
from `geojson`. Geometry and property generics remain available:

```ts
import type {Feature, FeatureCollection, Point, Position} from 'geojson';
import type {SimpleFeatureCollection} from '@deck.gl-community/editable-layers';

const position: Position = [0, 0];
const feature: Feature<Point, {name: string}> = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: position},
  properties: {name: 'My point'}
};
const geoJsonData: FeatureCollection<Point, {name: string}> = {
  type: 'FeatureCollection',
  features: [feature]
};
const editableData: SimpleFeatureCollection = geoJsonData;
```

See the [public export migration](/docs/upgrade-guide#public-export-cleanup) for the
removed aliases and general-purpose helper exports.
