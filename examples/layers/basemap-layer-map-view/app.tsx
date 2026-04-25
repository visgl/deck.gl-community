// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, _GlobeView} from '@deck.gl/core';
import {BasemapLayer} from '@deck.gl-community/basemap-layers';
import {
  ColumnPanel,
  MarkdownPanel,
  SettingsPanel,
  type SettingsSchema,
  type SettingsState
} from '../../../modules/panels/src';
import {
  BoxWidget
} from '../../../modules/widgets/src';
import deckLightStyle from '../../../website/static/mapstyle/deck-light.json';

import '@deck.gl/widgets/stylesheet.css';

type ExampleBasemapStyle = typeof deckLightStyle | string | RasterBasemapStyle;

type ExampleStyleOption = {
  id:
    | 'light'
    | 'carto-positron'
    | 'carto-dark-matter'
    | 'carto-voyager'
    | 'carto-positron-nolabels'
    | 'raster-positron'
    | 'raster-dark-matter'
    | 'raster-voyager';
  label: string;
  style: ExampleBasemapStyle;
};

type RasterBasemapStyle = {
  version: 8;
  name: string;
  sources: {
    basemap: {
      type: 'raster';
      tileSize: number;
      tiles: string[];
      attribution?: string;
    };
  };
  layers: Array<{
    id: string;
    type: 'raster';
    source: 'basemap';
    minzoom?: number;
    maxzoom?: number;
    paint?: {
      'raster-opacity'?: number;
    };
  }>;
};

type ExampleSettings = {
  view: {
    mode: 'flat' | 'globe';
  };
  basemap: {
    style: ExampleStyleOption['id'];
  };
};

type ExampleStatus = {
  activeStyleId: ExampleStyleOption['id'];
  activeStyleName: string;
  styleMetadataRequests: number;
  tileRequests: number;
  tileErrors: number;
  basemapLoaded: boolean;
  lastError: string | null;
};

const STYLE_OPTIONS: ExampleStyleOption[] = [
  {
    id: 'carto-positron',
    label: 'Positron',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
  },
  {
    id: 'carto-dark-matter',
    label: 'Dark Matter',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
  },
  {
    id: 'carto-voyager',
    label: 'Voyager',
    style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
  },
  {
    id: 'carto-positron-nolabels',
    label: 'Positron (No Labels)',
    style: 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json'
  },
  {
    id: 'raster-positron',
    label: 'Raster Positron',
    style: createRasterStyle(
      'Raster Positron',
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
    )
  },
  {
    id: 'raster-dark-matter',
    label: 'Raster Dark Matter',
    style: createRasterStyle(
      'Raster Dark Matter',
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
    )
  },
  {
    id: 'raster-voyager',
    label: 'Raster Voyager',
    style: createRasterStyle(
      'Raster Voyager',
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
    )
  },
  {id: 'light', label: 'Deck Light', style: deckLightStyle}
];

const FLAT_VIEW_STATE = {
  longitude: 0,
  latitude: 20,
  zoom: 1.2,
  bearing: 0,
  pitch: 0
};

const GLOBE_VIEW_STATE = {
  longitude: 0,
  latitude: 0,
  zoom: 0.9,
  bearing: 0,
  pitch: 30,
  minZoom: 0,
  maxZoom: 12
};

const SETTINGS_SCHEMA: SettingsSchema = {
  title: 'Settings',
  sections: [
    {
      id: 'settings',
      settings: [
        {
          name: 'view.mode',
          label: 'View',
          type: 'select',
          options: [
            {label: 'Flat', value: 'flat'},
            {label: 'Globe (Experimental)', value: 'globe'}
          ],
          description: 'Switch between a standard `MapView` and a globe view.'
        },
        {
          name: 'basemap.style',
          label: 'Map Style',
          type: 'select',
          options: STYLE_OPTIONS.map(option => ({label: option.label, value: option.id})),
          description: 'Swap between local demo styles and CARTO-hosted style JSON documents.'
        }
      ]
    }
  ]
};

const DEFAULT_FLAT_STYLE_ID: ExampleStyleOption['id'] = 'carto-voyager';
const DEFAULT_GLOBE_STYLE_ID: ExampleStyleOption['id'] = 'light';

