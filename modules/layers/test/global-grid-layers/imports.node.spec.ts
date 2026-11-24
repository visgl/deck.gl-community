// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {it, expect} from 'vitest';
import * as GridLayers from '../../src/global-grid-layers';

it('exports GlobalGridLayer', () => {
  expect(GridLayers.GlobalGridLayer).toBeDefined();
});

it('exports grid systems', () => {
  expect(GridLayers.S2Grid).toBeDefined();
  expect(GridLayers.GeohashGrid).toBeDefined();
  expect(GridLayers.QuadkeyGrid).toBeDefined();
});
