// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {
  getTreeCrownFraction,
  getTreeGrowthAtHeight,
  getTreeHeightFraction
} from '../../src/tree-layer/tree-growth-fractions';
import {
  growTreeSkeleton,
  isTreeGrowthSpecies,
  type TreeGrowthSpecies
} from '../../src/tree-layer/tree-growth-model';

const SPECIES: TreeGrowthSpecies[] = ['oak', 'birch', 'cherry', 'banyan', 'mangrove', 'citrus'];

function finishSkeleton(iterator: ReturnType<typeof growTreeSkeleton>) {
  let step = iterator.next();
  while (!step.done) step = iterator.next();
  return step.value;
}

describe('tree growth skeleton', () => {
  it.each(SPECIES)('grows a connected %s crown in parent and birth order', species => {
    const {arrivals, nodes, colonized} = finishSkeleton(growTreeSkeleton(species, {seed: 8}));
    expect(isTreeGrowthSpecies(species)).toBe(true);
    expect(colonized).toBe(nodes.count);
    expect(nodes.count).toBeGreaterThan(500);
    expect(nodes.parent[0]).toBe(-1);
    expect(arrivals.every(value => value > 0 && value <= 1)).toBe(true);

    const invalidNodes = [];
    for (let node = 0; node < nodes.count; node++) {
      const parent = nodes.parent[node];
      const next = nodes.next[node];
      if (
        (node > 0 && (parent < 0 || parent >= node || nodes.birth[parent] > nodes.birth[node])) ||
        (next >= 0 && (next <= node || nodes.parent[next] !== node)) ||
        ![nodes.x[node], nodes.y[node], nodes.z[node], nodes.level[node]].every(Number.isFinite) ||
        nodes.birth[node] < 0 ||
        nodes.birth[node] >= 1 ||
        nodes.level[node] < 0 ||
        nodes.level[node] > 1
      ) {
        invalidNodes.push(node);
      }
    }
    expect(invalidNodes).toEqual([]);
    const shoots = new Set(nodes.shoot.subarray(0, nodes.count));
    expect(shoots.size).toBeGreaterThan(40);
  });

  it('preserves seeded nodes when two growth iterators yield and resume independently', () => {
    const citrus = {seed: 8, crownAsymmetry: 1.3};
    const oak = {seed: 11, branchWander: 0.69, twigDroop: 0.84};
    const fullCitrus = finishSkeleton(growTreeSkeleton('citrus', citrus));
    const fullOak = finishSkeleton(growTreeSkeleton('oak', oak));
    expect(finishSkeleton(growTreeSkeleton('citrus', {...citrus, seed: 9})).nodes.x).not.toEqual(
      fullCitrus.nodes.x
    );

    const citrusIterator = growTreeSkeleton('citrus', citrus, () => true);
    const oakIterator = growTreeSkeleton('oak', oak, () => true);
    let citrusStep = citrusIterator.next();
    let oakStep = oakIterator.next();
    let yields = 0;
    while (!citrusStep.done || !oakStep.done) {
      if (!citrusStep.done) citrusStep = citrusIterator.next();
      if (!oakStep.done) oakStep = oakIterator.next();
      yields++;
    }

    expect(yields).toBeGreaterThan(10);
    expect(citrusStep.value.nodes).toEqual(fullCitrus.nodes);
    expect(oakStep.value.nodes).toEqual(fullOak.nodes);
    expect(citrusStep.value.envelope).toEqual(fullCitrus.envelope);
    expect(oakStep.value.arrivals).toEqual(fullOak.arrivals);
  }, 30_000);

  it('keeps crown and height growth bounded and inverts trunk height', () => {
    expect(isTreeGrowthSpecies('pine')).toBe(false);
    expect(isTreeGrowthSpecies('palm')).toBe(false);
    for (const growth of [0, 0.01, 0.4, 0.9, 1]) {
      expect(getTreeGrowthAtHeight(getTreeHeightFraction(growth))).toBeCloseTo(growth, 9);
      expect(getTreeCrownFraction(growth)).toBeGreaterThanOrEqual(getTreeHeightFraction(growth));
    }
    expect(getTreeCrownFraction(-1)).toBe(0);
    expect(getTreeCrownFraction(2)).toBe(1);
  });
});