export function mountBasemapLayerMapViewExample(container: HTMLElement): () => void {
  const rootElement = createRoot(container);
  const defaultStyleId = DEFAULT_FLAT_STYLE_ID;
  const flatView = new MapView();
  const globeView = new _GlobeView();
  const state = {
    settings: {
      view: {
        mode: 'flat'
      },
      basemap: {
        style: defaultStyleId
      }
    } as ExampleSettings
  };
  const status: ExampleStatus = {
    activeStyleId: defaultStyleId,
    activeStyleName: getStyleDisplayName(
      STYLE_OPTIONS.find(option => option.id === defaultStyleId) || STYLE_OPTIONS[0]
    ),
    styleMetadataRequests: 0,
    tileRequests: 0,
    tileErrors: 0,
    basemapLoaded: false,
    lastError: null
  };
  const infoWidget = new BoxWidget({
    id: 'basemap-map-view-info',
    placement: 'top-left',
    widthPx: 360,
    title: 'BasemapLayer',
    collapsible: true
  });
  const handleStyleChange = (nextStyleId: ExampleStyleOption['id']) => {
    const styleOption = STYLE_OPTIONS.find(option => option.id === nextStyleId);
    if (!styleOption || styleOption.id === status.activeStyleId) {
      return;
    }

    applyStyleSelection(nextStyleId);
    syncDeckLayers();
    syncInfoWidget();
  };
  const handleViewModeChange = (nextMode: ExampleSettings['view']['mode']) => {
    if (nextMode === state.settings.view.mode) {
      return;
    }

    state.settings.view.mode = nextMode;
    if (nextMode === 'globe' && !isStableGlobeStyle(status.activeStyleId)) {
      applyStyleSelection(DEFAULT_GLOBE_STYLE_ID);
    }

    syncDeckMode();
    syncInfoWidget();
  };

  const trackedFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    const isTileMetadataRequest = url.endsWith('/tiles.json') || url.includes('tilejson');
    const isTileRequest = /\.mvt(?:$|\?)/.test(url) || /\.(png|jpg|jpeg|webp|avif)(?:$|\?)/.test(url);

    if (isTileMetadataRequest) {
      status.styleMetadataRequests += 1;
      syncInfoWidget();
    } else if (isTileRequest) {
      status.tileRequests += 1;
      syncInfoWidget();
    }

    try {
      const response = await fetch(input, init);
      if (!response.ok) {
        const message = `${response.status} ${response.statusText}`.trim();
        if (isTileRequest || isTileMetadataRequest) {
          status.tileErrors += 1;
          status.lastError = `${url} failed: ${message}`;
          syncInfoWidget();
        }
      } else if (isTileRequest) {
        status.basemapLoaded = true;
        syncInfoWidget();
      }
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isTileRequest || isTileMetadataRequest) {
        status.tileErrors += 1;
        status.lastError = `${url} failed: ${message}`;
        syncInfoWidget();
      }
      throw error;
    }
  };

  const deck = new Deck({
    parent: rootElement,
    views: getView(state.settings, flatView, globeView),
    initialViewState: getViewState(state.settings),
    controller: true,
    parameters: {clearColor: [0.92, 0.94, 0.94, 1]},
    layers: [createBasemapLayer(state.settings, status, trackedFetch)],
    widgets: [infoWidget]
  });

  syncInfoWidget();

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };

  function applyStyleSelection(nextStyleId: ExampleStyleOption['id']) {
    const styleOption = STYLE_OPTIONS.find(option => option.id === nextStyleId);
    if (!styleOption) {
      return;
    }

    state.settings.basemap.style = styleOption.id;
    status.activeStyleId = styleOption.id;
    status.activeStyleName = getStyleDisplayName(styleOption);
    status.styleMetadataRequests = 0;
    status.tileRequests = 0;
    status.tileErrors = 0;
    status.basemapLoaded = false;
    status.lastError = null;
  }

  function syncDeckLayers() {
    deck.setProps({
      layers: [createBasemapLayer(state.settings, status, trackedFetch)],
      widgets: [infoWidget]
    });
  }

  function syncDeckMode() {
    deck.setProps({
      views: getView(state.settings, flatView, globeView),
      initialViewState: getViewState(state.settings),
      layers: [createBasemapLayer(state.settings, status, trackedFetch)],
      widgets: [infoWidget]
    });
  }

  function syncInfoWidget() {
    const stateLabel = status.lastError ? 'error' : status.basemapLoaded ? 'loaded' : 'loading';
    infoWidget.setProps({
      panel: new ColumnPanel({
        id: 'basemap-map-view-panel',
        title: 'BasemapLayer',
        panels: {
          summary: new MarkdownPanel({
            id: 'summary',
            title: '',
            markdown: [
              'This example validates both the flat `MapView` path and the experimental globe path.',
              '',
              `- View: **${state.settings.view.mode === 'globe' ? 'GlobeView' : 'MapView'}**`,
              `- Resolved style: **${escapeMarkdown(status.activeStyleName)}**`,
              `- Status: **${stateLabel}**`,
              `- Style metadata requests: **${status.styleMetadataRequests}**`,
              `- Tile requests: **${status.tileRequests}**`,
              `- Tile errors: **${status.tileErrors}**`,
              status.lastError
                ? `- Last error: **${escapeMarkdown(status.lastError)}**`
                : '- No fetch errors observed.'
            ].join('\n')
          }),
          settings: new SettingsPanel({
            id: 'settings',
            label: 'Settings',
            schema: SETTINGS_SCHEMA,
            settings: state.settings as unknown as SettingsState,
            onSettingsChange: (nextSettings) => {
              const nextMode = nextSettings.view?.mode as ExampleSettings['view']['mode'] | undefined;
              const nextStyleId = nextSettings.basemap?.style as ExampleStyleOption['id'] | undefined;
              if (nextMode) {
                handleViewModeChange(nextMode);
              }
              if (nextStyleId) {
                handleStyleChange(nextStyleId);
              }
            }
          })
        }
      })
    });
  }
}

