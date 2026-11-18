// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {
  getTreeCropBornCount,
  getTreeCropGeometry,
  getTreeCropReach,
  getTreeCropTable,
  TREE_CROP_PART,
  TREE_CROP_VERTEX_STRIDE,
  updateTreeCropCapacity,
  writeTreeCropRefs,
  type CropKind,
  type TreeCropCapacity
} from '../../src/tree-layer/tree-crop';
import {getTreeGrowthModel} from '../../src/tree-layer/tree-growth-model';
import {
  TREE_CROP_ANCHOR_STRIDE,
  TREE_CROP_RANK_LEVELS
} from '../../src/tree-layer/tree-photoreal-layout';

const KINDS: CropKind[] = ['fruit', 'lemon', 'cone', 'acorn', 'catkin', 'propagule', 'flower'];
const model = getTreeGrowthModel('citrus', {});
const table = getTreeCropTable(model);

function getBirth(anchor: number): number {
  return model.cropAnchors[anchor * TREE_CROP_ANCHOR_STRIDE + 3];
}

/** The first `count` anchors of the order that are born by `growth`, found the long way. */
function getFirstBorn(growth: number, count: number): number[] {
  const crops: number[] = [];
  for (const anchor of table.order) {
    if (crops.length === count) break;
    if (getBirth(anchor) <= growth) crops.push(anchor);
  }
  return crops;
}

describe('getTreeCropTable', () => {
  it('holds each anchor once, in an order that starts at the surface of the crown', () => {
    expect(new Set(table.order).size).toBe(model.cropAnchorCount);
    expect(new Set(table.byBirth).size).toBe(model.cropAnchorCount);
    const shell = (anchor: number) => model.cropAnchors[anchor * TREE_CROP_ANCHOR_STRIDE + 7];
    const mean = (anchors: ArrayLike<number>, from: number, to: number) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += shell(anchors[i]);
      return sum / (to - from);
    };
    expect(mean(table.order, 0, 300)).toBeGreaterThan(0.85);
    // Those that would touch another crop come after all the others, wherever they are.
    expect(mean(table.order, 0, 300)).toBeGreaterThan(mean(table.order, 2000, 2300) + 0.3);
  });

  it('keeps crops apart, in twos and threes, and bears down a crown as well as on its top', () => {
    const {referenceHeight: height} = model;
    const crown = height / 2;
    const at = (anchor: number) => {
      const offset = anchor * TREE_CROP_ANCHOR_STRIDE;
      return [
        model.cropAnchors[offset] * crown,
        model.cropAnchors[offset + 1] * crown,
        model.cropAnchors[offset + 2] * height
      ];
    };
    const first = Array.from(table.order.subarray(0, 900), at);
    const nearest = first.map((a, i) => {
      let closest = Infinity;
      first.forEach((b, j) => {
        if (i !== j) closest = Math.min(closest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      });
      return closest;
    });
    // None touches: a fruit is under 8 cm across. A good share have another within a hand or two.
    expect(Math.min(...nearest)).toBeGreaterThan(0.09);
    const withAnother = nearest.filter(apart => apart < 0.24).length / first.length;
    expect(withAnother).toBeGreaterThan(0.25);
    expect(withAnother).toBeLessThan(0.85);
    // Half of them no higher than most of the way up, for all that a crown's skin is mostly on top.
    const heights = first.map(position => position[2] / height).sort((a, b) => a - b);
    expect(heights[450]).toBeLessThan(0.7);
  });

  it('ranks an anchor by those born before it in the order, at every level', () => {
    for (const level of [0, 10, 20, 28, TREE_CROP_RANK_LEVELS - 1]) {
      const growth = level / (TREE_CROP_RANK_LEVELS - 1);
      let born = 0;
      for (const anchor of table.order) {
        expect(table.ranks[anchor * TREE_CROP_RANK_LEVELS + level]).toBe(born);
        if (getBirth(anchor) <= growth) born++;
      }
      expect(getTreeCropBornCount(table, growth)).toBe(born);
    }
  });

  it('is built once per template', () => {
    expect(getTreeCropTable(model)).toBe(table);
  });
});

