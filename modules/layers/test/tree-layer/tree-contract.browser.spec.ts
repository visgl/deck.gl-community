// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  Deck,
  MapView,
  COORDINATE_SYSTEM,
  AmbientLight,
  DirectionalLight,
  LightingEffect
} from '@deck.gl/core';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {PlaneGeometry} from '@luma.gl/engine';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {TreeLayer} from '../../src';

it('casts wood shadows with ordinary LightingEffect and removes every tree part at zero coverage', async () => {
  const parent = document.createElement('div');
  parent.style.cssText = 'width:256px;height:256px';
  document.body.append(parent);
  const data = [
    {position: [0, 0, 0], species: 'oak'},
    {position: [8, 0, 0], species: 'pine'}
  ];
  const errors: string[] = [];
  let frames = 0;
  let pixels = new Uint8Array();
  let shadows = false,
    coverage = 1,
    ground = true;
  const coordinateProps = {
    coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
    coordinateOrigin: [0, 0, 0] as [number, number, number]
  };
  const make = () => [
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
      shadowEnabled: shadows,
      getCoverageWeight: coverage,
      maxCanopyPixels: 256 * 256,
      pickable: true
    })
  ];
  const deck = new Deck({
    parent,
    width: 256,
    height: 256,
    useDevicePixels: false,
    _animate: true,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new MapView(),
    initialViewState: {longitude: 0.00004, latitude: 0, zoom: 20, pitch: 45, bearing: 20},
    effects: [
      new LightingEffect({
        ambient: new AmbientLight({intensity: 1}),
        sun: new DirectionalLight({direction: [1, 1, -2], intensity: 0.5, _shadow: true})
      })
    ],
    layers: make(),
    onError: error => errors.push(error.message),
    onAfterRender({gl}) {
      pixels = new Uint8Array(256 * 256 * 4);
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      frames++;
    }
  });
  const settle = async () => {
    const before = frames;
    await expect.poll(() => frames, {timeout: 30000}).toBeGreaterThan(before + 5);
    await expect
      .poll(() => (deck.props.layers as TreeLayer[]).at(-1)!.isLoaded, {timeout: 30000})
      .toBe(true);
  };
  try {
    await settle();
    const unshadowed = pixels.slice();
    shadows = true;
    deck.setProps({layers: make()});
    await settle();
    let darkened = 0;
    for (let i = 0; i < pixels.length; i += 4) if (unshadowed[i] - pixels[i] > 12) darkened++;
    expect(darkened).toBeGreaterThan(30);
    ground = false;
    deck.setProps({layers: make()});
    await settle();
    expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(deck.pickObjects({x: 0, y: 0, width: 256, height: 256}).length).toBeGreaterThan(0);
    coverage = 0;
    deck.setProps({layers: make()});
    await settle();
    expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(false);
    expect(deck.pickObjects({x: 0, y: 0, width: 256, height: 256})).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    deck.finalize();
    parent.remove();
  }
}, 60000);
