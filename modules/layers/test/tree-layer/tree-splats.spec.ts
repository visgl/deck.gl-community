// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, expect, it} from 'vitest';
import {validateSplatSource} from '../../src/splat-layer/splat-source';
import {getTreeSplatSource} from '../../src/tree-layer/tree-splats';
describe('Authored tree Gaussian templates', () => {
  for (const species of ['pine', 'oak', 'palm', 'birch', 'cherry', 'banyan', 'mangrove'] as const)
    it(`${species} authors real anisotropic leaf Gaussians and shares its template`, () => {
      const template = getTreeSplatSource(species, 4);
      expect(validateSplatSource(template)).toBeGreaterThan(1000);
      expect(getTreeSplatSource(species, 4)).toBe(template);
      expect(template.scales[0] / template.scales[2]).toBeGreaterThan(3);
    });
});
