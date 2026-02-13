// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useState} from 'react';
import DeckGL from '@deck.gl/react';
import {ViewMode, DrawPolygonMode, EditableGeoJsonLayer} from '@deck.gl-community/editable-layers';
import StaticMap from 'react-map-gl/maplibre';
import type {FeatureCollection} from 'geojson';

const INITIAL_VIEW_STATE = {
  longitude: -122.43,
  latitude: 37.775,
  zoom: 12
};

const INITIAL_GEOJSON: FeatureCollection = {
  type: 'FeatureCollection',
  features: []
};

export function Example() {
  const [geoJson, setGeoJson] = useState<FeatureCollection>(INITIAL_GEOJSON);
  const [mode, setMode] = useState<typeof ViewMode | typeof DrawPolygonMode>(() => DrawPolygonMode);
  const [selectedFeatureIndexes, setSelectedFeatureIndexes] = useState<number[]>([]);

  const layer = new EditableGeoJsonLayer({
    data: geoJson,
    mode,
    selectedFeatureIndexes,
    onEdit: ({updatedData}) => {
      setGeoJson(updatedData);
    }
  });

  return (
    <>
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={{doubleClickZoom: false}}
        layers={[layer]}
        getCursor={layer.getCursor.bind(layer)}
        onClick={(info) => {
          if (mode === ViewMode) {
            if (info && info.index >= 0) {
              setSelectedFeatureIndexes([info.index]);
            } else {
              setSelectedFeatureIndexes([]);
            }
          }
        }}
      >
        <StaticMap mapStyle={'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'} />
      </DeckGL>

      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          padding: '12px 16px',
          background: 'rgba(26, 32, 44, 0.9)',
          color: '#f8fafc',
          borderRadius: '12px',
          fontFamily: 'sans-serif',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        <h3 style={{margin: 0, fontSize: '16px'}}>Getting Started</h3>
        <div style={{display: 'flex', gap: '8px'}}>
          <button
            onClick={() => setMode(() => DrawPolygonMode)}
            style={{
              padding: '6px 14px',
              borderRadius: '999px',
              border: '1px solid rgba(148, 163, 184, 0.5)',
              background: mode === DrawPolygonMode ? '#2563eb' : 'rgba(15, 23, 42, 0.4)',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            Draw
          </button>
          <button
            onClick={() => setMode(() => ViewMode)}
            style={{
              padding: '6px 14px',
              borderRadius: '999px',
              border: '1px solid rgba(148, 163, 184, 0.5)',
              background: mode === ViewMode ? '#2563eb' : 'rgba(15, 23, 42, 0.4)',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            View
          </button>
        </div>
        <p style={{margin: 0, fontSize: '13px', color: '#94a3b8'}}>
          Click to place vertices. Double-click to finish a polygon.
          <br />
          Features: {geoJson.features.length}
        </p>
      </div>
    </>
  );
}
