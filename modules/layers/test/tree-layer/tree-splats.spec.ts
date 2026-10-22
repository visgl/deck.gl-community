// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, expect, it} from 'vitest';
import {validateSplatSource} from '../../src/splat-layer/splat-source';
import {getTreeSplatHierarchy, getTreeSplatSource} from '../../src/tree-layer/tree-splats';
describe('Authored tree Gaussian templates', () => {
  for (const species of ['pine', 'oak', 'palm', 'birch', 'cherry', 'banyan', 'mangrove'] as const)
    it(`${species} authors real anisotropic leaf Gaussians and shares its template`, () => {
      const template = getTreeSplatSource(species, 4);
      expect(validateSplatSource(template)).toBeGreaterThan(species === 'palm' ? 700 : 1000);
      expect(getTreeSplatSource(species, 4)).toBe(template);
      expect(template.scales[0] / template.scales[2]).toBeGreaterThan(3);
    });

  it('uses fewer, thicker foliage splats for dense-scene crown coverage', () => {
    const oak = getTreeSplatSource('oak');
    const leafCount = oak.positions.length / 3;
    const meanScale = [0, 1, 2].map(
      axis =>
        oak.scales.reduce((sum, value, index) => sum + (index % 3 === axis ? value : 0), 0) /
        leafCount
    );
    expect(leafCount).toBe(6144);
    expect(meanScale[0]).toBeGreaterThan(0.015);
    expect(meanScale[1]).toBeGreaterThan(0.0105);
    expect(meanScale[2]).toBeGreaterThan(0.0024);

    const pine = getTreeSplatSource('pine');
    expect(pine.positions.length / 3).toBe(4480);
    expect(pine.scales[0]).toBeCloseTo(0.03);
    expect(pine.scales[1]).toBeCloseTo(0.015);
    expect(pine.scales[2]).toBeCloseTo(0.007);
  });

  it('retains a two-splat spatial cluster as every tree canopy hierarchy floor', () => {
    for (const species of [
      'pine',
      'oak',
      'palm',
      'birch',
      'cherry',
      'banyan',
      'mangrove',
      'citrus'
    ] as const) {
      const terminal = getTreeSplatHierarchy(species).at(-1)!.source;
      expect(validateSplatSource(terminal)).toBeGreaterThanOrEqual(2);
    }
  });
});
