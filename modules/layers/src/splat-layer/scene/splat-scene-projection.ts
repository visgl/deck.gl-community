// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {COORDINATE_SYSTEM, type CoordinateSystem, type Viewport} from '@deck.gl/core';

/** Sorted scene matrices operate in a Cartesian host frame. */
export function getSplatSceneProjectionError(
  coordinateSystem: CoordinateSystem,
  viewport?: Viewport,
  hasRAD = false
): string | null {
  if (
    viewport?.isGeospatial ||
    (coordinateSystem !== COORDINATE_SYSTEM.DEFAULT &&
      coordinateSystem !== COORDINATE_SYSTEM.CARTESIAN)
  )
    return 'Sorted SplatLayer currently requires Cartesian coordinates and views.';
  if (hasRAD && viewport && isOrthographicSplatView(viewport))
    return 'RAD SplatLayer currently requires a perspective Cartesian view.';
  return null;
}

/** Constant clip W identifies orthographic projections, including orthographic OrbitView. */
export function isOrthographicSplatView(viewport: Viewport): boolean {
  const matrix = viewport.projectionMatrix;
  return matrix[3] === 0 && matrix[7] === 0 && matrix[11] === 0 && matrix[15] !== 0;
}
