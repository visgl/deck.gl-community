// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {MapboxOverlay} from '@deck.gl/mapbox';
import {
  BoxWidget,
  ColumnPanel,
  MarkdownPanel,
  SettingsPanel,
  type SettingsSchema,
  type SettingsState
} from '@deck.gl-community/widgets';
import {ViewMode, DrawPolygonMode, EditableGeoJsonLayer} from '@deck.gl-community/editable-layers';
import maplibregl from 'maplibre-gl';
import type {FeatureCollection} from 'geojson';

import '@deck.gl/widgets/stylesheet.css';
import 'maplibre-gl/dist/maplibre-gl.css';

type GettingStartedMode = 'draw' | 'view';

type GettingStartedSettings = {
  editing: {
    mode: GettingStartedMode;
  };
};

type GettingStartedState = {
  settings: GettingStartedSettings;
  geoJson: FeatureCollection;
  selectedFeatureIndexes: number[];
};

type GettingStartedExampleOptions = {
  showControlsWidget?: boolean;
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const INITIAL_VIEW_STATE = {
  longitude: -122.43,
  latitude: 37.775,
  zoom: 12
};

const INITIAL_GEOJSON: FeatureCollection = {
  type: 'FeatureCollection',
  features: []
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

const INITIAL_SETTINGS: GettingStartedSettings = {
  editing: {
    mode: 'draw'
  }
};

const SETTINGS_SCHEMA: SettingsSchema = {
  title: 'Getting Started Controls',
  sections: [
    {
      id: 'editing',
      name: 'Editing',
      initiallyCollapsed: false,
      settings: [
        {
          name: 'editing.mode',
          label: 'Mode',
          type: 'select',
          options: [
            {label: 'Draw Polygon', value: 'draw'},
            {label: 'View / Select', value: 'view'}
          ],
          description: 'Choose between polygon drawing and feature selection.'
        }
      ]
    }
  ]
};

export function mountGettingStartedExample(
  container: HTMLElement,
  options: GettingStartedExampleOptions = {}
): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  const mapElement = container.ownerDocument.createElement('div');
  applyElementStyle(rootElement, ROOT_STYLE);
  applyElementStyle(mapElement, MAP_CONTAINER_STYLE);
  rootElement.append(mapElement);
  container.replaceChildren(rootElement);

  const state: GettingStartedState = {
    settings: cloneSettings(INITIAL_SETTINGS),
    geoJson: cloneFeatureCollection(INITIAL_GEOJSON),
    selectedFeatureIndexes: []
  };

  const controlsWidget =
    options.showControlsWidget === false
      ? null
      : new BoxWidget({
          id: 'getting-started-controls',
          placement: 'top-left',
          widthPx: 320,
          title: 'Getting Started',
          collapsible: false,
          panel: buildControlPanel(state, handleSettingsChange)
        });

  const deckOverlay = new MapboxOverlay({
    interleaved: true,
    layers: buildLayers(state, handleEdit, handleFeatureClick),
    getCursor: getCursor(state),
    widgets: controlsWidget ? [controlsWidget] : []
  });

  const map = new maplibregl.Map({
    container: mapElement,
    style: MAP_STYLE,
    center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
    zoom: INITIAL_VIEW_STATE.zoom
  });

  map.doubleClickZoom.disable();
  map.addControl(deckOverlay);

  return () => {
    map.removeControl(deckOverlay);
    deckOverlay.finalize();
    map.remove();
    rootElement.remove();
    container.replaceChildren();
  };

  function handleSettingsChange(nextSettings: SettingsState) {
    state.settings = cloneSettings(nextSettings as GettingStartedSettings);
    syncOverlay();
    syncWidgets();
  }

  function handleEdit(updatedData: FeatureCollection) {
    state.geoJson = updatedData;
    syncOverlay();
    syncWidgets();
  }

  function handleFeatureClick(info: {index?: number}) {
    if (state.settings.editing.mode !== 'view') {
      return;
    }

    if (typeof info?.index === 'number' && info.index >= 0) {
      state.selectedFeatureIndexes = [info.index];
    } else {
      state.selectedFeatureIndexes = [];
    }

    syncOverlay();
    syncWidgets();
  }

  function syncOverlay() {
    deckOverlay.setProps({
      layers: buildLayers(state, handleEdit, handleFeatureClick),
      getCursor: getCursor(state),
      widgets: controlsWidget ? [controlsWidget] : []
    });
  }

  function syncWidgets() {
    controlsWidget?.setProps({
      panel: buildControlPanel(state, handleSettingsChange)
    });
  }
}

function buildLayers(
  state: GettingStartedState,
  onEdit: (updatedData: FeatureCollection) => void,
  onFeatureClick: (info: {index?: number}) => void
) {
  const mode = state.settings.editing.mode === 'view' ? ViewMode : DrawPolygonMode;

  return [
    new EditableGeoJsonLayer({
      id: 'getting-started-geojson',
      data: state.geoJson,
      mode,
      selectedFeatureIndexes: state.selectedFeatureIndexes,
      onClick:
        state.settings.editing.mode === 'view'
          ? onFeatureClick
          : undefined,
      onEdit: ({updatedData}) => {
        onEdit(updatedData as FeatureCollection);
      }
    })
  ];
}

function buildControlPanel(
  state: GettingStartedState,
  onSettingsChange: (nextSettings: SettingsState) => void
) {
  return new ColumnPanel({
    id: 'getting-started-panel',
    panels: {
      summary: new MarkdownPanel({
        id: 'summary',
        title: '',
        markdown: [
          'Click to place vertices. Double-click to finish a polygon.',
          '',
          `- Mode: **${state.settings.editing.mode === 'draw' ? 'Draw Polygon' : 'View / Select'}**`,
          `- Features: **${state.geoJson.features.length}**`,
          `- Selected: **${
            state.selectedFeatureIndexes.length > 0
              ? state.selectedFeatureIndexes.join(', ')
              : 'none'
          }**`
        ].join('\n')
      }),
      settings: new SettingsPanel({
        id: 'settings',
        label: 'Controls',
        schema: SETTINGS_SCHEMA,
        settings: state.settings,
        onSettingsChange
      })
    }
  });
}

function getCursor(state: GettingStartedState) {
  const mode = state.settings.editing.mode === 'view' ? ViewMode : DrawPolygonMode;
  const layer = new EditableGeoJsonLayer({
    id: 'getting-started-cursor',
    data: state.geoJson,
    mode,
    selectedFeatureIndexes: state.selectedFeatureIndexes
  });
  return layer.getCursor.bind(layer);
}

function cloneSettings(settings: GettingStartedSettings): GettingStartedSettings {
  return {
    editing: {...settings.editing}
  };
}

function cloneFeatureCollection(collection: FeatureCollection): FeatureCollection {
  return {
    ...collection,
    features: collection.features.map((feature) => ({
      ...feature,
      properties: feature.properties ? {...feature.properties} : feature.properties,
      geometry: JSON.parse(JSON.stringify(feature.geometry))
    }))
  };
}

function applyElementStyle(element: HTMLElement, style: Record<string, string>) {
  for (const [key, value] of Object.entries(style)) {
    element.style.setProperty(camelCaseToKebabCase(key), value);
  }
}

function camelCaseToKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}
