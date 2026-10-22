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

    // Without a budget argument, the default budget bounds the search. Scoring a cell reads ring
    // 0 once, and the search reads it three more times while setting up.
    let ringZeroReads = 0;
    const counted = new Proxy([ring], {
      get(target, key, receiver) {
        if (key === '0') {
          ringZeroReads++;
        }
        return Reflect.get(target, key, receiver);
      }
    });
    expect(getPoleOfInaccessibility(counted, 0)).not.toBeNull();
    expect((ringZeroReads - 3) * ring.length).toBeLessThanOrEqual(
      DEFAULT_POLE_SEARCH_SEGMENT_TESTS
    );
    // Two default budgets of work take about 50 ms, but are timed out as generously as the thin
    // polygon case for the same reason: the assertions are on the counts.
  }, 30000);
});

/** Signed distance from a point to the nearest edge, positive inside: checks a pole's quality. */
function distanceToOutline(polygon: number[][][], [x, y]: [number, number]): number {
  let inside = false;
  let nearest = Infinity;
  for (const ring of polygon) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1];
      const [bx, by] = ring[i];
      if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) {
        inside = !inside;
      }
      const t = Math.max(
        0,
        Math.min(
          1,
          ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)
        )
      );
      nearest = Math.min(nearest, Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y));
    }
  }
  return inside ? nearest : -nearest;
}

describe('getPoleOfInaccessibility on known poles', () => {
  const precision = 1e-3;

  it('finds the center line of a rectangle', () => {
    // Every point on y = 1 with 1 <= x <= 3 is 1 from the outline.
    const rectangle = [
      [
        [0, 0],
        [4, 0],
        [4, 2],
        [0, 2],
        [0, 0]
      ]
    ];
    const pole = getPoleOfInaccessibility(rectangle, precision)!;
    expect(pole[1]).toBeCloseTo(1, 2);
    expect(pole[0]).toBeGreaterThanOrEqual(1 - precision);
    expect(pole[0]).toBeLessThanOrEqual(3 + precision);
    expect(distanceToOutline(rectangle, pole)).toBeGreaterThan(1 - precision);
  });

  it('finds the pole of a concave L-shape at its inner corner', () => {
    // Two 4-wide arms. The largest circle touches both outer edges and the reflex vertex (4, 4):
    // its center (c, c) solves c = sqrt(2) * (4 - c), so c = 8 - 4 * sqrt(2).
    const lShape = [
      [
        [0, 0],
        [10, 0],
        [10, 4],
        [4, 4],
        [4, 10],
        [0, 10],
        [0, 0]
      ]
    ];
    const expected = 8 - 4 * Math.SQRT2;
    const pole = getPoleOfInaccessibility(lShape, precision)!;
    expect(Math.hypot(pole[0] - expected, pole[1] - expected)).toBeLessThan(0.01);
    expect(distanceToOutline(lShape, pole)).toBeGreaterThan(expected - precision);
  });

  it('keeps out of a hole and finds the widest part beside it', () => {
    // A 10 x 10 square with a hole across its top: the widest part is the band 0 <= y <= 6,
    // whose poles lie on y = 3 for 3 <= x <= 7, 3 from the outline.
    const withHole = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0]
      ],
      [
        [1, 6],
        [1, 9],
        [9, 9],
        [9, 6],
        [1, 6]
      ]
    ];
    const pole = getPoleOfInaccessibility(withHole, precision)!;
    expect(pole[1]).toBeCloseTo(3, 2);
    expect(pole[0]).toBeGreaterThanOrEqual(3 - precision);
    expect(pole[0]).toBeLessThanOrEqual(7 + precision);
    expect(distanceToOutline(withHole, pole)).toBeGreaterThan(3 - precision);
  });

  it('does not place the pole in a large hole', () => {
    // A frame 2 wide around a 6 x 6 hole. The hole's center is 3 from the outline, but outside the
    // polygon. The poles lie in the frame's corners, where a circle touches two outer edges and
    // the hole's corner: its radius c solves c = sqrt(2) * (2 - c), so c = 4 - 2 * sqrt(2).
    const frame = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0]
      ],
      [
        [2, 2],
        [2, 8],
        [8, 8],
        [8, 2],
        [2, 2]
      ]
    ];
    const pole = getPoleOfInaccessibility(frame, precision)!;
    const radius = 4 - 2 * Math.SQRT2;
    expect(distanceToOutline(frame, pole)).toBeGreaterThan(radius - precision);
    expect(distanceToOutline(frame, pole)).toBeLessThan(radius + precision);
  });

  it('places a triangle pole at its incenter', () => {
    // A 3-4-5 right triangle has inradius 1 and incenter (1, 1).
    const triangle = [
      [
        [0, 0],
        [4, 0],
        [0, 3],
        [0, 0]
      ]
    ];
    const pole = getPoleOfInaccessibility(triangle, precision)!;
    expect(Math.hypot(pole[0] - 1, pole[1] - 1)).toBeLessThan(0.01);
    expect(distanceToOutline(triangle, pole)).toBeGreaterThan(1 - precision);
  });
});
