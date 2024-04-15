# Editor Modes

`EditMode`s provide a way of handling user interactions in order to manipulate GeoJSON features and geometries.

The most basic modes are:

## ViewMode

No edits are possible, but selection is still possible.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/view-mode.ts)

## DuplicateMode

User can duplicate and translate a feature by clicking selected feature and dragging anywhere on the screen.
This mode is extends TranslateMode. This mode supports multiple selections.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/edit-modes/duplicate-mode.ts)


## Composite Mode

Use `CompositeMode` to combine multiple modes.
_Not all combinations are guaranteed to work._

`new CompositeMode(modes, options = {})`

- `modes`: `Array<EditMode>` Modes you want to combine. **Order is very important.**
- `options` (optional): Options to be added later.

```
new CompositeMode([new DrawLineStringMode(), new ModifyMode()])
```

