// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';

const SIZE = 128;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => cleanup());

/** Renders one collision-filtered point label at the canvas center and returns the frame. */
function renderLabel(layout: Record<string, unknown>, paint: Record<string, unknown> = {}) {
  return renderLabels(layout, paint, [{coordinates: [0, 0]}]);
}

/**
 * Renders collision-filtered point labels, one per entry of `points`, in that order, and returns
 * the frame.
 */
function renderLabels(
  layout: Record<string, unknown>,
  paint: Record<string, unknown>,
  points: Array<{coordinates: number[]; properties?: Record<string, unknown>}>
) {
  parent = document.createElement('div');
  document.body.append(parent);
  return new Promise<ImageData>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 10_000);
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new OrthographicView({id: 'label-test'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers: [
        new MVTLabelLayer({
          id: 'labels',
          config: {labels: true},
          zoom: 8,
          styleLayer: {layout, paint},
          textColor: [0, 0, 0, 255],
          data: points.map(({coordinates, properties = {}}) => ({
            type: 'Feature',
            geometry: {type: 'Point', coordinates},
            properties
          }))
        } as any)
      ],
      onAfterRender: () => {
        const layers = (deck as any)?.layerManager?.getLayers() || [];
        if (!layers.length || layers.some((layer: any) => !layer.isLoaded)) {
          return;
        }
        // Read the frame back in the render callback, before the drawing buffer is cleared.
        const copy = document.createElement('canvas');
        copy.width = SIZE;
        copy.height = SIZE;
        const context = copy.getContext('2d')!;
        context.drawImage(deck!.getCanvas()!, 0, 0);
        window.clearTimeout(timeout);
        resolve(context.getImageData(0, 0, SIZE, SIZE));
      },
      onError: error => {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

/** Removes the rendered deck, so that the next render starts afresh. */
function cleanup(): void {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
}

/** Number of opaque, dark (text-colored) pixels in rows `[top, bottom)` and columns `[left, right)`. */
function textPixels(image: ImageData, top = 0, bottom = SIZE, left = 0, right = SIZE): number {
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * SIZE + x) * 4;
      if (image.data[i + 3] > 200 && image.data[i] < 80) {
        count++;
      }
    }
  }
  return count;
}

describe('collision-filtered labels in the browser', () => {
  test('a centered label draws at full opacity', async () => {
    const image = await renderLabel({'text-field': 'MMMM', 'text-size': 16});
    expect(textPixels(image)).toBeGreaterThan(20);
  });

  test('a label moved off its anchor by text-offset still draws', async () => {
    const image = await renderLabel({
      'text-field': 'MMMM',
      'text-size': 16,
      'text-anchor': 'top',
      'text-offset': [0, 1.5]
    });
    // The text starts 24 pixels below the anchor at the canvas center.
    expect(textPixels(image, SIZE / 2 + 20, SIZE)).toBeGreaterThan(20);
  });

  test('a label anchored at its top edge draws at full opacity', async () => {
    const image = await renderLabel({'text-field': 'MMMM', 'text-size': 16, 'text-anchor': 'top'});
    expect(textPixels(image)).toBeGreaterThan(20);
  });

  test('a label anchored at its left edge draws at full opacity', async () => {
    const image = await renderLabel({'text-field': 'MMMM', 'text-size': 16, 'text-anchor': 'left'});
    expect(textPixels(image)).toBeGreaterThan(20);
  });

  test('a haloed label moved off its anchor still draws', async () => {
    const image = await renderLabel(
      {'text-field': 'MMMM', 'text-size': 16, 'text-anchor': 'top', 'text-offset': [0, 1.5]},
      {'text-halo-color': '#ffffff', 'text-halo-width': 2}
    );
    expect(textPixels(image, SIZE / 2 + 20, SIZE)).toBeGreaterThan(20);
  });
});

/** Whether the pixel at `[x, y]` is opaque and dark (text-colored). */
function isTextPixel(image: ImageData, x: number, y: number): boolean {
  const i = (y * SIZE + x) * 4;
  return image.data[i + 3] > 200 && image.data[i] < 80;
}

