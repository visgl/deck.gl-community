// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {WebMercatorViewport} from '@deck.gl/core';
import {WebMercatorViewport as MathWebMercatorViewport} from '@math.gl/web-mercator';
import type {Position} from './geojson-types';

/** The projection methods shared by deck.gl and math.gl viewports. */
type ProjectingViewport = {
  project: (xyz: number[]) => number[];
  unproject: (xyz: number[], options?: {targetZ?: number}) => number[];
};

/**
 * Height in meters of the point a map camera orbits. Map views lift it with viewState
 * `position: [0, 0, z]`, as deck.gl's terrain controller does to orbit the terrain at the
 * center of the view. A math.gl viewport built from such a viewState keeps it as `meterOffset`.
 * Other views use `position` for the eye or not at all, so they stay at 0.
 */
export function getCameraTargetZ(viewport: unknown): number {
  if (viewport instanceof WebMercatorViewport) return viewport.position?.[2] || 0;
  if (viewport instanceof MathWebMercatorViewport) return viewport.meterOffset[2] || 0;
  return 0;
}

/**
 * Screen pixel of a 2D position on the horizontal plane through the camera target.
 * 3D positions project at their own Z.
 */
export function projectOnTargetPlane(viewport: ProjectingViewport, position: Position): number[] {
  const targetZ = getCameraTargetZ(viewport);
  return targetZ && position.length < 3
    ? viewport.project([position[0], position[1], targetZ]).slice(0, 2)
    : viewport.project(position);
}

/**
 * 2D position under a screen pixel, on the horizontal plane through the camera target.
 * Pixels that carry depth unproject at that depth.
 */
export function unprojectOnTargetPlane(viewport: ProjectingViewport, pixel: number[]): Position {
  const targetZ = getCameraTargetZ(viewport);
  if (!targetZ || pixel.length > 2) {
    return viewport.unproject(pixel);
  }
  const [x, y] = viewport.unproject(pixel, {targetZ});
  return [x, y];
}
