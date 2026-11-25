// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {BitmapLayer} from '@deck.gl/layers';
import {WindParticleLayer, WindSimulationEffect} from '@deck.gl-community/layers/wind-layers';
import type {Device} from '@luma.gl/core';
import {getDeckExampleProps} from '../riverfront-shared/deck-example-device';
import earth from '../globe-clouds/earth.jpg?url';
import {makeWindField, WIND_BOUNDS} from './fields';

const paused = document.querySelector<HTMLInputElement>('#paused')!;
const integrator = document.querySelector<HTMLSelectElement>('#integrator')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
let device: Device;
let effect: WindSimulationEffect;
const input = makeWindField();

function updateWind() {
  if (!device) return;
  effect = new WindSimulationEffect(device, {
    input,
    bounds: WIND_BOUNDS,
    wrapLongitude: true,
    particleCount: innerWidth < 600 ? 16384 : 65536,
    integrator: integrator.value === 'RK2' ? 'rk2' : 'rk4',
    lifetime: 45,
    seed: 17,
    paused: paused.checked
  });
  deck.setProps({
    effects: [effect],
    layers: [
      new BitmapLayer({
        id: 'earth',
        image: earth,
        bounds: [-180, -90, 180, 90],
        tintColor: [75, 100, 120, 255]
      }),
      new WindParticleLayer({
        id: 'winds',
        simulation: effect.simulation,
        coordinateSystem: 'cartesian',
        widthPixels: 1.2,
        trailSeconds: 0.35,
        altitude: 0.1,
        color: [0.25, 0.85, 1, 0.65]
      })
    ]
  });
}

const deck = new Deck({
  ...getDeckExampleProps({deviceType: 'webgpu'}),
  parent: document.querySelector<HTMLDivElement>('#scene')!,
  views: new OrthographicView({flipY: false}),
  initialViewState: {
    target: [0, 0, 0],
    zoom: Math.log2(Math.min(innerWidth / 400, innerHeight / 220))
  },
  controller: true,
  _animate: true,
  onDeviceInitialized(nextDevice) {
    device = nextDevice;
    updateWind();
  },
  onAfterRender() {
    if (effect) document.body.dataset.ready = 'true';
  },
  onError(error) {
    status.textContent = error.message;
  }
});

paused.addEventListener('change', () => {
  if (effect) effect.props.paused = paused.checked;
});
integrator.addEventListener('change', updateWind);
window.addEventListener('pagehide', event => {
  if (!event.persisted) deck.finalize();
});
