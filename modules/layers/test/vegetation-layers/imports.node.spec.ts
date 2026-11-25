// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, it} from 'vitest';
import {TreeLayer} from '@deck.gl-community/layers/vegetation-layers';
import {TreeLayer as RootTreeLayer} from '@deck.gl-community/layers';

it('exports the same TreeLayer from the package root and tree subpath', () => {
  expect(TreeLayer).toBe(RootTreeLayer);
});
