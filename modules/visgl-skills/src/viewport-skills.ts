// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {BoundingBox, LngLat, ViewState} from './types';

// ---------------------------------------------------------------------------
// View-state helpers
// ---------------------------------------------------------------------------

/** Options for {@link createViewState}. */
export type CreateViewStateOptions = {
  /** Map centre longitude. Defaults to 0. */
  longitude?: number;
  /** Map centre latitude. Defaults to 0. */
  latitude?: number;
  /** Zoom level (0 = world, 20 = building). Defaults to 1. */
  zoom?: number;
  /** Camera tilt in degrees (0 = top-down). Defaults to 0. */
  pitch?: number;
  /** Camera rotation in degrees (0 = north-up). Defaults to 0. */
  bearing?: number;
  /** Minimum allowed zoom. Defaults to 0. */
  minZoom?: number;
  /** Maximum allowed zoom. Defaults to 20. */
  maxZoom?: number;
};

/**
 * Skill: construct a deck.gl view-state object with sensible defaults.
 *
 * @example
 * ```ts
 * const viewState = createViewState({longitude: -122.4, latitude: 37.8, zoom: 11});
 * ```
 */
export function createViewState(options: CreateViewStateOptions = {}): ViewState {
  const {
    longitude = 0,
    latitude = 0,
    zoom = 1,
    pitch = 0,
    bearing = 0,
    minZoom = 0,
    maxZoom = 20
  } = options;

  return {longitude, latitude, zoom, pitch, bearing, minZoom, maxZoom};
}

// ---------------------------------------------------------------------------
// Bounding-box helpers
// ---------------------------------------------------------------------------

/**
 * Skill: compute the bounding box [[minLng, minLat], [maxLng, maxLat]] for
 * an array of positions.
 *
 * @example
 * ```ts
 * const bbox = getBoundingBox([[0, 0], [10, 20], [-5, 15]]);
 * // → [-5, 0, 10, 20]
 * ```
 */
export function getBoundingBox(positions: LngLat[]): BoundingBox {
  if (positions.length === 0) {
    return [0, 0, 0, 0];
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const pos of positions) {
    const lng = pos[0];
    const lat = pos[1];
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }

  return [minLng, minLat, maxLng, maxLat];
}

/** Options for {@link fitViewport}. */
export type FitViewportOptions = {
  /** Viewport width in pixels. Required for accurate zoom computation. */
  width: number;
  /** Viewport height in pixels. Required for accurate zoom computation. */
  height: number;
  /** Padding in pixels to add around the bounds. Defaults to 40. */
  padding?: number;
  /** Camera tilt to include in the result. Defaults to 0. */
  pitch?: number;
  /** Camera rotation to include in the result. Defaults to 0. */
  bearing?: number;
  /** Maximum zoom to return. Defaults to 16. */
  maxZoom?: number;
};

/**
 * Skill: compute a ViewState that fits a bounding box into the given
 * viewport dimensions.
 *
 * The zoom is calculated using the standard Web Mercator formula so that the
 * entire bounding box is visible with optional padding.
 *
 * @example
 * ```ts
 * const bbox = getBoundingBox(positions);
 * const viewState = fitViewport(bbox, {width: 800, height: 600, padding: 50});
 * ```
 */
export function fitViewport(bbox: BoundingBox, options: FitViewportOptions): ViewState {
  const {width, height, padding = 40, pitch = 0, bearing = 0, maxZoom = 16} = options;

  const [minLng, minLat, maxLng, maxLat] = bbox;

  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;

  // Approximate zoom using Web Mercator tile size (256 px per tile at zoom 0).
  const TILE_SIZE = 256;
  const lngDelta = Math.abs(maxLng - minLng) || 1;
  const latDelta = Math.abs(maxLat - minLat) || 1;

  const usableWidth = Math.max(width - padding * 2, 1);
  const usableHeight = Math.max(height - padding * 2, 1);

  const zoomLng = Math.log2((usableWidth / TILE_SIZE) * (360 / lngDelta));
  const zoomLat = Math.log2(
    (usableHeight / TILE_SIZE) * (180 / (latDelta * Math.cos((centerLat * Math.PI) / 180)))
  );

  const zoom = Math.min(Math.max(0, Math.min(zoomLng, zoomLat)), maxZoom);

  return {
    longitude: centerLng,
    latitude: centerLat,
    zoom,
    pitch,
    bearing,
    minZoom: 0,
    maxZoom
  };
}
