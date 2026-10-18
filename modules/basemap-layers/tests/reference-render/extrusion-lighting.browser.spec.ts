// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Buildings are shaded as MapLibre GL JS shades `fill-extrusion`: from the style's `light`, with
 * walls darkening toward the ground (`fill-extrusion-vertical-gradient`). deck.gl's default lights
 * drew them in other colors, which in the split view example stood out more than any other
 * difference.
 *
 * Each case renders OpenFreeMap Liberty's `building-3d` alone, opaque on black, at pitch 60 over
 * the street grid of `new-york-positron-z14.2`, with both renderers, and compares the colors of
 * the pixels that both draw a building on. With `VITE_EXTRUSION_LIGHTING_OUTPUT=1`, a comparison
 * image of each case and the measured colors are written to `__output__/`.
 */

import {afterAll, describe, expect, test} from 'vitest';
import {commands} from 'vitest/browser';
import {loadReferenceStyle} from './fixtures';
import {renderBasemapLayer, renderMapLibre} from './renderers';
import {DEFAULT_SCENES, VIEWPORT} from './scenes';

const env = (import.meta as any).env || {};
const OUTPUT = env.VITE_EXTRUSION_LIGHTING_OUTPUT === '1';

const SCENE = {
  ...DEFAULT_SCENES.find(scene => scene.id === 'new-york-positron-z14.2')!,
  style: 'ofm-liberty' as const
};
const PITCH = 60;

type LightingCase = {
  id: string;
  /** Replaces the building layer's paint. */
  paint?: Record<string, unknown>;
  /** The style's `light`. */
  light?: Record<string, unknown>;
  /** Camera bearing, in degrees. Default 0. */
  bearing?: number;
};

const CASES: LightingCase[] = [
  {id: "Liberty's buildings, default light"},
  {id: 'saturated color', paint: {'fill-extrusion-color': '#c04020'}},
  {id: 'without the vertical gradient', paint: {'fill-extrusion-vertical-gradient': false}},
  // A light anchored to the viewport turns with the map, so the same walls face it.
  {id: 'default light, map turned 120°', bearing: 120},
  {
    id: 'a low, bright, map-anchored light',
    light: {anchor: 'map', position: [1.5, 90, 80], intensity: 0.8, color: '#ffe0c0'}
  },
  {
    id: 'a map-anchored light, map turned 120°',
    light: {anchor: 'map', position: [1.5, 90, 80], intensity: 0.8, color: '#ffe0c0'},
    bearing: 120
  }
];

/**
 * The most the mean color of the building pixels may differ from MapLibre's, per channel, in
 * 0-255. deck.gl's lights missed it by 8 to 100. What is left comes from the cameras: deck.gl's
 * field of view differs from MapLibre's, so the two show walls and roofs in different shares.
 */
const MEAN_TOLERANCE = 6;

/**
 * The most the median building pixel may differ from MapLibre's at the same place, as the sum of
 * its RGB differences. A mean color can match with walls and roofs swapped: deck.gl's lights lit
 * the walls MapLibre leaves dark and darkened its bright roofs, which put the median at 165 with
 * a mean 8 off. Shaded as MapLibre, most pixels match exactly.
 */
const MEDIAN_PIXEL_TOLERANCE = 6;

/** Liberty's `building-3d` alone on a black background, opaque. */
function getBuildingStyle(style: any, {paint = {}, light}: LightingCase): any {
  const building = style.layers.find((layer: any) => layer.id === 'building-3d');
  return {
    ...style,
    ...(light ? {light} : {}),
    layers: [
      {id: 'background', type: 'background', paint: {'background-color': '#000000'}},
      {...building, paint: {...building.paint, 'fill-extrusion-opacity': 1, ...paint}}
    ]
  };
}

/**
 * Over the pixels that are not black in either render: the mean RGB of each render, and the
 * median of the pixels' summed RGB differences.
 */
function getBuildingColors(reference: Uint8ClampedArray, candidate: Uint8ClampedArray) {
  const sums = [0, 0, 0, 0, 0, 0];
  const differences: number[] = [];
  let count = 0;
  for (let index = 0; index < reference.length; index += 4) {
    const drawn = (pixels: Uint8ClampedArray) =>
      pixels[index] + pixels[index + 1] + pixels[index + 2] > 24;
    if (drawn(reference) && drawn(candidate)) {
      let difference = 0;
      for (let channel = 0; channel < 3; channel++) {
        sums[channel] += reference[index + channel];
        sums[channel + 3] += candidate[index + channel];
        difference += Math.abs(reference[index + channel] - candidate[index + channel]);
      }
      differences.push(difference);
      count++;
    }
  }
  const mean = sums.map(sum => sum / Math.max(count, 1));
  differences.sort((a, b) => a - b);
  const medianDifference = differences[Math.floor(differences.length / 2)] ?? 0;
  return {count, reference: mean.slice(0, 3), candidate: mean.slice(3), medianDifference};
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
    `modules/basemap-layers/tests/reference-render/__output__/extrusion-lighting-${name}.png`,
    canvas.toDataURL('image/png').split(',')[1],
    'base64'
  );
}

const measured: Record<string, unknown> = {};

describe('fill-extrusion lighting', () => {
  test.each(CASES)('$id', async lightingCase => {
    const style = getBuildingStyle(await loadReferenceStyle(SCENE.style), lightingCase);
    const options = {pitch: PITCH, bearing: lightingCase.bearing ?? 0};
    const reference = await renderMapLibre(structuredClone(style), SCENE, options);
    const candidate = await renderBasemapLayer(structuredClone(style), SCENE, {}, options);
    if (OUTPUT) {
      await writeComparison(lightingCase.id, reference.pixels, candidate.pixels);
    }
    // A pitched view reaches past the recorded tiles toward the horizon: both renderers draw
    // without them.
    const problems = candidate.problems.filter(problem => !problem.startsWith('Missing fixture'));
    expect(problems).toEqual([]);

    const colors = getBuildingColors(reference.pixels, candidate.pixels);
    measured[lightingCase.id] = colors;
    expect(colors.count, 'building pixels').toBeGreaterThan(20_000);
    for (let channel = 0; channel < 3; channel++) {
      const offset = Math.abs(colors.candidate[channel] - colors.reference[channel]);
      expect(offset, `mean ${'RGB'[channel]} offset from MapLibre`).toBeLessThanOrEqual(
        MEAN_TOLERANCE
      );
    }
    expect(colors.medianDifference, 'median pixel difference from MapLibre').toBeLessThanOrEqual(
      MEDIAN_PIXEL_TOLERANCE
    );
  }, 120_000);

  afterAll(async () => {
    if (OUTPUT) {
      await commands.writeFile(
        'modules/basemap-layers/tests/reference-render/__output__/extrusion-lighting.json',
        `${JSON.stringify(measured, null, 2)}\n`
      );
    }
  });
});
