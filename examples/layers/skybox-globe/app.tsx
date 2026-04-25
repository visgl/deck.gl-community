// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, _GlobeView, type PickingInfo} from '@deck.gl/core';
import {ArcLayer, ScatterplotLayer} from '@deck.gl/layers';
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
import {SkyboxLayer} from '../../../modules/layers/src';
import {TYCHO_CUBEMAP} from '../skybox-assets/cubemap';
import deckLightStyle from '../../../website/static/mapstyle/deck-light.json';

import '@deck.gl/widgets/stylesheet.css';

type City = {
  name: string;
  position: [number, number];
  color: [number, number, number];
};

type Flight = {
  source: City;
  target: City;
  height: number;
  color: [number, number, number];
};

const INITIAL_VIEW_STATE = {
  longitude: -10,
  latitude: 25,
  zoom: 0.9
};

const SETTINGS_SCHEMA: SettingsSchema = {
  title: 'SkyboxLayer GlobeView',
  sections: [
    {
      id: 'render',
      name: 'Render',
      settings: [
        {
          name: 'render.showSkybox',
          label: 'Show skybox',
          type: 'boolean',
          description: 'Disable the cubemap to verify whether it is masking the globe basemap.'
        }
      ]
    }
  ]
};

const CITIES: City[] = [
  {name: 'San Francisco', position: [-122.4194, 37.7749], color: [114, 234, 255]},
  {name: 'Reykjavik', position: [-21.8174, 64.1265], color: [255, 225, 138]},
  {name: 'Nairobi', position: [36.8219, -1.2921], color: [255, 159, 67]},
  {name: 'Singapore', position: [103.8198, 1.3521], color: [143, 255, 197]},
  {name: 'Santiago', position: [-70.6693, -33.4489], color: [191, 162, 255]}
];

const FLIGHTS: Flight[] = [
  {source: CITIES[0], target: CITIES[1], height: 0.35, color: [114, 234, 255]},
  {source: CITIES[1], target: CITIES[2], height: 0.28, color: [255, 225, 138]},
  {source: CITIES[2], target: CITIES[3], height: 0.32, color: [255, 159, 67]},
  {source: CITIES[3], target: CITIES[4], height: 0.45, color: [143, 255, 197]},
  {source: CITIES[4], target: CITIES[0], height: 0.4, color: [191, 162, 255]}
];

export function mountSkyboxGlobeExample(container: HTMLElement): () => void {
  const rootElement = createRoot(container);
  const state = {
    settings: {
      render: {
        showSkybox: true
      }
    } as SettingsState
  };

  const infoWidget = new BoxWidget({
    id: 'skybox-globe-info',
    placement: 'top-left',
    widthPx: 340,
    title: 'SkyboxLayer GlobeView',
    collapsible: false
  });

  const deck = new Deck({
    parent: rootElement,
    views: new _GlobeView(),
    initialViewState: INITIAL_VIEW_STATE,
    controller: true,
    parameters: {clearColor: [0, 0, 0, 1]},
    layers: buildLayers(state.settings),
    widgets: [infoWidget],
    getTooltip: (info: PickingInfo<City>) => (info.object ? {text: info.object.name} : null)
  });

  syncInfoWidget();

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };

  function syncDeck() {
    deck.setProps({
      layers: buildLayers(state.settings),
      widgets: [infoWidget]
    });
  }

  function syncInfoWidget() {
    infoWidget.setProps({
      panel: new ColumnPanel({
        id: 'skybox-globe-panel',
        title: 'SkyboxLayer GlobeView',
        panels: {
          summary: new MarkdownPanel({
            id: 'summary',
            title: '',
            markdown: [
              'Toggle the skybox to check whether the cubemap is obscuring the globe basemap.',
              '',
              `- Skybox: **${state.settings.render.showSkybox ? 'enabled' : 'disabled'}**`,
              '- Skybox asset: NASA Tycho star map cubemap.',
              '- Basemap: CARTO vector style rendered through `BasemapLayer`.'
            ].join('\n')
          }),
          settings: new SettingsPanel({
            id: 'settings',
            label: 'Controls',
            schema: SETTINGS_SCHEMA,
            settings: state.settings,
            onSettingsChange: (nextSettings) => {
              state.settings = nextSettings;
              syncDeck();
              syncInfoWidget();
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

function buildLayers(settings: SettingsState) {
  return [
    settings.render?.showSkybox !== false &&
      new SkyboxLayer({
        id: 'skybox',
        cubemap: TYCHO_CUBEMAP,
        orientation: 'y-up'
      }),
    new BasemapLayer({
      id: 'earth',
      mode: 'globe',
      style: deckLightStyle,
      globe: {
        config: {
          atmosphere: false,
          basemap: true,
          labels: false
        }
      }
    }),
    new ArcLayer<Flight>({
      id: 'flight-arcs',
      data: FLIGHTS,
      getSourcePosition: (d) => d.source.position,
      getTargetPosition: (d) => d.target.position,
      getSourceColor: (d) => [...d.color, 0],
      getTargetColor: (d) => [...d.color, 220],
      getWidth: 2,
      greatCircle: true,
      getHeight: (d) => d.height
    }),
    new ScatterplotLayer<City>({
      id: 'city-markers',
      data: CITIES,
      pickable: true,
      getPosition: (d) => d.position,
      getRadius: 180000,
      radiusUnits: 'meters',
      radiusMinPixels: 3,
      getFillColor: (d) => [...d.color, 255],
      getLineColor: [255, 255, 255, 200],
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
      stroked: true
    })
  ].filter(Boolean);
}
