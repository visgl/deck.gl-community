// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * `text-variable-anchor` places each point label at the first of its anchors where it collides
 * with nothing, as MapLibre GL JS does, instead of dropping it. `BasemapLayer` used to place every
 * label at its `text-anchor`, so of dense labels it drew fewer, and those it drew in other places.
 *
 * Each case renders a style of point labels with variable anchors over black, with both renderers,
 * and compares which labels they draw (label recall and precision) and where (the share of the
 * text pixels either renders that both render). With `VITE_VARIABLE_ANCHOR_OUTPUT=1`, each case's
 * renders and measured values are written to `__output__/`.
 */

import {afterAll, describe, expect, test} from 'vitest';
import {commands} from 'vitest/browser';
import {loadReferenceStyle} from './fixtures';
import {labelScores, ssim, toGray} from '../../../../dev/basemap-conformance/src/metrics';
import {renderBasemapLayer, renderMapLibre} from './renderers';
import {VIEWPORT, type ReferenceScene} from './scenes';

const env = (import.meta as any).env || {};
const OUTPUT = env.VITE_VARIABLE_ANCHOR_OUTPUT === '1';

/** Labels as OSM Americana's `place_city` places them: below the point first, then around it. */
const AMERICANA_ANCHORS = ['bottom', 'bottom-right', 'bottom-left', 'right', 'left'];

/** A grid of points, close enough that most labels collide at their first anchor. */
const GRID_SCENE: ReferenceScene = {
  id: 'variable-anchor-grid-z4',
  style: 'ofm-positron',
  center: [0, 0],
  zoom: 4
};

/** Liberty's city labels, which draw a dot icon at each city, over Europe at zoom 5.2. */
const CITY_SCENE: ReferenceScene = {
  id: 'europe-liberty-z5.2',
  style: 'ofm-liberty',
  center: [10, 48],
  zoom: 5.2
};

/** Words the positron fixture's Noto Sans glyph range holds, for the grid's label names. */
const WORDS = [
  'Saint',
  'Lake',
  'North',
  'Port',
  'Mount',
  'Glen',
  'Bay',
  'Rock',
  'Elm',
  'Haven',
  'Ridge',
  'Mill',
  'Ford',
  'Dale'
];

/**
 * Points on a jittered grid around the scene's center, about 60 pixels apart, each named so that
 * no two share a name. Names have one to three words, so some wrap at `text-max-width`.
 */
function getGridPoints(): any {
  const features: any[] = [];
  // Pixels per degree at zoom 4 near the equator: 512 * 2^4 / 360.
  const step = 60 / ((512 * 16) / 360);
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let row = -4; row <= 4; row++) {
    for (let column = -4; column <= 4; column++) {
      const index = features.length;
      const words = 1 + (index % 3);
      const name = Array.from(
        {length: words},
        (_, k) => WORDS[(index * 5 + k * 3) % WORDS.length]
      ).join(' ');
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            (column + (random() - 0.5) * 0.4) * step,
            (row + (random() - 0.5) * 0.4) * step
          ]
        },
        properties: {name: `${name} ${index}`, rank: index % 4}
      });
    }
  }
  return {type: 'FeatureCollection', features};
}

type VariableAnchorCase = {
  id: string;
  scene: ReferenceScene;
  /** The style: its layers over a black background. */
  getStyle: () => Promise<any>;
  /**
   * The least label recall and precision, and the least share of text pixels both draw. Before
   * variable anchors, `BasemapLayer` drew 68-71% of the grid's labels with 4-5% of the text
   * pixels in common, and all but one of the cities with 3%; with them, 99-100% of the labels with
   * 53-61%. The renderers' glyph edges differ, so the share stays well below 1 when every label is
   * placed alike; a label 2 pixels off already lowers it.
   */
  minRecall: number;
  minPrecision: number;
  minOverlap: number;
};

async function getGridStyle(layout: Record<string, unknown>): Promise<any> {
  const reference = await loadReferenceStyle(GRID_SCENE.style);
  return {
    version: 8,
    glyphs: reference.glyphs,
    sources: {points: {type: 'geojson', data: getGridPoints()}},
    layers: [
      {id: 'background', type: 'background', paint: {'background-color': '#000000'}},
      {
        id: 'labels',
        type: 'symbol',
        source: 'points',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 13,
          'text-max-width': 6,
          ...layout
        },
        paint: {'text-color': '#ffffff'}
      }
    ]
  };
}

/** Liberty's city layers with Americana's `place_city` anchors and offsets, over black. */
async function getCityStyle(): Promise<any> {
  const reference = await loadReferenceStyle(CITY_SCENE.style);
  const ids = ['label_city', 'label_city_capital'];
  const layers = reference.layers
    .filter((layer: any) => ids.includes(layer.id))
    .map((layer: any) => {
      const {'text-anchor': _anchor, 'text-offset': _offset, ...layout} = layer.layout;
      return {
        ...layer,
        layout: {
          ...layout,
          'text-variable-anchor': AMERICANA_ANCHORS,
          'text-radial-offset': ['match', ['get', 'capital'], 2, 0.7, 0.5],
          'text-justify': 'auto'
        },
        paint: {...layer.paint, 'text-color': '#ffffff', 'text-halo-width': 0}
      };
    });
  return {
    ...reference,
    layers: [
      {id: 'background', type: 'background', paint: {'background-color': '#000000'}},
      ...layers
    ]
  };
}

