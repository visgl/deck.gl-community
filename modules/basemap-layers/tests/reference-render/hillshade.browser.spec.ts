// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * `hillshade` layers over a `raster-dem` source are shaded as MapLibre GL JS shades them.
 *
 * Each case draws one hillshade layer over an opaque background, around Mount Rainier, from four
 * terrarium DEM tiles that meet at the center of the view (see `fixtures.ts`), with both
 * renderers, and compares every pixel. With `VITE_HILLSHADE_OUTPUT=1`, a comparison image of
 * each case and the measured colors are written to `__output__/`.
 */

import {afterAll, describe, expect, test} from 'vitest';
import {commands} from 'vitest/browser';
import {toFixtureUrl} from './fixtures';
import {renderBasemapLayer, renderMapLibre} from './renderers';
import {VIEWPORT, type ReferenceScene} from './scenes';

const env = (import.meta as any).env || {};
const OUTPUT = env.VITE_HILLSHADE_OUTPUT === '1';

const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/**
 * The north-west corner of tile 11/331/722, where the four recorded tiles meet, at a zoom that
 * draws them 300 pixels wide. MapLibre GL JS snaps raster and hillshade tiles to the pixel grid
 * when the map is still, moving them by up to half a pixel; `BasemapLayer` does not. At this zoom
 * the snap is zero, so that the comparison sees the shading alone.
 */
const SCENE: ReferenceScene = {
  id: 'mount-rainier-hillshade',
  style: 'ofm-liberty',
  center: [-121.81640625, 46.8000594467873],
  zoom: 10 + Math.log2(300 / 256)
};

/** The zoom that draws the zoom 11 tiles 512 pixels wide, scaled up past the source's maxzoom. */
const SCALED_UP_ZOOM = 11;

type HillshadeCase = {
  id: string;
  /** The hillshade layer's paint. */
  paint?: Record<string, unknown>;
  /** Replaces properties of the DEM source. */
  source?: Record<string, unknown>;
  /** Camera bearing, in degrees. Default 0. */
  bearing?: number;
  /** Camera zoom. Default the scene's. */
  zoom?: number;
};

const CASES: HillshadeCase[] = [
  {id: 'default paint'},
  {
    id: 'standard, colored, map-anchored',
    paint: {
      'hillshade-exaggeration': 0.8,
      'hillshade-shadow-color': '#473b24',
      'hillshade-highlight-color': 'rgba(255, 250, 220, 0.8)',
      'hillshade-accent-color': '#5a5a3c',
      'hillshade-illumination-direction': 280,
      'hillshade-illumination-anchor': 'map'
    }
  },
  {id: 'basic', paint: {'hillshade-method': 'basic', 'hillshade-illumination-altitude': 30}},
  {id: 'combined', paint: {'hillshade-method': 'combined', 'hillshade-exaggeration': 0.7}},
  {id: 'igor', paint: {'hillshade-method': 'igor'}},
  {
    id: 'multidirectional, three lights',
    paint: {
      'hillshade-method': 'multidirectional',
      'hillshade-illumination-direction': [270, 315, 0],
      'hillshade-illumination-altitude': [30, 45],
      'hillshade-highlight-color': ['#ffffff', '#ffeecc', '#ccddff'],
      'hillshade-shadow-color': ['#000000', '#331100', '#001133']
    }
  },
  {id: 'nearest resampling', paint: {resampling: 'nearest'}},
  // The same tiles, decoded with the `custom` factors of the terrarium encoding.
  {
    id: 'custom encoding',
    source: {
      encoding: 'custom',
      redFactor: 256,
      greenFactor: 1,
      blueFactor: 1 / 256,
      baseShift: 32768
    }
  },
  // MapLibre scales the slopes of a scaled-up tile for the tile's own zoom.
  {id: 'scaled up past maxzoom', zoom: SCALED_UP_ZOOM},
  // A light anchored to the viewport turns with the map. Scaled up, so that the turned view
  // stays within the recorded tiles.
  {id: 'default paint, map turned 60°', zoom: SCALED_UP_ZOOM, bearing: 60},
  {
    id: 'map-anchored light, map turned 60°',
    zoom: SCALED_UP_ZOOM,
    bearing: 60,
    paint: {'hillshade-illumination-anchor': 'map'}
  }
];

/**
 * The most the mean color may differ from MapLibre's, per channel, in 0-255. With the hillshade
 * skipped, it was 50 to 94 off; it is now within 0.01.
 */
const MEAN_TOLERANCE = 1;

/**
 * The most the median pixel may differ from MapLibre's at the same place, as the sum of its RGB
 * differences. It is 0: the slopes are prepared with MapLibre's arithmetic and 8-bit rounding.
 */
const MEDIAN_PIXEL_TOLERANCE = 1;

