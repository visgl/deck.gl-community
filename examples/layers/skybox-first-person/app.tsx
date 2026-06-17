// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, FirstPersonView} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {SkyboxLayer} from '@deck.gl-community/layers';
import {PAPERMILL_CUBEMAP} from '../skybox-assets/cubemap';

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
        cubemap: PAPERMILL_CUBEMAP,
        orientation: 'y-up'
      }),
      new SolidPolygonLayer({
        id: 'floor',
        data: FLOOR,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPolygon: d => d,
        stroked: false,
        filled: true,
        getFillColor: [14, 24, 34, 255]
      })
    ]
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
    '<strong style="display:block;margin-bottom:6px;font-size:13px;">SkyboxLayer FirstPersonView</strong>',
    'Walk a minimal cartesian scene in <code>FirstPersonView</code> with only a floor plane and the papermill cubemap-backed skybox.',
    '<br /><br />Use mouse drag plus WASD / arrow-key movement from the default controller.'
  ].join('');
  return overlay;
}
