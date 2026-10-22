// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * A large GeoJSON source is indexed in a worker, so the main thread stays free while it is: no
 * long task (50 ms or more, as the browser reports them) runs between the first tile requests and
 * their answers. The control then tiles the same data on the main thread and must see one, so that
 * the measurement can fail. The worker case runs first, before the control's main-thread index
 * leaves garbage whose collection could pause the main thread.
 */

import {afterEach, describe, expect, test} from 'vitest';
import {getGeoJsonTileFeatures, setGeoJsonWorkerEnabled} from '../src/geojson-source';

/** Polygons of `vertices` points each, scattered over Europe from a fixed seed. */
function makePolygons(count: number, vertices: number) {
  let seed = 1;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const features = new Array(count);
  for (let i = 0; i < count; i++) {
    const lng = -10 + random() * 40;
    const lat = 35 + random() * 25;
    const radius = 0.02 + random() * 0.08;
    const ring: number[][] = [];
    for (let v = 0; v < vertices; v++) {
      const angle = (v / vertices) * 2 * Math.PI;
      const r = radius * (0.7 + 0.3 * random());
      ring.push([lng + r * Math.cos(angle), lat + r * Math.sin(angle)]);
    }
    ring.push(ring[0]);
    features[i] = {
      type: 'Feature',
      properties: {id: i, name: `polygon ${i}`},
      geometry: {type: 'Polygon', coordinates: [ring]}
    };
  }
  return {type: 'FeatureCollection', features};
}

/** 24,000 polygons of 48 points: about 50 MB as GeoJSON text. */
const DATA = makePolygons(24_000, 48);

/** Tiles over Europe, at zoom 3, and at zoom 5 and 9, which the index cuts down to. */
const TILES = [
  {x: 4, y: 2, z: 3},
  {x: 16, y: 10, z: 5},
  {x: 266, y: 175, z: 9}
];

/** The long tasks, in ms, that run while `run` resolves. */
async function measureLongTasks(run: () => Promise<unknown>): Promise<number[]> {
  const durations: number[] = [];
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      durations.push(entry.duration);
    }
  });
  observer.observe({type: 'longtask', buffered: false});
  await run();
  // Entries arrive after their task; give the observer a turn before reading them.
  await new Promise(resolve => setTimeout(resolve, 100));
  for (const entry of observer.takeRecords()) {
    durations.push(entry.duration);
  }
  observer.disconnect();
  return durations.map(Math.round);
}

/** Requests the tiles of a new source over `DATA`, as the tile layer does, all at once. */
async function requestTiles() {
  const source = {type: 'geojson', data: DATA};
  const tiles = await Promise.all(TILES.map(index => getGeoJsonTileFeatures(source, index)));
  return tiles.map(features => features.length);
}

describe('GeoJSON sources are tiled in a worker', () => {
  afterEach(() => setGeoJsonWorkerEnabled(true));

  test('indexing it in a worker blocks the main thread only briefly', async () => {
    let counts: number[] = [];
    const longTasks = await measureLongTasks(async () => {
      counts = await requestTiles();
    });
    expect(counts.every(count => count > 0)).toBe(true);
    // None on an M-series Mac; CI runners show tasks of 50 to 100 ms posting the batches. Tiling on
    // the main thread blocks for 400 ms or more, and sending the data unbatched for about 300 ms.
    expect(Math.max(0, ...longTasks)).toBeLessThan(150);
  });

  test('control: tiling it on the main thread runs a long task', async () => {
    setGeoJsonWorkerEnabled(false);
    let counts: number[] = [];
    const longTasks = await measureLongTasks(async () => {
      counts = await requestTiles();
    });
    expect(counts.every(count => count > 0)).toBe(true);
    // About 570 ms on an M-series Mac; slower machines block longer.
    expect(Math.max(0, ...longTasks)).toBeGreaterThan(200);
  });

  // Last, so that the garbage of the 50 MB string cannot be collected during a measurement.
  test('the data is about 50 MB as GeoJSON', () => {
    const megabytes = JSON.stringify(DATA).length / 1e6;
    expect(megabytes).toBeGreaterThan(45);
    expect(megabytes).toBeLessThan(60);
  });
});
