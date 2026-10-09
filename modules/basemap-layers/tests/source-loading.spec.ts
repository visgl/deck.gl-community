/* eslint-disable import/no-extraneous-dependencies */
import {afterEach, describe, expect, test, vi} from 'vitest';
import {log} from '@deck.gl/core';
import {getBasemapLayers} from '../src/index.ts';
import {resolveBasemapStyle} from '../src/style-resolver';

/** A fetch that serves TileJSON documents by URL and answers 404 for anything else. */
function fakeFetch(documents: Record<string, unknown>) {
  const requested: string[] = [];
  const fetch = (async (url: string) => {
    requested.push(url);
    const document = documents[url];
    return document
      ? {ok: true, status: 200, json: async () => document}
      : {
          ok: false,
          status: 404,
          json: async () => {
            throw new Error('not JSON');
          }
        };
  }) as unknown as typeof globalThis.fetch;
  return {fetch, requested};
}

const TILEJSON_URL = 'https://tiles.example.com/streets.json';
const TILEJSON = {tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt'], maxzoom: 14};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('source loading', () => {
  test('an image source does not fetch its url as TileJSON, and the style loads', async () => {
    const {fetch, requested} = fakeFetch({[TILEJSON_URL]: TILEJSON});
    const style = await resolveBasemapStyle(
      {
        version: 8,
        sources: {
          streets: {type: 'vector', url: TILEJSON_URL},
          overlay: {
            type: 'image',
            url: 'https://images.example.com/overlay.png',
            coordinates: [
              [0, 1],
              [1, 1],
              [1, 0],
              [0, 0]
            ]
          }
        },
        layers: []
      } as any,
      {fetch}
    );

    expect(requested).toEqual([TILEJSON_URL]);
    expect(style.sources.overlay.url).toBe('https://images.example.com/overlay.png');
    expect(style.sources.streets.tiles).toEqual(TILEJSON.tiles);
  });

  test('a TileJSON that cannot be fetched skips that source, not the style', async () => {
    const warn = vi.spyOn(log, 'warn');
    const {fetch} = fakeFetch({[TILEJSON_URL]: TILEJSON});
    const style = await resolveBasemapStyle(
      {
        version: 8,
        sources: {
          streets: {type: 'vector', url: TILEJSON_URL},
          missing: {type: 'vector', url: 'https://tiles.example.com/missing.json'}
        },
        layers: [
          {id: 'roads', type: 'line', source: 'streets', 'source-layer': 'roads'},
          {id: 'other', type: 'line', source: 'missing', 'source-layer': 'roads'}
        ]
      } as any,
      {fetch}
    );

    expect(style.sources.streets.tiles).toEqual(TILEJSON.tiles);
    expect(style.sources.missing.tiles).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Source "missing"'));

    const layers = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 5,
      styleDefinition: style
    });
    const ids = layers.map(layer => layer.id);
    expect(ids).toContain('test-streets');
    expect(ids).not.toContain('test-missing');
  });

  test('a source keeps its inline tiles when its TileJSON cannot be fetched', async () => {
    const warn = vi.spyOn(log, 'warn');
    const {fetch} = fakeFetch({});
    const inlineTiles = ['https://tiles.example.com/inline/{z}/{x}/{y}.mvt'];
    const style = await resolveBasemapStyle(
      {
        version: 8,
        sources: {
          streets: {
            type: 'vector',
            url: 'https://tiles.example.com/missing.json',
            tiles: inlineTiles
          }
        },
        layers: [{id: 'roads', type: 'line', source: 'streets', 'source-layer': 'roads'}]
      } as any,
      {fetch}
    );

    expect(style.sources.streets.tiles).toEqual(inlineTiles);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('using its inline tiles'));
    const ids = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 5,
      styleDefinition: style
    }).map(layer => layer.id);
    expect(ids).toContain('test-streets');
  });

  test('an aborted TileJSON fetch rejects the style', async () => {
    const fetch = (async () => {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      throw error;
    }) as unknown as typeof globalThis.fetch;
    await expect(
      resolveBasemapStyle(
        {
          version: 8,
          sources: {streets: {type: 'vector', url: TILEJSON_URL}},
          layers: [{id: 'roads', type: 'line', source: 'streets', 'source-layer': 'roads'}]
        } as any,
        {fetch}
      )
    ).rejects.toMatchObject({name: 'AbortError'});
  });

  test('an aborted caller signal rejects the style, with the default and a custom reason', async () => {
    for (const reason of [undefined, new Error('superseded')]) {
      const controller = new AbortController();
      const fetch = (async (_url: string, init?: RequestInit) => {
        controller.abort(reason);
        throw init?.signal?.reason ?? new Error('aborted');
      }) as unknown as typeof globalThis.fetch;
      const load = resolveBasemapStyle(
        {
          version: 8,
          sources: {streets: {type: 'vector', url: TILEJSON_URL}},
          layers: []
        } as any,
        {fetch, fetchOptions: {signal: controller.signal}}
      );
      await expect(load).rejects.toBe(controller.signal.reason);
    }
  });

  test('a timeout inside fetch, without an aborted caller signal, only skips the source', async () => {
    vi.spyOn(log, 'warn');
    const fetch = (async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    }) as unknown as typeof globalThis.fetch;
    const style = await resolveBasemapStyle(
      {version: 8, sources: {streets: {type: 'vector', url: TILEJSON_URL}}, layers: []} as any,
      {fetch}
    );
    expect(style.sources.streets.tiles).toBeUndefined();
  });

  test('a malformed TileJSON skips that source instead of failing the style', async () => {
    const warn = vi.spyOn(log, 'warn');
    const {fetch} = fakeFetch({
      'https://tiles.example.com/null-maxzoom.json': {tiles: TILEJSON.tiles, maxzoom: null},
      'https://tiles.example.com/string-tiles.json': {
        tiles: 'https://tiles.example.com/{z}/{x}/{y}.mvt'
      },
      [TILEJSON_URL]: TILEJSON
    });
    const style = await resolveBasemapStyle(
      {
        version: 8,
        sources: {
          streets: {type: 'vector', url: TILEJSON_URL},
          nullMaxzoom: {type: 'vector', url: 'https://tiles.example.com/null-maxzoom.json'},
          stringTiles: {type: 'vector', url: 'https://tiles.example.com/string-tiles.json'}
        },
        layers: []
      } as any,
      {fetch}
    );
    expect(style.sources.streets.tiles).toEqual(TILEJSON.tiles);
    expect(style.sources.nullMaxzoom.tiles).toBeUndefined();
    expect(style.sources.stringTiles.tiles).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Source "nullMaxzoom"'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Source "stringTiles"'));
  });

  test("the style's own source properties take precedence over the TileJSON", async () => {
    const {fetch} = fakeFetch({
      [TILEJSON_URL]: {tiles: TILEJSON.tiles, minzoom: 2, maxzoom: 14, attribution: 'TileJSON'}
    });
    const inlineTiles = ['https://cdn.example.com/{z}/{x}/{y}.mvt'];
    const style = await resolveBasemapStyle(
      {
        version: 8,
        sources: {streets: {type: 'vector', url: TILEJSON_URL, tiles: inlineTiles, maxzoom: 12}},
        layers: []
      } as any,
      {fetch}
    );
    expect(style.sources.streets.tiles).toEqual(inlineTiles);
    expect(style.sources.streets.maxzoom).toBe(12);
    // Fields the style leaves out still come from the TileJSON.
    expect(style.sources.streets.minzoom).toBe(2);
    expect(style.sources.streets.attribution).toBe('TileJSON');
  });

  test('TileJSON fields other than the source fields are ignored', async () => {
    const tileJson = JSON.parse(
      `{"type": "baselayer", "url": "https://elsewhere.example.com/", "name": "x", "__proto__": {"polluted": true}, "tiles": ${JSON.stringify(TILEJSON.tiles)}}`
    );
    const {fetch} = fakeFetch({[TILEJSON_URL]: tileJson});
    const style = await resolveBasemapStyle(
      {
        version: 8,
        sources: {streets: {type: 'vector', url: TILEJSON_URL}},
        layers: [{id: 'roads', type: 'line', source: 'streets', 'source-layer': 'roads'}]
      } as any,
      {fetch}
    );
    const source = style.sources.streets;
    expect(source.type).toBe('vector');
    expect(source.url).toBe(TILEJSON_URL);
    expect(source.name).toBeUndefined();
    expect(Object.getPrototypeOf(source)).toBe(Object.prototype);
    expect((source as any).polluted).toBeUndefined();
    const ids = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 5,
      styleDefinition: style
    }).map(layer => layer.id);
    expect(ids).toContain('test-streets');
  });

  test('raster-dem, image and video sources are not fetched', async () => {
    const {fetch, requested} = fakeFetch({});
    await resolveBasemapStyle(
      {
        version: 8,
        sources: {
          terrain: {type: 'raster-dem', url: 'https://tiles.example.com/terrain.json'},
          clip: {type: 'video', url: 'https://media.example.com/clip.mp4'}
        },
        layers: []
      } as any,
      {fetch}
    );
    expect(requested).toEqual([]);
  });

  test('relative inline tiles resolve against the style URL whether or not the TileJSON loads', async () => {
    const style = {
      version: 8,
      sources: {
        streets: {
          type: 'vector',
          url: 'https://b.example.com/tiles.json',
          tiles: ['tiles/{z}/{x}/{y}.mvt']
        }
      },
      layers: []
    } as any;
    const expected = ['https://a.example.com/styles/tiles/{z}/{x}/{y}.mvt'];
    const options = {baseUrl: 'https://a.example.com/styles/style.json'};

    const loaded = await resolveBasemapStyle(style, {
      ...options,
      fetch: fakeFetch({'https://b.example.com/tiles.json': {minzoom: 0}}).fetch
    });
    expect(loaded.sources.streets.tiles).toEqual(expected);

    vi.spyOn(log, 'warn');
    const failed = await resolveBasemapStyle(style, {...options, fetch: fakeFetch({}).fetch});
    expect(failed.sources.streets.tiles).toEqual(expected);
  });

  test('a raster source whose TileJSON fails skips its raster layer', async () => {
    vi.spyOn(log, 'warn');
    const style = await resolveBasemapStyle(
      {
        version: 8,
        sources: {imagery: {type: 'raster', url: 'https://tiles.example.com/imagery.json'}},
        layers: [{id: 'satellite', type: 'raster', source: 'imagery'}]
      } as any,
      {fetch: fakeFetch({}).fetch}
    );
    const ids = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 5,
      styleDefinition: style
    }).map(layer => layer.id);
    expect(ids).not.toContain('test-satellite');
  });

  test('a fetch that rejects with no error still skips only that source', async () => {
    vi.spyOn(log, 'warn');
    const fetch = (async () => Promise.reject()) as unknown as typeof globalThis.fetch;
    const style = await resolveBasemapStyle(
      {version: 8, sources: {streets: {type: 'vector', url: TILEJSON_URL}}, layers: []} as any,
      {fetch}
    );
    expect(style.sources.streets.tiles).toBeUndefined();
  });
});
