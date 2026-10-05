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
  };
  indices: {value: Uint32Array; size: 1};
  topology: 'triangle-list';
  mode: 4;
};

/** Geometry detail, independent of the number of rendered instances. */
export type TreeDetail = 'low' | 'medium' | 'high';
type Point = [number, number, number];
export type CrownLobe = {center: Point; radius: Point};
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
      COLOR_0: {value: new Float32Array(positions.length).fill(shade), size: 3}
    },
    indices: {value: indices, size: 1},
    topology: 'triangle-list',
    mode: 4
  };
  computeNormals(mesh);
  return mesh;
}

/** Area-weighted normals. Welding is restricted to closed foliage, never two-sided blades. */
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

/** Merge CPU arrays once; retain hard edges and opposite blade normals. */
function mergeMeshes(meshes: TreeMesh[]): TreeMesh {
  const length = meshes.reduce((sum, mesh) => sum + mesh.attributes.POSITION.value.length, 0);
  const indexLength = meshes.reduce((sum, mesh) => sum + mesh.indices.value.length, 0);
  const mesh: TreeMesh = {
    attributes: {
      POSITION: {value: new Float32Array(length), size: 3},
      NORMAL: {value: new Float32Array(length), size: 3},
      COLOR_0: {value: new Float32Array(length), size: 3}
    },
    indices: {value: new Uint32Array(indexLength), size: 1},
    topology: 'triangle-list',
    mode: 4
  };
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const part of meshes) {
    for (const key of ['POSITION', 'NORMAL', 'COLOR_0'] as const) {
      mesh.attributes[key].value.set(part.attributes[key].value, vertexOffset * 3);
    }
    for (const index of part.indices.value)
      mesh.indices.value[indexOffset++] = index + vertexOffset;
    vertexOffset += part.attributes.POSITION.value.length / 3;
  }
  return mesh;
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

