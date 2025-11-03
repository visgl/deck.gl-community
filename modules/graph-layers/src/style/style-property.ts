// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import Color from 'color';
import {
  scaleLinear,
  scaleLog,
  scaleOrdinal,
  scalePow,
  scaleQuantile,
  scaleQuantize,
  scaleSqrt
} from 'd3-scale';

import {log} from '../utils/log';
import type {
  GraphStyleAttributeReference,
  GraphStyleLeafValue,
  GraphStyleScale,
  GraphStyleScaleType
} from './graph-style-engine';

/* Utils for type check */
function getColor(value) {
  if (typeof value === 'string') {
    try {
      const color = Color.rgb(value).array();
      if (Number.isFinite(color[3])) {
        color[3] *= 255;
      }
      return color;
    } catch (error) {
      return [0, 0, 0];
    }
  }
  if (Array.isArray(value) && Number.isFinite(value[0])) {
    return value;
  }
  return [0, 0, 0];
}

function getNumber(value) {
  switch (typeof value) {
    case 'string':
      value = Number(value);
      return isNaN(value) ? null : value;

    case 'number':
      return value;

    default:
      return null;
  }
}

function getBool(value) {
  switch (typeof value) {
    case 'boolean':
      return value;

    case 'string':
      return value.toLowerCase() !== 'false';

    case 'number':
      return Boolean(value);

    default:
      return null;
  }
}

function getOffset(value) {
  if (typeof value === 'function') {
    return value;
  }

  if (!Array.isArray(value) || value.length !== 2) {
    return null;
  }
  return value.map(getNumber);
}

const IDENTITY = (x) => x;
const PROPERTY_FORMATTERS = {
  opacity: getNumber,
  zIndex: getNumber,

  width: getNumber,
  height: getNumber,
  radius: getNumber,

  fill: getColor,
  stroke: getColor,
  strokeWidth: getNumber,

  // for marker
  marker: String,
  size: getNumber,

  // text
  color: getColor,
  text: String,
  fontSize: getNumber,
  textAnchor: String,
  alignmentBaseline: String,
  angle: getNumber,
  textMaxWidth: getNumber,
  textWordBreak: String,
  textSizeMinPixels: getNumber,

  // edges
  speed: getNumber,
  tailLength: getNumber,

  offset: getOffset,
  scaleWithZoom: getBool
};

const DEFAULT_STYLES = {
  opacity: 1,
  zIndex: 0,

  width: 0,
  height: 0,
  radius: 1,

  fill: [0, 0, 0],
  stroke: [0, 0, 0],
  strokeWidth: 0,

  marker: 'circle',
  size: 12,

  color: [0, 0, 0],
  text: '',
  fontSize: 12,
  textAnchor: 'middle',
  alignmentBaseline: 'center',
  angle: 0,
  textMaxWidth: -1,
  textWordBreak: 'break-all',
  textSizeMinPixels: 9,

  speed: 0,
  tailLength: 1,

  offset: null,
  scaleWithZoom: true
};

/** Union of supported D3 scale implementations. */
type SupportedScale =
  | ReturnType<typeof scaleLinear>
  | ReturnType<typeof scaleLog>
  | ReturnType<typeof scalePow>
   
  | ReturnType<typeof scaleQuantize>
  | ReturnType<typeof scaleQuantile>
  | ReturnType<typeof scaleOrdinal>;

const SCALE_FACTORIES: Record<GraphStyleScaleType, () => SupportedScale> = {
  linear: () => scaleLinear(),
  log: () => scaleLog(),
  pow: () => scalePow(),
  sqrt: () => scaleSqrt(),
  quantize: () => scaleQuantize(),
  quantile: () => scaleQuantile(),
  ordinal: () => scaleOrdinal()
};

/** Resolved attribute reference with guaranteed defaults. */
type NormalizedAttributeReference = {
  attribute: string;
  fallback: unknown;
  scale?: (value: unknown) => unknown;
  scaleConfig?: GraphStyleScale | ((value: unknown) => unknown);
};

