// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {
  createFarmPlots,
  createTreeSamples,
  getFarmPosition,
  getFoliageColor,
  getSeasonalCrop,
  createWinterBranches
} from './farm-data';

describe('demonstration farm', () => {
  it('fits varied trees inside seven separate plots in both layouts', () => {
    for (const columns of [2, 3]) {
      const plots = createFarmPlots(columns);
      const trees = createTreeSamples(plots);
      expect(trees).toEqual(createTreeSamples(plots));
      expect(trees).toHaveLength(416);
      expect(new Set(trees.map(tree => tree.id)).size).toBe(trees.length);
      expect(new Set(trees.map(tree => tree.type))).toEqual(
        new Set(['pine', 'oak', 'palm', 'birch', 'cherry'])
      );
      for (const plot of plots) {
        const planted = trees.filter(tree => tree.plotId === plot.species);
        expect(new Set(planted.map(tree => tree.maturity)).size).toBe(4);
        expect(
          Math.max(...planted.map(tree => tree.height)) /
            Math.min(...planted.map(tree => tree.height))
        ).toBeGreaterThan(2);
        const [sw, , ne] = plot.polygon;
        for (const tree of planted) {
          // Include the actual half-radius canopy plus room for its asymmetric shape.
          const radius = getFarmPosition(tree.canopyRadius * 0.7, tree.canopyRadius * 0.7);
          expect(tree.position[0] - radius[0]).toBeGreaterThan(sw[0]);
          expect(tree.position[0] + radius[0]).toBeLessThan(ne[0]);
          expect(tree.position[1] - radius[1]).toBeGreaterThan(sw[1]);
          expect(tree.position[1] + radius[1]).toBeLessThan(ne[1]);
          expect(tree.height).toBeGreaterThan(1);
          expect(tree.height).toBeLessThan(40);
        }
        for (const other of plots.filter(item => item !== plot)) {
          const [a, b, c, d] = plot.bounds;
          const [e, f, g, h] = other.bounds;
          expect(c <= e || g <= a || d <= f || h <= b).toBe(true);
        }
      }
    }
  });

  it('keeps tree identities and traits stable when the farm rearranges for mobile', () => {
    const traits = (columns: number) =>
      createTreeSamples(createFarmPlots(columns)).map(({position, ...tree}) => tree);
    expect(traits(2)).toEqual(traits(3));
  });

  it('changes blossom, harvest, and leafless branches while keeping citrus evergreen', () => {
    const trees = createTreeSamples();
    for (const tree of trees) {
      const leafless = ['cherry', 'birch', 'almond'].includes(tree.species);
      expect(getFoliageColor(tree, 'winter')[3] === 0).toBe(leafless);
      expect(createWinterBranches([tree]).length > 0).toBe(leafless);
      if (tree.maturity === 'sapling') expect(getSeasonalCrop(tree, 'autumn')).toBeNull();
    }
    for (const species of ['cherry', 'almond'] as const) {
      const tree = trees.find(tree => tree.species === species)!;
      expect(getSeasonalCrop(tree, 'spring')!.count).toBeGreaterThan(0);
      expect(getSeasonalCrop(tree, 'winter')).toBeNull();
    }
    expect(getSeasonalCrop(trees.find(tree => tree.species === 'cherry')!, 'summer')).toBeNull();
    const oranges = trees.filter(tree => tree.species === 'orange' && tree.maturity !== 'sapling');
    expect(
      new Set(oranges.map(tree => getSeasonalCrop(tree, 'winter')!.count)).size
    ).toBeGreaterThan(15);
    expect(getSeasonalCrop(oranges[0], 'summer')!.color).not.toEqual(
      getSeasonalCrop(oranges[0], 'winter')!.color
    );
    expect(getSeasonalCrop(oranges[0], 'winter')!.droppedCount).toBeGreaterThan(0);
  });
});