/** Pixels of the halo color: opaque and red. */
function haloPixels(image: ImageData): Array<[number, number]> {
  const pixels: Array<[number, number]> = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (image.data[i + 3] > 200 && image.data[i] > 200 && image.data[i + 1] < 80) {
        pixels.push([x, y]);
      }
    }
  }
  return pixels;
}

/**
 * Whether the pixel at `[x, y]` is opaque and darker than the red halo: covered, at least in part,
 * by the black text. Glyph edges and thin stems blend the text with the halo, so they are rarely
 * as dark as `isTextPixel` requires; how much depends on the font and the renderer.
 */
function isInkPixel(image: ImageData, x: number, y: number): boolean {
  const i = (y * SIZE + x) * 4;
  return image.data[i + 3] > 200 && image.data[i] <= 200;
}

/** Whether a pixel covered by the text lies within `radius` pixels of `[x, y]`. */
function isNearText(image: ImageData, [x, y]: [number, number], radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px >= 0 && py >= 0 && px < SIZE && py < SIZE && isInkPixel(image, px, py)) {
        return true;
      }
    }
  }
  return false;
}

describe('label halos in the browser', () => {
  const layout = {'text-field': 'MM', 'text-size': 16};
  const RED_HALO = {'text-halo-color': '#ff0000'};

  test('a halo outlines the glyphs instead of filling a box', async () => {
    // Large text, so that a box around the label would fill space well away from the glyphs:
    // between and inside the letters, and in the corners of the box.
    const image = await renderLabel(
      {...layout, 'text-size': 32},
      {...RED_HALO, 'text-halo-width': 2}
    );
    const halo = haloPixels(image);
    expect(halo.length).toBeGreaterThan(50);
    // Every halo pixel is within the halo width, plus a pixel of antialiasing, of the text.
    expect(halo.filter(pixel => !isNearText(image, pixel, 3))).toEqual([]);
    expect(textPixels(image)).toBeGreaterThan(20);
  });

  test('a halo is as wide as text-halo-width', async () => {
    const widths: number[] = [];
    for (const width of [1, 2, 4]) {
      const image = await renderLabel(
        {...layout, 'text-size': 32},
        {...RED_HALO, 'text-halo-width': width}
      );
      // Halo pixels left of the first letter, on the row through the label's center.
      let run = 0;
      for (let x = 0; x < SIZE && !isTextPixel(image, x, SIZE / 2); x++) {
        const i = ((SIZE / 2) * SIZE + x) * 4;
        run += image.data[i + 3] > 128 && image.data[i] > 128 && image.data[i + 1] < 128 ? 1 : 0;
      }
      widths.push(run);
      cleanup();
    }
    expect(widths).toEqual([1, 2, 4]);
  });

  test('a text-halo-width of 0 draws no halo', async () => {
    const image = await renderLabel(layout, {...RED_HALO, 'text-halo-width': 0});
    expect(haloPixels(image)).toEqual([]);
    expect(textPixels(image)).toBeGreaterThan(20);
  });
});

/**
 * The halo's alpha on row `y`, by default the row through the label's center, from the left edge
 * of the canvas to the first pixel of the text.
 */
function haloAlphaProfile(image: ImageData, y = SIZE / 2): number[] {
  const alphas: number[] = [];
  for (let x = 0; x < SIZE && !isTextPixel(image, x, y); x++) {
    alphas.push(image.data[(y * SIZE + x) * 4 + 3]);
  }
  return alphas;
}

/** Number of pixels whose alpha is well between transparent and opaque. */
function partialAlphas(alphas: number[]): number {
  return alphas.filter(alpha => alpha > 20 && alpha < 235).length;
}

