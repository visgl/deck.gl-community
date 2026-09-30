// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * A single `[zoom, opacity]` stop. `opacity` is a multiplier in `[0, 1]` applied to the
 * layer's `opacity` prop.
 */
export type ZoomOpacityStop = readonly [zoom: number, opacity: number];

/**
 * Zoom stops sorted by ascending zoom, equivalent to the stop list of a MapLibre
 * `["interpolate", ["linear"], ["zoom"], z0, v0, z1, v1, ...]` expression.
 *
 * Unlike MapLibre, two consecutive stops may share the same zoom to express a hard step
 * (for example a `minzoom`/`maxzoom` cutoff). At exactly that zoom the later stop wins.
 */
export type ZoomOpacityStops = readonly ZoomOpacityStop[];

/** Options for {@link zoomBand}. */
export type ZoomBandOptions = {
  /** Zoom at which the band starts fading in. Omit for no lower bound. */
  minZoom?: number;
  /** Zoom at which the band starts fading out. Omit for no upper bound. */
  maxZoom?: number;
  /**
   * Width, in zoom levels, of each fade ramp. The ramps are centered on `minZoom` and `maxZoom`
   * so two bands sharing a boundary crossfade. `0` produces hard cutoffs with MapLibre
   * `minzoom` (inclusive) / `maxzoom` (exclusive) semantics.
   * @default 1
   */
  fadeWidth?: number;
};

/**
 * Evaluates zoom stops at a zoom level using linear interpolation, clamped to the first and
 * last stop values.
 *
 * @param zoom - Zoom level to evaluate.
 * @param stops - `[zoom, opacity]` pairs sorted by ascending zoom.
 * @returns The interpolated opacity multiplier, clamped to `[0, 1]`. Returns `1` when `stops`
 * is empty or missing, or when `zoom` is not a finite number.
 */
export function interpolateZoom(zoom: number, stops?: ZoomOpacityStops | null): number {
  if (!stops || stops.length === 0 || !Number.isFinite(zoom)) {
    return 1;
  }

  // Find the first stop strictly above `zoom`; ties resolve to the later stop.
  let upperIndex = 0;
  while (upperIndex < stops.length && stops[upperIndex][0] <= zoom) {
    upperIndex++;
  }

  let value: number;
  if (upperIndex === 0) {
    value = stops[0][1];
  } else if (upperIndex === stops.length) {
    value = stops[stops.length - 1][1];
  } else {
    const [z0, v0] = stops[upperIndex - 1];
    const [z1, v1] = stops[upperIndex];
    value = v0 + ((zoom - z0) / (z1 - z0)) * (v1 - v0);
  }

  return clampOpacity(value);
}

/**
 * Builds zoom stops for a layer that is visible within a zoom band and fades in and out at its
 * edges.
 *
 * Fades are centered on the band edges: opacity is `0.5` at exactly `minZoom` and `maxZoom`.
 * Adjacent bands that share an edge and a `fadeWidth` therefore crossfade, with opacities that
 * sum to 1 across the transition.
 *
 * @example
 * ```ts
 * zoomBand({minZoom: 8, maxZoom: 11, fadeWidth: 1});
 * // [[7.5, 0], [8.5, 1], [10.5, 1], [11.5, 0]]
 * ```
 *
 * @param options - Band edges and fade width.
 * @returns Zoom stops suitable for the `zoomOpacity` prop.
 */
export function zoomBand({minZoom, maxZoom, fadeWidth = 1}: ZoomBandOptions): ZoomOpacityStop[] {
  const hasMin = Number.isFinite(minZoom);
  const hasMax = Number.isFinite(maxZoom);
  let halfWidth = Math.max(fadeWidth, 0) / 2;
  if (hasMin && hasMax) {
    if ((maxZoom as number) < (minZoom as number)) {
      throw new Error(`zoomBand: maxZoom (${maxZoom}) must be >= minZoom (${minZoom})`);
    }
    // Keep stops sorted when the band is narrower than the fade width.
    halfWidth = Math.min(halfWidth, ((maxZoom as number) - (minZoom as number)) / 2);
  }

  const stops: ZoomOpacityStop[] = [];
  if (hasMin) {
    stops.push([(minZoom as number) - halfWidth, 0], [(minZoom as number) + halfWidth, 1]);
  }
  if (hasMax) {
    stops.push([(maxZoom as number) - halfWidth, 1], [(maxZoom as number) + halfWidth, 0]);
  }
  return stops;
}

/**
 * Returns a scalar zoom for a viewport-like object. Viewports with per-axis zoom
 * (`[zoomX, zoomY]`) use the smaller of the two, matching `OrthographicViewport`.
 *
 * @param viewport - Object with an optional `zoom` field.
 * @returns The zoom, or `NaN` when the viewport has no usable zoom.
 */
export function getViewportZoom(viewport?: {zoom?: number | readonly number[]} | null): number {
  const zoom = viewport?.zoom;
  if (Array.isArray(zoom)) {
    return zoom.length ? Math.min(...zoom) : Number.NaN;
  }
  return typeof zoom === 'number' ? zoom : Number.NaN;
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(Math.max(value, 0), 1);
}
