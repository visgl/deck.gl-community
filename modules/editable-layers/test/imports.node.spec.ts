// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Smoke test: verify the public API surface exports resolve without errors.
// This runs in Node (no WebGL) to catch broken re-exports early.

import {createRequire} from 'node:module';
import {it, expect} from 'vitest';
import * as EditableLayers from '../src/index';
import * as BuiltEditableLayers from '../dist/index.js';

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

it('ships the same supported runtime exports in ESM and CJS', () => {
  const require = createRequire(import.meta.url);
  const commonJsExports = require('../dist/index.cjs');
  const expectedExports = Object.keys(EditableLayers).sort();

  expect(Object.keys(BuiltEditableLayers).sort()).toEqual(expectedExports);
  expect(Object.keys(commonJsExports).sort()).toEqual(expectedExports);
  for (const name of ['toDeckColor', 'utils', '_memoize']) {
    expect(expectedExports).not.toContain(name);
  }
});
