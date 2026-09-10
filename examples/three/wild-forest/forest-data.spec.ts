// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {
  FOREST_SITES,
  createTreeSamples,
  TREES_PER_SITE,
  getFoliageColor,
  getBarkColor,
  getSeasonalCanopyRadius,
  getSeasonalCrop,
  createWinterBranches
} from './forest-data';

describe('geographic tree groves', () => {
  it('places seven varied groves around the globe covering all five silhouettes', () => {
    const trees = createTreeSamples();
    expect(createTreeSamples()).toEqual(trees);
    expect(trees).toHaveLength(2800);
    expect(new Set(trees.map(tree => tree.id)).size).toBe(trees.length);
    expect(new Set(trees.map(tree => tree.type))).toEqual(
      new Set(['pine', 'oak', 'palm', 'birch', 'cherry'])
    );
    expect(new Set(trees.map(tree => tree.species)).size).toBe(7);
    expect(Math.min(...trees.map(tree => tree.position[0]))).toBeLessThan(-100);
    expect(Math.max(...trees.map(tree => tree.position[0]))).toBeGreaterThan(130);
    expect(trees.some(tree => tree.position[1] < -20)).toBe(true);
    for (const tree of trees) {
      const site = FOREST_SITES.find(item => item.id === tree.siteId)!;
      expect(tree.position[0]).toBeCloseTo(site.position[0], 2);
      expect(tree.position[1]).toBeCloseTo(site.position[1], 2);
      expect(tree.species).toBe(site.species);
      expect(tree.height).toBeGreaterThan(1);
      expect(tree.canopyRadius).toBeGreaterThan(tree.trunkRadius);
    }
  });

  it('keeps all groves at metre scale with varied sizes', () => {
    const local = createTreeSamples();
    for (const site of FOREST_SITES) {
      const grove = local.filter(tree => tree.siteId === site.id);
      expect(grove).toHaveLength(TREES_PER_SITE);
      expect(new Set(grove.map(tree => tree.height)).size).toBeGreaterThan(15);
      expect(
        Math.max(...grove.map(tree => tree.height)) / Math.min(...grove.map(tree => tree.height))
      ).toBeGreaterThan(2);
      expect(grove.reduce((sum, tree) => sum + tree.position[0], 0) / grove.length).toBeCloseTo(
        site.position[0],
        6
      );
      expect(grove.reduce((sum, tree) => sum + tree.position[1], 0) / grove.length).toBeCloseTo(
        site.position[1],
        6
      );
    }
    expect(Math.max(...local.map(tree => tree.height))).toBeLessThan(40);
  });

  it('varies independent traits and seasonal responses throughout every grove', () => {
    const trees = createTreeSamples();
    for (const site of FOREST_SITES) {
      const grove = trees.filter(tree => tree.siteId === site.id);
      expect(new Set(grove.map(tree => tree.maturity)).size).toBe(4);
      expect(new Set(grove.map(tree => tree.branchLevels)).size).toBe(5);
      expect(new Set(grove.map(tree => tree.trunkFraction)).size).toBeGreaterThan(350);
      expect(new Set(grove.map(tree => tree.canopyRadius / tree.height)).size).toBeGreaterThan(350);
      expect(
        new Set(grove.map(tree => getFoliageColor(tree, 'autumn').join(','))).size
      ).toBeGreaterThan(32);
      expect(new Set(grove.map(tree => getBarkColor(tree).join(','))).size).toBeGreaterThan(25);
      for (const tree of grove) {
        expect(getSeasonalCanopyRadius(tree, 'spring')).toBeLessThanOrEqual(tree.canopyRadius);
        expect(tree.branchLevels).toBeGreaterThanOrEqual(1);
        expect(tree.branchLevels).toBeLessThanOrEqual(5);
        if (tree.maturity === 'sapling') expect(getSeasonalCrop(tree, 'autumn')).toBeNull();
      }
    }
    const oranges = trees.filter(tree => tree.species === 'orange' && tree.maturity !== 'sapling');
    const harvest = oranges.map(tree => getSeasonalCrop(tree, 'winter')!);
    expect(new Set(harvest.map(crop => crop.count)).size).toBeGreaterThan(30);
    expect(new Set(harvest.map(crop => crop.radius)).size).toBeGreaterThan(250);
    const cherry = trees.find(tree => tree.species === 'cherry')!;
    expect(getSeasonalCanopyRadius(cherry, 'spring')).toBeLessThan(
      getSeasonalCanopyRadius(cherry, 'summer')
    );
  });

  it('keeps evergreen crowns and reveals only the leafless cherry and birch branches', () => {
    for (const tree of createTreeSamples()) {
      const leafless = ['cherry', 'birch'].includes(tree.species);
      expect(getFoliageColor(tree, 'winter')[3] === 0).toBe(leafless);
      expect(createWinterBranches([tree], 1).length > 0).toBe(leafless);
    }
  });

  it('shows local blossom and harvest stages without assigning fruit to ornamental cherries', () => {
    const trees = createTreeSamples();
    const cherry = trees.find(tree => tree.species === 'cherry')!;
    expect(getSeasonalCrop(cherry, 'spring')?.count).toBeGreaterThan(0);
    expect(getSeasonalCrop(cherry, 'summer')).toBeNull();
    const almond = trees.find(tree => tree.species === 'almond')!;
    expect(getSeasonalCrop(almond, 'winter')?.count).toBeGreaterThan(0);
    const orange = trees.find(tree => tree.species === 'orange')!;
    expect(getSeasonalCrop(orange, 'winter')?.color).not.toEqual(
      getSeasonalCrop(orange, 'summer')?.color
    );
    expect(getSeasonalCrop(orange, 'winter')?.droppedCount).toBeGreaterThan(0);
  });

  it('scales the leafless scaffold without moving its geographic base', () => {
    const tree = createTreeSamples().find(sample => sample.species === 'birch')!;
    const normal = createWinterBranches([tree], 1);
    const larger = createWinterBranches([tree], 2);
    for (let index = 0; index < normal.length; index++) {
      expect(larger[index].source.slice(0, 2)).toEqual(normal[index].source.slice(0, 2));
      expect(larger[index].source[2]).toBeCloseTo(normal[index].source[2] * 2);
      expect(larger[index].target[2]).toBeCloseTo(normal[index].target[2] * 2);
    }
  });
});
