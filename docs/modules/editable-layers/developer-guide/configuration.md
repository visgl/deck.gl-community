# Configuration

Editable layers need to be configured.

## Edit Modes

The primary way of configuring editable layers is to provide a list of edit modes.
Editable layers accept `EditMode`s that provide a way of specifying what user interactions are supported in order to:

- create and manipulate GeoJSON features and geometries.
- select and duplicate geometries.
- measure geometries
- create custom reusable interactions

A range of Edit Modes are provided by the `@deck.gl-community/editable-layers` module, and applications can also define custom edit modes.

Some examples of provided edit modes are:

- `ViewMode` - No edits are possible, but selection is still possible.
- `DuplicateMode` - User can duplicate and translate a feature by clicking selected feature and dragging anywhere on the screen.
- `CompositeMode` - Use `CompositeMode` to combine multiple modes. _Not all combinations are guaranteed to work._
