// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Compares the outlines of a fill (`fill-outline-color`) with MapLibre GL JS's. MapLibre draws
 * them as lines, one pixel across, each segment on its own; drawn as a stroke, with its joins, they
 * come out darker and wider. The scene's parks, at z5.2, have many short segments, with outlines
 * in a strong green over a pale fill.
 */

import {expect, test} from 'vitest';
import {loadReferenceStyle} from './fixtures';
import {toGray} from './metrics';
import {renderBasemapLayer, renderMapLibre} from './renderers';
import {DEFAULT_SCENES, VIEWPORT} from './scenes';

const SCENE = DEFAULT_SCENES.find(scene => scene.id === 'europe-liberty-z5.2')!;

/** The mean difference from MapLibre's pixels, in gray levels of 255: 0.99, and 2.25 as a stroke. */
const MAX_MEAN_DIFFERENCE = 1.2;
/**
 * The difference from MapLibre's mean red of the outline's pixels: 0.1. Fading the pixels with their
 * distance from the line, as MapLibre's shader does, makes them 11 lighter.
 */
const MAX_OUTLINE_RED_DIFFERENCE = 4;

/** The mean red of the outline's pixels: those much greener than red, unlike the fill. */
function getOutlineRed(pixels: Uint8ClampedArray): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 1] - pixels[i] > 20) {
      sum += pixels[i];
      count++;
    }
  }
  return sum / count;
}

function getMeanDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const {width, height} = VIEWPORT;
  const grayA = toGray(a, width, height).data;
  const grayB = toGray(b, width, height).data;
  let sum = 0;
  for (let i = 0; i < grayA.length; i++) {
    sum += Math.abs(grayA[i] - grayB[i]);
  }
  return sum / grayA.length;
}

test('fill outlines draw as MapLibre draws them', async () => {
  const style = await loadReferenceStyle(SCENE.style);
  style.layers = style.layers.filter(
    (layer: {id: string}) => layer.id === 'background' || layer.id === 'park'
  );
  expect(style.layers.find((layer: any) => layer.id === 'park').paint).toHaveProperty(
    'fill-outline-color'
  );
  const reference = await renderMapLibre(structuredClone(style), SCENE);
  const candidate = await renderBasemapLayer(structuredClone(style), SCENE);
  expect(candidate.problems).toEqual([]);
  expect(getMeanDifference(reference.pixels, candidate.pixels)).toBeLessThan(MAX_MEAN_DIFFERENCE);
  expect(Math.abs(getOutlineRed(candidate.pixels) - getOutlineRed(reference.pixels))).toBeLessThan(
    MAX_OUTLINE_RED_DIFFERENCE
  );
}, 120_000);
