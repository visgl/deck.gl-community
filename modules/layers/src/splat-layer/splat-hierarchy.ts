// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Matrix3, Quaternion} from '@math.gl/core';
import {getSplatAxes, validateSplatSource, type SplatSource} from './splat-source';

/** An aggregate preserves the weighted centre, covariance, colour and optical mass of its children. */
export type SplatHierarchyLevel = {
  /** Immutable Gaussian columns for this representation. */
  source: SplatSource;
  /** Maximum source-local centre displacement from the finest representation. */
  error: number;
};
/** Finest source at zero error, followed by representations with increasing local error. */
export type SplatHierarchy = readonly SplatHierarchyLevel[];

/** Symmetric 3×3 eigen decomposition, with a proper rotation basis for WXYZ quaternions. */
export function decomposeSplatCovariance(covariance: number[][]): {
  scales: number[];
  rotation: number[];
} {
  const matrix = covariance.map(row => [...row]);
  const vectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  for (let iteration = 0; iteration < 16; iteration++) {
    let p = 0;
    let q = 1;
    for (const [a, b] of [
      [0, 2],
      [1, 2]
    ])
      if (Math.abs(matrix[a][b]) > Math.abs(matrix[p][q])) {
        p = a;
        q = b;
      }
    if (Math.abs(matrix[p][q]) < 1e-12) break;
    const angle = 0.5 * Math.atan2(2 * matrix[p][q], matrix[q][q] - matrix[p][p]);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const diagonalP = matrix[p][p];
    const diagonalQ = matrix[q][q];
    const offDiagonal = matrix[p][q];
    matrix[p][p] =
      cosine * cosine * diagonalP - 2 * sine * cosine * offDiagonal + sine * sine * diagonalQ;
    matrix[q][q] =
      sine * sine * diagonalP + 2 * sine * cosine * offDiagonal + cosine * cosine * diagonalQ;
    matrix[p][q] = matrix[q][p] = 0;
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const a = matrix[k][p];
        const b = matrix[k][q];
        matrix[k][p] = matrix[p][k] = cosine * a - sine * b;
        matrix[k][q] = matrix[q][k] = sine * a + cosine * b;
      }
      const a = vectors[k][p];
      const b = vectors[k][q];
      vectors[k][p] = cosine * a - sine * b;
      vectors[k][q] = sine * a + cosine * b;
    }
  }
  const columns = [0, 1, 2].flatMap(column => vectors.map(row => row[column]));
  const quaternion = new Quaternion().fromMatrix3(new Matrix3(columns)).normalize();
  return {
    scales: [0, 1, 2].map(axis => Math.sqrt(Math.max(matrix[axis][axis], 1e-10))),
    rotation: [quaternion[3], quaternion[0], quaternion[1], quaternion[2]]
  };
}

/** Approximate orientation-averaged projected area, with the common pi factor omitted. */
export function getSplatMeanArea(scales: ArrayLike<number>): number {
  const [a, b, c] = Array.from(scales),
    p = 1.6075;
  // Ellipsoid surface area / 4; flattened leaves retain projected mass as thickness tends to zero.
  return Math.pow((Math.pow(a * b, p) + Math.pow(a * c, p) + Math.pow(b * c, p)) / 3, 1 / p);
}

/**
 * Build immutable spatial aggregates once; the original source remains the finest level.
 * @param source - Decoded Gaussian columns in source-local units.
 * @param cellSizes - Finite, positive, strictly increasing cell widths in the same units.
 * @param minimumSplats - Minimum spatial clusters retained by the coarsest aggregate. @default 1
 * @returns Finest source followed by covariance and optical-mass aggregates.
 */
