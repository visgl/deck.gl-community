// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Small labels keep their strokes. The 64 px font atlas is drawn 4 to 6 times smaller for 10 to
 * 16 px labels at device pixel ratio 1. Sampled from a full mip chain, the distance field was
 * averaged over 4 to 8 atlas pixels, which thinned strokes and left them unevenly grey: the middle
 * of a stroke reached 64% ink at 10 px. Sampled at most from the half-size level, it reaches 88%.
 *
 * MapLibre GL JS draws its glyphs without mipmaps, but over a wider antialiased edge (0.84 device
 * pixels on each side), so its strokes peak lower: at 63% (10 px) and 67% (12 px). Its peaks
 * measure that edge, not stroke erosion, and are not a target here; the thresholds below sit between
 * the eroded and the full-resolution strokes. Labels drawn in the reference scenes' own styles carry
 * about as much ink as MapLibre's with the half-size level, and 16 to 27% less with the full chain.
 *
 * Each case renders the labels of a reference scene alone (see `getLabelStyle`) with `BasemapLayer`,
 * without the style's `glyphs`, so that they are drawn from the 64 px label font atlas. With
 * `VITE_LABEL_EDGES_RECORD=1`, MapLibre renders each case too, and both measures are written to
 * `__output__/label-atlas-mipmaps.json`.
 *
 * Labels drawn from the style's `glyphs` share MapLibre's 24 px glyphs, sampling and edge: their
 * strokes carry MapLibre's ink, within {@link MAX_GLYPH_INK_DIFFERENCE}.
 */

import '@fontsource/noto-sans/latin-400.css';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {commands} from 'vitest/browser';
import {loadReferenceStyle} from './fixtures';
import {getInk, getLabelStyle, measureLabelEdges, type LabelEdgeMetrics} from './label-edges';
import {renderBasemapLayer, renderMapLibre} from './renderers';
import {DEFAULT_SCENES, VIEWPORT} from './scenes';

const env = (import.meta as any).env || {};
const RECORD = env.VITE_LABEL_EDGES_RECORD === '1';

const SCENE = DEFAULT_SCENES.find(scene => scene.id === 'paris-liberty-z13.3')!;

type MipmapCase = {
  id: string;
  size: number;
};

const CASES: MipmapCase[] = [
  {id: 'text 10 px, device pixel ratio 1', size: 10},
  {id: 'text 12 px, device pixel ratio 1', size: 12}
];

/**
 * Least mean ink at the middle of a stroke. From a full mip chain: 0.64 (10 px) and 0.74 (12 px);
 * from the atlas and its half-size level: 0.88 and 0.91.
 */
const MIN_STEM_PEAK = 0.8;

/**
 * Least mean ink of the pixels a label touches. From a full mip chain: 0.48 and 0.54; from the atlas
 * and its half-size level: 0.67 and 0.67.
 */
const MIN_INK_DENSITY = 0.6;

/**
 * Most that the stroke peak and ink density of labels drawn from the style's glyphs may differ from
 * MapLibre's. They differ by less than 0.001 at 10 and 12 px; with the glyph edge smoothed no more
 * than `TextLayer`'s `smoothing`, as the label font atlas's is, by 0.15 to 0.19.
 */
const MAX_GLYPH_INK_DIFFERENCE = 0.02;

function measure(pixels: Uint8ClampedArray): LabelEdgeMetrics {
  const {width, height} = VIEWPORT;
  return measureLabelEdges(getInk(pixels, width, height, {background: 255, ink: 0}), width, height);
}

const recorded: Record<string, unknown> = {};

describe('label atlas mipmaps', () => {
  beforeAll(async () => {
    await document.fonts.load('400 16px "Noto Sans"');
  });

  test.each(CASES)('$id', async mipmapCase => {
    const style = getLabelStyle(await loadReferenceStyle(SCENE.style), {size: mipmapCase.size});
    delete style.glyphs;
    const candidate = await renderBasemapLayer(structuredClone(style), SCENE);
    const measured = measure(candidate.pixels);
    if (RECORD) {
      const reference = await renderMapLibre(structuredClone(style), SCENE);
      recorded[mipmapCase.id] = {maplibre: measure(reference.pixels), measured};
    }
    expect(candidate.problems).toEqual([]);
    expect(measured.stemPeak).toBeGreaterThanOrEqual(MIN_STEM_PEAK);
    expect(measured.inkDensity).toBeGreaterThanOrEqual(MIN_INK_DENSITY);
  }, 120_000);

  test.each(CASES)('$id, from the style glyphs, as MapLibre', async mipmapCase => {
    const style = getLabelStyle(await loadReferenceStyle(SCENE.style), {size: mipmapCase.size});
    expect(style.glyphs).toBeTruthy();
    const candidate = await renderBasemapLayer(structuredClone(style), SCENE);
    const reference = await renderMapLibre(structuredClone(style), SCENE);
    const measured = measure(candidate.pixels);
    const maplibre = measure(reference.pixels);
    if (RECORD) {
      recorded[`${mipmapCase.id}, style glyphs`] = {maplibre, measured};
    }
    expect(candidate.problems).toEqual([]);
    expect(Math.abs(measured.stemPeak - maplibre.stemPeak)).toBeLessThan(MAX_GLYPH_INK_DIFFERENCE);
    expect(Math.abs(measured.inkDensity - maplibre.inkDensity)).toBeLessThan(
      MAX_GLYPH_INK_DIFFERENCE
    );
  }, 120_000);

  afterAll(async () => {
    if (RECORD) {
      await commands.writeFile(
        'modules/basemap-layers/tests/reference-render/__output__/label-atlas-mipmaps.json',
        `${JSON.stringify(recorded, null, 2)}\n`
      );
    }
  });
});
