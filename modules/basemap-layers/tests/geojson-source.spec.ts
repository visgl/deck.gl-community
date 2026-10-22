/* eslint-disable import/no-extraneous-dependencies */
import {afterEach, describe, expect, test, vi} from 'vitest';
import {log} from '@deck.gl/core';
import {getBasemapLayers} from '../src/index.ts';
import {getGeoJsonTileFeatures, getGeoJsonVtOptions, isGeoJsonSource} from '../src/geojson-source';
import {getStyleLayerRuns, getTilePyramidProps} from '../src/globe-layers';
import {resolveBasemapStyle} from '../src/style-resolver';

/** A fetch that serves JSON documents by URL and answers 404 for anything else. */
function fakeFetch(documents: Record<string, unknown>) {
  const requests: {url: string; init?: RequestInit}[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    requests.push({url, init});
    const document = documents[url];
    return document
      ? {ok: true, status: 200, json: async () => document}
      : {ok: false, status: 404, json: async () => ({})};
  }) as unknown as typeof globalThis.fetch;
  return {fetch, requests};
}

const POINT = {
  type: 'Feature',
  properties: {name: 'A'},
  geometry: {type: 'Point', coordinates: [0, 0]}
};

/** A square with a hole, and a second square: two polygons in one `MultiPolygon`. */
const MULTIPOLYGON = {
  type: 'Feature',
  properties: {kind: 'park'},
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [-40, -40],
          [40, -40],
          [40, 40],
          [-40, 40],
          [-40, -40]
        ],
        [
          [-10, -10],
          [-10, 10],
          [10, 10],
          [10, -10],
          [-10, -10]
        ]
      ],
      [
        [
          [100, 10],
          [120, 10],
          [120, 30],
          [100, 30],
          [100, 10]
        ]
      ]
    ]
  }
};

const LINE = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: [
      [-90, 0],
      [90, 0]
    ]
  }
};

const DATA = {type: 'FeatureCollection', features: [POINT, MULTIPOLYGON, LINE]};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GeoJSON source resolution', () => {
  test('inline data is kept as it is, without fetching', async () => {
    const {fetch, requests} = fakeFetch({});
    const style = await resolveBasemapStyle(
      {version: 8, sources: {shapes: {type: 'geojson', data: DATA}}, layers: []},
      {fetch}
    );
    expect(requests).toEqual([]);
    expect(style.sources.shapes.data).toEqual(DATA);
    expect(isGeoJsonSource(style.sources.shapes)).toBe(true);
  });

  test('a data URL is fetched against the style URL, with the fetch options', async () => {
    const styleUrl = 'https://maps.example.com/styles/style.json';
    const dataUrl = 'https://maps.example.com/data/shapes.geojson';
    const {fetch, requests} = fakeFetch({
      [styleUrl]: {
        version: 8,
        sources: {shapes: {type: 'geojson', data: '../data/shapes.geojson'}},
        layers: []
      },
      [dataUrl]: DATA
    });
    const fetchOptions = {headers: {Authorization: 'token'}};
    const style = await resolveBasemapStyle(styleUrl, {fetch, fetchOptions});
    expect(requests.map(request => request.url)).toEqual([styleUrl, dataUrl]);
    expect(requests[1].init).toBe(fetchOptions);
    expect(style.sources.shapes.data).toEqual(DATA);
  });

  test('data that cannot be loaded warns, and the layers of the source are skipped', async () => {
    const warn = vi.spyOn(log, 'warn').mockReturnValue(() => {});
    const {fetch} = fakeFetch({});
    const style = await resolveBasemapStyle(
      {
        version: 8,
        sources: {shapes: {type: 'geojson', data: 'https://example.com/missing.geojson'}},
        layers: [{id: 'fill', type: 'fill', source: 'shapes'}]
      },
      {fetch}
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain('"shapes" could not be loaded');
    expect(style.sources.shapes.data).toBeUndefined();
    expect(getStyleLayerRuns(style.layers, style)).toEqual([]);
  });
});

