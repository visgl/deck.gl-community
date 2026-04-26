// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, OrthographicView} from '@deck.gl/core';
import type {OrthographicViewState} from '@deck.gl/core';
import {BitmapLayer} from '@deck.gl/layers';
import {
  ViewMode,
  DrawPointMode,
  DrawLineStringMode,
  DrawPolygonMode,
  DrawRectangleMode,
  DrawCircleFromCenterMode,
  ModifyMode,
  TranslateMode,
  EditableGeoJsonLayer,
  EditModeTrayWidget,
  type EditModeTrayWidgetModeOption,
  type GeoJsonEditModeConstructor,
  type GeoJsonEditModeType
} from '@deck.gl-community/editable-layers';
import {ColumnPanel, MarkdownPanel} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';
import type {FeatureCollection} from 'geojson';

import '@deck.gl/widgets/stylesheet.css';

// Bird image used as a non-map background
// Source: JJ Harrison - CC BY-SA 4.0
// https://en.wikipedia.org/wiki/Wikipedia:Featured_pictures/Animals/Birds
const BACKGROUND_IMAGE =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Dendrocygna_eytoni_-_Macquarie_University.jpg/1280px-Dendrocygna_eytoni_-_Macquarie_University.jpg';

// Bounds: [left, top, right, bottom] - OrthographicView pixel coordinates
const IMAGE_BOUNDS: [number, number, number, number] = [10, 8, -10, -8];

const INITIAL_VIEW_STATE: OrthographicViewState = {
  target: [0, 0, 0],
  zoom: 5
};

const ROOT_STYLE = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: '100%'
} as const;

const MODE_OPTIONS: EditModeTrayWidgetModeOption[] = [
  {id: 'view', mode: ViewMode, icon: '👆', title: 'View mode', label: 'View'},
  {id: 'modify', mode: ModifyMode, icon: '✎', title: 'Modify vertices', label: 'Modify'},
  {id: 'translate', mode: TranslateMode, icon: '↔', title: 'Move features', label: 'Move'},
  {id: 'draw-point', mode: DrawPointMode, icon: '•', title: 'Draw point', label: 'Point'},
  {
    id: 'draw-line',
    mode: DrawLineStringMode,
    icon: '╱',
    title: 'Draw line string',
    label: 'Line'
  },
  {
    id: 'draw-polygon',
    mode: DrawPolygonMode,
    icon: '⬠',
    title: 'Draw polygon',
    label: 'Polygon'
  },
  {
    id: 'draw-rectangle',
    mode: DrawRectangleMode,
    icon: '▭',
    title: 'Draw rectangle',
    label: 'Rectangle'
  },
  {
    id: 'draw-circle',
    mode: DrawCircleFromCenterMode,
    icon: '◯',
    title: 'Draw circle',
    label: 'Circle'
  }
];

type ModeType = GeoJsonEditModeConstructor | GeoJsonEditModeType;

type NoMapState = {
  geoJson: FeatureCollection;
  selectedFeatureIndexes: number[];
  mode: ModeType;
};

