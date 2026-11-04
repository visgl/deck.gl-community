// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {_GlobeViewport as GlobeViewport} from '@deck.gl/core';

/**
 * deck.gl's `PROJECTION_MODE.GLOBE`. The value is 2 in deck.gl 9.4 and in v10. deck.gl 9.4 exports
 * the table only as `_PROJECTION_MODE`, and v10 does not export it.
 */
const PROJECTION_MODE_GLOBE = 2;

/**
 * Returns true when `viewport` draws a 3D globe (`GlobeView` below zoom 12).
 *
 * The test reads `viewport.projectionMode`, which every deck.gl `Viewport` defines in 9.4 and in
 * v10. `GlobeViewport` returns `PROJECTION_MODE.GLOBE`. Other viewports return other modes, and so
 * does the Web Mercator viewport that `GlobeView` uses above zoom 12.
 *
 * Do not test `viewport.resolution` for a globe. In 9.4 only `GlobeViewport` sets it (10 by
 * default), but v10 makes it the subdivision detail of every viewport and sets it to 0 by default,
 * `GlobeView` included. Do not use `instanceof GlobeViewport` alone either: it fails when an
 * application loads two copies of `@deck.gl/core`.
 *
 * Fallback: an object without a numeric `projectionMode` is a globe only when it is an instance
 * of this `@deck.gl/core` copy's `GlobeViewport`.
 */
export function isGlobeViewport(viewport: unknown): boolean {
  if (!viewport || typeof viewport !== 'object') {
    return false;
  }
  const {projectionMode} = viewport as {projectionMode?: unknown};
  if (typeof projectionMode === 'number') {
    return projectionMode === PROJECTION_MODE_GLOBE;
  }
  return viewport instanceof GlobeViewport;
}
