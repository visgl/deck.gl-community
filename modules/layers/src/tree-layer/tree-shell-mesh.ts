// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {TREE_LEAF_STRIDE, type TreeGrowthModel} from './tree-photoreal-layout';
import {
  fitShellHull,
  getShellStrip,
  SHELL_GRID_COARSE,
  SHELL_GRID_FINE,
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
const grids = [SHELL_GRID_FINE, SHELL_GRID_FINE, SHELL_GRID_COARSE, SHELL_GRID_TINY];

/** The middle tier uses overlapping fits of crown regions. Further tiers fit the whole crown. */
export function getTreeShellMesh(model: TreeGrowthModel, level: number): TreeShellMesh {
  let cached = meshes.get(model);
  if (!cached) {
    cached = new Map();
    meshes.set(model, cached);
  }
  const existing = cached.get(level);
  if (existing) return existing;
  const grid = grids[level];
  const clumps = Array.from({length: 8}, (): number[] => []);
  if (level === 0) {
    for (let leaf = 0; leaf < model.leafCount; leaf++) {
      const offset = leaf * TREE_LEAF_STRIDE;
      const [x, y, z] = model.leaves.subarray(offset, offset + 3);
      const half = z >= (1 + model.forkZ) * 0.5 ? 4 : 0;
      clumps[half + (x >= 0 ? 2 : 0) + (y >= 0 ? 1 : 0)].push(leaf);
    }
  }
  const regions = clumps.filter(indices => indices.length >= 24);
  const hulls = regions.length
    ? regions.map(indices => fitShellHull(model, grid, undefined, indices))
    : [fitShellHull(model, grid)];
  const {lineTexels, vertexCount: verticesPerHull} = hulls[0];
  const width = lineTexels;
  const height = hulls.length * SHELL_STAGES.length;
  const data = new Float32Array(width * height * 4);
  const strip = getShellStrip(grid);
  const indices: number[] = [];
  hulls.forEach((hull, index) => {
    data.set(hull.data, index * hull.data.length);
    // Expand the strip into indexed triangles so all clumps share a single draw.
    for (let i = 2; i < strip.length; i++) {
      const a = strip[i - 2],
        b = strip[i - 1],
        c = strip[i];
      if (a === b || b === c || a === c) continue;
      const first = index * verticesPerHull;
      indices.push(first + (i % 2 ? b : a), first + (i % 2 ? a : b), first + c);
    }
  });
  const mesh = {
    data,
    width,
    height,
    indices: Uint16Array.from(indices),
    vertexCount: hulls.length * verticesPerHull,
    verticesPerHull
  };
  cached.set(level, mesh);
  return mesh;
}
