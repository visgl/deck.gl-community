// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';

const SIZE = 256;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => cleanup());

/** Renders collision-filtered point labels at `points`, in pixels from the center. */
function renderLabels(layout: Record<string, unknown>, points: number[][] = [[0, 0]]) {
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
      views: new OrthographicView({id: 'text-spacing-test'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers: [
        new MVTLabelLayer({
          id: 'labels',
          config: {labels: true},
          zoom: 8,
          styleLayer: {layout: {'text-size': 16, ...layout}, paint: {}},
          textColor: [0, 0, 0, 255],
          data: points.map(coordinates => ({
            type: 'Feature',
            geometry: {type: 'Point', coordinates},
            properties: {}
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

/** Whether the pixel at `[x, y]` is opaque and dark (text-colored). */
function isTextPixel(image: ImageData, x: number, y: number): boolean {
  const i = (y * SIZE + x) * 4;
  return image.data[i + 3] > 200 && image.data[i] < 80;
}

/** The first and last text-colored columns in rows `[top, bottom)`, or null without any. */
function getInkColumns(image: ImageData, top = 0, bottom = SIZE): [number, number] | null {
  let left = SIZE;
  let right = -1;
  for (let y = top; y < bottom; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (isTextPixel(image, x, y)) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  return right < 0 ? null : [left, right];
}

/** The text-colored rows, as `[first, last]`. */
function getInkRows(image: ImageData): [number, number] {
  let top = SIZE;
  let bottom = -1;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (isTextPixel(image, x, y)) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return [top, bottom];
}

/** The ink columns of the first and of the last line of a two-line label. */
async function getLineColumns(layout: Record<string, unknown>) {
  const image = await renderLabels({
    'text-field': 'MMMMMM\nMM',
    'text-line-height': 1.5,
    ...layout
  });
  const [top, bottom] = getInkRows(image);
  const middle = Math.round((top + bottom) / 2);
  return {
    first: getInkColumns(image, top, middle)!,
    last: getInkColumns(image, middle, bottom + 1)!
  };
}

describe('text-letter-spacing in the browser', () => {
  test('widens the label by the spacing after every character but the last', async () => {
    const plain = getInkColumns(await renderLabels({'text-field': 'MMMM'}))!;
    cleanup();
    const spaced = getInkColumns(
      await renderLabels({'text-field': 'MMMM', 'text-letter-spacing': 1})
    )!;
    // Three gaps of 1 em at 16 px, centered on the anchor.
    const growth = spaced[1] - spaced[0] - (plain[1] - plain[0]);
    expect(Math.abs(growth - 48)).toBeLessThanOrEqual(2);
    expect(Math.abs(spaced[0] + spaced[1] - (plain[0] + plain[1]))).toBeLessThanOrEqual(2);
  });

  test('a left-anchored label grows to the right', async () => {
    const plain = getInkColumns(await renderLabels({'text-field': 'MMMM', 'text-anchor': 'left'}))!;
    cleanup();
    const spaced = getInkColumns(
      await renderLabels({'text-field': 'MMMM', 'text-anchor': 'left', 'text-letter-spacing': 1})
    )!;
    expect(Math.abs(spaced[0] - plain[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(spaced[1] - plain[1] - 48)).toBeLessThanOrEqual(2);
  });

  test('the collision box covers the spaced text', async () => {
    // Labels collide by their boxes, padded by 2 pixels. 50 pixels apart, the plain labels, about
    // 40 pixels wide, miss each other; spaced by 1 em, about 72 pixels wide, they overlap.
    const points = [
      [-25, 0],
      [25, 0]
    ];
    const plain = getInkColumns(await renderLabels({'text-field': 'MMM'}, points))!;
    expect(plain[1] - plain[0]).toBeGreaterThan(80);
    cleanup();
    const spaced = getInkColumns(
      await renderLabels({'text-field': 'MMM', 'text-letter-spacing': 1}, points)
    )!;
    // Only the first label, centered 25 pixels left, draws.
    expect(spaced[1] - spaced[0]).toBeLessThan(80);
    expect(Math.abs((spaced[0] + spaced[1]) / 2 - (SIZE / 2 - 25))).toBeLessThanOrEqual(2);
  });
});

describe('text-justify in the browser', () => {
  test('aligns the lines of a centered label left, center or right', async () => {
    const left = await getLineColumns({'text-justify': 'left'});
    expect(Math.abs(left.first[0] - left.last[0])).toBeLessThanOrEqual(1);
    expect(left.first[1] - left.last[1]).toBeGreaterThan(20);
    cleanup();
    const right = await getLineColumns({'text-justify': 'right'});
    expect(Math.abs(right.first[1] - right.last[1])).toBeLessThanOrEqual(1);
    expect(right.last[0] - right.first[0]).toBeGreaterThan(20);
    cleanup();
    const center = await getLineColumns({'text-justify': 'center'});
    const firstCenter = center.first[0] + center.first[1];
    expect(Math.abs(firstCenter - (center.last[0] + center.last[1]))).toBeLessThanOrEqual(2);
    // The block stays centered on the anchor whichever way its lines are justified.
    expect(Math.abs(left.first[0] - center.first[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(right.first[1] - center.first[1])).toBeLessThanOrEqual(1);
  });

  test('centers the lines of a left-anchored label by default, and follows the anchor with auto', async () => {
    const byDefault = await getLineColumns({'text-anchor': 'left'});
    const firstCenter = byDefault.first[0] + byDefault.first[1];
    expect(Math.abs(firstCenter - (byDefault.last[0] + byDefault.last[1]))).toBeLessThanOrEqual(2);
    cleanup();
    const auto = await getLineColumns({'text-anchor': 'left', 'text-justify': 'auto'});
    expect(Math.abs(auto.first[0] - auto.last[0])).toBeLessThanOrEqual(1);
    // Either way, the block's left edge is at the anchor.
    expect(Math.abs(auto.first[0] - byDefault.first[0])).toBeLessThanOrEqual(1);
  });
});
