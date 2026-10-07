// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {getTreeMesh, type TreeMesh} from './tree-geometry';

/** Crop geometry; radius is the enclosing sphere radius for every shape. */
export type CropKind = 'fruit' | 'lemon' | 'cone' | 'acorn' | 'catkin' | 'flower' | 'propagule';
const CACHE = new Map<CropKind, TreeMesh>();
/** Shared crop templates retain conservative spherical bounds for shoot attachment. */
export function getTreeCropMesh(kind: CropKind = 'fruit'): TreeMesh {
  if (kind === 'fruit') return getTreeMesh('crop');
  const cached = CACHE.get(kind);
  if (cached) return cached;
  const base = getTreeMesh('crop');
  const p = new Float32Array(base.attributes.POSITION.value);
  const colors = new Float32Array(p.length).fill(1);
  for (let i = 0; i < p.length; i += 3) {
    const z = p[i + 2],
      angle = Math.atan2(p[i + 1], p[i]);
    let radial = 1,
      vertical = 1;
    if (kind === 'lemon') {
      radial = 0.68 * (1 - 0.12 * Math.abs(z));
    }
    if (kind === 'cone') {
      radial = (0.5 - 0.18 * z) * (1 + 0.08 * Math.cos(angle * 12 + z * 24));
      vertical = 0.88;
    }
    if (kind === 'acorn') {
      radial = 0.62 * (z > 0.2 ? 1.08 : 1);
      vertical = 0.85;
    }
    if (kind === 'catkin') {
      radial = 0.19;
    }
    if (kind === 'propagule') {
      radial = 0.09 * (1.1 - 0.25 * z);
    }
    if (kind === 'flower') {
      radial = 0.76 + 0.22 * Math.cos(angle * 5);
      vertical = 0.12;
    }
    p[i] *= radial;
    p[i + 1] *= radial;
    p[i + 2] *= vertical;
    if (kind === 'acorn' && z > 0.2) colors.set([0.45, 0.4, 0.32], i);
    if (kind === 'cone') {
      const shade = 0.7 + 0.25 * Math.cos(angle * 12 + z * 24);
      colors.set([shade, shade, shade], i);
    }
    if (kind === 'flower' && Math.hypot(p[i], p[i + 1]) < 0.25) colors.set([1, 0.78, 0.15], i);
  }
  const normals = new Float32Array(p.length),
    indices = base.indices.value;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3,
      b = indices[i + 1] * 3,
      c = indices[i + 2] * 3;
    const x = p[b] - p[a],
      y = p[b + 1] - p[a + 1],
      z = p[b + 2] - p[a + 2];
    const u = p[c] - p[a],
      v = p[c + 1] - p[a + 1],
      w = p[c + 2] - p[a + 2];
    for (const j of [a, b, c]) {
      normals[j] += y * w - z * v;
      normals[j + 1] += z * u - x * w;
      normals[j + 2] += x * v - y * u;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (length) for (let axis = 0; axis < 3; axis++) normals[i + axis] /= length;
    else normals[i + 2] = 1;
  }
  const mesh: TreeMesh = {
    ...base,
    attributes: {
      ...base.attributes,
      POSITION: {value: p, size: 3},
      NORMAL: {value: normals, size: 3},
      COLOR_0: {value: colors, size: 3}
    }
  };
  CACHE.set(kind, mesh);
  return mesh;
}
