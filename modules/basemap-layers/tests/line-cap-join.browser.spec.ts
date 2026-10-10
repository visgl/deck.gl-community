// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index';

const SIZE = 128;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** The deck.gl sublayers that one line style layer draws for one tile of features. */
function styleSublayers(styleLayer: Record<string, unknown>, features: unknown[], zoom = 15) {
  const layers = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: {
      version: 8,
      sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
      layers: [{id: 'path', type: 'line', source: 'tiles', 'source-layer': 'land', ...styleLayer}]
    } as any
  });
  const vectorLayer: any = layers.find(layer => layer.id === 'test-tiles');
  // Tile sublayers receive the tile layer's base props, defaults included.
  return vectorLayer.props.renderSubLayers({
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
    data: features,
    tile: {index: {x: 0, y: 0, z: zoom}}
  });
}

function feature(type: string, coordinates: unknown, properties: Record<string, unknown> = {}) {
  return {
    type: 'Feature',
    geometry: {type, coordinates},
    properties: {layerName: 'land', ...properties}
  };
}

/** Renders layers on a white canvas and returns the first frame drawn after they load. */
function render(layers: unknown[], view: unknown, viewState: Record<string, unknown>) {
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
      views: view as any,
      initialViewState: viewState as any,
      layers: layers as any,
      onAfterRender: () => {
        const loaded = (deck as any)?.layerManager?.getLayers() || [];
        if (!loaded.length || loaded.some((layer: any) => !layer.isLoaded)) {
          return;
        }
        // Read the frame back in the render callback, before the drawing buffer is cleared.
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

function renderFlat(layers: unknown[]) {
  return render(layers, new OrthographicView({id: 'flat'}), {target: [0, 0, 0], zoom: 0});
}

/** Whether a pixel is drawn, i.e. darker than the white background. */
function isInked(image: ImageData, x: number, y: number): boolean {
  const i = (y * SIZE + x) * 4;
  return image.data[i] + image.data[i + 1] + image.data[i + 2] < 600;
}

const CENTER = SIZE / 2;

/** Renders a black 10 pixel wide line with the given layout. */
function renderLine(coordinates: number[][], layout: Record<string, unknown>) {
  return renderFlat(
    styleSublayers({layout, paint: {'line-color': '#000000', 'line-width': 10}}, [
      feature('LineString', coordinates)
    ])
  );
}

describe('line-cap in the browser', () => {
  /** The first inked column along the middle row: where the line's start cap ends. */
  function capStart(image: ImageData): number {
    for (let x = 0; x < SIZE; x++) {
      if (isInked(image, x, CENTER)) {
        return x;
      }
    }
    return -1;
  }

  const LINE = [
    [-40, 0],
    [40, 0]
  ];

  test('butt caps end at the endpoint', async () => {
    expect(capStart(await renderLine(LINE, {'line-cap': 'butt'}))).toBe(CENTER - 40);
  });

  test('round caps reach half the line width beyond the endpoint', async () => {
    const start = capStart(await renderLine(LINE, {'line-cap': 'round'}));
    expect(start).toBeGreaterThanOrEqual(CENTER - 46);
    expect(start).toBeLessThanOrEqual(CENTER - 44);
  });

  test('the default cap is butt', async () => {
    expect(capStart(await renderLine(LINE, {}))).toBe(CENTER - 40);
  });
});

describe('line-join in the browser', () => {
  // A corner of about 53 degrees at the center: a full miter reaches 2.24 half widths, or about
  // 11 pixels, above the vertex.
  const CORNER = [
    [-20, 40],
    [0, 0],
    [20, 40]
  ];

  /** How far above the vertex the joint reaches along the middle column, in pixels. */
  function jointReach(image: ImageData): number {
    for (let y = 0; y < SIZE; y++) {
      if (isInked(image, CENTER, y)) {
        return CENTER - y;
      }
    }
    return -1;
  }

  test('a miter within line-miter-limit is drawn in full', async () => {
    const reach = jointReach(
      await renderLine(CORNER, {'line-join': 'miter', 'line-miter-limit': 3})
    );
    expect(reach).toBeGreaterThanOrEqual(10);
    expect(reach).toBeLessThanOrEqual(12);
  });

  test('a miter beyond line-miter-limit is cut at the limit', async () => {
    // The default limit of 2 half widths: 10 pixels.
    const reach = jointReach(await renderLine(CORNER, {'line-join': 'miter'}));
    expect(reach).toBeGreaterThanOrEqual(9);
    expect(reach).toBeLessThanOrEqual(10);
  });

  test('a bevel is cut at half the line width', async () => {
    const reach = jointReach(await renderLine(CORNER, {'line-join': 'bevel'}));
    expect(reach).toBeGreaterThanOrEqual(4);
    expect(reach).toBeLessThanOrEqual(5);
  });

  test('a round join reaches half the line width', async () => {
    const reach = jointReach(await renderLine(CORNER, {'line-join': 'round'}));
    expect(reach).toBeGreaterThanOrEqual(4);
    expect(reach).toBeLessThanOrEqual(5);
  });
});
