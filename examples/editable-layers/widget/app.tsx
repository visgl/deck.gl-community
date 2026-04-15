// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {MapboxOverlay} from '@deck.gl/mapbox';
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
  type EditModeTrayWidgetModeOption
} from '@deck.gl-community/editable-layers';
import {
  BoxWidget,
  ColumnPanel,
  CustomPanel,
  MarkdownPanel,
  type WidgetPanel
} from '@deck.gl-community/widgets';
import maplibregl from 'maplibre-gl';
import type {FeatureCollection} from 'geojson';

import '@deck.gl/widgets/stylesheet.css';
import 'maplibre-gl/dist/maplibre-gl.css';

type BooleanOperation = 'union' | 'difference' | 'intersection' | null;

type WidgetExampleState = {
  geoJson: FeatureCollection;
  selectedFeatureIndexes: number[];
  selectedModeId: string;
  booleanOperation: BooleanOperation;
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const INITIAL_VIEW_STATE = {
  longitude: -122.43,
  latitude: 37.775,
  zoom: 12
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

const CONTROL_SECTION_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
} as const;

const CONTROL_BUTTON_GROUP_STYLE = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px'
} as const;

const CONTROL_BUTTON_STYLE = {
  appearance: 'none',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  borderRadius: '999px',
  background: 'rgba(15, 23, 42, 0.4)',
  color: '#e2e8f0',
  padding: '6px 12px',
  fontSize: '13px',
  lineHeight: '1.2',
  cursor: 'pointer',
  transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease'
} as const;

const CONTROL_BUTTON_ACTIVE_STYLE = {
  background: '#2563eb',
  color: '#f8fafc',
  borderColor: '#2563eb'
} as const;

const MODE_OPTIONS: EditModeTrayWidgetModeOption[] = [
  {id: 'view', mode: ViewMode, icon: '👆', title: 'View mode', label: 'View'},
  {id: 'draw-point', mode: DrawPointMode, icon: '•', title: 'Draw point', label: 'Point'},
  {id: 'draw-line', mode: DrawLineStringMode, icon: '╱', title: 'Draw line string', label: 'Line'},
  {id: 'draw-polygon', mode: DrawPolygonMode, icon: '⬠', title: 'Draw polygon', label: 'Polygon'},
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
  },
  {
    id: 'measure-distance',
    mode: MeasureDistanceMode,
    icon: '📏',
    title: 'Measure distance',
    label: 'Distance'
  },
  {id: 'measure-angle', mode: MeasureAngleMode, icon: '∠', title: 'Measure angle', label: 'Angle'},
  {id: 'measure-area', mode: MeasureAreaMode, icon: '▢', title: 'Measure area', label: 'Area'}
];

const BOOLEAN_OPERATION_OPTIONS: Array<{
  id: string;
  label: string;
  description: string;
  value: BooleanOperation;
}> = [
  {
    id: 'none',
    label: 'Edit geometries',
    description: 'Use edit handles to modify shapes.',
    value: null
  },
  {
    id: 'difference',
    label: 'Subtract',
    description: 'Cut selected features from each other.',
    value: 'difference'
  },
  {
    id: 'union',
    label: 'Union',
    description: 'Merge overlapping polygons together.',
    value: 'union'
  },
  {
    id: 'intersection',
    label: 'Intersect',
    description: 'Keep only the overlapping regions.',
    value: 'intersection'
  }
];

