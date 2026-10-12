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

function finalizeDeck() {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
}

afterEach(finalizeDeck);

/** A one-image sprite: `square`, a solid red 16x16 square. */
async function createSquareAtlas(): Promise<SpriteAtlas> {
  const canvas = new OffscreenCanvas(16, 16);
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'rgb(255, 0, 0)';
  context.fillRect(0, 0, 16, 16);
  return {
    id: 'default',
    image: await createImageBitmap(canvas),
    mapping: getSpriteIconMapping({square: {x: 0, y: 0, width: 16, height: 16, pixelRatio: 1}})
  };
}

/** Symbols whose icon, text and text color come from feature properties. */
const LAYOUT = {
  'icon-image': ['get', 'icon'],
  'text-field': ['get', 'name'],
  'text-size': 16,
  'text-offset': [0, 1],
  // Text with an icon and text alone follow different rules, so the rows are split by which
  // have an icon: the text of rows whose icon the sprite lacks is drawn by a sublayer of its own.
  'text-allow-overlap': true
};
const PAINT = {'text-color': ['get', 'color']};

/**
 * Three symbols in a column, far apart. Each label has a color of its own and the same number of
 * characters. The middle one's icon is not in the sprite.
 */
const FEATURES = [
  {coordinates: [0, -48], properties: {icon: 'square', name: 'MM', color: '#00ff00'}},
  {coordinates: [0, -8], properties: {icon: 'not-in-the-sprite', name: 'MM', color: '#0000ff'}},
  {coordinates: [0, 32], properties: {icon: 'square', name: 'MM', color: '#ff00ff'}}
];

// One array for every render: new data would refresh every attribute of the label sublayers.
const DATA = FEATURES.map(({coordinates, properties}) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates},
  properties
}));

function createLayer(spriteAtlases: SpriteAtlas[] | null) {
  return new MVTLabelLayer({
    id: 'symbols',
    config: {labels: true},
    zoom: 8,
    styleLayer: {layout: LAYOUT, paint: PAINT},
    spriteAtlases,
    data: DATA
  } as any);
}

/**
 * Renders `layers` and resolves with the first frame drawn once every layer is loaded. Creates
 * the deck on the first call; later calls update its layers.
 */
function render(layers: any[]): Promise<ImageData> {
  return new Promise<ImageData>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 10_000);
    const onAfterRender = () => {
      const layerList = (deck as any)?.layerManager?.getLayers() || [];
      if (!layerList.length || layerList.some((layer: any) => !layer.isLoaded)) {
        return;
      }
      // Read the frame back in the render callback, before the drawing buffer is cleared.
      const copy = document.createElement('canvas');
      copy.width = SIZE;
      copy.height = SIZE;
      const context = copy.getContext('2d')!;
      context.drawImage(deck!.getCanvas()!, 0, 0);
      window.clearTimeout(timeout);
      deck!.setProps({onAfterRender: () => {}});
      resolve(context.getImageData(0, 0, SIZE, SIZE));
    };
    const onError = (error: Error) => {
      window.clearTimeout(timeout);
      reject(error);
    };
    if (deck) {
      deck.setProps({layers, onAfterRender, onError});
      return;
    }
    parent = document.createElement('div');
    document.body.append(parent);
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new OrthographicView({id: 'sprite-load-labels-test'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers,
      onAfterRender,
      onError
    });
  });
}

/** Number of opaque pixels per label color, in each label's band of rows. */
function countLabelPixels(image: ImageData) {
  const colors = {
    green: (r: number, g: number, b: number) => r < 80 && g > 200 && b < 80,
    blue: (r: number, g: number, b: number) => r < 80 && g < 80 && b > 200,
    magenta: (r: number, g: number, b: number) => r > 200 && g < 80 && b > 200
  };
  // Each label's text, 16 pixels below its anchor (pixel rows grow downwards).
  const bands = FEATURES.map(({coordinates: [, y]}) => SIZE / 2 + y + 16);
  return bands.map(center =>
    Object.fromEntries(
      Object.entries(colors).map(([name, isColor]) => {
        let count = 0;
        for (let row = Math.max(center - 12, 0); row < Math.min(center + 12, SIZE); row++) {
          for (let column = 0; column < SIZE; column++) {
            const i = (row * SIZE + column) * 4;
            const [r, g, b, a] = image.data.subarray(i, i + 4);
            if (a > 200 && isColor(r, g, b)) {
              count++;
            }
          }
        }
        return [name, count];
      })
    )
  );
}

describe('labels when the sprites load in the browser', () => {
  test('each label keeps its own position and color once the sprites load', async () => {
    const atlas = await createSquareAtlas();
    // Loaded from the start.
    const expected = await render([createLayer([atlas])]);
    finalizeDeck();

    // While the sprites load, every row is taken to have its icon, so one text sublayer draws
    // every label. Once the atlas arrives, the middle label moves to a sublayer of its own; the
    // first sublayer's glyphs must then be those of the other two labels, not of its first rows
    // before.
    await render([createLayer(null)]);
    const loaded = await render([createLayer([atlas])]);

    const expectedCounts = countLabelPixels(expected);
    // The reference draws each label in its own band.
    expect(expectedCounts[0].green).toBeGreaterThan(20);
    expect(expectedCounts[1].blue).toBeGreaterThan(20);
    expect(expectedCounts[2].magenta).toBeGreaterThan(20);
    expect(countLabelPixels(loaded)).toEqual(expectedCounts);
  });
});
