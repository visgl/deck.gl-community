// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ScatterplotLayer} from '@deck.gl/layers';
import {MapboxOverlay} from '@deck.gl/mapbox';
import {
  BoxWidget,
  HtmlClusterWidget,
  HtmlOverlayItem,
  HtmlOverlayWidget,
  HtmlTooltipWidget,
  type HtmlOverlayWidgetProps,
  MarkdownWidgetPanel
} from '@deck.gl-community/widgets';
import {h} from 'preact';
import maplibregl from 'maplibre-gl';

import '@deck.gl/widgets/stylesheet.css';
import 'maplibre-gl/dist/maplibre-gl.css';

type Destination = {
  id: string;
  name: string;
  subtitle: string;
  coordinates: [number, number];
};

type Stopover = {
  id: string;
  city: string;
  title: string;
  coordinates: [number, number];
};

type TooltipDatum = Destination | Stopover;

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const DESTINATIONS: Destination[] = [
  {
    id: 'seattle',
    name: 'Seattle',
    subtitle: 'Waterfront skyline + coffee culture',
    coordinates: [-122.335167, 47.608013]
  },
  {
    id: 'san-francisco',
    name: 'San Francisco',
    subtitle: 'Bay views, bridges, and hills',
    coordinates: [-122.431297, 37.773972]
  },
  {
    id: 'denver',
    name: 'Denver',
    subtitle: 'Gateway to the Rockies',
    coordinates: [-104.99025, 39.739235]
  },
  {
    id: 'austin',
    name: 'Austin',
    subtitle: 'Live music and lakeside trails',
    coordinates: [-97.743057, 30.267153]
  },
  {
    id: 'new-york',
    name: 'New York City',
    subtitle: 'Skyscrapers, parks, and galleries',
    coordinates: [-73.985664, 40.748433]
  },
  {
    id: 'miami',
    name: 'Miami',
    subtitle: 'Beachfront skyline on Biscayne Bay',
    coordinates: [-80.191788, 25.761681]
  }
];

const STOPOVERS: Stopover[] = [
  {id: 'seattle-harbor', city: 'Seattle', title: 'Harbor Steps', coordinates: [-122.3403, 47.6068]},
  {id: 'seattle-park', city: 'Seattle', title: 'Volunteer Park', coordinates: [-122.314, 47.6292]},
  {id: 'sf-embarcadero', city: 'San Francisco', title: 'Embarcadero', coordinates: [-122.3952, 37.795]},
  {id: 'sf-sutro', city: 'San Francisco', title: 'Sutro Heights', coordinates: [-122.5078, 37.7774]},
  {id: 'sf-mission', city: 'San Francisco', title: 'Mission Dolores', coordinates: [-122.4256, 37.7599]},
  {id: 'denver-park', city: 'Denver', title: 'City Park', coordinates: [-104.9551, 39.7475]},
  {id: 'denver-rino', city: 'Denver', title: 'RiNo Arts', coordinates: [-104.9793, 39.7691]},
  {id: 'denver-sloan', city: 'Denver', title: 'Sloan Lake', coordinates: [-105.047, 39.7479]},
  {id: 'austin-zilker', city: 'Austin', title: 'Zilker Park', coordinates: [-97.7713, 30.2665]},
  {id: 'austin-lake', city: 'Austin', title: 'Lady Bird Lake', coordinates: [-97.7438, 30.2653]},
  {id: 'austin-mueller', city: 'Austin', title: 'Mueller Lake', coordinates: [-97.6996, 30.2977]},
  {id: 'ny-central', city: 'New York City', title: 'Central Park', coordinates: [-73.9765, 40.7812]},
  {id: 'ny-dumbo', city: 'New York City', title: 'DUMBO Landing', coordinates: [-73.9903, 40.7033]},
  {id: 'ny-highline', city: 'New York City', title: 'The High Line', coordinates: [-74.0048, 40.7479]},
  {id: 'miami-beach', city: 'Miami', title: 'South Beach', coordinates: [-80.1321, 25.784]},
  {id: 'miami-wynwood', city: 'Miami', title: 'Wynwood Walls', coordinates: [-80.1995, 25.8007]},
  {id: 'miami-key', city: 'Miami', title: 'Virginia Key', coordinates: [-80.1632, 25.7444]}
];

const INITIAL_VIEW_STATE = {
  longitude: -103.5,
  latitude: 39.5,
  zoom: 3.7,
  pitch: 0,
  bearing: 0
} as const;

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

const OVERLAY_STYLE = {
  width: '220px',
  padding: '10px 12px',
  borderRadius: '12px',
  background: 'rgba(255, 255, 255, 0.94)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.18)',
  border: '1px solid rgba(0, 0, 0, 0.05)',
  transform: 'translate(-50%, -110%)'
} as const;

const CLUSTER_STYLE = {
  width: 34,
  height: 34,
  borderRadius: '50%',
  background: '#111827',
  color: 'white',
  boxShadow: '0 10px 28px rgba(0, 0, 0, 0.26)',
  border: '2px solid rgba(255, 255, 255, 0.7)',
  transform: 'translate(50%, -140%)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 800,
  fontSize: 14
} as const;

const PIN_STYLE = {
  padding: '8px 10px',
  borderRadius: '12px',
  background: 'rgba(17, 24, 39, 0.92)',
  color: 'white',
  boxShadow: '0 10px 30px rgba(0,0,0,0.24)',
  border: '1px solid rgba(255,255,255,0.08)',
  transform: 'translate(-50%, -115%)',
  minWidth: 150
} as const;

