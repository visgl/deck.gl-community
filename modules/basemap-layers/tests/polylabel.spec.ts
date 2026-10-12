// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {DEFAULT_POLE_SEARCH_SEGMENT_TESTS, getPoleOfInaccessibility} from '../src/polylabel';

function square(size: number): number[][][] {
  return [
    [
      [0, 0],
      [size, 0],
      [size, size],
      [0, size],
      [0, 0]
    ]
  ];
}

describe('getPoleOfInaccessibility on hostile input', () => {
  it('bounds the initial grid for a long, thin polygon', () => {
    const thin = [
      [
        [0, 0],
        [1, 0],
        [1, 1e-9],
        [0, 1e-9],
        [0, 0]
      ]
    ];
    // The work is counted rather than timed, which coverage instrumentation and slow runners
    // would make flaky. With the grid cap, the search takes about 5e6 point-to-segment tests; an
    // uncapped grid starts with 1e9 cells, and would spend all of this larger budget. The 5e6
    // tests take about half a second, and over 5 seconds under coverage on a loaded machine, so
    // the test's timeout is raised: it only stops a hang.
    const budgetSize = 2e7;
    const budget = {segmentTests: budgetSize};
    const pole = getPoleOfInaccessibility(thin, 1e-12, budget);
    expect(budgetSize - budget.segmentTests).toBeLessThan(1e7);
    expect(pole).not.toBeNull();
    expect(pole![0]).toBeGreaterThanOrEqual(0);
    expect(pole![0]).toBeLessThanOrEqual(1);
  }, 30000);

  it('returns null for non-finite coordinates instead of looping', () => {
    const infinite = square(1);
    infinite[0][2] = [Infinity, 1];
    expect(getPoleOfInaccessibility(infinite, 0.01)).toBeNull();
    const notANumber = square(1);
    notANumber[0][1] = [NaN, 0];
    expect(getPoleOfInaccessibility(notANumber, 0.01)).toBeNull();
  });

  it('terminates for zero, negative or non-finite precision', () => {
    for (const precision of [0, -1, NaN, Infinity]) {
      const pole = getPoleOfInaccessibility(square(1), precision);
      expect(pole).not.toBeNull();
      expect(pole![0]).toBeCloseTo(0.5, 2);
      expect(pole![1]).toBeCloseTo(0.5, 2);
    }
  });

  it('bounds the work for a polygon with many near-equal candidate points', () => {
    // A comb: a thousand parallel slots, so many cells compete for the best distance.
    const ring: number[][] = [[0, 0]];
    for (let i = 0; i < 1000; i++) {
      ring.push([i * 2 + 1, 0], [i * 2 + 1, 100], [i * 2 + 2, 100], [i * 2 + 2, 0]);
    }
    ring.push([2001, 0], [2001, -1], [0, -1], [0, 0]);
    // Unbounded, this search takes about 9e9 point-to-segment tests. The budget stops it, without
    // overspending, and the best point found so far is returned.
    const budget = {segmentTests: DEFAULT_POLE_SEARCH_SEGMENT_TESTS};
    const pole = getPoleOfInaccessibility([ring], 0, budget);
    expect(budget.segmentTests).toBeGreaterThanOrEqual(0);
    expect(budget.segmentTests).toBeLessThan(ring.length);
    expect(pole).not.toBeNull();
  });
});
