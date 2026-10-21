// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it, vi} from 'vitest';
import {
  getSplatSourceRow,
  updateSplatSourceHighlight
} from '../../src/splat-layer/splat-source-highlight';

const wrap = (parent: {id: string}, object: unknown, index: number) => ({
  __source: {parent, object, index}
});
function primitive(id: string, data: unknown) {
  return {
    id,
    isComposite: false,
    props: {data},
    getSubLayers: () => [],
    encodePickingColor: (i: number) => [(i + 1) & 255, ((i + 1) >> 8) & 255, 0],
    updateAutoHighlight: vi.fn()
  };
}

it('highlights one source owner across sub-layers with different row orders', () => {
  const root = {id: 'trees'};
  const objects = ['a', 'b', 'c', 'd'];
  // TreeLayer rows, as its wood and canopy children receive them.
  const rows = objects.map((object, index) => wrap(root, object, index));
  const canopy = {id: 'trees-canopy'};
  // SplatLayer wraps its own owner rows again; each refinement level holds a reordered subset.
  const owner = (index: number) => wrap(canopy, rows[index], index);
  const far = primitive('far-wood', [rows[3], rows[1]]);
  const near = primitive('near-wood', [rows[0], rows[2]]);
  const coarse = primitive('canopy-level-6', [owner(2), owner(3), owner(1)]);
  const fine = primitive('canopy-level-0', [owner(0)]);
  const composite = (id: string, children: unknown[]) => ({
    id,
    isComposite: true,
    getSubLayers: () => children
  });
  const layer = {
    ...root,
    isComposite: true,
    getSubLayers: () => [composite('wood', [far, near]), composite('canopy', [coarse, fine])]
  };

  updateSplatSourceHighlight(layer as any, {picked: true, index: 1, color: null} as any);
  expect(far.updateAutoHighlight.mock.lastCall![0]).toMatchObject({picked: true, index: 1});
  expect([...far.updateAutoHighlight.mock.lastCall![0].color]).toEqual([2, 0, 0]);
  expect(coarse.updateAutoHighlight.mock.lastCall![0]).toMatchObject({picked: true, index: 2});
  expect([...coarse.updateAutoHighlight.mock.lastCall![0].color]).toEqual([3, 0, 0]);
  // A sub-layer without the hovered owner must clear rather than highlight its own row 1.
  for (const absent of [near, fine])
    expect(absent.updateAutoHighlight.mock.lastCall![0]).toMatchObject({
      picked: false,
      color: null
    });

  updateSplatSourceHighlight(layer as any, {picked: false, index: -1, color: null} as any);
  for (const child of [far, near, coarse, fine])
    expect(child.updateAutoHighlight.mock.lastCall![0].color).toBeNull();
});

it('resolves source rows per root and ignores non-array data', () => {
  const root = {id: 'root'};
  const other = {id: 'other'};
  const data = [wrap(other, null, 0), wrap(root, null, 4), wrap(root, null, 4)];
  expect(getSplatSourceRow(data, 'root', 4)).toBe(1);
  expect(getSplatSourceRow(data, 'other', 0)).toBe(0);
  expect(getSplatSourceRow(data, 'root', 0)).toBe(-1);
  expect(getSplatSourceRow({length: 1}, 'root', 0)).toBe(-1);
});
