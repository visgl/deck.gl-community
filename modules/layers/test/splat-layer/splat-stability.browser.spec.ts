// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, MapView, AmbientLight, DirectionalLight, LightingEffect} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {SplatLayer, createSplatHierarchy, type SplatSource} from '../../src';

it('renders an optical transition through a forced crown budget reduction, then stays pixel-stable', async () => {
  const parent = document.createElement('div');
  parent.style.cssText = 'width:256px;height:256px';
  document.body.append(parent);
  const positions: number[] = [];
  for (let i = 0; i < 96; i++) {
    const angle = (i / 96) * Math.PI * 2;
    positions.push(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0);
  }
  const source: SplatSource = {
    positions: new Float32Array(positions),
    scales: new Float32Array(Array.from({length: 96}, () => [0.04, 0.04, 0.025]).flat()),
    rotations: new Float32Array(Array.from({length: 96}, () => [1, 0, 0, 0]).flat()),
    colors: new Uint8Array(Array.from({length: 96}, () => [40, 130, 35, 255]).flat()),
    opacities: new Float32Array(96).fill(0.65)
  };
  const hierarchy = createSplatHierarchy(source, [0.12, 0.4, 2]);
  const data = [{position: [0, 0, 0] as [number, number, number]}];
  const errors: string[] = [];
  let frame = 0,
    pixels = new Uint8Array(),
    captureChanges = false;
  const changes: number[] = [];
  const make = (maxSplats: number) =>
    new SplatLayer({
      id: 'stable-crown',
      data,
      source,
      hierarchy,
      maxSplats,
      pixelError: 0.01,
      getScale: [12, 12, 12],
      getTranslation: [0, 0, 12],
      deformationStrength: 0,
      shadowEnabled: false,
      material: {unlit: true}
    });
  const deck = new Deck({
    parent,
    width: 256,
    height: 256,
    useDevicePixels: false,
    _animate: true,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new MapView(),
    initialViewState: {longitude: 0, latitude: 0, zoom: 21, pitch: 0},
    layers: [make(Infinity)],
    onError: error => errors.push(error.message),
    onAfterRender: ({gl}) => {
      const previous = pixels;
      pixels = new Uint8Array(256 * 256 * 4);
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (captureChanges && previous.length) {
        const delta = difference(previous, pixels);
        changes.push(delta);
      }
      frame++;
    }
  });
  const current = () => deck.props.layers[0] as SplatLayer;
  const difference = (a: Uint8Array, b: Uint8Array) =>
    a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / (a.length * 255);
  try {
    await expect.poll(() => frame, {timeout: 15000}).toBeGreaterThan(5);
    const before = pixels.slice();
    captureChanges = true;
    deck.setProps({layers: [make(1)]});
    await expect.poll(() => current().state.refinement.active, {timeout: 15000}).toBe(true);
    const entry = [...current().state.refinement.entries.values()][0];
    expect(entry.weights[0]).toBeGreaterThan(0);
    expect(entry.weights.at(-1)).toBeGreaterThan(0);
    // Both GPU representations contribute, rather than swapping the crown on this frame.
    expect(
      current()
        .getSubLayers()
        .filter(layer => layer.id.includes('refinement')).length
    ).toBeGreaterThan(1);

    await expect.poll(() => current().state.refinement.active, {timeout: 15000}).toBe(false);
    expect(difference(before, pixels)).toBeGreaterThan(0.01);
    expect(Math.max(...changes)).toBeLessThan(0.04);
    // The effect queues the final coverage upload for the following layer update.
    const finalUpload = frame;
    await expect.poll(() => frame, {timeout: 15000}).toBeGreaterThan(finalUpload + 2);
    const settled = pixels.slice(),
      settledFrame = frame;
    await expect.poll(() => frame, {timeout: 15000}).toBeGreaterThan(settledFrame + 5);
    expect(difference(settled, pixels)).toBe(0);
    const stableGroups = current().state.groups;
    for (const zoom of [21.0001, 20.9999, 21.0001, 21]) {
      const at = frame;
      deck.setProps({viewState: {longitude: 0, latitude: 0, zoom, pitch: 0, bearing: 0.0001}});
      await expect.poll(() => frame, {timeout: 15000}).toBeGreaterThan(at + 2);
      expect(current().state.groups).toEqual(stableGroups);
      expect(difference(settled, pixels)).toBeLessThan(0.003);
    }
    expect(errors).toEqual([]);
  } finally {
    deck.finalize();
    parent.remove();
  }
}, 30000);

it('keeps authored foliage lighting continuous across a grazing camera angle', async () => {
  const parent = document.createElement('div');
  parent.style.cssText = 'width:128px;height:128px';
  document.body.append(parent);
  const source: SplatSource = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([80, 180, 40, 255]),
    opacities: new Float32Array([0.9]),
    normals: new Float32Array([1, 0, 0])
  };
  const errors: string[] = [];
  let frames = 0,
    pixels = new Uint8Array();
  const deck = new Deck({
    parent,
    width: 128,
    height: 128,
    useDevicePixels: false,
    _animate: true,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new MapView(),
    initialViewState: {longitude: 0, latitude: 0, zoom: 21, pitch: 60, bearing: -0.01},
    effects: [
      new LightingEffect({
        ambient: new AmbientLight({intensity: 0.1}),
        sun: new DirectionalLight({direction: [-1, 0, -1], intensity: 2})
      })
    ],
    layers: [
      new SplatLayer({
        id: 'grazing-lit-crown',
        source,
        data: [{}],
        getPosition: [0, 0, 0],
        getTranslation: [0, 0, 0],
        shadowEnabled: false,
        deformationStrength: 0,
        material: {ambient: 0.5, diffuse: 0.7, specularColor: [0, 0, 0]}
      })
    ],
    onError: error => errors.push(error.message),
    onAfterRender: ({gl}) => {
      pixels = new Uint8Array(128 * 128 * 4);
      gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      frames++;
    }
  });
  try {
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(5);
    const before = pixels.slice(),
      at = frames;
    expect(before.reduce((sum, value, i) => sum + (i % 4 === 1 ? value : 0), 0)).toBeGreaterThan(
      10000
    );
    deck.setProps({viewState: {longitude: 0, latitude: 0, zoom: 21, pitch: 60, bearing: 0.01}});
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(at + 3);
    const difference =
      before.reduce((sum, value, i) => sum + Math.abs(value - pixels[i]), 0) /
      (before.length * 255);
    expect(difference).toBeLessThan(0.003);
    expect(errors).toEqual([]);
  } finally {
    deck.finalize();
    parent.remove();
  }
}, 30000);
