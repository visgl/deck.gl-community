// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Fits a far tree's crown hull from a photoreal growth template: a star-shaped, low-poly mesh around the crown's
 * middle, whose reach in each direction is a high percentile of the leaves that lie that way, so its outline has the
 * template's own lobes. One hull per growth stage, on one shared grid of directions, so the vertex stage can blend
 * two stages by growth and every tree of every template is one draw.
 *
 * All positions are in template space (x and y in crown radii, z in heights), so a tree's own crown and height scale
 * them, as they do its leaves.
 */

import type {TreeGrowthModel} from '../../../../modules/layers/src/tree-layer/tree-photoreal-layout';

/** A grid of directions: rings of `azimuths` vertices at these elevations, and a pole below and above. */
export type ShellGrid = {
  azimuths: number;
  /** Elevations of the rings, in degrees, bottom to top, between the poles. */
  elevations: readonly number[];
};

/** 10 x 5 rings and two poles: 52 vertices and 100 triangles. */
export const SHELL_GRID_FINE: ShellGrid = {azimuths: 10, elevations: [-62, -38, -14, 12, 42]};
/** 6 x 3 and two poles: 20 vertices and 36 triangles, for the shadow pass and for trees a few dozen pixels across. */
export const SHELL_GRID_COARSE: ShellGrid = {azimuths: 6, elevations: [-45, -8, 38]};
/** 5 and two poles: 7 vertices and 10 triangles, for trees a few pixels across. */
export const SHELL_GRID_TINY: ShellGrid = {azimuths: 5, elevations: [-12]};

/** Growth at which hulls are fitted. The vertex stage blends the two around a tree's growth. */
export const SHELL_STAGES: readonly number[] = [0.03, 0.08, 0.14, 0.22, 0.32, 0.45, 0.6, 0.8, 1.0];
/** Optical depth at which the shell renderer treats a crown as opaque. */
export const SHELL_OPAQUE_TAU = 2;

/** Texels per vertex: position and normal. */
const VERTEX_TEXELS = 2;

export function getShellVertexCount(grid: ShellGrid): number {
  return grid.azimuths * grid.elevations.length + 2;
}

/** Vertex index of (ring, azimuth): ring 0 is the bottom pole, ring `rings + 1` the top pole. */
export function getShellVertexIndex(grid: ShellGrid, ring: number, azimuth: number): number {
  const rings = grid.elevations.length;
  if (ring <= 0) return 0;
  if (ring >= rings + 1) return 1 + rings * grid.azimuths;
  return (
    1 + (ring - 1) * grid.azimuths + (((azimuth % grid.azimuths) + grid.azimuths) % grid.azimuths)
  );
}

/**
 * The hull as one triangle strip, band by band from the bottom pole to the top, joined by degenerate triangles.
 * Each entry is a vertex index. Winding alternates in a strip, and culling is off, so it does not matter.
 */
export function getShellStrip(grid: ShellGrid): Uint16Array {
  const rings = grid.elevations.length;
  const strip: number[] = [];
  for (let band = 0; band <= rings; band++) {
    const first = strip.length;
    for (let a = 0; a <= grid.azimuths; a++) {
      strip.push(getShellVertexIndex(grid, band + 1, a), getShellVertexIndex(grid, band, a));
    }
    if (band > 0) {
      // Join to the previous band: repeat its last vertex and this band's first.
      strip.splice(first, 0, strip[first - 1], strip[first]);
    }
  }
  return Uint16Array.from(strip);
}

/** The unit direction of each grid vertex, in the hull's normalized space. */
function getShellDirections(grid: ShellGrid): Float32Array {
  const count = getShellVertexCount(grid);
  const out = new Float32Array(count * 3);
  const rings = grid.elevations.length;
  for (let ring = 0; ring <= rings + 1; ring++) {
    const elevation = ring === 0 ? -90 : ring === rings + 1 ? 90 : grid.elevations[ring - 1];
    const e = (elevation * Math.PI) / 180;
    const azimuths = ring === 0 || ring === rings + 1 ? 1 : grid.azimuths;
    for (let a = 0; a < azimuths; a++) {
      const az = (a / grid.azimuths) * Math.PI * 2;
      const index = getShellVertexIndex(grid, ring, a);
      out[index * 3] = Math.cos(e) * Math.cos(az);
      out[index * 3 + 1] = Math.cos(e) * Math.sin(az);
      out[index * 3 + 2] = Math.sin(e);
    }
  }
  return out;
}

