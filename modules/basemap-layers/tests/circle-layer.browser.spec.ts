// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index';

const SIZE = 128;
const CENTER = SIZE / 2;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** The circle sublayer that a circle style layer draws for one point at the canvas center. */
function circleTile(paint: Record<string, unknown>) {
  const layers = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom: 5,
    styleDefinition: {
      version: 8,
      sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
      layers: [{id: 'points', type: 'circle', source: 'tiles', paint}]
    } as any
  });
  const vectorLayer: any = layers.find(layer => layer.id === 'test-tiles');
  // The props that the tile layer passes to each tile.
  const [sublayer] = vectorLayer.props.renderSubLayers({
    pickable: false,
    visible: true,
    opacity: 1,
    modelMatrix: null,
    coordinateSystem: 'default',
    coordinateOrigin: [0, 0, 0],
    extensions: [],
    highlightedObjectIndex: -1,
    highlightColor: [0, 0, 128, 128],
    wrapLongitude: false,
    id: 'test-tiles-tile',
    data: [{type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {}}],
    tile: {index: {x: 0, y: 0, z: 5}}
  });
  return sublayer;
}

/** Renders layers on a white canvas and returns the first frame drawn after they load. */
function render(layers: unknown[]) {
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
      views: new OrthographicView({id: 'flat'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers: layers as any,
      onAfterRender: () => {
        const loaded = (deck as any)?.layerManager?.getLayers() || [];
        if (!loaded.length || loaded.some((layer: any) => !layer.isLoaded)) {
          return;
        }
        const copy = document.createElement('canvas');
        copy.width = SIZE;
        copy.height = SIZE;
        const context = copy.getContext('2d')!;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, SIZE, SIZE);
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

function pixel(image: ImageData, x: number, y: number): number[] {
  const i = (y * SIZE + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

function expectColor(actual: number[], expected: number[], tolerance = 2) {
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(tolerance);
  }
}

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const WHITE = [255, 255, 255];

describe('circle layers in the browser', () => {
  test('draws the stroke outside circle-radius', async () => {
    const image = await render([
      circleTile({
        'circle-radius': 20,
        'circle-color': '#ff0000',
        'circle-stroke-width': 8,
        'circle-stroke-color': '#0000ff'
      })
    ]);
    expectColor(pixel(image, CENTER, CENTER), RED);
    // Inside the radius: fill.
    expectColor(pixel(image, CENTER + 17, CENTER), RED);
    // The middle of the stroke, at radius + width / 2.
    expectColor(pixel(image, CENTER + 24, CENTER), BLUE);
    // Past radius + width: background.
    expectColor(pixel(image, CENTER + 31, CENTER), WHITE);
  });

  test('circle-blur fades the outer fraction of the circle', async () => {
    const image = await render([
      circleTile({'circle-radius': 40, 'circle-color': '#000000', 'circle-blur': 0.5})
    ]);
    const red = (x: number) => pixel(image, CENTER + x, CENTER)[0];
    // Inside 1 - blur of the radius: opaque.
    expect(red(10)).toBeLessThanOrEqual(2);
    // Halfway through the blur, smoothstep gives half the alpha.
    expect(Math.abs(red(30) - 128)).toBeLessThanOrEqual(12);
    // The alpha keeps falling toward the edge.
    expect(red(36)).toBeGreaterThan(red(30));
    expect(red(30)).toBeGreaterThan(red(24));
    // Without blur, the same point is opaque.
    deck?.finalize();
    deck = null;
    parent?.remove();
    const sharp = await render([circleTile({'circle-radius': 40, 'circle-color': '#000000'})]);
    expect(pixel(sharp, CENTER + 30, CENTER)[0]).toBeLessThanOrEqual(2);
  });

  test('a positive circle-translate y moves the circle down the screen', async () => {
    const image = await render([
      circleTile({'circle-radius': 6, 'circle-color': '#ff0000', 'circle-translate': [0, 30]})
    ]);
    expectColor(pixel(image, CENTER, CENTER + 30), RED);
    expectColor(pixel(image, CENTER, CENTER), WHITE);
    expectColor(pixel(image, CENTER, CENTER - 30), WHITE);
  });
});