describe('GeoJSON source tiling', () => {
  test('geojson-vt options follow MapLibre GL JS: pixels of a 512 pixel tile, extent 8192', () => {
    expect(getGeoJsonVtOptions({type: 'geojson', data: DATA})).toMatchObject({
      maxZoom: 18,
      extent: 8192,
      buffer: 128 * 16,
      tolerance: 0.375 * 16,
      generateId: false,
      promoteId: undefined
    });
    expect(
      getGeoJsonVtOptions({
        type: 'geojson',
        data: DATA,
        maxzoom: 12,
        buffer: 0,
        tolerance: 1,
        promoteId: 'name'
      })
    ).toMatchObject({maxZoom: 12, buffer: 0, tolerance: 16, promoteId: 'name'});
  });

  test('the tile pyramid of a GeoJSON source ends at its maxzoom, 18 by default', () => {
    expect(getTilePyramidProps({type: 'geojson', data: DATA}).maxZoom).toBe(18);
    expect(getTilePyramidProps({type: 'geojson', data: DATA, maxzoom: 9}).maxZoom).toBe(9);
  });

  test('tiles hold GeoJSON features in tile-local coordinates, as decoded vector tiles', async () => {
    // Without a buffer, the zoom 0 tile holds no copies of features wrapped across the antimeridian.
    const source = {type: 'geojson', data: DATA, buffer: 0};
    const features = await getGeoJsonTileFeatures(source, {x: 0, y: 0, z: 0});
    const byType = Object.fromEntries(features.map((f: any) => [f.geometry.type, f]));
    expect(Object.keys(byType).sort()).toEqual(['LineString', 'MultiPolygon', 'Point']);

    // (0, 0) is the middle of the zoom 0 tile.
    expect(byType.Point.geometry.coordinates).toEqual([0.5, 0.5]);
    expect(byType.Point.properties).toEqual({name: 'A'});

    // Rings wound against the outer ring are holes of the polygon before them.
    const polygons = byType.MultiPolygon.geometry.coordinates;
    expect(polygons.map((polygon: unknown[]) => polygon.length)).toEqual([2, 1]);
    const [x, y] = polygons[0][0][0];
    expect(Math.abs(x - 0.5)).toBeCloseTo((40 / 360) * 1, 2);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(1);

    const line = byType.LineString.geometry.coordinates;
    expect(line[0][0]).toBeCloseTo(0.25, 3);
    expect(line[line.length - 1][0]).toBeCloseTo(0.75, 3);
  });

  test('the buffer holds the copies of features wrapped across the antimeridian', async () => {
    const features = await getGeoJsonTileFeatures(
      {type: 'geojson', data: DATA},
      {x: 0, y: 0, z: 0}
    );
    // The second square, at longitudes 100 to 120, also draws at -260 to -240, in the buffer.
    const polygons = features.filter((f: any) => f.geometry.type === 'Polygon') as any[];
    expect(polygons).toHaveLength(1);
    const xs = polygons[0].geometry.coordinates[0].map(([x]: number[]) => x);
    expect(Math.max(...xs)).toBeLessThan(0);
  });

  test('a tile far from the data is empty, and deeper tiles clip to their buffer', async () => {
    const source = {type: 'geojson', data: DATA};
    // Zoom 2, tile (0, 0) covers longitudes -180 to -90 north of 66.5°: nothing there.
    expect(await getGeoJsonTileFeatures(source, {x: 0, y: 0, z: 2})).toEqual([]);
    // Zoom 1, tile (1, 1) holds the south-east quadrant: the point at its corner, and parts of
    // the square, the line and the second square (north of the equator, within the buffer).
    const features = await getGeoJsonTileFeatures(source, {x: 1, y: 1, z: 1});
    for (const feature of features as any[]) {
      const flat = JSON.stringify(feature.geometry.coordinates)
        .match(/-?[\d.e-]+/g)!
        .map(Number);
      expect(Math.min(...flat)).toBeGreaterThanOrEqual(-0.25 - 1e-9);
      expect(Math.max(...flat)).toBeLessThanOrEqual(1.25 + 1e-9);
    }
  });

  test('promoteId and generateId set feature ids', async () => {
    const promoted = (await getGeoJsonTileFeatures(
      {type: 'geojson', data: DATA, buffer: 0, promoteId: 'name'},
      {x: 0, y: 0, z: 0}
    )) as any[];
    expect(promoted.find(f => f.geometry.type === 'Point').id).toBe('A');
    const generated = (await getGeoJsonTileFeatures(
      {type: 'geojson', data: DATA, buffer: 0, generateId: true},
      {x: 0, y: 0, z: 0}
    )) as any[];
    expect(generated.map(f => f.id).sort()).toEqual([0, 1, 2]);
  });

  test('a clustered source draws clusters with point_count', async () => {
    const points = Array.from({length: 10}, (_, i) => ({
      type: 'Feature',
      properties: {i},
      geometry: {type: 'Point', coordinates: [i * 0.001, 0]}
    }));
    const features = (await getGeoJsonTileFeatures(
      {type: 'geojson', data: {type: 'FeatureCollection', features: points}, cluster: true},
      {x: 0, y: 0, z: 0}
    )) as any[];
    expect(features).toHaveLength(1);
    expect(features[0].properties).toMatchObject({cluster: true, point_count: 10});
  });
});

