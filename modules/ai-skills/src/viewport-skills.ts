// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ViewState} from './types';

/**
 * Create a basic Web Mercator view state.
 */
export function createViewState(
  longitude: number,
  latitude: number,
  zoom: number,
  options: Partial<ViewState> = {}
): ViewState {
  return {longitude, latitude, zoom, pitch: 0, bearing: 0, ...options};
}

/**
 * Compute the bounding box of an array of [lng, lat] positions.
 * Returns [minLng, minLat, maxLng, maxLat].
 */
export function getBoundingBox(
  positions: [number, number][]
): [number, number, number, number] | null {
  if (positions.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of positions) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Fit a Web Mercator viewport to a set of [lng, lat] positions.
 * `viewportWidth` and `viewportHeight` default to 800×600 if omitted.
 *
 * Returns a ViewState centered on the data with a zoom level that fits all
 * points with optional padding (in degrees, default 0.1).
 */
export function fitViewport(
  positions: [number, number][],
  viewportWidth = 800,
  viewportHeight = 600,
  paddingDeg = 0.1
): ViewState {
  const bbox = getBoundingBox(positions);
  if (!bbox) return {longitude: 0, latitude: 0, zoom: 2};

  const [minLng, minLat, maxLng, maxLat] = bbox;
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;

  const lngSpan = maxLng - minLng + paddingDeg * 2;
  const latSpan = maxLat - minLat + paddingDeg * 2;

  // Mercator zoom: fit the larger of the two spans to the viewport
  const zoomLng = Math.log2((viewportWidth / 256) * (360 / lngSpan));
  const zoomLat = Math.log2((viewportHeight / 256) * (180 / latSpan));
  const zoom = Math.max(0, Math.min(20, Math.floor(Math.min(zoomLng, zoomLat))));

  return {longitude: centerLng, latitude: centerLat, zoom, pitch: 0, bearing: 0};
}
