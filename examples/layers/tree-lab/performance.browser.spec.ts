// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it, vi} from 'vitest';
import {Model} from '@luma.gl/engine';
import type {Deck, MapView} from '@deck.gl/core';
import {SplatLayer, type TreeLayer} from '@deck.gl-community/layers';
import {mountTreeLabExample} from './app';

type FrameSample = {
  phase: 'grove' | 'bearing' | 'zoom';
  draws: number;
  destroyed: number;
  splats: number;
  cpuMs: number;
  frameMs: number;
};
const PROFILE_FRAME_COUNT = 96;
const PROFILE_PHASE_FRAMES = PROFILE_FRAME_COUNT / 3;

it.each([
  'banyan',
  'palm'
] as const)('profiles the 10,000-tree %s grove and retains canopy models through camera changes', async speciesType => {
  const parent = document.createElement('div');
  Object.assign(parent.style, {width: '800px', height: '600px'});
  document.body.append(parent);
  const samples: FrameSample[] = [];
  const drawnModels = new Set<string>();
  const errors: string[] = [];
  let deck!: Deck<MapView>;
  let frames = 0,
    started = 0,
    previous = 0,
    draws = 0,
    destroyed = 0;
  let phase: FrameSample['phase'] = 'grove';
  const originalDraw = Model.prototype.draw;
  const draw = vi.spyOn(Model.prototype, 'draw').mockImplementation(function (pass) {
    if (this.id === 'sorted-prepared-splats' || this.id.includes('canopy-')) {
      draws++;
      drawnModels.add(this.id);
    }
    return originalDraw.call(this, pass);
  });
  const originalDestroy = Model.prototype.destroy;
  const destroy = vi.spyOn(Model.prototype, 'destroy').mockImplementation(function () {
    if (this.id === 'sorted-prepared-splats' || this.id.includes('canopy-')) destroyed++;
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
          if (step === PROFILE_FRAME_COUNT) deck['animationLoop']?.stop();
          else if (step >= PROFILE_PHASE_FRAMES) {
            phase = step < PROFILE_PHASE_FRAMES * 2 ? 'bearing' : 'zoom';
            deck.setProps({
              viewState: {
                longitude: 0,
                latitude: 0,
                pitch: 45,
                bearing:
                  step < PROFILE_PHASE_FRAMES * 2
                    ? 20 + ((step - PROFILE_PHASE_FRAMES) / PROFILE_PHASE_FRAMES) * 40
                    : 60,
                zoom:
                  20 +
                  (step < PROFILE_PHASE_FRAMES * 2
                    ? 0
                    : ((step - PROFILE_PHASE_FRAMES * 2) / PROFILE_PHASE_FRAMES) * 0.5)
              }
            });
          }
        }
      });
    }
  });
  const scene = parent.querySelector<HTMLSelectElement>('[name="scene"]')!;
  scene.value = 'grove';
  const species = parent.querySelector<HTMLSelectElement>('[name="species"]')!;
  species.value = speciesType;
  const treeCount = parent.querySelector<HTMLInputElement>('[name="tree-count"]')!;
  treeCount.value = '10000';
  // Apply all controls in one update so the profile spends time rendering, not rebuilding 30k rows.
  scene.dispatchEvent(new Event('input', {bubbles: true}));
  try {
    const trees = () =>
      deck.props.layers.find(
        layer =>
          Boolean(layer) &&
          !Array.isArray(layer) &&
          typeof layer === 'object' &&
          'id' in layer &&
          layer.id === 'trees'
      ) as TreeLayer;
    expect((trees().props.data as unknown[]).length).toBe(10000);
    await expect
      .poll(() => samples.length, {timeout: 60000})
      .toBeGreaterThanOrEqual(PROFILE_FRAME_COUNT);
    const percentile = (values: number[], fraction: number) =>
      values.sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
    const p95CpuMs = percentile(
      samples.map(sample => sample.cpuMs),
      0.95
    );
    const p95FrameMs = percentile(
      samples.map(sample => sample.frameMs),
      0.95
    );
    const maxRenderedSplats = Math.max(...samples.map(sample => sample.splats));
    console.info(
      `TreeLayer 10k frame profile: ${JSON.stringify({
        trees: 10000,
        p95CpuMs,
        p95FrameMs,
        maxDraws: Math.max(...samples.map(sample => sample.draws)),
        drawnModels: [...drawnModels],
        maxSplats: maxRenderedSplats
      })}`
    );
    expect(p95CpuMs, 'The 10k grove should stay within a 60 FPS CPU frame budget').toBeLessThan(
      1000 / 60
    );
    expect(
      p95FrameMs,
      'The 10k grove should keep the measured browser frame cadence within 60 FPS'
    ).toBeLessThanOrEqual(1000 / 60);
    expect(
      maxRenderedSplats,
      'The shared canopy submission budget should remain bounded'
    ).toBeLessThanOrEqual(20000);
    expect(errors).toEqual([]);
    expect(samples.every(sample => sample.splats > 0)).toBe(true);
    expect(samples.every(sample => sample.draws > 0 && sample.draws <= 8)).toBe(true);
    expect(samples.every(sample => sample.destroyed === 0)).toBe(true);
  } finally {
    cleanup();
    parent.remove();
    draw.mockRestore();
    destroy.mockRestore();
  }
}, 90000);
