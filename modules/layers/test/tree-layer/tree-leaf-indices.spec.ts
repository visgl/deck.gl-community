// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Buffer, Device} from '@luma.gl/core';
import {expect, it, vi} from 'vitest';
import {TREE_LEAF_STRIDE, type TreeGrowthModel} from '../../src/tree-layer/tree-photoreal-layout';
import {
  getMatureTreeLeafIndices,
  type TreeTemplateResources
} from '../../src/tree-layer/tree-photoreal-primitive-layer';

it('retains original vertex IDs and preserves prefixes when removing inactive mature leaves', () => {
  const timings = [
    [0.4, 0.9],
    [0.4, 2],
    [1, 2],
    [0.4, 0.996],
    [0.4, 0.9959995]
  ];
  const leaves = new Float32Array(TREE_LEAF_STRIDE * timings.length);
  timings.forEach((timing, index) => leaves.set(timing, index * TREE_LEAF_STRIDE + 8));
  const template = {key: 'fixture', leaves} as TreeGrowthModel;
  const buffer = {} as Buffer;
  const createBuffer = vi.fn((_props: {data: Uint32Array}) => buffer);
  const device = {createBuffer} as unknown as Device;
  const resources: TreeTemplateResources = {} as TreeTemplateResources;
  const layout = {key: 'far', corners: 4, pattern: [0, 1, 2, 0, 2, 3]};

  const compact = getMatureTreeLeafIndices(device, resources, template, layout, timings.length);
  expect(compact?.buffer).toBe(buffer);
  expect(compact?.indexCounts).toEqual(Uint32Array.from([0, 0, 6, 6, 12, 18]));
  expect(createBuffer.mock.calls[0][0].data).toEqual(
    Uint32Array.from([4, 5, 6, 4, 6, 7, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19])
  );
  expect(getMatureTreeLeafIndices(device, resources, template, layout, timings.length)).toBe(
    compact
  );
  expect(createBuffer).toHaveBeenCalledTimes(1);
});
