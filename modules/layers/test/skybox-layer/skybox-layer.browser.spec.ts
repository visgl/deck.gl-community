// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, Layer, _GlobeView} from '@deck.gl/core';
import {TextureCubeLoader} from '@loaders.gl/textures';
import {afterEach, expect, test, vi} from 'vitest';
import {SkyboxLayer} from '../../src';

afterEach(() => vi.restoreAllMocks());

test.each([
  'resolve',
  'reject'
] as const)('ignores a cubemap load that %ss after removal', async result => {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<any>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  const load = vi.spyOn(TextureCubeLoader, 'parseText').mockReturnValue(pending);
  const layer = new SkyboxLayer({
    id: 'pending-skybox',
    cubemap: {
      shape: 'image-texture-cube',
      faces: {'+X': 'face', '-X': 'face', '+Y': 'face', '-Y': 'face', '+Z': 'face', '-Z': 'face'}
    }
  });
  const host = document.createElement('div');
  document.body.append(host);
  const onError = vi.fn();
  const finalize = vi.spyOn(layer, 'finalizeState');
  const deck = new Deck({parent: host, width: 128, height: 128, layers: [layer], onError});
  try {
    await vi.waitFor(() => expect(layer.state?.model).toBeTruthy(), {timeout: 10_000});
    const bindings = vi.spyOn(layer.state.model!, 'setBindings');
    const destroyModel = vi.spyOn(layer.state.model!, 'destroy');
    const inheritedCleanup = vi.spyOn(Layer.prototype, 'finalizeState');
    deck.setProps({layers: []});
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledOnce());
    expect(destroyModel).toHaveBeenCalledOnce();
    expect(inheritedCleanup).toHaveBeenCalledOnce();
    expect(layer.state.model).toBeUndefined();
    if (result === 'resolve') {
      resolve({
        type: 'cube',
        data: Array.from({length: 6}, () => ({
          width: 2,
          height: 2,
          data: new Uint8Array(16)
        }))
      });
    } else {
      reject(new Error('Obsolete skybox request failed'));
    }
    await pending.catch(() => {});
    await new Promise(accept => setTimeout(accept, 0));
    expect(bindings).not.toHaveBeenCalled();
    expect(layer.state.cubemapTexture).toBeNull();
    expect(destroyModel).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  } finally {
    deck.finalize();
    host.remove();
    load.mockRestore();
  }
}, 15_000);

test('preserves skybox depth and culling parameters when the globe view supplies its defaults', async () => {
  const face = document.createElement('canvas');
  face.width = face.height = 2;
  const context = face.getContext('2d')!;
  context.fillStyle = '#124678';
  context.fillRect(0, 0, 2, 2);
  const url = face.toDataURL();
  const layer = new SkyboxLayer({
    id: 'skybox',
    cubemap: {
      shape: 'image-texture-cube',
      faces: {'+X': url, '-X': url, '+Y': url, '-Y': url, '+Z': url, '-Z': url}
    }
  });
  const host = document.createElement('div');
  host.style.cssText = 'width:128px;height:128px';
  document.body.append(host);
  const onError = vi.fn();
  const deck = new Deck({
    parent: host,
    width: 128,
    height: 128,
    views: new _GlobeView(),
    initialViewState: {longitude: 0, latitude: 0, zoom: 0},
    layers: [layer],
    onError
  });
  try {
    await vi.waitFor(() => expect(layer.state?.cubemapTexture?.isReady).toBe(true), {
      timeout: 10000
    });
    deck.redraw(true);
    expect(layer.state.model?.parameters).toMatchObject({
      cullMode: 'front',
      depthWriteEnabled: false,
      depthCompare: 'less-equal'
    });
    expect(onError).not.toHaveBeenCalled();
    const destroyModel = vi.spyOn(layer.state.model!, 'destroy');
    const destroyTexture = vi.spyOn(layer.state.cubemapTexture!, 'destroy');
    const inheritedCleanup = vi.spyOn(Layer.prototype, 'finalizeState');
    deck.setProps({layers: []});
    await vi.waitFor(() => expect(destroyModel).toHaveBeenCalledOnce());
    expect(destroyTexture).toHaveBeenCalledOnce();
    expect(inheritedCleanup).toHaveBeenCalledOnce();
    expect(layer.state.model).toBeUndefined();
    expect(layer.state.cubemapTexture).toBeNull();
  } finally {
    deck.finalize();
    host.remove();
  }
}, 15000);
