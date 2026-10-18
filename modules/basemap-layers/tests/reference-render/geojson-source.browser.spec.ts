// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Style layers of a `geojson` source draw as MapLibre GL JS draws them. `BasemapLayer` used to
 * skip them, so a style that adds its own shapes over a basemap drew none of them.
 *
 * Each case renders a style with one GeoJSON source (polygons with a hole, a multipolygon, lines
 * crossing tile edges, points and a labelled point) over black, with both renderers, and compares
 * the pixels either renderer draws on. With `VITE_GEOJSON_SOURCE_OUTPUT=1`, a comparison image of
 * each case and the measured values are written to `__output__/`.
 */

import {afterAll, describe, expect, test} from 'vitest';
import {commands} from 'vitest/browser';
import {FIXTURE_ROOT, loadReferenceStyle} from './fixtures';
import {renderBasemapLayer, renderMapLibre} from './renderers';
import {VIEWPORT, type ReferenceScene} from './scenes';

const env = (import.meta as any).env || {};
const OUTPUT = env.VITE_GEOJSON_SOURCE_OUTPUT === '1';

/** Over Europe, where the shapes cross the zoom 3 tile edges at longitude 0 and latitude 41. */
const SCENE: ReferenceScene = {
  id: 'geojson-europe-z3.3',
  style: 'ofm-positron',
  center: [10, 45],
  zoom: 3.3
};

const DATA_PATH = 'geojson/shapes.json';

type GeoJsonCase = {
  id: string;
  /** How the source gets its data. */
  data: 'inline' | 'url';
  /** Extra source options. */
  source?: Record<string, unknown>;
};

const CASES: GeoJsonCase[] = [
  {id: 'inline data', data: 'inline'},
  {id: 'data URL', data: 'url'},
  {
    id: 'inline data, no buffer, coarse tolerance',
    data: 'inline',
    source: {buffer: 0, tolerance: 2}
  }
];

/**
 * The most the median pixel drawn by either renderer may differ from MapLibre's at the same place,
 * as the sum of its RGB differences. Where one renderer draws a shape the other does not, a pixel
 * differs by hundreds.
 */
const MEDIAN_PIXEL_TOLERANCE = 6;

/** The most the mean color of the drawn pixels may differ from MapLibre's, per channel (0-255). */
const MEAN_TOLERANCE = 8;

/**
 * The least share of the pixels either renderer draws on that both draw on. Antialiasing and the
 * label's font leave a few percent apart.
 */
const MIN_OVERLAP = 0.95;

/** The style: the GeoJSON source's layers alone, on black, with the positron fixture's glyphs. */
async function getGeoJsonStyle({data, source = {}}: GeoJsonCase): Promise<any> {
  const reference = await loadReferenceStyle(SCENE.style);
  const dataUrl = `${location.origin}/${FIXTURE_ROOT}/${DATA_PATH}`;
  const geojson = data === 'inline' ? await (await fetch(dataUrl)).json() : dataUrl;
  return {
    version: 8,
    glyphs: reference.glyphs,
    sources: {shapes: {type: 'geojson', data: geojson, ...source}},
    layers: [
      {id: 'background', type: 'background', paint: {'background-color': '#000000'}},
      {
        id: 'areas',
        type: 'fill',
        source: 'shapes',
        filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
        paint: {
          'fill-color': ['match', ['get', 'kind'], 'lake', '#2080d0', '#c05030'],
          'fill-antialias': false
        }
      },
      {
        id: 'routes',
        type: 'line',
        source: 'shapes',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': '#e0c020', 'line-width': 6}
      },
      {
        id: 'stops',
        type: 'circle',
        source: 'shapes',
        filter: ['==', ['get', 'kind'], 'stop'],
        paint: {'circle-color': '#40d070', 'circle-radius': 8}
      },
      {
        id: 'place',
        type: 'symbol',
        source: 'shapes',
        filter: ['has', 'name'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 18
        },
        paint: {'text-color': '#ffffff'}
      }
    ]
  };
}