/** Distance in pixels from the text to the farthest visible halo pixel. */
function haloReach(alphas: number[]): number {
  const first = alphas.findIndex(alpha => alpha > 4);
  return first < 0 ? 0 : alphas.length - first;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The halo alpha that MapLibre GL JS's symbol shader draws at `distance` pixels outside the glyph
 * edge, at a device pixel ratio of 1: the edge, `width` pixels out, fades over
 * `1.19 * blur + 0.84` pixels on each side.
 */
function getMapLibreHaloAlpha(distance: number, width: number, blur: number): number {
  const gamma = 1.19 * blur + 0.105 * 8;
  return 1 - smoothstep(width - gamma, width + gamma, distance);
}

describe('label halo blur in the browser', () => {
  const layout = {'text-field': 'MM', 'text-size': 32};
  const RED_HALO = {'text-halo-color': '#ff0000', 'text-halo-width': 2};

  async function renderProfile(blur?: number): Promise<number[]> {
    const image = await renderLabel(
      layout,
      blur === undefined ? RED_HALO : {...RED_HALO, 'text-halo-blur': blur}
    );
    cleanup();
    return haloAlphaProfile(image);
  }

  test('without text-halo-blur the halo edge is sharp', async () => {
    const sharp = await renderProfile();
    expect(partialAlphas(sharp)).toBeLessThanOrEqual(2);
    expect(sharp.at(-1)).toBeGreaterThan(235);
    expect(await renderProfile(0)).toEqual(sharp);
  });

  test('text-halo-blur fades the halo over about 2.4 px per px of blur', async () => {
    const sharp = await renderProfile(0);
    const blurred = await renderProfile(2);
    // MapLibre fades the halo over 1.19 * blur px on each side of the halo edge: about 4.8 px for
    // a blur of 2, with a falling alpha from the text outward.
    expect(partialAlphas(blurred)).toBeGreaterThanOrEqual(4);
    expect(partialAlphas(blurred)).toBeLessThanOrEqual(7);
    for (let i = 1; i < blurred.length; i++) {
      expect(blurred[i]).toBeGreaterThanOrEqual(blurred[i - 1]);
    }
    // The halo edge stays where it was, so the fade reaches about 2.4 px past the sharp halo.
    expect(haloReach(blurred) - haloReach(sharp)).toBeGreaterThanOrEqual(2);
    expect(haloReach(blurred) - haloReach(sharp)).toBeLessThanOrEqual(4);
  });

  test('the blurred halo follows the alpha of MapLibre GL JS', async () => {
    for (const [width, blur] of [
      [2, 2],
      [1, 4]
    ]) {
      const image = await renderLabel(layout, {
        ...RED_HALO,
        'text-halo-width': width,
        'text-halo-blur': blur
      });
      const alphas = haloAlphaProfile(image).reverse();
      // From the second pixel out: the first one also holds the antialiased glyph edge.
      for (let x = 1; x < 8; x++) {
        // The pixel's center is `x + 0.5` pixels from the text.
        const expected = 255 * getMapLibreHaloAlpha(x + 0.5, width, blur);
        expect(
          Math.abs(alphas[x] - expected),
          `width ${width}, blur ${blur}, pixel ${x}`
        ).toBeLessThanOrEqual(20);
      }
      cleanup();
    }
  });

  test('a blur wider than the distance field fades out before the edge of the glyph quads', async () => {
    // A blur of 8 px would fade over 9.5 px past the halo; the distance field ends about 9 px
    // past the glyphs of 32 px text. The fade is cut short there, without drawing the quads.
    const image = await renderLabel(layout, {...RED_HALO, 'text-halo-blur': 8});
    const stray: Array<[number, number]> = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (image.data[(y * SIZE + x) * 4 + 3] > 0 && !isNearText(image, [x, y], 10)) {
          stray.push([x, y]);
        }
      }
    }
    expect(stray).toEqual([]);
  });

  test('labels with different blurs each get their own blur', async () => {
    // Two labels, 60 px apart: different halos are drawn by different text sublayers.
    const image = await renderLabels(layout, {...RED_HALO, 'text-halo-blur': ['get', 'blur']}, [
      {coordinates: [0, -30], properties: {blur: 0}},
      {coordinates: [0, 30], properties: {blur: 2}}
    ]);
    const sharp = haloAlphaProfile(image, SIZE / 2 - 30);
    const blurred = haloAlphaProfile(image, SIZE / 2 + 30);
    expect(sharp.length).toBeLessThan(SIZE);
    expect(blurred.length).toBeLessThan(SIZE);
    expect(partialAlphas(sharp)).toBeLessThanOrEqual(2);
    expect(partialAlphas(blurred)).toBeGreaterThanOrEqual(4);
  });

  test('a wider blur fades the halo over more pixels', async () => {
    const blurs = [await renderProfile(1), await renderProfile(2), await renderProfile(4)];
    const reaches = blurs.map(haloReach);
    expect(reaches[1]).toBeGreaterThan(reaches[0]);
    expect(reaches[2]).toBeGreaterThan(reaches[1]);
  });
});

