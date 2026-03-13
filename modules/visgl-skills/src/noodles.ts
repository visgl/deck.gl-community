// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * # Noodles 🍜
 *
 * A **noodle** is a lightweight, JSON-serializable descriptor for a deck.gl
 * layer.  Noodles let AI agents (Claude Code, Openclaw, Copilot, etc.) produce
 * deck.gl layer configurations entirely as plain data – no executable code
 * required – which can then be hydrated into real deck.gl Layer instances by
 * the runtime.
 *
 * ## Motivation
 * AI coding agents work best with _data_, not callbacks.  By encoding a layer
 * as a noodle the agent can:
 *
 * 1. Describe the desired visualisation in a structured way.
 * 2. Store, compare, and diff layer configurations without running JavaScript.
 * 3. Hydrate the noodle into a real deck.gl layer only when needed.
 *
 * ## Field accessor encoding
 * Because noodles are JSON-serializable, accessor functions are encoded as
 * **field path strings** (e.g. `"coordinates"` reads `d.coordinates`,
 * `"meta.size"` reads `d.meta.size`).  Static values are encoded directly.
 *
 * @example
 * ```ts
 * import {createNoodle, hydrateNoodle} from '@deck.gl-community/visgl-skills';
 *
 * const noodle = createNoodle('ScatterplotLayer', {
 *   data: cities,
 *   position: 'coordinates',   // → d => d.coordinates
 *   fillColor: [255, 140, 0],  // static
 *   radius: 'population',      // → d => d.population
 *   radiusUnits: 'meters',
 *   radiusScale: 0.01,
 *   pickable: true,
 * });
 * ```
 */

import type {Color} from './types';

// ---------------------------------------------------------------------------
// Noodle types
// ---------------------------------------------------------------------------

/** Layer kinds supported by the noodle system. */
export type NoodleKind =
  | 'ScatterplotLayer'
  | 'PathLayer'
  | 'PolygonLayer'
  | 'TextLayer'
  | 'IconLayer'
  | 'HeatmapLayer';

/** An accessor encoded as either a field-path string or a static value. */
export type NoodleAccessor<T> = string | T;

/** Base fields common to every noodle. */
export type BaseNoodleProps = {
  /** Unique layer id. */
  id?: string;
  /** Layer opacity 0–1. */
  opacity?: number;
  /** Whether the layer is visible. */
  visible?: boolean;
  /** Whether to enable picking. */
  pickable?: boolean;
};

/** Noodle definition for ScatterplotLayer. */
export type ScatterplotNoodle = BaseNoodleProps & {
  type: 'ScatterplotLayer';
  data: unknown[];
  /** Field path or static position accessor. */
  position: NoodleAccessor<[number, number]>;
  fillColor?: NoodleAccessor<Color>;
  lineColor?: NoodleAccessor<Color>;
  radius?: NoodleAccessor<number>;
  radiusUnits?: 'meters' | 'pixels' | 'common';
  radiusScale?: number;
  radiusMinPixels?: number;
  radiusMaxPixels?: number;
  stroked?: boolean;
  filled?: boolean;
};

/** Noodle definition for PathLayer. */
export type PathNoodle = BaseNoodleProps & {
  type: 'PathLayer';
  data: unknown[];
  path: NoodleAccessor<[number, number][]>;
  color?: NoodleAccessor<Color>;
  width?: NoodleAccessor<number>;
  widthUnits?: 'meters' | 'pixels' | 'common';
  widthMinPixels?: number;
  capRounded?: boolean;
  jointRounded?: boolean;
};

/** Noodle definition for PolygonLayer. */
export type PolygonNoodle = BaseNoodleProps & {
  type: 'PolygonLayer';
  data: unknown[];
  polygon: NoodleAccessor<[number, number][]>;
  fillColor?: NoodleAccessor<Color>;
  lineColor?: NoodleAccessor<Color>;
  lineWidth?: NoodleAccessor<number>;
  elevation?: NoodleAccessor<number>;
  filled?: boolean;
  stroked?: boolean;
  extruded?: boolean;
};

/** Noodle definition for TextLayer. */
export type TextNoodle = BaseNoodleProps & {
  type: 'TextLayer';
  data: unknown[];
  position: NoodleAccessor<[number, number]>;
  text: NoodleAccessor<string>;
  color?: NoodleAccessor<Color>;
  size?: NoodleAccessor<number>;
  fontFamily?: string;
};

