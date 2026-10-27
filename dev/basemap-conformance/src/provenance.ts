// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Input digests of a render (Node only). A saved render carries them, and the scorer computes them
 * again from its own checkout of the corpus before it scores the render. A render of other inputs
 * (a scene, style or fixture that changed since, or a stale output directory) is then invalid, not
 * a plausible score. Imports only `node:` modules.
 *
 * - `scene`: SHA-256 of the scene's camera (style id, center, zoom, pitch, bearing) and the bytes of
 *   the style JSON fixture. The same for every renderer of a scene.
 * - `fixtures`: SHA-256 of every fixture the render requested (sorted, without duplicates): its
 *   path and its bytes, or a mark that no root holds it. Renderers can request different tiles, so
 *   this digest is per render.
 *
 * Every field is length-prefixed, so no two different inputs give the same byte stream.
 */

import {createHash, type Hash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import type {ConformanceScene, RenderInputs} from './types';

export const INPUTS_ALGORITHM = 'sha256';

/** The fixture roots of a checkout of this repository, in search order. */
export function fixtureRootsOf(checkout: string): string[] {
  return [
    resolve(checkout, 'dev/basemap-conformance/fixtures'),
    resolve(checkout, 'modules/basemap-layers/tests/reference-render/fixtures')
  ];
}

/** The camera of a scene, with defaults filled in. Everything a renderer reads from the scene. */
export function sceneCamera(scene: ConformanceScene) {
  return {
    style: scene.style,
    center: [scene.center[0], scene.center[1]],
    zoom: scene.zoom,
    pitch: scene.pitch ?? 0,
    bearing: scene.bearing ?? 0
  };
}

/** How the camera of a saved scene differs from the corpus scene, one entry per field. */
export function cameraDifferences(saved: ConformanceScene, expected: ConformanceScene): string[] {
  const a = sceneCamera(saved);
  const b = sceneCamera(expected);
  return (Object.keys(b) as (keyof typeof b)[])
    .filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .map(key => `${key} ${JSON.stringify(a[key])}, corpus ${JSON.stringify(b[key])}`);
}

/** The first file that holds a fixture path (`<host>/<path>`), or null. */
export function findFixture(path: string, fixtureRoots: string[]): string | null {
  for (const root of fixtureRoots) {
    const file = join(root, path);
    if (existsSync(file)) {
      return file;
    }
  }
  return null;
}

function update(hash: Hash, value: string | Buffer): void {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  hash.update(`${bytes.length}:`);
  hash.update(bytes);
}

function updateFixture(hash: Hash, path: string, fixtureRoots: string[]): void {
  const file = findFixture(path, fixtureRoots);
  update(hash, path);
  update(hash, file ? 'present' : 'missing');
  if (file) {
    update(hash, readFileSync(file));
  }
}

/** The digest of a scene's camera and its style JSON fixture. */
export function digestScene(
  scene: ConformanceScene,
  styleFixture: string,
  fixtureRoots: string[]
): string {
  const hash = createHash(INPUTS_ALGORITHM);
  update(hash, 'basemap-conformance scene 1');
  update(hash, JSON.stringify(sceneCamera(scene)));
  updateFixture(hash, styleFixture, fixtureRoots);
  return hash.digest('hex');
}

/** The digest of a set of fixtures. Order and duplicates do not matter. */
export function digestFixtures(paths: string[], fixtureRoots: string[]): string {
  const hash = createHash(INPUTS_ALGORITHM);
  update(hash, 'basemap-conformance fixtures 1');
  for (const path of [...new Set(paths)].sort()) {
    updateFixture(hash, path, fixtureRoots);
  }
  return hash.digest('hex');
}

/** The input digests of one render. */
export function computeRenderInputs(options: {
  scene: ConformanceScene;
  styleFixture: string;
  fixtureRequests: string[];
  fixtureRoots: string[];
}): RenderInputs {
  return {
    algorithm: INPUTS_ALGORITHM,
    scene: digestScene(options.scene, options.styleFixture, options.fixtureRoots),
    fixtures: digestFixtures(options.fixtureRequests, options.fixtureRoots)
  };
}
