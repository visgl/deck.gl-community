// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useState, useEffect, useCallback, useMemo} from 'react';
import DeckGL from '@deck.gl/react';
import {TerrainController} from '@deck.gl/core';
import {Tile3DLayer} from '@deck.gl/geo-layers';
import {_TerrainExtension as TerrainExtension} from '@deck.gl/extensions';
import {
  ViewMode,
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
import {BoxWidget, ColumnPanel, MarkdownPanel} from '@deck.gl-community/widgets';

import '@deck.gl/widgets/stylesheet.css';

const GOOGLE_MAPS_API_KEY = process.env.GoogleMapsAPIKey; // eslint-disable-line
const TILESET_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json';

// Grand Canyon, Arizona
const INITIAL_VIEW_STATE = {
  latitude: 36.1069,
  longitude: -112.1129,
  zoom: 14,
  minZoom: 13,
  maxZoom: 18,
  bearing: 30,
  pitch: 55
};

function getDefaultGeoJSON() {
  return {
    type: 'FeatureCollection' as const,
    features: []
  };
}

// --- Mode tray configuration ---

const MODE_OPTIONS = [
  {id: 'view', mode: ViewMode, label: 'View', title: 'Select features'},
  {id: 'point', mode: DrawPointMode, label: 'Point', title: 'Draw a point'},
  {id: 'line', mode: DrawLineStringMode, label: 'Line', title: 'Draw a line'},
  {id: 'polygon', mode: DrawPolygonMode, label: 'Poly', title: 'Draw a polygon'},
  {id: 'rect', mode: DrawRectangleMode, label: 'Rect', title: 'Draw a rectangle'},
  {id: 'circle', mode: DrawCircleFromCenterMode, label: 'Circle', title: 'Draw a circle'},
  {id: 'distance', mode: MeasureDistanceMode, label: 'Dist', title: 'Measure distance'},
  {id: 'area', mode: MeasureAreaMode, label: 'Area', title: 'Measure area'},
  {id: 'angle', mode: MeasureAngleMode, label: 'Angle', title: 'Measure angle'}
];

// --- Component ---

export function Example() {
  const [geoJson, setGeoJson] = useState(getDefaultGeoJSON);
  const [selectedFeatureIndexes, setSelectedFeatureIndexes] = useState<number[]>([]);
  const [mode, setMode] = useState(() => ViewMode);
  const [modeConfig, setModeConfig] = useState<Record<string, any>>({});
  const [credits, setCredits] = useState('');

  const trayWidget = useMemo(
    () =>
      new EditModeTrayWidget({
        placement: 'top-left',
        layout: 'vertical',
        style: {margin: '12px 0 0 12px'}
      }),
    []
  );

  const toolbarWidget = useMemo(
    () =>
      new EditorToolbarWidget({
        placement: 'bottom-left',
        style: {margin: '0 0 20px 12px'}
      }),
    []
  );

  const infoWidget = useMemo(
    () =>
      new BoxWidget({
        id: 'editor-info',
        placement: 'top-right',
        widthPx: 320,
        title: '3D Tiles',
        collapsible: false
      }),
    []
  );

  const handleSetMode = useCallback((newMode: any) => {
    setMode(() => newMode);
    setModeConfig({});
  }, []);

  const handleSetBooleanOp = useCallback((op: BooleanOperation) => {
    setModeConfig(op ? {booleanOperation: op} : {});
  }, []);

  const handleClear = useCallback(() => {
    setGeoJson({type: 'FeatureCollection', features: []});
    setSelectedFeatureIndexes([]);
  }, []);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(geoJson, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'features.geojson';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [geoJson]);

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

  useEffect(() => {
    const modeLabel = MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? 'View';
    infoWidget.setProps({
      panel: buildInfoPanel({
        modeLabel,
        booleanOperation: (modeConfig?.booleanOperation as BooleanOperation) ?? null,
        featureCount: geoJson.features.length,
        selectedFeatureIndexes
      })
    });
  }, [geoJson.features.length, infoWidget, mode, modeConfig, selectedFeatureIndexes]);

  const widgets = useMemo(
    () => [trayWidget, toolbarWidget, infoWidget],
    [infoWidget, trayWidget, toolbarWidget]
  );

  const onTraversalComplete = useCallback((selectedTiles: any[]) => {
    const uniqueCredits = new Set<string>();
    selectedTiles.forEach((tile) => {
      const {copyright} = tile.content.gltf.asset;
      copyright.split(';').forEach(uniqueCredits.add, uniqueCredits);
    });
    setCredits([...uniqueCredits].join('; '));
    return selectedTiles;
  }, []);

  const tile3DLayer = new Tile3DLayer({
    id: 'google-3d-tiles',
    data: TILESET_URL,
    loadOptions: {
      fetch: {headers: {'X-GOOG-API-KEY': GOOGLE_MAPS_API_KEY}},
      tileset: {
        maximumScreenSpaceError: 20,
        maximumMemoryUsage: 512,
        memoryAdjustedScreenSpaceError: true,
        onTraversalComplete
      }
    },
    pickable: '3d',
    operation: 'terrain+draw'
  });

  const UI_BLUE: [number, number, number, number] = [0, 113, 227, 255];
  const UI_BLUE_SEMI: [number, number, number, number] = [0, 113, 227, 144];

  const editableLayer = new EditableGeoJsonLayer({
    data: geoJson,
    mode,
    modeConfig,
    selectedFeatureIndexes,
    extensions: [new TerrainExtension()],
    getLineColor: () => UI_BLUE,
    getFillColor: () => UI_BLUE_SEMI,
    getTentativeLineColor: () => UI_BLUE,
    getTentativeFillColor: () => UI_BLUE_SEMI,
    getLineWidth: () => 9,
    getTentativeLineWidth: () => 9,
    _subLayerProps: {
      tooltips: {
        parameters: {depthCompare: 'always'}
      }
    },
    onEdit: ({updatedData}) => {
      setGeoJson(updatedData);
    }
  });

  return (
    <div>
      <DeckGL
        style={{backgroundColor: '#061714'}}
        initialViewState={INITIAL_VIEW_STATE}
        controller={{type: TerrainController, touchRotate: true, inertia: 500, doubleClickZoom: false}}
        layers={[tile3DLayer, editableLayer]}
        getCursor={editableLayer.getCursor.bind(editableLayer)}
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
      />
      <div
        style={{position: 'absolute', left: '8px', bottom: '4px', color: 'white', fontSize: '10px'}}
      >
        {credits}
      </div>
    </div>
  );
}

function buildInfoPanel({
  modeLabel,
  booleanOperation,
  featureCount,
  selectedFeatureIndexes
}: {
  modeLabel: string;
  booleanOperation: BooleanOperation;
  featureCount: number;
  selectedFeatureIndexes: number[];
}) {
  return new ColumnPanel({
    id: 'editor-info-panel',
    title: '',
    panels: {
      summary: new MarkdownPanel({
        id: 'summary',
        title: '',
        markdown: [
          'Editable layers on Google 3D Tiles.',
          'Drawn features snap to 3D terrain surface.',
          '',
          `- Mode: **${modeLabel}**`,
          `- Boolean op: **${booleanOperation ?? 'edit'}**`,
          `- Features: **${featureCount}**`,
          `- Selected: **${
            selectedFeatureIndexes.length > 0 ? selectedFeatureIndexes.join(', ') : 'none'
          }**`
        ].join('\n')
      })
    }
  });
}
