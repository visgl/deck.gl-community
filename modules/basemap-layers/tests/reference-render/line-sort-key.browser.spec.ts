// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * `line-sort-key` orders a line layer's features as MapLibre GL JS orders them: within a tile,
 * features with a higher key draw over those with a lower one. OSM Americana sets it on its road
 * layers, so where roads, bridges and ramps cross, the one MapLibre draws on top depends on it.
 *
 * Each case draws a grid of three horizontal and three vertical lines of six colors from one
 * GeoJSON source, over black, with Americana's road sort key. The features' order in the data
 * disagrees with their keys at four of the nine crossings. Where both renderers draw a line, a
 * pixel is "swapped" when they draw different lines there: a crossing stacked the other way. As a
 * control, MapLibre without the sort key must swap many pixels against MapLibre with it.
 *
 * With `VITE_LINE_SORT_KEY_OUTPUT=1`, each case's renders and the measured values are written to
 * `__output__/`.
 */

import {afterAll, describe, expect, test} from 'vitest';
import {commands} from 'vitest/browser';
import {renderBasemapLayer, renderMapLibre} from './renderers';
import {VIEWPORT, type ReferenceScene} from './scenes';

const env = (import.meta as any).env || {};
const OUTPUT = env.VITE_LINE_SORT_KEY_OUTPUT === '1';

/** All lines lie in one zoom 5 tile (longitude 0 to 11.25, latitude 41 to 49). */
const SCENE: ReferenceScene = {
  id: 'line-sort-key-z5.3',
  style: 'ofm-positron',
  center: [5.6, 45],
  zoom: 5.3
};

/** The lines' colors, which the swapped pixels are classified by. */
const PALETTE: Record<string, [number, number, number]> = {
  red: [230, 40, 40],
  green: [40, 200, 60],
  blue: [50, 90, 240],
  yellow: [240, 220, 30],
  magenta: [220, 50, 220],
  cyan: [40, 220, 230]
};

/** OSM Americana's road `line-sort-key`, set on 177 of its line layers. */
const AMERICANA_ROAD_SORT_KEY = [
  '+',
  ['coalesce', ['get', 'layer'], 0],
  0.1,
  ['*', -0.1, ['coalesce', ['get', 'ramp'], 0]],
  ['*', 0.2, ['coalesce', ['get', 'toll'], 0]],
  ['*', 0.4, ['coalesce', ['get', 'expressway'], 0]]
];

function line(color: string, group: string, coordinates: number[][], properties: object) {
  return {
    type: 'Feature',
    properties: {color, group, ...properties},
    geometry: {type: 'LineString', coordinates}
  };
}

/**
 * In data order, with keys 1.1, 0.5, -0.9, 0.3, 1.5 and 0: MapLibre draws blue, cyan, yellow,
 * green, red, magenta. Red and green cross yellow and cyan, which come after them in the data but
 * draw under them by key.
 */
const DATA = {
  type: 'FeatureCollection',
  features: [
    line(
      'red',
      'a',
      [
        [3.6, 46],
        [7.6, 46]
      ],
      {layer: 1}
    ),
    line(
      'green',
      'b',
      [
        [3.6, 45],
        [7.6, 45]
      ],
      {expressway: 1}
    ),
    line(
      'blue',
      'b',
      [
        [3.6, 44],
        [7.6, 44]
      ],
      {layer: -1}
    ),
    line(
      'yellow',
      'a',
      [
        [4.6, 43.4],
        [4.6, 46.6]
      ],
      {toll: 1}
    ),
    line(
      'magenta',
      'b',
      [
        [5.6, 43.4],
        [5.6, 46.6]
      ],
      {layer: 1, expressway: 1}
    ),
    line(
      'cyan',
      'a',
      [
        [6.6, 43.4],
        [6.6, 46.6]
      ],
      {ramp: 1}
    )
  ]
};

const LINE_COLOR = [
  'match',
  ['get', 'color'],
  ...Object.entries(PALETTE).flatMap(([name, [r, g, b]]) => [name, `rgb(${r}, ${g}, ${b})`]),
  '#ffffff'
];

type SortKeyCase = {
  id: string;
  /** The line layers' paint, over `line-color`. */
  paint: Record<string, unknown>;
  /**
   * Split the features into two consecutive line layers by `group`, which `BasemapLayer` draws in
   * one sublayer (a batch).
   */
  split?: boolean;
  /** The least share of pixels both MapLibre renders draw that the control swaps. */
  minControlSwapped?: number;
  /** The most share of pixels both renderers draw that may be swapped. */
  maxSwapped?: number;
  /** The zoom, if not the scene's. */
  zoom?: number;
};

const CASES: SortKeyCase[] = [
  {id: 'solid', paint: {'line-width': 14}},
  // At an integer zoom: MapLibre scales dashes with the tile between integer zooms, so at zoom 5.3
  // its dashes are longer than `BasemapLayer`'s, and gaps fall at different places.
  {id: 'dashed', paint: {'line-width': 14, 'line-dasharray': [3, 0.5]}, zoom: 5},
  {id: 'offset', paint: {'line-width': 14, 'line-offset': 5}},
  // A gap's two lines draw in two sublayers: each side in key order, but every feature's first
  // side before any feature's second. Where a lower key's second side crosses a higher key's
  // first, it draws over it, unlike MapLibre: about half of the crossings' pixels stay swapped.
  {
    id: 'gap width',
    paint: {'line-width': 6, 'line-gap-width': 6},
    minControlSwapped: 0.03,
    maxSwapped: 0.025
  },
  {id: 'blur', paint: {'line-width': 14, 'line-blur': 3}},
  // Two of the swapped crossings are within one layer: red and green over yellow and cyan.
  {id: 'two batched layers', paint: {'line-width': 14}, split: true, minControlSwapped: 0.01}
];

