# EditModeTrayWidget

A deck.gl widget that renders a tray of mode selection buttons. Provides a UI for switching between edit modes without requiring a custom React toolbar.

Widgets are deck.gl UI elements that render as HTML overlays on the map. They are passed to the `widgets` prop on `DeckGL`, not to individual layers.

## Usage

```tsx
import {
  EditModeTrayWidget,
  ViewMode,
  DrawPolygonMode,
  DrawRectangleMode,
  MeasureDistanceMode
} from '@deck.gl-community/editable-layers';

const trayWidget = new EditModeTrayWidget({
  placement: 'top-left',
  layout: 'vertical'
});

// Update widget props (typically in a useEffect)
trayWidget.setProps({
  modes: [
    {id: 'view', mode: ViewMode, label: 'View', title: 'Select features'},
    {id: 'polygon', mode: DrawPolygonMode, label: 'Polygon'},
    {id: 'rect', mode: DrawRectangleMode, label: 'Rectangle'},
    {id: 'measure', mode: MeasureDistanceMode, label: 'Measure'}
  ],
  activeMode: currentMode,
  selectedModeId: 'view',
  onSelectMode: ({mode}) => setMode(() => mode)
});

// Pass to DeckGL
<DeckGL widgets={[trayWidget]} ... />
```

## React Integration

Widgets must persist across React renders. Use `useRef` to create the widget once, and `useEffect` to sync props:

```tsx
function Editor() {
  const [mode, setMode] = useState(() => ViewMode);

  const trayRef = useRef<EditModeTrayWidget | null>(null);
  if (!trayRef.current) {
    trayRef.current = new EditModeTrayWidget({
      placement: 'top-left',
      layout: 'vertical'
    });
  }

  useEffect(() => {
    trayRef.current!.setProps({
      modes: MODE_OPTIONS,
      activeMode: mode,
      selectedModeId: MODE_OPTIONS.find((o) => o.mode === mode)?.id ?? null,
      onSelectMode: ({mode: selected}) => {
        if (mode !== selected) setMode(() => selected);
      }
    });
  }, [mode]);

  const widgets = useMemo(() => [trayRef.current!], []);

  return <DeckGL widgets={widgets} ... />;
}
```

## Props

### `placement`

- Type: `WidgetPlacement` (`'top-left'` | `'top-right'` | `'bottom-left'` | `'bottom-right'` | `'fill'`)
- Default: `'top-left'`

Where to position the widget on the map.

### `layout`

- Type: `'vertical'` | `'horizontal'`
- Default: `'vertical'`

Direction in which mode buttons are arranged.

### `modes`

- Type: `EditModeTrayWidgetModeOption[]`
- Default: `[]`

Array of mode options to display as buttons. Each option has:

| Field   | Type              | Required | Description                                              |
| ------- | ----------------- | -------- | -------------------------------------------------------- |
| `id`    | `string`          | No       | Unique identifier. Auto-inferred from mode class name.   |
| `mode`  | `GeoJsonEditMode` | Yes      | The edit mode class or instance to activate.              |
| `icon`  | `ComponentChild`  | No       | Icon or element rendered inside the button.               |
| `label` | `string`          | No       | Text label rendered below the icon.                       |
| `title` | `string`          | No       | Tooltip text for the button.                              |

### `activeMode`

- Type: `GeoJsonEditModeConstructor | GeoJsonEditModeType | null`
- Default: `null`

The currently active mode. Used to highlight the matching button.

### `selectedModeId`

- Type: `string | null`
- Default: `undefined`

Explicitly set which mode button is selected by ID. Takes precedence over `activeMode`.

### `onSelectMode`

- Type: `(event: EditModeTrayWidgetSelectEvent) => void`

Callback fired when the user clicks a mode button. The event object contains:

| Field    | Type              | Description                        |
| -------- | ----------------- | ---------------------------------- |
| `id`     | `string`          | The ID of the selected mode.       |
| `mode`   | `GeoJsonEditMode` | The mode class or instance.        |
| `option` | `ModeOption`      | The full mode option object.       |

### `style`

- Type: `Partial<CSSStyleDeclaration>`

Custom CSS styles applied to the widget root element. Useful for margins:

```tsx
new EditModeTrayWidget({style: {margin: '16px 0 0 16px'}})
```

### `className`

- Type: `string`

Custom CSS class name added to the widget root element.

## Methods

### `setProps(props)`

Update widget properties. Call this to sync the widget with React state changes. Automatically re-renders the tray.

[Source code](https://github.com/visgl/deck.gl-community/blob/master/modules/editable-layers/src/widgets/edit-mode-tray-widget.tsx)
