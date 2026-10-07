// The only module that imports the style-spec package, so the expression engine can be swapped
// in one place.
import {
  Color,
  expression,
  featureFilter,
  latest as Reference
} from '@maplibre/maplibre-gl-style-spec';

/** A feature as seen by style expressions: a GeoJSON feature or a numeric-typed tile feature. */
export type StyleFeature = {
  type?: number | string;
  id?: unknown;
  geometry?: {type: string};
  properties?: Record<string, unknown>;
};

/** A style property compiled once and evaluated per zoom and feature. */
export type CompiledStyleProperty = {
  /** True when the value depends on `["zoom"]`. */
  isZoomDependent: boolean;
  /** True when the value depends on feature data (`["get", ...]`, `match`, ...). */
  isFeatureDependent: boolean;
  /** Evaluates the property. Colors are returned as `[r, g, b, a]`, with `a` in 0-1. */
  evaluate: (zoom: number, feature?: StyleFeature) => unknown;
};

type StyleLayerLike = {
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

type PropertyReference = Record<string, unknown> | null;

const GEOMETRY_TYPES: Record<string, number> = {
  Point: 1,
  MultiPoint: 1,
  LineString: 2,
  MultiLineString: 2,
  Polygon: 3,
  MultiPolygon: 3
};

const compiledPropertyCache = new WeakMap<object, Map<string, CompiledStyleProperty | null>>();

/** Returns whether a style property is a `layout` or a `paint` property. */
export function getStylePropertyType(propertyName: string): 'layout' | 'paint' {
  return Reference.layout.some(group => Reference[group]?.[propertyName]) ? 'layout' : 'paint';
}

/** Resolves the style-spec reference metadata for a layout or paint property name. */
export function getStylePropertyReference(propertyName: string): PropertyReference {
  for (const group of [...Reference.layout, ...Reference.paint]) {
    const reference = Reference[group]?.[propertyName];
    if (reference) {
      return reference as PropertyReference;
    }
  }
  return null;
}

/** Returns the style-spec geometry type code (1 point, 2 line, 3 polygon) of a feature. */
export function getStyleGeometryType(feature: StyleFeature): number | undefined {
  if (feature.type === 1 || feature.type === 2 || feature.type === 3) {
    return feature.type;
  }
  return GEOMETRY_TYPES[feature.geometry?.type || ''];
}

function toEvaluationFeature(feature?: StyleFeature) {
  if (!feature) {
    return undefined;
  }
  return {
    type: getStyleGeometryType(feature),
    id: feature.id,
    properties: feature.properties || {}
  };
}

/**
 * Converts a style-spec color to `[r, g, b, a]` with RGB in 0-255 and alpha in 0-1, the shape
 * `@mapbox/mapbox-gl-style-spec`'s `Color#toArray()` returned. MapLibre's `Color` stores
 * premultiplied components; its `rgb` getter returns them un-premultiplied in 0-1.
 */
export function colorToArray(color: Color): [number, number, number, number] {
  const [r, g, b, a] = color.rgb;
  return a === 0 ? [0, 0, 0, 0] : [r * 255, g * 255, b * 255, a];
}

function toPlainValue(value: any): unknown {
  return value instanceof Color ? colorToArray(value) : value;
}

/** Compiles a single property value against its style-spec reference. */
export function compileStylePropertyValue(
  propertyName: string,
  value: unknown
): CompiledStyleProperty {
  const compiled = expression.normalizePropertyExpression(
    value as any,
    getStylePropertyReference(propertyName) as any
  ) as any;
  const kind: string = compiled.kind;

  return {
    isZoomDependent: kind === 'camera' || kind === 'composite',
    isFeatureDependent: kind === 'source' || kind === 'composite',
    evaluate: (zoom, feature) =>
      toPlainValue(compiled.evaluate({zoom}, toEvaluationFeature(feature) as any))
  };
}

/**
 * Returns a compiled `paint` or `layout` property of a style layer, or `null` when the layer
 * does not set it. Compilation is cached per style layer object, so style layers are treated as
 * immutable once rendered.
 */
export function getCompiledStyleProperty(
  styleLayer: StyleLayerLike,
  propertyName: string
): CompiledStyleProperty | null {
  const propertyType = getStylePropertyType(propertyName);
  let layerCache = compiledPropertyCache.get(styleLayer);
  if (!layerCache) {
    layerCache = new Map();
    compiledPropertyCache.set(styleLayer, layerCache);
  }

  const key = propertyName;
  if (!layerCache.has(key)) {
    const value = styleLayer[propertyType]?.[propertyName];
    layerCache.set(
      key,
      value === undefined ? null : compileStylePropertyValue(propertyName, value)
    );
  }
  return layerCache.get(key) || null;
}

/** Compiles a style-spec filter into a feature predicate. */
export function compileStyleFilter(
  filter: unknown
): (globalProperties: Record<string, unknown>, feature: StyleFeature) => boolean {
  const filterFn = featureFilter(filter as any).filter;
  return (globalProperties, feature) =>
    filterFn(globalProperties as any, toEvaluationFeature(feature) as any);
}
