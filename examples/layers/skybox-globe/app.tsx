// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, _GlobeView, type PickingInfo} from '@deck.gl/core';
import {ArcLayer, ScatterplotLayer, SolidPolygonLayer} from '@deck.gl/layers';
import {SkyboxLayer} from '@deck.gl-community/layers';
import {SKYBOX_CUBEMAP} from '../skybox-assets/cubemap';

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

const WORLD_POLYGON = [
  [
    [-180, 90],
    [0, 90],
    [180, 90],
    [180, -90],
    [0, -90],
    [-180, -90]
  ]
];

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
  const overlay = createOverlay(rootElement.ownerDocument);
  rootElement.appendChild(overlay);

  const deck = new Deck({
    parent: rootElement,
    views: new _GlobeView(),
    initialViewState: INITIAL_VIEW_STATE,
    controller: true,
    parameters: {clearColor: [0, 0, 0, 1]},
    layers: [
      new SkyboxLayer({
        id: 'skybox',
        cubemap: SKYBOX_CUBEMAP
      }),
      new SolidPolygonLayer({
        id: 'globe-surface',
        data: WORLD_POLYGON,
        getPolygon: (d) => d,
        stroked: false,
        filled: true,
        getFillColor: [10, 24, 46, 255]
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
    ],
    getTooltip: (info: PickingInfo<City>) => (info.object ? {text: info.object.name} : null)
  });

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };
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

function createOverlay(document: Document): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.top = '16px';
  overlay.style.left = '16px';
  overlay.style.maxWidth = '320px';
  overlay.style.padding = '12px 14px';
  overlay.style.background = 'rgba(6, 12, 24, 0.72)';
  overlay.style.border = '1px solid rgba(255, 255, 255, 0.14)';
  overlay.style.backdropFilter = 'blur(14px)';
  overlay.style.color = '#f4f7fb';
  overlay.style.font = '12px/1.5 Menlo, Monaco, Consolas, monospace';
  overlay.style.pointerEvents = 'none';
  overlay.innerHTML = [
    '<strong style="display:block;margin-bottom:6px;font-size:13px;">Skybox Globe</strong>',
    'A cubemap-backed <code>SkyboxLayer</code> behind a deck.gl <code>GlobeView</code>.',
    '<br /><br />Drag to orbit the globe and keep the environment fixed around the camera.'
  ].join('');
  return overlay;
}
