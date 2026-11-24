// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SplatLayer as RootSplatLayer} from '@deck.gl-community/layers';
import {SplatLayer as CommonSplatLayer} from '@deck.gl-community/layers/common-layers';
import {SplatLayer, createSplatHierarchy} from '@deck.gl-community/layers/splat-layers';
import {expect, it} from 'vitest';

it('uses the same SplatLayer class at the canonical and existing entry points', () => {
  expect(RootSplatLayer).toBe(SplatLayer);
  expect(CommonSplatLayer).toBe(SplatLayer);
  expect(createSplatHierarchy).toBeTypeOf('function');
});
