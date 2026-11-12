// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, type DeckProps, OrbitView} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {GrassLayer} from '@deck.gl-community/layers';

type Patch = {
  position: [number, number, number];
  density: number;
  height: number;
  color: [number, number, number, number];
  seed: number;
};

const patches: Patch[] = [];
for (let row = 0; row < 12; row++) {
  for (let column = 0; column < 14; column++) {
    const y = row - 5.5;
    const x = column - 6.5;
    const seed = row * 14 + column;
    const pathDistance = Math.abs(x - Math.sin(y * 0.4) * 2.2);
    if (pathDistance < 0.7) continue;
    const dry = Math.abs(x) / 7;
    patches.push({
      position: [x, y, 0],
      density: Math.min(1, pathDistance - 0.6) * (1 - dry * 0.15),
      height: 0.3 + (seed % 5) * 0.065,
      color: [84 + 60 * dry, 151 + 12 * dry, 48 + 12 * dry, 255],
      seed
    });
  }
}

type MountOptions = Pick<
  DeckProps<OrbitView>,
  'device' | 'initialViewState' | 'widgets' | 'onViewStateChange'
> & {
  onDeckInitialized?: (deck: Deck<OrbitView>) => void;
};

export function mountGrassLayerExample(container: HTMLElement, options: MountOptions = {}) {
  const parent = document.createElement('div');
  Object.assign(parent.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    background: '#263428'
  });
  container.append(parent);
  const surface = new SolidPolygonLayer({
    id: 'ground',
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    data: [
      {
        polygon: [
          [-8, -7],
          [8, -7],
          [8, 7],
          [-8, 7]
        ] as [number, number][]
      }
    ],
    getPolygon: row => row.polygon,
    getFillColor: [95, 78, 51, 255]
  });
  const makeLayers = (windStrength: number) => [
    surface,
    new GrassLayer<Patch>({
      id: 'grass-patches',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: patches,
      getSize: [1, 1],
      getBladeWidth: 0.065,
      getHeight: patch => patch.height,
      getColor: patch => patch.color,
      getDensity: patch => patch.density,
      getSeed: patch => patch.seed,
      bladesPerPatch: 240,
      windStrength
    })
  ];
  const deck = new Deck<OrbitView>({
    parent,
    device: options.device,
    views: new OrbitView({orbitAxis: 'Z', controller: true}),
    initialViewState: options.initialViewState ?? {
      target: [0, 0, 0],
      zoom: 5.62,
      rotationX: 53,
      rotationOrbit: 16
    },
    layers: makeLayers(0.38),
    widgets: options.widgets,
    onViewStateChange: options.onViewStateChange
  });
  options.onDeckInitialized?.(deck);

  const label = document.createElement('label');
  label.textContent = 'Wind';
  Object.assign(label.style, {
    position: 'absolute',
    bottom: '16px',
    left: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    borderRadius: '6px',
    color: 'white',
    background: '#202820',
    font: '14px system-ui'
  });
  const wind = document.createElement('input');
  wind.type = 'range';
  wind.min = '0';
  wind.max = '1';
  wind.step = '0.01';
  wind.value = '0.38';
  wind.addEventListener('input', () => deck.setProps({layers: makeLayers(wind.valueAsNumber)}));
  label.append(wind);
  parent.append(label);

  return () => {
    deck.finalize();
    parent.remove();
  };
}
