// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Label edges are antialiased as MapLibre GL JS antialiases them: over about a device pixel,
 * whatever the text size and device pixel ratio. `TextLayer` smooths a fixed distance of its font
 * atlas, which on screen grows with the text: 24 px labels at device pixel ratio 2 drew edges and
 * halos half again as soft as MapLibre's.
 *
 * Each case renders the labels of a reference scene alone (see `getLabelStyle`) with `BasemapLayer`
 * and compares the measured edge width with MapLibre's, recorded below. With
 * `VITE_LABEL_EDGES_RECORD=1`, MapLibre renders each case too, and both measures are written to
 * `__output__/label-edges.json`.
 */

import '@fontsource/noto-sans/latin-400.css';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {commands} from 'vitest/browser';
import {loadReferenceStyle} from './fixtures';
import {
  getBarePixels,
  getInk,
  getLabelStyle,
  measureLabelEdges,
  type LabelStyleOptions
} from './label-edges';
import {renderBasemapLayer, renderMapLibre} from './renderers';
import {DEFAULT_SCENES, VIEWPORT} from './scenes';

const env = (import.meta as any).env || {};
const RECORD = env.VITE_LABEL_EDGES_RECORD === '1';

const SCENE = DEFAULT_SCENES.find(scene => scene.id === 'paris-liberty-z13.3')!;
/** Halos are measured white on black, around blue text: the edges from black are the halo's. */
const HALO_STYLE = {background: '#000000', color: '#0000ff', halo: {color: '#ffffff', width: 1.5}};

type EdgeCase = {
  id: string;
  pixelRatio: number;
  style: LabelStyleOptions;
  /** What is measured: the text, or its halo. */
  measure: 'text' | 'halo';
  /** MapLibre GL JS 6.13's median 10-90% edge width, in device pixels (see the file comment). */
  maplibreEdgeWidth: number;
  /** How far the edge width may be from MapLibre's. Default `TOLERANCE`. */
  tolerance?: number;
};

const CASES: EdgeCase[] = [
  {
    id: 'text 24 px, device pixel ratio 2',
    pixelRatio: 2,
    style: {size: 24},
    measure: 'text',
    maplibreEdgeWidth: 1.59
  },
  {
    id: 'text 16 px, device pixel ratio 2',
    pixelRatio: 2,
    style: {size: 16},
    measure: 'text',
    maplibreEdgeWidth: 1.6
  },
  {
    id: 'halo 1.5 px of 24 px text, device pixel ratio 2',
    pixelRatio: 2,
    style: {size: 24, ...HALO_STYLE},
    measure: 'halo',
    maplibreEdgeWidth: 1.59
  },
  {
    id: 'halo 1.5 px blurred 1 px, 24 px text, device pixel ratio 2',
    pixelRatio: 2,
    style: {size: 24, ...HALO_STYLE, halo: {...HALO_STYLE.halo, blur: 1}},
    measure: 'halo',
    maplibreEdgeWidth: 4.39,
    tolerance: 0.4
  }
];

/**
 * How far from MapLibre's an edge width may measure: rasterization differences between GPUs, well
 * below the difference this guards (24 px text at ratio 2 measured 2.5 px before, its halo 2.5 px).
 */
const TOLERANCE = 0.2;

function measure(pixels: Uint8ClampedArray, edgeCase: EdgeCase) {
  const width = VIEWPORT.width * edgeCase.pixelRatio;
  const height = VIEWPORT.height * edgeCase.pixelRatio;
  if (edgeCase.measure === 'halo') {
    const ink = getInk(pixels, width, height, {background: 0, ink: 255});
    const bare = getBarePixels(pixels, width, height, [0, 0, 0]);
    return measureLabelEdges(ink, width, height, bare);
  }
  const ink = getInk(pixels, width, height, {background: 255, ink: 0});
  return measureLabelEdges(ink, width, height);
}

const recorded: Record<string, unknown> = {};

describe('label edge antialiasing', () => {
  beforeAll(async () => {
    await document.fonts.load('400 16px "Noto Sans"');
  });

  test.each(CASES)('$id', async edgeCase => {
    const style = getLabelStyle(await loadReferenceStyle(SCENE.style), edgeCase.style);
    const {pixelRatio} = edgeCase;
    const candidate = await renderBasemapLayer(structuredClone(style), SCENE, {}, {pixelRatio});
    const measured = measure(candidate.pixels, edgeCase);
    if (RECORD) {
      const reference = await renderMapLibre(structuredClone(style), SCENE, {pixelRatio});
      recorded[edgeCase.id] = {maplibre: measure(reference.pixels, edgeCase), measured};
    }
    expect(candidate.problems).toEqual([]);
    expect(measured.edges, 'edges measured').toBeGreaterThan(500);
    const offset = Math.abs(measured.edgeWidth - edgeCase.maplibreEdgeWidth);
    expect(offset, 'edge width offset from MapLibre').toBeLessThanOrEqual(
      edgeCase.tolerance ?? TOLERANCE
    );
  }, 120_000);

  afterAll(async () => {
    if (RECORD) {
      await commands.writeFile(
        'modules/basemap-layers/tests/reference-render/__output__/label-edges.json',
        `${JSON.stringify(recorded, null, 2)}\n`
      );
    }
  });
});
