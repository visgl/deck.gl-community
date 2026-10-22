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
import {toGray} from '../../../../dev/basemap-conformance/src/metrics';
import {renderBasemapLayer, renderMapLibre} from './renderers';
import {DEFAULT_SCENES, VIEWPORT} from './scenes';

const SCENE = DEFAULT_SCENES.find(scene => scene.id === 'europe-liberty-z5.2')!;

/**
 * The mean difference from MapLibre's pixels, in gray levels of 255: 0.99 to 1.08, and 2.25 to 2.44
 * as a stroke.
 */
const MAX_MEAN_DIFFERENCE = 1.2;
/**
 * The difference from MapLibre's mean red of the outline's pixels: up to 0.8, and 17 to 20 as a
 * stroke. Fading the pixels with their
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

/**
 * The park layer as the style draws it, and with the paint that gives a fill its own extensions,
 * which the outline's must be drawn with.
 */
const CASES: {id: string; paint: Record<string, unknown>}[] = [
  {id: 'park', paint: {}},
  {id: 'park, translated', paint: {'fill-translate': [12, 8]}},
  {id: 'park, patterned', paint: {'fill-pattern': 'pedestrian_polygon'}}
];

test.each(CASES)('$id: fill outlines draw as MapLibre draws them', async ({paint}) => {
  const style = await loadReferenceStyle(SCENE.style);
  style.layers = style.layers.filter(
    (layer: {id: string}) => layer.id === 'background' || layer.id === 'park'
  );
  const park = style.layers.find((layer: any) => layer.id === 'park');
  expect(park.paint).toHaveProperty('fill-outline-color');
  Object.assign(park.paint, paint);
  const reference = await renderMapLibre(structuredClone(style), SCENE);
  const candidate = await renderBasemapLayer(structuredClone(style), SCENE);
  expect(candidate.problems).toEqual([]);
  expect(getMeanDifference(reference.pixels, candidate.pixels)).toBeLessThan(MAX_MEAN_DIFFERENCE);
  expect(Math.abs(getOutlineRed(candidate.pixels) - getOutlineRed(reference.pixels))).toBeLessThan(
    MAX_OUTLINE_RED_DIFFERENCE
  );
}, 120_000);
