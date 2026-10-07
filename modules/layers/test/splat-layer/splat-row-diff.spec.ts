// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it} from 'vitest';
import {retainSplatRows, getSplatChangedRanges} from '../../src/splat-layer/splat-row-diff';
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
