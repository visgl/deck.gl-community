// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test} from 'vitest';
import {fitMiniMap} from './mini-map';

test('fits wide and tall graphs and round-trips graph coordinates', () => {
  for (const points of [
    [
      [0, 0],
      [1000, 10]
    ],
    [
      [-5, -1000],
      [5, 1000]
    ]
  ] as [number, number][][]) {
    const transform = fitMiniMap(points)!;
    for (const point of points) {
      const projected = transform.project(point);
      expect(projected[0]).toBeGreaterThanOrEqual(12);
      expect(projected[0]).toBeLessThanOrEqual(188);
      expect(projected[1]).toBeGreaterThanOrEqual(12);
      expect(projected[1]).toBeLessThanOrEqual(138);
      const actual = transform.unproject(projected);
      expect(actual[0]).toBeCloseTo(point[0]);
      expect(actual[1]).toBeCloseTo(point[1]);
    }
  }
});

test('handles empty, invalid and coincident positions', () => {
  expect(fitMiniMap([])).toBeNull();
  expect(fitMiniMap([[NaN, 1]])).toBeNull();
  const transform = fitMiniMap([
    [10, 20],
    [Infinity, 0]
  ])!;
  expect(transform.project([10, 20])).toEqual([100, 75]);
  expect(transform.unproject([100, 75])).toEqual([10, 20]);
});
