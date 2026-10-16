// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, _GlobeView as GlobeView} from '@deck.gl/core';
import {GeoJsonLayer} from '@deck.gl/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {lngLatToWorld} from '@math.gl/web-mercator';
import {afterEach, describe, expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';

// Above zoom 12 `GlobeView` draws with a Web Mercator viewport.

const SIZE = 256;
const LONGITUDE = 0.01;
const LATITUDE = 60;

type Extent = {top: number; bottom: number; count: number};
type ViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

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

/** A square footprint around the view center, sized to look the same at every zoom. */
function footprint(zoom: number): number[][] {
  const half = 0.0004 * 2 ** (15 - zoom);
  const halfLatitude = half * Math.cos((LATITUDE * Math.PI) / 180);
  return [
    [LONGITUDE - half, LATITUDE - halfLatitude],
    [LONGITUDE + half, LATITUDE - halfLatitude],
    [LONGITUDE + half, LATITUDE + halfLatitude],
    [LONGITUDE - half, LATITUDE + halfLatitude],
    [LONGITUDE - half, LATITUDE - halfLatitude]
  ];
}

/** A globe basemap with a white background and one red style layer holding `ring`. */
function basemap(
  ring: number[][],
  styleLayer: Record<string, unknown>,
  maxzoom: number,
  fetched: string[] = []
) {
  const fetch = async (url: string) => {
    fetched.push(url);
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
    mode: 'globe',
    fetch,
    style: {
      version: 8,
      sources: {
        tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt'], maxzoom}
      },
      layers: [
        {id: 'background', type: 'background', paint: {'background-color': '#ffffff'}},
        {id: 'building', source: 'tiles', 'source-layer': 'building', ...styleLayer}
      ]
    } as any
  });
}

const FILL = {type: 'fill', paint: {'fill-color': '#ff0000'}};
const EXTRUSION = {
  type: 'fill-extrusion',
  paint: {'fill-extrusion-color': '#ff0000', 'fill-extrusion-height': 40}
};

/** The same polygon from a stock GeoJsonLayer in longitude/latitude. */
function reference(ring: number[][], extruded: boolean) {
  return new GeoJsonLayer({
    id: 'reference',
    data: [{type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [ring]}}],
    extruded,
    getFillColor: [255, 0, 0],
    getElevation: 40
  });
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

/** Resolves with a frame drawn a few frames after every sublayer has loaded. */
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

function createDeck(layers: unknown[], viewState: ViewState): Promise<Extent> {
  parent = document.createElement('div');
  document.body.append(parent);
  const frame = nextFrame();
  deck = new Deck({
    parent,
    width: SIZE,
    height: SIZE,
    useDevicePixels: false,
    deviceProps: {adapters: [webgl2Adapter]},
    views: new GlobeView({id: 'globe'}),
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

function viewAt(zoom: number, pitch: number): ViewState {
  return {longitude: LONGITUDE, latitude: LATITUDE, zoom, pitch, bearing: 0};
}

async function renderReference(ring: number[][], extruded: boolean, viewState: ViewState) {
  cleanup();
  return createDeck([reference(ring, extruded)], viewState);
}

function expectSameExtent(actual: Extent, expected: Extent) {
  const message = JSON.stringify({actual, expected});
  expect(actual.count, message).toBeGreaterThan(200);
  expect(Math.abs(actual.top - expected.top), message).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.bottom - expected.bottom), message).toBeLessThanOrEqual(1);
}

describe('a globe basemap above zoom 12', () => {
  test('draws a fill', async () => {
    const ring = footprint(15);
    const viewState = viewAt(15, 0);
    const actual = await createDeck([basemap(ring, FILL, 15)], viewState);
    const expected = await renderReference(ring, false, viewState);
    expectSameExtent(actual, expected);
  }, 30_000);

  test('draws a fill-extrusion under pitch, in front of the background', async () => {
    const ring = footprint(15);
    const viewState = viewAt(15, 60);
    const actual = await createDeck([basemap(ring, EXTRUSION, 15)], viewState);
    const expected = await renderReference(ring, true, viewState);
    expectSameExtent(actual, expected);
  }, 30_000);

  for (const [name, styleLayer, pitch] of [
    ['a fill', FILL, 0],
    ['a fill-extrusion', EXTRUSION, 40]
  ] as const) {
    test(`draws ${name} across zoom 12 and back, reusing the shared tiles`, async () => {
      const ring = footprint(12.1);
      const extruded = styleLayer === EXTRUSION;
      const atGlobe = viewAt(12, pitch);
      const atMap = viewAt(12.1, pitch);
      const expectedGlobe = await renderReference(ring, extruded, atGlobe);
      const expectedMap = await renderReference(ring, extruded, atMap);
      cleanup();

      const fetched: string[] = [];
      const globe = await createDeck([basemap(ring, styleLayer, 12, fetched)], atGlobe);
      const layer = () =>
        (deck as any).layerManager.getLayers().find((each: any) => each.id === 'basemap');
      const drawn = () =>
        (deck as any).layerManager
          .getLayers()
          .filter((each: any) => each.id.endsWith('"building"'))
          .map((each: any) => each.props.parameters.cullMode);
      const hasPole = () =>
        (deck as any).layerManager
          .getLayers()
          .some((each: any) => each.id === 'basemap-background-north-pole');
      const [tileset] = layer().state.tilesets.values();
      const tiles = new Map(tileset.tiles.map((tile: any) => [tile, tile.content]));
      const fetchCount = fetched.length;
      expect(tiles.size).toBeGreaterThan(0);
      expect(hasPole()).toBe(true);
      expect(drawn()).toEqual([extruded ? 'none' : 'back']);
      // The basemap rebuilds its sublayers for each mode, but keeps the shared tiles and content.
      const expectSharedTiles = () => {
        expect([...layer().state.tilesets.values()][0]).toBe(tileset);
        for (const [tile, content] of tiles) {
          expect(tileset.tiles).toContain(tile);
          expect(tile.content).toBe(content);
        }
        expect(fetched.length - fetchCount).toBe(0);
      };

      const toMap = nextFrame();
      deck!.setProps({viewState: atMap as any});
      const map = await toMap;
      expectSharedTiles();
      expect(hasPole()).toBe(false);
      expect(drawn()).toEqual(['none']);

      const back = nextFrame();
      deck!.setProps({viewState: atGlobe as any});
      const globeAgain = await back;
      expectSharedTiles();
      expect(hasPole()).toBe(true);
      expect(drawn()).toEqual([extruded ? 'none' : 'back']);

      expectSameExtent(globe, expectedGlobe);
      expectSameExtent(map, expectedMap);
      expectSameExtent(globeAgain, expectedGlobe);
    }, 60_000);
  }
});
