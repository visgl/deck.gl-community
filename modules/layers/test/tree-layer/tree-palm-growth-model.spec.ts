// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Vector3} from '@math.gl/core';
import {describe, expect, it} from 'vitest';
import {
  getTreeCropBornCount,
  getTreeCropReach,
  getTreeCropTable
} from '../../src/tree-layer/tree-crop';
import {
  getPalmFronds,
  getPalmTrunkRadius,
  PALM_LEAFLET_COUNT
} from '../../src/tree-layer/tree-palm';
import {createPalmGrowthModel} from '../../src/tree-layer/tree-palm-growth-model';
import {
  TREE_CROP_ANCHOR_STRIDE,
  TREE_LEAF_STRIDE,
  TREE_LIMB_STRIDE,
  type TreeGrowthModel
} from '../../src/tree-layer/tree-photoreal-layout';

const model = createPalmGrowthModel();
const fronds = getPalmFronds().filter(frond => !frond.spear);
const adultStart = Array.from({length: model.leafCount}, (_, index) => index).find(
  index => model.leaves[index * TREE_LEAF_STRIDE + 13] > 0
)!;

function getMatureVertex(template: TreeGrowthModel, vertex: number): Vector3 {
  const {wood} = template;
  const offset = vertex * 4;
  const radius = wood.radial[offset + 3] * template.trunkRatio!;
  return new Vector3(
    wood.center[offset] * template.crownAspect! + wood.radial[offset] * radius,
    wood.center[offset + 1] * template.crownAspect! + wood.radial[offset + 1] * radius,
    wood.center[offset + 2] + wood.radial[offset + 2] * radius
  );
}

