// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Geometry, GPUGeometry, makeInterleavedGeometry} from '@luma.gl/engine';
import {Buffer, type Device} from '@luma.gl/core';

/** Decoded, reusable Gaussian template. All lengths use the template's local units. */
export type SplatSource = {
  /** XYZ centres, three floats per Gaussian. */
  positions: Float32Array;
  /** Positive XYZ one-sigma lengths, three floats per Gaussian. */
  scales: Float32Array;
  /** Unit quaternions in WXYZ order, four floats per Gaussian. */
  rotations: Float32Array;
  /** RGBA bytes or linear RGBA floats. Alpha multiplies opacities exactly once. */
  colors: Uint8Array | Float32Array;
  /** Peak opacity in [0, 1], one float per Gaussian. */
  opacities: Float32Array;
  /** Optional nonnegative peak optical depth. Overrides opacities; alpha scales density. */
  opticalDepths?: Float32Array;
  /** Optional local shading normals. They do not flip toward the camera; covariance is independent. */
  normals?: Float32Array;
};

/** Validate a prepared source before uploading it. Returns its Gaussian count. */
export function validateSplatSource(source: SplatSource): number {
  const count = source.positions.length / 3;
  if (!Number.isInteger(count)) throw new Error('Splat positions must contain XYZ triples.');
  for (const [name, size] of [
    ['scales', 3],
    ['rotations', 4],
    ['colors', 4],
    ['opacities', 1],
    ['opticalDepths', 1],
    ['normals', 3]
  ] as const) {
    const values = source[name];
    if ((name === 'normals' || name === 'opticalDepths') && !values) continue;
    if (!values || values.length !== count * size)
      throw new Error(`Splat ${name} length does not match positions.`);
    for (const value of values) {
      if (!Number.isFinite(value)) throw new Error(`Splat ${name} contains a non-finite value.`);
    }
  }
  for (const value of source.positions)
    if (!Number.isFinite(value)) throw new Error('Splat positions contain a non-finite value.');
  for (const value of source.scales)
    if (value <= 0) throw new Error('Splat scales must be positive.');
  for (const value of source.opacities)
    if (value < 0 || value > 1) throw new Error('Splat opacity must be in [0, 1].');
  for (const value of source.opticalDepths ?? [])
    if (value < 0) throw new Error('Splat optical depth must be nonnegative.');
  for (let i = 0; i < count; i++) {
    if (
      source.colors instanceof Float32Array &&
      (source.colors[i * 4 + 3] < 0 || source.colors[i * 4 + 3] > 1)
    )
      throw new Error('Splat color alpha must be in [0, 1].');
    const q = source.rotations.subarray(i * 4, i * 4 + 4);
    if (Math.abs(Math.hypot(...q) - 1) > 0.001)
      throw new Error('Splat rotations must be unit WXYZ quaternions.');
  }
  return count;
}

/** Rotation times the diagonal one-sigma scale; its columns form the covariance square root. */
export function getSplatAxes(rotation: ArrayLike<number>, scale: ArrayLike<number>): number[][] {
  const [w, x, y, z] = Array.from(rotation);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)].map(v => v * scale[0]),
    [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)].map(v => v * scale[1]),
    [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)].map(v => v * scale[2])
  ];
}

