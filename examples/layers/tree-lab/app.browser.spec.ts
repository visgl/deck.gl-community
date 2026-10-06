// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Value: protects=ten Tree Lab renders survive shadow toggles with seasonal color and wind deformation;
// fails_when=shadow samplers vanish, seasons stop changing, wind stays static, or owner picking breaks;
// why_new=no existing integration covers these ten WebGL surfaces; seam=none

import {CompositeLayer, type Deck, type Layer} from '@deck.gl/core';
import {describe, expect, it} from 'vitest';
import {mountTreeLabExample} from './app';
import {SEASONS, type SceneOptions, type Specimen} from './scene';

type ReviewSpecimen = {
  deck: Deck;
  renderer: string;
  species: string;
  data: Specimen[];
  rendered: number;
};
type ReviewApi = {
  readonly ready: number;
  readonly errors: string[];
  setOptions: (next: Partial<SceneOptions>) => void;
  getOptions: () => SceneOptions;
  getDecks: () => ReviewSpecimen[];
};
type Frame = {width: number; height: number; pixels: Uint8Array};

function collectModels(layer: Layer): ReturnType<Layer['getModels']> {
  return layer instanceof CompositeLayer
    ? layer.getSubLayers().flatMap(collectModels)
    : layer.getModels();
}

function countTreePixels(frame: Frame): number {
  const {pixels} = frame;
  let count = 0;
  // The receiving ground plane fills the frame and has uniform directional
  // lighting. The corner is outside the specimen and its cast shadow.
  for (let i = 0; i < pixels.length; i += 4) {
    const distance =
      Math.abs(pixels[i] - pixels[0]) +
      Math.abs(pixels[i + 1] - pixels[1]) +
      Math.abs(pixels[i + 2] - pixels[2]);
    if (pixels[i + 3] > 0 && distance > 25) count++;
  }
  return count;
}

function countChangedPixels(before: Frame, after: Frame): number {
  expect([after.width, after.height]).toEqual([before.width, before.height]);
  let count = 0;
  for (let i = 0; i < before.pixels.length; i += 4) {
    const distance =
      Math.abs(before.pixels[i] - after.pixels[i]) +
      Math.abs(before.pixels[i + 1] - after.pixels[i + 1]) +
      Math.abs(before.pixels[i + 2] - after.pixels[i + 2]);
    if (distance > 10) count++;
  }
  return count;
}

