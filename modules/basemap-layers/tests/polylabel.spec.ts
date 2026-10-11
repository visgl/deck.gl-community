// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {getPoleOfInaccessibility} from '../src/polylabel';

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
    const start = performance.now();
    const pole = getPoleOfInaccessibility(thin, 1e-12);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(pole).not.toBeNull();
    expect(pole![0]).toBeGreaterThanOrEqual(0);
    expect(pole![0]).toBeLessThanOrEqual(1);
  });

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
    const start = performance.now();
    const pole = getPoleOfInaccessibility([ring], 0);
    expect(performance.now() - start).toBeLessThan(5000);
    expect(pole).not.toBeNull();
  });
});
