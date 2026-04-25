import {DeckOverlay} from '@deck.gl-community/leaflet';
import {MapView, type PickingInfo} from '@deck.gl/core';
import {GeoJsonLayer, ArcLayer} from '@deck.gl/layers';
import {ColumnPanel, MarkdownPanel} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';
import * as L from 'leaflet';

import '@deck.gl/widgets/stylesheet.css';
import 'leaflet/dist/leaflet.css';

// source: Natural Earth http://www.naturalearthdata.com/ via geojson.xyz
const AIR_PORTS =
  'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_10m_airports.geojson';

type NaturalEarthAirportFeature = {
  geometry: {
    coordinates: [number, number];
  };
  properties: {
    abbrev: string;
    name: string;
    scalerank: number;
  };
};

type NaturalEarthAirportCollection = {
  features: NaturalEarthAirportFeature[];
};

export function exampleApplication(): (() => void) | undefined {
  const canvas = document.getElementById('map');
  if (!(canvas instanceof HTMLElement)) {
    throw new Error('Unable to find #map container');
  }

  return mountLeafletGetStartedExample(canvas);
}

export function mountLeafletGetStartedExample(container: HTMLElement): () => void {
  // Create map
  const map = L.map(container, {
    center: [51.47, 0.45],
    zoom: 4,
  });
  L.tileLayer('https://tiles.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png', {
    maxZoom: 22,
    attribution:
      '© <a href="https://carto.com/about-carto/" target="_blank" rel="noopener">CARTO</a>, © <a href="http://www.openstreetmap.org/about/" target="_blank">OpenStreetMap</a> contributors',
  }).addTo(map);

  const infoWidget = new BoxPanelWidget({
    id: 'leaflet-info',
    placement: 'top-right',
    widthPx: 320,
    title: 'deck.gl with Leaflet',
    collapsible: false,
    panel: new ColumnPanel({
      id: 'leaflet-info-panel',
      title: '',
      panels: {
        summary: new MarkdownPanel({
          id: 'summary',
          title: '',
          markdown: [
            'Use Leaflet as the basemap while deck.gl renders airport points and connection arcs on top.',
            '',
            '- Basemap: **Carto Dark Matter**',
            '- Overlay: **GeoJsonLayer + ArcLayer**',
            '- Interaction: **hover tooltips and click details**'
          ].join('\n')
        })
      }
    })
  });

  // Add deck.gl overlay
  const deckOverlay = new DeckOverlay({
    views: [
      new MapView({ repeat: true }),
    ],
    widgets: [infoWidget],
    layers: [
      new GeoJsonLayer<NaturalEarthAirportFeature>({
        id: 'airports',
        data: AIR_PORTS,
        // Styles
        filled: true,
        pointRadiusMinPixels: 2,
        pointRadiusScale: 2000,
        getPointRadius: (feature) => 11 - feature.properties.scalerank,
        getFillColor: [200, 0, 80, 180],
        // Interactive props
        pickable: true,
        autoHighlight: true,
        onClick: (info) =>
          // eslint-disable-next-line
          info.object && alert(`${info.object.properties.name} (${info.object.properties.abbrev})`)
      }),
      new ArcLayer<NaturalEarthAirportFeature>({
        id: 'arcs',
        data: AIR_PORTS,
        dataTransform: (data: NaturalEarthAirportCollection) =>
          data.features.filter((feature) => feature.properties.scalerank < 4),
        // Styles
        getSourcePosition: () => [-0.4531566, 51.4709959], // London
        getTargetPosition: (feature) => feature.geometry.coordinates,
        getSourceColor: [0, 128, 200],
        getTargetColor: [200, 0, 80],
        getWidth: 1
      })
    ],
    getTooltip: (info: PickingInfo<NaturalEarthAirportFeature>) => info.object?.properties.name ?? null
  });
  map.addLayer(deckOverlay);

  return () => {
    map.remove();
    container.replaceChildren();
  };
}