export function mountEditableLayersWidgetExample(container: HTMLElement): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  const mapElement = container.ownerDocument.createElement('div');

  applyElementStyle(rootElement, ROOT_STYLE);
  applyElementStyle(mapElement, MAP_CONTAINER_STYLE);
  rootElement.append(mapElement);
  container.replaceChildren(rootElement);

  const state: WidgetExampleState = {
    geoJson: getDefaultGeoJSON(),
    selectedFeatureIndexes: [0],
    selectedModeId: 'view',
    booleanOperation: null
  };

  const trayWidget = new EditModeTrayWidget({
    placement: 'top-left',
    layout: 'vertical',
    style: {margin: '16px 0 0 16px'}
  });

  const infoWidget = new BoxWidget({
    id: 'editable-layers-widget-info',
    placement: 'top-right',
    widthPx: 320,
    title: 'Editor',
    collapsible: false
  });

  const deckOverlay = new MapboxOverlay({
    interleaved: true,
    layers: buildLayers(state, handleEdit, handleFeatureClick),
    widgets: [trayWidget, infoWidget],
    getCursor: getCursor(state),
    onClick: undefined
  });

  const map = new maplibregl.Map({
    container: mapElement,
    style: MAP_STYLE,
    center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
    zoom: INITIAL_VIEW_STATE.zoom
  });

  map.doubleClickZoom.disable();
  map.addControl(deckOverlay);

  syncTrayWidget();
  syncInfoWidget();

  return () => {
    map.removeControl(deckOverlay);
    deckOverlay.finalize();
    map.remove();
    rootElement.remove();
    container.replaceChildren();
  };

  function handleEdit(updatedData: FeatureCollection) {
    state.geoJson = updatedData;
    syncOverlay();
    syncInfoWidget();
  }

  function handleFeatureClick(info: {index?: number}) {
    if (state.selectedModeId !== 'view') {
      return;
    }

    const index = typeof info?.index === 'number' && info.index >= 0 ? info.index : null;
    state.selectedFeatureIndexes = index !== null ? [index] : [];
    syncOverlay();
    syncInfoWidget();
  }

  function syncOverlay() {
    deckOverlay.setProps({
      layers: buildLayers(state, handleEdit, handleFeatureClick),
      getCursor: getCursor(state),
      onClick: undefined,
      widgets: [trayWidget, infoWidget]
    });
  }

  function syncTrayWidget() {
    const activeMode = getModeOption(state.selectedModeId)?.mode ?? ViewMode;
    trayWidget.setProps({
      modes: MODE_OPTIONS,
      activeMode,
      selectedModeId: state.selectedModeId,
      onSelectMode: ({id}) => {
        if (state.selectedModeId === id) {
          return;
        }
        state.selectedModeId = id;
        state.booleanOperation = null;
        syncTrayWidget();
        syncOverlay();
        syncInfoWidget();
      }
    });
  }

  function syncInfoWidget() {
    infoWidget.setProps({
      panel: buildInfoPanel(state, {
        onSetBooleanOperation: (booleanOperation) => {
          state.booleanOperation = booleanOperation;
          syncOverlay();
          syncInfoWidget();
        },
        onReset: () => {
          state.geoJson = getDefaultGeoJSON();
          state.selectedFeatureIndexes = [0];
          state.selectedModeId = 'view';
          state.booleanOperation = null;
          syncTrayWidget();
          syncOverlay();
          syncInfoWidget();
        },
        onClear: () => {
          state.geoJson = {type: 'FeatureCollection', features: []};
          state.selectedFeatureIndexes = [];
          syncOverlay();
          syncInfoWidget();
        }
      })
    });
  }
}

function buildLayers(
  state: WidgetExampleState,
  onEdit: (updatedData: FeatureCollection) => void,
  onFeatureClick: (info: {index?: number}) => void
) {
  return [
    new EditableGeoJsonLayer({
      id: 'editable-layers-widget-geojson',
      data: state.geoJson,
      mode: getModeOption(state.selectedModeId)?.mode ?? ViewMode,
      modeConfig: state.booleanOperation ? {booleanOperation: state.booleanOperation} : {},
      selectedFeatureIndexes: state.selectedFeatureIndexes,
      onClick: state.selectedModeId === 'view' ? onFeatureClick : undefined,
      onEdit: ({updatedData}) => {
        onEdit(updatedData as FeatureCollection);
      }
    })
  ];
}

function getCursor(state: WidgetExampleState) {
  const layer = new EditableGeoJsonLayer({
    id: 'editable-layers-widget-cursor',
    data: state.geoJson,
    mode: getModeOption(state.selectedModeId)?.mode ?? ViewMode,
    modeConfig: state.booleanOperation ? {booleanOperation: state.booleanOperation} : {},
    selectedFeatureIndexes: state.selectedFeatureIndexes
  });
  return layer.getCursor.bind(layer);
}

