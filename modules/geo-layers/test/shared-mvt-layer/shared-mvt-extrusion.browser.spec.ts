// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {GeoJsonLayer} from '@deck.gl/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {lngLatToWorld} from '@math.gl/web-mercator';
import {afterEach, describe, expect, test} from 'vitest';
import {SharedMVTLayer} from '../../src';

const SIZE = 256;
const LONGITUDE = 0.01;
const LATITUDE = 60;

type Extent = {top: number; bottom: number; count: number};

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;
let onFrame: ((image: ImageData) => void) | null = null;

function cleanup() {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
}

afterEach(cleanup);

/** A square footprint around the view center, `half` degrees of longitude either side. */
function footprint(half: number): number[][] {
  const halfLatitude = half * Math.cos((LATITUDE * Math.PI) / 180);
  return [
    [LONGITUDE - half, LATITUDE - halfLatitude],
    [LONGITUDE + half, LATITUDE - halfLatitude],
    [LONGITUDE + half, LATITUDE + halfLatitude],
    [LONGITUDE - half, LATITUDE + halfLatitude],
    [LONGITUDE - half, LATITUDE - halfLatitude]
  ];
}

/** The ring as an extruded feature in the tile-local coordinates of whichever tile holds it. */
function tileData(ring: number[][], {x, y, z}: {x: number; y: number; z: number}) {
  const scale = 2 ** z;
  const local = ring.map(position => {
    const [worldX, worldY] = lngLatToWorld(position as [number, number]);
    return [(worldX / 512) * scale - x, (1 - worldY / 512) * scale - y];
  });
  return local.every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1)
    ? [{type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [local]}}]
    : [];
}

function measure(image: ImageData): Extent {
  let top = SIZE;
  let bottom = -1;
  let count = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const [r, g, b] = [image.data[i], image.data[i + 1], image.data[i + 2]];
      if (r > 40 && r > g + 30 && r > b + 30) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        count++;
      }
    }
  }
  return {top, bottom, count};
}

/** Resolves with a frame drawn a few frames after every layer has loaded. */
function nextFrame(): Promise<Extent> {
  return new Promise((resolve, reject) => {
    let frames = 0;
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 20_000);
    onFrame = image => {
      if (++frames < 5) {
        // `redraw` draws at once, so wait for the browser's next frame first.
        window.requestAnimationFrame(() => deck?.redraw('settle'));
        return;
      }
      onFrame = null;
      window.clearTimeout(timeout);
      resolve(measure(image));
    };
    window.requestAnimationFrame(() => deck?.redraw('frame'));
  });
}

function createDeck(layer: unknown, zoom: number): Promise<Extent> {
  parent = document.createElement('div');
  document.body.append(parent);
  const frame = nextFrame();
  deck = new Deck({
    parent,
    width: SIZE,
    height: SIZE,
    useDevicePixels: false,
    deviceProps: {adapters: [webgl2Adapter]},
    views: new MapView({id: 'map'}),
    viewState: viewAt(zoom) as any,
    layers: [layer as any],
    onAfterRender: () => {
      const loaded = (deck as any)?.layerManager?.getLayers() || [];
      if (!onFrame || loaded.length < 2 || loaded.some((each: any) => !each.isLoaded)) {
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
      onFrame(context.getImageData(0, 0, SIZE, SIZE));
    },
    onError: error => {
      throw error;
    }
  });
  return frame;
}

function viewAt(zoom: number) {
  return {longitude: LONGITUDE, latitude: LATITUDE, zoom, pitch: 60, bearing: 0};
}

function mvtLayer(ring: number[][], height: number, maxZoom: number) {
  return new SharedMVTLayer({
    id: 'mvt',
    data: 'https://tiles.example.com/{z}/{x}/{y}.mvt',
    maxZoom,
    getTileData: (tile: any) => tileData(ring, tile.index),
    extruded: true,
    getFillColor: [255, 0, 0],
    getElevation: height
  } as any);
}

function reference(ring: number[][], height: number) {
  return new GeoJsonLayer({
    id: 'reference',
    data: [{type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [ring]}}],
    extruded: true,
    getFillColor: [255, 0, 0],
    getElevation: height
  });
}

function expectSameExtent(actual: Extent, expected: Extent) {
  const message = JSON.stringify({actual, expected});
  expect(actual.count, message).toBeGreaterThan(200);
  expect(Math.abs(actual.top - expected.top), message).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.bottom - expected.bottom), message).toBeLessThanOrEqual(1);
}

describe('SharedMVTLayer extrusions on a map', () => {
  test('rise in meters at the tile latitude below zoom 12', async () => {
    const ring = footprint(0.0064);
    const actual = await createDeck(mvtLayer(ring, 600, 11), 11);
    cleanup();
    const expected = await createDeck(reference(ring, 600), 11);
    expectSameExtent(actual, expected);
  }, 30_000);

  test('keep their height when the view zooms across zoom 12', async () => {
    const ring = footprint(0.0028);
    const layer = mvtLayer(ring, 212, 12);
    await createDeck(layer, 11.5);
    const frame = nextFrame();
    deck!.setProps({viewState: viewAt(12.5) as any});
    const actual = await frame;
    cleanup();
    const expected = await createDeck(reference(ring, 212), 12.5);
    expectSameExtent(actual, expected);
  }, 30_000);
});