const CASES: VariableAnchorCase[] = [
  {
    id: 'grid, text-variable-anchor and text-radial-offset',
    scene: GRID_SCENE,
    getStyle: () =>
      getGridStyle({
        'text-variable-anchor': AMERICANA_ANCHORS,
        'text-radial-offset': 0.5,
        'text-justify': 'auto'
      }),
    minRecall: 0.95,
    minPrecision: 0.95,
    minOverlap: 0.45
  },
  {
    id: 'grid, text-variable-anchor and text-offset',
    scene: GRID_SCENE,
    getStyle: () =>
      getGridStyle({
        'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
        'text-offset': [0.4, 0.4]
      }),
    minRecall: 0.95,
    minPrecision: 0.95,
    minOverlap: 0.45
  },
  {
    id: 'grid, text-variable-anchor-offset',
    scene: GRID_SCENE,
    getStyle: () =>
      getGridStyle({
        'text-variable-anchor-offset': ['top', [0, 0.5], 'left', [0.6, 0], 'bottom', [0, -0.5]],
        'text-justify': 'auto'
      }),
    minRecall: 0.95,
    minPrecision: 0.95,
    minOverlap: 0.45
  },
  {
    id: 'cities with icons',
    scene: CITY_SCENE,
    getStyle: getCityStyle,
    // 17 of MapLibre's 18. Both renderers place Lyon, whose point is 14 pixels left of the view,
    // at its first anchor, `bottom`, with the same text box to a pixel, and neither draws any of
    // its glyphs in the view. MapLibre's box ends 1 pixel inside the view, and its labels are read
    // back by collision box (see `renderMapLibre`); `BasemapLayer`'s box ends at the view's edge,
    // and its labels are read back by the text they draw. With the style's glyphs, the text is as narrow
    // as MapLibre's; with the browser's fonts it was wider and drew into the view.
    minRecall: 17 / 18,
    minPrecision: 1,
    minOverlap: 0.5
  }
];

/** Whether a pixel of an RGBA render over black has ink. */
function isDrawn(pixels: Uint8ClampedArray, index: number): boolean {
  return pixels[index] + pixels[index + 1] + pixels[index + 2] > 96;
}

/** The share of the pixels either render draws on that both draw on. */
function getInkOverlap(reference: Uint8ClampedArray, candidate: Uint8ClampedArray) {
  let either = 0;
  let both = 0;
  for (let index = 0; index < reference.length; index += 4) {
    const a = isDrawn(reference, index);
    const b = isDrawn(candidate, index);
    either += a || b ? 1 : 0;
    both += a && b ? 1 : 0;
  }
  return {either, both, overlap: both / Math.max(either, 1)};
}

function getFileName(id: string): string {
  return id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

async function writeRender(name: string, pixels: Uint8ClampedArray) {
  const {width, height} = VIEWPORT;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width), 0, 0);
  await commands.writeFile(
    `modules/basemap-layers/tests/reference-render/__output__/variable-anchor-${name}.png`,
    canvas.toDataURL('image/png').split(',')[1],
    'base64'
  );
}

const measured: Record<string, unknown> = {};

describe('text-variable-anchor', () => {
  test.each(CASES)('$id', async variableAnchorCase => {
    const {scene} = variableAnchorCase;
    const style = await variableAnchorCase.getStyle();
    const reference = await renderMapLibre(structuredClone(style), scene);
    const candidate = await renderBasemapLayer(structuredClone(style), scene);
    if (OUTPUT) {
      const name = getFileName(variableAnchorCase.id);
      await writeRender(`${name}-maplibre`, reference.pixels);
      await writeRender(`${name}-basemap`, candidate.pixels);
    }
    expect(reference.problems).toEqual([]);
    expect(candidate.problems).toEqual([]);

    const {width, height} = VIEWPORT;
    const labels = labelScores(reference.labels, candidate.labels);
    const ink = getInkOverlap(reference.pixels, candidate.pixels);
    const structural = ssim(
      toGray(reference.pixels, width, height),
      toGray(candidate.pixels, width, height)
    );
    measured[variableAnchorCase.id] = {
      recall: labels.recall,
      precision: labels.precision,
      referenceLabels: labels.referenceCount,
      candidateLabels: labels.candidateCount,
      missing: labels.missing,
      extra: labels.extra,
      inkOverlap: ink.overlap,
      ssim: structural.mean
    };
    expect(labels.referenceCount, 'labels MapLibre draws').toBeGreaterThan(10);
    expect(labels.recall, 'label recall').toBeGreaterThanOrEqual(variableAnchorCase.minRecall);
    expect(labels.precision, 'label precision').toBeGreaterThanOrEqual(
      variableAnchorCase.minPrecision
    );
    expect(ink.overlap, 'share of text pixels both draw').toBeGreaterThanOrEqual(
      variableAnchorCase.minOverlap
    );
  }, 120_000);

  afterAll(async () => {
    if (OUTPUT) {
      await commands.writeFile(
        'modules/basemap-layers/tests/reference-render/__output__/variable-anchor.json',
        `${JSON.stringify(measured, null, 2)}\n`
      );
    }
  });
});
