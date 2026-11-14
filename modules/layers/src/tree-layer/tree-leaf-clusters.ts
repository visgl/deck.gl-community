// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  isMatureLeafRejected,
  TREE_LEAF_STRIDE,
  type TreeGrowthModel
} from './tree-photoreal-layout';

/** Bounds in template coordinates, containing the resting bases of a small spatial group of leaves. */
export type TreeLeafCluster = {
  bounds: readonly [number, number, number, number, number, number];
  length: number;
  leaves: Uint32Array;
  matureLeaves: Uint32Array;
};

export type TreeLeafSelection = {
  /** Camera-visible clusters, independent of the additional leaves needed to cast shadows. */
  visible: Uint8Array;
  /** Leaves in camera-visible clusters, retaining original template indices. */
  visibleLeaves: Uint32Array;
  /** Unfiltered count used to decide whether spatial clustering is worthwhile. */
  visibleLeafCount: number;
  matureOnly: boolean;
};

const CLUSTERS = new WeakMap<TreeGrowthModel, TreeLeafCluster[]>();

/**
 * Interval version of the shader's pre-wind XY/W rejection: discard a bin only when that same
 * condition necessarily rejects every base inside its sphere. Later deformation may cross Z planes,
 * so this deliberately never rejects by near/far depth.
 */
export function intersectsTreeLeafClipBounds(
  spheres: Float64Array,
  offset: number,
  matrix: readonly number[],
  slack: number,
  norms: readonly [number, number, number]
): boolean {
  const x = spheres[offset];
  const y = spheres[offset + 1];
  const z = spheres[offset + 2];
  const radius = spheres[offset + 3];
  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const slackW = slack * norms[2];
  const mostW = Math.abs(clipW) + radius * norms[2] + slackW;
  return !(
    Math.abs(clipX) - radius * norms[0] > mostW + slack * norms[0] ||
    Math.abs(clipY) - radius * norms[1] > mostW + slack * norms[1] ||
    clipW + radius * norms[2] < -slackW
  );
}

/** Conservative metre-space sphere after the tree's proportions and yaw, before its base translation. */
export function getTreeLeafClusterSphere(
  cluster: TreeLeafCluster,
  crownX: number,
  crownY: number,
  height: number,
  trunk: number,
  forkZ: number,
  yaw: number,
  leafScale: number,
  windReach: number,
  bladeMargin = 8
): {center: [number, number, number]; radius: number} {
  const [lowX, lowY, lowZ, highX, highY, highZ] = cluster.bounds;
  const zMetres = (z: number) =>
    z < forkZ ? (z / forkZ) * trunk : trunk + ((z - forkZ) / (1 - forkZ)) * (height - trunk);
  const x = (lowX + highX) * 0.5 * crownX;
  const y = (lowY + highY) * 0.5 * crownY;
  const low = zMetres(lowZ);
  const high = zMetres(highZ);
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return {
    center: [x * cosine - y * sine, x * sine + y * cosine, (low + high) * 0.5],
    // The longest blade, its inward hidden-leaf shift, and the wind's full reach. Eight leaf lengths
    // cover the coarse blade's largest hiddenScale (3), inward shift (3.6), outline and cupping.
    radius:
      Math.hypot((highX - lowX) * crownX, (highY - lowY) * crownY, high - low) * 0.5 +
      cluster.length * leafScale * bladeMargin +
      windReach
  };
}

/** Build spatial bounds once per shared template, without changing its leaf order or LOD prefixes. */
export function getTreeLeafClusters(template: TreeGrowthModel): TreeLeafCluster[] {
  const known = CLUSTERS.get(template);
  if (known) return known;
  const bins = new Map<string, {bounds: number[]; length: number; leaves: number[]}>();
  const {leaves, leafCount} = template;
  for (let leaf = 0; leaf < leafCount; leaf++) {
    const offset = leaf * TREE_LEAF_STRIDE;
    const x = leaves[offset];
    const y = leaves[offset + 1];
    const z = leaves[offset + 2];
    const key = `${Math.floor(x * 8)},${Math.floor(y * 8)},${Math.floor(z * 12)}`;
    let bin = bins.get(key);
    if (!bin) {
      bin = {bounds: [x, y, z, x, y, z], length: 0, leaves: []};
      bins.set(key, bin);
    }
    for (let axis = 0; axis < 3; axis++) {
      bin.bounds[axis] = Math.min(bin.bounds[axis], leaves[offset + axis]);
      bin.bounds[axis + 3] = Math.max(bin.bounds[axis + 3], leaves[offset + axis]);
    }
    bin.length = Math.max(bin.length, leaves[offset + 3]);
    bin.leaves.push(leaf);
  }
  const clusters = [...bins.values()].map(bin => {
    const indices = Uint32Array.from(bin.leaves);
    const matureLeaves = indices.filter(leaf => !isMatureLeafRejected(leaves, leaf));
    return {
      bounds: bin.bounds as unknown as TreeLeafCluster['bounds'],
      length: bin.length,
      leaves: indices,
      matureLeaves: matureLeaves.length === indices.length ? indices : matureLeaves
    };
  });
  CLUSTERS.set(template, clusters);
  return clusters;
}

/** Reuse the previous leaf list while the same clusters remain visible. */
export function selectTreeLeafClusters(
  clusters: readonly TreeLeafCluster[],
  intersects: (cluster: TreeLeafCluster) => boolean,
  previous: TreeLeafSelection | null,
  matureOnly = false
): TreeLeafSelection {
  const visible = new Uint8Array(clusters.length);
  let unchanged = previous?.matureOnly === matureOnly;
  let count = 0;
  let visibleLeafCount = 0;
  for (let index = 0; index < clusters.length; index++) {
    const cluster = clusters[index];
    if (intersects(cluster)) {
      visible[index] = 1;
      visibleLeafCount += cluster.leaves.length;
      count += matureOnly ? cluster.matureLeaves.length : cluster.leaves.length;
    }
    if (visible[index] !== previous?.visible[index]) unchanged = false;
  }
  if (unchanged && previous) return previous;

  const visibleLeaves = new Uint32Array(count);
  let offset = 0;
  for (let index = 0; index < clusters.length; index++) {
    if (!visible[index]) continue;
    const cluster = clusters[index];
    const leaves = matureOnly ? cluster.matureLeaves : cluster.leaves;
    visibleLeaves.set(leaves, offset);
    offset += leaves.length;
  }
  return {visible, visibleLeaves, visibleLeafCount, matureOnly};
}
