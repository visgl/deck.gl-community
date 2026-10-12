import {expect, it} from 'vitest';
import {patchSymbolArray} from '../src/patched-symbol-array';
import type {SymbolMark, Polygon} from '../src/interfaces';
const symbol = (ordinal: number): SymbolMark => ({
  ordinal,
  datum: {id: ordinal},
  position: [ordinal * 20, 10, 0],
  radius: 5,
  fillColor: [255, 0, 0, 255],
  strokeColor: [0, 0, 0, 255],
  strokeWidth: 2
});
it('preserves circle slots through reordering, exits and reentry', () => {
  const initial = patchSymbolArray([symbol(0), symbol(1)], []);
  expect(patchSymbolArray([symbol(1), symbol(0)], initial)).toEqual(initial);
  const removed = patchSymbolArray([symbol(1)], initial);
  expect(removed[0]).toMatchObject({
    position: initial[0].position,
    radius: 0,
    isEmpty: true,
    datum: undefined,
    fillColor: [0, 0, 0, 0],
    strokeWidth: 0
  });
  expect(patchSymbolArray([], removed)).toHaveLength(2);
  expect(patchSymbolArray([symbol(0)], removed)[0].radius).toBe(5);
});
it('collapses square exits to their last center and rejects invalid slots', () => {
  const square: Polygon = {
    isSymbol: true,
    ordinal: 0,
    datum: {},
    positions: [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0]
    ],
    fillColor: [255, 0, 0, 255],
    strokeColor: [0, 0, 0, 255],
    strokeWidth: 1,
    depth: 0
  };
  expect(patchSymbolArray([], [square])[0].positions).toEqual(Array(4).fill([5, 5, 0]));
  expect(() => patchSymbolArray([symbol(0), symbol(0)], [])).toThrow('unique');
  expect(() => patchSymbolArray([symbol(-1)], [])).toThrow('non-negative');
});
