// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Viewport} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import type {NumberArray16} from '@math.gl/core';
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

/**
 * Returns the {@link skyProjection} uniforms for a viewport.
 * @param viewport The active viewport.
 * @param options.orientation The axis convention of the sky content.
 * @param options.modelMatrix An optional rotation of the sky in the world. Translation is ignored.
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
  const modelMatrix = new Matrix4();
  if (options.modelMatrix) {
    modelMatrix.copy(options.modelMatrix as NumberArray16);
    modelMatrix[12] = 0;
    modelMatrix[13] = 0;
    modelMatrix[14] = 0;
  }
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
