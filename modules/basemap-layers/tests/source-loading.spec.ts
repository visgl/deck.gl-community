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
});
