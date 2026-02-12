# GeoJSON types
The `editable-layers` module uses Turf.js 7, which in turn uses standard types from the `geojson` package for features, geometries, etc.

## SimpleGeometry types
Editable layers operate on `FeatureCollection`s that contain `Feature`s with any [standard geojson geometry](https://datatracker.ietf.org/doc/html/rfc7946#section-3.1) __except__ `GeometryCollection` (which has a `geometries` property instead of `geometry`)

To simplify working with the library in TypeScript, the package exports a `SimpleGeometry` type (a union of all geometries except `GeometryCollection`), as well `SimpleFeature`, `SimpleFeatureCollection`, and `SimpleCoordinates`.

These are useful when building your own editing modes:

```ts
import { GeoJsonEditMode, SimpleFeatureCollection, ModeProps } from '@deck.gl-community/editable-layers';

export class MyEditMode extends GeoJsonEditMode {
  handleClick(event: ClickEvent, props: ModeProps<SimpleFeatureCollection>) {
    // custom logic here
  }
}
```