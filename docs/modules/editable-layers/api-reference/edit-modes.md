# Editor Modes

`EditMode`s provide a way of handling user interactions in order to manipulate GeoJSON features and geometries.

The following built-in `EditMode`s are provided by:

## ViewMode

No edits are possible, but selection is still possible.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/view-mode.ts)

## ModifyMode

User can move existing points, add intermediate points along lines, and remove points.

The following options can be provided in the `modeConfig` object for ModifyMode:

- `lockRectangles` (optional): `<boolean>`
  - If `true`, features with `properties.shape === 'Rectangle'` will preserve rectangular shape.

Callbacks:

`editContext` argument to the `onEdit` callback contains the following properties:

- `positionIndexes` (Array): An array of numbers representing the indexes of the edited position within the feature's `coordinates` array

- `position` (Array): An array containing the ground coordinates (i.e. [lng, lat]) of the edited position

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/modify-mode.ts)


## ExtrudeMode

User can move edge. Click and drag from anywhere between 2 points in edge.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/extrude-mode.ts)


## ScaleMode

User can scale a feature about its centroid by clicking and dragging (inward or outward) the selected geometry. This mode supports multiple selections.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/scale-mode.ts)

## RotateMode

User can rotate a feature about its centroid by clicking and dragging the selected geometry. This mode supports multiple selections.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/rotate-mode.ts)

## TranslateMode

The user can move a feature by selecting one or more features and dragging anywhere within the screen.
_Additionally, the user can initiate snapping by clicking and dragging the selected feature's vertex handles. If the vertex handle is close enough to another feature's vertex, the two features will snap together._
The following options can be provided in the `modeConfig` object for TranslateMode:

- `screenSpace` (optional): `<boolean>`
  - If `true`, the features will be translated without distortion in screen space.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/translate-mode.ts)

## TransformMode

A single mode that provides translating, rotating, and scaling capabilities. Translation can be performed by clicking and dragging the selected feature itself. Rotating can be performed by clicking and dragging the top-most edit handle around a centroid pivot. Scaling can be performed by clicking and dragging one of the corner edit handles. Just like the individual modes, this mode supports multiple selections and feature snapping.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/transform-mode.ts)

## DuplicateMode

User can duplicate and translate a feature by clicking selected feature and dragging anywhere on the screen.
This mode is extends TranslateMode. This mode supports multiple selections.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/duplicate-mode.ts)

## DrawPointMode

User can draw a new `Point` feature by clicking where the point is to be.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/draw-point-mode.ts)

## DrawLineStringMode

User can draw a new `LineString` feature by clicking positions to add. User finishes drawing by double-clicking.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/draw-line-string-mode.ts)

## ExtendLineStringMode

User can extend an existing `LineString` feature by clicking positions to add. A single `LineString` feature must be selected for this mode.

The following options can be provided in the `modeConfig` object:

- `drawAtFront` (optional): `<boolean>`
  - If `true`, will extend from the "beginning" of the line, i.e. relative to the start of the coordinates array.

Callback parameters

`editContext` argument to the `onEdit` callback contains the following properties:

- `positionIndexes` (Array): An array of numbers representing the indexes of the added position within the feature's `coordinates` array

- `position` (Array): An array containing the ground coordinates (i.e. [lng, lat]) of the added position

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/extend-line-string-mode.ts)

## ResizeCircleMode

User can resize an existing circular Polygon feature by clicking and dragging along the ring.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/resize-circle-mode.js)

## DrawPolygonMode

User can draw a new `Polygon` feature by clicking positions to add then closing the polygon (or double-clicking).

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/draw-polygon-mode.js)

The following options can be provided in the `modeConfig` object:

- `preventOverlappingLines` (optional): `boolean`
  - If `true`, it will not be possible to add a polygon point if the current line overlaps any other lines on the same polygon.

Callback parameters

`editContext` argument to the `onEdit` callback contains the following properties:

- `positionIndexes` (Array): An array of numbers representing the indexes of the added position within the feature's `coordinates` array

- `position` (Array): An array containing the ground coordinates (i.e. [lng, lat]) of the added position

## Draw90DegreePolygonMode

User can draw a new `Polygon` feature with 90 degree corners (right angle) by clicking positions to add then closing the polygon (or double-clicking). After clicking the 2 points, the draw mode guides/allows to have right angle polygon.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/draw-90degree-polygon-mode.ts)

## DrawPolygonByDraggingMode

User can draw a new `Polygon` feature by dragging (similar to the lasso tool commonly found in photo editing software).

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/draw-polygon-by-dragging-mode.ts)

### ModeConfig

The following options can be provided in the `modeConfig` object:

