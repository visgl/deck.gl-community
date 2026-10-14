import {expect, it} from 'vitest';
import {patchCubeArray} from '../src/patched-cube-array';
import type {Cube} from '../src/interfaces';

const cube: Cube = {
  ordinal: 0,
  position: [12, -20, 0],
  size: [10, 20, 0.05],
  color: [255, 0, 0, 255]
};
it('retains exit positions with complete zero-size transparent placeholders', () => {
  const exited = patchCubeArray(0, {}, [], [cube]);
  expect(exited).toEqual([
    {ordinal: 0, isEmpty: true, position: [12, -20, 0], size: [0, 0, 0], color: [0, 0, 0, 0]}
  ]);
  expect(cube.size).toEqual([10, 20, 0.05]);
  expect(patchCubeArray(0, {}, [cube], exited)[0]).toBe(cube);
});
it('preserves slots across reordering and sparse ordinals', () => {
  const other = {...cube, ordinal: 3};
  const slots = patchCubeArray(1, {}, [other, cube]);
  expect(slots).toHaveLength(4);
  expect(slots[0]).toBe(cube);
  expect(slots[3]).toBe(other);
  expect(slots[1]).not.toBe(slots[2]);
  expect(slots[1]).toMatchObject({ordinal: 1, position: [0, 0, 0], size: [0, 0, 0]});
});
it.each([-1, 0.5, NaN, Infinity])('rejects invalid ordinal %s', ordinal => {
  expect(() => patchCubeArray(0, {}, [{...cube, ordinal}])).toThrow('ordinals');
});
it('rejects duplicate ordinal slots', () => {
  expect(() => patchCubeArray(0, {}, [cube, {...cube}])).toThrow('Duplicate cube ordinal');
});

it('preserves direct Stage inputs without explicit ordinals using their array indices', () => {
  const slots = patchCubeArray(0, {}, [{...cube, ordinal: undefined}]);
  expect(slots[0]).toMatchObject({...cube, ordinal: 0});
});