/**
 * The most the 99th percentile pixel may differ, in the same units. Where the slope texture is
 * filtered between texels, the two renderers' texture coordinates differ in their last bits, which
 * moves the filter's weights; on steep terrain that shows. `basic`, which switches from shadow to
 * highlight at a threshold, differs most, by 15.
 */
const P99_PIXEL_TOLERANCE = 20;

function getHillshadeStyle({paint = {}, source = {}}: HillshadeCase): any {
  return {
    version: 8,
    sources: {
      terrain: {
        type: 'raster-dem',
        tiles: [toFixtureUrl(DEM_TILES)],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 11,
        ...source
      }
    },
    layers: [
      {id: 'background', type: 'background', paint: {'background-color': '#f2efe9'}},
      {id: 'hillshade', type: 'hillshade', source: 'terrain', paint}
    ]
  };
}

/** The mean RGB of each render, and the median and 99th percentile summed RGB differences. */
function compare(reference: Uint8ClampedArray, candidate: Uint8ClampedArray) {
  const sums = [0, 0, 0, 0, 0, 0];
  const differences: number[] = [];
  for (let index = 0; index < reference.length; index += 4) {
    let difference = 0;
    for (let channel = 0; channel < 3; channel++) {
      sums[channel] += reference[index + channel];
      sums[channel + 3] += candidate[index + channel];
      difference += Math.abs(reference[index + channel] - candidate[index + channel]);
    }
    differences.push(difference);
  }
  const count = differences.length;
  const mean = sums.map(sum => sum / count);
  differences.sort((a, b) => a - b);
  return {
    reference: mean.slice(0, 3),
    candidate: mean.slice(3),
    medianDifference: differences[Math.floor(count / 2)],
    p99Difference: differences[Math.floor(count * 0.99)],
    maxDifference: differences[count - 1]
  };
}

async function writeComparison(
  id: string,
  reference: Uint8ClampedArray,
  candidate: Uint8ClampedArray
) {
  const {width, height} = VIEWPORT;
  const canvas = document.createElement('canvas');
  canvas.width = width * 3;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.putImageData(new ImageData(new Uint8ClampedArray(reference), width, height), 0, 0);
  context.putImageData(new ImageData(new Uint8ClampedArray(candidate), width, height), width, 0);
  // The difference, amplified 8 times, black where the renders agree.
  const difference = new Uint8ClampedArray(reference.length);
  for (let index = 0; index < reference.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) {
      difference[index + channel] =
        Math.abs(reference[index + channel] - candidate[index + channel]) * 8;
    }
    difference[index + 3] = 255;
  }
  context.putImageData(new ImageData(difference, width, height), width * 2, 0);
  const name = id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  await commands.writeFile(
    `modules/basemap-layers/tests/reference-render/__output__/hillshade-${name}.png`,
    canvas.toDataURL('image/png').split(',')[1],
    'base64'
  );
}

const measured: Record<string, unknown> = {};

describe('hillshade', () => {
  test.each(CASES)('$id', async hillshadeCase => {
    const style = getHillshadeStyle(hillshadeCase);
    const scene = {...SCENE, zoom: hillshadeCase.zoom ?? SCENE.zoom};
    const options = {bearing: hillshadeCase.bearing ?? 0};
    const reference = await renderMapLibre(structuredClone(style), scene, options);
    const candidate = await renderBasemapLayer(structuredClone(style), scene, {}, options);
    if (OUTPUT) {
      await writeComparison(hillshadeCase.id, reference.pixels, candidate.pixels);
    }
    expect(reference.problems).toEqual([]);
    // Turned, deck.gl's tile culling also asks for tiles next to the view, which are not recorded.
    const problems = hillshadeCase.bearing
      ? candidate.problems.filter(problem => !problem.startsWith('Missing fixture'))
      : candidate.problems;
    expect(problems).toEqual([]);

    const colors = compare(reference.pixels, candidate.pixels);
    measured[hillshadeCase.id] = colors;
    for (let channel = 0; channel < 3; channel++) {
      const offset = Math.abs(colors.candidate[channel] - colors.reference[channel]);
      expect(offset, `mean ${'RGB'[channel]} offset from MapLibre`).toBeLessThanOrEqual(
        MEAN_TOLERANCE
      );
    }
    expect(colors.medianDifference, 'median pixel difference from MapLibre').toBeLessThanOrEqual(
      MEDIAN_PIXEL_TOLERANCE
    );
    expect(colors.p99Difference, '99th percentile pixel difference').toBeLessThanOrEqual(
      P99_PIXEL_TOLERANCE
    );
  }, 120_000);

  afterAll(async () => {
    if (OUTPUT) {
      await commands.writeFile(
        'modules/basemap-layers/tests/reference-render/__output__/hillshade.json',
        `${JSON.stringify(measured, null, 2)}\n`
      );
    }
  });
});
