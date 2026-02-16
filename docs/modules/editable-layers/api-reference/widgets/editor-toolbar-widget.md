# EditorToolbarWidget

A deck.gl widget that provides editing controls: boolean operations, clear, export, and a live feature count. Designed to pair with `EditModeTrayWidget` for a complete widget-based editing UI.

## Usage

```tsx
import {EditorToolbarWidget} from '@deck.gl-community/editable-layers';

const toolbar = new EditorToolbarWidget({
  placement: 'bottom-left'
});

toolbar.setProps({
  booleanOperation: null,
  featureCount: features.length,
  onSetBooleanOperation: (op) => setModeConfig(op ? {booleanOperation: op} : {}),
  onClear: () => setFeatures({type: 'FeatureCollection', features: []}),
  onExport: () => downloadGeoJson(features)
});

<DeckGL widgets={[trayWidget, toolbar]} ... />
```

## Props

### `placement`

- Type: `WidgetPlacement`
- Default: `'bottom-left'`

Where to position the widget on the map.

### `booleanOperation`

- Type: `BooleanOperation` (`'union'` | `'difference'` | `'intersection'` | `null`)
- Default: `null`

The currently active boolean operation. Controls which toggle button is highlighted. Set to `null` for standard drawing (no boolean operation).

### `featureCount`

- Type: `number`
- Default: `0`

Number of features in the current dataset. Displayed as a badge in the toolbar.

### `onSetBooleanOperation`

- Type: `(op: BooleanOperation) => void`

Callback fired when the user clicks a boolean operation button. The value is one of:

| Value            | Description                                        |
| ---------------- | -------------------------------------------------- |
| `null`           | Standard drawing — new features are added as-is.   |
| `'difference'`   | Subtract drawn polygon from selected geometry.     |
| `'union'`        | Union drawn polygon with selected geometry.        |
| `'intersection'` | Intersect drawn polygon with selected geometry.    |

Wire this to `EditableGeoJsonLayer`'s `modeConfig`:

```tsx
onSetBooleanOperation: (op) => {
  setModeConfig(op ? {booleanOperation: op} : {});
}
```

### `onClear`

- Type: `() => void`

Callback fired when the user clicks the clear (trash) button.

### `onExport`

- Type: `() => void`

Callback fired when the user clicks the download button. The widget does not handle the export itself — implement the download in your callback:

```tsx
onExport: () => {
  const blob = new Blob([JSON.stringify(geoJson, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'features.geojson';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

### `style`

- Type: `Partial<CSSStyleDeclaration>`

Custom CSS styles applied to the widget root element.

### `className`

- Type: `string`

Custom CSS class name added to the widget root element.

## Toolbar Layout

The toolbar renders as a horizontal pill-shaped tray with three sections:

```
[Edit][Sub][Union][Sect] | [Clear][Export] | 3 features
```

- **Boolean operation buttons** — Toggle group. Only one can be active at a time.
- **Action buttons** — Clear (trash icon) and Export (download icon).
- **Feature count** — Read-only badge showing the number of features.

## See Also

- [EditModeTrayWidget](/docs/modules/editable-layers/api-reference/widgets/edit-mode-tray-widget) — Mode selection widget
- [Editor example](https://github.com/visgl/deck.gl-community/tree/master/examples/editable-layers/editor) — Complete example using both widgets

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/widgets/editor-toolbar-widget.tsx)
