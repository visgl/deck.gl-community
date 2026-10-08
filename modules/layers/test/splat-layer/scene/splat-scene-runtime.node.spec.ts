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

it('publishes an error status when off-thread static decoding fails', async () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const worker = {postMessage: vi.fn(), terminate: vi.fn(), onmessage: undefined as any};
  const onStatusChange = vi.fn();
  const layer = new SplatSceneLayer({
    id: 'broken',
    data: '/broken.splat',
    workerFactory: () => worker as never,
    onStatusChange
  });
  runtime.register(layer);
  const raise = vi.spyOn(layer, 'raiseError').mockImplementation(() => {});
  runtime['acquireAsset']('/broken.splat', layer, 10, 10);
  worker.onmessage({data: {error: 'Malformed source'}});
  await vi.waitFor(() =>
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({phase: 'error', pendingPages: 0, message: 'Malformed source'})
    )
  );
  expect(raise).toHaveBeenCalled();
  runtime.cleanup();
  device.destroy();
});

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

it('shares a nested parent allowance across two independent RAD scene layers', () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const parent = {maxSplats: 1_000_000, maxShadowSplats: Infinity};
  const layers = ['a', 'b'].map(
    id =>
      new SplatSceneLayer({
        id,
        data: `/${id}.rad`,
        maxSplats: 1_000_000,
        maxTotalSplats: Infinity,
        _splatBudgetGroup: {maxSplats: 2_000_000, maxShadowSplats: Infinity, parent}
      })
  );
  layers.forEach(layer => runtime.register(layer));
  const stopped = new Error('grant captured before GPU preparation');
  vi.spyOn(runtime as any, 'acquireAsset').mockImplementation((_input, _layer, active) => {
    expect(active).toBe(500_000);
    throw stopped;
  });
  expect(() =>
    runtime.preRender({
      layers,
      viewports: [new OrthographicViewport({width: 128, height: 128})],
      isPicking: false
    } as PreRenderOptions)
  ).toThrow(stopped);
  runtime.cleanup();
  device.destroy();
});
