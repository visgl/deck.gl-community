// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {GlowPointLayer} from '@deck.gl-community/layers/effect-layers';
import type {Buffer} from '@luma.gl/core';
import {
  getDeckExampleProps,
  resolveDeckExampleDeviceType
} from '../riverfront-shared/deck-example-device';

// Each row holds position.xyz, linear RGB, opacity and feature index.
const LIGHTS = new Float32Array([
  -40, 0, 0, 1, 0.15, 0.02, 1, 0, 0, 0, 0, 0.05, 1, 0.25, 1, 1, 40, 0, 0, 0.03, 0.2, 1, 1, 2
]);

const radius = document.querySelector<HTMLInputElement>('#radius')!;
const deviceType = await resolveDeckExampleDeviceType(
  new URLSearchParams(location.search).get('backend')
);
let points: Buffer | undefined;

function updateLights() {
  if (!points) return;
  deck.setProps({
    layers: [
      new GlowPointLayer({
        id: 'lights',
        points,
        pointCount: LIGHTS.length / 8,
        radiusPixels: radius.valueAsNumber
      })
    ]
  });
}

const deck = new Deck({
  ...getDeckExampleProps({deviceType}),
  canvas: document.querySelector<HTMLCanvasElement>('canvas')!,
  views: new OrthographicView(),
  initialViewState: {target: [0, 0, 0], zoom: 1},
  controller: true,
  onDeviceInitialized(device) {
    points = device.createBuffer({data: LIGHTS});
    updateLights();
  },
  onAfterRender() {
    if (points) document.body.dataset.ready = 'true';
  }
});
radius.addEventListener('input', updateLights);
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  deck.finalize();
  points?.destroy();
});
