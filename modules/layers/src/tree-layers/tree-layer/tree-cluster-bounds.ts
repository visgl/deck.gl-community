// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export type TreeClusterBounds = [number, number, number, number, number, number];

/** Leaves and wood use the same template-space grid. */
export function getTreeClusterCellKey(x: number, y: number, z: number): string {
  return `${Math.floor(x * 8)},${Math.floor(y * 8)},${Math.floor(z * 12)}`;
}

export function getTreeClusterHeight(z: number, height: number, trunk: number, forkZ: number) {
  return z < forkZ ? (z / forkZ) * trunk : trunk + ((z - forkZ) / (1 - forkZ)) * (height - trunk);
}

/** Resting bounds in metres. Each primitive adds its own displacement margin before culling. */
export function getTreeClusterSphere(
  [lowX, lowY, lowZ, highX, highY, highZ]: Readonly<TreeClusterBounds>,
  crownX: number,
  crownY: number,
  height: number,
  trunk: number,
  forkZ: number
): {center: [number, number, number]; radius: number} {
  const low = getTreeClusterHeight(lowZ, height, trunk, forkZ);
  const high = getTreeClusterHeight(highZ, height, trunk, forkZ);
  return {
    center: [(lowX + highX) * 0.5 * crownX, (lowY + highY) * 0.5 * crownY, (low + high) * 0.5],
    radius: Math.hypot((highX - lowX) * crownX, (highY - lowY) * crownY, high - low) * 0.5
  };
}

export function rotateTreeClusterCenter(center: [number, number, number], yaw: number): void {
  const [x, y] = center;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  center[0] = x * cosine - y * sine;
  center[1] = x * sine + y * cosine;
}
