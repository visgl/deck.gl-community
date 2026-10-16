// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it, vi} from 'vitest';
import {Model} from '@luma.gl/engine';
import type {Deck, MapView} from '@deck.gl/core';
import {SplatLayer, type TreeLayer} from '@deck.gl-community/layers';
import {mountTreeLabExample} from './app';

type FrameSample = {
  phase: 'wind' | 'bearing' | 'zoom';
  draws: number;
  destroyed: number;
  splats: number;
  cpuMs: number;
  frameMs: number;
};

it('batches mixed canopy sources and retains their model through bearing changes and refinement', async ({
  annotate
}) => {
  const parent = document.createElement('div');
  Object.assign(parent.style, {width: '800px', height: '600px'});
  document.body.append(parent);
  const samples: FrameSample[] = [];
  const errors: string[] = [];
  let deck!: Deck<MapView>;
  let frames = 0,
    started = 0,
    previous = 0,
    draws = 0,
    destroyed = 0;
  let phase: FrameSample['phase'] = 'wind';
  const originalDraw = Model.prototype.draw;
  const draw = vi.spyOn(Model.prototype, 'draw').mockImplementation(function (pass) {
    if (this.id === 'sorted-prepared-splats') draws++;
    return originalDraw.call(this, pass);
  });
  const originalDestroy = Model.prototype.destroy;
  const destroy = vi.spyOn(Model.prototype, 'destroy').mockImplementation(function () {
    if (this.id === 'sorted-prepared-splats') destroyed++;
    return originalDestroy.call(this);
  });
  const cleanup = mountTreeLabExample(parent, {
    onDeckInitialized(instance) {
      deck = instance;
      deck.setProps({
        _animate: true,
        onError: error => errors.push(error.message),
        onBeforeRender() {
          started = performance.now();
          draws = 0;
          destroyed = 0;
        },
        onAfterRender() {
          const now = performance.now();
          if (++frames > 4) {
            const trees = deck.props.layers.find(
              layer =>
                Boolean(layer) &&
                !Array.isArray(layer) &&
                typeof layer === 'object' &&
                'id' in layer &&
                layer.id === 'trees'
            ) as TreeLayer;
            const splats = trees
              .getSubLayers()
              .reduce(
                (sum, layer) =>
                  sum + (layer instanceof SplatLayer ? layer.splatStats.renderedSplats : 0),
                0
              );
            samples.push({
              phase,
              draws,
              destroyed,
              splats,
              cpuMs: now - started,
              frameMs: now - previous
            });
          }
          previous = now;
          const step = samples.length;
          if (step === 24) deck['animationLoop']?.stop();
          else if (step >= 8) {
            phase = step < 16 ? 'bearing' : 'zoom';
            deck.setProps({
              viewState: {
                longitude: 0,
                latitude: 0,
                pitch: 45,
                bearing: step < 16 ? 20 + (step - 7) * 5 : 60,
                zoom: 20 + (step < 16 ? 0 : (step - 15) * 0.05)
              }
            });
          }
        }
      });
    }
  });
  // Keep the profile fixture large enough to exercise sorted batching after the demo default changed to citrus.
  const species = parent.querySelector<HTMLSelectElement>('[name="species"]')!;
  species.value = 'banyan';
  species.dispatchEvent(new Event('input', {bubbles: true}));
  const height = parent.querySelector<HTMLInputElement>('[name="height"]')!;
  height.value = '1.8';
  height.dispatchEvent(new Event('input', {bubbles: true}));
  try {
    await expect.poll(() => samples.length, {timeout: 60000}).toBeGreaterThanOrEqual(24);
    await annotate('Tree frame profile', {
      body: JSON.stringify({samples, errors}),
      bodyEncoding: 'utf-8',
      contentType: 'application/json'
    });
    expect(errors).toEqual([]);
    expect(samples.every(sample => sample.splats > 10000)).toBe(true);
    expect(samples.every(sample => sample.draws === 1)).toBe(true);
    expect(samples.every(sample => sample.destroyed === 0)).toBe(true);
  } finally {
    cleanup();
    parent.remove();
    draw.mockRestore();
    destroy.mockRestore();
  }
}, 90000);
