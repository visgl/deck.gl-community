# Transform Modes

An existing geometry can be modified with a variety of modes.

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

The following options can be provided in the `modeConfig` object for TranslateMode:

- `screenSpace` (optional): `<boolean>`
  - If `true`, the features will be translated without distortion in screen space.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/translate-mode.ts)

## TransformMode

A single mode that provides translating, rotating, and scaling capabilities. Translation can be performed by clicking and dragging the selected feature itself. Rotating can be performed by clicking and dragging the top-most edit handle around a centroid pivot. Scaling can be performed by clicking and dragging one of the corner edit handles. Just like the individual modes, this mode supports multiple selections.

Snapping is built into `TransformMode` — it does not need to be wrapped in `SnappableMode`. Enable it with `modeConfig.enableSnapping` and set `modeConfig.viewport` for edge snapping.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/transform-mode.ts)

## DeleteMode

User can delete features by clicking on them. Only the most recently added feature will be deleted if multiple features overlap.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/delete-mode.ts)

## SnappableMode

A wrapper mode that adds snapping behaviour to any other `GeoJsonEditMode`. Construct it by passing the mode you want to enhance:

```ts
import {SnappableMode, TranslateMode} from '@deck.gl-community/editable-layers';

const mode = new SnappableMode(new TranslateMode());
```

Snapping is activated via `modeConfig.enableSnapping`. See the [`modeConfig` documentation](../layers/editable-geojson-layer.md#modeconfig-object-optional) for all available options.

To add snapping support to a custom mode, implement the `SnappableEditMode` interface and return the appropriate strategy:

```ts
import {
  GeoJsonEditMode,
  SnappableEditMode,
  ClickSnappingStrategy
} from '@deck.gl-community/editable-layers';

class MyCustomMode extends GeoJsonEditMode implements SnappableEditMode {
  getSnappingStrategy() {
    return new ClickSnappingStrategy();
  }
}
```

Choose the strategy that matches how your mode is used:

| Strategy | Used by | Behaviour | Notes |
|---|---|---|---|
| `ClickSnappingStrategy` | Draw modes | Snaps the pointer as it moves and updates click events | Requires `modeConfig.viewport` |
| `DragSnappingStrategy` | e.g. `ModifyMode` | Snaps while an edit handle is being dragged | Requires `modeConfig.viewport` |
| `SourceSnappingStrategy` | e.g. `TranslateMode` | Snaps while a snap source handle is being dragged | |

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/snappable-mode.ts)

### Snapping capabilities

The following modes support snapping when wrapped with `SnappableMode`:

- `ModifyMode`
- `ExtrudeMode`
- `TranslateMode`

`TransformMode` supports snapping natively via `modeConfig.enableSnapping` and does not require `SnappableMode`.

