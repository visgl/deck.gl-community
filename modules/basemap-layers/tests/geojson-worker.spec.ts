// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The messages between `geojson-source.ts` and `geojson-worker.ts`, run in one Node thread: a fake
 * `Worker` hands each message, cloned as `postMessage` clones it, to the worker module's handler.
 * Node has no `Worker` global, so without the fake every tile is cut on the main thread.
 */

import {afterEach, describe, expect, test, vi} from 'vitest';

/** Polygons with a hole, enough of them to go to the worker in several batches. */
function makePolygons(count: number) {
  const features = [];
  for (let i = 0; i < count; i++) {
    const lng = -60 + (i % 100) * 1.2;
    const lat = -40 + Math.floor(i / 100) * 1.2;
    const ring = (r: number, clockwise: boolean) => {
      const points = Array.from({length: 48}, (_, v) => {
        const angle = ((clockwise ? -v : v) / 48) * 2 * Math.PI;
        return [lng + r * Math.cos(angle), lat + r * Math.sin(angle)];
      });
      return [...points, points[0]];
    };
    features.push({
      type: 'Feature',
      id: i,
      properties: {i},
      geometry: {type: 'Polygon', coordinates: [ring(0.5, false), ring(0.2, true)]}
    });
  }
  return {type: 'FeatureCollection', features};
}

/** 3,000 polygons of 98 points: about 290,000 positions, three batches. */
const DATA = makePolygons(3000);

const MIXED = {
  type: 'FeatureCollection',
  features: [
    {type: 'Feature', properties: {name: 'A'}, geometry: {type: 'Point', coordinates: [1, 2]}},
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [-90, 0],
            [90, 0]
          ],
          [
            [0, -60],
            [0, 60]
          ]
        ]
      }
    }
  ]
};

const TILES = [
  {x: 0, y: 0, z: 0},
  {x: 1, y: 1, z: 1},
  {x: 7, y: 9, z: 4}
];

type Fake = {
  url: string;
  options: unknown;
  messages: {type: string}[];
};

/**
 * Loads `geojson-source.ts` afresh with a fake `Worker`: `mode` 'run' runs the worker module in
 * this thread, 'fail' fails to load it, as a missing worker file does.
 */
