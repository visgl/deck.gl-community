// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  BufferGeometry,
  BufferAttribute,
  CylinderGeometry,
  ConeGeometry,
  SphereGeometry,
  IcosahedronGeometry,
  Matrix4
} from 'three';

/**
 * Mesh format compatible with deck.gl SimpleMeshLayer.
 * All geometries are Z-up (deck.gl convention), unit scale (0..1 in Z = bottom to top).
 */
export type TreeMesh = {
  attributes: {
    POSITION: {value: Float32Array; size: 3};
    NORMAL: {value: Float32Array; size: 3};
  };
  indices: {value: Uint32Array; size: 1};
  topology: 'triangle-list';
  mode: 4;
};

/**
 * Rotation matrix that converts from Three.js Y-up to deck.gl Z-up.
 * Rotates -90 degrees around the X axis: Y -> Z, Z -> -Y.
 */
const Y_TO_Z_UP = new Matrix4().makeRotationX(-Math.PI / 2);

/**
 * Perturb each vertex radially using a sum of low-frequency sinusoidal waves
 * evaluated at the vertex's surface direction.  Adjacent vertices receive
 * smoothly-varying displacements so there are no gaps or cracks in the mesh.
 * Applied once at module init — zero runtime cost.
 *
 * @param geo       Three.js BufferGeometry to modify in-place (before Y_TO_Z_UP rotation)
 * @param magnitude Fractional displacement amplitude, e.g. 0.15 = ±15 % of radius
 * @param seed      Integer seed — each species gets a distinct blob shape
 */
function jitterSmooth(geo: BufferGeometry, magnitude: number, seed: number): void {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
  // 4 low-frequency waves (2–5 bumps across the sphere) — smooth, no cracks
  const waves = Array.from({length: 4}, () => ({
    fx: 2 + rng() * 3,
    fy: 2 + rng() * 3,
    fz: 2 + rng() * 3,
    phase: rng() * Math.PI * 2
  }));

  const pos = geo.attributes.position.array as Float32Array;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    const r = Math.sqrt(x * x + y * y + z * z);
    if (r !== 0) {
      const nx = x / r;
      const ny = y / r;
      const nz = z / r;
      let noise = 0;
      for (const w of waves) {
        noise += Math.sin(nx * w.fx + ny * w.fy + nz * w.fz + w.phase);
      }
      noise /= 4; // normalise to ~ [-1, 1]
      const scale = 1 + noise * magnitude;
      pos[i] = x * scale;
      pos[i + 1] = y * scale;
      pos[i + 2] = z * scale;
    }
  }
}

/**
 * Extract a TreeMesh from a Three.js BufferGeometry.
 * Assumes the geometry has already been rotated to Z-up.
 */
function extractMesh(geo: BufferGeometry): TreeMesh {
  geo.computeVertexNormals();
  const posAttr = geo.attributes.position as BufferAttribute;
  const norAttr = geo.attributes.normal as BufferAttribute;
  const idx = geo.index;

  return {
    attributes: {
      POSITION: {value: new Float32Array(posAttr.array), size: 3},
      NORMAL: {value: new Float32Array(norAttr.array), size: 3}
    },
    indices: {value: new Uint32Array(idx ? idx.array : new Uint32Array(0)), size: 1},
    topology: 'triangle-list',
    mode: 4
  };
}

/** Copy indices for one geometry slice, offsetting by the current vertex base. */
function copyIndices(
  out: Uint32Array,
  outOffset: number,
  geo: BufferGeometry,
  vertexBase: number
): number {
  if (geo.index) {
    const src = geo.index.array;
    for (let i = 0; i < src.length; i++) out[outOffset + i] = src[i] + vertexBase;
    return src.length;
  }
  const count = geo.attributes.position.count;
  for (let i = 0; i < count; i++) out[outOffset + i] = vertexBase + i;
  return count;
}

/**
 * Merge multiple Three.js BufferGeometries into a single geometry.
 * All input geometries must be indexed.
 */
function mergeGeometries(geos: BufferGeometry[]): BufferGeometry {
  let totalVertices = 0;
  let totalIndices = 0;
  for (const geo of geos) {
    totalVertices += geo.attributes.position.count;
    totalIndices += geo.index ? geo.index.count : geo.attributes.position.count;
  }

  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const indices = new Uint32Array(totalIndices);
  let vOffset = 0;
  let iOffset = 0;

  for (const geo of geos) {
    const count = geo.attributes.position.count;
    const srcNor = geo.attributes.normal ? (geo.attributes.normal.array as Float32Array) : null;
    positions.set(geo.attributes.position.array as Float32Array, vOffset * 3);
    if (srcNor) normals.set(srcNor, vOffset * 3);
    iOffset += copyIndices(indices, iOffset, geo, vOffset);
    vOffset += count;
  }

  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(positions, 3));
  merged.setAttribute('normal', new BufferAttribute(normals, 3));
  merged.setIndex(new BufferAttribute(indices, 1));
  return merged;
}

/**
 * Unit trunk cylinder mesh: from z=0 (base) to z=1 (top), radius tapers from 1 to 0.7.
 * Scale via `getScale = [trunkRadius, trunkRadius, trunkHeight]`.
 */
export function createTrunkMesh(segments = 8): TreeMesh {
  const geo = new CylinderGeometry(0.7, 1.0, 1.0, segments);
  // Three.js CylinderGeometry is centered at origin, extends from y=-0.5 to y=0.5
  geo.applyMatrix4(Y_TO_Z_UP); // Rotate to Z-up: now z=-0.5 to z=0.5
  geo.translate(0, 0, 0.5); // Shift so base is at z=0, top at z=1
  return extractMesh(geo);
}

