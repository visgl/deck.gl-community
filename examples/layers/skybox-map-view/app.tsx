// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  Deck,
  MapView,
  type MapViewState,
  type ViewStateChangeParameters,
  type Widget
} from '@deck.gl/core';
import {BasemapLayer} from '@deck.gl-community/basemap-layers';
import {SkyboxLayer} from '@deck.gl-community/layers';
import type {Device} from '@luma.gl/core';
import {SKYBOX_CUBEMAP} from '../skybox-assets/cubemap';

const INITIAL_VIEW_STATE = {
  longitude: -122.4194,
  latitude: 37.7749,
  zoom: 14,
  pitch: 89,
  bearing: 20
};

const MAX_PITCH = 89.9;

type SkyboxMapViewExampleOptions = {
  showInfoOverlay?: boolean;
  device?: Device;
  widgets?: Widget[];
  initialViewState?: MapViewState;
  onViewStateChange?: <ViewStateT extends MapViewState>(
    params: ViewStateChangeParameters<ViewStateT>
  ) => ViewStateT;
  onDeckInitialized?: (deck: Deck<MapView>) => void;
};

export function mountSkyboxMapViewExample(
  container: HTMLElement,
  options: SkyboxMapViewExampleOptions = {}
): () => void {
  const rootElement = createRoot(container);
  if (options.showInfoOverlay !== false) {
    rootElement.appendChild(createOverlay(rootElement.ownerDocument));
  }

  const deck = new Deck({
    device: options.device,
    parent: rootElement,
    views: new MapView({repeat: true, maxPitch: MAX_PITCH}),
    initialViewState: options.initialViewState ?? INITIAL_VIEW_STATE,
    onViewStateChange: options.onViewStateChange,
    controller: {
      dragRotate: true,
      touchRotate: true,
      maxPitch: MAX_PITCH
    },
    parameters: {clearColor: [0, 0, 0, 1]},
    widgets: options.widgets ?? [],
    layers: [
      new SkyboxLayer({
        id: 'skybox',
        cubemap: SKYBOX_CUBEMAP,
        orientation: 'y-up'
      }),
      ...(options.device?.type === 'webgpu'
        ? []
        : [
            new BasemapLayer({
              id: 'basemap',
              mode: 'map',
              style: 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json'
            })
          ])
    ]
  });
  options.onDeckInitialized?.(deck);

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
    '<br /><br />Use right-drag or two-finger drag to pitch and rotate up to 89.9°.'
  ].join('');
  return overlay;
}