- `throttleMs` (optional): `number`
  - If provided, the dragging function will be throttled by the specified number of milliseconds.

## DrawRectangleMode

User can draw a new rectangular `Polygon` feature by clicking two opposing corners of the rectangle.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/draw-rectangle-mode.ts)

### ModeConfig

The following options can be provided in the `modeConfig` object:

- `dragToDraw` (optional): `boolean`
  - If `true`, user can click and drag instead of clicking twice. Note however, that the user will not be able to pan the map while drawing.

## DrawRectangleFromCenterMode
User can draw a new rectangular `Polygon` feature by clicking the center then along a corner of the rectangle.

The following options can be provided in the `modeConfig` object:

- `dragToDraw` (optional): `boolean`
  - If `true`, user can click and drag instead of clicking twice. Note however, that the user will not be able to pan the map while drawing.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/draw-rectangle-from-center-mode.ts)

## DrawRectangleUsingThreePointsMode

User can draw a new rectangular `Polygon` feature by clicking three corners of the rectangle.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/draw-rectangle-using-three-points-mode.ts)

## DrawSquareMode

User can draw a new square-shaped `Polygon` feature by clicking two opposing corners of the square.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/draw-square-mode.ts)

## DrawSquareFromCenterMode

User can draw a new square-shaped `Polygon` feature by clicking the center and then along one of the corners of the square.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modesdraw-square-from-center-mode..ts)

The following options can be provided in the `modeConfig` object:

- `dragToDraw` (optional): `boolean`
  - If `true`, user can click and drag instead of clicking twice. Note however, that the user will not be able to pan the map while drawing.

## DrawCircleFromCenterMode

User can draw a new circular `Polygon` feature by clicking the center then along the ring.

The following options can be provided in the `modeConfig` object:

- `steps` (optional): `x <number>`
  - If steps: `x` means the circle will be drawn using `x` number of points.
- `dragToDraw` (optional): `boolean`
  - If `true`, user can click and drag instead of clicking twice. Note however, that the user will not be able to pan the map while drawing.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modesdraw-circle-from-center-mode..ts)

## DrawCircleByDiameterMode

User can draw a new circular `Polygon` feature by clicking the two ends of its diameter.

The following options can be provided in the `modeConfig` object:

- `steps` (optional): `x <number>`
  - If steps: `x` means the circle will be drawn using `x` number of points.
- `dragToDraw` (optional): `boolean`
  - If `true`, user can click and drag instead of clicking twice. Note however, that the user will not be able to pan the map while drawing.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modesdraw-circle-by-diameter-mode..ts)

## DrawEllipseByBoundingBoxMode

User can draw a new ellipse shape `Polygon` feature by clicking two corners of bounding box.

### ModeConfig

The following options can be provided in the `modeConfig` object:

- `dragToDraw` (optional): `boolean`
  - If `true`, user can click and drag instead of clicking twice. Note however, that the user will not be able to pan the map while drawing.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/draw-ellipse-by-bounding-box-mode.ts)

## DrawEllipseUsingThreePointsMode

User can draw a new ellipse shape `Polygon` feature by clicking center and two corners of the ellipse.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/draw-ellipse-using-three-points-mode.ts)

## SplitPolygonMode

User can split a polygon by drawing a new `LineString` feature on top of the polygon.

- If the first and the last click is outside the polygon, it will split the polygon

- If the clicked position is inside the polygon, it will not split the polygon

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/split-polygon-mode.ts)

## MeasureDistanceMode

User can measure a distance between two points.

The following options can be provided in the `modeConfig` object:

- `turfOptions` (Object, optional)

  - `options` object passed to turf's [distance](https://turfjs.org/docs/#distance) function
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

## Composite Mode

Use `CompositeMode` to combine multiple modes.
_Not all combinations are guaranteed to work._

`new CompositeMode(modes, options = {})`

- `modes`: `Array<EditMode>` Modes you want to combine. **Order is very important.**
- `options` (optional): Options to be added later.

```
new CompositeMode([new DrawLineStringMode(), new ModifyMode()])
```

## Boolean Operations

For all polygon drawing modes, the following options can be provided in the `modeConfig` object:

- `booleanOperation` (optional): `null|'union'|'difference'|'intersection'`
  - If non-null, requires a single `Polygon` or `MultiPolygon` selection
  - If `null`, the drawn `Polygon` is added as a new feature regardless of selection
  - If `union`, the drawn `Polygon` is unioned with the selected geometry
  - If `difference`, the drawn `Polygon` is subtracted from the selected geometry
  - If `intersection`, the drawn `Polygon` is intersected with the selected geometry
