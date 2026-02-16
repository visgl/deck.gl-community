// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useState, useRef, useEffect, useCallback, useMemo} from 'react';
import DeckGL from '@deck.gl/react';
import {
  ViewMode,
  ModifyMode,
  TransformMode,
  DrawPointMode,
  DrawLineStringMode,
  DrawPolygonMode,
  DrawRectangleMode,
  DrawCircleFromCenterMode,
  MeasureDistanceMode,
  MeasureAngleMode,
  MeasureAreaMode,
  EditableGeoJsonLayer,
  EditModeTrayWidget,
  EditorToolbarWidget
} from '@deck.gl-community/editable-layers';
import type {BooleanOperation} from '@deck.gl-community/editable-layers';
import StaticMap from 'react-map-gl/maplibre';

// --- Default data ---

function getDefaultGeoJSON() {
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-122.46212548792364, 37.79026033616934],
              [-122.48435831844807, 37.77160302698496],
              [-122.45884849905971, 37.74414218845571],
              [-122.42863676726826, 37.76266965836386],
              [-122.46212548792364, 37.79026033616934]
            ]
          ]
        }
      },
      {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-122.4136573004723, 37.78826678755718],
              [-122.44875601708893, 37.782670574261324],
              [-122.43793598592286, 37.74322062447909],
              [-122.40836932539945, 37.75125290412125],
              [-122.4136573004723, 37.78826678755718]
            ]
          ]
        }
      }
    ]
  };
}

const initialViewState = {
  longitude: -122.43,
  latitude: 37.775,
  zoom: 12
};

// --- Mode tray configuration ---

const MODE_OPTIONS = [
  {id: 'view', mode: ViewMode, label: 'View', title: 'Select features'},
  {id: 'modify', mode: ModifyMode, label: 'Edit', title: 'Edit vertices'},
  {id: 'transform', mode: TransformMode, label: 'Move', title: 'Move, rotate, scale'},
  {id: 'point', mode: DrawPointMode, label: 'Point', title: 'Draw a point'},
  {id: 'line', mode: DrawLineStringMode, label: 'Line', title: 'Draw a line'},
  {id: 'polygon', mode: DrawPolygonMode, label: 'Poly', title: 'Draw a polygon'},
  {id: 'rect', mode: DrawRectangleMode, label: 'Rect', title: 'Draw a rectangle'},
  {id: 'circle', mode: DrawCircleFromCenterMode, label: 'Circle', title: 'Draw a circle'},
  {id: 'distance', mode: MeasureDistanceMode, label: 'Dist', title: 'Measure distance'},
  {id: 'area', mode: MeasureAreaMode, label: 'Area', title: 'Measure area'},
  {id: 'angle', mode: MeasureAngleMode, label: 'Angle', title: 'Measure angle'}
];

// --- Helpers ---

function downloadGeoJson(geoJson: any) {
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

// --- Component ---

export function Example() {
  const [geoJson, setGeoJson] = useState(getDefaultGeoJSON);
  const [selectedFeatureIndexes, setSelectedFeatureIndexes] = useState<number[]>([0]);
  const [mode, setMode] = useState(() => ViewMode);
  const [modeConfig, setModeConfig] = useState<Record<string, any>>({});

  // Create widgets once (persisted via ref)
  const trayWidgetRef = useRef<EditModeTrayWidget | null>(null);
  if (!trayWidgetRef.current) {
    trayWidgetRef.current = new EditModeTrayWidget({
      placement: 'top-left',
      layout: 'vertical',
      style: {margin: '12px 0 0 12px'}
    });
  }
  const trayWidget = trayWidgetRef.current;

  const toolbarWidgetRef = useRef<EditorToolbarWidget | null>(null);
  if (!toolbarWidgetRef.current) {
    toolbarWidgetRef.current = new EditorToolbarWidget({
      placement: 'bottom-left',
      style: {margin: '0 0 20px 12px'}
    });
  }
  const toolbarWidget = toolbarWidgetRef.current;

  const handleSetMode = useCallback((newMode: any) => {
    setMode(() => newMode);
    setModeConfig({});
  }, []);

  const handleExport = useCallback(() => {
    downloadGeoJson(geoJson);
  }, [geoJson]);

  const handleClear = useCallback(() => {
    setGeoJson({type: 'FeatureCollection', features: []});
    setSelectedFeatureIndexes([]);
  }, []);

  const handleSetBooleanOp = useCallback((op: BooleanOperation) => {
    setModeConfig(op ? {booleanOperation: op} : {});
  }, []);

  // Sync mode tray widget
  useEffect(() => {
    const selected = MODE_OPTIONS.find((option) => option.mode === mode)?.id ?? null;
    trayWidget.setProps({
      modes: MODE_OPTIONS,
      activeMode: mode,
      selectedModeId: selected,
      onSelectMode: ({mode: selectedMode}) => {
        if (mode !== selectedMode) {
          handleSetMode(selectedMode);
        }
      }
    });
  }, [mode, handleSetMode, trayWidget]);

  // Sync toolbar widget
  useEffect(() => {
    toolbarWidget.setProps({
      booleanOperation: (modeConfig?.booleanOperation as BooleanOperation) ?? null,
      featureCount: geoJson.features.length,
      onSetBooleanOperation: handleSetBooleanOp,
      onClear: handleClear,
      onExport: handleExport
    });
  }, [modeConfig, geoJson.features.length, handleSetBooleanOp, handleClear, handleExport, toolbarWidget]);

  const widgets = useMemo(() => [trayWidget, toolbarWidget], [trayWidget, toolbarWidget]);

  const layer = new EditableGeoJsonLayer({
    data: geoJson,
    mode,
    modeConfig,
    selectedFeatureIndexes,
    onEdit: ({updatedData}) => {
      setGeoJson(updatedData);
    }
  });

  return (
    <DeckGL
      initialViewState={initialViewState}
      controller={{doubleClickZoom: false}}
      layers={[layer]}
      getCursor={layer.getCursor.bind(layer)}
      onClick={(info) => {
        if (mode === ViewMode) {
          const index = typeof info?.index === 'number' && info.index >= 0 ? info.index : null;
          if (index !== null) {
            setSelectedFeatureIndexes([index]);
          } else {
            setSelectedFeatureIndexes([]);
          }
        }
      }}
      widgets={widgets}
    >
      <StaticMap mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json" />
    </DeckGL>
  );
}
