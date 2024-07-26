# Draw Modes

`EditMode`s provide a way of handling user interactions in order to manipulate GeoJSON features and geometries.

## Draw configuration options

Note that for all polygon drawing modes, the following options can also be provided in the `modeConfig` object:

- `booleanOperation` (optional): `null|'union'|'difference'|'intersection'`
  - If non-null, requires a single `Polygon` or `MultiPolygon` selection
  - If `null`, the drawn `Polygon` is added as a new feature regardless of selection
  - If `union`, the drawn `Polygon` is unioned with the selected geometry
  - If `difference`, the drawn `Polygon` is subtracted from the selected geometry
  - If `intersection`, the drawn `Polygon` is intersected with the selected geometry

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

The following options can be provided in the `modeConfig` object:

- `overrideWithShift` (optional): `boolean`
  - If `true`, it is possible to unlock from right angle temporarily by holding the shift key.

## DrawPolygonByDraggingMode

User can draw a new `Polygon` feature by dragging (similar to the lasso tool commonly found in photo editing software).

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/draw-polygon-by-dragging-mode.ts)

The following options can be provided in the `modeConfig` object:

- `throttleMs` (optional): `number`
  - If provided, the dragging function will be throttled by the specified number of milliseconds.

## DrawRectangleMode

User can draw a new rectangular `Polygon` feature by clicking two opposing corners of the rectangle.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/draw-rectangle-mode.ts)

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