/** Of a stage, what the vertex stage needs besides its vertices. */
export type ShellStageInfo = {
  growth: number;
  /** Leaves alive, as a fraction of the mature tree's. */
  leaves: number;
  /** Lowest and highest leaf, template z. */
  bottom: number;
  top: number;
};

export type ShellFitOptions = {
  /** Percentile of a direction's leaves that its vertex reaches. */
  percentile: number;
  /** How much a vertex is pulled toward the mean of its neighbours, 0-1. */
  smoothing: number;
};

export const DEFAULT_SHELL_FIT: ShellFitOptions = {percentile: 0.97, smoothing: 0.2};

/**
 * One template's hulls: `SHELL_STAGES.length` lines of `2 + 2 * vertices` RGBA texels. Texel 0 of a line is the
 * stage: leaves alive (fraction of the template's), half width (crown radii), lowest and highest leaf z. Texel 1 is
 * the template's: the area of all its leaves, in square metres at its reference height. Then per vertex: position
 * xyz and the median damage at which its leaves come off (2 if never), and normal xyz and how far in its median
 * leaf lies (0-1).
 */
export type ShellHull = {
  grid: ShellGrid;
  vertexCount: number;
  lineTexels: number;
  data: Float32Array;
  stages: ShellStageInfo[];
};

const RADIUS_BUCKETS = 96;
const RADIUS_MAX = 1.6;