describe('getTreeCropReach', () => {
  it('holds the first count anchors born by a level, and is no longer than it must be', () => {
    for (const level of [14, 18, 24, 30]) {
      const growth = level / (TREE_CROP_RANK_LEVELS - 1);
      for (const count of [1, 12, 100, 900]) {
        const first = getFirstBorn(growth, count);
        const reach = getTreeCropReach(table, growth, count);
        const prefix = new Set(Array.from(table.order).slice(0, reach));
        expect(first.every(anchor => prefix.has(anchor))).toBe(true);
        if (first.length === count)
          expect(getBirth(table.order[reach - 1])).toBeLessThanOrEqual(growth);
      }
    }
  });

  it('is the count itself on a grown tree', () => {
    expect(getTreeCropReach(table, 1, 300)).toBe(300);
    expect(getTreeCropReach(table, 1, 5.5)).toBe(6);
    expect(getTreeCropReach(table, 1, 1e6)).toBe(model.cropAnchorCount);
  });
});

describe('updateTreeCropCapacity', () => {
  const start = (growth: number, count: number): TreeCropCapacity => {
    const capacity = {capacity: 0, byBirth: false};
    updateTreeCropCapacity(capacity, table, growth, count, 1);
    return capacity;
  };

  it('rounds count up to a power of two on a grown tree', () => {
    expect(start(1, 300).capacity).toBe(512);
    expect(start(1, 64).capacity).toBe(64);
    expect(start(1, 65).capacity).toBe(128);
    expect(start(1, 300).byBirth).toBe(false);
  });

  it('holds within capacity, and takes a new one only past it or far below it', () => {
    const capacity = start(1, 100);
    expect(capacity.capacity).toBe(128);
    for (const count of [101, 128, 33, 90]) {
      expect(updateTreeCropCapacity(capacity, table, 1, count, 1)).toBe(false);
      expect(capacity.capacity).toBe(128);
    }
    expect(updateTreeCropCapacity(capacity, table, 1, 129, 1)).toBe(true);
    expect(capacity.capacity).toBe(256);
    expect(updateTreeCropCapacity(capacity, table, 1, 10, 1)).toBe(true);
    expect(capacity.capacity).toBe(16);
  });

  it('empties at count 0', () => {
    const capacity = start(1, 300);
    expect(updateTreeCropCapacity(capacity, table, 1, 0, 1)).toBe(true);
    expect(capacity.capacity).toBe(0);
  });

  it('covers a young tree with far fewer instances than the anchors its crops are scattered among', () => {
    const growth = 0.5;
    const count = 300;
    const capacity = start(growth, count);
    expect(capacity.byBirth).toBe(true);
    expect(capacity.capacity).toBeLessThan(600);
    const refs = new Float32Array(capacity.capacity * 3);
    writeTreeCropRefs(refs, 0, 7, capacity, table, 1);
    const anchors = new Set<number>();
    for (let i = 0; i < capacity.capacity; i++) {
      expect(refs[i * 3]).toBe(7);
      expect(refs[i * 3 + 2]).toBe(0);
      anchors.add(refs[i * 3 + 1]);
    }
    expect(getFirstBorn(growth, count).every(anchor => anchors.has(anchor))).toBe(true);
  });

  it('keeps covering as growth moves, with few changes of capacity', () => {
    const capacity = {capacity: 0, byBirth: false};
    let changes = 0;
    for (let growth = 0.2; growth <= 1; growth += 0.002) {
      if (updateTreeCropCapacity(capacity, table, growth, 300, 1)) changes++;
      const refs = new Float32Array(capacity.capacity * 3);
      writeTreeCropRefs(refs, 0, 0, capacity, table, 1);
      const anchors = new Set<number>();
      for (let i = 0; i < capacity.capacity; i++) anchors.add(refs[i * 3 + 1]);
      // Between levels a shader's rank is what the level below says at most.
      const level = Math.floor(growth * (TREE_CROP_RANK_LEVELS - 1));
      const levelGrowth = level / (TREE_CROP_RANK_LEVELS - 1);
      expect(getFirstBorn(levelGrowth, 300).every(anchor => anchors.has(anchor))).toBe(true);
    }
    expect(changes).toBeLessThan(12);
  });

  it('counts blossoms by cluster, and lays them out by twig', () => {
    const capacity = {capacity: 0, byBirth: false};
    updateTreeCropCapacity(capacity, table, 1, 2000, 5);
    expect(capacity.capacity).toBe(2048);
    const refs = new Float32Array(capacity.capacity * 3);
    writeTreeCropRefs(refs, 0, 0, capacity, table, 5);
    for (let blossom = 0; blossom < 15; blossom++) {
      expect(Math.floor(refs[blossom * 3 + 1] / 5)).toBe(table.order[Math.floor(blossom / 5)]);
      expect(refs[blossom * 3 + 1] % 5).toBe(blossom % 5);
    }
  });
});

