// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {TreeGrowthModel} from './tree-photoreal-layout';
import {
  fitShellHull,
  getShellStrip,
  SHELL_GRID_COARSE,
  SHELL_GRID_FINE,
  SHELL_GRID_NEAR,
  SHELL_GRID_SHADOW,
  SHELL_GRID_TINY,
  SHELL_STAGES
} from './tree-shell-fit';

export type TreeShellMesh = {
  data: Float32Array;
  width: number;
  height: number;
  indices: Uint16Array;
  vertexCount: number;
  verticesPerHull: number;
};

const meshes = new WeakMap<TreeGrowthModel, Map<number, TreeShellMesh>>();
const grids = [SHELL_GRID_NEAR, SHELL_GRID_FINE, SHELL_GRID_COARSE, SHELL_GRID_TINY];

/** Fit one continuous silhouette, with fewer vertices for smaller crowns. */
export function getTreeShellMesh(
  model: TreeGrowthModel,
  level: number,
  caster = false
): TreeShellMesh {
  let cached = meshes.get(model);
  if (!cached) {
    cached = new Map();
    meshes.set(model, cached);
  }
  const key = caster ? grids.length : level;
  const existing = cached.get(key);
  if (existing) return existing;
  const grid = caster ? SHELL_GRID_SHADOW : grids[level];
  const {data, lineTexels, vertexCount} = fitShellHull(model, grid);
  const strip = getShellStrip(grid);
  const indices: number[] = [];
  for (let i = 2; i < strip.length; i++) {
    const a = strip[i - 2];
    const b = strip[i - 1];
    const c = strip[i];
    if (a === b || b === c || a === c) continue;
    indices.push(i % 2 ? b : a, i % 2 ? a : b, c);
  }
  const mesh = {
    data,
    width: lineTexels,
    height: SHELL_STAGES.length,
    indices: Uint16Array.from(indices),
    vertexCount,
    verticesPerHull: vertexCount
  };
  cached.set(key, mesh);
  return mesh;
}
