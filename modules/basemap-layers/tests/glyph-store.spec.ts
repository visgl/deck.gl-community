/* eslint-disable import/no-extraneous-dependencies */
import {readFileSync} from 'node:fs';
import {afterEach, describe, expect, test, vi} from 'vitest';
import {GlyphStore, isLocalGlyph, MAX_GLYPH_STACKS} from '../src/glyph-store.ts';

const FONTS = new URL('./reference-render/fixtures/tiles.openfreemap.org/fonts/', import.meta.url);

/** A fetch serving the recorded glyph ranges, which records the URLs it is asked for. */
function fixtureFetch() {
  const urls: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    urls.push(url);
    const match = /fonts\/([^/]+)\/(\d+-\d+)\.pbf$/.exec(url);
    try {
      const data = readFileSync(
        new URL(`${decodeURIComponent(match![1])}/${match![2]}.pbf`, FONTS)
      );
      return new Response(data);
    } catch {
      return new Response(null, {status: 404});
    }
  });
  return {fetch: fetch as unknown as typeof globalThis.fetch, urls};
}

const URL_TEMPLATE = 'https://tiles.example.com/fonts/{fontstack}/{range}.pbf';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GlyphStore', () => {
  test('loads the ranges of a text once, and then holds its glyphs', async () => {
    const {fetch, urls} = fixtureFetch();
    const store = new GlyphStore({url: URL_TEMPLATE, fetch});
    expect(store.hasGlyphs('Noto Sans Regular', 'Paris')).toBe(false);
    expect(store.getGlyph('Noto Sans Regular', 80)).toBeUndefined();

    const loading = store.load('Noto Sans Regular', ['Paris', 'Île']);
    // Asked again while loading, no range is requested twice.
    store.load('Noto Sans Regular', ['Paris']);
    await loading;

    expect(urls).toEqual(['https://tiles.example.com/fonts/Noto%20Sans%20Regular/0-255.pbf']);
    expect(store.hasGlyphs('Noto Sans Regular', 'Paris Île')).toBe(true);
    expect(store.getGlyph('Noto Sans Regular', 80)?.advance).toBeGreaterThan(0);
    expect(store.load('Noto Sans Regular', ['Paris'])).toBeNull();
  });

  test('keeps a range that fails to load, empty, as MapLibre GL JS leaves its characters out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const {fetch, urls} = fixtureFetch();
    const store = new GlyphStore({url: URL_TEMPLATE, fetch});
    // No recorded range holds U+3000-U+30FF's neighbour U+2E00.
    await store.load('Noto Sans Regular', ['⸀']);
    expect(urls).toHaveLength(1);
    expect(store.hasGlyphs('Noto Sans Regular', '⸀')).toBe(true);
    expect(store.getGlyph('Noto Sans Regular', 0x2e00)).toBeNull();
  });

  test('does not request the characters MapLibre GL JS draws with the browser fonts', () => {
    const {fetch, urls} = fixtureFetch();
    const store = new GlyphStore({url: URL_TEMPLATE, fetch});
    expect(isLocalGlyph('東'.codePointAt(0)!)).toBe(true);
    expect(isLocalGlyph('ア'.codePointAt(0)!)).toBe(true);
    expect(isLocalGlyph('한'.codePointAt(0)!)).toBe(true);
    expect(isLocalGlyph('A'.codePointAt(0)!)).toBe(false);
    expect(store.load('Noto Sans Regular', ['東京', 'アキバ'])).toBeNull();
    expect(store.hasGlyphs('Noto Sans Regular', '東京')).toBe(true);
    expect(urls).toEqual([]);
  });

  test('forms range URLs from the template, and resolves a relative URL against the style', () => {
    const store = new GlyphStore({
      url: 'fonts/{fontstack}/{range}.pbf?key=1',
      baseUrl: 'https://maps.example.com/styles/liberty/style.json'
    });
    expect(store.getRangeUrl('Noto Sans Bold,Noto Sans Regular', 1)).toBe(
      'https://maps.example.com/styles/liberty/fonts/Noto%20Sans%20Bold,Noto%20Sans%20Regular/256-511.pbf?key=1'
    );
  });

  test('encodes font names, so tile data cannot change the rest of the URL', () => {
    const store = new GlyphStore({url: URL_TEMPLATE});
    expect(store.getRangeUrl('../../admin?x=1#{range}', 0)).toBe(
      'https://tiles.example.com/fonts/..%2F..%2Fadmin%3Fx%3D1%23%7Brange%7D/0-255.pbf'
    );
    expect(store.getRangeUrl('..', 0)).toBe('https://tiles.example.com/fonts/%2E%2E/0-255.pbf');
  });

  test(`keeps the glyphs of at most ${MAX_GLYPH_STACKS} font stacks`, async () => {
    const {fetch, urls} = fixtureFetch();
    const store = new GlyphStore({url: URL_TEMPLATE, fetch});
    await store.load('Noto Sans Regular', ['a']);
    for (let i = 0; i < MAX_GLYPH_STACKS; i++) {
      store.load(`Stack ${i}`, []);
    }
    expect(store.hasGlyphs('Noto Sans Regular', 'a')).toBe(false);
    await store.load('Noto Sans Regular', ['a']);
    expect(urls.filter(url => url.includes('Noto%20Sans%20Regular'))).toHaveLength(2);
  });
});