async function loadWithFakeWorker(mode: 'run' | 'fail') {
  vi.resetModules();
  const fakes: Fake[] = [];
  let handleInWorker: ((event: {data: unknown}) => void) | null = null;
  let answer: (data: unknown) => void = () => {};

  if (mode === 'run') {
    vi.stubGlobal('postMessage', (message: unknown, transfer: Transferable[]) =>
      setTimeout(() => answer(structuredClone(message, {transfer})))
    );
    await import('../src/geojson-worker');
    handleInWorker = (globalThis as any).onmessage;
    (globalThis as any).onmessage = null;
  }

  class FakeWorker {
    onmessage: ((event: {data: unknown}) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    fake: Fake;
    constructor(url: URL, options: unknown) {
      this.fake = {url: String(url), options, messages: []};
      fakes.push(this.fake);
      answer = data => this.onmessage?.({data});
      if (mode === 'fail') {
        setTimeout(() => this.onerror?.(new Event('error')));
      }
    }
    postMessage(message: {type: string}) {
      this.fake.messages.push(message);
      const data = structuredClone(message);
      setTimeout(() => handleInWorker?.({data}));
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', FakeWorker);
  const module = await import('../src/geojson-source');
  return {module, fakes};
}

/** The tiles of a new source over `data`, cut on the main thread. */
async function getMainThreadTiles(data: unknown) {
  vi.resetModules();
  const {getGeoJsonTileFeatures} = await import('../src/geojson-source');
  const source = {type: 'geojson', data};
  return Promise.all(TILES.map(index => getGeoJsonTileFeatures(source, index)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GeoJSON worker', () => {
  test('tiles cut in the worker equal tiles cut on the main thread', async () => {
    const expected = await getMainThreadTiles(DATA);
    const {module, fakes} = await loadWithFakeWorker('run');
    const source = {type: 'geojson', data: DATA};
    const tiles = await Promise.all(
      TILES.map(index => module.getGeoJsonTileFeatures(source, index))
    );
    expect(tiles.map(features => features.length)).toEqual(expected.map(f => f.length));
    expect(tiles[2].length).toBeGreaterThan(0);
    expect(tiles).toEqual(expected);

    // One worker, started as a module next to the source's module, got the data in batches.
    expect(fakes).toHaveLength(1);
    expect(fakes[0].url).toMatch(/\/geojson-worker\.js$/);
    expect(fakes[0].options).toEqual({type: 'module'});
    const types = fakes[0].messages.map(message => message.type);
    expect(types.filter(type => type === 'features').length).toBe(3);
    expect(types.indexOf('index')).toBe(3);
    expect(types.slice(4)).toEqual(['tile', 'tile', 'tile']);
  });

  test('every geometry type and the source options cross to the worker', async () => {
    const sources = [
      {type: 'geojson', data: MIXED, buffer: 0},
      {type: 'geojson', data: MIXED, promoteId: 'name'},
      {type: 'geojson', data: MIXED.features[0], generateId: true},
      {type: 'geojson', data: makePolygons(50), cluster: false, tolerance: 3}
    ];
    vi.resetModules();
    const mainThread = await import('../src/geojson-source');
    const expected = await Promise.all(
      sources.map(source => mainThread.getGeoJsonTileFeatures({...source}, TILES[1]))
    );
    const {module} = await loadWithFakeWorker('run');
    const tiles = await Promise.all(
      sources.map(source => module.getGeoJsonTileFeatures({...source}, TILES[1]))
    );
    expect(tiles).toEqual(expected);
    expect(tiles[1].some((f: any) => f.id === 'A')).toBe(true);
    expect(tiles[0].some((f: any) => f.geometry.type === 'MultiLineString')).toBe(true);
  });

  test('a clustered source clusters in the worker', async () => {
    const points = Array.from({length: 10}, (_, i) => ({
      type: 'Feature',
      properties: {i},
      geometry: {type: 'Point', coordinates: [i * 0.001, 0]}
    }));
    const {module} = await loadWithFakeWorker('run');
    const features = (await module.getGeoJsonTileFeatures(
      {type: 'geojson', data: {type: 'FeatureCollection', features: points}, cluster: true},
      {x: 0, y: 0, z: 0}
    )) as any[];
    expect(features).toHaveLength(1);
    expect(features[0].properties).toMatchObject({cluster: true, point_count: 10});
  });

  test('invalid data rejects each tile request, as on the main thread', async () => {
    // geojson-vt accepts most malformed GeoJSON, but not a feature that is `null`.
    const source = {type: 'geojson', data: {type: 'FeatureCollection', features: [null]}};
    vi.resetModules();
    const mainThread = await import('../src/geojson-source');
    await expect(mainThread.getGeoJsonTileFeatures(source, TILES[0])).rejects.toThrow();
    const {module} = await loadWithFakeWorker('run');
    await expect(module.getGeoJsonTileFeatures(source, TILES[0])).rejects.toThrow();
    await expect(module.getGeoJsonTileFeatures(source, TILES[1])).rejects.toThrow();
  });

  test('a worker that fails to load is replaced by the main thread', async () => {
    const expected = await getMainThreadTiles(DATA);
    const {module, fakes} = await loadWithFakeWorker('fail');
    const source = {type: 'geojson', data: DATA};
    const tiles = await Promise.all(
      TILES.map(index => module.getGeoJsonTileFeatures(source, index))
    );
    expect(tiles).toEqual(expected);
    // Later sources do not try the failed worker again.
    const later = await module.getGeoJsonTileFeatures({type: 'geojson', data: DATA}, TILES[0]);
    expect(later).toEqual(expected[0]);
    expect(fakes).toHaveLength(1);
  });

  test('without a Worker global, tiles are cut on the main thread', async () => {
    vi.resetModules();
    expect(typeof (globalThis as any).Worker).toBe('undefined');
    const {getGeoJsonTileFeatures} = await import('../src/geojson-source');
    const features = await getGeoJsonTileFeatures({type: 'geojson', data: MIXED}, TILES[0]);
    expect(features.length).toBeGreaterThan(0);
  });
});
