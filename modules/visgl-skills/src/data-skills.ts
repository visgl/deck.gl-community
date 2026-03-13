// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Color, LngLat} from './types';

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/**
 * Skill: create a linear colour accessor that maps a numeric value in
 * [domainMin, domainMax] to an RGBA colour interpolated between
 * `colorLow` and `colorHigh`.
 *
 * @example
 * ```ts
 * const getColor = createColorAccessor({
 *   getValue: d => d.temperature,
 *   domainMin: -10,
 *   domainMax: 40,
 *   colorLow: [0, 0, 255],
 *   colorHigh: [255, 0, 0],
 * });
 * // Use directly as a deck.gl getFillColor accessor.
 * ```
 */
export function createColorAccessor<D>(options: {
  getValue: (d: D) => number;
  domainMin: number;
  domainMax: number;
  colorLow?: Color;
  colorHigh?: Color;
  /** Alpha for low end. Defaults to 255. */
  alphaLow?: number;
  /** Alpha for high end. Defaults to 255. */
  alphaHigh?: number;
}): (d: D) => Color {
  const {
    getValue,
    domainMin,
    domainMax,
    colorLow = [0, 0, 255],
    colorHigh = [255, 0, 0],
    alphaLow = 255,
    alphaHigh = 255
  } = options;

  return (d: D): Color => {
    const t = Math.max(0, Math.min(1, (getValue(d) - domainMin) / (domainMax - domainMin)));
    const r = Math.round(colorLow[0] + t * (colorHigh[0] - colorLow[0]));
    const g = Math.round(colorLow[1] + t * (colorHigh[1] - colorLow[1]));
    const b = Math.round(colorLow[2] + t * (colorHigh[2] - colorLow[2]));
    const a = Math.round(alphaLow + t * (alphaHigh - alphaLow));
    return [r, g, b, a];
  };
}

// ---------------------------------------------------------------------------
// GeoJSON helpers
// ---------------------------------------------------------------------------

/** Minimal GeoJSON point feature type (avoids a heavy @types/geojson dep). */
export type PointFeature = {
  type: 'Feature';
  geometry: {type: 'Point'; coordinates: [number, number] | [number, number, number]};
  properties: Record<string, unknown>;
};

/** Minimal GeoJSON FeatureCollection type. */
export type PointFeatureCollection = {
  type: 'FeatureCollection';
  features: PointFeature[];
};

/**
 * Skill: extract an array of positions (LngLat) from a GeoJSON FeatureCollection
 * containing Point geometries.
 *
 * @example
 * ```ts
 * const positions = extractPositions(geojson);
 * const bbox = getBoundingBox(positions);
 * ```
 */
export function extractPositions(geojson: PointFeatureCollection): LngLat[] {
  return geojson.features.map((f) => f.geometry.coordinates);
}

/**
 * Skill: flatten a GeoJSON FeatureCollection into an array of plain data
 * objects that combine the feature properties with the position.
 *
 * The returned objects contain `longitude`, `latitude`, `altitude` (optional)
 * and all feature properties, making them easy to pass directly to layer
 * `data` arrays.
 *
 * @example
 * ```ts
 * const data = flattenGeoJSON(geojson);
 * const layer = createScatterplotLayer({
 *   data,
 *   getPosition: d => [d.longitude, d.latitude],
 *   getRadius: d => d.radius ?? 50,
 * });
 * ```
 */
export function flattenGeoJSON(
  geojson: PointFeatureCollection
): ({longitude: number; latitude: number; altitude?: number} & Record<string, unknown>)[] {
  return geojson.features.map((f) => {
    const [lng, lat, alt] = f.geometry.coordinates;
    const base: {longitude: number; latitude: number; altitude?: number} = {
      longitude: lng,
      latitude: lat
    };
    if (alt !== undefined) {
      base.altitude = alt;
    }
    return {...f.properties, ...base};
  });
}

// ---------------------------------------------------------------------------
// Radius / size helpers
// ---------------------------------------------------------------------------

/**
 * Skill: create a radius accessor that maps a numeric property to a pixel
 * radius clamped between `minPixels` and `maxPixels`.
 *
 * @example
 * ```ts
 * const getRadius = createRadiusAccessor({
 *   getValue: d => d.population,
 *   domainMin: 0,
 *   domainMax: 1_000_000,
 *   minPixels: 3,
 *   maxPixels: 40,
 * });
 * ```
 */
export function createRadiusAccessor<D>(options: {
  getValue: (d: D) => number;
  domainMin: number;
  domainMax: number;
  minPixels?: number;
  maxPixels?: number;
}): (d: D) => number {
  const {getValue, domainMin, domainMax, minPixels = 2, maxPixels = 30} = options;

  return (d: D): number => {
    const t = Math.max(0, Math.min(1, (getValue(d) - domainMin) / (domainMax - domainMin)));
    return minPixels + t * (maxPixels - minPixels);
  };
}
