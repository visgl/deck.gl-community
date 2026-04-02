// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {
  convertLoadedCubemapToTextureData,
  createCubemapLoadOptions
} from '../../src/skybox-layer/cubemap-utils';

describe('createCubemapLoadOptions', () => {
  it('promotes baseUrl into core.baseUrl for in-memory manifests', () => {
    const loadOptions = createCubemapLoadOptions(
      {
        shape: 'image-texture-cube',
        faces: {
          '+X': 'right.png',
          '-X': 'left.png',
          '+Y': 'top.png',
          '-Y': 'bottom.png',
          '+Z': 'front.png',
          '-Z': 'back.png'
        }
      },
      {baseUrl: 'https://example.com/assets/environment.image-texture-cube.json'}
    );

    expect(loadOptions?.core?.baseUrl).toBe(
      'https://example.com/assets/environment.image-texture-cube.json'
    );
  });
});

describe('convertLoadedCubemapToTextureData', () => {
  it('maps loader output faces into luma cube-face keys', () => {
    const texture = convertLoadedCubemapToTextureData({
      type: 'cube',
      data: [
        [{data: new Uint8Array([1]), width: 1, height: 1}],
        [{data: new Uint8Array([2]), width: 1, height: 1}],
        [{data: new Uint8Array([3]), width: 1, height: 1}],
        [{data: new Uint8Array([4]), width: 1, height: 1}],
        [{data: new Uint8Array([5]), width: 1, height: 1}],
        [{data: new Uint8Array([6]), width: 1, height: 1}]
      ]
    });

    expect((texture['+X'] as Array<{data: Uint8Array}>)[0].data[0]).toBe(1);
    expect((texture['-X'] as Array<{data: Uint8Array}>)[0].data[0]).toBe(2);
    expect((texture['+Y'] as Array<{data: Uint8Array}>)[0].data[0]).toBe(3);
    expect((texture['-Y'] as Array<{data: Uint8Array}>)[0].data[0]).toBe(4);
    expect((texture['+Z'] as Array<{data: Uint8Array}>)[0].data[0]).toBe(5);
    expect((texture['-Z'] as Array<{data: Uint8Array}>)[0].data[0]).toBe(6);
  });
});
