// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SphereGeometry, TruncatedConeGeometry} from '@luma.gl/engine';
import {Vector3} from '@math.gl/core';

/** Shared CPU mesh; uploaded and instanced by deck.gl's SimpleMeshLayer. */
export type TreeMesh = {
  attributes: {
    POSITION: {value: Float32Array; size: 3};
    NORMAL: {value: Float32Array; size: 3};
    COLOR_0: {value: Float32Array; size: 3};
    TEXCOORD_0: {value: Float32Array; size: 2};
  };
  indices: {value: Uint32Array; size: 1};
  topology: 'triangle-list';
  mode: 4;
};

/** Geometry detail, independent of the number of rendered instances. */
type TreeDetail = 'low' | 'medium' | 'high';
type Point = [number, number, number];
const DETAIL_SEGMENTS = {low: [8, 5], medium: [12, 8], high: [16, 10]} as const;

/** Deterministic random source. Separate seeds keep crop counts and shapes independent. */
export function createTreeRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x9e3779b9) | 0;
    let mixed = value ^ (value >>> 16);
    mixed = Math.imul(mixed, 0x21f0aaad);
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x735a2d97);
    return ((mixed ^ (mixed >>> 15)) >>> 0) / 4294967296;
  };
}

function createMesh(positions: Float32Array, sourceIndices: Uint32Array, shade = 1): TreeMesh {
  // Primitive generators include zero-area cap/pole faces. Remove them once,
  // before caching/uploading, so they never consume instanced draw work.
  const triangles: number[] = [];
  for (let i = 0; i < sourceIndices.length; i += 3) {
    const a = sourceIndices[i] * 3;
    const b = sourceIndices[i + 1] * 3;
    const c = sourceIndices[i + 2] * 3;
    const ab = [
      positions[b] - positions[a],
      positions[b + 1] - positions[a + 1],
      positions[b + 2] - positions[a + 2]
    ];
    const ac = [
      positions[c] - positions[a],
      positions[c + 1] - positions[a + 1],
      positions[c + 2] - positions[a + 2]
    ];
    const area = Math.hypot(
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0]
    );
    if (area > 1e-12) triangles.push(sourceIndices[i], sourceIndices[i + 1], sourceIndices[i + 2]);
  }
  const indices = new Uint32Array(triangles);
  const mesh: TreeMesh = {
    attributes: {
      POSITION: {value: positions, size: 3},
      NORMAL: {value: new Float32Array(positions.length), size: 3},
      COLOR_0: {value: new Float32Array(positions.length).fill(shade), size: 3},
      TEXCOORD_0: {value: new Float32Array((positions.length / 3) * 2), size: 2}
    },
    indices: {value: indices, size: 1},
    topology: 'triangle-list',
    mode: 4
  };
  computeNormals(mesh);
  return mesh;
}

/** Area-weighted normals for shared primitive vertices. */
function computeNormals(mesh: TreeMesh, weld = false): void {
  const p = mesh.attributes.POSITION.value;
  const n = mesh.attributes.NORMAL.value;
  const indices = mesh.indices.value;
  n.fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ab = new Vector3(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
    const ac = new Vector3(p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]);
    const normal = ab.cross(ac);
    for (const offset of [a, b, c]) {
      n[offset] += normal[0];
      n[offset + 1] += normal[1];
      n[offset + 2] += normal[2];
    }
  }
  if (weld) {
    const vertices = new Map<string, number[]>();
    for (let i = 0; i < p.length; i += 3) {
      const key = `${Math.round(p[i] * 1e6)},${Math.round(p[i + 1] * 1e6)},${Math.round(p[i + 2] * 1e6)}`;
      const offsets = vertices.get(key) ?? [];
      offsets.push(i);
      vertices.set(key, offsets);
    }
    for (const offsets of vertices.values()) {
      const sum = new Vector3();
      for (const offset of offsets) sum.add([n[offset], n[offset + 1], n[offset + 2]]);
      for (const offset of offsets) n.set(sum, offset);
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const length = Math.hypot(n[i], n[i + 1], n[i + 2]);
    if (length > 1e-12) {
      n[i] /= length;
      n[i + 1] /= length;
      n[i + 2] /= length;
    } else {
      n[i + 2] = 1;
    }
  }
}

function createSphere(
  radius: number,
  detail: TreeDetail,
  center: Point,
  scale: Point = [1, 1, 1],
  seed = 0
): TreeMesh {
  const [nlong, nlat] = DETAIL_SEGMENTS[detail];
  const geometry = new SphereGeometry({radius, nlong, nlat});
  const positions = new Float32Array(geometry.attributes.POSITION.value);
  const rng = createTreeRng(seed);
  const waves = Array.from({length: 4}, () => [
    2 + rng() * 3,
    2 + rng() * 3,
    2 + rng() * 3,
    rng() * Math.PI * 2
  ]);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const r = Math.hypot(x, y, z);
    const noise =
      seed && r
        ? waves.reduce(
            (sum, wave) =>
              sum + Math.sin((x / r) * wave[0] + (y / r) * wave[1] + (z / r) * wave[2] + wave[3]),
            0
          ) * 0.035
        : 0;
    // luma spheres are Y-up. Transform directly into the layer's Z-up frame.
    positions[i] = center[0] + x * scale[0] * (1 + noise);
    positions[i + 1] = center[1] - z * scale[1] * (1 + noise);
    positions[i + 2] = center[2] + y * scale[2] * (1 + noise);
  }
  const mesh = createMesh(positions, new Uint32Array(geometry.indices!.value));
  computeNormals(mesh, true);
  return mesh;
}

