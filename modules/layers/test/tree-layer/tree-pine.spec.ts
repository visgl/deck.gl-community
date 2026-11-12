// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, it} from 'vitest';
import {
  TREE_CROP_ANCHOR_STRIDE,
  TREE_LEAF_STRIDE,
  TREE_LIMB_STRIDE
} from '../../src/tree-layer/tree-photoreal-layout';
import {createPineCrownTemplate, createPineGrowthModel} from '../../src/tree-layer/tree-pine';
import {getPineBladeOutline} from '../../src/tree-layer/tree-pine-needle';

it.each([1, 3, 5])('grows %i connected whorls along one tapered leader', levels => {
  const {nodes, whorls} = createPineCrownTemplate(levels, {seed: 8});
  expect(whorls).toHaveLength(levels);
  expect(nodes[0]).toMatchObject({position: [0, 0, 0], parent: -1, birth: 0, radius: 1});
  expect(nodes.find(node => node.position[2] === 1)?.position).toEqual([0, 0, 1]);
  const invalid = nodes.slice(1).filter((node, offset) => {
    const parent = nodes[node.parent];
    return (
      node.parent < 0 ||
      node.parent > offset ||
      node.birth <= parent.birth ||
      node.birth >= 1 ||
      node.radius >= parent.radius ||
      !node.position.every(Number.isFinite)
    );
  });
  expect(invalid).toHaveLength(0);

  const reach = whorls.map(socket => {
    const boughs = nodes.filter(node => node.order === 1 && node.parent === socket);
    expect(boughs).toHaveLength(5);
    const directions = boughs.map(({position: [x, y]}) =>
      Math.atan2(y - nodes[socket].position[1], x - nodes[socket].position[0])
    );
    expect(new Set(directions.map(angle => Math.round(angle * 10))).size).toBe(5);
    return Math.max(...boughs.map(({position: [x, y]}) => Math.hypot(x, y)));
  });
  if (levels > 1) expect(reach.at(-1)).toBeLessThan(reach[0] * 0.65);
});

it.each([
  {levels: 4, traits: {seed: 15}},
  {levels: 5, traits: {seed: 23, leafDensity: 0.25, branchDensity: 0.5, crownSpread: 0.6}}
])('packs attached needle pairs and keeps all $levels whorls at every LOD', ({levels, traits}) => {
  const template = createPineCrownTemplate(levels, traits);
  const {nodes, whorls, leaves, leafCount, lodLeafCounts, needleNodes} = template;
  expect(leaves).toHaveLength(leafCount * TREE_LEAF_STRIDE);
  expect(needleNodes).toHaveLength(leafCount);
  expect(leafCount).toBeGreaterThan(1_000);
  expect(lodLeafCounts).toEqual([1, 4, 16, 64].map(divisor => Math.ceil(leafCount / divisor)));

  const invalid: number[] = [];
  const fascicles = new Map<string, number>();
  for (const [index, support] of needleNodes.entries()) {
    const offset = index * TREE_LEAF_STRIDE;
    const [x, y, z, length, qx, qy, qz, qw, birth, death, , , , , t, widthRatio] = leaves.subarray(
      offset,
      offset + TREE_LEAF_STRIDE
    );
    const node = nodes[support];
    const parent = nodes[node.parent];
    const base = [x, y, z];
    if (
      length < 0.102 ||
      length > 0.17 ||
      widthRatio < 0.009 ||
      widthRatio > 0.024 ||
      Math.abs(Math.hypot(qx, qy, qz, qw) - 1) > 1e-6 ||
      birth <= parent.birth ||
      birth >= 1 ||
      death <= 1 ||
      base.some(
        (value, axis) =>
          Math.abs(
            value - (parent.position[axis] + (node.position[axis] - parent.position[axis]) * t)
          ) > 1e-6
      )
    ) {
      invalid.push(index);
    }
    const key = `${support}:${t}`;
    fascicles.set(key, (fascicles.get(key) ?? 0) + 1);
  }
  expect(invalid).toEqual([]);
  expect(new Set(fascicles.values())).toEqual(new Set([2]));

  const covered = new Set<number>();
  for (const support of needleNodes.subarray(0, lodLeafCounts[3])) {
    let anchor = support;
    while (nodes[anchor].order !== 0) anchor = nodes[anchor].parent;
    covered.add(anchor);
  }
  expect(whorls.every(socket => covered.has(socket))).toBe(true);
});

