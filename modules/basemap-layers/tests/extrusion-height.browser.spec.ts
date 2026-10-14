// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, _GlobeView as GlobeView} from '@deck.gl/core';
import {GeoJsonLayer} from '@deck.gl/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {lngLatToWorld} from '@math.gl/web-mercator';
import {afterEach, describe, expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';

const SIZE = 256;
const LONGITUDE = 0.01;

type ViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
};
type Extent = {top: number; bottom: number; count: number};

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

function cleanup() {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
}

afterEach(cleanup);

/** A square footprint around the view center, sized to look the same at every zoom. */
function footprint(latitude: number, zoom: number): number[][] {
  const half = 0.0004 * 2 ** (15 - zoom);
  const halfLatitude = half * Math.cos((latitude * Math.PI) / 180);
  return [
    [LONGITUDE - half, latitude - halfLatitude],
    [LONGITUDE + half, latitude - halfLatitude],
    [LONGITUDE + half, latitude + halfLatitude],
    [LONGITUDE - half, latitude + halfLatitude],
    [LONGITUDE - half, latitude - halfLatitude]
  ];
}

/** A height in meters that rises the same number of pixels at the equator at every zoom. */
function heightAt(zoom: number): number {
  return 600 * 2 ** (11 - zoom);
}

/** A basemap whose source holds `ring` as a building, decoded in tile-local coordinates. */
function basemap(ring: number[][], height: number, mode: 'map' | 'globe', maxzoom: number) {
  const fetch = async (url: string) => {
    const [z, x, y] = url
      .match(/(\d+)\/(\d+)\/(\d+)\.mvt/)!
      .slice(1)
      .map(Number);
    const scale = 2 ** z;
    const local = ring.map(position => {
      const [worldX, worldY] = lngLatToWorld(position as [number, number]);
      return [(worldX / 512) * scale - x, (1 - worldY / 512) * scale - y];
    });
    const inside = local.every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1);
    return inside
      ? [
          {
            type: 'Feature',
            properties: {layerName: 'building'},
            geometry: {type: 'Polygon', coordinates: [local]}
          }
        ]
      : [];
  };
  return new BasemapLayer({
    id: 'basemap',
    mode,
    fetch,
    style: {
      version: 8,
      sources: {
        tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt'], maxzoom}
      },
      layers: [
        {id: 'background', type: 'background', paint: {'background-color': '#ffffff'}},
        {
          id: 'building-3d',
          type: 'fill-extrusion',
          source: 'tiles',
          'source-layer': 'building',
          paint: {'fill-extrusion-color': '#ff0000', 'fill-extrusion-height': height}
        }
      ]
    } as any
  });
}

/** The same building from a stock GeoJsonLayer in longitude/latitude, which MapLibre matches. */
function reference(ring: number[][], height: number) {
  return new GeoJsonLayer({
    id: 'reference',
    data: [{type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [ring]}}],
    extruded: true,
    getFillColor: [255, 0, 0],
    getElevation: height
  });
}

/** The first and last rows holding building pixels, and how many there are. */
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

let onFrame: ((image: ImageData) => void) | null = null;

/** Resolves with a frame drawn a few frames after every sublayer has loaded. */
function nextFrame(): Promise<Extent> {
  return new Promise((resolve, reject) => {
    let frames = 0;
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 20_000);
    onFrame = image => {
      // Tile content can arrive a frame after the tileset reports it loaded.
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

function createDeck(layers: unknown[], view: unknown, viewState: ViewState): Promise<Extent> {
  parent = document.createElement('div');
  document.body.append(parent);
  const frame = nextFrame();
  deck = new Deck({
    parent,
    width: SIZE,
    height: SIZE,
    useDevicePixels: false,
    deviceProps: {adapters: [webgl2Adapter]},
    views: view as any,
    viewState: viewState as any,
    layers: layers as any,
    onAfterRender: () => {
      const loaded = (deck as any)?.layerManager?.getLayers() || [];
      // A basemap draws no sublayers until its style resolves.
      if (!onFrame || loaded.length < 2 || loaded.some((layer: any) => !layer.isLoaded)) {
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

function viewAt(latitude: number, zoom: number, pitch = 60): ViewState {
  return {longitude: LONGITUDE, latitude, zoom, pitch, bearing: 0};
}

function renderReference(view: unknown, viewState: ViewState, ring: number[][], height: number) {
  cleanup();
  return createDeck([reference(ring, height)], view, viewState);
}

function expectSameExtent(actual: Extent, expected: Extent) {
  const message = JSON.stringify({actual, expected});
  expect(actual.count, message).toBeGreaterThan(200);
  expect(Math.abs(actual.top - expected.top), message).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.bottom - expected.bottom), message).toBeLessThanOrEqual(1);
}

describe('fill-extrusion heights on a map', () => {
  // Below zoom 12 deck.gl projects Web Mercator without an offset origin; from zoom 12, with one.
  for (const [latitude, zoom] of [
    [0.05, 11],
    [60, 11],
    [45, 13],
    [60, 15]
  ]) {
    test(`a building at latitude ${latitude}, zoom ${zoom} rises as in longitude/latitude`, async () => {
      const ring = footprint(latitude, zoom);
      const height = heightAt(zoom);
      const view = new MapView({id: 'map'});
      const viewState = viewAt(latitude, zoom);
      const actual = await createDeck([basemap(ring, height, 'map', zoom)], view, viewState);
      const expected = await renderReference(view, viewState, ring, height);
      expectSameExtent(actual, expected);
    }, 30_000);
  }
});

describe('fill-extrusion heights on a globe', () => {
  // Above zoom 12 `GlobeView` draws with a Web Mercator viewport, so this stays below it.
  test('a building at latitude 60 rises as in longitude/latitude', async () => {
    const ring = footprint(60, 11);
    const height = heightAt(11);
    const view = new GlobeView({id: 'globe'});
    const viewState = viewAt(60, 11, 20);
    const actual = await createDeck([basemap(ring, height, 'globe', 11)], view, viewState);
    const expected = await renderReference(view, viewState, ring, height);
    expectSameExtent(actual, expected);
  }, 30_000);
});
