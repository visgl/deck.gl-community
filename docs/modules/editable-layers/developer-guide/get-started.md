# Get Started

## Installation

```bash
npm install @deck.gl-community/editable-layers
```

You'll also need deck.gl and a base map provider:

```bash
npm install deck.gl @deck.gl/react @deck.gl/core @deck.gl/layers maplibre-gl react-map-gl
```

## Quick Overview of the API

### EditableGeoJsonLayer

[EditableGeoJsonLayer](/docs/modules/editable-layers/api-reference/layers/editable-geojson-layer) is implemented as a [deck.gl](https://deck.gl) layer. It provides the ability to view and edit multiple types of geometry formatted as [GeoJSON](https://tools.ietf.org/html/rfc7946) (an open standard format for geometry) including polygons, lines, and points.

### Edit Modes

Edit modes control how the user interacts with features. Each mode defines a specific editing behavior:

- **View modes**: `ViewMode` — Select features without editing
- **Draw modes**: `DrawPointMode`, `DrawLineStringMode`, `DrawPolygonMode`, `DrawRectangleMode`, `DrawCircleFromCenterMode`, and more — Create new geometry by clicking on the map
- **Transform modes**: `ModifyMode`, `TranslateMode`, `RotateMode`, `ScaleMode` — Modify existing geometry by dragging vertices or features
- **Measurement modes**: `MeasureDistanceMode`, `MeasureAreaMode`, `MeasureAngleMode` — Measure distances, areas, and angles
- **Composite modes**: `CompositeMode`, `SnappableMode` — Combine multiple modes or add snapping behavior

Set the mode via the `mode` prop on `EditableGeoJsonLayer`. See the [Edit Modes API reference](/docs/modules/editable-layers/api-reference/edit-modes/core-modes) for the full list.

### Callbacks

When editing is enabled, the `onEdit` callback fires with details about each edit:

```tsx
onEdit: ({updatedData, editType, editContext}) => {
  // updatedData — the new FeatureCollection after the edit
  // editType — 'addFeature', 'movePosition', 'removePosition', etc.
  // editContext — mode-specific context (e.g. featureIndexes for addFeature)
  setFeatures(updatedData);
}
```

## Minimal Example

```tsx
import React, {useState} from 'react';
import DeckGL from '@deck.gl/react';
import {
  EditableGeoJsonLayer,
  DrawPolygonMode,
  ViewMode
} from '@deck.gl-community/editable-layers';
import StaticMap from 'react-map-gl/maplibre';

const INITIAL_VIEW_STATE = {
  longitude: -122.43,
  latitude: 37.775,
  zoom: 12
};

export function GeometryEditor() {
  const [features, setFeatures] = useState({
    type: 'FeatureCollection',
    features: []
  });
  const [mode, setMode] = useState(() => DrawPolygonMode);
  const [selectedFeatureIndexes, setSelectedFeatureIndexes] = useState([]);

  const layer = new EditableGeoJsonLayer({
    data: features,
    mode,
    selectedFeatureIndexes,
    onEdit: ({updatedData}) => {
      setFeatures(updatedData);
    }
  });

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={{doubleClickZoom: false}}
      layers={[layer]}
      getCursor={layer.getCursor.bind(layer)}
    >
      <StaticMap mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json" />
    </DeckGL>
  );
}
```

See the [getting-started example](https://github.com/visgl/deck.gl-community/tree/master/examples/editable-layers/getting-started) for a complete runnable version.

## Widgets

`editable-layers` ships deck.gl widgets that provide editing UI without requiring you to build custom React components.

### EditModeTrayWidget

Renders a tray of mode selection buttons. Pass it to the `widgets` prop on your `DeckGL` component:

```tsx
import {EditModeTrayWidget, ViewMode, DrawPolygonMode} from '@deck.gl-community/editable-layers';

const trayWidget = new EditModeTrayWidget({
  placement: 'top-left',
  layout: 'vertical',
  modes: [
    {id: 'view', mode: ViewMode, label: 'View'},
    {id: 'draw-polygon', mode: DrawPolygonMode, label: 'Polygon'}
  ],
  onSelectMode: ({mode}) => setMode(mode)
});

<DeckGL widgets={[trayWidget]} ... />
```

### EditorToolbarWidget

Renders a toolbar with boolean operations (union, difference, intersection), clear, and export buttons:

```tsx
import {EditorToolbarWidget} from '@deck.gl-community/editable-layers';

const toolbarWidget = new EditorToolbarWidget({
  placement: 'bottom-left',
  onSetBooleanOperation: (op) => setModeConfig(op ? {booleanOperation: op} : {}),
  onClear: () => setFeatures({type: 'FeatureCollection', features: []}),
  onExport: () => downloadGeoJson(features)
});
```

See the [editor example](https://github.com/visgl/deck.gl-community/tree/master/examples/editable-layers/editor) for a full widgets-only editing setup, and the [Widget API docs](/docs/modules/editable-layers/api-reference/widgets/edit-mode-tray-widget) for the complete props reference.

## See Also

- [EditableGeoJsonLayer](/docs/modules/editable-layers/api-reference/layers/editable-geojson-layer)
- [Using deck.gl with React](https://deck.gl/docs/get-started/using-with-react)
- [Using deck.gl with a Base Map](https://deck.gl/docs/get-started/using-with-map)