// Two labels of equal priority that overlap: anchors 28 pixels apart, each about 80 wide.
const OVERLAP_LAYOUT = {'text-field': 'MMMMMM', 'text-size': 16};

/** Text pixels drawn left and right of the overlap: by the left and the right label only. */
function sides(image: ImageData): [number, number] {
  const [top, bottom] = [SIZE / 2 - 14, SIZE / 2 + 14];
  return [textPixels(image, top, bottom, 0, 28), textPixels(image, top, bottom, SIZE - 28, SIZE)];
}

describe('label collision with several halos in the browser', () => {
  const paint = {'text-halo-color': '#ffffff', 'text-halo-width': ['get', 'halo']};

  test('a second halo elsewhere still lets only one of two overlapping labels draw', async () => {
    const image = await renderLabels(OVERLAP_LAYOUT, paint, [
      {coordinates: [-14, 0], properties: {halo: 1}},
      {coordinates: [14, 0], properties: {halo: 1}},
      // Far from the two, with a halo of its own: drawn by a second text sublayer.
      {coordinates: [0, 45], properties: {halo: 2}}
    ]);
    const [left, right] = sides(image);
    expect(Math.min(left, right)).toBe(0);
    expect(Math.max(left, right)).toBeGreaterThan(20);
    // The label with the other halo draws too.
    expect(textPixels(image, SIZE / 2 + 31, SIZE / 2 + 59)).toBeGreaterThan(20);
  });
});

describe('label collision ties in the browser', () => {
  test('of two overlapping labels with equal priority, the first one draws', async () => {
    for (const order of [
      [-14, 14],
      [14, -14]
    ]) {
      const image = await renderLabels(
        OVERLAP_LAYOUT,
        {},
        order.map(x => ({coordinates: [x, 0]}))
      );
      const [left, right] = sides(image);
      const [first, second] = order[0] < 0 ? [left, right] : [right, left];
      expect(first).toBeGreaterThan(20);
      expect(second).toBe(0);
      cleanup();
    }
  });

  test('the first label wins a tie also when the two have different halos', async () => {
    const image = await renderLabels(
      OVERLAP_LAYOUT,
      {'text-halo-color': '#ffffff', 'text-halo-width': ['get', 'halo']},
      [
        {coordinates: [14, 0], properties: {halo: 1}},
        {coordinates: [-14, 0], properties: {halo: 2}}
      ]
    );
    const [left, right] = sides(image);
    expect(right).toBeGreaterThan(20);
    expect(left).toBe(0);
  });
});

describe('text-padding in the browser', () => {
  // Two labels, anchors 32 pixels apart vertically: clear of each other's box. The top one sorts
  // first, so it has the higher priority.
  const points = [
    {coordinates: [0, -16], properties: {rank: 1}},
    {coordinates: [0, 16], properties: {rank: 2}}
  ];
  const layout = {'text-field': 'MM', 'text-size': 16, 'symbol-sort-key': ['get', 'rank']};

  /** Text pixels in the top and the bottom half of the frame: drawn by the first and second label. */
  function halves(image: ImageData): [number, number] {
    return [textPixels(image, 0, SIZE / 2), textPixels(image, SIZE / 2, SIZE)];
  }

  test('labels clear of each other both draw with the default padding', async () => {
    const [top, bottom] = halves(await renderLabels(layout, {}, points));
    expect(top).toBeGreaterThan(20);
    expect(bottom).toBeGreaterThan(20);
  });

  test('a text-padding that reaches the other anchor hides the lower-priority label', async () => {
    const [top, bottom] = halves(await renderLabels({...layout, 'text-padding': 24}, {}, points));
    expect(top).toBeGreaterThan(20);
    expect(bottom).toBe(0);
  });
});
