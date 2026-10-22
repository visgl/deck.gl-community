// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';
import {getSharedTextureCount} from '../src/shared-texture';
import type {SpriteAtlas} from '../src/sprite';

const SIZE = 64;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

async function createAtlas(): Promise<SpriteAtlas> {
  const canvas = new OffscreenCanvas(16, 16);
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'rgb(255, 0, 0)';
  context.fillRect(0, 0, 16, 16);
  return {
    id: 'default',
    image: await createImageBitmap(canvas),
    mapping: {dot: {x: 0, y: 0, width: 16, height: 16, mask: false}}
  } as SpriteAtlas;
}

function labelLayer(id: string, spriteAtlases: SpriteAtlas[], labels = true) {
  return new MVTLabelLayer({
    id,
    config: {labels},
    zoom: 8,
    styleLayer: {
      layout: {'text-field': 'Ab', 'icon-image': 'dot', 'text-size': 20},
      paint: {}
    },
    spriteAtlases,
    data: [
      {
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [0, 0]},
        properties: {}
      }
    ]
  } as any);
}

/** Renders `layers` and resolves once every layer has loaded. */
function render(layers: any[]): Promise<any[]> {
  parent = document.createElement('div');
  document.body.append(parent);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 10_000);
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new OrthographicView({id: 'texture-test'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers,
      onAfterRender: () => {
        const all = (deck as any)?.layerManager?.getLayers() || [];
        if (!all.length || all.some(layer => !layer.isLoaded)) {
          return;
        }
        window.clearTimeout(timeout);
        resolve(all);
      },
      onError: error => {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

describe('shared label textures', () => {
  test('label layers share one font atlas texture and one sprite texture', async () => {
    const atlas = await createAtlas();
    const layers = await render([labelLayer('a', [atlas]), labelLayer('b', [atlas])]);
    const device = deck!.device!;
    const atlasOf = (isLayer: (layer: any) => boolean) =>
      layers
        .filter(isLayer)
        .map(layer => layer.getAttributeManager() && layer.state.iconManager.getTexture());
    // The glyphs of each text layer, and the icon layers.
    const glyphTextures = atlasOf(layer => layer.id.endsWith('-characters'));
    const iconTextures = atlasOf(layer => layer.constructor.layerName === 'IconLayer');
    expect(glyphTextures).toHaveLength(2);
    expect(glyphTextures[0]).toBeTruthy();
    expect(glyphTextures[1]).toBe(glyphTextures[0]);
    expect(iconTextures).toHaveLength(2);
    expect(iconTextures[0]).toBeTruthy();
    expect(iconTextures[1]).toBe(iconTextures[0]);
    expect(iconTextures[0]).not.toBe(glyphTextures[0]);
    expect(getSharedTextureCount(device)).toBe(2);

    // Released once no layer draws from them.
    await new Promise<void>(resolve => {
      deck!.setProps({layers: [], onAfterRender: () => resolve()});
    });
    expect(getSharedTextureCount(device)).toBe(0);
  });

  test('a label layer with labels turned off releases its sprite texture', async () => {
    const atlas = await createAtlas();
    await render([labelLayer('a', [atlas])]);
    const device = deck!.device!;
    expect(getSharedTextureCount(device)).toBe(2);
    await new Promise<void>(resolve => {
      deck!.setProps({layers: [labelLayer('a', [atlas], false)], onAfterRender: () => resolve()});
    });
    expect(getSharedTextureCount(device)).toBe(0);
  });

  test('the textures stay while another label layer draws from them, and go with the last', async () => {
    const atlas = await createAtlas();
    await render([labelLayer('a', [atlas]), labelLayer('b', [atlas])]);
    const device = deck!.device!;
    const textures = () =>
      ((deck as any).layerManager.getLayers() as any[])
        .filter(layer => layer.state?.iconManager)
        .map(layer => layer.state.iconManager.getTexture());
    const before = textures();
    await new Promise<void>(resolve => {
      deck!.setProps({layers: [labelLayer('b', [atlas])], onAfterRender: () => resolve()});
    });
    expect(getSharedTextureCount(device)).toBe(2);
    const after = textures();
    expect(after).toHaveLength(2);
    for (const texture of after) {
      expect(before).toContain(texture);
      expect(texture.destroyed).toBe(false);
    }

    // Destroyed once the second layer goes too.
    await new Promise<void>(resolve => {
      deck!.setProps({layers: [], onAfterRender: () => resolve()});
    });
    expect(getSharedTextureCount(device)).toBe(0);
    for (const texture of after) {
      expect(texture.destroyed).toBe(true);
    }
  });
});
