// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {TREE_WOOD_FLAG, type TreeGrowthModel} from '../../src/tree-layer/tree-photoreal-layout';
import {
  getTreeWoodClusters,
  getTreeWoodClusterSphere,
  selectTreeWoodClusters
} from '../../src/tree-layer/tree-wood-clusters';

function createTemplate(): TreeGrowthModel {
  const center = new Float32Array([
    0, 0, 0.2, 0, 0.2, 0, 0.2, 0, 0, 0.2, 0.4, 0, 4, 0, 0.5, 0, 4.2, 0, 0.5, 0, 4, 0.2, 0.7, 0, 0,
    0, -0.1, 0, 0.2, 0, -0.1, 0, 0, 0.2, -0.2, 0
  ]);
  const radial = new Float32Array(center.length);
  const shade = new Float32Array(center.length);
  for (let vertex = 0; vertex < center.length / 4; vertex++) {
    radial[vertex * 4] = 1;
    radial[vertex * 4 + 3] = 0.4;
    if (vertex >= 6) shade[vertex * 4 + 3] = TREE_WOOD_FLAG.ROOT;
  }
  return {
    forkZ: 0.3,
    wood: {
      center,
      previous: center.slice(),
      radial,
      shade,
      bark: new Float32Array(center.length),
      indices: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      lodIndexCounts: [9, 6, 3, 3]
    },
    limbs: new Float32Array(0)
  } as TreeGrowthModel;
}

describe('wood spatial clusters', () => {
  it('keeps original visible triangle indices and caches each template level', () => {
    const template = createTemplate();
    const clusters = getTreeWoodClusters(template, 0);
    expect(getTreeWoodClusters(template, 0)).toBe(clusters);
    expect(clusters).toHaveLength(2);
    const all = selectTreeWoodClusters(clusters, () => true, null);
    expect(Array.from(all.indices)).toEqual([0, 1, 2, 3, 4, 5]);
    const first = selectTreeWoodClusters(clusters, cluster => cluster.bounds[0] < 1, all);
    expect(Array.from(first.indices)).toEqual([0, 1, 2]);
    expect(selectTreeWoodClusters(clusters, cluster => cluster.bounds[0] < 1, first)).toBe(first);
    expect(template.wood.indices).toEqual(Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it('contains every original triangle vertex after non-uniform scaling, yaw and radial displacement', () => {
    const template = createTemplate();
    const clusters = getTreeWoodClusters(template, 0);
    const crownX = 2;
    const crownY = 4;
    const height = 8;
    const trunk = 1.1;
    const trunkRadius = 0.5;
    const yaw = 1.3;
    for (const cluster of clusters) {
      const sphere = getTreeWoodClusterSphere(
        cluster,
        crownX,
        crownY,
        height,
        trunk,
        trunkRadius,
        template.forkZ,
        yaw,
        0
      );
      for (const vertex of cluster.indices) {
        const o = vertex * 4;
        const x = template.wood.center[o] * crownX + template.wood.radial[o + 3] * trunkRadius;
        const y = template.wood.center[o + 1] * crownY;
        const z = template.wood.center[o + 2];
        const metres =
          z < template.forkZ
            ? (z / template.forkZ) * trunk
            : trunk + ((z - template.forkZ) / (1 - template.forkZ)) * (height - trunk);
        const turnedX = x * Math.cos(yaw) - y * Math.sin(yaw);
        const turnedY = x * Math.sin(yaw) + y * Math.cos(yaw);
        expect(
          Math.hypot(
            turnedX - sphere.center[0],
            turnedY - sphere.center[1],
            metres - sphere.center[2]
          )
        ).toBeLessThanOrEqual(sphere.radius);
      }
      const windy = getTreeWoodClusterSphere(
        cluster,
        crownX,
        crownY,
        height,
        trunk,
        trunkRadius,
        template.forkZ,
        yaw,
        0.035
      );
      expect(windy.radius).toBeGreaterThan(sphere.radius);
    }
  });
});
