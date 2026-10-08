import {getCompiledStyleProperty, type StyleFeature} from './style-expression';

type StyleLayerLike = {
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

/**
 * Integer zoom at which style values are evaluated.
 *
 * This is a temporary simplification, not MapLibre's behaviour. MapLibre evaluates zoom-dependent
 * expressions at the integer zooms on either side of the current zoom and interpolates between
 * them on the GPU. Here every value steps at integer zooms, so tiles generated at different
 * fractional zooms within one integer zoom agree.
 */
export function getZoomBucket(zoom: number): number {
  return Math.floor(zoom);
}

/**
 * A key that changes whenever style evaluation or layer visibility changes: at every integer
 * zoom, and at every fractional `minzoom`/`maxzoom` in `zoomLimits`. Layer visibility uses the
 * exact zoom, as in MapLibre, so crossing a fractional limit must regenerate sublayers too.
 */
export function getStyleZoomKey(zoom: number, zoomLimits: readonly (number | undefined)[]): string {
  const crossed = zoomLimits.filter(
    limit => limit !== undefined && !Number.isInteger(limit) && zoom >= limit
  ).length;
  return `${getZoomBucket(zoom)}:${crossed}`;
}

/** A deck.gl accessor built from one or more style properties. */
export type StyleAccessor<T> = {
  /** A constant when no property depends on feature data, otherwise a per-feature function. */
  value: T | ((feature: StyleFeature) => T);
  /** Set to the integer zoom when a per-feature value also depends on zoom. */
  updateTrigger?: number;
};

/**
 * Builds a deck.gl accessor from style properties, evaluated at the integer zoom
 * (`getZoomBucket`). Feature-independent values become constants. Data-driven values become
 * per-feature functions, with an update trigger when they also depend on zoom.
 */
export function getStyleAccessor<T>(
  styleLayer: StyleLayerLike,
  propertyNames: string[],
  zoom: number,
  combine: (values: any[]) => T
): StyleAccessor<T> {
  const properties = propertyNames.map(name => getCompiledStyleProperty(styleLayer, name));
  const isFeatureDependent = properties.some(property => property?.isFeatureDependent);
  const zoomBucket = getZoomBucket(zoom);

  if (!isFeatureDependent) {
    return {value: combine(properties.map(property => property?.evaluate(zoomBucket)))};
  }

  const isZoomDependent = properties.some(property => property?.isZoomDependent);
  return {
    value: (feature: StyleFeature) =>
      combine(properties.map(property => property?.evaluate(zoomBucket, feature))),
    updateTrigger: isZoomDependent ? zoomBucket : undefined
  };
}

/** Converts a style color (alpha 0-1 or 0-255) and opacity into a deck.gl RGBA color. */
export function withOpacity(
  color: number[] | null | undefined,
  opacity = 1
): [number, number, number, number] {
  if (!color) {
    return [0, 0, 0, 0];
  }

  const alpha = color.length > 3 ? (color[3] <= 1 ? color[3] * 255 : color[3]) : 255;
  return [color[0], color[1], color[2], Math.round(alpha * opacity)];
}
