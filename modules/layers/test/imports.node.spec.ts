// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {it, expect} from 'vitest';
import * as Layers from '../src/index';

it('exports PathOutlineLayer', () => {
  expect(Layers.PathOutlineLayer).toBeDefined();
});

it('exports PathMarkerLayer', () => {
  expect(Layers.PathMarkerLayer).toBeDefined();
});

it('exports DependencyArrowLayer', () => {
  expect(Layers.DependencyArrowLayer).toBeDefined();
});

it('exports SkyboxLayer', () => {
  expect(Layers.SkyboxLayer).toBeDefined();
});

it('exports VolumetricVideoLayer', () => {
  expect(Layers.VolumetricVideoLayer).toBeDefined();
});

it('exports the volumetric history memory estimator', () => {
  expect(Layers.getVolumetricVideoHistoryBytes(1, 1, 1)).toBe(12);
});
