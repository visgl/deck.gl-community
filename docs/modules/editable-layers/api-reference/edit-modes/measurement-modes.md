# Measurement Modes

![From v9.0](https://img.shields.io/badge/from-v9.0-green.svg?style=flat-square)

A number of modes provide various measurement capabilities

## MeasureDistanceMode

Measure a path by clicking points. Set these options in `modeConfig`:

- `turfOptions` (Object, optional): `units` selects geographic output units
  ([supported units](https://turfjs.org/docs/api/distance); default `'kilometers'`).
- `formatTooltip` (Function, optional): formats the cumulative path distance.
  Default: two decimal places followed by the units.
- `measurementCallback` (Function, optional): receives each calculated segment distance,
  including live pointer measurements.
- `centerTooltipsOnLine` (Boolean, default `false`): places tooltips at segment midpoints.

For meters:

```ts
modeConfig: {turfOptions: {units: 'meters'}}
```

### Coordinate units

Tooltips, formatters, and callbacks use the selected geographic units. Cartesian distances
remain in native units with the default label `units`; `turfOptions.units` does not convert
or relabel them. Use `formatTooltip` for custom labels.

Custom `EditModeCoordinateSystem` implementations can declare `readonly distanceUnits` as
`'kilometers'` to enable output conversion; `'native'` or omitted metadata preserves native
values. This describes the units used by `distance()` and `destination()`, without changing
their geometric calculations.

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
