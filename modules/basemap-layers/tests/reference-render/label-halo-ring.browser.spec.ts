// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * A label's halo is a ring, as MapLibre GL JS draws it. MapLibre draws the halos alone, fading out
 * inside the glyph from its edge (`inner_edge` in its symbol shader), then the glyphs alone over
 * them. So a glyph's antialiased edge, and a translucent glyph, show the ring where it reaches in,
 * and the map beyond it. With the glyph color mixed into the halo pass instead, as `TextLayer` draws
 * it, a translucent glyph shows the halo much less than MapLibre's, and its edges blend otherwise.
 *
 * The labels of a reference scene are rendered alone (see `getLabelStyle`): half-transparent blue
 * text with a white halo on black. At 24 px the ring reaches well into the strokes, so their
 * middle shows the halo through the text. The test measures how much, with `BasemapLayer` and
 * with MapLibre.
 */

import '@fontsource/noto-sans/latin-400.css';
import {beforeAll, describe, expect, test} from 'vitest';
import {loadReferenceStyle} from './fixtures';
import {getLabelStyle} from './label-edges';
import {renderBasemapLayer, renderMapLibre} from './renderers';
import {DEFAULT_SCENES} from './scenes';

const SCENE = DEFAULT_SCENES.find(scene => scene.id === 'paris-liberty-z13.3')!;

const RING_STYLE = {
  size: 24,
  background: '#000000',
  color: 'rgba(0, 0, 255, 0.5)',
  halo: {color: '#ffffff', width: 1.5}
};

/**
 * The share of the halo seen through the glyphs: the mean of the red and green channels, out of 255,
 * over the pixels that are mostly text. The halo raises both; the text and the black background
 * neither.
 */
function getHaloInGlyphs(pixels: Uint8ClampedArray): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    // The middle of a glyph: blue well above the other channels, which the halo raises together.
    if (blue - Math.max(red, green) > 100) {
      sum += (red + green) / 2;
      count++;
    }
  }
  return count ? sum / count / 255 : Number.NaN;
}

/**
 * Most that the halo seen through the glyphs may differ from MapLibre's. MapLibre: 0.403. The ring:
 * 0.407. The glyph color mixed into the halo pass: 0.167.
 */
const MAX_HALO_DIFFERENCE = 0.03;

describe('label halo ring', () => {
  beforeAll(async () => {
    await document.fonts.load('400 16px "Noto Sans"');
  });

  test('shows as much halo through translucent glyphs as MapLibre', async () => {
    const style = getLabelStyle(await loadReferenceStyle(SCENE.style), RING_STYLE);
    const candidate = await renderBasemapLayer(structuredClone(style), SCENE);
    const reference = await renderMapLibre(structuredClone(style), SCENE);
    expect(candidate.problems).toEqual([]);
    const maplibre = getHaloInGlyphs(reference.pixels);
    const measured = getHaloInGlyphs(candidate.pixels);
    expect(maplibre).toBeGreaterThan(0.2);
    expect(Math.abs(measured - maplibre)).toBeLessThan(MAX_HALO_DIFFERENCE);
  }, 120_000);
});
