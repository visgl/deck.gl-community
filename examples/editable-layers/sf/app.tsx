// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {MapboxOverlay} from '@deck.gl/mapbox';
import {
  ViewMode,
  ModifyMode,
  EditableGeoJsonLayer,
  SelectionLayer
} from '@deck.gl-community/editable-layers';
import {
  BoxWidget,
  ColumnPanel,
  CustomPanel,
  MarkdownPanel
} from '@deck.gl-community/widgets';
import maplibregl from 'maplibre-gl';
import type {FeatureCollection} from 'geojson';

import testPolygons from '../data/sf-polygons';

import '@deck.gl/widgets/stylesheet.css';
import 'maplibre-gl/dist/maplibre-gl.css';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const INITIAL_VIEW_STATE = {
  bearing: 0,
  latitude: 37.7,
  longitude: -122.4,
  pitch: 0,
  zoom: 10
};

const ROOT_STYLE = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: '100%'
} as const;

const MAP_CONTAINER_STYLE = {
  position: 'absolute',
  inset: '0'
} as const;

const BUTTON_GROUP_STYLE = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px'
} as const;

const BUTTON_STYLE = {
  appearance: 'none',
  padding: '6px 14px',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: 'rgba(15, 23, 42, 0.05)',
  color: 'rgb(30, 41, 59)',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: '500'
} as const;

const BUTTON_ACTIVE_STYLE = {
  background: '#2563eb',
  borderColor: '#2563eb',
  color: '#f8fafc'
} as const;

type SfExampleState = {
  testFeatures: FeatureCollection;
  selectedFeatureIndexes: number[];
  allowEdit: boolean;
  selectionType: string | null;
};

export function mountSfExample(container: HTMLElement): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  const mapElement = container.ownerDocument.createElement('div');

  applyElementStyle(rootElement, ROOT_STYLE);
  applyElementStyle(mapElement, MAP_CONTAINER_STYLE);
  rootElement.append(mapElement);
  container.replaceChildren(rootElement);

  const state: SfExampleState = {
    testFeatures: {
      type: 'FeatureCollection',
      features: testPolygons as any
    },
    selectedFeatureIndexes: [],
    allowEdit: true,
    selectionType: null
  };

  const infoWidget = new BoxWidget({
    id: 'sf-polygons-info',
    placement: 'top-left',
    widthPx: 320,
    title: 'SF Polygons',
    collapsible: false
  });

  const deckOverlay = new MapboxOverlay({
    interleaved: true,
    layers: buildLayers(state, handleEdit, handleSelect, handleFeatureClick),
    widgets: [infoWidget],
    getCursor: getCursor(state)
  });

  const map = new maplibregl.Map({
    container: mapElement,
    style: MAP_STYLE,
    center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
    zoom: INITIAL_VIEW_STATE.zoom,
    bearing: INITIAL_VIEW_STATE.bearing,
    pitch: INITIAL_VIEW_STATE.pitch
  });

  map.doubleClickZoom.disable();
  map.addControl(deckOverlay);

  syncInfoWidget();

  return () => {
    map.removeControl(deckOverlay);
    deckOverlay.finalize();
    map.remove();
    rootElement.remove();
    container.replaceChildren();
  };

  function handleEdit(updatedData: FeatureCollection) {
    if (!state.allowEdit) {
      return;
    }

    state.testFeatures = updatedData;
    syncOverlay();
    syncInfoWidget();
  }

  function handleSelect(indexes: number[]) {
    state.selectedFeatureIndexes = indexes;
    state.selectionType = null;
    syncOverlay();
    syncInfoWidget();
  }

  function handleFeatureClick(info: {index?: number}) {
    const mode = getEditingMode(state);
    if (state.selectedFeatureIndexes.length > 0 && mode !== ViewMode) {
      return;
    }

    if (typeof info?.index === 'number' && info.index >= 0) {
      state.selectedFeatureIndexes = [info.index];
    } else {
      state.selectedFeatureIndexes = [];
    }

    syncOverlay();
    syncInfoWidget();
  }

  function syncOverlay() {
    deckOverlay.setProps({
      layers: buildLayers(state, handleEdit, handleSelect, handleFeatureClick),
      widgets: [infoWidget],
      getCursor: getCursor(state)
    });
  }

  function syncInfoWidget() {
    infoWidget.setProps({
      panel: buildInfoPanel({
        polygonCount: state.testFeatures.features.length,
        selectedFeatureIndexes: state.selectedFeatureIndexes,
        allowEdit: state.allowEdit,
        selectionType: state.selectionType,
        onSetSelectionType: (nextSelectionType) => {
          state.selectionType = nextSelectionType;
          syncOverlay();
          syncInfoWidget();
        },
        onToggleAllowEdit: () => {
          state.allowEdit = !state.allowEdit;
          syncOverlay();
          syncInfoWidget();
        }
      })
    });
  }
}