function getModeOption(id: string): EditModeTrayWidgetModeOption | undefined {
  return MODE_OPTIONS.find((option) => option.id === id);
}

function createButton(ownerDocument: Document, label: string, onClick: () => void) {
  const button = ownerDocument.createElement('button');
  button.type = 'button';
  button.textContent = label;
  applyElementStyle(button, CONTROL_BUTTON_STYLE);
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
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
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
  } as FeatureCollection;
}

function buildInfoPanel(
  state: WidgetExampleState,
  {
    onSetBooleanOperation,
    onReset,
    onClear
  }: {
    onSetBooleanOperation: (booleanOperation: BooleanOperation) => void;
    onReset: () => void;
    onClear: () => void;
  }
): WidgetPanel {
  return new ColumnPanel({
    id: 'editable-layers-widget-info-panel',
    title: '',
    panels: {
      summary: new MarkdownPanel({
        id: 'summary',
        title: '',
        markdown: [
          'Primary editable-layers editor built from generic deck.gl widgets without a React shell.',
          '',
          `- Mode: **${getModeOption(state.selectedModeId)?.label ?? 'View'}**`,
          `- Boolean op: **${state.booleanOperation ?? 'edit'}**`,
          `- Features: **${state.geoJson.features.length}**`,
          `- Selected: **${
            state.selectedFeatureIndexes.length > 0
              ? state.selectedFeatureIndexes.join(', ')
              : 'none'
          }**`
        ].join('\n')
      }),
      booleanOps: new CustomPanel({
        id: 'boolean-operations',
        title: 'Boolean operations',
        onRenderHTML: (host) => {
          const ownerDocument = host.ownerDocument;
          const section = ownerDocument.createElement('section');
          const description = ownerDocument.createElement('p');
          const buttons = ownerDocument.createElement('div');

          applyElementStyle(section, CONTROL_SECTION_STYLE);
          applyElementStyle(buttons, CONTROL_BUTTON_GROUP_STYLE);
          applyElementStyle(description, {margin: '0', fontSize: '13px', color: '#475569'});
          description.textContent = 'Apply when drawing overlapping polygons.';

          for (const option of BOOLEAN_OPERATION_OPTIONS) {
            const button = createButton(ownerDocument, option.label, () => {
              onSetBooleanOperation(option.value);
            });

            if (option.value === state.booleanOperation) {
              applyElementStyle(button, CONTROL_BUTTON_ACTIVE_STYLE);
            }

            button.title = option.description;
            button.setAttribute(
              'aria-pressed',
              option.value === state.booleanOperation ? 'true' : 'false'
            );
            buttons.append(button);
          }

          section.append(description, buttons);
          host.replaceChildren(section);
        }
      }),
      dataset: new CustomPanel({
        id: 'dataset',
        title: 'Dataset',
        onRenderHTML: (host) => {
          const ownerDocument = host.ownerDocument;
          const section = ownerDocument.createElement('section');
          const status = ownerDocument.createElement('p');
          const buttons = ownerDocument.createElement('div');
          const resetButton = createButton(ownerDocument, 'Reset example', onReset);
          const clearButton = createButton(ownerDocument, 'Clear features', onClear);

          applyElementStyle(section, CONTROL_SECTION_STYLE);
          applyElementStyle(status, {margin: '0', fontSize: '13px', color: '#475569'});
          applyElementStyle(buttons, CONTROL_BUTTON_GROUP_STYLE);
          applyElementStyle(clearButton, {
            color: '#b91c1c',
            borderColor: 'rgba(239, 68, 68, 0.35)'
          });

          status.textContent = `Features: ${state.geoJson.features.length} | Selected: ${
            state.selectedFeatureIndexes.length > 0
              ? state.selectedFeatureIndexes.join(', ')
              : 'none'
          }`;

          buttons.append(resetButton, clearButton);
          section.append(status, buttons);
          host.replaceChildren(section);
        }
      })
    }
  });
}