describe('getTreeCropGeometry', () => {
  it.each(KINDS)('gives %s finite vertices, in-range indices and unit normals', kind => {
    for (const level of [0, 1, 2, 3] as const) {
      const {vertices, indices, vertexCount, indexCount, bodyIndexCount, shadowIndexCount} =
        getTreeCropGeometry(kind, level);
      expect(vertices.length).toBe(vertexCount * TREE_CROP_VERTEX_STRIDE);
      expect(vertices.every(Number.isFinite)).toBe(true);
      expect(indices.length).toBe(indexCount + shadowIndexCount);
      expect(bodyIndexCount).toBeLessThanOrEqual(indexCount);
      expect(bodyIndexCount).toBeGreaterThan(0);
      for (const index of indices) expect(index).toBeLessThan(vertexCount);
      for (let v = 0; v < vertexCount; v++) {
        const o = v * TREE_CROP_VERTEX_STRIDE;
        expect(Math.hypot(vertices[o + 3], vertices[o + 4], vertices[o + 5])).toBeCloseTo(1, 4);
      }
    }
  });

  it.each(
    KINDS.filter(kind => kind !== 'flower')
  )('keeps %s within the radius, with its faces out and a stem from its top', kind => {
    for (const level of [0, 1] as const) {
      const {vertices, indices, indexCount, vertexCount, top} = getTreeCropGeometry(kind, level);
      let stemVertices = 0;
      for (let v = 0; v < vertexCount; v++) {
        const o = v * TREE_CROP_VERTEX_STRIDE;
        if (vertices[o + 6] === TREE_CROP_PART.STEM) {
          stemVertices++;
          expect(vertices[o + 2]).toBeGreaterThanOrEqual(0);
          expect(vertices[o + 2]).toBeLessThanOrEqual(1);
        } else if (vertices[o + 6] === TREE_CROP_PART.BODY) {
          expect(Math.hypot(vertices[o], vertices[o + 1], vertices[o + 2])).toBeLessThanOrEqual(
            1.02
          );
        }
      }
      expect(stemVertices).toBeGreaterThan(0);
      expect(top).toBeGreaterThan(0.8);
      // The triangles of the body look away from its axis, but for some on the wrinkles of the rougher kinds, and
      // in the seat of a fruit's button and its navel, where a good many rings gather.
      let out = 0,
        triangles = 0;
      for (let i = 0; i < indexCount; i += 3) {
        const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map(
          index => index * TREE_CROP_VERTEX_STRIDE
        );
        if (vertices[a + 6] !== TREE_CROP_PART.BODY) continue;
        const u = [0, 1, 2].map(axis => vertices[b + axis] - vertices[a + axis]);
        const w = [0, 1, 2].map(axis => vertices[c + axis] - vertices[a + axis]);
        const nx = u[1] * w[2] - u[2] * w[1];
        const ny = u[2] * w[0] - u[0] * w[2];
        const x = vertices[a] + vertices[b] + vertices[c];
        const y = vertices[a + 1] + vertices[b + 1] + vertices[c + 1];
        triangles++;
        if (nx * x + ny * y > 0) out++;
      }
      expect(out / triangles).toBeGreaterThan(0.85);
    }
  });

  it('gives a fruit a slight neck at the stem, and a navel at the blossom end', () => {
    const {vertices, vertexCount, top} = getTreeCropGeometry('fruit', 0);
    // Its top and bottom edges, as height by distance from the axis.
    const upper = new Map<number, number>();
    const lower = new Map<number, number>();
    for (let v = 0; v < vertexCount; v++) {
      const o = v * TREE_CROP_VERTEX_STRIDE;
      if (vertices[o + 6] !== TREE_CROP_PART.BODY) continue;
      const rho = Number(Math.hypot(vertices[o], vertices[o + 1]).toFixed(3));
      (vertices[o + 2] >= 0 ? upper : lower).set(rho, vertices[o + 2]);
    }
    const near = (edge: Map<number, number>, rho: number) => {
      const key = [...edge.keys()].reduce((a, b) =>
        Math.abs(b - rho) < Math.abs(a - rho) ? b : a
      );
      return edge.get(key) as number;
    };
    // Going out from the stem, the slope is steepest off the neck, gentler past it, and steep again.
    const slope = (a: number, b: number) => (near(upper, a) - near(upper, b)) / (b - a);
    expect(slope(0.1, 0.18)).toBeGreaterThan(slope(0.24, 0.34));
    expect(slope(0.42, 0.52)).toBeGreaterThan(slope(0.24, 0.34));
    // The button sits in a seat, a little lower than the neck around it.
    expect(top).toBeLessThan(near(upper, 0.05) + 0.02);
    // The blossom end draws in at its middle.
    expect(near(lower, 0)).toBeGreaterThan(near(lower, 0.12));
  });

  it('makes a citrus fruit a little oblate, and a lemon longer than wide', () => {
    const extents = (kind: CropKind) => {
      const {vertices, vertexCount} = getTreeCropGeometry(kind, 0);
      let x = 0,
        z = 0;
      for (let v = 0; v < vertexCount; v++) {
        const o = v * TREE_CROP_VERTEX_STRIDE;
        if (vertices[o + 6] !== TREE_CROP_PART.BODY) continue;
        x = Math.max(x, Math.abs(vertices[o]));
        z = Math.max(z, Math.abs(vertices[o + 2]));
      }
      return z / x;
    };
    expect(extents('fruit')).toBeLessThan(1);
    expect(extents('fruit')).toBeGreaterThan(0.85);
    expect(extents('lemon')).toBeGreaterThan(1.2);
  });

  it('gives a blossom five petals, stamens and a stalk, and a far one a point per petal', () => {
    const fine = getTreeCropGeometry('flower', 0);
    const parts = new Set<number>();
    const petals = new Set<number>();
    for (let v = 0; v < fine.vertexCount; v++) {
      const o = v * TREE_CROP_VERTEX_STRIDE;
      parts.add(fine.vertices[o + 6]);
      if (fine.vertices[o + 6] === TREE_CROP_PART.PETAL) petals.add(fine.vertices[o + 2]);
    }
    expect(petals.size).toBe(5);
    for (const part of ['PETAL', 'FILAMENT', 'ANTHER', 'PISTIL', 'RECEPTACLE', 'STALK'] as const) {
      expect(parts.has(TREE_CROP_PART[part])).toBe(true);
    }
    const far = getTreeCropGeometry('flower', 3);
    expect(far.vertexCount).toBe(5);
    expect(far.bodyIndexCount).toBe(1);
  });

  it('shares cached crop geometry', () => {
    expect(getTreeCropGeometry('fruit', 0)).toBe(getTreeCropGeometry('fruit', 0));
  });
});
