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
