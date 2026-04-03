type FeatureLike = {
  properties?: Record<string, unknown>;
};

/**
 * Options for {@link featuresArrayToObject}.
 */
export type FeaturesArrayToObjectOptions = {
  /** Features to group by the requested layer-name property. */
  features?: FeatureLike[];
  /** Feature property name that contains the source-layer identifier. */
  layerName?: string;
  /** Optional source name wrapper for the returned object. */
  sourceName?: string | null;
};

/**
 * Converts an array of GeoJSON-like features into an object keyed by layer
 * name, optionally wrapped by a source identifier.
 */
export function featuresArrayToObject(
  options: FeaturesArrayToObjectOptions = {}
): Record<string, FeatureLike[] | Record<string, FeatureLike[]>> {
  const {features = [], layerName = 'layerName', sourceName = null} = options;

  const featuresByLayer: Record<string, FeatureLike[]> = {};
  for (const feature of features) {
    const featureLayerName = String(feature.properties?.[layerName] ?? '');
    featuresByLayer[featureLayerName] = featuresByLayer[featureLayerName] || [];
    featuresByLayer[featureLayerName].push(feature);
  }

  if (!sourceName) {
    return featuresByLayer;
  }

  return {[sourceName]: featuresByLayer};
}
