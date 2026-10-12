import {expect, it} from 'vitest';
import {patchSymbolArray} from '../src/patched-symbol-array';
import type {SymbolMark} from '../src/interfaces';
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
it('keeps square exit position, rotation and shape, and rejects invalid slots', () => {
  const square: SymbolMark = {...symbol(0), shape: 'square', angle: 0.5, position: [5, 5, 0]};
  const exited = patchSymbolArray([], [square]);
  expect(exited[0]).toMatchObject({position: [5, 5, 0], angle: 0.5, shape: 'square', radius: 0});
  expect(patchSymbolArray([], exited)).toBe(exited);
  expect(() => patchSymbolArray([symbol(0), symbol(0)], [])).toThrow('unique');
  expect(() => patchSymbolArray([symbol(-1)], [])).toThrow('non-negative');
});
