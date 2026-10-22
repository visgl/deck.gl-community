// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it} from 'vitest';
import {
  retainSplatRows,
  getSplatChangedRanges,
  SplatRowSlots
} from '../../src/splat-layer/splat-row-diff';
it('preserves stable instance rows and uploads changing coverage and membership', () => {
  const before = [
    {id: 1, weight: 1},
    {id: 2, weight: 0.4}
  ];
  const equal = (a: (typeof before)[0], b: (typeof before)[0]) =>
    a.id === b.id && a.weight === b.weight;
  expect(
    retainSplatRows(
      before,
      before.map(row => ({...row})),
      equal
    )
  ).toBe(before);
  const after = retainSplatRows(before, [{...before[0]}, {id: 2, weight: 0.5}], equal);
  expect(after).not.toBe(before);
  expect(after[0]).toBe(before[0]);
  expect(getSplatChangedRanges(after, before)).toEqual([{startRow: 1, endRow: 2}]);
  expect(getSplatChangedRanges(before.slice(0, 1), before)).toEqual([]);
  expect(getSplatChangedRanges([...before, {id: 3, weight: 1}], before)).toEqual([
    {startRow: 2, endRow: 3}
  ]);
});
it('bounds driver calls for alternating LOD weights', () => {
  const before = Array.from({length: 20}, () => ({}));
  const after = before.map((row, i) => (i % 2 ? row : {}));
  expect(getSplatChangedRanges(after, before)).toEqual([{startRow: 0, endRow: 19}]);
  expect(getSplatChangedRanges(before)).toEqual([{startRow: 0, endRow: 20}]);
});

it('keeps instance slots when owners cross the view edge', () => {
  const slots = new SplatRowSlots<{id: number; weight: number}>();
  const rows = (ids: number[], weight = 1) => ids.map(id => ({id, weight}));
  const place = (next: {id: number; weight: number}[]) =>
    slots.update(
      next,
      next.map(row => row.id),
      (a, b) => a.id === b.id && a.weight === b.weight
    );
  const initial = place(rows([0, 1, 2, 3, 4, 5, 6, 7]));
  expect(initial.map(row => row.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  // Membership is unordered; an unchanged set keeps the whole list.
  expect(place(rows([7, 6, 5, 4, 3, 2, 1, 0]))).toBe(initial);

  // Owners 0 and 1 leave at one edge while 8 and 9 enter at the other. The arrivals take the
  // departed slots instead of shifting the six retained instances down by two rows.
  const moved = place(rows([2, 3, 4, 5, 6, 7, 8, 9]));
  expect(moved.map(row => row.id)).toEqual([8, 9, 2, 3, 4, 5, 6, 7]);
  expect(moved.slice(2)).toEqual(initial.slice(2));
  expect(moved[2]).toBe(initial[2]);
  expect(getSplatChangedRanges(moved, initial)).toEqual([{startRow: 0, endRow: 2}]);

  // Without arrivals, the tail fills the hole; with more arrivals, they append.
  const shrunk = place(rows([8, 9, 2, 4, 5, 6, 7]));
  expect(shrunk.map(row => row.id)).toEqual([8, 9, 2, 7, 4, 5, 6]);
  expect(getSplatChangedRanges(shrunk, moved)).toEqual([{startRow: 3, endRow: 4}]);
  const grown = place(rows([8, 9, 2, 4, 5, 6, 7, 10, 11]));
  expect(grown.map(row => row.id)).toEqual([8, 9, 2, 7, 4, 5, 6, 10, 11]);
  // A weight change rewrites only its own slot.
  const faded = place([...rows([8, 9, 2, 4, 5, 6, 7, 10]), {id: 11, weight: 0.5}]);
  expect(getSplatChangedRanges(faded, grown)).toEqual([{startRow: 8, endRow: 9}]);
  // Emptying and refilling restarts from the first slot.
  expect(place([])).toEqual([]);
  expect(place(rows([3])).map(row => row.id)).toEqual([3]);
});

it('bounds scattered slot uploads by merging the smallest unchanged gaps', () => {
  const before = Array.from({length: 4000}, () => ({}));
  // Forty isolated changes: four close pairs and widely spaced singles.
  const changed = new Set<number>();
  for (let i = 0; i < 36; i++) changed.add(i * 100 + 50);
  for (const row of [7, 12, 1007, 1012]) changed.add(row);
  const after = before.map((row, i) => (changed.has(i) ? {} : row));
  const ranges = getSplatChangedRanges(after, before);
  expect(ranges.length).toBeLessThanOrEqual(16);
  for (const row of changed)
    expect(ranges.some(range => range.startRow <= row && row < range.endRow)).toBe(true);
  // Rows close together share one range; one full-span upload would rewrite 4000 rows.
  for (const [a, b] of [
    [7, 12],
    [1007, 1012]
  ])
    expect(ranges.some(range => range.startRow <= a && b < range.endRow)).toBe(true);
  const uploaded = ranges.reduce((sum, range) => sum + range.endRow - range.startRow, 0);
  expect(uploaded).toBeLessThan(2500);
  expect(ranges.every((range, i) => i === 0 || range.startRow > ranges[i - 1].endRow)).toBe(true);
});
