// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it} from 'vitest';
import {budgetSplatSelections} from '../../src/splat-layer/splat-budget';
import type {SplatHierarchy} from '../../src/splat-layer/splat-hierarchy';
const hierarchy: SplatHierarchy = [1000, 100, 10].map((count, i) => ({
  error: i,
  source: {
    positions: new Float32Array(count * 3),
    scales: new Float32Array(count * 3).fill(1),
    rotations: new Float32Array(count * 4),
    colors: new Uint8Array(count * 4),
    opacities: new Float32Array(count)
  }
}));
const cost = (rows: ReturnType<typeof budgetSplatSelections>) =>
  rows.reduce(
    (sum, row) =>
      sum +
      (row.blend < 1 ? hierarchy[row.level].source.positions.length / 3 : 0) +
      (row.blend > 0 ? hierarchy[row.level + 1].source.positions.length / 3 : 0),
    0
  );
it('retains every owner within a finite submission budget and prioritizes close screen error', () => {
  const input = Array.from({length: 100}, (_, owner) => ({
    owner,
    pixels: owner === 0 ? 100 : 1,
    level: 0,
    blend: 0
  }));
  const rows = budgetSplatSelections(input, hierarchy, 2100);
  expect(new Set(rows.map(row => row.owner))).toEqual(new Set(input.map(row => row.owner)));
  expect(cost(rows)).toBeLessThanOrEqual(2100);
  expect(rows[0].level).toBe(0);
  expect(rows.filter(row => row.level === 0)).toHaveLength(1);
});
it('uses focus only to order equal requested refinements under a finite budget', () => {
  const rows = budgetSplatSelections(
    [
      {owner: 'edge', pixels: 100, focus: 0.1, level: 0, blend: 0},
      {owner: 'center', pixels: 100, focus: 1, level: 0, blend: 0}
    ],
    hierarchy,
    110
  );
  expect(rows.map(row => row.level)).toEqual([2, 1]);
});
it("allocates an underfunded homogeneous source by each owner's projected error", () => {
  const coarseToFine: SplatHierarchy = [64, 8, 1].map((count, i) => ({
    error: i,
    source: {
      positions: new Float32Array(count * 3),
      scales: new Float32Array(count * 3).fill(1),
      rotations: new Float32Array(count * 4),
      colors: new Uint8Array(count * 4),
      opacities: new Float32Array(count)
    }
  }));
  const input = Array.from({length: 10}, (_, owner) => ({
    owner,
    pixels: owner === 0 ? 10 : 1,
    focus: 1,
    level: 0,
    blend: 0
  }));

  // The coverage floor costs 10; one refined row costs eight. The highest-error visible crown
  // must refine while the lower-error peers retain the coarser coverage representation.
  const coarse = budgetSplatSelections(input, coarseToFine, 18);
  expect(coarse[0].level).toBe(1);
  expect(coarse.slice(1).map(row => row.level)).toEqual(Array(9).fill(2));
  expect(
    coarse.reduce((sum, row) => sum + coarseToFine[row.level].source.positions.length / 3, 0)
  ).toBe(17);

  const refined = budgetSplatSelections(input, coarseToFine, 640);
  expect(new Set(refined.map(row => row.level))).toEqual(new Set([0]));
});
it('prioritizes remaining error to each citrus canopy target under a shared cap', () => {
  const citrusCounts = [6144, 4391, 1157, 176, 38, 8, 1];
  const citrusHierarchy: SplatHierarchy = citrusCounts.map((count, index) => ({
    error: [
      0, 0.03232122715966811, 0.06869422530318484, 0.13654097353067618, 0.27095169287604753,
      0.46030788025291497, 0.6025191499333589
    ][index],
    source: {
      positions: new Float32Array(count * 3),
      scales: new Float32Array(count * 3).fill(1),
      rotations: new Float32Array(count * 4),
      colors: new Uint8Array(count * 4),
      opacities: new Float32Array(count)
    }
  }));
  const rows = budgetSplatSelections(
    [
      {owner: 'near', pixels: 50, level: 0, blend: 0},
      ...Array.from({length: 100}, (_, index) => ({
        owner: `far-${index}`,
        pixels: 6,
        level: 5,
        blend: 0
      }))
    ],
    citrusHierarchy,
    5000
  );

  // The close L0 target still has 3.4px of error at L2. Each far L5 target has only 0.85px
  // remaining at L6, even though its absolute coarse-level error is higher. Ranking absolute
  // error would promote every far owner first and leave the close owner at L2.
  expect(rows[0].level).toBe(1);
  expect(rows.slice(1).some(row => row.level > rows[0].level)).toBe(true);
  expect(rows.slice(1).some(row => row.level === 5)).toBe(true);
  expect(rows.slice(1).some(row => row.level === 6)).toBe(true);
  expect(rows.reduce((sum, row) => sum + citrusCounts[row.level], 0)).toBeLessThanOrEqual(5000);
});
it('keeps unconstrained refinement and optical blends exactly, and reports a coverage floor by retaining owners', () => {
  const input = [{owner: 1, pixels: 20, level: 0, blend: 0.3}];
  expect(budgetSplatSelections(input, hierarchy, Infinity)).toBe(input);
  const limited = budgetSplatSelections(input, hierarchy, 100);
  expect(cost(limited)).toBeLessThanOrEqual(100);
  expect(limited[0].blend).toBe(0);
  const belowFloor = budgetSplatSelections(input, hierarchy, 1);
  expect(belowFloor).toEqual([{owner: 1, pixels: 20, level: 2, blend: 0}]);
});
it('bounds camera and light selections across rapidly varying distances without opacity sampling', () => {
  for (const budget of [1000, 1200, 2200, 4000, 10000]) {
    const input = Array.from({length: 100}, (_, owner) => ({
      owner,
      pixels: Math.pow(2, owner % 14),
      level: 0,
      blend: 0.5
    }));
    const rows = budgetSplatSelections(input, hierarchy, budget);
    expect(cost(rows)).toBeLessThanOrEqual(budget);
    expect(rows).toHaveLength(input.length);
    expect(rows.every(row => row.blend >= 0 && row.blend < 1)).toBe(true);
  }
});

it('advances equal-cost refinement levels even when the budget is at its coverage floor', () => {
  const duplicate = [...hierarchy, {...hierarchy[2], error: 3}, {...hierarchy[2], error: 4}];
  const rows = budgetSplatSelections([{owner: 1, pixels: 1, level: 0, blend: 0}], duplicate, 10);
  expect(rows[0].level).toBe(2);
});

it('reaches fitting finer levels across expensive supplied intermediate representations', () => {
  const nonmonotonic = [hierarchy[1], {...hierarchy[0], error: 1}, hierarchy[2]];
  const rows = budgetSplatSelections(
    [0, 1].map(owner => ({owner, pixels: owner ? 1 : 10, level: 0, blend: 0})),
    nonmonotonic,
    150
  );
  expect(rows.map(row => row.level)).toEqual([0, 2]);
  expect(rows.reduce((sum, row) => sum + nonmonotonic[row.level].source.opacities.length, 0)).toBe(
    110
  );
});
