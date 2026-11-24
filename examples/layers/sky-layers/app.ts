// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {PolygonLayer} from '@deck.gl/layers';
import {SkyLayer} from '@deck.gl-community/layers/sky-layers';
import {webgl2Adapter} from '@luma.gl/core/webgl';
import {webgpuAdapter} from '@luma.gl/core/webgpu';
import {mountStandaloneExample} from '../../mount-example';

const DATE_UTC = Date.UTC(2026, 9, 4);
const GROUND = [
  [
    [-75, 40],
    [-73, 40],
    [-73, 41.4],
    [-75, 41.4]
  ]
];

function mountSkyExample(container: HTMLElement): () => void {
  const label = document.createElement('label');
  Object.assign(label.style, {
    position: 'absolute',
    top: '12px',
    left: '12px',
    zIndex: '1',
    padding: '8px 12px',
    borderRadius: '4px',
    background: '#162137',
    color: 'white',
    font: '14px system-ui'
  });
  const time = document.createElement('input');
  time.type = 'range';
  time.min = '0';
  time.max = '23.75';
  time.step = '0.25';
  time.value = '21';
  const clock = document.createElement('span');
  label.append(clock, time);
  container.append(label);

  const deck = new Deck({
    parent: container,
    deviceProps: {adapters: [webgpuAdapter, webgl2Adapter]},
    views: new MapView({controller: true, fovy: 55}),
    initialViewState: {longitude: -74, latitude: 40.7, zoom: 10.5, pitch: 78}
  });
  const update = () => {
    const hour = Number(time.value);
    clock.textContent = `UTC ${String(Math.floor(hour)).padStart(2, '0')}:${String(
      Math.round((hour % 1) * 60)
    ).padStart(2, '0')} `;
    deck.setProps({
      layers: [
        new SkyLayer({id: 'sky', timestamp: DATE_UTC + hour * 3600000}),
        new PolygonLayer({
          id: 'ground',
          data: GROUND,
          getPolygon: row => row,
          getFillColor: [43, 64, 63]
        })
      ]
    });
  };
  time.addEventListener('input', update);
  update();
  return () => {
    label.remove();
    deck.finalize();
  };
}

void mountStandaloneExample(mountSkyExample);
