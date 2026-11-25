// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {OrbitView} from '@deck.gl/core';
import {TreeLayer, type TreeSpec} from '@deck.gl-community/layers/vegetation-layers';
import {WindEffect} from '@deck.gl-community/layers/wind-layers/wind-effect';
import {expect, it} from 'vitest';
import {mountTreeBrowserScene} from '../../vegetation-layers/tree-layer/tree-browser-frame-reader';

it('updates an existing photoreal tree when the scene wind changes or is removed', {
  timeout: 120_000
}, async () => {
  const scene = mountTreeBrowserScene({
    size: 192,
    views: new OrbitView({orbitAxis: 'Z'}),
    viewState: {target: [0, 0, 2.8], rotationOrbit: 20, rotationX: 8, zoom: 5.2},
    staticFrames: true
  });
  const tree = new TreeLayer<TreeSpec>({
    id: 'wind-tree',
    coordinateSystem: 'cartesian',
    lodBias: 2,
    data: [{position: [0, 0, 0], species: 'citrus', height: 6, crownRadius: 2.6}]
  });

  const calm = await scene.render([tree], 2);
  expect(calm.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  const {groups} = tree.state.photoreal!;
  scene.deck.setProps({effects: [new WindEffect({strength: 0.4, direction: 90, time: 1.25})]});
  const windy = await scene.settle(4);
  expect(windy).not.toEqual(calm);
  expect(tree.state.photoreal!.groups).toBe(groups);
  expect(tree.state.currentWindStrength).toBeCloseTo(0.4);

  scene.deck.setProps({effects: [new WindEffect({strength: 0.4, direction: 270, time: 1.25})]});
  const reversed = await scene.settle(3);
  expect(reversed).not.toEqual(windy);

  scene.deck.setProps({effects: [new WindEffect({strength: 0.4, direction: 270, time: 2.5})]});
  expect(await scene.settle(3)).not.toEqual(reversed);
  expect(tree.state.photoreal!.groups).toBe(groups);

  scene.deck.setProps({effects: []});
  expect(await scene.settle(4)).toEqual(calm);
  expect(tree.state.currentWindStrength).toBe(0);
  expect(scene.errors).toEqual([]);
  expect(scene.glErrors).toEqual([]);
});
