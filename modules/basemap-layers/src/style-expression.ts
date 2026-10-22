// The only module that imports the style-spec package, so the expression engine can be swapped
// in one place.
import {log} from '@deck.gl/core';
import {
  Color,
  ColorArray,
  NumberArray,
  Padding,
  VariableAnchorOffsetCollection,
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
  /**
   * Evaluates the property. Colors are returned as `[r, g, b, a]`, with `a` in 0-1.
   * `availableImages` lists the loaded sprite image names, which `["image", ...]` checks.
   */
  evaluate: (zoom: number, feature?: StyleFeature, availableImages?: string[]) => unknown;
  /**
   * Evaluates the property with every global input, such as `heatmapDensity` or `lineProgress`
   * as well as `zoom`. Colors are returned as in `evaluate`.
   */
  evaluateWithGlobals: (globals: Record<string, unknown>, feature?: StyleFeature) => unknown;
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

type CompiledPropertyEntry = {
  propertyType: 'paint' | 'layout';
  value: unknown;
  compiled: CompiledStyleProperty | null;
};

const compiledPropertyCache = new WeakMap<object, Map<string, CompiledPropertyEntry>>();
/** Compiled filters per filter array, with the array's contents when it was compiled. */
const compiledFilterCache = new WeakMap<object, {snapshot: string; compiled: StyleFilter}>();
const warnedValues = new Set<string>();

type StyleFilter = (globalProperties: Record<string, unknown>, feature: StyleFeature) => boolean;

/** Logs an invalid style value once per property and value. */
function warnInvalidValue(propertyName: string, value: unknown, error: unknown): void {
  const key = `${propertyName}:${JSON.stringify(value)}`;
  if (!warnedValues.has(key)) {
    warnedValues.add(key);
    log.warn(`Ignoring invalid style value for ${propertyName}: ${String(error)}`)();
  }
}

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

/**
 * Returns the style specification's default for a property, in the shape `evaluate` returns:
 * colors as `[r, g, b, a]`, paddings as `[top, right, bottom, left]`. Undefined for a property
 * without a default.
 */
export function getStylePropertyDefault(propertyName: string): unknown {
  const reference = getStylePropertyReference(propertyName);
  const value = reference?.default;
  if (reference?.type === 'color' && typeof value === 'string') {
    const color = Color.parse(value);
    return color ? colorToArray(color) : undefined;
  }
  if (reference?.type === 'padding') {
    return Padding.parse(value as number | number[])?.values;
  }
  if (reference?.type === 'numberArray') {
    return NumberArray.parse(value as number | number[])?.values;
  }
  if (reference?.type === 'colorArray') {
    return ColorArray.parse(value as string | string[])?.values.map(colorToArray);
  }
  return value;
}

/**
 * Converts an evaluated value to plain data: colors as `[r, g, b, a]`, paddings and number arrays
 * as arrays of numbers, color arrays as arrays of `[r, g, b, a]`.
 */
function toPlainValue(value: any): unknown {
  if (value instanceof Padding || value instanceof NumberArray) {
    return value.values;
  }
  if (value instanceof ColorArray) {
    return value.values.map(colorToArray);
  }
  if (value instanceof VariableAnchorOffsetCollection) {
    // `[anchor, [x, y], anchor, [x, y], ...]`.
    return value.values;
  }
  return value instanceof Color ? colorToArray(value) : value;
}

/**
 * Compiles a single property value against its style-spec reference. Returns `null` and logs a
 * warning once for a value the style spec rejects, so the property is treated as unset, as
 * MapLibre skips invalid properties.
 */
export function compileStylePropertyValue(
  propertyName: string,
  value: unknown
): CompiledStyleProperty | null {
  const reference = getStylePropertyReference(propertyName);
  let compiled: any;
  try {
    // An array whose first element is not a known operator is read as a literal. That is only
    // valid for array-typed properties (`text-font`, `line-dasharray`, ...), paddings
    // (`icon-padding: [2, 4]`), number and color arrays and `text-variable-anchor-offset`.
    const takesArray =
      reference?.type === 'array' ||
      reference?.type === 'padding' ||
      reference?.type === 'numberArray' ||
      reference?.type === 'colorArray' ||
      reference?.type === 'variableAnchorOffsetCollection';
    if (Array.isArray(value) && !takesArray && !expression.isExpression(value)) {
      throw new Error(`Unknown expression "${String(value[0])}"`);
    }
    compiled = expression.normalizePropertyExpression(value as any, reference as any);
  } catch (error) {
    warnInvalidValue(propertyName, value, error);
    return null;
  }
  const kind: string = compiled.kind;

  return {
    isZoomDependent: kind === 'camera' || kind === 'composite',
    isFeatureDependent: kind === 'source' || kind === 'composite',
    evaluate: (zoom, feature, availableImages) =>
      toPlainValue(
        compiled.evaluate(
          {zoom},
          toEvaluationFeature(feature) as any,
          undefined,
          undefined,
          availableImages
        )
      ),
    evaluateWithGlobals: (globals, feature) =>
      toPlainValue(compiled.evaluate(globals as any, toEvaluationFeature(feature) as any))
  };
}

/**
 * Returns a compiled `paint` or `layout` property of a style layer, or `null` when the layer
 * does not set it. Compilation is cached per style layer object and property; the cached entry is
 * reused only while the layer still holds the same value, so editing a property in place
 * recompiles it.
 */
export function getCompiledStyleProperty(
  styleLayer: StyleLayerLike,
  propertyName: string
): CompiledStyleProperty | null {
  let layerCache = compiledPropertyCache.get(styleLayer);
  if (!layerCache) {
    layerCache = new Map();
    compiledPropertyCache.set(styleLayer, layerCache);
  }

  let entry = layerCache.get(propertyName);
  const propertyType = entry?.propertyType ?? getStylePropertyType(propertyName);
  const value = styleLayer[propertyType]?.[propertyName];
  if (!entry || entry.value !== value) {
    entry = {
      propertyType,
      value,
      compiled: value === undefined ? null : compileStylePropertyValue(propertyName, value)
    };
    layerCache.set(propertyName, entry);
  }
  return entry.compiled;
}

/**
 * Compiles a style-spec filter into a feature predicate, cached per filter array. The cached
 * predicate is reused only while the array's contents are unchanged, so a filter edited in place
 * is recompiled. A filter the style spec rejects logs a warning once and matches no features.
 */
export function compileStyleFilter(filter: unknown): StyleFilter {
  const isCacheable = Boolean(filter) && typeof filter === 'object';
  const snapshot = isCacheable ? JSON.stringify(filter) : '';
  const cached = isCacheable ? compiledFilterCache.get(filter as object) : undefined;
  if (cached && cached.snapshot === snapshot) {
    return cached.compiled;
  }

  let compiled: StyleFilter;
  try {
    const filterFn = featureFilter(filter as any).filter;
    compiled = (globalProperties, feature) =>
      filterFn(globalProperties as any, toEvaluationFeature(feature) as any);
  } catch (error) {
    warnInvalidValue('filter', filter, error);
    compiled = () => false;
  }

  if (isCacheable) {
    compiledFilterCache.set(filter as object, {snapshot, compiled});
  }
  return compiled;
}

/** A style's `light`, evaluated at one zoom. Colors are `[r, g, b, a]`, RGB in 0-255. */
export type EvaluatedStyleLight = {
  anchor: unknown;
  position: unknown;
  color: unknown;
  intensity: unknown;
};

const LIGHT_PROPERTIES = ['anchor', 'position', 'color', 'intensity'] as const;

/** The compiled properties per `light` object, `null` where it does not set a valid value. */
const compiledLightCache = new WeakMap<
  object,
  Map<string, {evaluate: (globals: any) => any} | null>
>();

/**
 * Evaluates a style's `light` at a zoom, property by property. A property the style does not set,
 * or sets to a value the style spec rejects (logged once), takes the spec's default.
 */
export function evaluateStyleLight(light: unknown, zoom: number): EvaluatedStyleLight {
  const values = (light && typeof light === 'object' ? light : {}) as Record<string, unknown>;
  let compiled = compiledLightCache.get(values);
  if (!compiled) {
    compiled = new Map();
    for (const name of LIGHT_PROPERTIES) {
      let property: {evaluate: (globals: any) => any} | null = null;
      if (values[name] !== undefined) {
        try {
          property = expression.normalizePropertyExpression(
            values[name] as any,
            (Reference as any).light[name]
          ) as any;
        } catch (error) {
          warnInvalidValue(`light.${name}`, values[name], error);
        }
      }
      compiled.set(name, property);
    }
    compiledLightCache.set(values, compiled);
  }
  const evaluated = {} as EvaluatedStyleLight;
  for (const name of LIGHT_PROPERTIES) {
    const property = compiled.get(name);
    const value = property ? property.evaluate({zoom}) : (Reference as any).light[name].default;
    evaluated[name] = typeof value === 'string' && name === 'color' ? Color.parse(value) : value;
    evaluated[name] = toPlainValue(evaluated[name]);
  }
  return evaluated;
}
