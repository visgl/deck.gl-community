// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  COORDINATE_SYSTEM,
  OrthographicViewport,
  type Deck,
  type PreRenderOptions
} from '@deck.gl/core';
import {NullDevice} from '@luma.gl/test-utils';
import {expect, it, vi} from 'vitest';
import {SplatSceneLayer} from '../../../src/splat-layer/scene/splat-scene-layer';
import {SplatSceneRuntime} from '../../../src/splat-layer/scene/splat-scene-runtime';

it.each([
  1, 2
])('reserves decoded static coverage before granting detail to %i RAD assets', radCount => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const staticAsset = {type: 'splats' as const, url: '/capture.splat', format: 'splat' as const};
  const radAssets = Array.from({length: radCount}, (_, index) => `/capture-${index}.rad`);
  const layer = new SplatSceneLayer({
    id: 'mixed',
    data: [staticAsset, ...radAssets].map(splats => ({splats, position: [0, 0, 0]})),
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    maxSplats: 1_000_000,
    maxTotalSplats: 1_000_000
  });
  runtime.register(layer);
  const decoded = {
    id: 1,
    data: {length: 800_000, destroy: vi.fn()},
    users: new Set(['mixed']),
    budgetKey: ''
  };
  runtime['assets'].set(staticAsset, decoded as never);
  const stopped = new Error('grant captured before GPU preparation');
  const acquire = vi
    .spyOn(runtime as any, 'acquireAsset')
    .mockImplementation((input, _layer, active) => {
      if (input === staticAsset) return decoded;
      expect(active).toBe((1_000_000 - 800_000) / radCount);
      throw stopped;
    });
  expect(() =>
    runtime.preRender({
      layers: [layer],
      viewports: [new OrthographicViewport({width: 128, height: 128})],
      isPicking: false
    } as PreRenderOptions)
  ).toThrow(stopped);
  expect(acquire).toHaveBeenCalledTimes(2);
  runtime.cleanup();
  device.destroy();
});

it('keeps a covered RAD asset loaded while camera refinement continues', () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const layer = new SplatSceneLayer({id: 'rad', data: '/capture.rad'});
  runtime.register(layer);
  runtime['assets'].set('/capture.rad', {
    id: 1,
    scene: {frontier: [{id: 'rad:0'}], destroy: vi.fn()},
    status: {phase: 'refining'},
    users: new Set(['rad']),
    budgetKey: ''
  } as never);
  expect(runtime.isLoaded('rad')).toBe(true);
  runtime.cleanup();
  device.destroy();
});
