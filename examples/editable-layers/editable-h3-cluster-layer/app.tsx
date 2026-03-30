// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {MapboxOverlay} from '@deck.gl/mapbox';
import {
  EditableH3ClusterLayer,
  DrawPointMode,
  DrawPolygonMode,
  DrawCircleFromCenterMode,
  DrawRectangleMode,
  EditModeTrayWidget,
  type EditModeTrayWidgetModeOption
} from '@deck.gl-community/editable-layers';
import {
  BoxWidget,
  ColumnWidgetPanel,
  MarkdownWidgetPanel,
  ToolbarWidget,
  type ToolbarWidgetItem
} from '@deck.gl-community/widgets';
import maplibregl from 'maplibre-gl';

import {hexagonCluster1, hexagonCluster2, hexagonCluster3} from './data';

import '@deck.gl/widgets/stylesheet.css';
import 'maplibre-gl/dist/maplibre-gl.css';

type ClusterDatum = {
  hexIds: string[];
};

type BooleanOperation = 'union' | 'difference' | 'intersection' | null;

type EditableH3State = {
  data: ClusterDatum[];
  selectedModeId: string;
  booleanOperation: BooleanOperation;
  selectedIndexes: number[];
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

const SELECTED_FILL_COLOR = [50, 100, 200, 230] as const;
const UNSELECTED_FILL_COLOR = [50, 100, 200, 100] as const;

const MODE_OPTIONS: EditModeTrayWidgetModeOption[] = [
  {id: 'draw-polygon', mode: DrawPolygonMode, icon: '⬠', title: 'Draw polygon', label: 'Polygon'},
  {
    id: 'draw-circle',
    mode: DrawCircleFromCenterMode,
    icon: '◯',
    title: 'Draw circle',
    label: 'Circle'
  },
  {
    id: 'draw-rectangle',
    mode: DrawRectangleMode,
    icon: '▭',
    title: 'Draw rectangle',
    label: 'Rectangle'
  },
  {id: 'draw-point', mode: DrawPointMode, icon: '•', title: 'Draw point', label: 'Point'}
];

const INITIAL_DATA: ClusterDatum[] = [
  {hexIds: [...hexagonCluster1]},
  {hexIds: [...hexagonCluster2]},
  {hexIds: [...hexagonCluster3]}
];

export function mountEditableH3ClusterLayerExample(container: HTMLElement): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  const mapElement = container.ownerDocument.createElement('div');

  applyElementStyle(rootElement, ROOT_STYLE);
  applyElementStyle(mapElement, MAP_CONTAINER_STYLE);
  rootElement.append(mapElement);
  container.replaceChildren(rootElement);

  const state: EditableH3State = {
    data: INITIAL_DATA.map((cluster) => ({hexIds: [...cluster.hexIds]})),
    selectedModeId: 'draw-polygon',
    booleanOperation: 'union',
    selectedIndexes: [0]
  };

  const trayWidget = new EditModeTrayWidget({
    placement: 'top-left',
    layout: 'vertical',
    style: {margin: '16px 0 0 16px'}
  });

  const toolbarWidget = new ToolbarWidget({
    placement: 'top-right',
    style: {margin: '16px 16px 0 0'}
  });

  const infoWidget = new BoxWidget({
    id: 'editable-h3-info',
    placement: 'bottom-right',
    widthPx: 320,
    title: 'Editable H3 Cluster Layer',
    collapsible: false
  });

  const deckOverlay = new MapboxOverlay({
    interleaved: false,
    layers: buildLayers(state, handleEdit),
    widgets: [trayWidget, toolbarWidget, infoWidget],
    getCursor: getCursor(state)
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
  syncToolbarWidget();
  syncInfoWidget();

  return () => {
    map.removeControl(deckOverlay);
    deckOverlay.finalize();
    map.remove();
    rootElement.remove();
    container.replaceChildren();
  };

  function handleEdit(updatedData: ClusterDatum[]) {
    if (updatedData !== state.data) {
      state.data = updatedData;
      syncOverlay();
      syncToolbarWidget();
      syncInfoWidget();
    }
  }

  function syncOverlay() {
    deckOverlay.setProps({
      layers: buildLayers(state, handleEdit),
      widgets: [trayWidget, toolbarWidget, infoWidget],
      getCursor: getCursor(state)
    });
  }

  function syncTrayWidget() {
    const activeMode = getModeOption(state.selectedModeId)?.mode ?? DrawPolygonMode;
    trayWidget.setProps({
      modes: MODE_OPTIONS,
      activeMode,
      selectedModeId: state.selectedModeId,
      onSelectMode: ({id}) => {
        if (state.selectedModeId === id) {
          return;
        }

        state.selectedModeId = id;
        syncTrayWidget();
        syncOverlay();
        syncInfoWidget();
      }
    });
  }

  function syncToolbarWidget() {
    toolbarWidget.setProps({
      items: buildToolbarItems({
        booleanOperation: state.booleanOperation,
        clusterCount: state.data.length,
        selectedIndexes: state.selectedIndexes,
        onSetBooleanOperation: (booleanOperation) => {
          state.booleanOperation = booleanOperation;
          syncOverlay();
          syncToolbarWidget();
          syncInfoWidget();
        },
        onToggleClusterSelection: (index) => {
          state.selectedIndexes = state.selectedIndexes.includes(index)
            ? state.selectedIndexes.filter((selectedIndex) => selectedIndex !== index)
            : [...state.selectedIndexes, index];
          syncOverlay();
          syncToolbarWidget();
          syncInfoWidget();
        }
      })
    });
  }

  function syncInfoWidget() {
    const modeLabel = getModeOption(state.selectedModeId)?.label ?? 'Polygon';
    infoWidget.setProps({
      panel: buildInfoPanel({
        modeLabel,
        booleanOperation: state.booleanOperation,
        clusterCount: state.data.length,
        selectedIndexes: state.selectedIndexes
      })
    });
  }
}

function buildLayers(
  state: EditableH3State,
  onEdit: (updatedData: ClusterDatum[]) => void
) {
  return [
    new EditableH3ClusterLayer<ClusterDatum>({
      data: state.data,
      getHexagons: (cluster) => cluster.hexIds,
      getEditedCluster: (updatedHexagonIDs, existingCluster) => {
        if (existingCluster) {
          return {
            ...existingCluster,
            hexIds: updatedHexagonIDs
          };
        }
        return {
          hexIds: updatedHexagonIDs
        };
      },
      selectedIndexes: state.selectedIndexes,
      resolution: 9,
      modeConfig: {
        booleanOperation: state.booleanOperation
      },
      mode: getModeOption(state.selectedModeId)?.mode ?? DrawPolygonMode,
      onEdit: ({updatedData}) => {
        onEdit(updatedData as ClusterDatum[]);
      },
      _subLayerProps: {
        'tentative-hexagons': {
          getFillColor: getTentativeFillColor(state.booleanOperation)
        },
        hexagons: {
          getFillColor: (cluster) => {
            if (state.selectedIndexes.some((index) => state.data[index] === cluster)) {
              return SELECTED_FILL_COLOR;
            }
            return UNSELECTED_FILL_COLOR;
          },
          updateTriggers: {
            getFillColor: [state.data, state.selectedIndexes]
          }
        }
      }
    })
  ];
}

function buildToolbarItems({
  booleanOperation,
  clusterCount,
  selectedIndexes,
  onSetBooleanOperation,
  onToggleClusterSelection
}: {
  booleanOperation: BooleanOperation;
  clusterCount: number;
  selectedIndexes: number[];
  onSetBooleanOperation: (booleanOperation: BooleanOperation) => void;
  onToggleClusterSelection: (index: number) => void;
}): ToolbarWidgetItem[] {
  return [
    {
      kind: 'toggle-group',
      id: 'boolean-operation',
      label: 'Boolean',
      selectedId: booleanOperation ?? 'edit',
      options: [
        {id: 'edit', label: 'Edit', title: 'Draw without a boolean operation'},
        {id: 'union', label: 'Union', title: 'Merge with the selected cluster'},
        {id: 'difference', label: 'Subtract', title: 'Subtract from the selected cluster'},
        {id: 'intersection', label: 'Intersect', title: 'Keep only overlaps'}
      ],
      onSelect: (optionId) => {
        onSetBooleanOperation(optionId === 'edit' ? null : (optionId as Exclude<BooleanOperation, null>));
      }
    },
    ...Array.from({length: clusterCount}, (_, index): ToolbarWidgetItem => ({
      kind: 'action',
      id: `cluster-${index}`,
      label: `Cluster ${index + 1}`,
      title: `Select cluster ${index + 1}`,
      active: selectedIndexes.includes(index),
      onClick: () => {
        onToggleClusterSelection(index);
      }
    })),
    {
      kind: 'badge',
      id: 'cluster-count',
      label: `${clusterCount} clusters`
    }
  ];
}

function buildInfoPanel({
  modeLabel,
  booleanOperation,
  clusterCount,
  selectedIndexes
}: {
  modeLabel: string;
  booleanOperation: BooleanOperation;
  clusterCount: number;
  selectedIndexes: number[];
}) {
  return new ColumnWidgetPanel({
    id: 'editable-h3-info-panel',
    title: '',
    panels: {
      summary: new MarkdownWidgetPanel({
        id: 'summary',
        title: '',
        markdown: [
          'Edit clusters of H3 cells with widget-based controls.',
          '',
          `- Mode: **${modeLabel}**`,
          `- Boolean op: **${booleanOperation ?? 'edit'}**`,
          `- Clusters: **${clusterCount}**`,
          `- Selected: **${
            selectedIndexes.length > 0 ? selectedIndexes.map((index) => index + 1).join(', ') : 'none'
          }**`
        ].join('\n')
      })
    }
  });
}

function getCursor(state: EditableH3State) {
  const layer = new EditableH3ClusterLayer<ClusterDatum>({
    data: state.data,
    getHexagons: (cluster) => cluster.hexIds,
    selectedIndexes: state.selectedIndexes,
    resolution: 9,
    modeConfig: {
      booleanOperation: state.booleanOperation
    },
    mode: getModeOption(state.selectedModeId)?.mode ?? DrawPolygonMode
  });

  return layer.getCursor.bind(layer);
}

function getTentativeFillColor(booleanOperation: BooleanOperation) {
  switch (booleanOperation) {
    case 'union':
      return [50, 100, 200, 100];
    case 'difference':
      return [200, 100, 100, 100];
    case 'intersection':
    default:
      return [200, 150, 100, 100];
  }
}

function getModeOption(id: string): EditModeTrayWidgetModeOption | undefined {
  return MODE_OPTIONS.find((option) => option.id === id);
}

function applyElementStyle(element: HTMLElement, style: Record<string, string>) {
  for (const [key, value] of Object.entries(style)) {
    element.style.setProperty(camelCaseToKebabCase(key), value);
  }
}

function camelCaseToKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}
