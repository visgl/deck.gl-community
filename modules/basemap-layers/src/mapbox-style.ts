import {Color, expression, featureFilter, latest as Reference} from '@mapbox/mapbox-gl-style-spec';

type GlobalProperties = {
  zoom?: number;
  [key: string]: unknown;
};

type GeometryLike = {
  type: string;
};

type FeatureLike = {
  type?: number | string;
  geometry?: GeometryLike;
  properties?: Record<string, unknown>;
};

type FilterFeaturesOptions = {
  features: FeatureLike[];
  filter: unknown[];
  globalProperties?: GlobalProperties;
};

type FindFeaturesStyledByLayerOptions = {
  features: Record<string, Record<string, FeatureLike[]>>;
  layer: {
    source?: string;
    'source-layer'?: string;
    filter?: unknown[];
  };
  globalProperties?: GlobalProperties;
};

type PropertyReference = Record<string, unknown> | null;

type VisitedProperty = {
  layer: Record<string, any>;
  path: string[];
  key: string;
  value: unknown;
  reference: PropertyReference;
  set: (value: unknown) => void;
};

type VisitOptions = {
  paint?: boolean;
  layout?: boolean;
};

const GEOM_TYPES: Record<string, number> = {
  Point: 1,
  MultiPoint: 1,
  LineString: 2,
  MultiLineString: 2,
  Polygon: 3,
  MultiPolygon: 3
};

/**
 * Applies a Mapbox style-spec filter expression to a set of features.
 */
export function filterFeatures({
  features,
  filter,
  globalProperties = {}
}: FilterFeaturesOptions): FeatureLike[] {
  if (!features || features.length === 0) {
    return [];
  }

  const filterFn = featureFilter(filter).filter;

  return features.filter((feature) => {
    if (![1, 2, 3].includes(Number(feature.type))) {
      feature.type = GEOM_TYPES[feature.geometry?.type || ''] ?? feature.type;
    }

    return filterFn(globalProperties, feature);
  });
}

/**
 * Finds the source-layer features that participate in a particular style layer
 * and applies the layer's filter expression when present.
 */
export function findFeaturesStyledByLayer({
  features,
  layer,
  globalProperties
}: FindFeaturesStyledByLayerOptions): FeatureLike[] {
  const sourceLayerFeatures = features[layer.source || '']?.[layer['source-layer'] || ''];
  if (!sourceLayerFeatures) {
    return [];
  }

  if (layer.filter && layer.filter.length > 0) {
    return filterFeatures({
      features: sourceLayerFeatures,
      filter: layer.filter,
      globalProperties
    });
  }

  return [];
}

/**
 * Evaluates paint properties for a style layer at the requested zoom.
 */
export function parseProperties(
  layer: Record<string, any>,
  globalProperties: GlobalProperties
): Array<Record<string, unknown>> {
  const layerProperties: Array<Record<string, unknown>> = [];
  visitProperties(layer, {paint: true}, (property) => {
    layerProperties.push(parseProperty(property, globalProperties));
  });

  return layerProperties;
}

/**
 * Walks layout and paint properties for a style layer.
 */
function visitProperties(
  layer: Record<string, any>,
  options: VisitOptions,
  callback: (property: VisitedProperty) => void
): void {
  function inner(targetLayer: Record<string, any>, propertyType: 'paint' | 'layout') {
    const properties = targetLayer[propertyType];
    if (!properties) {
      return;
    }

    Object.keys(properties).forEach((key) => {
      callback({
        layer: targetLayer,
        path: [targetLayer.id, propertyType, key],
        key,
        value: properties[key],
        reference: getPropertyReference(key),
        set(value) {
          properties[key] = value;
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

/**
 * Resolves the style-spec reference metadata for a property name.
 */
function getPropertyReference(propertyName: string): PropertyReference {
  for (let i = 0; i < Reference.layout.length; i++) {
    for (const key in Reference[Reference.layout[i]]) {
      if (key === propertyName) {
        return Reference[Reference.layout[i]][key] as PropertyReference;
      }
    }
  }

  for (let i = 0; i < Reference.paint.length; i++) {
    for (const key in Reference[Reference.paint[i]]) {
      if (key === propertyName) {
        return Reference[Reference.paint[i]][key] as PropertyReference;
      }
    }
  }

  return null;
}

/**
 * Evaluates a single style property expression.
 */
function parseProperty(
  property: VisitedProperty,
  globalProperties: GlobalProperties
): Record<string, unknown> {
  const exp = expression.normalizePropertyExpression(property.value, property.reference as any);
  const result = exp.evaluate(globalProperties);

  if (result instanceof Color) {
    return {[property.key]: result.toArray()};
  }

  return {[property.key]: result};
}