it('varies the seeded scaffold without moving wood for needle-only edits', () => {
  const first = createPineCrownTemplate(3, {seed: 5});
  const repeated = createPineCrownTemplate(3, {seed: 5});
  expect(repeated).toEqual(first);
  expect(createPineCrownTemplate(3, {seed: 6}).nodes).not.toEqual(first.nodes);
  const dense = createPineCrownTemplate(3, {seed: 5, leafDensity: 2});
  expect(dense.nodes).toEqual(first.nodes);
  expect(dense.leafCount).toBeGreaterThan(first.leafCount * 1.9);
});

it('packs wood, needles and attached crops under the same bough transforms', () => {
  const model = createPineGrowthModel(3, {seed: 8});
  const {wood, leaves, leafCount, limbs, limbCount, cropAnchors, cropAnchorCount} = model;
  expect(createPineGrowthModel(3, {seed: 8})).toBe(model);
  expect(createPineGrowthModel(4, {seed: 8}).key).not.toBe(model.key);
  expect(limbs).toHaveLength(limbCount * TREE_LIMB_STRIDE);
  expect(limbCount).toBe(3 * 5 + 1);
  expect(cropAnchors).toHaveLength(cropAnchorCount * TREE_CROP_ANCHOR_STRIDE);
  expect(cropAnchorCount).toBeGreaterThan(0);

  const [finest, detailed, coarse, stem] = wood.lodIndexCounts;
  expect(finest).toBe(wood.indices.length);
  expect(finest).toBeGreaterThan(detailed);
  expect(detailed).toBeGreaterThan(coarse);
  expect(coarse).toBeGreaterThan(stem);
  expect(stem).toBeGreaterThan(0);
  expect(wood.indices.every(index => index < wood.vertexCount)).toBe(true);
  expect(wood.indices.subarray(0, stem).every(index => wood.shade[index * 4 + 1] === 0)).toBe(true);
  expect(wood.indices.subarray(detailed).every(index => wood.shade[index * 4 + 1] >= 2)).toBe(true);

  const invalidVertices: number[] = [];
  const woodLimbs = new Set<number>();
  for (let index = 0; index < wood.vertexCount; index++) {
    const offset = index * 4;
    const limb = wood.bark[offset + 3];
    woodLimbs.add(limb);
    if (
      limb < 0 ||
      limb >= limbCount ||
      wood.previous[offset + 3] > wood.center[offset + 3] ||
      wood.center[offset + 3] >= 1 ||
      Math.abs(Math.hypot(...wood.radial.subarray(offset, offset + 3)) - 1) > 1e-6
    ) {
      invalidVertices.push(index);
    }
  }
  expect(invalidVertices).toEqual([]);

  const foliageLimbs = new Set<number>();
  for (let leaf = 0; leaf < leafCount; leaf++)
    foliageLimbs.add(leaves[leaf * TREE_LEAF_STRIDE + 13]);
  expect(foliageLimbs).toEqual(woodLimbs);
  for (let crop = 0; crop < cropAnchorCount; crop++) {
    const offset = crop * TREE_CROP_ANCHOR_STRIDE;
    expect(cropAnchors[offset + 5]).toBeGreaterThan(0);
    expect(woodLimbs.has(cropAnchors[offset + 5])).toBe(true);
  }
});

it('gives the needle a long taper instead of a broad blade with a petiole', () => {
  expect(getPineBladeOutline(0)).toBe(0);
  expect(getPineBladeOutline(1)).toBe(0);
  expect(getPineBladeOutline(0.045)).toBeGreaterThan(getPineBladeOutline(0.45));
  expect(getPineBladeOutline(0.45)).toBeGreaterThan(getPineBladeOutline(0.9));
  expect(getPineBladeOutline(0.9)).toBeGreaterThan(getPineBladeOutline(0.99));
});
