// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it, vi} from 'vitest';
import {Model} from '@luma.gl/engine';
import type {Deck, MapView, MapViewState} from '@deck.gl/core';
import {SplatLayer, type TreeLayer} from '@deck.gl-community/layers';
import {mountTreeLabExample} from './app';

type FrameSample = {
  phase: 'settled' | 'rotate' | 'zoom';
  draws: number;
  destroyed: number;
  splats: number;
  cpuMs: number;
  frameMs: number;
};

// Eight species intentionally use separate shared foliage templates. Refinement may retain old and
// new representations together, so this is a bounded mixed-source pass count rather than a single
// monolithic draw like the old one-species citrus fixture.
const MAX_MIXED_CANOPY_PASSES = 64;

it('keeps mixed canopy passes bounded without destroying models during camera refinement', async ({
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
  let phase: FrameSample['phase'] = 'settled';
  let initialView: MapViewState | undefined;
  const originalDraw = Model.prototype.draw;
  const draw = vi.spyOn(Model.prototype, 'draw').mockImplementation(function (pass) {
    if (this.id.includes('canopy')) {
      draws++;
    }
    return originalDraw.call(this, pass);
  });
  const originalDestroy = Model.prototype.destroy;
  const destroy = vi.spyOn(Model.prototype, 'destroy').mockImplementation(function () {
    if (this.id.includes('canopy')) destroyed++;
    return originalDestroy.call(this);
  });
  const cleanup = mountTreeLabExample(parent, {
    onDeckInitialized(instance) {
      deck = instance;
      initialView = deck.props.initialViewState as MapViewState;
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
            const trees = deck.props.layers[1] as TreeLayer;
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
            phase = step < 16 ? 'rotate' : 'zoom';
            deck.setProps({
              viewState: {
                ...initialView!,
                bearing: step < 16 ? 20 + (step - 7) * 5 : 60,
                pitch: step < 16 ? 35 : 55,
                zoom: initialView!.zoom + (step < 16 ? 0 : (step - 15) * 0.05)
              }
            });
          }
        }
      });
    }
  });
  try {
    await expect.poll(() => samples.length, {timeout: 60000}).toBeGreaterThanOrEqual(24);
    await annotate('Tree frame profile', {
      body: JSON.stringify({samples, errors}),
      bodyEncoding: 'utf-8',
      contentType: 'application/json'
    });
    expect(errors).toEqual([]);
    expect(samples.every(sample => sample.splats > 0)).toBe(true);
    expect(
      samples.every(sample => sample.draws > 0 && sample.draws <= MAX_MIXED_CANOPY_PASSES)
    ).toBe(true);
    expect(samples.every(sample => sample.destroyed === 0)).toBe(true);
  } finally {
    cleanup();
    parent.remove();
    draw.mockRestore();
    destroy.mockRestore();
  }
}, 90000);