/**
 * The most share of pixels both renderers draw a line on that may be swapped. Antialiased edges
 * of the top line over the other leave a few blended pixels near a palette color.
 */
const MAX_SWAPPED = 0.005;

/** The least share of drawn pixels the control swaps, unless a case sets its own. */
const MIN_CONTROL_SWAPPED = 0.02;

function getStyle({paint, split}: SortKeyCase, sortKey = true): any {
  const layer = (id: string, filter?: unknown[]) => ({
    id,
    type: 'line',
    source: 'roads',
    ...(filter ? {filter} : {}),
    layout: {
      'line-cap': 'butt',
      'line-join': 'miter',
      ...(sortKey ? {'line-sort-key': AMERICANA_ROAD_SORT_KEY} : {})
    },
    paint: {'line-color': LINE_COLOR, ...paint}
  });
  return {
    version: 8,
    sources: {roads: {type: 'geojson', data: structuredClone(DATA)}},
    layers: [
      {id: 'background', type: 'background', paint: {'background-color': '#000000'}},
      ...(split
        ? [
            layer('roads-a', ['==', ['get', 'group'], 'a']),
            layer('roads-b', ['==', ['get', 'group'], 'b'])
          ]
        : [layer('roads')])
    ]
  };
}

/** The palette color a pixel is closest to, or -1 for the background or a blend of colors. */
function classify(pixels: Uint8ClampedArray, index: number, colors: number[][]): number {
  const r = pixels[index];
  const g = pixels[index + 1];
  const b = pixels[index + 2];
  let best = -1;
  let bestDistance = 60;
  colors.forEach(([cr, cg, cb], colorIndex) => {
    const distance = Math.abs(r - cr) + Math.abs(g - cg) + Math.abs(b - cb);
    if (distance < bestDistance) {
      best = colorIndex;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * Over the pixels where both renders draw one of the lines' colors: how many there are, and the
 * share where they draw different lines.
 */
function compareStacking(reference: Uint8ClampedArray, candidate: Uint8ClampedArray) {
  const colors = Object.values(PALETTE);
  let both = 0;
  let swapped = 0;
  for (let index = 0; index < reference.length; index += 4) {
    const inReference = classify(reference, index, colors);
    const inCandidate = classify(candidate, index, colors);
    if (inReference < 0 || inCandidate < 0) {
      continue;
    }
    both++;
    if (inReference !== inCandidate) {
      swapped++;
    }
  }
  return {both, swapped, swappedShare: swapped / Math.max(both, 1)};
}

async function writeRender(name: string, pixels: Uint8ClampedArray) {
  const {width, height} = VIEWPORT;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  await commands.writeFile(
    `modules/basemap-layers/tests/reference-render/__output__/line-sort-key-${name}.png`,
    canvas.toDataURL('image/png').split(',')[1],
    'base64'
  );
}

const measured: Record<string, unknown> = {};

describe('line-sort-key', () => {
  test.each(CASES)('$id', async sortKeyCase => {
    const style = getStyle(sortKeyCase);
    const scene = {...SCENE, zoom: sortKeyCase.zoom ?? SCENE.zoom};
    const reference = await renderMapLibre(structuredClone(style), scene);
    const control = await renderMapLibre(getStyle(sortKeyCase, false), scene);
    const candidate = await renderBasemapLayer(structuredClone(style), scene);
    const name = sortKeyCase.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    if (OUTPUT) {
      await writeRender(`${name}-maplibre`, reference.pixels);
      await writeRender(`${name}-basemap`, candidate.pixels);
    }
    expect(reference.problems).toEqual([]);
    expect(candidate.problems).toEqual([]);

    const controlComparison = compareStacking(reference.pixels, control.pixels);
    const comparison = compareStacking(reference.pixels, candidate.pixels);
    measured[sortKeyCase.id] = {control: controlComparison, basemap: comparison};
    expect(comparison.both, 'pixels both draw a line on').toBeGreaterThan(10_000);
    expect(
      controlComparison.swappedShare,
      'share MapLibre swaps without the sort key (the scene shows the order)'
    ).toBeGreaterThanOrEqual(sortKeyCase.minControlSwapped ?? MIN_CONTROL_SWAPPED);
    expect(comparison.swappedShare, 'share of pixels stacked unlike MapLibre').toBeLessThanOrEqual(
      sortKeyCase.maxSwapped ?? MAX_SWAPPED
    );
  }, 120_000);

  afterAll(async () => {
    if (OUTPUT) {
      await commands.writeFile(
        'modules/basemap-layers/tests/reference-render/__output__/line-sort-key.json',
        `${JSON.stringify(measured, null, 2)}\n`
      );
    }
  });
});
