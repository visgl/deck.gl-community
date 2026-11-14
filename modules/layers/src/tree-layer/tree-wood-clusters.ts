// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {TREE_WOOD_FLAG, type TreeGrowthModel} from './tree-photoreal-layout';
import {
  getTreeClusterCellKey,
  getTreeClusterHeight,
  getTreeClusterSphere,
  rotateTreeClusterCenter,
  type TreeClusterBounds
} from './tree-cluster-bounds';

type WoodLimb = {position: [number, number, number]; factor: number; outer: boolean};

/** A spatial group of original wood triangles, with bounds enclosing every triangle vertex. */
export type TreeWoodCluster = {
  bounds: TreeClusterBounds;
  /** Largest radial displacement in mature trunk radii, independent of crown/height units. */
  radius: number;
  indices: Uint32Array;
  limbs: WoodLimb[];
};

export type TreeWoodSelection = {visible: Uint8Array; indices: Uint32Array};

const CLUSTERS = new WeakMap<TreeGrowthModel, Map<number, TreeWoodCluster[]>>();

function smooth(from: number, to: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** Cache triangle groups without simplifying or changing any original vertex attributes. */
export function getTreeWoodClusters(template: TreeGrowthModel, lod: number): TreeWoodCluster[] {
  let levels = CLUSTERS.get(template);
  if (!levels) {
    levels = new Map();
    CLUSTERS.set(template, levels);
  }
  const known = levels.get(lod);
  if (known) return known;
  const {center, previous, radial, bark, shade, indices, lodIndexCounts} = template.wood;
  const bins = new Map<
    string,
    {bounds: TreeClusterBounds; radius: number; indices: number[]; limbs: Set<number>}
  >();
  for (let triangle = 0; triangle < lodIndexCounts[lod]; triangle += 3) {
    const a = indices[triangle];
    const b = indices[triangle + 1];
    const c = indices[triangle + 2];
    // Roots and soil have already returned from the vertex shader for every eligible upright tree.
    const hidden = TREE_WOOD_FLAG.ROOT | TREE_WOOD_FLAG.SOIL;
    if (shade[a * 4 + 3] & hidden && shade[b * 4 + 3] & hidden && shade[c * 4 + 3] & hidden)
      continue;
    const x = (center[a * 4] + center[b * 4] + center[c * 4]) / 3;
    const y = (center[a * 4 + 1] + center[b * 4 + 1] + center[c * 4 + 1]) / 3;
    const z = (center[a * 4 + 2] + center[b * 4 + 2] + center[c * 4 + 2]) / 3;
    const key = getTreeClusterCellKey(x, y, z);
    let bin = bins.get(key);
    if (!bin) {
      bin = {bounds: [x, y, z, x, y, z], radius: 0, indices: [], limbs: new Set()};
      bins.set(key, bin);
    }
    for (const vertex of [a, b, c]) {
      const offset = vertex * 4;
      for (let axis = 0; axis < 3; axis++) {
        bin.bounds[axis] = Math.min(
          bin.bounds[axis],
          center[offset + axis],
          previous[offset + axis]
        );
        bin.bounds[axis + 3] = Math.max(
          bin.bounds[axis + 3],
          center[offset + axis],
          previous[offset + axis]
        );
      }
      bin.radius = Math.max(bin.radius, radial[offset + 3]);
      // A positive encoded id is an outer limb; a negative one is an inner limb.
      if (bark[offset + 2] > 0) bin.limbs.add(Math.round(bark[offset + 2]));
      if (bark[offset + 3] > 0) bin.limbs.add(-Math.round(bark[offset + 3]));
      bin.indices.push(vertex);
    }
  }
  const clusters = [...bins.values()].map(bin => ({
    bounds: bin.bounds,
    radius: bin.radius,
    indices: Uint32Array.from(bin.indices),
    limbs: [...bin.limbs].map(encoded => {
      const offset = Math.abs(encoded) * 8;
      const head = template.limbs;
      const stiff = smooth(0.1, 0.6, head[offset + 3]);
      const weight =
        1 -
        smooth(0.35, 0.42, head[offset + 3]) *
          (1 - smooth(0.025, 0.045, Math.hypot(head[offset], head[offset + 1])));
      return {
        position: [head[offset], head[offset + 1], head[offset + 2]] as [number, number, number],
        factor: (1 - 0.94 * Math.sqrt(stiff)) * weight,
        outer: encoded > 0
      };
    })
  }));
  levels.set(lod, clusters);
  return clusters;
}

/**
 * A sphere in tree-local metres, after proportions/yaw. Weak-wind padding bounds the shader's
 * whole-tree bend and both limb rotations at every gust/clock, so camera changes need no rebuild.
 * Storms, lean, breaks and decay use the original full draw instead.
 */
export function getTreeWoodClusterSphere(
  cluster: TreeWoodCluster,
  crownX: number,
  crownY: number,
  height: number,
  trunk: number,
  trunkRadius: number,
  forkZ: number,
  yaw: number,
  force: number
) {
  const sphere = getTreeClusterSphere(cluster.bounds, crownX, crownY, height, trunk, forkZ);
  const [x, y, z] = sphere.center;
  // The shader clamps visible wood just above the soil and slightly widens sub-pixel twigs.
  let radius = sphere.radius + cluster.radius * trunkRadius + 0.01;
  if (force > 0) {
    const curving =
      (1.3 * force ** 0.75 * Math.min(6 / Math.max(height, 1e-3), 3)) / (1 + 0.3 * force);
    let limbReach = 0;
    for (const outer of [false, true]) {
      let reach = 0;
      for (const limb of cluster.limbs) {
        if (limb.outer !== outer || limb.factor <= 0) continue;
        const length =
          Math.hypot(
            x - limb.position[0] * crownX,
            y - limb.position[1] * crownY,
            z - getTreeClusterHeight(limb.position[2], height, trunk, forkZ)
          ) +
          radius +
          limbReach;
        // sqrt(1.35^2 + .35^2 + .25^2) bounds the shader's along/across/up wind push.
        const angle = length * 0.5 * curving * limb.factor * 1.418;
        reach = Math.max(
          reach,
          length * (2 * Math.sin(Math.min(angle * 0.5, Math.PI * 0.5)) + (angle * angle) / 6)
        );
      }
      limbReach += reach;
    }
    // Strong-wind combing is excluded. For the ordinary bend, this bounds its chord and sag.
    const bend = 0.3 * (1 - Math.exp(-force / 0.3)) * Math.hypot(1.35, 0.12);
    const angle = 3 * bend;
    const across = Math.hypot(x, y) + radius;
    const vertical = Math.abs(z) + radius;
    radius +=
      limbReach +
      2 * across * Math.sin(angle * 0.5) +
      vertical * (angle * 0.5 + (angle * angle) / 6);
  }
  rotateTreeClusterCenter(sphere.center, yaw);
  sphere.radius = radius;
  return sphere;
}

/** Reuse the previous GPU index list until spatial-cluster visibility actually changes. */
export function selectTreeWoodClusters(
  clusters: readonly TreeWoodCluster[],
  intersects: (cluster: TreeWoodCluster, index: number) => boolean,
  previous: TreeWoodSelection | null
): TreeWoodSelection {
  const visible = new Uint8Array(clusters.length);
  let unchanged = previous?.visible.length === clusters.length;
  let count = 0;
  for (let index = 0; index < clusters.length; index++) {
    visible[index] = intersects(clusters[index], index) ? 1 : 0;
    if (visible[index]) count += clusters[index].indices.length;
    if (visible[index] !== previous?.visible[index]) unchanged = false;
  }
  if (unchanged && previous) return previous;
  const indices = new Uint32Array(count);
  let offset = 0;
  for (let index = 0; index < clusters.length; index++) {
    if (!visible[index]) continue;
    indices.set(clusters[index].indices, offset);
    offset += clusters[index].indices.length;
  }
  return {visible, indices};
}
