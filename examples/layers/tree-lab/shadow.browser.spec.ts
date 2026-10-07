// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Value: protects=ground shadow footprints depend on geometry and sun rather than caster material;
// fails_when=lighting or opacity corrupts packed depth and creates material-dependent shadow holes;
// why_new=the Tree Lab controls test does not isolate and compare ground shadow pixels; seam=none

import {Deck, type DeckProps, type Layer} from '@deck.gl/core';
import {TreeLayer} from '@deck.gl-community/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {describe, expect, it} from 'vitest';
import {ReferenceThreeTreeLayer} from './baseline/tree-layer';
import {
  createLighting,
  createSceneLayers,
  createSpecimens,
  createViews,
  DEFAULT_OPTIONS,
  VIEW
} from './scene';
import {getTourFrame} from './tour';

type Frame = {width: number; height: number; pixels: Uint8Array};

function getShadowMask(clear: Frame, shadowed: Frame): Uint8Array {
  expect([shadowed.width, shadowed.height]).toEqual([clear.width, clear.height]);
  const mask = new Uint8Array(clear.width * clear.height);
  for (let pixel = 0; pixel < mask.length; pixel++) {
    const offset = pixel * 4;
    const distance =
      clear.pixels[offset] -
      shadowed.pixels[offset] +
      clear.pixels[offset + 1] -
      shadowed.pixels[offset + 1] +
      clear.pixels[offset + 2] -
      shadowed.pixels[offset + 2];
    if (clear.pixels[offset + 3] > 0 && distance > 15) mask[pixel] = 1;
  }
  return mask;
}

function countChangedPixels(before: Frame, after: Frame): number {
  expect([after.width, after.height]).toEqual([before.width, before.height]);
  let count = 0;
  for (let offset = 0; offset < before.pixels.length; offset += 4) {
    const distance =
      Math.abs(before.pixels[offset] - after.pixels[offset]) +
      Math.abs(before.pixels[offset + 1] - after.pixels[offset + 1]) +
      Math.abs(before.pixels[offset + 2] - after.pixels[offset + 2]);
    if (distance > 10) count++;
  }
  return count;
}

function countMaskDifferences(before: Uint8Array, after: Uint8Array): number {
  let count = 0;
  for (let pixel = 0; pixel < before.length; pixel++) {
    if (before[pixel] !== after[pixel]) count++;
  }
  return count;
}

