// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {EXAMPLE_PANEL_STYLE} from '../../utils/panel-theme';
import {Deck} from '@deck.gl/core';
import {Map} from 'maplibre-gl';
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
import type {
  BooleanOperation,
  EditModeTrayWidgetSelectEvent
} from '@deck.gl-community/editable-layers';
import {ColumnPanel, MarkdownPanel} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';

import 'maplibre-gl/dist/maplibre-gl.css';
import '@deck.gl/widgets/stylesheet.css';

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
          'Supplementary React integration example using the editable-layers widgets inside a React map shell.',
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

export function mountEditableLayersEditorExample(container: HTMLElement): () => void {
  const doc = container.ownerDocument;
  const host = doc.createElement('div');
  Object.assign(host.style, {position: 'relative', width: '100%', height: '100%'});
  const basemap = doc.createElement('div');
  Object.assign(basemap.style, {position: 'absolute', inset: '0'});
  host.append(basemap);
  container.append(host);

  const map = new Map({
    container: basemap,
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [initialViewState.longitude, initialViewState.latitude],
    zoom: initialViewState.zoom,
    interactive: false
  });

  let geoJson = getDefaultGeoJSON();
  let selectedFeatureIndexes = [0];
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
    onExport: () => downloadGeoJson(geoJson)
  });
  const infoWidget = new BoxPanelWidget({
    style: EXAMPLE_PANEL_STYLE,
    id: 'editor-info',
    placement: 'top-right',
    widthPx: 320,
    title: 'Editor',
    collapsible: false
  });

  const deck = new Deck({
    parent: host,
    initialViewState,
    controller: {doubleClickZoom: false},
    onResize: () => {
      map.resize();
    },
    widgets: [trayWidget, toolbarWidget, infoWidget],
    onViewStateChange: ({viewState: {longitude, latitude, zoom, bearing, pitch}}) => {
      map.jumpTo({center: [longitude, latitude], zoom, bearing, pitch});
    },
    onClick: ({index}) => {
      if (mode === ViewMode) {
        selectedFeatureIndexes = index >= 0 ? [index] : [];
        updateDeck();
      }
    }
  });
  updateDeck();

  return () => {
    deck.finalize();
    map.remove();
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

    const layer = new EditableGeoJsonLayer({
      data: geoJson,
      mode,
      modeConfig: booleanOperation ? {booleanOperation} : {},
      selectedFeatureIndexes,
      onEdit: ({updatedData}) => {
        geoJson = updatedData;
        updateDeck();
      }
    });
    deck.setProps({layers: [layer], getCursor: layer.getCursor.bind(layer)});
  }
}
