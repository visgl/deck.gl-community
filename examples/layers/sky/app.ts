// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, FirstPersonView} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {SkyLayer} from '@deck.gl-community/layers';

type Position = [number, number, number];

export function mountSkyExample(container: HTMLElement): () => void {
  const root = document.createElement('div');
  root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden';
  container.appendChild(root);

  const floor = new SolidPolygonLayer<Position[]>({
    id: 'ground',
    data: [
      [
        [-200, -200, 0],
        [-200, 200, 0],
        [200, 200, 0],
        [200, -200, 0]
      ]
    ],
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    getPolygon: polygon => polygon,
    getFillColor: [39, 49, 44, 255]
  });

  const controls = document.createElement('div');
  controls.style.cssText =
    'position:absolute;top:12px;left:12px;z-index:1;display:grid;gap:8px;padding:12px 16px;' +
    'border-radius:6px;background:#172430e8;color:#fff;font:14px Inter,system-ui,sans-serif';
  function addSlider(label: string, min: number, max: number, step: number, value: number) {
    const row = document.createElement('label');
    row.style.cssText = 'display:grid;grid-template-columns:95px 116px;align-items:center;gap:12px';
    row.append(document.createTextNode(label));
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    row.appendChild(input);
    controls.appendChild(row);
    return input;
  }

  const elevation = addSlider('Sun elevation', -14, 75, 1, 14);
  const haze = addSlider('Haze', 0, 0.6, 0.01, 0.12);
  const azimuth = (17 * Math.PI) / 180;
  const getLayers = () => {
    const angle = (elevation.valueAsNumber * Math.PI) / 180;
    return [
      new SkyLayer({
        id: 'sky',
        sunDirection: [
          Math.cos(angle) * Math.sin(azimuth),
          Math.cos(angle) * Math.cos(azimuth),
          Math.sin(angle)
        ],
        aerosolOpticalDepth: haze.valueAsNumber
      }),
      floor
    ];
  };

  const deck = new Deck({
    parent: root,
    views: new FirstPersonView({fovy: 66}),
    initialViewState: {position: [0, 0, 1.7], bearing: 0, pitch: -9},
    controller: true,
    layers: getLayers()
  });
  controls.addEventListener('input', () => deck.setProps({layers: getLayers()}));
  root.appendChild(controls);

  return () => {
    deck.finalize();
    root.remove();
  };
}
