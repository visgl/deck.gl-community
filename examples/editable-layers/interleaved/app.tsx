// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Interleaved Mode Example
 *
 * Demonstrates using EditableGeoJsonLayer with MapboxOverlay in interleaved mode.
 * Uses the onDragStateChange callback to coordinate with MapLibre's drag controls.
 *
 * Without this coordination, transform modes (Translate, Rotate, Scale) would
 * fight with the map's pan controls because deck.gl's event.stopImmediatePropagation()
 * doesn't reach MapLibre's event handlers in interleaved mode.
 *
 * See: https://github.com/visgl/deck.gl/discussions/8332
 */

import 'maplibre-gl/dist/maplibre-gl.css';
import React, {useCallback, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Map, useControl, NavigationControl, type MapRef} from 'react-map-gl/maplibre';
import {MapboxOverlay, type MapboxOverlayProps} from '@deck.gl/mapbox';
import {
  DrawLineStringMode,
  DrawPolygonMode,
  TranslateMode,
  RotateMode,
  ScaleMode,
  ViewMode,
  EditableGeoJsonLayer,
  type GeoJsonEditMode,
  type FeatureCollection
} from '@deck.gl-community/editable-layers';

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

const MODES = {
  view: {mode: ViewMode, label: 'View', group: 'view'},
  drawLine: {mode: DrawLineStringMode, label: 'Line', group: 'draw'},
  drawPolygon: {mode: DrawPolygonMode, label: 'Polygon', group: 'draw'},
  translate: {mode: TranslateMode, label: 'Translate', group: 'edit'},
  rotate: {mode: RotateMode, label: 'Rotate', group: 'edit'},
  scale: {mode: ScaleMode, label: 'Scale', group: 'edit'}
};

function App() {
  const mapRef = useRef<MapRef>(null);
  const [features, setFeatures] = React.useState<FeatureCollection>({
    type: 'FeatureCollection',
    features: []
  });
  const [modeKey, setModeKey] = React.useState<keyof typeof MODES>('drawPolygon');
  const [selectedIndexes, setSelectedIndexes] = React.useState<number[]>([]);

  const mode = MODES[modeKey].mode;
  const isEditMode = MODES[modeKey].group === 'edit';

  // Key fix: Coordinate with MapLibre's drag controls using onDragStateChange
  const handleDragStateChange = useCallback((isDragging: boolean) => {
    const map = mapRef.current?.getMap();
    if (map) {
      if (isDragging) {
        map.dragPan.disable();
        map.dragRotate.disable();
      } else {
        map.dragPan.enable();
        map.dragRotate.enable();
      }
    }
  }, []);

  const layer = new EditableGeoJsonLayer({
    data: features,
    mode,
    selectedFeatureIndexes: selectedIndexes,
    onEdit: ({updatedData}) => setFeatures(updatedData),
    onClick: (info) => {
      if (info.index >= 0) {
        setSelectedIndexes([info.index]);
      } else {
        setSelectedIndexes([]);
      }
    },
    // This callback enables proper coordination with MapLibre in interleaved mode
    onDragStateChange: handleDragStateChange
  });

  const getStatusText = () => {
    if (MODES[modeKey].group === 'draw') {
      return 'Click to draw shapes on the map';
    }
    if (isEditMode) {
      if (selectedIndexes.length === 0) {
        return features.features.length > 0
          ? 'Click a feature to select it for editing'
          : 'Draw some features first, then switch to an edit mode';
      }
      return `Feature ${selectedIndexes[0]} selected - drag to ${modeKey}`;
    }
    return 'Pan and zoom the map';
  };

  return (
    <div>
      <Map
        ref={mapRef}
        style={{width: '100%', height: 500}}
        initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      >
        <DeckGLOverlay layers={[layer]} interleaved />
        <NavigationControl />
      </Map>
      <div className="controls">
        <span className="label">View:</span>
        <button
          className={`button ${modeKey === 'view' ? 'active' : ''}`}
          onClick={() => setModeKey('view')}
        >
          View
        </button>
        <div className="separator" />
        <span className="label">Draw:</span>
        <button
          className={`button ${modeKey === 'drawLine' ? 'active' : ''}`}
          onClick={() => {
            setModeKey('drawLine');
            setSelectedIndexes([]);
          }}
        >
          Line
        </button>
        <button
          className={`button ${modeKey === 'drawPolygon' ? 'active' : ''}`}
          onClick={() => {
            setModeKey('drawPolygon');
            setSelectedIndexes([]);
          }}
        >
          Polygon
        </button>
        <div className="separator" />
        <span className="label">Edit:</span>
        <button
          className={`button ${modeKey === 'translate' ? 'active' : ''}`}
          onClick={() => setModeKey('translate')}
        >
          Translate
        </button>
        <button
          className={`button ${modeKey === 'rotate' ? 'active' : ''}`}
          onClick={() => setModeKey('rotate')}
        >
          Rotate
        </button>
        <button
          className={`button ${modeKey === 'scale' ? 'active' : ''}`}
          onClick={() => setModeKey('scale')}
        >
          Scale
        </button>
      </div>
      <div className="status">{getStatusText()}</div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