/** Fits the hulls of every stage of one template. A few milliseconds per stage. */
export function fitShellHull(
  model: TreeGrowthModel,
  grid: ShellGrid,
  options: ShellFitOptions = DEFAULT_SHELL_FIT
): ShellHull {
  const vertexCount = getShellVertexCount(grid);
  const lineTexels = 2 + VERTEX_TEXELS * vertexCount;
  const data = new Float32Array(SHELL_STAGES.length * lineTexels * 4);
  const directions = getShellDirections(grid);
  const rings = grid.elevations.length;
  const {leaves, leafCount, limbs, limbCount} = model;
  const stages: ShellStageInfo[] = [];
  // Leaves are ellipses, width over length in component 15.
  let leafArea = 0;
  for (let leaf = 0; leaf < leafCount; leaf++) {
    const length = leaves[leaf * 16 + 3];
    leafArea += 0.785 * length * length * leaves[leaf * 16 + 15];
  }

  // When a leaf comes off with damage: the first limb under it, of those that break and fall, to break.
  const lossAt = new Float32Array(leafCount);
  for (let leaf = 0; leaf < leafCount; leaf++) {
    let loss = 2;
    for (const k of [12, 13]) {
      const limb = Math.round(leaves[leaf * 16 + k]);
      if (limb > 0 && limb < limbCount) {
        const breakAt = limbs[limb * 8 + 3];
        // A big limb stays attached and only swings down; its leaves stay on the tree.
        if (breakAt < 0.6) loss = Math.min(loss, breakAt);
      }
    }
    lossAt[leaf] = loss;
  }

  const histogram = new Float32Array(vertexCount * RADIUS_BUCKETS);
  const binCount = new Float32Array(vertexCount);
  const lossSum = new Float32Array(vertexCount);
  const lossSamples: number[][] = Array.from({length: vertexCount}, () => []);
  const reach = new Float32Array(vertexCount);
  const inner = new Float32Array(vertexCount);
  const smoothed = new Float32Array(vertexCount);
  const radial = new Float32Array(RADIUS_BUCKETS);

  for (let s = 0; s < SHELL_STAGES.length; s++) {
    const g = SHELL_STAGES[s];
    histogram.fill(0);
    binCount.fill(0);
    lossSum.fill(0);
    for (const list of lossSamples) list.length = 0;

    // The stage's crown: leaves born and not yet dead.
    let alive = 0;
    let bottom = Infinity;
    let top = -Infinity;
    radial.fill(0);
    for (let leaf = 0; leaf < leafCount; leaf++) {
      const birth = leaves[leaf * 16 + 8];
      const death = leaves[leaf * 16 + 9];
      if (birth > g || g >= death) continue;
      alive++;
      const z = leaves[leaf * 16 + 2];
      if (z < bottom) bottom = z;
      if (z > top) top = z;
      const r = Math.hypot(leaves[leaf * 16], leaves[leaf * 16 + 1]);
      radial[Math.min(RADIUS_BUCKETS - 1, Math.floor((r / RADIUS_MAX) * RADIUS_BUCKETS))]++;
    }
    let horizontal = 0.05;
    for (let b = 0, sum = 0; b < RADIUS_BUCKETS; b++) {
      sum += radial[b];
      if (sum >= alive * 0.97) {
        horizontal = ((b + 1) / RADIUS_BUCKETS) * RADIUS_MAX;
        break;
      }
    }
    if (!alive) {
      bottom = 0;
      top = 0.05;
    }
    const middle = (bottom + top) / 2;
    const halfHeight = Math.max((top - bottom) / 2, 0.01);
    const halfWidth = Math.max(horizontal, 0.01);
    // Leaves are shuffled, so any stride of them is an even sample of the crown: some 40,000 are plenty.
    const stride = Math.max(1, Math.floor(alive / 40000));

    for (let leaf = 0; leaf < leafCount; leaf += stride) {
      const birth = leaves[leaf * 16 + 8];
      const death = leaves[leaf * 16 + 9];
      if (birth > g || g >= death) continue;
      const qx = leaves[leaf * 16] / halfWidth;
      const qy = leaves[leaf * 16 + 1] / halfWidth;
      const qz = (leaves[leaf * 16 + 2] - middle) / halfHeight;
      const r = Math.hypot(qx, qy, qz);
      if (r < 1e-6) continue;
      const elevation = (Math.asin(Math.max(-1, Math.min(1, qz / r))) * 180) / Math.PI;
      // The nearest ring, by elevation, then the nearest azimuth on it.
      let ring = 0;
      let best = Math.abs(elevation + 90);
      for (let i = 0; i < rings; i++) {
        const d = Math.abs(elevation - grid.elevations[i]);
        if (d < best) {
          best = d;
          ring = i + 1;
        }
      }
      if (Math.abs(elevation - 90) < best) ring = rings + 1;
      const az = Math.atan2(qy, qx);
      const azimuth = Math.round((az / (Math.PI * 2)) * grid.azimuths);
      const vertex = getShellVertexIndex(grid, ring, azimuth);
      const bucket = Math.min(RADIUS_BUCKETS - 1, Math.floor((r / RADIUS_MAX) * RADIUS_BUCKETS));
      histogram[vertex * RADIUS_BUCKETS + bucket]++;
      binCount[vertex]++;
      if (lossSamples[vertex].length < 2048) lossSamples[vertex].push(lossAt[leaf]);
    }

    // Each vertex's reach: a high percentile of its leaves, and how far in its median leaf is.
    for (let v = 0; v < vertexCount; v++) {
      const n = binCount[v];
      if (n < 8) {
        reach[v] = Number.NaN;
        inner[v] = 0.5;
        continue;
      }
      let sum = 0;
      let p50 = -1;
      let pHigh = -1;
      for (let b = 0; b < RADIUS_BUCKETS; b++) {
        sum += histogram[v * RADIUS_BUCKETS + b];
        const r = ((b + 0.5) / RADIUS_BUCKETS) * RADIUS_MAX;
        if (p50 < 0 && sum >= n * 0.5) p50 = r;
        if (pHigh < 0 && sum >= n * options.percentile) pHigh = r;
      }
      reach[v] = pHigh;
      inner[v] = pHigh > 0 ? p50 / pHigh : 0.5;
    }
    // Directions with too few leaves borrow from their neighbours, a little short of them.
    for (let pass = 0; pass < 6; pass++) {
      for (let v = 0; v < vertexCount; v++) {
        if (!Number.isNaN(reach[v])) continue;
        let total = 0;
        let count = 0;
        forEachNeighbour(grid, v, u => {
          if (!Number.isNaN(reach[u])) {
            total += reach[u];
            count++;
          }
        });
        if (count) reach[v] = (total / count) * 0.85;
      }
    }
    for (let v = 0; v < vertexCount; v++) if (Number.isNaN(reach[v])) reach[v] = 0.5;
    for (let v = 0; v < vertexCount; v++) {
      let total = 0;
      let count = 0;
      forEachNeighbour(grid, v, u => {
        total += reach[u];
        count++;
      });
      smoothed[v] = count
        ? reach[v] * (1 - options.smoothing) + (total / count) * options.smoothing
        : reach[v];
    }

    const line = s * lineTexels * 4;
    data[line] = alive / leafCount;
    data[line + 1] = halfWidth;
    data[line + 2] = bottom;
    data[line + 3] = top;
    data[line + 4] = leafArea;
    stages.push({growth: g, leaves: alive / leafCount, bottom, top});

    // Positions in template space.
    const positions = new Float32Array(vertexCount * 3);
    for (let v = 0; v < vertexCount; v++) {
      const r = smoothed[v];
      positions[v * 3] = directions[v * 3] * r * halfWidth;
      positions[v * 3 + 1] = directions[v * 3 + 1] * r * halfWidth;
      positions[v * 3 + 2] = Math.max(middle + directions[v * 3 + 2] * r * halfHeight, 0);
    }
    // Normals from the faces around each vertex, in metres-like space (x, y crown radii, z heights).
    const normals = getShellNormals(grid, positions);
    for (let v = 0; v < vertexCount; v++) {
      const offset = line + 8 + v * VERTEX_TEXELS * 4;
      data[offset] = positions[v * 3];
      data[offset + 1] = positions[v * 3 + 1];
      data[offset + 2] = positions[v * 3 + 2];
      const samples = lossSamples[v].sort((a, b) => a - b);
      data[offset + 3] = samples.length ? samples[samples.length >> 1] : 2;
      data[offset + 4] = normals[v * 3];
      data[offset + 5] = normals[v * 3 + 1];
      data[offset + 6] = normals[v * 3 + 2];
      data[offset + 7] = inner[v];
    }
  }
  return {grid, vertexCount, lineTexels, data, stages};
}