export function mountNoMapExample(container: HTMLElement): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  applyElementStyle(rootElement, ROOT_STYLE);
  container.replaceChildren(rootElement);

  const state: NoMapState = {
    geoJson: getDefaultGeoJSON(),
    selectedFeatureIndexes: [0],
    mode: ViewMode
  };

  const trayWidget = new EditModeTrayWidget({
    placement: 'top-left',
    layout: 'vertical',
    style: {margin: '16px 0 0 16px'}
  });

  const infoWidget = new BoxPanelWidget({
    id: 'no-map-info',
    placement: 'top-right',
    widthPx: 320,
    title: 'No Map',
    collapsible: false
  });

  const deck = new Deck({
    parent: rootElement,
    views: new OrthographicView(),
    initialViewState: INITIAL_VIEW_STATE,
    controller: {doubleClickZoom: false},
    layers: buildLayers(state, handleEdit, handleFeatureClick),
    widgets: [trayWidget, infoWidget],
    getCursor: getCursor(state)
  });

  syncTrayWidget();
  syncInfoWidget();

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };

  function handleEdit(updatedData: FeatureCollection) {
    state.geoJson = updatedData;
    syncDeck();
    syncInfoWidget();
  }

  function handleFeatureClick(info: {index?: number}) {
    if (state.mode !== ViewMode) {
      return;
    }

    if (typeof info?.index === 'number' && info.index >= 0) {
      state.selectedFeatureIndexes = [info.index];
    } else {
      state.selectedFeatureIndexes = [];
    }

    syncDeck();
    syncInfoWidget();
  }

  function syncDeck() {
    deck.setProps({
      layers: buildLayers(state, handleEdit, handleFeatureClick),
      widgets: [trayWidget, infoWidget],
      getCursor: getCursor(state)
    });
  }

  function syncTrayWidget() {
    const selected = MODE_OPTIONS.find(option => option.mode === state.mode)?.id ?? null;
    trayWidget.setProps({
      modes: MODE_OPTIONS,
      activeMode: state.mode,
      selectedModeId: selected,
      onSelectMode: ({mode: selectedMode}) => {
        if (state.mode === selectedMode) {
          return;
        }

        state.mode = selectedMode;
        syncTrayWidget();
        syncDeck();
        syncInfoWidget();
      }
    });
  }

  function syncInfoWidget() {
    const modeLabel = MODE_OPTIONS.find(option => option.mode === state.mode)?.label ?? 'View';
    infoWidget.setProps({
      panel: buildInfoPanel({
        modeLabel,
        featureCount: state.geoJson.features.length,
        selectedFeatureIndexes: state.selectedFeatureIndexes
      })
    });
  }
}

function buildLayers(
  state: NoMapState,
  onEdit: (updatedData: FeatureCollection) => void,
  onFeatureClick: (info: {index?: number}) => void
) {
  return [
    new BitmapLayer({
      id: 'background-image',
      bounds: IMAGE_BOUNDS,
      image: BACKGROUND_IMAGE,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    }),
    new EditableGeoJsonLayer({
      id: 'editable-geojson',
      data: state.geoJson,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      mode: state.mode,
      selectedFeatureIndexes: state.selectedFeatureIndexes,
      onClick: state.mode === ViewMode ? onFeatureClick : undefined,
      onEdit: ({updatedData}) => {
        onEdit(updatedData as FeatureCollection);
      },
      getFillColor: (feature, isSelected) => (isSelected ? [0, 200, 110, 150] : [0, 100, 200, 130]),
      getLineColor: (feature, isSelected) => (isSelected ? [2, 107, 60, 130] : [0, 77, 153, 100]),
      getLineWidth: 2,
      lineWidthMinPixels: 2,
      pointRadiusMinPixels: 6,
      editHandlePointRadiusMinPixels: 5,
      autoHighlight: true
    })
  ];
}

function buildInfoPanel({
  modeLabel,
  featureCount,
  selectedFeatureIndexes
}: {
  modeLabel: string;
  featureCount: number;
  selectedFeatureIndexes: number[];
}) {
  return new ColumnPanel({
    id: 'no-map-info-panel',
    title: '',
    panels: {
      summary: new MarkdownPanel({
        id: 'summary',
        title: '',
        markdown: [
          'Edit GeoJSON features without a basemap.',
          '',
          'This demo uses an OrthographicView with Cartesian coordinates and a bitmap bird photo as the background layer.',
          '',
          `- Mode: **${modeLabel}**`,
          `- Features: **${featureCount}**`,
          `- Selected: **${
            selectedFeatureIndexes.length > 0 ? selectedFeatureIndexes.join(', ') : 'none'
          }**`
        ].join('\n')
      })
    }
  });
}

function getCursor(state: NoMapState) {
  const editableLayer = new EditableGeoJsonLayer({
    id: 'editable-geojson-cursor',
    data: state.geoJson,
    mode: state.mode,
    selectedFeatureIndexes: state.selectedFeatureIndexes
  });

  return editableLayer.getCursor.bind(editableLayer);
}

function getDefaultGeoJSON(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-4, -2],
              [-4, 2],
              [0, 2],
              [0, -2],
              [-4, -2]
            ]
          ]
        }
      },
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [5, 3]
        }
      }
    ]
  };
}

function applyElementStyle(element: HTMLElement, style: Record<string, string>) {
  for (const [key, value] of Object.entries(style)) {
    element.style.setProperty(camelCaseToKebabCase(key), value);
  }
}

function camelCaseToKebabCase(value: string) {
  return value.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`);
}
