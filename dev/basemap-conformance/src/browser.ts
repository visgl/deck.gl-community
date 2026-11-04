// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Browser-side helpers shared by every runner. No dependencies (not even the test framework), so
 * a repository can import this file from another checkout or package without a second copy of
 * vitest, deck.gl or MapLibre: each runner brings its own.
 */

import {STYLES, VIEWPORT} from './scenes';
import type {
  ConformanceRender,
  ConformanceRenderer,
  ConformanceScene,
  RendererManifest,
  RenderInputs,
  SavedRender
} from './types';

const FIXTURE_PREFIX = '/__conformance__/fixtures/';

/** The same-origin fixture URL of a remote URL or URL template. */
export function toFixtureUrl(url: string): string {
  return url.replace(/^https?:\/\//, `${location.origin}${FIXTURE_PREFIX}`);
}

/** The remote URL a fixture URL stands for, or null. */
export function fromFixtureUrl(url: string): string | null {
  const prefix = `${location.origin}${FIXTURE_PREFIX}`;
  return url.startsWith(prefix) ? `https://${decodeURIComponent(url.slice(prefix.length))}` : null;
}

async function fetchFixtureJson(path: string): Promise<any> {
  // `encodeURI` keeps the commas of glyph font stacks.
  const response = await fetch(encodeURI(`${FIXTURE_PREFIX}${path}`));
  if (!response.ok) {
    throw new Error(`Missing fixture ${path} (${response.status})`);
  }
  return response.json();
}

/** The fixture path (`<host>/<path>`) of a remote URL. */
function toFixturePath(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/**
 * Loads a style of the corpus, ready for every renderer: each source's TileJSON is inlined (its
 * first tile URL template, zoom range and bounds), and every tile, sprite and glyph URL points at
 * the fixture server. The same logic as basemap-layers' `loadReferenceStyle`, so MapLibre and
 * deck.gl renderers pick tiles from the same template.
 */
export async function loadConformanceStyle(styleId: string): Promise<any> {
  const entry = STYLES[styleId];
  if (!entry) {
    throw new Error(`Unknown conformance style ${styleId}`);
  }
  const style = await fetchFixtureJson(entry.fixture);
  for (const source of Object.values<any>(style.sources)) {
    if (source.url) {
      const tileJson = await fetchFixtureJson(toFixturePath(source.url));
      delete source.url;
      // One template: MapLibre and deck.gl pick among several templates differently.
      source.tiles = [tileJson.tiles[0]];
      for (const key of ['minzoom', 'maxzoom', 'bounds', 'scheme']) {
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
    style.sprite = style.sprite.map((sprite: any) => ({...sprite, url: toFixtureUrl(sprite.url)}));
  }
  if (style.glyphs) {
    style.glyphs = toFixtureUrl(style.glyphs);
  }
  return style;
}

/** A container of `VIEWPORT` size at the page's top left, for a renderer's canvas. */
export function createContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.style.cssText = `position: absolute; left: 0; top: 0; width: ${VIEWPORT.width}px; height: ${VIEWPORT.height}px;`;
  document.body.append(container);
  return container;
}

/** The pixels of a canvas composited on white, at `VIEWPORT` size. Call while its buffer is valid. */
export function readCanvas(source: CanvasImageSource): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = VIEWPORT.width;
  canvas.height = VIEWPORT.height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

export function withTimeout<T>(promise: Promise<T>, label: string, timeout = 90_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${timeout} ms`)),
      timeout
    );
    promise.then(
      value => {
        window.clearTimeout(timer);
        resolve(value);
      },
      error => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

type FixtureLog = {requests: string[]; misses: string[]; recorded: string[]};

/** The fixture server's log since its last read, and clears it. */
export async function readFixtureLog(): Promise<FixtureLog> {
  return (await fetch('/__conformance__/log')).json();
}

async function postOutput(path: string, body: BodyInit): Promise<void> {
  const response = await fetch(`/__conformance__/output/${encodeURIComponent(path)}`, {
    method: 'POST',
    body
  });
  if (!response.ok) {
    throw new Error(`Could not save ${path}: ${await response.text()}`);
  }
}

/** The input digests of a render, computed by the fixture server over the fixtures it serves. */
async function fetchRenderInputs(
  scene: ConformanceScene,
  fixtureRequests: string[]
): Promise<RenderInputs> {
  const response = await fetch('/__conformance__/inputs', {
    method: 'POST',
    body: JSON.stringify({scene, styleFixture: STYLES[scene.style].fixture, fixtureRequests})
  });
  if (!response.ok) {
    throw new Error(`Could not compute the input digests: ${await response.text()}`);
  }
  return response.json();
}

/**
 * Saves `<renderer>/renderer.json`: the scenes of this run, each `expected` or `unsupported` by the
 * renderer. Call it once per renderer before its first render, so that the scorer reports a render
 * that never arrives as missing.
 */
export async function saveRendererManifest(
  renderer: ConformanceRenderer,
  scenes: ConformanceScene[]
): Promise<RendererManifest> {
  const manifest: RendererManifest = {
    renderer: renderer.id,
    rendererName: renderer.name,
    scenes: Object.fromEntries(
      scenes.map(scene => [scene.id, renderer.supports(scene) ? 'expected' : 'unsupported'])
    )
  };
  await postOutput(`${renderer.id}/renderer.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function toPng(render: ConformanceRender): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = render.width;
  canvas.height = render.height;
  canvas
    .getContext('2d')!
    .putImageData(
      new ImageData(new Uint8ClampedArray(render.pixels), render.width, render.height),
      0,
      0
    );
  return new Promise((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png')
  );
}

/**
 * Renders one scene with one renderer and saves `<renderer>/<scene>.png` and `.json` through the
 * fixture server. Returns the saved record: a runner fails the test when `problems` or
 * `fixtureMisses` is not empty (the render is not a valid measurement), never on the scores.
 */
export async function runConformanceScene(
  renderer: ConformanceRenderer,
  scene: ConformanceScene
): Promise<SavedRender> {
  await readFixtureLog();
  const start = performance.now();
  const style = await loadConformanceStyle(scene.style);
  const render = await renderer.render(scene, style);
  const durationMs = Math.round(performance.now() - start);
  const log = await readFixtureLog();
  const saved: SavedRender = {
    renderer: renderer.id,
    rendererName: renderer.name,
    scene,
    width: render.width,
    height: render.height,
    labels: render.labels,
    labelNote: render.labelNote,
    problems: render.problems,
    fixtureRequests: log.requests,
    fixtureMisses: log.misses,
    recorded: log.recorded,
    durationMs,
    inputs: await fetchRenderInputs(scene, log.requests),
    meta: {devicePixelRatio: window.devicePixelRatio, ...render.meta}
  };
  await postOutput(`${renderer.id}/${scene.id}.png`, await toPng(render));
  await postOutput(`${renderer.id}/${scene.id}.json`, `${JSON.stringify(saved, null, 2)}\n`);
  return saved;
}
