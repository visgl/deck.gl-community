// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it} from 'vitest';
import {TreeLayer as CompatibilityTreeLayer} from '../src';
import {TreeLayer} from '../../layers/src';
it('the deprecated import resolves to the same canonical TreeLayer constructor', () => {
  expect(CompatibilityTreeLayer).toBe(TreeLayer);
});
