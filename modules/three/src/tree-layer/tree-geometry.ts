// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  BufferGeometry,
  BufferAttribute,
  CylinderGeometry,
  ConeGeometry,
  SphereGeometry,
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
  const tierHeight = 0.55 / levels;

  for (let i = 0; i < levels; i++) {
    const t = i / (levels - 1 || 1);
    // Bottom tiers are wider, top tiers are narrower
    const radius = (1 - t * 0.5) * 0.85;
    // Tiers are staggered: each one starts 60% up the previous tier
    const zBase = t * (1 - tierHeight * 1.2);

    const cone = new ConeGeometry(radius, tierHeight, segments);
    cone.applyMatrix4(Y_TO_Z_UP);
    // ConeGeometry apex is at y=+height/2 -> z=+height/2 after rotation
    // Translate so apex points upward and base is at zBase
    cone.translate(0, 0, zBase + tierHeight);
    geos.push(cone);
  }

  // Sharp tip at top
  const tip = new ConeGeometry(0.12, 0.18, 6);
  tip.applyMatrix4(Y_TO_Z_UP);
  tip.translate(0, 0, 1.0);
  geos.push(tip);

  const merged = mergeGeometries(geos);
  merged.computeVertexNormals();
  return extractMesh(merged);
}

/**
 * Unit oak canopy mesh: a large sphere.
 * Extends from z=0 to z=1, center at z=0.5.
 */
export function createOakCanopyMesh(): TreeMesh {
  const geo = new SphereGeometry(0.5, 12, 8);
  // SphereGeometry is centered at origin, radius=0.5
  geo.applyMatrix4(Y_TO_Z_UP);
  geo.translate(0, 0, 0.5); // center at z=0.5, extends z=0 to z=1
  return extractMesh(geo);
}

/**
 * Unit palm canopy mesh: a flat, wide disk crown typical of palm trees.
 * Extends from z=0 to z=0.35, radius=1.
 */
export function createPalmCanopyMesh(): TreeMesh {
  // Flattened sphere acting as a spread crown
  const geo = new SphereGeometry(0.7, 12, 5);
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
  geo.applyMatrix4(Y_TO_Z_UP);
  geo.translate(0, 0, 0.5);
  return extractMesh(geo);
}
