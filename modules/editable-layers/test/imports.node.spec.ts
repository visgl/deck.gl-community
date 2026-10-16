// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Smoke test: verify the public API surface exports resolve without errors.
// This runs in Node (no WebGL) to catch broken re-exports early.

import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {it, expect} from 'vitest';
import * as EditableLayers from '../src/index';

const DIST_ESM_ENTRY = new URL('../dist/index.js', import.meta.url);
const DIST_CJS_ENTRY = new URL('../dist/index.cjs', import.meta.url);
const hasBuiltBundles =
  existsSync(fileURLToPath(DIST_ESM_ENTRY)) && existsSync(fileURLToPath(DIST_CJS_ENTRY));

it('exports ImmutableFeatureCollection', () => {
  expect(EditableLayers.ImmutableFeatureCollection).toBeDefined();
});

it('exports GeoJsonEditMode', () => {
  expect(EditableLayers.GeoJsonEditMode).toBeDefined();
});

it('exports draw modes', () => {
  const drawModes = [
    'DrawPointMode',
    'DrawLineStringMode',
    'DrawPolygonMode',
    'DrawRectangleMode',
    'DrawCircleByDiameterMode',
    'DrawCircleFromCenterMode'
  ] as const;

  for (const name of drawModes) {
    expect(EditableLayers[name], `${name} should be exported`).toBeDefined();
  }
});

it('exports alter modes', () => {
  const alterModes = [
    'ModifyMode',
    'TranslateMode',
    'ScaleMode',
    'RotateMode',
    'DeleteMode',
    'DuplicateMode',
    'SplitPolygonMode',
    'TransformMode'
  ] as const;

  for (const name of alterModes) {
    expect(EditableLayers[name], `${name} should be exported`).toBeDefined();
  }
});

it('exports measurement modes', () => {
  expect(EditableLayers.MeasureDistanceMode).toBeDefined();
  expect(EditableLayers.MeasureAreaMode).toBeDefined();
  expect(EditableLayers.MeasureAngleMode).toBeDefined();
});

it('exports composite modes', () => {
  expect(EditableLayers.CompositeMode).toBeDefined();
  expect(EditableLayers.SnappableMode).toBeDefined();
  expect(EditableLayers.ViewMode).toBeDefined();
});

it.skipIf(!hasBuiltBundles)('ships the same supported runtime exports in ESM and CJS', async () => {
  const builtEditableLayers = await import(/* @vite-ignore */ DIST_ESM_ENTRY.href);
  const require = createRequire(import.meta.url);
  const commonJsExports = require(fileURLToPath(DIST_CJS_ENTRY));
  const expectedExports = Object.keys(EditableLayers).sort();

  expect(Object.keys(builtEditableLayers).sort()).toEqual(expectedExports);
  expect(Object.keys(commonJsExports).sort()).toEqual(expectedExports);
  for (const name of ['toDeckColor', 'utils', '_memoize']) {
    expect(expectedExports).not.toContain(name);
  }
});