/** Create a D3 scale instance based on a declarative configuration. */
/* eslint-disable-next-line complexity */
function createScaleFromConfig(config: GraphStyleScale): SupportedScale {
  const type = config.type ?? 'linear';
  const factory = SCALE_FACTORIES[type];
  if (!factory) {
    log.warn(`Invalid scale type: ${type}`);
    throw new Error(`Invalid scale type: ${type}`);
  }
  const scale = (factory as () => SupportedScale)();
  const anyScale = scale as any;
  if (config.domain && 'domain' in scale) {
    anyScale.domain(config.domain as never);
  }
  if (config.range && 'range' in scale) {
    anyScale.range(config.range as never);
  }
  if (typeof config.clamp === 'boolean' && 'clamp' in scale && typeof anyScale.clamp === 'function') {
    anyScale.clamp(config.clamp);
  }
  if (typeof config.nice !== 'undefined' && 'nice' in scale && typeof anyScale.nice === 'function') {
    anyScale.nice(config.nice as never);
  }
  if (
    type === 'pow' &&
    typeof config.exponent === 'number' &&
    'exponent' in scale &&
    typeof anyScale.exponent === 'function'
  ) {
    anyScale.exponent(config.exponent);
  }
  if (
    type === 'log' &&
    typeof config.base === 'number' &&
    'base' in scale &&
    typeof anyScale.base === 'function'
  ) {
    anyScale.base(config.base);
  }
  if (
    typeof config.unknown !== 'undefined' &&
    'unknown' in scale &&
    typeof (scale as {unknown?: (value: unknown) => unknown}).unknown === 'function'
  ) {
    (scale as {unknown: (value: unknown) => unknown}).unknown(config.unknown);
  }
  return scale;
}

/** Normalize attribute reference definitions into a consistent structure. */
function normalizeAttributeReference(
  key: string,
  reference: GraphStyleAttributeReference
): NormalizedAttributeReference {
  if (typeof reference === 'string') {
    const attribute = reference.startsWith('@') ? reference.slice(1) : reference;
    if (!attribute) {
      throw new Error(`Invalid attribute reference for ${key}: ${reference}`);
    }
    return {
      attribute,
      fallback: DEFAULT_STYLES[key]
    };
  }

  const {attribute, fallback = DEFAULT_STYLES[key], scale} = reference;
  if (!attribute) {
    throw new Error(`Invalid attribute reference for ${key}: ${JSON.stringify(reference)}`);
  }

  let scaleFn: ((value: unknown) => unknown) | undefined;
  let scaleConfig: GraphStyleScale | ((value: unknown) => unknown) | undefined;

  if (scale) {
    if (typeof scale === 'function') {
      scaleFn = scale;
      scaleConfig = scale;
    } else {
      scaleFn = createScaleFromConfig(scale);
      scaleConfig = scale;
    }
  }

  return {
    attribute,
    fallback,
    scale: scaleFn,
    scaleConfig
  };
}

/** Determine whether a value points to a graph attribute reference. */
function isAttributeReference(value: unknown): value is GraphStyleAttributeReference {
  if (typeof value === 'string') {
    return value.startsWith('@');
  }
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && 'attribute' in (value as Record<string, unknown>);
}

/** Determine whether a style value maps interaction states. */
function isStatefulValue(value: unknown): value is Record<string, GraphStyleLeafValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !isAttributeReference(value);
}

/** Resolve an attribute from a datum or `Graph` entity. */
function getAttributeValue(datum: any, attribute: string) {
  if (datum && typeof datum.getPropertyValue === 'function') {
    return datum.getPropertyValue(attribute);
  }
  if (datum && typeof datum === 'object' && attribute in datum) {
    return datum[attribute];
  }
  return undefined;
}

/** Combine Deck.gl update triggers while filtering falsey entries. */
function mergeUpdateTriggers(...triggers: unknown[]): unknown {
  const filtered = triggers.filter(
    (trigger) => !(trigger === false || trigger === undefined || trigger === null)
  );
  if (!filtered.length) {
    return false;
  }
  if (filtered.length === 1) {
    return filtered[0];
  }
  return filtered;
}

/** Build an accessor that reads and optionally scales an attribute. */
function createAttributeAccessor(
  key: string,
  attributeRef: NormalizedAttributeReference,
  formatter: (value: unknown) => unknown
) {
  const accessor = (datum: any) => {
    let raw = getAttributeValue(datum, attributeRef.attribute);
    if (raw === undefined || raw === null) {
      raw = attributeRef.fallback;
    }
    if (attributeRef.scale) {
      raw = attributeRef.scale(raw);
    }
    const formatted = formatter(raw);
    if (formatted === null) {
      log.warn(`Invalid ${key} value: ${raw}`);
      throw new Error(`Invalid ${key} value: ${raw}`);
    }
    return formatted;
  };

  const updateTrigger = {
    attribute: attributeRef.attribute,
    scale: attributeRef.scaleConfig ?? null
  };

  return {accessor, updateTrigger};
}

