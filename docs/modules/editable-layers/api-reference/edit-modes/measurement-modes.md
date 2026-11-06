# Measurement Modes

![From v9.0](https://img.shields.io/badge/from-v9.0-green.svg?style=flat-square)

A number of modes provide various measurement capabilities

## MeasureDistanceMode

Measure a path by clicking points. Configure it with `modeConfig`:

- `turfOptions.units`: geographic distance units (default `'kilometers'`).
- `formatTooltip`: formats cumulative distance (default: two decimals and units).
- `measurementCallback`: receives segment distances, including pointer previews.
- `centerTooltipsOnLine`: places tooltips at segment midpoints (default `false`).

```ts
modeConfig: {
  turfOptions: {
    units: 'meters' // https://turfjs.org/docs/api/types/Units
  }
}
```

### Coordinate units

Cartesian and custom systems retain native units, labeled `units` by default. Custom systems
that return kilometers can enable conversion with `distanceUnits: 'kilometers'`.

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