/** Noodle definition for HeatmapLayer. */
export type HeatmapNoodle = BaseNoodleProps & {
  type: 'HeatmapLayer';
  data: unknown[];
  position: NoodleAccessor<[number, number]>;
  weight?: NoodleAccessor<number>;
  intensity?: number;
  radiusPixels?: number;
  threshold?: number;
  aggregation?: 'SUM' | 'MEAN';
};

/** Union of all noodle types. */
export type Noodle = ScatterplotNoodle | PathNoodle | PolygonNoodle | TextNoodle | HeatmapNoodle;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Skill: create a typed noodle for a given layer kind.
 *
 * TypeScript will narrow the returned type to the correct noodle variant
 * based on the `kind` argument.
 *
 * @example
 * ```ts
 * const noodle = createNoodle('ScatterplotLayer', {
 *   data: airports,
 *   position: 'coordinates',
 *   radius: 'size',
 *   radiusUnits: 'pixels',
 * });
 * ```
 */
export function createNoodle(
  kind: 'ScatterplotLayer',
  props: Omit<ScatterplotNoodle, 'type'>
): ScatterplotNoodle;
export function createNoodle(kind: 'PathLayer', props: Omit<PathNoodle, 'type'>): PathNoodle;
export function createNoodle(
  kind: 'PolygonLayer',
  props: Omit<PolygonNoodle, 'type'>
): PolygonNoodle;
export function createNoodle(kind: 'TextLayer', props: Omit<TextNoodle, 'type'>): TextNoodle;
export function createNoodle(
  kind: 'HeatmapLayer',
  props: Omit<HeatmapNoodle, 'type'>
): HeatmapNoodle;
export function createNoodle(kind: NoodleKind, props: Record<string, unknown>): Noodle {
  return {type: kind, ...props} as Noodle;
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

/** Resolve a NoodleAccessor into a deck.gl accessor. */
function resolveAccessor<T>(
  accessor: NoodleAccessor<T> | undefined,
  defaultValue: T
): T | ((d: unknown) => T) {
  if (accessor === undefined) return defaultValue;
  if (typeof accessor === 'string') {
    // Field path accessor: supports dot notation (e.g. "meta.size")
    const path = (accessor as string).split('.');
    return (d: unknown) => {
      let value: unknown = d;
      for (const key of path) {
        if (value === null || value === undefined || typeof value !== 'object') return defaultValue;
        value = (value as Record<string, unknown>)[key];
      }
      return value as T;
    };
  }
  return accessor;
}

/**
 * Skill: hydrate a noodle into a plain layer-props object that can be
 * spread onto a deck.gl Layer constructor, or passed to a LayerDescriptor.
 *
 * Field-path accessors are converted into functions; static values are kept
 * as-is.
 *
 * @example
 * ```ts
 * import {ScatterplotLayer} from '@deck.gl/layers';
 *
 * const noodle = createNoodle('ScatterplotLayer', {data: cities, position: 'coord'});
 * const props = hydrateNoodle(noodle);
 * const layer = new ScatterplotLayer(props);
 * ```
 */
export function hydrateNoodle(noodle: Noodle): Record<string, unknown> {
  const {
    type,
    id,
    opacity = 1,
    visible = true,
    pickable = false,
    data
  } = noodle as Noodle & {
    data: unknown[];
  };

  const base: Record<string, unknown> = {
    id: id ?? `${type.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
    data,
    opacity,
    visible,
    pickable
  };

  return {...base, ...hydrateNoodleProps(noodle)};
}

function hydrateNoodleProps(noodle: Noodle): Record<string, unknown> {
  switch (noodle.type) {
    case 'ScatterplotLayer':
      return hydrateScatterplotNoodle(noodle);
    case 'PathLayer':
      return hydratePathNoodle(noodle);
    case 'PolygonLayer':
      return hydratePolygonNoodle(noodle);
    case 'TextLayer':
      return hydrateTextNoodle(noodle);
    case 'HeatmapLayer':
      return hydrateHeatmapNoodle(noodle);
    default:
      return {};
  }
}

function hydrateScatterplotNoodle(n: ScatterplotNoodle): Record<string, unknown> {
  return {
    getPosition: resolveAccessor(n.position, [0, 0]),
    getFillColor: resolveAccessor(n.fillColor, [255, 140, 0] as Color),
    getLineColor: resolveAccessor(n.lineColor, [255, 255, 255] as Color),
    getRadius: resolveAccessor(n.radius, 30),
    radiusUnits: n.radiusUnits ?? 'meters',
    radiusScale: n.radiusScale ?? 1,
    radiusMinPixels: n.radiusMinPixels ?? 0,
    radiusMaxPixels: n.radiusMaxPixels ?? Infinity,
    stroked: n.stroked ?? false,
    filled: n.filled ?? true
  };
}

function hydratePathNoodle(n: PathNoodle): Record<string, unknown> {
  return {
    getPath: resolveAccessor(n.path, []),
    getColor: resolveAccessor(n.color, [255, 255, 255] as Color),
    getWidth: resolveAccessor(n.width, 2),
    widthUnits: n.widthUnits ?? 'meters',
    widthMinPixels: n.widthMinPixels ?? 0,
    capRounded: n.capRounded ?? true,
    jointRounded: n.jointRounded ?? false
  };
}

function hydratePolygonNoodle(n: PolygonNoodle): Record<string, unknown> {
  return {
    getPolygon: resolveAccessor(n.polygon, []),
    getFillColor: resolveAccessor(n.fillColor, [80, 130, 200] as Color),
    getLineColor: resolveAccessor(n.lineColor, [255, 255, 255] as Color),
    getLineWidth: resolveAccessor(n.lineWidth, 1),
    getElevation: resolveAccessor(n.elevation, 0),
    filled: n.filled ?? true,
    stroked: n.stroked ?? false,
    extruded: n.extruded ?? false
  };
}

function hydrateTextNoodle(n: TextNoodle): Record<string, unknown> {
  return {
    getPosition: resolveAccessor(n.position, [0, 0]),
    getText: resolveAccessor(n.text, ''),
    getColor: resolveAccessor(n.color, [255, 255, 255] as Color),
    getSize: resolveAccessor(n.size, 12),
    fontFamily: n.fontFamily ?? 'Monaco, monospace'
  };
}

function hydrateHeatmapNoodle(n: HeatmapNoodle): Record<string, unknown> {
  return {
    getPosition: resolveAccessor(n.position, [0, 0]),
    getWeight: resolveAccessor(n.weight, 1),
    intensity: n.intensity ?? 1,
    radiusPixels: n.radiusPixels ?? 30,
    threshold: n.threshold ?? 0.03,
    aggregation: n.aggregation ?? 'SUM'
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validation result returned by {@link validateNoodle}. */
export type NoodleValidationResult = {
  valid: boolean;
  errors: string[];
};

/** Required position-like field names per layer type. */
const POSITION_REQUIRED_TYPES: NoodleKind[] = ['ScatterplotLayer', 'TextLayer', 'HeatmapLayer'];

/** Validate type-specific required fields and push errors into the array. */
function validateTypeFields(n: Record<string, unknown>, errors: string[]): void {
  const type = n.type as NoodleKind;
  if (POSITION_REQUIRED_TYPES.includes(type) && !n.position) {
    errors.push(`Field "position" is required for ${String(type)}.`);
  }
  if (type === 'PathLayer' && !n.path) {
    errors.push('Field "path" is required for PathLayer.');
  }
  if (type === 'PolygonLayer' && !n.polygon) {
    errors.push('Field "polygon" is required for PolygonLayer.');
  }
  if (type === 'TextLayer' && !n.text) {
    errors.push('Field "text" is required for TextLayer.');
  }
}

/**
 * Skill: validate a noodle descriptor and return a list of errors.
 *
 * Useful for catching mis-configurations before passing to deck.gl.
 *
 * @example
 * ```ts
 * const result = validateNoodle(noodle);
 * if (!result.valid) console.error(result.errors);
 * ```
 */
export function validateNoodle(noodle: unknown): NoodleValidationResult {
  const errors: string[] = [];

  if (typeof noodle !== 'object' || noodle === null) {
    return {valid: false, errors: ['Noodle must be a non-null object.']};
  }

  const n = noodle as Record<string, unknown>;

  const VALID_TYPES: NoodleKind[] = [
    'ScatterplotLayer',
    'PathLayer',
    'PolygonLayer',
    'TextLayer',
    'HeatmapLayer'
  ];

  if (!n.type) {
    errors.push('Missing required field: type.');
  } else if (!VALID_TYPES.includes(n.type as NoodleKind)) {
    errors.push(`Unknown noodle type "${String(n.type)}". Valid types: ${VALID_TYPES.join(', ')}.`);
  }

  if (!Array.isArray(n.data)) {
    errors.push('Field "data" must be an array.');
  }

  if (
    n.opacity !== undefined &&
    (typeof n.opacity !== 'number' || n.opacity < 0 || n.opacity > 1)
  ) {
    errors.push('Field "opacity" must be a number between 0 and 1.');
  }

  if (n.type) {
    validateTypeFields(n, errors);
  }

  return {valid: errors.length === 0, errors};
}