/** Result of parsing a leaf style value. */
type LeafParseResult = {
  value: any;
  isAccessor: boolean;
  updateTrigger: unknown;
};

/** Parse a non-stateful style value into deck.gl compatible form. */
function parseLeafValue(key: string, value: GraphStyleLeafValue | undefined): LeafParseResult {
  const formatter = PROPERTY_FORMATTERS[key] || IDENTITY;

  if (typeof value === 'undefined') {
    const formatted = formatter(DEFAULT_STYLES[key]);
    if (formatted === null) {
      log.warn(`Invalid ${key} value: ${value}`);
      throw new Error(`Invalid ${key} value: ${value}`);
    }
    return {value: formatted, isAccessor: false, updateTrigger: false};
  }

  if (isAttributeReference(value)) {
    const normalized = normalizeAttributeReference(key, value);
    const {accessor, updateTrigger} = createAttributeAccessor(key, normalized, formatter);
    return {value: accessor, isAccessor: true, updateTrigger};
  }

  if (typeof value === 'function') {
    return {
      value: (datum) => formatter(value(datum)),
      isAccessor: true,
      updateTrigger: value
    };
  }

  const formatted = formatter(value);
  if (formatted === null) {
    log.warn(`Invalid ${key} value: ${value}`);
    throw new Error(`Invalid ${key} value: ${value}`);
  }

  return {value: formatted, isAccessor: false, updateTrigger: false};
}

/**
 * Create an accessor capable of handling interaction state overrides for a style property.
 */
function createStatefulAccessor(
  key: string,
  value: Record<string, GraphStyleLeafValue>,
  stateUpdateTrigger: unknown
) {
  const valueMap: Record<string, any> = {};
  const attributeTriggers: unknown[] = [];

  for (const state of Object.keys(value)) {
    const parsed = parseLeafValue(key, value[state]);
    valueMap[state] = parsed.value;
    if (parsed.updateTrigger) {
      attributeTriggers.push(parsed.updateTrigger);
    }
  }

  const defaultValue =
    typeof valueMap.default !== 'undefined' ? valueMap.default : parseLeafValue(key, undefined).value;

  const accessor = (datum: any) => {
    const stateValue = datum?.state ? valueMap[datum.state] : undefined;
    const candidate = typeof stateValue !== 'undefined' ? stateValue : defaultValue;
    return typeof candidate === 'function' ? candidate(datum) : candidate;
  };

  const updateTrigger = mergeUpdateTriggers(stateUpdateTrigger, ...attributeTriggers);

  return {accessor, updateTrigger};
}

const VALUE_TYPE = {
  ACCESSOR: 'ACCESSOR',
  PLAIN_VALUE: 'PLAIN_VALUE'
};

export class StyleProperty {
  key: any;
  _updateTrigger: unknown;
  _value: any;
  _valueType: any;

  // for getting default style
  static getDefault(key) {
    return DEFAULT_STYLES[key];
  }

  // pass the key and value of the property
  // and format the value properly.
  constructor({key, value, updateTrigger}) {
    this.key = key;
    this._updateTrigger = false;

    if (isStatefulValue(value)) {
      const {accessor, updateTrigger: triggers} = createStatefulAccessor(
        key,
        value,
        updateTrigger
      );
      this._value = accessor;
      this._valueType = VALUE_TYPE.ACCESSOR;
      this._updateTrigger = triggers;
    } else {
      const parsed = parseLeafValue(key, value as GraphStyleLeafValue | undefined);
      this._value = parsed.value;
      this._valueType = parsed.isAccessor ? VALUE_TYPE.ACCESSOR : VALUE_TYPE.PLAIN_VALUE;
      this._updateTrigger = mergeUpdateTriggers(parsed.updateTrigger);
    }

    if (this._value === null) {
      log.warn(`Invalid ${key} value: ${value}`);
      throw new Error(`Invalid ${key} value: ${value}`);
    }
  }

  // get the formatted value
  getValue() {
    return this._value;
  }

  getUpdateTrigger() {
    return this._updateTrigger;
  }
}
