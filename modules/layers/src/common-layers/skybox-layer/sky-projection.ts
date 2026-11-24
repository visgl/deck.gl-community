// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {log, type Viewport} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core/matrix';
import type {ShaderModule} from '@luma.gl/shaders';

/**
 * Declares how the axes of a sky asset relate to deck.gl's Z-up world. Use `y-up` for content
 * authored for Y-up scenes, where the source `+Y` axis aligns with deck.gl's vertical `+Z` axis.
 */
export type SkyOrientation = 'default' | 'y-up';

/** Uniforms of the {@link skyProjection} shader module. */
export type SkyProjectionProps = {
  /** Rotation from the frame of the sky content to the world frame. */
  modelMatrix: Readonly<ArrayLike<number>>;
  /** View transform with translation removed, so the sky stays camera-centered. */
  viewMatrix: Readonly<ArrayLike<number>>;
  /** Projection transform for the active viewport. */
  projectionMatrix: Readonly<ArrayLike<number>>;
};

const SKY_PROJECTION_GLSL = /* glsl */ `\
layout(std140) uniform skyProjectionUniforms {
  mat4 modelMatrix;
  mat4 viewMatrix;
  mat4 projectionMatrix;
} skyProjection;

// Projects a direction onto the far plane. The view matrix has no translation, so the result
// turns with the camera and does not move with it.
vec4 sky_project(vec3 direction) {
  vec4 clipPosition =
    skyProjection.projectionMatrix *
    skyProjection.viewMatrix *
    skyProjection.modelMatrix *
    vec4(direction, 1.0);
  return clipPosition.xyww;
}
`;

/**
 * Shader module for content at infinity: a camera-centered projection that writes the far-plane
 * depth. GLSL vertex shaders call `sky_project(direction)`. WGSL shaders declare the
 * `skyProjectionUniforms` struct themselves.
 */
export const skyProjection = {
  name: 'skyProjection',
  vs: SKY_PROJECTION_GLSL,
  uniformTypes: {
    modelMatrix: 'mat4x4<f32>',
    viewMatrix: 'mat4x4<f32>',
    projectionMatrix: 'mat4x4<f32>'
  }
} as const satisfies ShaderModule<SkyProjectionProps>;

/** Returns the rotation from the frame of a sky asset to deck.gl's Z-up sky frame. */
export function getSkyOrientationMatrix(orientation: SkyOrientation = 'default'): Matrix4 {
  return orientation === 'y-up' ? new Matrix4().rotateX(Math.PI / 2) : new Matrix4();
}

/** Removes camera translation from the active view matrix for sky rendering. */
export function getSkyViewMatrix(viewport: Viewport): Matrix4 {
  const viewMatrix = new Matrix4(viewport.viewMatrixUncentered || viewport.viewMatrix);
  viewMatrix[12] = 0;
  viewMatrix[13] = 0;
  viewMatrix[14] = 0;
  return viewMatrix;
}

/** The rotation part of a sky model matrix, from {@link getSkyModelRotation}. */
export type SkyModelRotation = {
  /** An orthogonal matrix without translation. Its determinant is `1`, or `-1` if `mirrored`. */
  matrix: Matrix4;
  /** `true` if the matrix contains a reflection. A reflection reverses the triangle winding. */
  mirrored: boolean;
};

const MAX_POLAR_ITERATIONS = 100;
const POLAR_TOLERANCE = 1e-12;
// Ratio of |det| to the cube of the Frobenius norm below which a matrix counts as singular.
const SINGULAR_TOLERANCE = 1e-9;

let warnedSingularModelMatrix = false;

/**
 * Returns the nearest rotation or reflection to the upper-left 3x3 part of a model matrix.
 * The polar decomposition removes scale and shear, and keeps the sign of the determinant.
 * The function ignores translation. A singular matrix gives the identity and a warning.
 */
