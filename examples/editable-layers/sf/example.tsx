// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useState} from 'react';
import StaticMap from 'react-map-gl/maplibre';
import DeckGL from '@deck.gl/react';
import {
  ViewMode,
  ModifyMode,
  EditableGeoJsonLayer,
  SelectionLayer
} from '@deck.gl-community/editable-layers';
import type {FeatureCollection} from 'geojson';

import testPolygons from '../data/sf-polygons';

const INITIAL_VIEW_STATE = {
  bearing: 0,
  latitude: 37.7,
  longitude: -122.4,
  pitch: 0,
  zoom: 10
};

const TOOLBOX_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  background: 'rgba(26, 32, 44, 0.9)',
  color: '#f8fafc',
  padding: '12px 16px',
  borderRadius: '12px',
  fontFamily: 'sans-serif',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px'
};

const BUTTON_STYLE: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  background: 'rgba(15, 23, 42, 0.4)',
  color: '#e2e8f0',
  cursor: 'pointer',
  fontSize: '13px'
};

const BUTTON_ACTIVE_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  background: '#2563eb',
  borderColor: '#2563eb'
};

export function Example() {
  const [testFeatures, setTestFeatures] = useState<FeatureCollection>({
    type: 'FeatureCollection',
    features: testPolygons as any
  });
  const [selectedFeatureIndexes, setSelectedFeatureIndexes] = useState<number[]>([]);
  const [allowEdit, setAllowEdit] = useState(true);
  const [selectionType, setSelectionType] = useState<string | null>(null);

  const editableGeoJsonLayer = new EditableGeoJsonLayer({
    data: testFeatures,
    selectedFeatureIndexes,
    pickable: true,
    mode: selectedFeatureIndexes.length > 0 ? ModifyMode : ViewMode,
    onEdit: ({updatedData}) => {
      if (allowEdit) {
        setTestFeatures(updatedData);
      }
    },
    getFillColor: [0x00, 0x20, 0x70, 0x30],
    getLineColor: [0x00, 0x20, 0x70, 0xc0],
    getLineWidth: 3,
    lineWidthMinPixels: 2,
    lineWidthMaxPixels: 10
  });

  const selectionLayer = new SelectionLayer({
    id: 'selection',
    selectionType,
    onSelect: ({pickingInfos}) => {
      setSelectedFeatureIndexes(pickingInfos.map((pi) => pi.index));
      setSelectionType(null);
    },
    layerIds: ['geojson'],
    getTentativeFillColor: () => [255, 0, 255, 100],
    getTentativeLineColor: () => [0, 0, 255, 255],
    getTentativeLineDashArray: () => [0, 0],
    lineWidthMinPixels: 1
  });

  return (
    <>
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={{doubleClickZoom: false}}
        layers={[editableGeoJsonLayer, selectionLayer]}
        getCursor={editableGeoJsonLayer.getCursor.bind(editableGeoJsonLayer)}
        onClick={(info) => {
          if (selectedFeatureIndexes.length === 0 || editableGeoJsonLayer.props.mode === ViewMode) {
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

      <div style={TOOLBOX_STYLE}>
        <h3 style={{margin: 0, fontSize: '16px'}}>SF Polygons</h3>
        <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
          <button
            style={selectionType === 'rectangle' ? BUTTON_ACTIVE_STYLE : BUTTON_STYLE}
            onClick={() => setSelectionType('rectangle'!)}
          >
            Select by Rectangle
          </button>
          <button
            style={selectionType === 'polygon' ? BUTTON_ACTIVE_STYLE : BUTTON_STYLE}
            onClick={() => setSelectionType('polygon'!)}
          >
            Select by Polygon
          </button>
        </div>
        <div style={{fontSize: '13px', color: '#94a3b8'}}>
          Polygons: {testFeatures.features.length} | Selected:{' '}
          {selectedFeatureIndexes.length > 0 ? selectedFeatureIndexes.join(', ') : 'none'}
        </div>
        <button
          style={allowEdit ? BUTTON_ACTIVE_STYLE : BUTTON_STYLE}
          onClick={() => setAllowEdit(!allowEdit)}
        >
          Allow Edit: {allowEdit ? 'Yes' : 'No'}
        </button>
      </div>
    </>
  );
}

// Keep default export for website integration
export default Example;