const GEOMETRY_CACHE = new WeakMap<SplatSource, Geometry>();
/** One shared template upload, instanced by owner rows rather than expanded per tree. Sources are immutable. */
export function getSplatGeometry(source: SplatSource): Geometry {
  const cached = GEOMETRY_CACHE.get(source);
  if (cached) return cached;
  const count = validateSplatSource(source);
  const corners = new Float32Array(count * 8);
  const centers = new Float32Array(count * 12);
  const axes = [0, 1, 2].map(() => new Float32Array(count * 12));
  const colors = new Float32Array(count * 16);
  const normals = new Float32Array(count * 12);
  const indices = new Uint32Array(count * 6);
  const unitCorners = [-1, -1, 1, -1, -1, 1, 1, 1];
  for (let i = 0; i < count; i++) {
    const basis = getSplatAxes(
      source.rotations.subarray(i * 4, i * 4 + 4),
      source.scales.subarray(i * 3, i * 3 + 3)
    );
    corners.set(unitCorners, i * 8);
    for (let corner = 0; corner < 4; corner++) {
      const offset = i * 12 + corner * 3;
      centers.set(source.positions.subarray(i * 3, i * 3 + 3), offset);
      for (let axis = 0; axis < 3; axis++) axes[axis].set(basis[axis], offset);
      normals.set(source.normals?.subarray(i * 3, i * 3 + 3) ?? [0, 0, 1], offset);
      const colorOffset = (i * 4 + corner) * 4;
      const divisor = source.colors instanceof Uint8Array ? 255 : 1;
      for (let channel = 0; channel < 3; channel++)
        colors[colorOffset + channel] = source.colors[i * 4 + channel] / divisor;
      colors[colorOffset + 3] =
        ((source.opticalDepths?.[i] ?? source.opacities[i]) * source.colors[i * 4 + 3]) / divisor;
    }
    indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  }
  const geometry = new Geometry({
    topology: 'triangle-list',
    indices,
    attributes: {
      splatCorners: {size: 2, value: corners},
      splatCenters: {size: 3, value: centers},
      splatAxisX: {size: 3, value: axes[0]},
      splatAxisY: {size: 3, value: axes[1]},
      splatAxisZ: {size: 3, value: axes[2]},
      splatColors: {size: 4, value: colors},
      splatNormals: {size: 3, value: normals}
    }
  });
  GEOMETRY_CACHE.set(source, geometry);
  return geometry;
}

const GPU_CACHE = new WeakMap<
  Device,
  Map<SplatSource, {geometry: GPUGeometry; references: number}>
>();
/** A model-owned lease on shared immutable device buffers. The last owner releases the upload. */
export function acquireSplatGeometry(device: Device, source: SplatSource): GPUGeometry {
  let cache = GPU_CACHE.get(device);
  if (!cache) {
    cache = new Map();
    GPU_CACHE.set(device, cache);
  }
  let entry = cache.get(source);
  if (!entry) {
    const geometry = makeInterleavedGeometry(getSplatGeometry(source));
    const attributes = Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, attribute]) => [
        name,
        device.createBuffer({data: attribute.value})
      ])
    );
    const indices = device.createBuffer({usage: Buffer.INDEX, data: geometry.indices!.value});
    entry = {
      geometry: new GPUGeometry({
        topology: 'triangle-list',
        vertexCount: geometry.vertexCount,
        bufferLayout: geometry.bufferLayout,
        attributes,
        indices
      }),
      references: 0
    };
    cache.set(source, entry);
  }
  entry.references++;
  const shared = entry;
  const owners = cache;
  return new (class extends GPUGeometry {
    private released = false;
    destroy() {
      if (this.released) return;
      this.released = true;
      if (--shared.references === 0) {
        shared.geometry.destroy();
        owners.delete(source);
      }
    }
  })({...shared.geometry, topology: 'triangle-list'});
}

const BOUNDS = new WeakMap<SplatSource, Map<string, number>>();
/** Conservative source radius about a supplied local center, at the actual Gaussian support. */
export function getSplatRadius(
  source: SplatSource,
  support = 6,
  center: readonly number[] = [0, 0, 0]
): number {
  let cache = BOUNDS.get(source);
  if (!cache) {
    cache = new Map();
    BOUNDS.set(source, cache);
  }
  const key = [support, ...center].join(',');
  let radius = cache.get(key);
  if (radius !== undefined) return radius;
  validateSplatSource(source);
  radius = 0;
  for (let i = 0; i < source.opacities.length; i++)
    radius = Math.max(
      radius,
      Math.hypot(...center.map((value, axis) => source.positions[i * 3 + axis] - value)) +
        support * Math.max(...source.scales.subarray(i * 3, i * 3 + 3))
    );
  cache.set(key, radius);
  return radius;
}

const CENTERS = new WeakMap<SplatSource, number[]>();
/** Centre of the authored Gaussian positions, used for perspective refinement. */
export function getSplatCenter(source: SplatSource): number[] {
  let center = CENTERS.get(source);
  if (!center) {
    const minimum = [Infinity, Infinity, Infinity],
      maximum = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < source.positions.length; i++) {
      const axis = i % 3;
      minimum[axis] = Math.min(minimum[axis], source.positions[i]);
      maximum[axis] = Math.max(maximum[axis], source.positions[i]);
    }
    center = minimum.map((value, axis) =>
      Number.isFinite(value) ? (value + maximum[axis]) / 2 : 0
    );
    CENTERS.set(source, center);
  }
  return center;
}
