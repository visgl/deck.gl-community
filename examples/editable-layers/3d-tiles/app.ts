// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {EXAMPLE_PANEL_STYLE} from '../../utils/panel-theme';
import {Deck, MapView, TerrainController} from '@deck.gl/core';
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
import type {
  BooleanOperation,
  EditModeTrayWidgetSelectEvent
} from '@deck.gl-community/editable-layers';
import {ColumnPanel, MarkdownPanel} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';

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

export function mountEditableLayers3DTilesExample(container: HTMLElement): () => void {
  const doc = container.ownerDocument;
  const host = doc.createElement('div');
  Object.assign(host.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    backgroundColor: '#061714'
  });
  const credits = doc.createElement('div');
  Object.assign(credits.style, {
    position: 'absolute',
    left: '8px',
    bottom: '4px',
    color: 'white',
    fontSize: '10px',
    pointerEvents: 'none'
  });
  container.append(host);

  let geoJson = getDefaultGeoJSON();
  let selectedFeatureIndexes: number[] = [];
  let mode: EditModeTrayWidgetSelectEvent['mode'] = ViewMode;
  let booleanOperation: BooleanOperation | null = null;

  const trayWidget = new EditModeTrayWidget({
    placement: 'top-left',
    layout: 'vertical',
    style: {margin: '12px 0 0 12px'},
    modes: MODE_OPTIONS,
    onSelectMode: ({mode: selectedMode}) => {
      if (mode !== selectedMode) {
        mode = selectedMode;
        booleanOperation = null;
        updateDeck();
      }
    }
  });
  const toolbarWidget = new EditorToolbarWidget({
    placement: 'bottom-left',
    style: {margin: '0 0 20px 12px'},
    onSetBooleanOperation: operation => {
      booleanOperation = operation;
      updateDeck();
    },
    onClear: () => {
      geoJson = {type: 'FeatureCollection', features: []};
      selectedFeatureIndexes = [];
      updateDeck();
    },
    onExport: () => {
      const blob = new Blob([JSON.stringify(geoJson, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const link = doc.createElement('a');
      link.href = url;
      link.download = 'features.geojson';
      doc.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }
  });
  const infoWidget = new BoxPanelWidget({
    style: EXAMPLE_PANEL_STYLE,
    id: 'editor-info',
    placement: 'top-right',
    widthPx: 320,
    title: '3D Tiles',
    collapsible: false
  });

  function onTraversalComplete(selectedTiles: any[]) {
    const uniqueCredits = new Set<string>();
    for (const tile of selectedTiles) {
      const copyright = tile.content?.gltf?.asset?.copyright;
      copyright?.split(';').forEach(uniqueCredits.add, uniqueCredits);
    }
    credits.textContent = [...uniqueCredits].join('; ');
    return selectedTiles;
  }

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

  const deck = new Deck({
    parent: host,
    views: new MapView({maxPitch: 90}),
    initialViewState: INITIAL_VIEW_STATE,
    controller: {
      type: TerrainController,
      maxPitch: 90,
      touchRotate: true,
      inertia: false,
      doubleClickZoom: false
    },
    widgets: [trayWidget, toolbarWidget, infoWidget],
    onClick: ({index}) => {
      if (mode === ViewMode) {
        selectedFeatureIndexes = index >= 0 ? [index] : [];
        updateDeck();
      }
    }
  });
  host.append(credits);
  updateDeck();

  return () => {
    deck.finalize();
    host.remove();
  };

  function updateDeck() {
    const option = MODE_OPTIONS.find(candidate => candidate.mode === mode);
    const featureCount = geoJson.features.length;
    trayWidget.setProps({activeMode: mode, selectedModeId: option?.id ?? null});
    toolbarWidget.setProps({booleanOperation, featureCount});
    infoWidget.setProps({
      panel: buildInfoPanel({
        modeLabel: option?.label ?? 'View',
        booleanOperation,
        featureCount,
        selectedFeatureIndexes
      })
    });

    const UI_BLUE: [number, number, number, number] = [0, 113, 227, 255];
    const UI_BLUE_SEMI: [number, number, number, number] = [0, 113, 227, 144];

    const editableLayer = new EditableGeoJsonLayer({
      data: geoJson,
      mode,
      modeConfig: booleanOperation ? {booleanOperation} : {},
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
        geoJson = updatedData;
        updateDeck();
      }
    });

    deck.setProps({
      layers: [tile3DLayer, editableLayer],
      getCursor: editableLayer.getCursor.bind(editableLayer)
    });
  }
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
    panels: [
      new MarkdownPanel({
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
    ]
  });
}