/** Palm bark rings use a single ribbed shaft rather than fourteen separate toruses. */
export function createDatePalmTrunkMesh(segments = 10, scarRings = 14): TreeMesh {
  const p: number[] = [];
  const indices: number[] = [];
  const rings = scarRings * 3 + 2;
  for (let ring = 0; ring <= rings; ring++) {
    const z = ring / rings;
    const rib = ring > 0 && ring < rings && ring % 3 === 1 ? 0.065 : 0;
    const radius = 1 - z * 0.38 + rib;
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

/** Layered pine cones; the seeded tier silhouette remains stable between details. */
export function createPineCanopyMesh(levels = 3, segments = 12): TreeMesh {
  const meshes: TreeMesh[] = [];
  const {tiers, tipStart, tipEnd} = createPineTiers(levels);
  for (const [i, tier] of tiers.entries()) {
    const mesh = createBranch(
      tier.base,
      [tier.base[0], tier.base[1], tier.base[2] + tier.height],
      tier.radius,
      0,
      segments
    );
    mesh.attributes.COLOR_0.value.fill(0.82 + (i / (levels - 1 || 1)) * 0.16);
    meshes.push(mesh);
  }
  meshes.push(createBranch(tipStart, tipEnd, 0.08, 0, 6));
  return mergeMeshes(meshes);
}

const PINE_TIER_CACHE = new Map<number, ReturnType<typeof generatePineTiers>>();
function createPineTiers(levels: number) {
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

/** Crown envelopes are shared by foliage generation and crop placement. */
export function getCrownLobes(type: 'oak' | 'birch' | 'cherry'): CrownLobe[] {
  const narrow = type === 'birch';
  const lobes: CrownLobe[] = [
    {
      center: [0, 0, narrow ? 0.66 : 0.62],
      radius: [narrow ? 0.25 : 0.34, narrow ? 0.25 : 0.34, narrow ? 0.42 : 0.37]
    }
  ];
  const count = narrow ? 5 : 7;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const distance = narrow ? 0.17 : 0.25;
    lobes.push({
      center: [Math.cos(angle) * distance, Math.sin(angle) * distance, 0.36 + (i % 3) * 0.1],
      radius: [narrow ? 0.19 : 0.24, narrow ? 0.19 : 0.24, narrow ? 0.32 : 0.26]
    });
  }
  return lobes;
}

/** Outer union envelope of crown lobes, sampled without hidden internal triangles. */
export function sampleCrownSurface(type: 'oak' | 'birch' | 'cherry', direction: Point): Point {
  const origin: Point = [0, 0, 0.5];
  let distance = 0;
  for (const lobe of getCrownLobes(type)) {
    let a = 0;
    let b = 0;
    let c = -1;
    for (let i = 0; i < 3; i++) {
      const delta = (origin[i] - lobe.center[i]) / lobe.radius[i];
      const ray = direction[i] / lobe.radius[i];
      a += ray * ray;
      b += 2 * delta * ray;
      c += delta * delta;
    }
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0 && a > 0)
      distance = Math.max(distance, (-b + Math.sqrt(discriminant)) / (2 * a));
  }
  return [direction[0] * distance, direction[1] * distance, 0.5 + direction[2] * distance];
}

function createBroadleafCanopy(type: 'oak' | 'birch' | 'cherry', detail: TreeDetail): TreeMesh {
  const mesh = createSphere(1, detail, [0, 0, 0]);
  const positions = mesh.attributes.POSITION.value;
  const colors = mesh.attributes.COLOR_0.value;
  for (let i = 0; i < positions.length; i += 3) {
    const direction: Point = [positions[i], positions[i + 1], positions[i + 2]];
    const point = sampleCrownSurface(type, direction);
    const noise =
      1 + 0.025 * Math.sin(direction[0] * 11 + direction[1] * 7) * Math.sin(direction[2] * 9);
    positions.set([point[0] * noise, point[1] * noise, 0.5 + (point[2] - 0.5) * noise], i);
    const shade = 0.8 + point[2] * 0.14 + Math.sin(direction[0] * 7 + direction[1] * 5) * 0.035;
    colors.set([shade, shade, shade], i);
  }
  computeNormals(mesh, true);
  return mesh;
}

/** Lobed, shared foliage envelopes with smoothly welded lighting normals. */
export function createOakCanopyMesh(detail: TreeDetail = 'high'): TreeMesh {
  return createBroadleafCanopy('oak', detail);
}
export function createBirchCanopyMesh(detail: TreeDetail = 'high'): TreeMesh {
  return createBroadleafCanopy('birch', detail);
}
export function createCherryCanopyMesh(detail: TreeDetail = 'high'): TreeMesh {
  return createBroadleafCanopy('cherry', detail);
}

/** Actual branching structure is visible when deciduous trees lose their foliage. */
export function createWinterCanopyMesh(
  type: 'oak' | 'birch' | 'cherry',
  detail: TreeDetail
): TreeMesh {
  const segments = detail === 'low' ? 4 : 6;
  const meshes = [createBranch([0, 0, 0], [0.015, 0, 0.85], 0.06, 0.013, segments)];
  for (const [i, lobe] of getCrownLobes(type).entries()) {
    const start: Point = [0, 0, 0.12 + i * 0.055];
    const end: Point = [lobe.center[0] * 1.65, lobe.center[1] * 1.65, lobe.center[2] + 0.18];
    meshes.push(createBranch(start, end, 0.03, 0.008, segments));
    for (const side of [-1, 1]) {
      const fork: Point = [
        end[0] + side * 0.065,
        end[1] + 0.06 * Math.cos(i),
        Math.min(1, end[2] + 0.16)
      ];
      const joint: Point = [
        start[0] + (end[0] - start[0]) * 0.7,
        start[1] + (end[1] - start[1]) * 0.7,
        start[2] + (end[2] - start[2]) * 0.7
      ];
      meshes.push(createBranch(joint, fork, 0.011, 0.002, segments));
    }
  }
  return mergeMeshes(meshes);
}

function evaluateFrond(points: Point[], t: number): Vector3 {
  const s = 1 - t;
  return new Vector3(points[0])
    .scale(s ** 3)
    .add(new Vector3(points[1]).scale(3 * s * s * t))
    .add(new Vector3(points[2]).scale(3 * s * t * t))
    .add(new Vector3(points[3]).scale(t ** 3));
}

function appendBlade(
  positions: number[],
  indices: number[],
  base: Vector3,
  direction: Vector3,
  widthDirection: Vector3,
  length: number,
  width: number
): void {
  const tip = new Vector3(base).add(new Vector3(direction).scale(length));
  const middle = new Vector3(base).lerp(tip, 0.52);
  const left = new Vector3(middle).add(new Vector3(widthDirection).scale(width));
  const right = new Vector3(middle).subtract(new Vector3(widthDirection).scale(width));
  const offset = positions.length / 3;
  for (const point of [base, left, tip, right]) positions.push(...point);
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

/** Feathered palm crown; thin rachis ribbons avoid TubeGeometry's extra rings and faces. */
export function createPalmCanopyMesh(detail: TreeDetail = 'high'): TreeMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const count = detail === 'high' ? 20 : detail === 'medium' ? 16 : 10;
  const upright = detail === 'high' ? 8 : detail === 'medium' ? 6 : 4;
  const pairs = detail === 'high' ? 11 : detail === 'medium' ? 9 : 6;
  for (let i = 0; i < count + upright; i++) {
    const spear = i >= count;
    const k = spear ? i - count : i;
    const angle =
      ((k + (spear ? 0.5 : 0)) / (spear ? upright : count)) * Math.PI * 2 +
      (spear ? 0 : Math.sin(k * 5.37) * 0.07);
    const tier = k % 4;
    const radial = (radius: number, z: number): Point => [
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      z
    ];
    const points = spear
      ? [radial(0.025, 0.44), radial(0.12, 0.82), radial(0.38, 1.04), radial(0.62, 0.96)]
      : [
          radial(0.035, 0.43 + tier * 0.012),
          radial(0.28, 0.72 - tier * 0.025),
          radial(0.68, 0.55 - tier * 0.045),
          radial(0.84 + ((k * 7) % 9) * 0.018, 0.25 - tier * 0.035)
        ];
    const pairCount = spear ? Math.max(4, pairs - 3) : pairs;
    for (let j = 0; j < pairCount; j++) {
      const t = 0.2 + (j / (pairCount - 1)) * 0.72;
      const point = evaluateFrond(points, t);
      const tangent = evaluateFrond(points, Math.min(1, t + 0.001))
        .subtract(evaluateFrond(points, Math.max(0, t - 0.001)))
        .normalize();
      const sideways = new Vector3(-tangent[1], tangent[0], 0).normalize();
      const fullness = Math.sin(((j + 0.75) / pairCount) * Math.PI);
      for (const side of [-1, 1]) {
        const base = new Vector3(point).add(new Vector3(sideways).scale(side * 0.008));
        const direction = new Vector3(sideways)
          .scale(side)
          .add(new Vector3(tangent).scale(0.18 + Math.sin(angle + j * 0.7) * 0.06))
          .add([0, 0, 0.12 - t * 0.2])
          .normalize();
        const widthDirection = new Vector3(tangent).add([0, 0, 0.08]).normalize();
        appendBlade(
          positions,
          indices,
          base,
          direction,
          widthDirection,
          0.055 + fullness * 0.095,
          0.007 + fullness * 0.008
        );
      }
    }
    for (let j = 0; j < 10; j++) {
      const start = evaluateFrond(points, j / 10);
      const end = evaluateFrond(points, (j + 1) / 10);
      const direction = new Vector3(end).subtract(start);
      const length = direction.len();
      direction.normalize();
      const across = new Vector3(-direction[1], direction[0], 0).normalize();
      appendBlade(positions, indices, start, direction, across, length * 1.08, 0.012);
    }
  }
  const leaflets = createMesh(new Float32Array(positions), new Uint32Array(indices));
  for (let i = 0; i < leaflets.attributes.COLOR_0.value.length; i += 3) {
    const shade = 0.8 + Math.max(0, leaflets.attributes.POSITION.value[i + 2]) * 0.18;
    leaflets.attributes.COLOR_0.value.set([shade, shade, shade], i);
  }
  return mergeMeshes([leaflets, createSphere(0.13, 'low', [0, 0, 0.43], [1, 1, 0.75])]);
}

/** A centered sphere with radius one; getCrop.radius now expresses actual metres. */
export function createCropMesh(): TreeMesh {
  return createSphere(1, 'low', [0, 0, 0]);
}

const MESH_CACHE = new Map<string, TreeMesh>();
/** Bounded cache across layer instances and season switches; never changes mesh identity. */
export function getTreeMesh(
  part: 'trunk' | 'canopy' | 'crop',
  type: 'pine' | 'oak' | 'palm' | 'birch' | 'cherry' = 'oak',
  detail: TreeDetail = 'high',
  winter = false,
  levels = 3
): TreeMesh {
  levels = Math.max(1, Math.min(5, Math.round(levels) || 3));
  if (type !== 'pine' && type !== 'palm') levels = 3;
  if (type === 'pine' || type === 'palm') winter = false;
  if (part === 'crop') {
    type = 'oak';
    detail = 'low';
    winter = false;
    levels = 3;
  }
  const key = `${part}:${type}:${detail}:${winter}:${levels}`;
  let mesh = MESH_CACHE.get(key);
  if (!mesh) {
    if (part === 'crop') mesh = createCropMesh();
    else if (part === 'trunk')
      mesh =
        type === 'palm'
          ? createDatePalmTrunkMesh(detail === 'low' ? 8 : 10, detail === 'low' ? 8 : 14)
          : createTrunkMesh(detail === 'low' ? 8 : 12);
    else if (type === 'pine')
      mesh = createPineCanopyMesh(levels, detail === 'high' ? 16 : detail === 'medium' ? 12 : 8);
    else if (type === 'palm') mesh = createPalmCanopyMesh(detail);
    else
      mesh = winter
        ? createWinterCanopyMesh(type as 'oak', detail)
        : createBroadleafCanopy(type as 'oak', detail);
    MESH_CACHE.set(key, mesh);
  }
  return mesh;
}