/**
 * Unit pine canopy mesh: multiple tiered cones creating a Christmas tree silhouette.
 * Extends from z=0 (base of canopy) to z=1 (tip).
 *
 * @param levels - number of cone tiers (1-5)
 * @param segments - polygon segments per cone
 */
export function createPineCanopyMesh(levels = 3, segments = 8): TreeMesh {
  const geos: BufferGeometry[] = [];

  // Deterministic per-levels RNG so each level count gets its own organic shape.
  let s = (levels * 2654435761) >>> 0;
  const rng = () => {
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };

  // Base tier height for 50 % overlap filling z = 0..0.8.
  const tierHeight = 1.6 / (levels + 1);
  const step = tierHeight / 2;

  let zCursor = 0;
  for (let i = 0; i < levels; i++) {
    const t = i / (levels - 1 || 1);

    // Width narrows toward the top; each tier gets ±20 % random variation.
    const baseRadius = (1 - t * 0.5) * 0.85;
    const radius = baseRadius * (0.8 + rng() * 0.4);

    // Height varies ±15 % per tier for uneven silhouette.
    const tierH = tierHeight * (0.85 + rng() * 0.3);

    const cone = new ConeGeometry(radius, tierH, segments);
    cone.applyMatrix4(Y_TO_Z_UP);

    // Drift increases from 0 at the bottom tier to ±0.10 at the top tier.
    // Bottom tier stays centred so it always connects cleanly to the trunk.
    const driftScale = levels > 1 ? i / (levels - 1) : 0;
    const driftX = (rng() - 0.5) * 0.2 * driftScale;
    const driftY = (rng() - 0.5) * 0.2 * driftScale;
    cone.translate(driftX, driftY, zCursor + tierH / 2);
    geos.push(cone);

    zCursor += step;
  }

  // Slender tip with slight lean.
  const tip = new ConeGeometry(0.08, 0.22, 6);
  tip.applyMatrix4(Y_TO_Z_UP);
  tip.translate((rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08, zCursor + 0.05);
  geos.push(tip);

  const merged = mergeGeometries(geos);
  return extractMesh(merged);
}

/**
 * Unit oak canopy mesh: high-segment sphere, smooth pole, no shading stripe.
 *
 * IcosahedronGeometry (detail ≥ 1) always creates a single vertex at the
 * sphere's north pole via subdivision (normalized midpoint of the top edge),
 * giving 5 triangles meeting at the apex — the visible spike. Rotating the
 * icosahedron only moves WHICH original vertex becomes the apex; all 12 base
 * vertices are 5-connected, so the artifact persists.
 *
 * SphereGeometry(24, 16) places 24 tiny triangles at the pole instead of 5,
 * which is invisible at normal viewing distances. The earlier "shading stripe"
 * with the low-poly sphere (12 × 8 = 22.5° bands) was coarse Gouraud banding,
 * not a UV-seam issue. At 24 × 16 (7.5° bands) the shading is smooth.
 * Extends z = 0 (base) to z = 1 (top).
 */
export function createOakCanopyMesh(): TreeMesh {
  const geo = new SphereGeometry(0.5, 14, 10);
  jitterSmooth(geo, 0.18, 1);
  geo.applyMatrix4(Y_TO_Z_UP);
  geo.translate(0, 0, 0.5);
  return extractMesh(geo);
}

/**
 * Unit palm canopy mesh: a flat, wide disk crown typical of palm trees.
 * Extends from z=0 to z=0.35, radius=1.
 */
export function createPalmCanopyMesh(): TreeMesh {
  // Flattened sphere acting as a spread crown
  const geo = new SphereGeometry(0.7, 12, 5);
  jitterSmooth(geo, 0.1, 4);
  const flatten = new Matrix4().makeScale(1.4, 0.35, 1.4);
  geo.applyMatrix4(flatten);
  geo.applyMatrix4(Y_TO_Z_UP);
  geo.translate(0, 0, 0.18);
  return extractMesh(geo);
}

/**
 * Unit birch canopy mesh: a narrow oval / diamond shape.
 * Extends from z=0 to z=1, narrower than an oak.
 */
export function createBirchCanopyMesh(): TreeMesh {
  const geo = new SphereGeometry(0.42, 10, 8);
  jitterSmooth(geo, 0.14, 2);
  // Elongate vertically (Z after rotation)
  const elongate = new Matrix4().makeScale(1, 1.45, 1);
  geo.applyMatrix4(elongate);
  geo.applyMatrix4(Y_TO_Z_UP);
  geo.translate(0, 0, 0.5);
  return extractMesh(geo);
}

/**
 * Unit cherry canopy mesh: a full, round sphere slightly larger than oak.
 * Extends from z=0 to z=1.1 (slightly wider than tall for a lush look).
 */
export function createCherryCanopyMesh(): TreeMesh {
  const geo = new SphereGeometry(0.52, 12, 8);
  jitterSmooth(geo, 0.2, 3);
  geo.applyMatrix4(Y_TO_Z_UP);
  geo.translate(0, 0, 0.5);
  return extractMesh(geo);
}

/**
 * Unit crop sphere mesh for rendering individual fruits, nuts, or flowers.
 * Deliberately low-polygon (24 triangles) so hundreds of instances remain cheap.
 * Scale uniformly via getScale = [r, r, r] to set the world-space radius in metres.
 */
export function createCropMesh(): TreeMesh {
  const geo = new SphereGeometry(0.5, 6, 4);
  geo.applyMatrix4(Y_TO_Z_UP);
  geo.translate(0, 0, 0.5);
  return extractMesh(geo);
}
