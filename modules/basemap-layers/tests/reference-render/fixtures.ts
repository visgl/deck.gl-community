// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {commands} from 'vitest/browser';
import {REFERENCE_STYLES, type ReferenceStyleId} from './scenes';

/**
 * Recorded network fixtures. Every style, TileJSON, tile, sprite and glyph range a scene needs is
 * stored under this directory (relative to the repository root) at `<host>/<path>`, and served by
 * the test server from the same origin as the test page. No request leaves that origin. Those of
 * the default scenes are committed, trimmed by `trim-fixtures.mjs`.
 *
 * The tiles hold OpenStreetMap data (© OpenStreetMap contributors, ODbL) in the OpenMapTiles
 * schema, from OpenFreeMap and CARTO, and Natural Earth relief (public domain). The styles are
 * OpenFreeMap's and CARTO's Positron (CC BY 4.0); the glyphs are Noto Sans and Montserrat (OFL).
 *
 * The four DEM tiles under `s3.amazonaws.com/elevation-tiles-prod/terrarium/11/` (Mount Rainier,
 * for `hillshade.browser.spec.ts`) are from the Terrain Tiles open dataset on AWS (Mapzen
 * terrarium encoding); in the United States its elevations come from USGS 3DEP and SRTM, both
 * public domain. They were rounded down to whole meters (blue channel zeroed) to halve their size,
 * and are committed as such: recording them again would replace them with the unrounded tiles.
 */
export const FIXTURE_ROOT = 'modules/basemap-layers/tests/reference-render/fixtures';

/** The fixture file path of a remote URL, relative to {@link FIXTURE_ROOT}. */
export function getFixturePath(url: string): string {
  const parsed = new URL(url);
  if (parsed.search) {
    // `toFixtureUrl` keeps the query, which the test server ignores: such URLs cannot be replayed.
    throw new Error(`Fixture URLs with a query string are not supported: ${url}`);
  }
  let path = decodeURIComponent(parsed.pathname);
  // A path without an extension (a TileJSON endpoint) can also be a directory of tiles, and the
  // test server does not serve extensionless files as-is.
  if (!/\.[^/]+$/.test(path)) {
    path = `${path.replace(/\/$/, '')}/index.json`;
  }
  return `${parsed.host}${path}`;
}

/** The same-origin URL serving the fixture of a remote URL or URL template. */
export function toFixtureUrl(url: string): string {
  return url.replace(/^https?:\/\//, `${location.origin}/${FIXTURE_ROOT}/`);
}

/** The remote URL a fixture URL was recorded from. */
export function fromFixtureUrl(url: string): string | null {
  const prefix = `${location.origin}/${FIXTURE_ROOT}/`;
  return url.startsWith(prefix) ? `https://${decodeURIComponent(url.slice(prefix.length))}` : null;
}

function getStyleFixturePath(styleId: ReferenceStyleId): string {
  return `styles/${styleId}.json`;
}

async function fetchFixture(path: string): Promise<Response | null> {
  // `encodeURI` keeps the commas of glyph font stacks, which the test server does not decode.
  const response = await fetch(encodeURI(`/${FIXTURE_ROOT}/${path}`));
  // The dev server answers unknown paths with its HTML fallback page rather than a 404.
  const type = response.headers.get('content-type') || '';
  return response.ok && !type.includes('text/html') ? response : null;
}

/** Whether a fixture exists, without reading it. */
export async function hasFixture(path: string): Promise<boolean> {
  return Boolean(await fetchFixture(path));
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Downloads a remote URL into its fixture path. Record mode only. */
export async function recordFixture(url: string, path = getFixturePath(url)): Promise<number> {
  const response = await fetch(url);
  if (!response.ok) {
    // Tiles outside a source's data (e.g. empty ocean) can 404 upstream; record nothing.
    return 0;
  }
  const buffer = await response.arrayBuffer();
  await commands.writeFile(`${FIXTURE_ROOT}/${path}`, toBase64(buffer), 'base64');
  return buffer.byteLength;
}

/**
 * Records the fixtures among `urls` (remote URLs) that are missing. Returns how many it wrote.
 */
export async function recordMissingFixtures(urls: Iterable<string>): Promise<number> {
  let written = 0;
  for (const url of new Set(urls)) {
    if (!(await hasFixture(getFixturePath(url)))) {
      if ((await recordFixture(url)) > 0) {
        written++;
      }
    }
  }
  return written;
}

type StyleJson = {
  sources: Record<string, any>;
  sprite?: string | Array<{id: string; url: string}>;
  glyphs?: string;
  layers: any[];
  [key: string]: unknown;
};

/**
 * Loads a style from its fixtures, ready for both renderers: each source's TileJSON is inlined
 * (its first tile URL template, zoom range and bounds), and every tile, sprite and glyph URL points
 * at the fixtures. Both renderers receive this same object. In record mode, missing style and
 * TileJSON fixtures are downloaded first.
 */
export async function loadReferenceStyle(
  styleId: ReferenceStyleId,
  {record = false}: {record?: boolean} = {}
): Promise<StyleJson> {
  const stylePath = getStyleFixturePath(styleId);
  if (record && !(await hasFixture(stylePath))) {
    await recordFixture(REFERENCE_STYLES[styleId], stylePath);
  }
  const response = await fetchFixture(stylePath);
  if (!response) {
    throw new Error(`Missing fixture ${stylePath}; record it with REFERENCE_RENDER_MODE=record`);
  }
  const style = (await response.json()) as StyleJson;

  for (const source of Object.values(style.sources)) {
    if (source.url) {
      const path = getFixturePath(source.url);
      if (record && !(await hasFixture(path))) {
        await recordFixture(source.url);
      }
      const tileJson = await (await fetchFixture(path))?.json();
      if (!tileJson) {
        throw new Error(`Missing TileJSON fixture ${path}`);
      }
      delete source.url;
      // One template: MapLibre and deck.gl pick among several templates differently.
      source.tiles = [tileJson.tiles[0]];
      for (const key of ['minzoom', 'maxzoom', 'bounds', 'scheme'] as const) {
        if (tileJson[key] !== undefined && source[key] === undefined) {
          source[key] = tileJson[key];
        }
      }
    }
    if (source.tiles) {
      source.tiles = source.tiles.map(toFixtureUrl);
    }
  }
  if (typeof style.sprite === 'string') {
    style.sprite = toFixtureUrl(style.sprite);
  } else if (Array.isArray(style.sprite)) {
    style.sprite = style.sprite.map(sprite => ({
      ...sprite,
      url: toFixtureUrl(sprite.url)
    }));
  }
  if (style.glyphs) {
    style.glyphs = toFixtureUrl(style.glyphs);
  }
  return style;
}
