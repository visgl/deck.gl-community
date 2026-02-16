# Configuration

`EditableGeoJsonLayer` is configured through its props. The two most important are `mode` (what the user can do) and `modeConfig` (how the mode behaves).

## Edit Modes

Set the `mode` prop to control what editing interaction is active. Pass the mode class directly — do not instantiate it:

```tsx
import {DrawPolygonMode, EditableGeoJsonLayer} from '@deck.gl-community/editable-layers';

new EditableGeoJsonLayer({
  data: featureCollection,
  mode: DrawPolygonMode,
  selectedFeatureIndexes: [0],
  onEdit: ({updatedData}) => setFeatures(updatedData)
});
```

### Mode Categories

| Category    | Modes                                                                                                  | Purpose                      |
| ----------- | ------------------------------------------------------------------------------------------------------ | ---------------------------- |
| View        | `ViewMode`                                                                                             | Selection only, no editing   |
| Draw        | `DrawPointMode`, `DrawLineStringMode`, `DrawPolygonMode`, `DrawRectangleMode`, `DrawCircleFromCenterMode`, `DrawCircleByDiameterMode`, `DrawSquareMode`, `DrawEllipseByBoundingBoxMode`, `Draw90DegreePolygonMode`, `DrawPolygonByDraggingMode`, and more | Create new geometry           |
| Transform   | `ModifyMode`, `TranslateMode`, `RotateMode`, `ScaleMode`, `TransformMode`, `ExtrudeMode`              | Modify existing geometry      |
| Measure     | `MeasureDistanceMode`, `MeasureAreaMode`, `MeasureAngleMode`                                           | Measure distances and areas   |
| Other       | `DeleteMode`, `DuplicateMode`, `ExtendLineStringMode`, `SplitPolygonMode`, `ElevationMode`            | Specialized operations        |
| Composite   | `CompositeMode`, `SnappableMode`                                                                        | Combine multiple modes        |

See the [Edit Modes API reference](/docs/modules/editable-layers/api-reference/edit-modes/core-modes) for full documentation of each mode.

## Mode Config

The `modeConfig` prop passes options to the active mode. Different modes accept different options.

### Boolean Operations

Draw modes support boolean operations on selected polygons:

```tsx
new EditableGeoJsonLayer({
  mode: DrawPolygonMode,
  modeConfig: {booleanOperation: 'difference'},
  selectedFeatureIndexes: [0],
  // ...
});
```

| Value            | Effect                                                 |
| ---------------- | ------------------------------------------------------ |
| `null`           | Default — drawn polygon is added as a new feature.     |
| `'union'`        | Drawn polygon is merged with the selected geometry.    |
| `'difference'`   | Drawn polygon is subtracted from the selected geometry.|
| `'intersection'` | Only the overlapping area is kept.                     |

Requires a single `Polygon` or `MultiPolygon` to be selected.

### Draw Mode Options

Many draw modes accept:

- `dragToDraw` (`boolean`) — Click-and-drag instead of click-click. Disables map panning while drawing.
- `steps` (`number`) — Number of points used to approximate circles/ellipses.
- `throttleMs` (`number`) — Throttle interval for `DrawPolygonByDraggingMode`.

### Polygon Validation

`DrawPolygonMode` accepts:

- `allowSelfIntersection` (`boolean`, default `false`) — Whether self-intersecting polygons are allowed.
- `allowHoles` (`boolean`, default `false`) — Whether drawing inside an existing polygon creates a hole.

### Transform Mode Options

- `screenSpace` (`boolean`) — If `true`, `TranslateMode` moves features in screen space without distortion.
- `lockRectangles` (`boolean`) — If `true`, `ModifyMode` preserves rectangular shapes when editing vertices.

### Measurement Options

All measurement modes accept:

- `formatTooltip` (`(value: number) => string`) — Custom formatter for the tooltip.
- `measurementCallback` (`(value: number) => void`) — Callback for programmatic access to measurements.
- `turfOptions` (`object`) — Options passed to the underlying turf.js function.

## Selected Features

The `selectedFeatureIndexes` prop controls which features are selected. This affects:

- **Transform modes** — Only selected features can be modified, translated, rotated, or scaled.
- **Boolean operations** — The drawn polygon operates on the selected feature.
- **Visual styling** — Selected features can be styled differently via accessor props.

```tsx
const [selected, setSelected] = useState<number[]>([]);

<DeckGL
  onClick={(info) => {
    if (info?.index >= 0) {
      setSelected([info.index]);
    } else {
      setSelected([]);
    }
  }}
/>
```

## Callbacks

### `onEdit`

The primary callback. Fires on every edit action with the updated data:

```tsx
onEdit: ({updatedData, editType, editContext}) => {
  setFeatures(updatedData);
}
```

Common `editType` values:

| editType           | When                                              |
| ------------------ | ------------------------------------------------- |
| `addFeature`       | A new feature was drawn and completed.            |
| `addPosition`      | A vertex was added to a feature being drawn.      |
| `movePosition`     | An existing vertex was dragged to a new position. |
| `removePosition`   | A vertex was removed.                             |
| `finishMovePosition` | A drag operation completed.                     |
| `addHole`          | A hole was created inside a polygon.              |

## Widgets

Use deck.gl widgets for editing UI instead of custom React components:

- **`EditModeTrayWidget`** — Mode selection tray with configurable buttons.
- **`EditorToolbarWidget`** — Boolean operations, clear, export, and feature count.

Widgets are passed to `DeckGL`'s `widgets` prop, not to layers. See the [widget API reference](/docs/modules/editable-layers/api-reference/widgets/edit-mode-tray-widget) for details.
