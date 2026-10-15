// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';
import {getSpriteIconMapping} from '../src/sprite';
import type {SpriteAtlas} from '../src/sprite';

const SIZE = 128;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/**
 * A two-image sprite: `square`, a solid red 16x16 square, and `framed`, a 32x32 image whose red
 * 16x16 center has an 8-pixel transparent border.
 */
async function createSquareAtlas(): Promise<SpriteAtlas> {
  const canvas = new OffscreenCanvas(48, 32);
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'rgb(255, 0, 0)';
  context.fillRect(0, 0, 16, 16);
  context.fillRect(24, 8, 16, 16);
  return {
    id: 'default',
    image: await createImageBitmap(canvas),
    mapping: getSpriteIconMapping({
      square: {x: 0, y: 0, width: 16, height: 16, pixelRatio: 1},
      framed: {x: 16, y: 0, width: 32, height: 32, pixelRatio: 1}
    })
  };
}

/**
 * Renders one point symbol per entry of `features` (`[x, y]` in pixels from the canvas center,
 * and feature properties) with `layout`, and returns the frame.
 */
async function renderSymbols(
  layout: Record<string, unknown>,
  features: [number[], Record<string, unknown>][],
  paint: Record<string, unknown> = {}
): Promise<ImageData> {
  const atlas = await createSquareAtlas();
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
      views: new OrthographicView({id: 'icon-collision-test'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers: [
        new MVTLabelLayer({
          id: 'symbols',
          pickable: true,
          config: {labels: true},
          zoom: 8,
          styleLayer: {layout, paint},
          textColor: [0, 0, 0, 255],
          spriteAtlases: [atlas],
          data: features.map(([coordinates, properties]) => ({
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

/** Pixel bounds `[left, top, right, bottom)` of the canvas. */
type Region = [number, number, number, number];

/** Number of opaque pixels matching `isColor`, in `region` (the whole canvas by default). */
function countPixels(
  image: ImageData,
  isColor: (r: number, g: number, b: number) => boolean,
  [left, top, right, bottom]: Region = [0, 0, SIZE, SIZE]
) {
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * SIZE + x) * 4;
      if (image.data[i + 3] > 200 && isColor(image.data[i], image.data[i + 1], image.data[i + 2])) {
        count++;
      }
    }
  }
  return count;
}

const iconPixels = (image: ImageData, region?: Region) =>
  countPixels(image, (r, g, b) => r > 200 && g < 80 && b < 80, region);
const textPixels = (image: ImageData, region?: Region) =>
  countPixels(image, (r, g, b) => r < 80 && g < 80 && b < 80, region);

/** Symbols whose icon and text come from feature properties, ordered by `rank`. */
const LAYOUT = {
  'icon-image': ['get', 'icon'],
  'icon-size': ['coalesce', ['get', 'iconSize'], 1],
  'text-field': ['coalesce', ['get', 'name'], ''],
  'text-size': 16,
  'symbol-sort-key': ['get', 'rank']
};

describe('icon collision in the browser', () => {
  test('a symbol alone draws its icon', async () => {
    const image = await renderSymbols(LAYOUT, [[[0, 0], {rank: 1, icon: 'square'}]]);
    // A 16x16 icon.
    expect(iconPixels(image)).toBeGreaterThan(200);
  });

  test('an icon whose symbol loses to a higher-priority label is hidden with it', async () => {
    const image = await renderSymbols(LAYOUT, [
      [[0, 0], {rank: 0, name: 'MMMM'}],
      [[8, 0], {rank: 1, icon: 'square', name: 'MMMM'}]
    ]);
    expect(textPixels(image)).toBeGreaterThan(20);
    expect(iconPixels(image)).toBe(0);
  });

  test('an icon box hides a lower-priority label whose anchor it covers', async () => {
    const image = await renderSymbols(LAYOUT, [
      [[0, 0], {rank: 0, icon: 'square', iconSize: 3}],
      [[12, 0], {rank: 1, name: 'MMMM'}]
    ]);
    expect(iconPixels(image)).toBeGreaterThan(1000);
    expect(textPixels(image)).toBe(0);
  });

  test('icon-padding widens the icon box that hides lower-priority labels', async () => {
    // The 16-pixel square's box reaches 8 pixels from its center, 10 with the default padding;
    // the label's box, anchored at its left edge 20 pixels away, starts 18 pixels away with its
    // 2 pixels of padding. A padding of 16 reaches into it.
    const layout = {...LAYOUT, 'text-anchor': 'left'};
    const features: [number[], Record<string, unknown>][] = [
      [[0, 0], {rank: 0, icon: 'square'}],
      [[20, 0], {rank: 1, name: 'MMMM'}]
    ];
    expect(textPixels(await renderSymbols(layout, features))).toBeGreaterThan(20);
    deck?.finalize();
    parent?.remove();
    const image = await renderSymbols({...layout, 'icon-padding': 16}, features);
    expect(iconPixels(image)).toBeGreaterThan(200);
    expect(textPixels(image)).toBe(0);
  });

  test('a label hidden by placement is neither drawn nor picked', async () => {
    const image = await renderSymbols(LAYOUT, [
      [[0, 0], {rank: 0, name: 'AAAA'}],
      [[6, 4], {rank: 1, name: 'BBBB'}]
    ]);
    expect(textPixels(image)).toBeGreaterThan(20);
    const picked = new Set(
      (deck as any)
        .pickObjects({x: 0, y: 0, width: SIZE, height: SIZE})
        .map((info: any) => (info.object?.__source?.object ?? info.object)?.properties?.name)
        .filter(Boolean)
    );
    expect([...picked]).toEqual(['AAAA']);
  });

  test("an icon's transparent border still hides a lower-priority label", async () => {
    // At icon-size 2 the image is 64 pixels wide: opaque within 16 pixels of its center,
    // transparent from 16 to 32. The label's anchor, 24 pixels away, is under the border only.
    const image = await renderSymbols(LAYOUT, [
      [[0, 0], {rank: 0, icon: 'framed', iconSize: 2}],
      [[24, 0], {rank: 1, name: 'MMMM'}]
    ]);
    expect(iconPixels(image)).toBeGreaterThan(500);
    expect(textPixels(image)).toBe(0);
  });

  test('an icon that ignores placement does not hide other labels', async () => {
    const image = await renderSymbols({...LAYOUT, 'icon-ignore-placement': true}, [
      [[0, 0], {rank: 0, icon: 'square', iconSize: 3}],
      [[12, 0], {rank: 1, name: 'MMMM'}]
    ]);
    expect(iconPixels(image)).toBeGreaterThan(500);
    expect(textPixels(image)).toBeGreaterThan(20);
  });

  test('icons and text that allow overlap and ignore placement are all drawn', async () => {
    const image = await renderSymbols(
      {
        ...LAYOUT,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      [
        [[0, 0], {rank: 0, name: 'MMMM'}],
        [[8, 0], {rank: 1, icon: 'square'}],
        [[-40, 0], {rank: 2, icon: 'square'}]
      ]
    );
    expect(textPixels(image)).toBeGreaterThan(20);
    // Both icons, each 16x16, less what the text draws over the first.
    expect(iconPixels(image)).toBeGreaterThan(400);
  });

  test('an icon that allows overlap is drawn where it loses, and still hides later labels', async () => {
    // Pixel rows grow downwards from the center: the first label at y = 4, the second at -20.
    const image = await renderSymbols(
      {...LAYOUT, 'icon-allow-overlap': true, 'text-optional': true},
      [
        [[0, 0], {rank: 1, icon: 'square', iconSize: 4}],
        // Wins over the icon at the icon's anchor; the icon is drawn anyway.
        [[0, 4], {rank: 0, name: 'MMMM'}],
        // Its anchor is under the icon, so it is hidden.
        [[20, -20], {rank: 2, name: 'MMMM'}]
      ]
    );
    expect(iconPixels(image)).toBeGreaterThan(1000);
    expect(textPixels(cropRows(image, SIZE / 2 - 8, SIZE))).toBeGreaterThan(20);
    expect(textPixels(cropRows(image, 0, SIZE / 2 - 8))).toBe(0);
  });

  test('an icon without text that allows overlap is drawn where it loses', async () => {
    // The layer has text, but this symbol's is empty: its icon follows only icon-allow-overlap.
    const image = await renderSymbols({...LAYOUT, 'icon-allow-overlap': true}, [
      [[0, 0], {rank: 0, name: 'MMMM'}],
      [[8, 0], {rank: 1, icon: 'square'}]
    ]);
    expect(textPixels(image)).toBeGreaterThan(20);
    expect(iconPixels(image)).toBeGreaterThan(100);
  });

  test('text whose icon is empty or missing follows only text-allow-overlap', async () => {
    // Both labels' anchors are under the higher-priority icon; neither label has an icon of its
    // own, so neither waits for one. Pixel rows grow downwards: the labels at y = 16 and -16.
    const image = await renderSymbols({...LAYOUT, 'text-allow-overlap': true}, [
      [[0, 0], {rank: 0, icon: 'square', iconSize: 4}],
      [[0, 16], {rank: 1, name: 'MMMM'}],
      [[0, -16], {rank: 2, icon: 'not-in-the-sprite', name: 'MMMM'}]
    ]);
    expect(iconPixels(image)).toBeGreaterThan(1000);
    expect(textPixels(cropRows(image, SIZE / 2, SIZE))).toBeGreaterThan(20);
    expect(textPixels(cropRows(image, 0, SIZE / 2))).toBeGreaterThan(20);
  });

  test('text with an icon that does not allow overlap is still hidden with it', async () => {
    const image = await renderSymbols({...LAYOUT, 'text-allow-overlap': true}, [
      [[0, 0], {rank: 0, icon: 'square', iconSize: 4}],
      [[0, 16], {rank: 1, icon: 'square', name: 'MMMM'}]
    ]);
    // Only the first icon: the second symbol loses at its anchor, text and icon together.
    expect(textPixels(image)).toBe(0);
  });

  test('text that ignores placement does not hide symbols between its anchor and its offset text', async () => {
    // Pixel rows grow downwards: the first label's anchor at y = 24, its text 48 pixels above, at
    // -24. The second symbol's anchor, at 0, lies between them.
    const image = await renderSymbols(
      {...LAYOUT, 'text-ignore-placement': true, 'text-offset': [0, -3]},
      [
        [[0, 24], {rank: 0, name: 'MM'}],
        [[0, 0], {rank: 1, name: 'MM'}]
      ]
    );
    // The first label's text, around row 40.
    expect(textPixels(cropRows(image, 30, 52))).toBeGreaterThan(20);
    // The second label's text, 48 pixels above its anchor: around row 16.
    expect(textPixels(cropRows(image, 0, 28))).toBeGreaterThan(20);
  });

  test('text that ignores placement is drawn at full opacity wherever its anchor falls', async () => {
    // Anchors on even and odd pixels in each axis: the collision map has half the canvas
    // resolution, and the anchor's mark must cover every sample of the label's own test. The
    // labels are far apart, so each is drawn as opaque as the same label when it blocks, whose
    // box covers its anchor.
    const anchors = [
      [-40, -40],
      [21, -40],
      [-40, 21],
      [21, 21]
    ];
    /** The most opaque pixel of each label, drawn with `layout`. */
    const renderAlphas = async (layout: Record<string, unknown>) => {
      const image = await renderSymbols(
        layout,
        anchors.map((position, rank) => [position, {rank, name: 'MM'}])
      );
      deck?.finalize();
      deck = null;
      parent?.remove();
      parent = null;
      return anchors.map(([x, y]) => {
        // The label's pixels, around its anchor (pixel rows grow downwards).
        const left = SIZE / 2 + x - 12;
        const top = SIZE / 2 + y - 8;
        let alpha = 0;
        for (let row = top; row < top + 18; row++) {
          for (let column = left; column < left + 26; column++) {
            alpha = Math.max(alpha, image.data[(row * SIZE + column) * 4 + 3]);
          }
        }
        return alpha;
      });
    };
    const blocking = await renderAlphas(LAYOUT);
    expect(Math.min(...blocking)).toBeGreaterThan(200);
    expect(await renderAlphas({...LAYOUT, 'text-ignore-placement': true})).toEqual(blocking);
  });

  test("an icon-only layer's text-offset does not widen what its icons hide", async () => {
    // No text: each symbol is its icon. The first icon covers rows 80 to 96; the second
    // symbol's anchor, 24 pixels above the first, is outside it.
    const image = await renderSymbols(
      {'icon-image': ['get', 'icon'], 'text-offset': [0, -3], 'symbol-sort-key': ['get', 'rank']},
      [
        [[0, 24], {rank: 0, icon: 'square'}],
        [[0, 0], {rank: 1, icon: 'square'}]
      ]
    );
    expect(iconPixels(cropRows(image, 76, 100))).toBeGreaterThan(200);
    expect(iconPixels(cropRows(image, 52, 76))).toBeGreaterThan(200);
  });
});

/** The rows `[top, bottom)` of `image`, other pixels cleared. */
function cropRows(image: ImageData, top: number, bottom: number): ImageData {
  const data = new Uint8ClampedArray(image.data);
  data.fill(0, 0, top * image.width * 4);
  data.fill(0, bottom * image.width * 4);
  return new ImageData(data, image.width, image.height);
}

describe('icon collision with several halos in the browser', () => {
  // Each distinct halo is drawn by its own text sublayer; labels are placed by another one.
  const HALOS = {'text-halo-color': '#ffffff', 'text-halo-width': ['get', 'halo']};
  const HALO_LAYOUT = {...LAYOUT, 'text-field': ['get', 'name'], 'icon-offset': [0, -12]};

  test("every symbol keeps its icon and its label, the icon's own label not hiding it", async () => {
    // Three symbols far apart, with two halos. The collision filter identifies each symbol by
    // its row index in every sublayer; were the icons' rows in another order than the labels',
    // an icon and its own label would count as two symbols at one anchor, and one would hide.
    const regions: Region[] = [
      [0, 0, SIZE / 2, SIZE / 2],
      [SIZE / 2, 0, SIZE, SIZE / 2],
      [0, SIZE / 2, SIZE, SIZE]
    ];
    const image = await renderSymbols(
      HALO_LAYOUT,
      [
        [[-32, -24], {rank: 1, icon: 'square', name: 'MM', halo: 1}],
        [[32, -24], {rank: 1, icon: 'square', name: 'MM', halo: 2}],
        [[0, 40], {rank: 1, icon: 'square', name: 'MM', halo: 2}]
      ],
      HALOS
    );
    for (const region of regions) {
      expect(iconPixels(image, region), `icon in ${region}`).toBeGreaterThan(100);
      expect(textPixels(image, region), `text in ${region}`).toBeGreaterThan(20);
    }
  });

  test('a higher-priority label hides another symbol with its icon and its haloed label', async () => {
    const image = await renderSymbols(
      HALO_LAYOUT,
      [
        [[0, 0], {rank: 0, name: 'MMMM', halo: 1}],
        [[8, 0], {rank: 1, icon: 'square', name: 'MMMM', halo: 2}],
        // Far from the two, with the second halo: drawn with its icon.
        [[0, 44], {rank: 1, icon: 'square', name: 'MM', halo: 2}]
      ],
      HALOS
    );
    const top: Region = [0, 0, SIZE, SIZE / 2 + 16];
    const bottom: Region = [0, SIZE / 2 + 16, SIZE, SIZE];
    expect(iconPixels(image, top)).toBe(0);
    expect(textPixels(image, top)).toBeGreaterThan(20);
    expect(iconPixels(image, bottom)).toBeGreaterThan(100);
    expect(textPixels(image, bottom)).toBeGreaterThan(20);
  });
});

describe('icon-rotate in the browser', () => {
  test('turns an icon clockwise about its anchor point, with its icon-anchor', async () => {
    // The 16 px square's left edge is on the point. Turned 90 degrees clockwise, as in MapLibre,
    // its top edge is: the square lies below the point, not to its right.
    const image = await renderSymbols({'icon-image': 'square', 'icon-anchor': 'left'}, [
      [[0, 0], {}]
    ]);
    // A new render: release the first one's deck and canvas, as `afterEach` releases only the last.
    deck?.finalize();
    deck = null;
    parent?.remove();
    parent = null;
    const rotated = await renderSymbols(
      {'icon-image': 'square', 'icon-anchor': 'left', 'icon-rotate': 90},
      [[[0, 0], {}]]
    );
    // Strips 10 to 14 px right of and below the point: only the unturned square reaches the first,
    // only the turned one the second.
    const right: Region = [SIZE / 2 + 10, SIZE / 2 - 4, SIZE / 2 + 14, SIZE / 2 + 4];
    const below: Region = [SIZE / 2 - 4, SIZE / 2 + 10, SIZE / 2 + 4, SIZE / 2 + 14];
    expect(iconPixels(image, right)).toBeGreaterThan(20);
    expect(iconPixels(image, below)).toBe(0);
    expect(iconPixels(rotated, below)).toBeGreaterThan(20);
    expect(iconPixels(rotated, right)).toBe(0);
  });
});
