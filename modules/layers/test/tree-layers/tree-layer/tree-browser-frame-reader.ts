// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, type Layer, type LayerManager, type LightingEffect} from '@deck.gl/core';
import {WindEffect, type WindEffectProps} from '@deck.gl-community/layers/wind-layers/wind-effect';
import {TreeLayer, type TreeSpec} from '../../../src';
import {webgl2Adapter} from '@luma.gl/core/webgl';
import {afterEach, expect} from 'vitest';

export type TreeBrowserScene = {
  deck: Deck;
  errors: string[];
  glErrors: number[];
  layerManager(): LayerManager;
  setViewState(viewState: unknown): void;
  render(layers: Layer[], frames?: number): Promise<Uint8Array>;
  settle(frames?: number): Promise<Uint8Array>;
  cleanup(): void;
};

const testWind = new WeakMap<Layer, WindEffectProps>();

export function createTreeFixture(
  Type: typeof TreeLayer<TreeSpec>,
  {windStrength = 0, windDirection = null, windTime = null, ...props}: Record<string, unknown>
): TreeLayer<TreeSpec> {
  const layer = new Type(props);
  testWind.set(layer, {
    strength: windStrength as number,
    direction: windDirection as number | null,
    time: windTime as number | null
  });
  return layer;
}

export function renderTreeFixtures(deck: Deck, layers: Layer[]) {
  const wind = layers.map(layer => testWind.get(layer)).find(Boolean);
  if (!wind) {
    deck.setProps({layers});
    return;
  }
  const effects = deck.props.effects?.filter(effect => !(effect instanceof WindEffect)) ?? [];
  deck.setProps({layers, effects: [...effects, new WindEffect(wind)]});
}

const scenes = new Set<TreeBrowserScene>();

afterEach(() => {
  for (const scene of scenes) scene.cleanup();
});

/** Mount a WebGL2 scene with optional frame-by-frame sampling for expensive cases. */
export function mountTreeBrowserScene({
  size,
  effects = [],
  views,
  viewState,
  staticFrames = false
}: {
  size: number;
  effects?: LightingEffect[];
  views: unknown;
  viewState: unknown;
  staticFrames?: boolean;
}): TreeBrowserScene {
  const parent = document.createElement('div');
  parent.style.cssText = `width:${size}px;height:${size}px`;
  document.body.append(parent);
  const errors: string[] = [];
  const glErrors: number[] = [];
  const frameReader = createTreeFrameReader(size, glErrors, staticFrames);
  const deck = new Deck({
    parent,
    width: size,
    height: size,
    useDevicePixels: false,
    _animate: true,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: views as never,
    viewState: viewState as never,
    effects,
    layers: [],
    onError: error => errors.push(error.message),
    onAfterRender: frameReader.onAfterRender
  });
  const settle = (count?: number) => frameReader.settle(deck, count);
  const scene: TreeBrowserScene = {
    deck,
    errors,
    glErrors,
    settle,
    layerManager: () => (deck as unknown as {layerManager: LayerManager}).layerManager,
    setViewState: state => deck.setProps({viewState: state as never}),
    render(layers, frames) {
      renderTreeFixtures(deck, layers);
      return settle(frames);
    },
    cleanup() {
      if (!scenes.delete(scene)) return;
      deck.finalize();
      parent.remove();
    }
  };
  scenes.add(scene);
  return scene;
}

export function createTreeFrameReader(size: number, glErrors: number[], staticFrames: boolean) {
  let pixels = new Uint8Array();
  let frames = 0;
  let readFrame = !staticFrames;
  return {
    onAfterRender({gl}: {gl: WebGL2RenderingContext}) {
      if (readFrame) {
        pixels = new Uint8Array(size * size * 4);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      }
      const error = gl.getError();
      if (error) glErrors.push(error);
      frames++;
    },
    async settle(deck: Deck, count = staticFrames ? 1 : 4) {
      if (staticFrames) {
        await expect.poll(() => deck.isInitialized, {timeout: 60000}).toBe(true);
        const loop = deck['animationLoop']!;
        loop.stop();
        const before = frames;
        // Drive Deck normally, but do not read back or draw while the test is between samples.
        try {
          for (let i = 1; i <= count; i++) {
            readFrame = i === count;
            loop.redraw();
          }
        } finally {
          readFrame = false;
        }
        expect(frames).toBe(before + count);
      } else {
        const before = frames;
        await expect.poll(() => frames, {timeout: 60000}).toBeGreaterThanOrEqual(before + count);
      }
      return pixels;
    }
  };
}
