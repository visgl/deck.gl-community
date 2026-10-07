import {getCompiledStyleProperty, type StyleFeature} from './style-expression';

type StyleLayerLike = {
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

/** Integer zoom used to evaluate and cache zoom-dependent, data-driven style values. */
export function getZoomBucket(zoom: number): number {
  return Math.floor(zoom);
}

/** A deck.gl accessor built from one or more style properties. */
export type StyleAccessor<T> = {
  /** A constant when no property depends on feature data, otherwise a per-feature function. */
  value: T | ((feature: StyleFeature) => T);
  /** Set to the integer zoom when a per-feature value also depends on zoom. */
  updateTrigger?: number;
};

/**
 * Builds a deck.gl accessor from style properties. Feature-independent values stay constants
 * evaluated at the exact zoom. Data-driven values become per-feature functions evaluated at the
 * integer zoom, which re-run only when that integer changes.
 */
export function getStyleAccessor<T>(
  styleLayer: StyleLayerLike,
  propertyNames: string[],
  zoom: number,
  combine: (values: any[]) => T
): StyleAccessor<T> {
  const properties = propertyNames.map(name => getCompiledStyleProperty(styleLayer, name));
  const isFeatureDependent = properties.some(property => property?.isFeatureDependent);

  if (!isFeatureDependent) {
    return {value: combine(properties.map(property => property?.evaluate(zoom)))};
  }

  const zoomBucket = getZoomBucket(zoom);
  const isZoomDependent = properties.some(property => property?.isZoomDependent);
  return {
    value: (feature: StyleFeature) =>
      combine(properties.map(property => property?.evaluate(zoomBucket, feature))),
    updateTrigger: isZoomDependent ? zoomBucket : undefined
  };
}
