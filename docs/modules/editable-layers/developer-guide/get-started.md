# Get Started

## Installation

For yarn

```bash
yarn add @deck.gl-community/editable-layers
yarn add @deck.gl-community/react-editable-layers
```

## Design Goals

@deck.gl-community/editable-layers aspires to be an ultra-performant, fully 3D-enabled GeoJSON editing system primarily focused on geospatial editing use cases.

- Maximal rendering and editing performance, without need for complex application logic (such as splitting data into subgroups etc).
- Target performance: Editing at 60fps (e.g. dragging sub objects) in GeoJSON payloads with 100K features (points, lines or polygons).
- Handles GeoJSON corner cases, e.g. automatically changing object types from `Polygon` to `MultiPolygon` when addition polygons are added.
- Fully 3D enabled (Can e.g. use WebGL z-buffer so that lines being rendered are properly occluded by other geometry).
- Seamless integration with deck.gl and all geospatial deck.gl layers, allowing for GeoJSON editing to be interleaved with rich 3D visualizations.
- Handle all aspects of event handling, including touch screen support.

## Why use `editable-layers`?

You should strongly consider `editable-layers` if:

- You want a full-featured, ultra-high-performance editing solution for GeoJson.
- You are already using e.g. `deck.gl` or `react-map-gl`.

You may want to look at alternatives if:

- If you have very simple editing requirements (just a simple polygon etc)
- If you don't want to use `deck.gl` in your project.

If `editable-layers` is more than what you need (e.g. in terms of bundle size), and you may want to look at other solutions, e.g. the simple polygon editor overlay being developed in react-map-gl.

That said, if you are already using `deck.gl` the additional overhead of `editable-layers` is small, and the seamless integration with deck.gl should be valuable.

## Quick Overview of the API

### EditableGeoJsonLayer

[EditableGeoJsonLayer](/docs/modules/editable-layers/api-reference/layers/editable-geojson-layer) is implemented as a [deck.gl](https://deck.gl) layer. It provides the ability to view and edit multiple types of geometry formatted as [GeoJSON](https://tools.ietf.org/html/rfc7946) (an open standard format for geometry) including polygons, lines, and points.

#### Callbacks

When there is the ability to edit, callbacks are provided to inform you of edits.

## Small example

```tsx
import React from 'react';
import DeckGL from 'deck.gl';
import {
  EditableGeoJsonLayer,
  DrawLineStringMode,
  DrawPolygonMode
} from '@deck.gl-community/editable-layers';
import { StaticMap } from 'react-map-gl';

const INITIAL_VIEW_STATE = {
  longitude: -122.41669,
  latitude: 37.7853,
  zoom: 13,
  pitch: 0,
  bearing: 0
};

export function GeometryEditor() {
  const [features, setFeatures] = React.useState({
    type: 'FeatureCollection',
    features: []
  });
  const [mode, setMode] = React.useState(() => DrawPolygonMode);
  const [selectedFeatureIndexes] = React.useState([]);

  const layer = new EditableGeoJsonLayer({
    data: features,
    mode,
    selectedFeatureIndexes,
    onEdit: ({ updatedData }) => {
      setFeatures(updatedData);
    }
  });

  return (
    <>
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={{
          doubleClickZoom: false
        }}
        layers={[layer]}
        getCursor={layer.getCursor.bind(layer)}
      >
        <StaticMap mapboxApiAccessToken={YOUR_TOKEN_HERE} />
      </DeckGL>

      <div className='controls'>
        <button
          className={`button ${mode === DrawLineStringMode ? 'active' : ''}`}
          onClick={() => setMode(() => DrawLineStringMode)}
        >
          Line
        </button>
        <button
          className={`button ${mode === DrawPolygonMode ? 'active' : ''}`}
          onClick={() => setMode(() => DrawPolygonMode)}
        >
          Polygon
        </button>
      </div>
    </>
  );
}

```
Live example on [codesandbox](https://codesandbox.io/s/nebula-react-basic-example-q7t9u?file=/src/App.js)

## See Also

- [EditableGeoJsonLayer](/docs/modules/editable-layers/api-reference/layers/editable-geojson-layer)
- [Using deck.gl with React](https://deck.gl/docs/get-started/using-with-react)
- [Using deck.gl with a Base Map](https://deck.gl/docs/get-started/using-with-map)

## Useful examples (Codesandbox)

- [Hello World (using deck.gl)](https://codesandbox.io/s/hello-world-nebulagl-csvsm)
- [With Toolbox](https://codesandbox.io/s/hello-nebulagl-with-toolbox-oelkr)
- [No React](https://codesandbox.io/s/deckgl-and-nebulagl-editablegeojsonlayer-no-react-p9yrs)
- [Custom EditMode](https://codesandbox.io/s/connect-the-dots-mode-yow65)