export function mountHtmlOverlaysExample(container: HTMLElement): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  const mapElement = container.ownerDocument.createElement('div');
  applyElementStyle(rootElement, ROOT_STYLE);
  applyElementStyle(mapElement, MAP_CONTAINER_STYLE);
  rootElement.append(mapElement);
  container.replaceChildren(rootElement);

  const map = new maplibregl.Map({
    container: mapElement,
    style: MAP_STYLE,
    center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
    zoom: INITIAL_VIEW_STATE.zoom,
    pitch: INITIAL_VIEW_STATE.pitch,
    bearing: INITIAL_VIEW_STATE.bearing
  });

  const overlayWidget = new HtmlOverlayWidget<HtmlOverlayWidgetProps>({
    id: 'html-destination-overlays',
    overflowMargin: 128,
    zIndex: 3,
    items: buildDestinationOverlayItems()
  });
  const clusterWidget = new StopoverClusterWidget({
    id: 'html-cluster-overlays',
    overflowMargin: 96,
    zIndex: 4
  });
  const tooltipWidget = new HtmlTooltipWidget({
    id: 'html-overlay-tooltips',
    showDelay: 120,
    zIndex: 6,
    getTooltip: (info) => buildTooltip(info.object as TooltipDatum | null)
  });
  const infoWidget = new BoxWidget({
    id: 'html-overlay-summary',
    placement: 'top-right',
    widthPx: 340,
    title: 'HTML Overlay Widgets',
    panel: new MarkdownWidgetPanel({
      id: 'summary',
      title: '',
      markdown: [
        'Destination cards use `HtmlOverlayWidget`.',
        '',
        'Nearby stopovers collapse through `HtmlClusterWidget`, and hovering markers shows details via `HtmlTooltipWidget`.',
        '',
        'Pan or zoom the map to see the HTML stay anchored to its coordinates.'
      ].join('\n')
    })
  });

  const deckOverlay = new MapboxOverlay({
    interleaved: false,
    layers: buildLayers(),
    widgets: [overlayWidget, clusterWidget, tooltipWidget, infoWidget]
  });

  map.addControl(deckOverlay);

  return () => {
    map.removeControl(deckOverlay);
    deckOverlay.finalize();
    map.remove();
    rootElement.remove();
    container.replaceChildren();
  };
}

export function exampleApplication(): (() => void) | undefined {
  const container = document.getElementById('app');
  if (!container) {
    return undefined;
  }
  return mountHtmlOverlaysExample(container);
}

class StopoverClusterWidget extends HtmlClusterWidget<Stopover> {
  override getAllObjects = () => STOPOVERS;

  override getObjectCoordinates = (stopover: Stopover) => stopover.coordinates;

  override renderObject = (coordinates: [number, number], stopover: Stopover) =>
    h(
      HtmlOverlayItem,
      {key: stopover.id, coordinates, style: PIN_STYLE},
      [
        h('div', {style: {fontWeight: 700}}, stopover.title),
        h('div', {style: {fontSize: 12, opacity: 0.8}}, stopover.city)
      ]
    );

  override renderCluster = (coordinates: number[], clusterId: number, pointCount: number) =>
    h(
      HtmlOverlayItem,
      {key: `cluster-${clusterId}`, coordinates, style: CLUSTER_STYLE},
      h('div', null, pointCount)
    );
}

function buildDestinationOverlayItems() {
  return DESTINATIONS.map(({id, name, subtitle, coordinates}) =>
    h(
      HtmlOverlayItem,
      {
        key: id,
        coordinates,
        style: {
          ...OVERLAY_STYLE,
          color: '#1f2937',
          fontFamily: 'var(--ifm-font-family-base, "Inter", system-ui, sans-serif)',
          fontSize: '14px',
          lineHeight: 1.5
        }
      },
      [
        h('div', {style: {fontWeight: 700, fontSize: '16px'}}, name),
        h('div', {style: {color: '#4b5563', marginTop: '4px'}}, subtitle)
      ]
    )
  );
}

function buildLayers() {
  return [
    new ScatterplotLayer<Destination>({
      id: 'destinations',
      data: DESTINATIONS,
      getPosition: (destination) => destination.coordinates,
      getFillColor: [0, 122, 255, 200],
      radiusMinPixels: 10,
      radiusMaxPixels: 22,
      stroked: true,
      getLineColor: [255, 255, 255],
      lineWidthMinPixels: 2,
      pickable: true
    }),
    new ScatterplotLayer<Stopover>({
      id: 'stopovers',
      data: STOPOVERS,
      getPosition: (stopover) => stopover.coordinates,
      getFillColor: [255, 115, 29, 220],
      radiusMinPixels: 6,
      stroked: true,
      getLineColor: [255, 255, 255],
      lineWidthMinPixels: 1,
      pickable: true
    })
  ];
}

function buildTooltip(stop: TooltipDatum | null) {
  if (!stop) {
    return null;
  }

  return h(
    'div',
    {
      style: {
        fontFamily: 'var(--ifm-font-family-base, "Inter", system-ui, sans-serif)',
        minWidth: 140,
        display: 'flex',
        flexDirection: 'column',
        gap: 4
      }
    },
    [
      h('div', {style: {fontWeight: 700}}, 'name' in stop ? stop.name : stop.title),
      h('div', {style: {opacity: 0.8}}, 'subtitle' in stop ? stop.subtitle : stop.city)
    ]
  );
}

function applyElementStyle(element: HTMLElement, style: Record<string, string>) {
  for (const [key, value] of Object.entries(style)) {
    element.style.setProperty(camelCaseToKebabCase(key), value);
  }
}

function camelCaseToKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}
