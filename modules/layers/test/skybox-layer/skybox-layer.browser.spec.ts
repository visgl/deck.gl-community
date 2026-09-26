// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, _GlobeView} from '@deck.gl/core';
import {expect, test, vi} from 'vitest';
import {SkyboxLayer} from '../../src';

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
  } finally {
    deck.finalize();
    host.remove();
  }
}, 15000);
