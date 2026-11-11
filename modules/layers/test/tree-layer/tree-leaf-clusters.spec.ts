// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Matrix4} from '@math.gl/core';
import {describe, expect, it} from 'vitest';
import {createSplatFrustum, intersectsSplatFrustum} from '../../src/splat-layer/splat-culling';
import {
  getTreeLeafClusters,
  getTreeLeafClusterSphere,
  intersectsTreeLeafClipBounds,
  selectTreeLeafClusters
} from '../../src/tree-layer/tree-leaf-clusters';
import {TREE_LEAF_STRIDE, type TreeGrowthModel} from '../../src/tree-layer/tree-photoreal-layout';

function template(): TreeGrowthModel {
  const positions: number[][] = [];
  for (let z = 0; z <= 10; z++)
    for (let y = -8; y <= 8; y++)
      for (let x = -8; x <= 8; x++) positions.push([x / 8, y / 8, z / 10]);
  const leaves = new Float32Array(positions.length * TREE_LEAF_STRIDE);
  positions.forEach((point, index) => leaves.set([...point, 0.04], index * TREE_LEAF_STRIDE));
  return {leaves, leafCount: positions.length} as TreeGrowthModel;
}

describe('near leaf spatial clusters', () => {
  it('keeps every leaf the pre-wind shader predicate may draw, including storm slack', () => {
    const model = template();
    const clusters = getTreeLeafClusters(model);
    const matrix = new Matrix4().perspective({fovy: 0.15, aspect: 1, near: 0.05, far: 30});
    matrix.multiplyRight(
      new Matrix4().lookAt({eye: [0, -1.5, 3], center: [0, 0, 3], up: [0, 0, 1]})
    );
    const norms: [number, number, number] = [
      Math.hypot(matrix[0], matrix[4], matrix[8]),
      Math.hypot(matrix[1], matrix[5], matrix[9]),
      Math.hypot(matrix[3], matrix[7], matrix[11])
    ];
    for (const force of [0, 0.03, 0.5, 1]) {
      const selected = selectTreeLeafClusters(
        clusters,
        0,
        cluster => {
          const {center, radius} = getTreeLeafClusterSphere(cluster, 2, 2, 6, 1, 0.3, 0, 1, 0, 0);
          return intersectsTreeLeafClipBounds(
            new Float64Array([...center, radius]),
            0,
            [...matrix],
            cluster.length * 1.5 + force * 6,
            norms
          );
        },
        null
      );
      const indices = new Set(selected.leaves);
      if (force === 0) expect(indices.size).toBeLessThan(model.leafCount * 0.5);
      for (let leaf = 0; leaf < model.leafCount; leaf++) {
        const offset = leaf * TREE_LEAF_STRIDE;
        const x = model.leaves[offset] * 2;
        const y = model.leaves[offset + 1] * 2;
        const z = model.leaves[offset + 2];
        const height = z < 0.3 ? z / 0.3 : 1 + ((z - 0.3) / 0.7) * 5;
        const cx = matrix[0] * x + matrix[4] * y + matrix[8] * height + matrix[12];
        const cy = matrix[1] * x + matrix[5] * y + matrix[9] * height + matrix[13];
        const cw = matrix[3] * x + matrix[7] * y + matrix[11] * height + matrix[15];
        const slack = model.leaves[offset + 3] * 1.5 + force * 6;
        const slackW = slack * norms[2];
        if (
          Math.abs(cx) <= Math.abs(cw) + slackW + slack * norms[0] &&
          Math.abs(cy) <= Math.abs(cw) + slackW + slack * norms[1] &&
          cw >= -slackW
        )
          expect(indices.has(leaf)).toBe(true);
      }
    }
  });

  it('retains blades that can cross the camera or a side edge in a scaled perspective view', () => {
    const matrix = new Matrix4()
      .perspective({fovy: Math.PI / 2, aspect: 1, near: 0.01, far: 20})
      .scale(4);
    const norms: [number, number, number] = [
      Math.hypot(matrix[0], matrix[4], matrix[8]),
      Math.hypot(matrix[1], matrix[5], matrix[9]),
      Math.hypot(matrix[3], matrix[7], matrix[11])
    ];
    const frustum = createSplatFrustum({
      matrix: [...matrix],
      center: [0, 0, 0, 0],
      width: 256,
      height: 256
    });
    const cases = [
      {base: [0, 0, 0.04], tip: [0, 0, -0.009], slack: 0.05},
      {base: [0.095, 0, -0.07], tip: [0.081, 0, -0.084], slack: 0.02}
    ];
    for (const {base, tip, slack} of cases) {
      expect(intersectsSplatFrustum(base, 0, frustum)).toBe(false);
      expect(intersectsSplatFrustum(tip, 0, frustum)).toBe(true);
      expect(Math.hypot(...base.map((value, index) => value - tip[index]))).toBeLessThan(slack);
      expect(
        intersectsTreeLeafClipBounds(new Float64Array([...base, 0]), 0, matrix, slack, norms)
      ).toBe(true);
    }
  });

  it('partitions a shared template without losing or duplicating any original leaf index', () => {
    const model = template();
    const clusters = getTreeLeafClusters(model);
    expect(getTreeLeafClusters(model)).toBe(clusters);
    const indices = clusters.flatMap(cluster => [...cluster.leaves]).sort((a, b) => a - b);
    expect(indices).toEqual(Array.from({length: model.leafCount}, (_, index) => index));
  });

  it('keeps offscreen shadow-prefix leaves, and reuses data while the same clusters remain visible', () => {
    const clusters = getTreeLeafClusters(template());
    const visible = (cluster: (typeof clusters)[number]) => cluster.bounds[0] > 0.8;
    const selection = selectTreeLeafClusters(clusters, 200, visible, null);
    expect([...selection.leaves.slice(0, 200)]).toEqual(Array.from({length: 200}, (_, i) => i));
    expect(new Set(selection.leaves).size).toBe(selection.leaves.length);
    expect(selection.leaves.length).toBeLessThan(1000);
    expect(selection.visibleLeaves.length).toBeLessThan(selection.leaves.length);
    expect(selectTreeLeafClusters(clusters, 200, visible, selection)).toBe(selection);
    const empty = selectTreeLeafClusters(clusters, 0, () => false, selection);
    expect(empty.leaves.length).toBe(0);
  });

  it('never rejects a leaf motion sphere intersecting a perspective view at any tested yaw or proportion', () => {
    const model = template();
    const clusters = getTreeLeafClusters(model);
    const matrix = new Matrix4().perspective({fovy: 0.4, aspect: 1, near: 0.05, far: 30});
    matrix.multiplyRight(
      new Matrix4().lookAt({eye: [1.5, -2, 4], center: [0, 0, 3], up: [0, 0, 1]})
    );
    const frustum = createSplatFrustum({
      matrix: [...matrix],
      center: [0, 0, 0, 0],
      width: 512,
      height: 512
    });
    for (const [crownX, crownY, height, trunk, yaw] of [
      [2, 3, 6, 1, 0],
      [3, 1, 9, 3, 1.3],
      [0.5, 0.8, 2, 0.3, 4.7]
    ]) {
      const forkZ = 0.3;
      const leafScale = height / 6;
      const windReach = height * 0.1;
      const selection = selectTreeLeafClusters(
        clusters,
        0,
        cluster => {
          const sphere = getTreeLeafClusterSphere(
            cluster,
            crownX,
            crownY,
            height,
            trunk,
            forkZ,
            yaw,
            leafScale,
            windReach
          );
          return intersectsSplatFrustum(sphere.center, sphere.radius, frustum);
        },
        null
      );
      const selected = new Set(selection.leaves);
      let visibleCount = 0;
      for (let leaf = 0; leaf < model.leafCount; leaf++) {
        const offset = leaf * TREE_LEAF_STRIDE;
        const x = model.leaves[offset] * crownX;
        const y = model.leaves[offset + 1] * crownY;
        const z = model.leaves[offset + 2];
        const point = [
          x * Math.cos(yaw) - y * Math.sin(yaw),
          x * Math.sin(yaw) + y * Math.cos(yaw),
          z < forkZ ? (z / forkZ) * trunk : trunk + ((z - forkZ) / (1 - forkZ)) * (height - trunk)
        ];
        const radius = model.leaves[offset + 3] * leafScale * 8 + windReach;
        if (intersectsSplatFrustum(point, radius, frustum)) {
          visibleCount++;
          expect(selected.has(leaf)).toBe(true);
        }
      }
      expect(visibleCount).toBeGreaterThan(0);
    }
  });
});
