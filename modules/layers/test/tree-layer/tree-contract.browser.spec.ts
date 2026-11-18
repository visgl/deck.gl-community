// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {MapView, AmbientLight, DirectionalLight, LightingEffect} from '@deck.gl/core';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {PlaneGeometry} from '@luma.gl/engine';
import {expect, it} from 'vitest';
import {TreeLayer} from '../../src';
import {mountTreeBrowserScene} from './tree-browser-frame-reader';

const SIZE = 256;

it('renders tree parts and removes every part at zero coverage', async () => {
  const data = [
    {position: [0, 0, 0], species: 'oak'},
    {position: [8, 0, 0], species: 'pine'}
  ];
  const coordinateProps = {
    coordinateSystem: 'meter-offsets',
    coordinateOrigin: [0, 0, 0] as [number, number, number]
  };
  const make = (coverage: number, ground = false) => [
    ...(ground
      ? [
          new SimpleMeshLayer({
            ...coordinateProps,
            id: 'receiver',
            data: [{position: [0, 0, -0.05]}],
            mesh: new PlaneGeometry({type: 'x,y', xlen: 100, ylen: 100}),
            getColor: [240, 240, 240],
            material: {ambient: 1, diffuse: 0, shininess: 0}
          })
        ]
      : []),
    new TreeLayer({
      ...coordinateProps,
      id: 'contract-trees',
      data,
      getTreeType: row => row.species as 'oak' | 'pine',
      getSeason: 'winter',
      getHeight: 12,
      getCanopyRadius: 4,
      getTrunkRadius: 0.35,
      getTrunkHeightFraction: row => (row.species === 'pine' ? 0 : 0.35),
      getCrop: {kind: 'cone', color: [200, 100, 40], count: 4, droppedCount: 2, radius: 0.25},
      windStrength: 0,
      getCoverageWeight: coverage,
      // Retain coarse crowns so software adapters focus on the tree parts and coverage.
      pickable: true
    })
  ];
  const scene = mountTreeBrowserScene({
    size: SIZE,
    staticFrames: true,
    views: new MapView(),
    viewState: {longitude: 0.00004, latitude: 0, zoom: 20, pitch: 45, bearing: 20},
    effects: [
      new LightingEffect({
        ambient: new AmbientLight({intensity: 1}),
        directional: new DirectionalLight({direction: [-1, -1, -1], intensity: 0.5})
      })
    ]
  });
  const capture = async (coverage: number, ground = false) => {
    const layers = make(coverage, ground);
    const pixels = await scene.render(layers, 2);
    expect(layers.at(-1)!.isLoaded).toBe(true);
    return pixels;
  };
  const hasColor = (pixels: Uint8Array) =>
    pixels.some((value, index) => index % 4 === 3 && value > 0);
  const pickTrees = () => scene.deck.pickObjects({x: 0, y: 0, width: SIZE, height: SIZE});
  await capture(1, true);
  expect(hasColor(await capture(1))).toBe(true);
  expect(pickTrees().length).toBeGreaterThan(0);
  expect(hasColor(await capture(0))).toBe(false);
  expect(pickTrees()).toEqual([]);
  expect(scene.errors).toEqual([]);
}, 60000);
