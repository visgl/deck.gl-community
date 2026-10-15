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
 * and compares the measured edge width with MapLibre's, recorded below. On a pitched map, line
 * labels lie on the map, foreshortened along screen y: MapLibre widens their edges by
 * 1 / cos(pitch) (its `u_gamma_scale`): across y they are about as wide as unpitched, and across
 * x twice that at pitch 60. The widths along rows and along columns are compared apart. With
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
  /** Camera pitch, in degrees. Default 0. */
  pitch?: number;
  /** What is measured: the text, or its halo. */
  measure: 'text' | 'halo';
  /**
   * MapLibre GL JS 6.13's median 10-90% edge width, in device pixels (see the file comment): of
   * all edges, or of the edges crossed along rows and along columns.
   */
  maplibreEdgeWidth?: number | {row: number; column: number};
  /** Instead, MapLibre GL JS 6.13's `solidShare` (see `LabelEdgeMetrics`). */
  maplibreSolidShare?: number;
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
  },
  // Averaging the two screen directions drew these 2.19 and 1.56 px wide, and 2.12 and 1.58 px.
  {
    id: 'line text 24 px at pitch 60, device pixel ratio 2',
    pixelRatio: 2,
    pitch: 60,
    style: {size: 24, placement: 'line'},
    measure: 'text',
    maplibreEdgeWidth: {row: 2.76, column: 1.79},
    tolerance: 0.3
  },
  {
    id: 'line halo 1.5 px of 24 px text at pitch 60, device pixel ratio 2',
    pixelRatio: 2,
    pitch: 60,
    style: {size: 24, placement: 'line', ...HALO_STYLE},
    measure: 'halo',
    maplibreEdgeWidth: {row: 2.53, column: 1.92},
    tolerance: 0.3
  },
  // Blurred, the halo fades over 1 / cos(pitch) more too, as in MapLibre, where
  // `text-halo-blur` and the edge's own antialiasing are both divided by `u_gamma_scale`. Most of
  // these edges fade too wide to reach 90% ink, and MapLibre cuts the faintest part of the widest
  // at its glyph quads, so the share of solid halo pixels is compared instead of edge widths.
  // Widening the edge alone, not the blur, drew 0.31 and 0.12 of them solid.
  {
    id: 'line halo 3 px blurred 1 px, 24 px text at pitch 60, device pixel ratio 2',
    pixelRatio: 2,
    pitch: 60,
    style: {
      size: 24,
      placement: 'line',
      ...HALO_STYLE,
      halo: {...HALO_STYLE.halo, width: 3, blur: 1}
    },
    measure: 'halo',
    maplibreSolidShare: 0.15
  },
  {
    id: 'line halo 1.5 px blurred 0.25 px, 24 px text at pitch 60, device pixel ratio 2',
    pixelRatio: 2,
    pitch: 60,
    style: {size: 24, placement: 'line', ...HALO_STYLE, halo: {...HALO_STYLE.halo, blur: 0.25}},
    measure: 'halo',
    maplibreSolidShare: 0.07
  },
  // Point labels face the screen at any pitch, so their edges stay as wide as unpitched.
  {
    id: 'point text 24 px at pitch 60, device pixel ratio 2',
    pixelRatio: 2,
    pitch: 60,
    style: {size: 24},
    measure: 'text',
    maplibreEdgeWidth: {row: 1.58, column: 1.61}
  }
];

/**
 * How far from MapLibre's an edge width may measure: rasterization differences between GPUs, well
 * below the difference this guards (24 px text at ratio 2 measured 2.5 px before, its halo 2.5 px).
 */
const TOLERANCE = 0.2;

/**
 * How far from MapLibre's the share of solid halo pixels may measure: well under the 0.16 and 0.05
 * by which widening the halo's edge but not its blur missed it.
 */
const SOLID_SHARE_TOLERANCE = 0.02;

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
    const {pixelRatio, pitch = 0, maplibreEdgeWidth, maplibreSolidShare} = edgeCase;
    const options = {pixelRatio, pitch};
    const candidate = await renderBasemapLayer(structuredClone(style), SCENE, {}, options);
    const measured = measure(candidate.pixels, edgeCase);
    if (RECORD) {
      const reference = await renderMapLibre(structuredClone(style), SCENE, options);
      recorded[edgeCase.id] = {maplibre: measure(reference.pixels, edgeCase), measured};
    }
    // A pitched view reaches past the recorded tiles toward the horizon: both renderers draw
    // without them.
    const problems = candidate.problems.filter(
      problem => !(pitch && problem.startsWith('Missing fixture'))
    );
    expect(problems).toEqual([]);
    if (maplibreSolidShare !== undefined) {
      const offset = Math.abs(measured.solidShare - maplibreSolidShare);
      expect(offset, 'solid share offset from MapLibre').toBeLessThanOrEqual(SOLID_SHARE_TOLERANCE);
      return;
    }
    expect(measured.edges, 'edges measured').toBeGreaterThan(500);
    const tolerance = edgeCase.tolerance ?? TOLERANCE;
    if (typeof maplibreEdgeWidth === 'number') {
      const offset = Math.abs(measured.edgeWidth - maplibreEdgeWidth);
      expect(offset, 'edge width offset from MapLibre').toBeLessThanOrEqual(tolerance);
    } else if (maplibreEdgeWidth) {
      const offset = Math.abs(measured.rowEdgeWidth - maplibreEdgeWidth.row);
      expect(offset, 'row edge width offset from MapLibre').toBeLessThanOrEqual(tolerance);
      const columnOffset = Math.abs(measured.columnEdgeWidth - maplibreEdgeWidth.column);
      expect(columnOffset, 'column edge width offset from MapLibre').toBeLessThanOrEqual(tolerance);
    }
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
