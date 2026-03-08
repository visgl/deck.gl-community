// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * layer-descriptors — JSON-serializable layer config ("noodle") path.
 *
 * Use this when you need configs that are safe to store or transmit without
 * runtime execution: LLM output to a server, low-code UI builders, UNDO
 * history, saved dashboards, etc.
 *
 * Workflow:
 *   1. `createDescriptor` — agent or UI produces a plain JSON object
 *   2. `validateDescriptor` — pre-flight check before rendering
 *   3. `hydrateDescriptor` — resolve dot-path accessors to runtime functions,
 *      then spread into a deck.gl layer constructor
 *
 * Example:
 *   const desc = createDescriptor('ScatterplotLayer', {
 *     data: cities,
 *     getPosition: 'coordinates',  // resolved to d => d.coordinates
 *     getFillColor: [255, 0, 128],
 *     getRadius: 'population',     // resolved to d => d.population
 *   });
 *   const {valid, errors} = validateDescriptor(desc);
 *   const layer = new ScatterplotLayer(hydrateDescriptor(desc));
 */

import type {LayerDescriptor, LayerType, ValidationResult} from './types';

// ---------------------------------------------------------------------------
// Required prop names per layer type — used by validateDescriptor
// ---------------------------------------------------------------------------

const REQUIRED_PROPS: Record<LayerType, string[]> = {
  ScatterplotLayer: ['data', 'getPosition'],
  PathLayer: ['data', 'getPath'],
  PolygonLayer: ['data', 'getPolygon'],
  TextLayer: ['data', 'getText', 'getPosition'],
  IconLayer: ['data', 'getPosition', 'getIcon'],
  HeatmapLayer: ['data', 'getPosition'],
  ArcLayer: ['data', 'getSourcePosition', 'getTargetPosition'],
  ColumnLayer: ['data', 'getPosition'],
  GeoJsonLayer: ['data']
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Construct a JSON-serializable LayerDescriptor.
 * Accessor props may be dot-path strings (`"meta.radius"`) or literal values.
 */
export function createDescriptor(
  type: LayerType,
  props: Record<string, unknown>,
  id?: string
): LayerDescriptor {
  return {type, id: id ?? type, props};
}

/**
 * Validate a descriptor before hydration.
 * Returns `{valid: true, errors: []}` on success.
 */
export function validateDescriptor(descriptor: LayerDescriptor): ValidationResult {
  const errors: string[] = [];
  const required = REQUIRED_PROPS[descriptor.type];

  if (!required) {
    errors.push(`Unknown layer type: "${descriptor.type}"`);
    return {valid: false, errors};
  }

  for (const prop of required) {
    if (!(prop in descriptor.props) || descriptor.props[prop] === undefined) {
      errors.push(`Missing required prop "${prop}" for ${descriptor.type}`);
    }
  }

  return {valid: errors.length === 0, errors};
}

/**
 * Hydrate a descriptor into runtime-ready layer props.
 *
 * Dot-path string accessors are converted to functions:
 *   `"meta.size"` => `(d) => d.meta.size`
 *   `"coordinates"` => `(d) => d.coordinates`
 *
 * Non-string values (numbers, arrays, existing functions) are passed through.
 */
export function hydrateDescriptor(descriptor: LayerDescriptor): Record<string, unknown> {
  const hydrated: Record<string, unknown> = {id: descriptor.id};

  for (const [key, value] of Object.entries(descriptor.props)) {
    if (typeof value === 'string' && isAccessorProp(key)) {
      hydrated[key] = makeDotPathAccessor(value);
    } else {
      hydrated[key] = value;
    }
  }

  return hydrated;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Props whose string values should be treated as dot-path accessors */
const ACCESSOR_PROP_PREFIXES = ['get', 'Get'];

function isAccessorProp(propName: string): boolean {
  return ACCESSOR_PROP_PREFIXES.some((prefix) => propName.startsWith(prefix));
}

function makeDotPathAccessor(dotPath: string): (d: unknown) => unknown {
  const parts = dotPath.split('.');
  return (d: unknown) => {
    let value: unknown = d;
    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = (value as Record<string, unknown>)[part];
    }
    return value;
  };
}
