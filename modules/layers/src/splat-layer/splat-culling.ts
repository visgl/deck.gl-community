// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {SplatShadowProjection} from './splat-shadow-pass';
/** Conservative sphere/light-volume intersection. It does not depend on screen visibility. */
export function intersectsSplatLightVolume(
  position: number[],
  radius: number,
  projection: SplatShadowProjection
): boolean {
  const matrix = projection.matrix;
  const clip = [0, 1, 2, 3].map(
    axis =>
      matrix[axis] * position[0] +
      matrix[axis + 4] * position[1] +
      matrix[axis + 8] * position[2] +
      matrix[axis + 12] +
      projection.center[axis]
  );
  return [0, 1, 2].every(axis =>
    [-1, 1].every(
      sign =>
        clip[3] +
          sign * clip[axis] +
          radius *
            Math.hypot(
              matrix[3] + sign * matrix[axis],
              matrix[7] + sign * matrix[axis + 4],
              matrix[11] + sign * matrix[axis + 8]
            ) >=
        0
    )
  );
}

/** Largest singular value of the perspective projection Jacobian, in pixels per metre. */
export function getSplatPixelsPerMeter(
  position: number[],
  viewport: import('@deck.gl/core').Viewport
): number {
  const matrix = viewport.viewProjectionMatrix;
  const clip = [0, 1, 3].map(
    axis =>
      matrix[axis] * position[0] +
      matrix[axis + 4] * position[1] +
      matrix[axis + 8] * position[2] +
      matrix[axis + 12]
  );
  const w = clip[2];
  if (w <= 1e-8) return Infinity;
  const rows = [viewport.width, viewport.height].map((size, row) =>
    [0, 1, 2].map(
      axis =>
        ((((matrix[row + axis * 4] * w - clip[row] * matrix[3 + axis * 4]) / (w * w)) * size) / 2) *
        viewport.distanceScales.unitsPerMeter[axis]
    )
  );
  const a = rows[0].reduce((sum, value) => sum + value * value, 0);
  const b = rows[0].reduce((sum, value, axis) => sum + value * rows[1][axis], 0);
  const c = rows[1].reduce((sum, value) => sum + value * value, 0);
  return Math.sqrt((a + c + Math.sqrt((a - c) ** 2 + 4 * b * b)) / 2);
}
