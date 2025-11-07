# Measurement Modes

A number of modes provide various measurement capabilities

## MeasureDistanceMode

User can measure a distance between two points.

The following options can be provided in the `modeConfig` object:

- `turfOptions` (Object, optional)
  - `options` object passed to turf's [distance](https://turfjs.org/docs/api/distance) function
  - Default: `undefined`

- `formatTooltip` (Function, optional)
  - Function to format tooltip text (argument is the numeric distance)
  - Default: `(distance) => parseFloat(distance).toFixed(2) + units`

- `measurementCallback` (Function, optional)
  - Function to call as measurements are calculated
  - Default: `undefined`

- `centerTooltipsOnLine` (Boolean, optional)
  - If true, the measurement tooltips appear on the middle of their respective line segments rather than at the end
  - Default: `false`

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