export function createSplatHierarchy(
  source: SplatSource,
  cellSizes: readonly number[],
  minimumSplats = 1
): SplatHierarchy {
  const count = validateSplatSource(source);
  if (!Number.isInteger(minimumSplats) || minimumSplats < 1)
    throw new Error('Splat hierarchy minimum splats must be a positive integer.');
  const levels: SplatHierarchyLevel[] = [{source, error: 0}];
  const origin = [Infinity, Infinity, Infinity];
  for (let i = 0; i < source.positions.length; i++)
    origin[i % 3] = Math.min(origin[i % 3], source.positions[i]);
  for (const [cellIndex, cell] of cellSizes.entries()) {
    if (
      !(cell > 0) ||
      !Number.isFinite(cell) ||
      (cellIndex > 0 && cell <= cellSizes[cellIndex - 1])
    )
      throw new Error('Splat hierarchy cells must be finite, positive, and increasing.');
    let groups = new Map<string, number[]>();
    for (let index = 0; index < count; index++) {
      const key = [0, 1, 2]
        .map(axis => Math.floor((source.positions[index * 3 + axis] - origin[axis]) / cell))
        .join(',');
      const group = groups.get(key) ?? [];
      group.push(index);
      groups.set(key, group);
    }
    // One covariance proxy preserves optical mass but loses all crown extent. Keep a requested
    // terminal cluster by splitting along the widest source axis without duplicating its mass.
    const floor = Math.min(minimumSplats, count);
    const reachesFloor = groups.size < floor;
    if (reachesFloor) {
      const bounds = [0, 1, 2].map(axis => {
        let minimum = Infinity;
        let maximum = -Infinity;
        for (let index = 0; index < count; index++) {
          const value = source.positions[index * 3 + axis];
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
        }
        return [minimum, maximum] as const;
      });
      const axis = bounds.reduce(
        (widest, bound, index) =>
          bound[1] - bound[0] > bounds[widest][1] - bounds[widest][0] ? index : widest,
        0
      );
      const ordered = Array.from({length: count}, (_, index) => index).sort(
        (a, b) => source.positions[a * 3 + axis] - source.positions[b * 3 + axis]
      );
      groups = new Map(
        Array.from({length: floor}, (_, index) => [
          String(index),
          ordered.slice(
            Math.floor((index * count) / floor),
            Math.floor(((index + 1) * count) / floor)
          )
        ])
      );
    }
    let maximumDisplacement = 0;
    const positions: number[] = [],
      scales: number[] = [],
      rotations: number[] = [],
      colors: number[] = [],
      normals: number[] = [],
      opacities: number[] = [],
      opticalDepths: number[] = [];
    for (const group of groups.values()) {
      const weights = group.map(index => {
        const alpha =
          source.colors[index * 4 + 3] / (source.colors instanceof Uint8Array ? 255 : 1);
        const depth = source.opticalDepths
          ? source.opticalDepths[index] * alpha
          : -Math.log(Math.max(1 - source.opacities[index] * alpha, 0.005));
        return depth * getSplatMeanArea(source.scales.subarray(index * 3, index * 3 + 3));
      });
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const mean = [0, 1, 2].map(
        axis =>
          group.reduce(
            (sum, index, i) => sum + source.positions[index * 3 + axis] * weights[i],
            0
          ) / Math.max(total, 1e-20)
      );
      for (const index of group)
        maximumDisplacement = Math.max(
          maximumDisplacement,
          Math.hypot(...mean.map((value, axis) => source.positions[index * 3 + axis] - value))
        );
      const covariance = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ];
      const color = [0, 0, 0, 0];
      const normal = [0, 0, 0];
      for (const [i, index] of group.entries()) {
        const weight = weights[i] / Math.max(total, 1e-20);
        const axes = getSplatAxes(
          source.rotations.subarray(index * 4, index * 4 + 4),
          source.scales.subarray(index * 3, index * 3 + 3)
        );
        const delta = mean.map((value, axis) => source.positions[index * 3 + axis] - value);
        for (let row = 0; row < 3; row++)
          for (let column = 0; column < 3; column++)
            covariance[row][column] +=
              weight *
              (axes.reduce((sum, axis) => sum + axis[row] * axis[column], 0) +
                delta[row] * delta[column]);
        for (let channel = 0; channel < 4; channel++)
          color[channel] +=
            (weight * source.colors[index * 4 + channel]) /
            (source.colors instanceof Uint8Array ? 255 : 1);
        for (let axis = 0; axis < 3; axis++)
          normal[axis] += weight * (source.normals?.[index * 3 + axis] ?? (axis === 2 ? 1 : 0));
      }
      const decomposition = decomposeSplatCovariance(covariance);
      const area = getSplatMeanArea(decomposition.scales);
      positions.push(...mean);
      scales.push(...decomposition.scales);
      rotations.push(...decomposition.rotation);
      colors.push(color[0], color[1], color[2], 1);
      const normalLength = Math.hypot(...normal);
      normals.push(
        ...(normalLength > 1e-8 ? normal.map(value => value / normalLength) : [0, 0, 1])
      );
      const depth = total / Math.max(area, 1e-20);
      opticalDepths.push(depth);
      opacities.push(1 - Math.exp(-depth));
    }
    levels.push({
      error: Math.max(maximumDisplacement, levels[levels.length - 1].error + 1e-8),
      source: {
        positions: new Float32Array(positions),
        scales: new Float32Array(scales),
        rotations: new Float32Array(rotations),
        colors: new Float32Array(colors),
        normals: new Float32Array(normals),
        opacities: new Float32Array(opacities),
        opticalDepths: new Float32Array(opticalDepths)
      }
    });
    if (reachesFloor) break;
  }
  return levels;
}