function createBranch(
  start: Point,
  end: Point,
  bottomRadius: number,
  topRadius: number,
  segments = 6
): TreeMesh {
  const axis = new Vector3(end).subtract(start);
  const length = axis.len();
  axis.normalize();
  const u = new Vector3(Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]).cross(axis).normalize();
  const v = new Vector3(axis).cross(u).normalize();
  const geometry = new TruncatedConeGeometry({
    bottomRadius,
    topRadius,
    height: length,
    nradial: segments,
    nvertical: 1,
    topCap: true,
    bottomCap: true,
    verticalAxis: 'z'
  });
  const positions = new Float32Array(geometry.attributes.POSITION.value);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2] + length / 2;
    for (let j = 0; j < 3; j++) positions[i + j] = start[j] + u[j] * x + v[j] * y + axis[j] * z;
  }
  return createMesh(positions, new Uint32Array(geometry.indices!.value));
}

/** A tapered Z-up trunk with the legacy unit bounds. */
export function createTrunkMesh(segments = 10): TreeMesh {
  return createBranch([0, 0, 0], [0, 0, 1], 1, 0.7, segments);
}

/** Palm bark scars use subdued geometry on one tapered shaft. */
export function createDatePalmTrunkMesh(segments = 10, scarRings = 14): TreeMesh {
  const p: number[] = [];
  const indices: number[] = [];
  const rings = scarRings * 3 + 2;
  for (let ring = 0; ring <= rings; ring++) {
    const z = ring / rings;
    const scar = Math.pow((1 + Math.cos(z * scarRings * Math.PI * 2)) / 2, 10) * 0.025;
    const radius = 1 - z * 0.2 + scar;
    for (let segment = 0; segment <= segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2;
      p.push(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
      if (ring < rings && segment < segments) {
        const a = ring * (segments + 1) + segment;
        const b = a + segments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  return createMesh(new Float32Array(p), new Uint32Array(indices));
}

const PINE_TIER_CACHE = new Map<number, ReturnType<typeof generatePineTiers>>();
export function createPineTiers(levels: number) {
  levels = Math.max(1, Math.min(5, Math.round(levels) || 3));
  let tiers = PINE_TIER_CACHE.get(levels);
  if (!tiers) {
    tiers = generatePineTiers(levels);
    PINE_TIER_CACHE.set(levels, tiers);
  }
  return tiers;
}

function generatePineTiers(levels: number) {
  const rng = createTreeRng(levels * 2654435761);
  const tierHeight = 1.6 / (levels + 1);
  const tiers: {base: Point; radius: number; height: number}[] = [];
  let z = 0;
  for (let i = 0; i < levels; i++) {
    const t = i / (levels - 1 || 1);
    const radius = (1 - t * 0.5) * 0.85 * (0.8 + rng() * 0.4);
    const height = tierHeight * (0.85 + rng() * 0.3);
    const drift = levels > 1 ? i / (levels - 1) : 0;
    tiers.push({
      base: [(rng() - 0.5) * 0.2 * drift, (rng() - 0.5) * 0.2 * drift, z],
      radius,
      height
    });
    z += tierHeight / 2;
  }
  return {
    tiers,
    tipStart: [(rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08, z - 0.06] as Point,
    tipEnd: [0, 0, z + 0.16] as Point
  };
}

/** Place supplied pine crop points against the outer tier envelope. */
export function samplePineSurface(levels: number, z: number, theta: number): Point {
  const direction = [Math.cos(theta), Math.sin(theta)];
  let distance = 0;
  for (const tier of createPineTiers(levels).tiers) {
    const t = (z - tier.base[2]) / tier.height;
    if (t < 0 || t > 1) continue;
    const radius = tier.radius * (1 - t);
    const projected = tier.base[0] * direction[0] + tier.base[1] * direction[1];
    const discriminant =
      projected * projected - tier.base[0] ** 2 - tier.base[1] ** 2 + radius * radius;
    if (discriminant >= 0) distance = Math.max(distance, projected + Math.sqrt(discriminant));
  }
  return [direction[0] * distance * 1.015, direction[1] * distance * 1.015, z];
}

/** A centered sphere with radius one; getCrop.radius now expresses actual metres. */
export function createCropMesh(): TreeMesh {
  return createSphere(1, 'low', [0, 0, 0]);
}

const MESH_CACHE = new Map<string, TreeMesh>();
/** Bounded cache across layer instances and season switches; never changes mesh identity. */
export function getTreeMesh(
  part: 'trunk' | 'crop',
  type: 'pine' | 'oak' | 'palm' | 'birch' | 'cherry' = 'oak',
  detail: TreeDetail = 'high'
): TreeMesh {
  const key = part === 'crop' ? 'crop' : `${part}:${type}:${detail}`;
  let mesh = MESH_CACHE.get(key);
  if (!mesh) {
    if (part === 'crop') mesh = createCropMesh();
    else if (part === 'trunk')
      mesh =
        type === 'palm'
          ? createDatePalmTrunkMesh(detail === 'low' ? 8 : 10, detail === 'low' ? 8 : 14)
          : createTrunkMesh(detail === 'low' ? 8 : 12);
    MESH_CACHE.set(key, mesh);
  }
  return mesh;
}
