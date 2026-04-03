// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {BasemapLayer} from '@deck.gl-community/basemap-layers';
import {SkyboxLayer} from '@deck.gl-community/layers';
import {SKYBOX_CUBEMAP} from '../skybox-assets/cubemap';

const INITIAL_VIEW_STATE = {
  longitude: -122.4194,
  latitude: 37.7749,
  zoom: 14,
  pitch: 84,
  bearing: 20
};

export function mountSkyboxMapViewExample(container: HTMLElement): () => void {
  const rootElement = createRoot(container);
  const overlay = createOverlay(rootElement.ownerDocument);
  rootElement.appendChild(overlay);

  const deck = new Deck({
    parent: rootElement,
    views: new MapView({repeat: true, maxPitch: 89}),
    initialViewState: INITIAL_VIEW_STATE,
    controller: {
      dragRotate: true,
      touchRotate: true,
      maxPitch: 89
    },
    parameters: {clearColor: [0, 0, 0, 1]},
    layers: [
      new SkyboxLayer({
        id: 'skybox',
        cubemap: SKYBOX_CUBEMAP,
        orientation: 'y-up'
      }),
      new BasemapLayer({
        id: 'basemap',
        mode: 'map',
        style: 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json'
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
    '<strong style="display:block;margin-bottom:6px;font-size:13px;">SkyboxLayer MapView</strong>',
    'Tilt a standard <code>MapView</code> over a basemap while rendering the luma.gl sky cubemap behind the scene.',
    '<br /><br />Use right-drag or two-finger drag to pitch and rotate up to 89°.'
  ].join('');
  return overlay;
}