function createRoot(container: HTMLElement): HTMLDivElement {
  const root = container.ownerDocument.createElement('div');
  root.style.position = 'relative';
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.overflow = 'hidden';
  container.replaceChildren(root);
  return root;
}

function createBasemapLayer(
  settings: ExampleSettings,
  status: ExampleStatus,
  trackedFetch: typeof fetch
): BasemapLayer {
  const styleOption =
    STYLE_OPTIONS.find(option => option.id === status.activeStyleId) || STYLE_OPTIONS[0];

  return new BasemapLayer({
    id: 'map-basemap',
    mode: settings.view.mode === 'globe' ? 'globe' : 'map',
    style: styleOption.style,
    globe: {
      config: {
        atmosphere: false,
        basemap: true,
        labels: settings.view.mode !== 'globe'
      }
    },
    loadOptions: {
      fetch: trackedFetch,
      core: {
        fetch: trackedFetch
      }
    }
  });
}

function getView(
  settings: ExampleSettings,
  flatView: MapView,
  globeView: _GlobeView
) {
  return settings.view.mode === 'globe' ? globeView : flatView;
}

function getViewState(settings: ExampleSettings) {
  return settings.view.mode === 'globe' ? GLOBE_VIEW_STATE : FLAT_VIEW_STATE;
}

function isStableGlobeStyle(styleId: ExampleStyleOption['id']) {
  return typeof (STYLE_OPTIONS.find(option => option.id === styleId) || STYLE_OPTIONS[0]).style !== 'string';
}

function getStyleDisplayName(styleOption: ExampleStyleOption): string {
  return typeof styleOption.style === 'string'
    ? styleOption.label
    : styleOption.style.name?.trim() || styleOption.label;
}

function escapeMarkdown(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('*', '\\*').replaceAll('_', '\\_');
}

function createRasterStyle(name: string, tileTemplate: string): RasterBasemapStyle {
  return {
    version: 8,
    name,
    sources: {
      basemap: {
        type: 'raster',
        tileSize: 256,
        tiles: ['a', 'b', 'c', 'd'].map(subdomain => tileTemplate.replace('{s}', subdomain)),
        attribution: '&copy; CARTO'
      }
    },
    layers: [
      {
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
        paint: {
          'raster-opacity': 1
        }
      }
    ]
  };
}