describe('GeoJSON style layers', () => {
  const STYLE: any = {
    version: 8,
    sources: {
      shapes: {type: 'geojson', data: DATA, buffer: 0},
      pending: {type: 'geojson', data: 'https://example.com/unresolved.geojson'}
    },
    layers: [
      {id: 'fill', type: 'fill', source: 'shapes'},
      {id: 'line', type: 'line', source: 'shapes'},
      {id: 'circle', type: 'circle', source: 'shapes'},
      {id: 'label', type: 'symbol', source: 'shapes', layout: {'text-field': '{name}'}},
      {id: 'unresolved', type: 'fill', source: 'pending'}
    ]
  };

  test('draw in one run of the source, like a vector source; unresolved data draws nothing', () => {
    const runs = getStyleLayerRuns(STYLE.layers, STYLE);
    expect(runs.map(run => [run.id, run.type, run.styleLayers.map(layer => layer.id)])).toEqual([
      ['shapes', 'vector', ['fill', 'line', 'circle', 'label']]
    ]);
  });

  test('draw on a globe from the same run', () => {
    const layers = getBasemapLayers({
      idPrefix: 'test',
      mode: 'globe',
      zoom: 2,
      styleDefinition: STYLE
    }).flat(Infinity as 1) as any[];
    expect(layers.map(layer => layer?.id)).toContain('test-shapes');
  });

  test('a run draws from a tileset whose tiles are cut from the data', async () => {
    const [layer] = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 2,
      styleDefinition: STYLE
    });
    expect(layer.id).toBe('test-shapes');
    const tileset = (layer.props as any).data;
    expect(tileset.opts.getTileData).toBeTypeOf('function');
    const content = await tileset.opts.getTileData({
      index: {x: 0, y: 0, z: 0}
    });
    expect(content.map((feature: any) => feature.geometry.type).sort()).toEqual([
      'LineString',
      'MultiPolygon',
      'Point'
    ]);
  });

  test('bounds the zooms a style can make it index', () => {
    const options = getGeoJsonVtOptions({
      type: 'geojson',
      data: {type: 'FeatureCollection', features: []},
      maxzoom: 1e9,
      cluster: true,
      clusterMaxZoom: 1e9
    } as any);
    expect(options.maxZoom).toBeLessThanOrEqual(24);
    expect(options.clusterOptions?.maxZoom).toBe(options.maxZoom);
    const negative = getGeoJsonVtOptions({
      type: 'geojson',
      data: {type: 'FeatureCollection', features: []},
      maxzoom: -3,
      cluster: true,
      clusterMaxZoom: -3
    } as any);
    expect(negative.maxZoom).toBe(0);
    expect(negative.clusterOptions?.maxZoom).toBe(0);
  });
});
