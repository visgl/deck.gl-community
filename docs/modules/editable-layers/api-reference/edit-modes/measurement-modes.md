# Measurement Modes

![From v9.0](https://img.shields.io/badge/from-v9.0-green.svg?style=flat-square)

A number of modes provide various measurement capabilities

## MeasureDistanceMode

Measure a path by clicking points. Each tooltip shows the cumulative distance from the first point.

The following options can be provided in the `modeConfig` object:

- `turfOptions` (Object, optional)

  - Set `units` to select the output units for geographic measurements, using Turf's
    [distance units](https://turfjs.org/docs/api/distance). The numeric values passed to
    `formatTooltip` and `measurementCallback` use these units, as does the default tooltip.
  - Default: `undefined`; geographic output units default to `'kilometers'`.
  - Native Cartesian measurements are unaffected by this option; see [Coordinate units](#coordinate-units).

- `formatTooltip` (Function, optional)

  - Function to format tooltip text. Its argument is the cumulative path distance in the
    selected output units, or native coordinate units for Cartesian measurements.
  - By default, the distance is rounded to two decimal places and followed by its units.

- `measurementCallback` (Function, optional)

  - Function called with each calculated segment distance in the selected output units, or
    native coordinate units for Cartesian measurements. This is the distance between the
    last clicked point and the current clicked or pointer position, not the cumulative total.
  - Default: `undefined`

- `centerTooltipsOnLine` (Boolean, optional)

  - If true, the measurement tooltips appear on the middle of their respective line segments rather than at the end
  - Default: `false`

For example, measure geographic distances in meters:

```ts
new EditableGeoJsonLayer({
  id: 'measure',
  data: {type: 'FeatureCollection', features: []},
  mode: MeasureDistanceMode,
  modeConfig: {
    turfOptions: {units: 'meters'},
    formatTooltip: distance => `${distance.toFixed(2)} m`,
    measurementCallback: distance => console.log('Segment distance in meters:', distance)
  }
});
```

### Coordinate units

Geographic measurements default to kilometers. With a Cartesian coordinate system, distances
remain in the input coordinates' native units and the default tooltip uses the label `units`.
`turfOptions.units` does not convert or relabel native distances, because a coordinate unit may
represent pixels, meters, or an application-defined scale. Use `formatTooltip` to supply a label
or an application-specific conversion when that scale is known.

Custom `EditModeCoordinateSystem` implementations may declare the optional, read-only
`distanceUnits` property as `'kilometers'` or `'native'`. Declaring `'kilometers'` enables the
same output conversion as `GeoCoordinateSystem`; `'native'` or an omitted property preserves
native values. `CartesianCoordinateSystem` declares `'native'`. These settings describe the
existing units of `distance()` and `destination()`; output conversion does not change their
geometric calculations.

If you worked around [#1015](https://github.com/visgl/deck.gl-community/issues/1015) by multiplying
kilometers in a formatter or callback, remove that conversion when using `turfOptions.units`.
For example, with `units: 'meters'`, both functions now receive meters directly.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/measure-distance-mode.ts)

## MeasureAreaMode

User can measure an area by drawing an arbitrary polygon.

The following options can be provided in the `modeConfig` object:

- `formatTooltip` (Function, optional)

  - Function to format tooltip text (argument is the numeric area)
  - Default: `(distance) => parseFloat(distance).toFixed(2) + units`

- `measurementCallback` (Function, optional)
  - Function to call as measurements are calculated
  - Default: `undefined`

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/measure-area-mode.ts)

## MeasureAngleMode

User can measure an angle by drawing two lines.

The following options can be provided in the `modeConfig` object:

- `formatTooltip` (Function, optional)

  - Function to format tooltip text (argument is the numeric area)
  - Default: `(distance) => parseFloat(angle).toFixed(2) + units`

- `measurementCallback` (Function, optional)
  - Function to call as measurements are calculated
  - Default: `undefined`

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/measure-angle-mode.ts)


## ElevationMode

User can move a point up and down.

The following options can be provided in the `modeConfig` object:

- `minElevation` (Number, optional)

  - The minimum elevation to allow
  - Default: `0`

- `maxElevation` (Number, optional)

  - The maximum elevation to allow
  - Default: `20000`

- `calculateElevationChange` (Function, optional)
  - A function to use to calculate the elevation change in response to mouse movement
  - Default: `10 * <vertical movement in pixels>`
  - Configure to use movement based on viewport:

```javascript
if (mode === 'elevation') {
  modeConfig.calculateElevationChange = (opts) =>
    ElevationMode.calculateElevationChangeWithViewport(viewport, opts);
}
```
[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/elevation-mode.ts)

### Snapping capabilities

The following modes support snapping when wrapped with `SnappableMode`:

- `MeasureDistanceMode`
- `MeasureAreaMode`
- `MeasureAngleMode`