describe('Tree Lab rendering controls', () => {
  it('keeps all fourteen trees visible across shadow toggles, four seasons and frozen wind poses', async () => {
    const originalUrl = location.href;
    const reviewUrl = new URL(originalUrl);
    reviewUrl.searchParams.set('auto', '0');
    reviewUrl.searchParams.set('season', 'invalid');
    reviewUrl.searchParams.delete('backend');
    history.replaceState(null, '', reviewUrl);
    const container = document.createElement('div');
    container.style.width = '900px';
    document.body.append(container);
    const cleanup = mountTreeLabExample(container, {benchmarkLinks: false});
    const api = (window as Window & {treeLab?: ReviewApi}).treeLab!;
    const frames = new Map<ReviewSpecimen, Frame>();
    try {
      expect(api.getOptions().season).toBe('summer');
      await expect.poll(() => api.ready, {timeout: 15000}).toBe(14);
      expect(api.errors).toEqual([]);
      const specimens = api.getDecks();
      expect(specimens).toHaveLength(14);
      for (const specimen of specimens) {
        const originalAfterRender = specimen.deck.props.onAfterRender;
        specimen.deck.setProps({
          onAfterRender(context) {
            originalAfterRender?.(context);
            const {gl} = context;
            const width = gl.drawingBufferWidth;
            const height = gl.drawingBufferHeight;
            const pixels = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            frames.set(specimen, {width, height, pixels});
          }
        });
      }
      const capture = async (change: () => void) => {
        const previousFrames = specimens.map(specimen => specimen.rendered);
        frames.clear();
        change();
        await expect
          .poll(
            () =>
              specimens.every(
                (specimen, index) =>
                  specimen.rendered > previousFrames[index] && frames.has(specimen)
              ),
            {timeout: 15000}
          )
          .toBe(true);
        expect(api.errors).toEqual([]);
        return new Map(frames);
      };
      const assertVisible = async (
        captures: Map<ReviewSpecimen, Frame>,
        nativeOnly = false,
        verifyPicking = false
      ) => {
        for (const specimen of specimens) {
          if (nativeOnly && specimen.renderer !== 'native') continue;
          const frame = captures.get(specimen)!;
          expect(
            countTreePixels(frame),
            `${specimen.renderer}/${specimen.species} tree pixels`
          ).toBeGreaterThan(50);
          if (specimen.species === 'banyan' || specimen.species === 'mangrove') {
            let foliage = 0;
            for (let i = 0; i < frame.pixels.length; i += 4) {
              const [r, g, b] = frame.pixels.subarray(i, i + 3);
              if (g > r * 1.2 && g > b * 1.2 && g < 220) foliage++;
            }
            expect(
              foliage,
              `${specimen.renderer}/${specimen.species} evergreen foliage pixels`
            ).toBeGreaterThan(100);
          }
          if (verifyPicking && specimen.renderer === 'native') {
            const canvas = specimen.deck.getCanvas()!;
            expect(canvas.clientWidth).toBeGreaterThan(32);
            expect(canvas.clientHeight).toBeGreaterThan(32);
            const picked = specimen.deck.pickObjects({
              x: 0,
              y: 0,
              width: canvas.clientWidth,
              height: canvas.clientHeight
            });
            expect(
              picked.some(info => info.object === specimen.data[0]),
              `${specimen.renderer}/${specimen.species} owner picking: ${JSON.stringify(
                picked.map(info => ({index: info.index, object: info.object}))
              )}`
            ).toBe(true);
          }
        }
      };
      const initialShadows = await capture(() =>
        api.setOptions({
          season: 'summer',
          shadows: true,
          wind: false,
          windTime: 0,
          crops: false,
          dropped: false,
          pixelRatio: 1
        })
      );
      await assertVisible(initialShadows);
      for (const specimen of specimens.filter(item => item.renderer === 'native')) {
        const layers = specimen.deck.props.layers as Layer[];
        const models = layers.flatMap(layer => collectModels(layer));
        expect(models.length).toBeGreaterThan(0);
        for (const model of models.filter(model => !model.id.includes('shadow-casters'))) {
          // Inspect the assembled shader, so a misspelled injection hook cannot
          // silently run material shading for every depth-only fragment.
          const main = model.pipeline.fs!.source.match(/void\s+main\s*\([^)]*\)\s*\{([\s\S]*)/)!;
          expect(main[1]).toMatch(/^\s*if \(shadow.drawShadowMap\) \{ return; \}/);
        }
      }
      const shadowToggle = container.querySelector<HTMLInputElement>('[data-option="shadows"]')!;
      const withoutShadows = await capture(() => shadowToggle.click());
      expect(api.getOptions().shadows).toBe(false);
      // Picking alone would still pass if only the visible color shader broke.
      // The shadow-free RGB assertion specifically catches disappearing trees.
      await assertVisible(withoutShadows);
      const restoredShadows = await capture(() => shadowToggle.click());
      expect(api.getOptions().shadows).toBe(true);
      await assertVisible(restoredShadows);
      for (const specimen of specimens) {
        expect(
          countChangedPixels(initialShadows.get(specimen)!, withoutShadows.get(specimen)!),
          `${specimen.renderer}/${specimen.species} shadow difference`
        ).toBeGreaterThan(10);
        expect(
          countChangedPixels(withoutShadows.get(specimen)!, restoredShadows.get(specimen)!),
          `${specimen.renderer}/${specimen.species} restored shadows`
        ).toBeGreaterThan(10);
      }
      await capture(() => shadowToggle.click());
      const seasonalFrames = new Map<string, Map<ReviewSpecimen, Frame>>();
      for (const season of SEASONS) {
        const button = container.querySelector<HTMLButtonElement>(`[data-season="${season}"]`)!;
        const captures = await capture(() => button.click());
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(api.getOptions().season).toBe(season);
        await assertVisible(captures, true);
        seasonalFrames.set(season, captures);
      }
      for (const specimen of specimens.filter(item => item.renderer === 'native')) {
        expect(
          countChangedPixels(
            seasonalFrames.get('spring')!.get(specimen)!,
            seasonalFrames.get('autumn')!.get(specimen)!
          ),
          `${specimen.species} seasonal color`
        ).toBeGreaterThan(10);
        if (['oak', 'birch', 'cherry'].includes(specimen.species)) {
          expect(countTreePixels(seasonalFrames.get('winter')!.get(specimen)!)).toBeLessThan(
            countTreePixels(seasonalFrames.get('summer')!.get(specimen)!)
          );
        }
      }
      const windStart = await capture(() =>
        api.setOptions({season: 'summer', wind: true, windTime: 0})
      );
      const windLater = await capture(() => api.setOptions({windTime: 2}));
      for (const specimen of specimens) {
        const changed = countChangedPixels(windStart.get(specimen)!, windLater.get(specimen)!);
        expect(
          changed,
          `${specimen.renderer}/${specimen.species} frozen wind deformation`
        ).toBeGreaterThan(10);
      }
      await assertVisible(windLater, false, true);
      expect(specimens.every(specimen => specimen.rendered > 8)).toBe(true);
      expect(api.errors).toEqual([]);
    } finally {
      cleanup();
      container.remove();
      history.replaceState(null, '', originalUrl);
    }
  }, 90000);
});