function forEachNeighbour(grid: ShellGrid, vertex: number, callback: (u: number) => void): void {
  const rings = grid.elevations.length;
  const {azimuths} = grid;
  if (vertex === 0) {
    for (let a = 0; a < azimuths; a++) callback(getShellVertexIndex(grid, 1, a));
    return;
  }
  if (vertex === 1 + rings * azimuths) {
    for (let a = 0; a < azimuths; a++) callback(getShellVertexIndex(grid, rings, a));
    return;
  }
  const ring = 1 + Math.floor((vertex - 1) / azimuths);
  const azimuth = (vertex - 1) % azimuths;
  callback(getShellVertexIndex(grid, ring, azimuth - 1));
  callback(getShellVertexIndex(grid, ring, azimuth + 1));
  callback(getShellVertexIndex(grid, ring - 1, azimuth));
  callback(getShellVertexIndex(grid, ring + 1, azimuth));
}

/** Area-weighted vertex normals of the hull's triangles, pointing out. */
function getShellNormals(grid: ShellGrid, positions: Float32Array): Float32Array {
  const count = getShellVertexCount(grid);
  const normals = new Float32Array(count * 3);
  const rings = grid.elevations.length;
  const add = (a: number, b: number, c: number) => {
    const ax = positions[a * 3],
      ay = positions[a * 3 + 1],
      az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax,
      uy = positions[b * 3 + 1] - ay,
      uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax,
      vy = positions[c * 3 + 1] - ay,
      vz = positions[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      normals[i * 3] += nx;
      normals[i * 3 + 1] += ny;
      normals[i * 3 + 2] += nz;
    }
  };
  for (let band = 0; band <= rings; band++) {
    for (let a = 0; a < grid.azimuths; a++) {
      const lowA = getShellVertexIndex(grid, band, a);
      const lowB = getShellVertexIndex(grid, band, a + 1);
      const highA = getShellVertexIndex(grid, band + 1, a);
      const highB = getShellVertexIndex(grid, band + 1, a + 1);
      // Counter-clockwise seen from outside: low a, low b, high b and low a, high b, high a.
      if (lowA !== lowB) add(lowA, lowB, highB);
      if (highA !== highB) add(lowA, highB, highA);
    }
  }
  // Point away from the hull's axis, whatever the winding came to.
  let cx = 0,
    cy = 0,
    cz = 0;
  for (let v = 0; v < count; v++) {
    cx += positions[v * 3];
    cy += positions[v * 3 + 1];
    cz += positions[v * 3 + 2];
  }
  cx /= count;
  cy /= count;
  cz /= count;
  for (let v = 0; v < count; v++) {
    let nx = normals[v * 3],
      ny = normals[v * 3 + 1],
      nz = normals[v * 3 + 2];
    const dx = positions[v * 3] - cx,
      dy = positions[v * 3 + 1] - cy,
      dz = positions[v * 3 + 2] - cz;
    if (nx * dx + ny * dy + nz * dz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[v * 3] = nx / length;
    normals[v * 3 + 1] = ny / length;
    normals[v * 3 + 2] = nz / length;
  }
  return normals;
}
