import {latest as Reference, featureFilter, expression, Color} from '@mapbox/mapbox-gl-style-spec';

// See https://github.com/mapbox/vector-tile-spec/blob/b87a6a16abc3fcda9ea3f0a68264b40f48e039f3/2.1/vector_tile.proto#L7-L13
const GEOM_TYPES = {
  Point: 1,
  MultiPoint: 1,
  LineString: 2,
  MultiLineString: 2,
  Polygon: 3,
  MultiPolygon: 3
};

/**
 * Apply Mapbox Style Spec filter on features
 *
 * @param  {object[]} features   Note that each feature must have a `properties` object and a
 *  `type` value or a `geometry` object with a `type` value.
 *
 * @param  {array} filter           filter definition
 * @param  {object} globalProperties {zoom: current zoom}
 * @return {object[]}                Filtered features
 */
export function filterFeatures({features, filter, globalProperties = {}}) {
  if (!features || features.length === 0) return [];

  // filterFn will be a function that returns a boolean
  const filterFn = featureFilter(filter);

  // Filter array of features based on filter function
  return features.filter((feature) => {
    // Coerce string geometry type to integer type
    if (![1, 2, 3].includes(feature.type)) {
      feature.type = GEOM_TYPES[feature.geometry.type];
    }

    return filterFn(globalProperties, feature);
  });
}

// TODO: update this function to accept an array of features as input, not an
// object
// features expected to be
// {sourceName: {layerName: [features]}}
export function findFeaturesStyledByLayer({features, layer, globalProperties}) {
  // features matching the source and source-layer
  const sourceLayerFeatures = features[layer.source][layer['source-layer']];
  if (!sourceLayerFeatures) return [];

  if (layer.filter && layer.filter.length > 0) {
    return filterFeatures({
      features: sourceLayerFeatures,
      filter: layer.filter,
      globalProperties
    });
  }

  return [];
}

function visitProperties(layer, options, callback) {
  // Modified from https://github.com/mapbox/mapbox-gl-js/blob/d144fbc34ddec9e7a8fc34125d3a92558fa99318/src/style-spec/visit.js#L53-L67
  function inner(layer, propertyType) {
    const properties = layer[propertyType];
    if (!properties) return;
    Object.keys(properties).forEach((key) => {
      callback({
        layer,
        path: [layer.id, propertyType, key],
        key,
        value: properties[key],
        reference: getPropertyReference(key),
        set(x) {
          properties[key] = x;
        }
      });
    });
  }

  if (options.paint) {
    inner(layer, 'paint');
  }
  if (options.layout) {
    inner(layer, 'layout');
  }
}

// https://github.com/mapbox/mapbox-gl-js/blob/d144fbc34ddec9e7a8fc34125d3a92558fa99318/src/style-spec/visit.js#L13-L26
function getPropertyReference(propertyName) {
  for (let i = 0; i < Reference.layout.length; i++) {
    for (const key in Reference[Reference.layout[i]]) {
      if (key === propertyName) return Reference[Reference.layout[i]][key];
    }
  }
  for (let i = 0; i < Reference.paint.length; i++) {
    for (const key in Reference[Reference.paint[i]]) {
      if (key === propertyName) return Reference[Reference.paint[i]][key];
    }
  }

  return null;
}

export function parseProperties(layer, globalProperties) {
  // An array of Property objects for this specific layer
  const layerProperties = [];
  visitProperties(layer, {paint: true}, (property) =>
    layerProperties.push(parseProperty(property, globalProperties))
  );

  return layerProperties;
}

function parseProperty(property, globalProperties) {
  const exp = expression.normalizePropertyExpression(property.value, property.reference);
  const result = exp.evaluate(globalProperties);

  // NOTE: eventually we could potentially return the function itself
  // (exp.evaluate), if deck.gl were able to call it with an object {zoom:
  // number}
  // Exp objects have a 'kind' key, which is sometimes `constant`. When not
  // constant, would return a function, but would return the literal constant
  // where possible for performance.

  // Coerce Color to rgba array
  if (result instanceof Color) {
    return {[property.key]: result.toArray()};
  }

  return {[property.key]: result};
}
