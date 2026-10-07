// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Viewport} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import type {SplatHierarchyView} from '@luma.gl/splats';
/** Converts deck's Cartesian camera to source-local coordinates and physical viewport pixels. */
export function getSplatHierarchyView(
  viewport: Viewport,
  modelMatrix: Matrix4,
  pixelRatio: number
): SplatHierarchyView {
  const cameraPosition = new Matrix4(modelMatrix)
    .invert()
    .transformAsPoint(viewport.cameraPosition);
  return {
    modelViewProjectionMatrix: new Matrix4(viewport.viewProjectionMatrix).multiplyRight(
      modelMatrix
    ),
    cameraPosition: [cameraPosition[0], cameraPosition[1], cameraPosition[2]],
    viewportSize: [
      Math.max(1, viewport.width * pixelRatio),
      Math.max(1, viewport.height * pixelRatio)
    ],
    verticalFieldOfView: 2 * Math.atan(1 / viewport.projectionMatrix[5]),
    // Use one viewport-relative falloff, with full priority through each edge midpoint.
    // Normalizing each axis separately avoids spending a portrait view's budget offscreen.
    foveation: {center: [0.5, 0.5], radius: 0.5, strength: 12}
  };
}