export function getSkyModelRotation(
  modelMatrix?: Readonly<ArrayLike<number>> | null
): SkyModelRotation {
  if (!modelMatrix) {
    return {matrix: new Matrix4(), mirrored: false};
  }
  // Column-major 3x3, like the upper-left part of a Matrix4.
  let q = [0, 1, 2, 4, 5, 6, 8, 9, 10].map(index => Number(modelMatrix[index]));
  const determinant = getDeterminant3(q);
  const norm = getFrobeniusNorm3(q);
  if (
    !Number.isFinite(determinant) ||
    !Number.isFinite(norm) ||
    Math.abs(determinant) <= SINGULAR_TOLERANCE * norm ** 3
  ) {
    if (!warnedSingularModelMatrix) {
      warnedSingularModelMatrix = true;
      log.warn('SkyboxLayer: modelMatrix is singular. The sky uses the identity rotation.')();
    }
    return {matrix: new Matrix4(), mirrored: false};
  }

  // Scaled Newton iteration Q <- (g Q + Q^-T / g) / 2 converges to the orthogonal polar factor.
  for (let iteration = 0; iteration < MAX_POLAR_ITERATIONS; iteration++) {
    const inverseTranspose = getInverseTranspose3(q);
    const gamma = Math.sqrt(getFrobeniusNorm3(inverseTranspose) / getFrobeniusNorm3(q));
    const next = q.map((value, index) => (gamma * value + inverseTranspose[index] / gamma) / 2);
    const change = Math.max(...next.map((value, index) => Math.abs(value - q[index])));
    q = next;
    if (change < POLAR_TOLERANCE) {
      break;
    }
  }

  const matrix = new Matrix4();
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 3; row++) {
      matrix[column * 4 + row] = q[column * 3 + row];
    }
  }
  return {matrix, mirrored: determinant < 0};
}

/**
 * Returns the {@link skyProjection} uniforms for a viewport.
 * @param viewport The active viewport.
 * @param options.orientation The axis convention of the sky content.
 * @param options.modelMatrix An optional rotation of the sky in the world. The function applies
 *   only the rotation and reflection of the matrix (see {@link getSkyModelRotation}). It ignores
 *   translation, scale and shear. A singular matrix gives the identity rotation.
 * @param options.scale A uniform scale of the sky geometry, for example for a unit cube.
 */
export function getSkyProjectionProps(
  viewport: Viewport,
  options: {
    orientation?: SkyOrientation;
    modelMatrix?: Readonly<ArrayLike<number>> | null;
    scale?: number;
  } = {}
): SkyProjectionProps {
  const modelMatrix = getSkyModelRotation(options.modelMatrix).matrix;
  modelMatrix.multiplyRight(getSkyOrientationMatrix(options.orientation));
  if (options.scale !== undefined) {
    modelMatrix.scale(options.scale);
  }
  return {
    modelMatrix,
    viewMatrix: getSkyViewMatrix(viewport),
    projectionMatrix: viewport.projectionMatrix
  };
}

/** Returns the determinant of a column-major 3x3 matrix. */
function getDeterminant3(m: number[]): number {
  return (
    m[0] * (m[4] * m[8] - m[7] * m[5]) -
    m[3] * (m[1] * m[8] - m[7] * m[2]) +
    m[6] * (m[1] * m[5] - m[4] * m[2])
  );
}

/** Returns the Frobenius norm of a 3x3 matrix. */
function getFrobeniusNorm3(m: number[]): number {
  return Math.sqrt(m.reduce((sum, value) => sum + value * value, 0));
}

/** Returns the inverse transpose of a nonsingular column-major 3x3 matrix (cofactor / det). */
function getInverseTranspose3(m: number[]): number[] {
  const determinant = getDeterminant3(m);
  // The cofactor matrix C has C[r][c] at index c * 3 + r, like the input.
  return [
    m[4] * m[8] - m[7] * m[5],
    m[6] * m[5] - m[3] * m[8],
    m[3] * m[7] - m[6] * m[4],
    m[7] * m[2] - m[1] * m[8],
    m[0] * m[8] - m[6] * m[2],
    m[6] * m[1] - m[0] * m[7],
    m[1] * m[5] - m[4] * m[2],
    m[3] * m[2] - m[0] * m[5],
    m[0] * m[4] - m[3] * m[1]
  ].map(value => value / determinant);
}
