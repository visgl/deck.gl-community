import 'maplibre-gl/dist/maplibre-gl.css';
import React from 'react';
import {Map, useControl, NavigationControl} from 'react-map-gl/maplibre';
import {MapboxOverlay, type MapboxOverlayProps} from '@deck.gl/mapbox';
import {
  DrawLineStringMode,
  DrawPolygonByDraggingMode,
  DrawPolygonMode,
  EditableGeoJsonLayer,
  EditAction,
  type GeoJsonEditMode,
  type FeatureCollection
} from '@deck.gl-community/editable-layers';

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function App() {
  const [features, setFeatures] = React.useState<FeatureCollection>({
    type: 'FeatureCollection',
    features: []
  });
  const [mode, setMode] = React.useState<GeoJsonEditMode>(() => DrawPolygonMode);

  const layer = new EditableGeoJsonLayer({
    data: features,
    mode,
    selectedFeatureIndexes: [],
    onEdit: ({updatedData}: EditAction<FeatureCollection>) => setFeatures(updatedData)
  });

  return (
    <div>
      <Map
        style={{width: '100%', height: 500}}
        mapStyle={'https://demotiles.maplibre.org/style.json'}
        dragPan={mode !== DrawPolygonByDraggingMode}
        dragRotate={mode !== DrawPolygonByDraggingMode}
      >
        {/* this will fail with interleaved={false}, issue reported in https://github.com/visgl/deck.gl-community/issues/237 */}
        <DeckGLOverlay layers={[layer]} interleaved={false} />
        <NavigationControl />
      </Map>
      <div className="controls">
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
        <button
          className={`button ${mode === DrawPolygonByDraggingMode ? 'active' : ''}`}
          onClick={() => setMode(() => DrawPolygonByDraggingMode)}
        >
          Lasso
        </button>
      </div>
    </div>
  );
}