describe.sequential('Tree Lab shadow depth', () => {
  for (const renderer of ['native', 'original'] as const) {
    it(`${renderer} preserves ground shadows across caster materials and sun angles`, async () => {
      const width = 440;
      const height = 400;
      const container = document.createElement('div');
      container.style.cssText = `width:${width}px;height:${height}px`;
      document.body.append(container);
      const errors: string[] = [];
      const matchedLighting = createLighting(true);
      // Gaussian canopies use the host's optical transmission pass, combined with mesh depth.
      const lighting = matchedLighting;
      lighting.shadowColor = matchedLighting.shadowColor;
      let latestFrame: Frame | undefined;
      let frameNumber = 0;
      const deck = new Deck({
        parent: container,
        width,
        height,
        _animate: true,
        useDevicePixels: false,
        deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
        views: createViews(),
        initialViewState: VIEW,
        effects: [lighting],
        layers: [],
        onError: error => errors.push(error.message),
        onAfterRender({gl}) {
          const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
          gl.readPixels(
            0,
            0,
            gl.drawingBufferWidth,
            gl.drawingBufferHeight,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels
          );
          if (gl.getError() !== gl.NO_ERROR) errors.push('Shadow pixel read failed');
          latestFrame = {width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, pixels};
          frameNumber++;
        }
      });
      try {
        const data = createSpecimens('oak');
        const LayerClass = renderer === 'native' ? TreeLayer : ReferenceThreeTreeLayer;
        const capture = async (props: Partial<DeckProps>) => {
          const previousFrame = frameNumber;
          latestFrame = undefined;
          deck.setProps(props);
          await expect
            .poll(() => frameNumber > previousFrame + 3 && Boolean(latestFrame), {timeout: 15000})
            .toBe(true);
          // Compare settled geometry: light-space optical LOD now crossfades.
          await expect
            .poll(() => (deck.props.layers as Layer[]).every(layer => layer.isLoaded), {
              timeout: 30000
            })
            .toBe(true);
          const settled = frameNumber;
          await expect.poll(() => frameNumber, {timeout: 15000}).toBeGreaterThan(settled + 2);
          expect(errors).toEqual([]);
          expect([latestFrame!.width, latestFrame!.height]).toEqual([width, height]);
          return latestFrame!;
        };
        const filter =
          (visibleCasters: boolean, shadowCasters: boolean): DeckProps['layerFilter'] =>
          ({layer, renderPass}) =>
            renderPass === 'shadow'
              ? shadowCasters
              : visibleCasters || layer.id.endsWith('-ground');
        let previousMask: Uint8Array | undefined;
        let movingShadowPixels = 0;
        // The last angle reproduces the winter oak segment with the reported
        // hollow shadow. Half film dimensions and one less zoom keep its framing.
        for (const seconds of [0, 4, 8, 21.9]) {
          const tour = getTourFrame(seconds, true);
          const key = lighting.props.key;
          if (key.type === 'directional') key.direction = tour.direction;
          const viewState = {...VIEW, bearing: tour.cameraBearing};
          const makeLayers = (unlit: boolean, opacity = 1) => {
            const [ground, tree] = createSceneLayers(LayerClass, `shadow-${renderer}`, data, {
              ...DEFAULT_OPTIONS,
              season: tour.season,
              shadows: true,
              crops: false,
              dropped: false,
              wind: false
            });
            const material = {
              unlit,
              ambient: 0.05,
              diffuse: 1,
              shininess: 64,
              specularColor: [100, 100, 100] as [number, number, number]
            };
            return [
              ground,
              tree.clone({
                opacity,
                _subLayerProps: {trunks: {material}, 'canopy-oak': {material}}
              })
            ];
          };
          const unlitLayers = makeLayers(true);
          const clear = await capture({
            viewState,
            layers: unlitLayers,
            layerFilter: filter(false, false)
          });
          // Prime actual color draws before reading ground alone: shadow passes
          // retain the material and lighting uniforms from the preceding draw.
          const visibleUnlit = await capture({
            layers: unlitLayers,
            layerFilter: filter(true, true)
          });
          const unlit = await capture({layerFilter: filter(false, true)});
          const unlitMask = getShadowMask(clear, unlit);
          expect(
            unlitMask.reduce((sum, value) => sum + value, 0),
            `${renderer} at ${seconds}s has a nonempty ground shadow`
          ).toBeGreaterThan(120);
          for (const opacity of [1, 0.35]) {
            const visibleLit = await capture({
              layers: makeLayers(false, opacity),
              layerFilter: filter(true, true)
            });
            expect(
              countChangedPixels(visibleUnlit, visibleLit),
              `${renderer} at ${seconds}s material/opacity ${opacity} changes visible tree pixels`
            ).toBeGreaterThan(30);
            const lit = await capture({layerFilter: filter(false, true)});
            const litMask = getShadowMask(clear, lit);
            expect(
              countMaskDifferences(unlitMask, litMask),
              `${renderer} at ${seconds}s material/opacity ${opacity} shadow footprint`
            ).toBe(0);
            expect(
              countChangedPixels(unlit, lit),
              `${renderer} at ${seconds}s material/opacity ${opacity} shadow intensity`
            ).toBe(0);
          }
          if (previousMask) movingShadowPixels += countMaskDifferences(previousMask, unlitMask);
          previousMask = unlitMask;
        }
        expect(movingShadowPixels, `${renderer} sunlight changes the shadow`).toBeGreaterThan(120);
        expect(frameNumber).toBeGreaterThanOrEqual(28);
        expect(errors).toEqual([]);
      } finally {
        deck.finalize();
        container.remove();
      }
    }, 90000);
  }
});