describe('photoreal palm template', () => {
  it('packs deterministic seeded blades, wood, and valid limb records', () => {
    expect(createPalmGrowthModel()).toEqual(model);
    expect(createPalmGrowthModel(2).leaves).not.toEqual(model.leaves);
    const {leaves, leafCount, limbs, limbCount, wood} = model;
    expect(leafCount).toBe(adultStart + fronds.length * PALM_LEAFLET_COUNT * 2);
    expect(leaves).toHaveLength(leafCount * TREE_LEAF_STRIDE);
    expect(limbCount).toBe(1 + fronds.length);
    expect(limbs).toHaveLength(limbCount * TREE_LIMB_STRIDE);
    for (const stream of [wood.center, wood.previous, wood.radial, wood.bark, wood.shade]) {
      expect(stream).toHaveLength(wood.vertexCount * 4);
      expect(stream.every(Number.isFinite)).toBe(true);
    }
    expect(leaves.every(Number.isFinite)).toBe(true);
    expect(limbs.every(Number.isFinite)).toBe(true);
  });

  it('grows attached date bunches under mature frond axils', () => {
    const {cropAnchors, cropAnchorCount, limbCount, limbs} = model;
    const table = getTreeCropTable(model);
    expect(cropAnchors).toHaveLength(cropAnchorCount * TREE_CROP_ANCHOR_STRIDE);
    expect(cropAnchors.every(Number.isFinite)).toBe(true);
    expect(createPalmGrowthModel(2).cropAnchors).not.toEqual(cropAnchors);
    expect(getTreeCropBornCount(table, 0.62)).toBe(0);
    expect(getTreeCropBornCount(table, 1)).toBe(cropAnchorCount);
    expect(cropAnchorCount).toBeGreaterThanOrEqual(160);
    expect(getTreeCropReach(table, 1, 160)).toBeGreaterThanOrEqual(160);

    const bunches = new Map<number, number>();
    for (let offset = 0; offset < cropAnchors.length; offset += TREE_CROP_ANCHOR_STRIDE) {
      const [x, y, z, birth, outer, inner, seed] = cropAnchors.subarray(
        offset,
        offset + TREE_CROP_ANCHOR_STRIDE
      );
      expect(outer).toBe(0);
      expect(inner).toBeGreaterThan(0);
      expect(inner).toBeLessThan(limbCount);
      expect(birth).toBeGreaterThan(z);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(1);
      const [socketX, socketY, socketZ] = limbs.subarray(inner * TREE_LIMB_STRIDE);
      expect(x * socketX + y * socketY).toBeGreaterThan(0);
      expect(Math.hypot(x, y)).toBeLessThan(0.3);
      expect(Math.abs(z - socketZ)).toBeLessThan(0.08);
      bunches.set(inner, (bunches.get(inner) ?? 0) + 1);
    }
    expect(bunches.size).toBe(limbCount - 1);
    expect(new Set(bunches.values()).size).toBe(1);
  });

  it('fits frond sockets to the shaft with shaft growth before the fronds', () => {
    const {wood, limbs, limbCount} = model;
    const seen = new Set<number>();
    const spear = getPalmFronds().find(frond => frond.spear)!;
    const sourceHeight = spear.controls[3][2] + 1;
    for (let vertex = 0; vertex < wood.vertexCount; vertex++) {
      const offset = vertex * 4;
      const limb = wood.bark[offset + 3];
      expect(wood.previous[offset + 3]).toBeLessThanOrEqual(wood.center[offset + 3]);
      expect(wood.center[offset + 3]).toBeLessThan(1);
      if (!limb || seen.has(limb)) continue;
      seen.add(limb);
      const socket = limbs.subarray(limb * TREE_LIMB_STRIDE, limb * TREE_LIMB_STRIDE + 3);
      expect(wood.center.subarray(offset, offset + 3)).toEqual(socket);
      const z = socket[2] * sourceHeight - 1;
      expect(z).toBeCloseTo(fronds[limb - 1].controls[0][2], 6);
      const socketRadius = Math.hypot(socket[0], socket[1]) * model.crownAspect!;
      const shaftRadius = (getPalmTrunkRadius(z) / getPalmTrunkRadius(-1)) * model.trunkRatio!;
      expect(socketRadius).toBeLessThan(shaftRadius);
      const distances: number[] = [];
      for (
        let point = vertex;
        point < wood.vertexCount && wood.center[point * 4] === socket[0];
        point++
      ) {
        const position = getMatureVertex(model, point);
        const sourceZ = position.z * sourceHeight - 1;
        const surface = (getPalmTrunkRadius(sourceZ) / getPalmTrunkRadius(-1)) * model.trunkRatio!;
        distances.push(Math.hypot(position.x, position.y) - surface);
      }
      expect(Math.min(...distances)).toBeLessThan(0);
      expect(Math.max(...distances)).toBeGreaterThan(0);
    }
    expect(seen.size).toBe(limbCount - 1);
  });

  it('keeps the scarred shaft and shortens rachises in wood LOD prefixes', () => {
    const {wood} = model;
    const [full, near, middle, shaft] = wood.lodIndexCounts;
    expect(full).toBe(wood.indices.length);
    expect(full).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(shaft);
    expect(shaft).toBeGreaterThan(0);
    expect(wood.indices.every(vertex => vertex < wood.vertexCount)).toBe(true);
    expect(wood.indices.subarray(0, shaft).every(vertex => wood.bark[vertex * 4 + 3] === 0)).toBe(
      true
    );
    expect(wood.indices.subarray(shaft).every(vertex => wood.bark[vertex * 4 + 3] > 0)).toBe(true);
    const radii = new Set(
      Array.from(wood.indices.subarray(0, shaft), vertex => wood.radial[vertex * 4 + 3])
    );
    expect(radii.size).toBeGreaterThan(50);
    for (let index = 0; index < full; index += 3) {
      const a = getMatureVertex(model, wood.indices[index]);
      const b = getMatureVertex(model, wood.indices[index + 1]);
      const c = getMatureVertex(model, wood.indices[index + 2]);
      expect(b.subtract(a).cross(c.subtract(a)).len()).toBeGreaterThan(0);
    }
  });

  it('opens juvenile rosettes before the shaft elongates and replaces them with mature fronds', () => {
    const {leaves, wood, leafCount} = model;
    const countLeaves = (growth: number, from: number, to: number) => {
      let count = 0;
      for (let leaf = from; leaf < to; leaf++) {
        const offset = leaf * TREE_LEAF_STRIDE;
        if (leaves[offset + 8] < growth && growth < leaves[offset + 9]) count++;
      }
      return count;
    };
    expect(countLeaves(0, 0, leafCount)).toBe(0);
    expect(countLeaves(0.13, 1, adultStart)).toBeGreaterThanOrEqual(5);
    expect(countLeaves(0.13, adultStart, leafCount)).toBe(0);
    for (let vertex = 0; vertex < wood.vertexCount; vertex++) {
      const offset = vertex * 4;
      if (wood.center[offset + 3] <= 0.13) {
        expect(wood.center[offset + 2]).toBeLessThan(0.06);
      }
    }
    for (const growth of [0.23, 0.36, 0.52, 0.68, 0.8]) {
      expect(countLeaves(growth, 0, leafCount)).toBeGreaterThanOrEqual(5);
    }
    expect(countLeaves(1, 1, adultStart)).toBe(0);
    expect(countLeaves(1, adultStart, leafCount)).toBe(fronds.length * PALM_LEAFLET_COUNT * 2);
  });

  it('breaks older and more drooping fronds before upright new fronds', () => {
    for (const [index, frond] of fronds.entries()) {
      const threshold = model.limbs[(index + 1) * TREE_LIMB_STRIDE + 3];
      for (const [otherIndex, other] of fronds.entries()) {
        if (other.tier > frond.tier) {
          expect(model.limbs[(otherIndex + 1) * TREE_LIMB_STRIDE + 3]).toBeGreaterThan(threshold);
        }
      }
    }
  });

  it('keeps opposed slender leaflets on every frond even at the coarsest LOD', () => {
    const {leaves, lodLeafCounts, limbCount} = model;
    expect(lodLeafCounts[0]).toBe(model.leafCount);
    expect(lodLeafCounts[3]).toBe(adultStart + (limbCount - 1) * 2);
    expect(leaves[13]).toBe(0); // The unopened spear.
    const getDirection = (offset: number) =>
      new Vector3(1, 0, 0).transformByQuaternion(leaves.subarray(offset + 4, offset + 8));
    for (const count of lodLeafCounts) {
      const found = new Map<number, number>();
      for (let leaf = adultStart; leaf < count; leaf += 2) {
        const left = leaf * TREE_LEAF_STRIDE;
        const right = left + TREE_LEAF_STRIDE;
        const limb = leaves[left + 13];
        expect(limb).toBe(leaves[right + 13]);
        expect(getDirection(left).dot(getDirection(right))).toBeLessThan(-0.3);
        for (const offset of [left, right]) {
          expect(Math.hypot(...leaves.subarray(offset + 4, offset + 8))).toBeCloseTo(1, 6);
          expect(leaves[offset + 3]).toBeGreaterThan(0);
          expect(leaves[offset + 15]).toBeLessThan(0.12);
          expect(leaves[offset + 8]).toBeGreaterThan(0);
          expect(leaves[offset + 8]).toBeLessThan(1);
          expect(leaves[offset + 9]).toBeGreaterThan(1);
        }
        found.set(limb, (found.get(limb) ?? 0) + 2);
      }
      expect(found.size).toBe(limbCount - 1);
      expect(new Set(found.values()).size).toBe(1);
    }
  });
});
