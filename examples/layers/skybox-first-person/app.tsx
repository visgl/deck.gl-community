// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, FirstPersonView, type PickingInfo} from '@deck.gl/core';
import {ColumnLayer, SolidPolygonLayer} from '@deck.gl/layers';
import {SkyboxLayer} from '@deck.gl-community/layers';
import {SKYBOX_CUBEMAP} from '../skybox-assets/cubemap';

type Tower = {
  name: string;
  position: [number, number];
  elevation: number;
  radius: number;
  color: [number, number, number];
};

const FIRST_PERSON_VIEW = new FirstPersonView({near: 0.1, far: 2000, fovy: 75});

const INITIAL_VIEW_STATE = {
  position: [0, 1.7, 36] as [number, number, number],
  bearing: 8,
  pitch: 8
};

const FLOOR = [
  [
    [-90, -90, 0],
    [-90, 90, 0],
    [90, 90, 0],
    [90, -90, 0]
  ]
];

const TOWERS: Tower[] = [
  {name: 'North Array', position: [-36, -12], elevation: 36, radius: 8, color: [114, 234, 255]},
  {name: 'Signal Beacon', position: [-8, 10], elevation: 72, radius: 6, color: [255, 225, 138]},
  {name: 'Transit Core', position: [24, -18], elevation: 54, radius: 10, color: [143, 255, 197]},
  {name: 'Observation Mast', position: [42, 22], elevation: 90, radius: 7, color: [255, 159, 67]},
  {name: 'Relay Stack', position: [0, -40], elevation: 44, radius: 5, color: [191, 162, 255]}
];

export function mountSkyboxFirstPersonExample(container: HTMLElement): () => void {
  const rootElement = createRoot(container);
  const overlay = createOverlay(rootElement.ownerDocument);
  rootElement.appendChild(overlay);

  const deck = new Deck({
    parent: rootElement,
    views: FIRST_PERSON_VIEW,
    initialViewState: INITIAL_VIEW_STATE,
    controller: true,
    parameters: {clearColor: [0, 0, 0, 1]},
    layers: [
      new SkyboxLayer({
        id: 'skybox',
        cubemap: SKYBOX_CUBEMAP
      }),
      new SolidPolygonLayer({
        id: 'floor',
        data: FLOOR,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPolygon: (d) => d,
        stroked: false,
        filled: true,
        getFillColor: [14, 24, 34, 255]
      }),
      new ColumnLayer<Tower>({
        id: 'towers',
        data: TOWERS,
        pickable: true,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        diskResolution: 12,
        radiusUnits: 'common',
        elevationScale: 1,
        extruded: true,
        getPosition: (d) => [...d.position, 0] as [number, number, number],
        getElevation: (d) => d.elevation,
        getRadius: (d) => d.radius,
        getFillColor: (d) => [...d.color, 255],
        getLineColor: [255, 255, 255, 70],
        getLineWidth: 1,
        material: {
          ambient: 0.45,
          diffuse: 0.6,
          shininess: 48,
          specularColor: [220, 235, 255]
        }
      })
    ],
    getTooltip: (info: PickingInfo<Tower>) =>
      info.object ? {text: `${info.object.name}\n${info.object.elevation} m`} : null
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
  overlay.style.right = '16px';
  overlay.style.bottom = '16px';
  overlay.style.maxWidth = '320px';
  overlay.style.padding = '12px 14px';
  overlay.style.background = 'rgba(9, 16, 29, 0.72)';
  overlay.style.border = '1px solid rgba(255, 255, 255, 0.14)';
  overlay.style.backdropFilter = 'blur(14px)';
  overlay.style.color = '#f4f7fb';
  overlay.style.font = '12px/1.5 Menlo, Monaco, Consolas, monospace';
  overlay.style.pointerEvents = 'none';
  overlay.innerHTML = [
    '<strong style="display:block;margin-bottom:6px;font-size:13px;">Skybox First Person</strong>',
    'Walk a simple cartesian scene in <code>FirstPersonView</code> with the same cubemap-backed skybox.',
    '<br /><br />Use mouse drag plus WASD / arrow-key movement from the default controller.'
  ].join('');
  return overlay;
}