function buildLayers(
  state: SfExampleState,
  onEdit: (updatedData: FeatureCollection) => void,
  onSelect: (indexes: number[]) => void,
  onFeatureClick: (info: {index?: number}) => void
) {
  const mode = getEditingMode(state);

  return [
    new EditableGeoJsonLayer({
      id: 'geojson',
      data: state.testFeatures,
      selectedFeatureIndexes: state.selectedFeatureIndexes,
      pickable: true,
      mode,
      onClick: onFeatureClick,
      onEdit: ({updatedData}) => {
        onEdit(updatedData as FeatureCollection);
      },
      getFillColor: [0x00, 0x20, 0x70, 0x30],
      getLineColor: [0x00, 0x20, 0x70, 0xc0],
      getLineWidth: 3,
      lineWidthMinPixels: 2,
      lineWidthMaxPixels: 10
    }),
    new SelectionLayer({
      id: 'selection',
      selectionType: state.selectionType,
      onSelect: ({pickingInfos}) => {
        onSelect(pickingInfos.map((pickingInfo) => pickingInfo.index));
      },
      layerIds: ['geojson'],
      getTentativeFillColor: () => [255, 0, 255, 100],
      getTentativeLineColor: () => [0, 0, 255, 255],
      getTentativeLineDashArray: () => [0, 0],
      lineWidthMinPixels: 1
    })
  ];
}

function buildInfoPanel({
  polygonCount,
  selectedFeatureIndexes,
  allowEdit,
  selectionType,
  onSetSelectionType,
  onToggleAllowEdit
}: {
  polygonCount: number;
  selectedFeatureIndexes: number[];
  allowEdit: boolean;
  selectionType: string | null;
  onSetSelectionType: (nextSelectionType: string) => void;
  onToggleAllowEdit: () => void;
}) {
  return new ColumnPanel({
    id: 'sf-polygons-info-panel',
    title: '',
    panels: {
      summary: new MarkdownPanel({
        id: 'summary',
        title: '',
        markdown: [
          'Select polygons by rectangle or lasso, then edit the current selection directly on the map.',
          '',
          `- Polygons: **${polygonCount}**`,
          `- Selected: **${
            selectedFeatureIndexes.length > 0 ? selectedFeatureIndexes.join(', ') : 'none'
          }**`,
          `- Editing: **${allowEdit ? 'enabled' : 'disabled'}**`
        ].join('\n')
      }),
      actions: new CustomPanel({
        id: 'actions',
        title: 'Selection',
        onRenderHTML: (host) => {
          const ownerDocument = host.ownerDocument;
          const buttonGroup = ownerDocument.createElement('div');

          applyElementStyle(buttonGroup, BUTTON_GROUP_STYLE);
          buttonGroup.append(
            createButton(
              ownerDocument,
              'Select by Rectangle',
              selectionType === 'rectangle',
              () => onSetSelectionType('rectangle')
            ),
            createButton(ownerDocument, 'Select by Polygon', selectionType === 'polygon', () =>
              onSetSelectionType('polygon')
            ),
            createButton(ownerDocument, `Allow Edit: ${allowEdit ? 'Yes' : 'No'}`, allowEdit, () =>
              onToggleAllowEdit()
            )
          );

          host.replaceChildren(buttonGroup);
        }
      })
    }
  });
}

function getCursor(state: SfExampleState) {
  const editableGeoJsonLayer = new EditableGeoJsonLayer({
    id: 'sf-polygons-cursor',
    data: state.testFeatures,
    selectedFeatureIndexes: state.selectedFeatureIndexes,
    pickable: true,
    mode: getEditingMode(state)
  });

  return editableGeoJsonLayer.getCursor.bind(editableGeoJsonLayer);
}

function getEditingMode(state: SfExampleState) {
  return state.selectedFeatureIndexes.length > 0 ? ModifyMode : ViewMode;
}

function createButton(
  ownerDocument: Document,
  label: string,
  active: boolean,
  onClick: () => void
) {
  const button = ownerDocument.createElement('button');
  button.type = 'button';
  button.textContent = label;
  applyElementStyle(button, BUTTON_STYLE);
  if (active) {
    applyElementStyle(button, BUTTON_ACTIVE_STYLE);
  }
  button.onclick = onClick;
  return button;
}

function applyElementStyle(element: HTMLElement, style: Record<string, string>) {
  for (const [key, value] of Object.entries(style)) {
    element.style.setProperty(camelCaseToKebabCase(key), value);
  }
}

function camelCaseToKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}
