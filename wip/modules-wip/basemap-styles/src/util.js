// Convert an array of GeoJSON features to an object of features sorted by layer name
export function featuresArrayToObject(options = {}) {
  const {features, layerName, sourceName = null} = options;

  const featuresByLayer = {};
  for (const feature of features) {
    const featureLayerName = feature.properties[layerName];
    featuresByLayer[featureLayerName] = featuresByLayer[featureLayerName] || [];
    featuresByLayer[featureLayerName].push(feature);
  }

  if (!sourceName) {
    return featuresByLayer;
  }

  return {[sourceName]: featuresByLayer};
}