/**
 * Over the pixels that are not black in either render: the share both draw on, the mean RGB each
 * draws, and the median of the pixels' summed RGB differences.
 */
function compareDrawnPixels(reference: Uint8ClampedArray, candidate: Uint8ClampedArray) {
  const sums = [0, 0, 0, 0, 0, 0];
  const counts = [0, 0];
  const differences: number[] = [];
  let both = 0;
  for (let index = 0; index < reference.length; index += 4) {
    const drawn = (pixels: Uint8ClampedArray) =>
      pixels[index] + pixels[index + 1] + pixels[index + 2] > 24;
    const inReference = drawn(reference);
    const inCandidate = drawn(candidate);
    if (!inReference && !inCandidate) {
      continue;
    }
    let difference = 0;
    for (let channel = 0; channel < 3; channel++) {
      if (inReference) sums[channel] += reference[index + channel];
      if (inCandidate) sums[channel + 3] += candidate[index + channel];
      difference += Math.abs(reference[index + channel] - candidate[index + channel]);
    }
    if (inReference) counts[0]++;
    if (inCandidate) counts[1]++;
    if (inReference && inCandidate) both++;
    differences.push(difference);
  }
  differences.sort((a, b) => a - b);
  return {
    drawn: differences.length,
    referenceDrawn: counts[0],
    candidateDrawn: counts[1],
    overlap: both / Math.max(differences.length, 1),
    reference: sums.slice(0, 3).map(sum => sum / Math.max(counts[0], 1)),
    candidate: sums.slice(3).map(sum => sum / Math.max(counts[1], 1)),
    medianDifference: differences[Math.floor(differences.length / 2)] ?? 0
  };
}

async function writeComparison(
  id: string,
  reference: Uint8ClampedArray,
  candidate: Uint8ClampedArray
) {
  const {width, height} = VIEWPORT;
  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.putImageData(new ImageData(new Uint8ClampedArray(reference), width, height), 0, 0);
  context.putImageData(new ImageData(new Uint8ClampedArray(candidate), width, height), width, 0);
  const name = id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  await commands.writeFile(
    `modules/basemap-layers/tests/reference-render/__output__/geojson-source-${name}.png`,
    canvas.toDataURL('image/png').split(',')[1],
    'base64'
  );
}

const measured: Record<string, unknown> = {};

describe('geojson sources', () => {
  test.each(CASES)('$id', async geoJsonCase => {
    const style = await getGeoJsonStyle(geoJsonCase);
    const reference = await renderMapLibre(structuredClone(style), SCENE);
    const candidate = await renderBasemapLayer(structuredClone(style), SCENE);
    if (OUTPUT) {
      await writeComparison(geoJsonCase.id, reference.pixels, candidate.pixels);
    }
    expect(reference.problems).toEqual([]);
    expect(candidate.problems).toEqual([]);

    const comparison = compareDrawnPixels(reference.pixels, candidate.pixels);
    measured[geoJsonCase.id] = {...comparison, labels: candidate.labels};
    expect(comparison.referenceDrawn, 'pixels MapLibre draws').toBeGreaterThan(30_000);
    expect(comparison.overlap, 'share of drawn pixels both draw').toBeGreaterThanOrEqual(
      MIN_OVERLAP
    );
    for (let channel = 0; channel < 3; channel++) {
      const offset = Math.abs(comparison.candidate[channel] - comparison.reference[channel]);
      expect(offset, `mean ${'RGB'[channel]} offset from MapLibre`).toBeLessThanOrEqual(
        MEAN_TOLERANCE
      );
    }
    expect(
      comparison.medianDifference,
      'median pixel difference from MapLibre'
    ).toBeLessThanOrEqual(MEDIAN_PIXEL_TOLERANCE);
    expect(reference.labels).toEqual(['GeoJSON']);
    expect(candidate.labels).toEqual(reference.labels);
  }, 120_000);

  afterAll(async () => {
    if (OUTPUT) {
      await commands.writeFile(
        'modules/basemap-layers/tests/reference-render/__output__/geojson-source.json',
        `${JSON.stringify(measured, null, 2)}\n`
      );
    }
  });
});
