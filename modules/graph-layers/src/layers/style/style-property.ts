import Color from 'color';
import {log} from '../../utils/log';

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

// code generation: generate a function as a layer accessor
function generateAccessor(key, value) {
  const formatter = PROPERTY_FORMATTERS[key] || IDENTITY;
  // ex: key = 'fill', value = {defaut: 'red', hover: 'blue'}
  // valueMap => {defaut: [255, 0, 0], hover: [0, 0, 255]}
  const valueMap = Object.keys(value).reduce((res, key0) => {
    res[key0] = value[key0];
    return res;
  }, {});

  return (node) => {
    const statefulValue = valueMap[node.state];
    if (!node.state || typeof statefulValue === 'undefined') {
      return valueMap.default || DEFAULT_STYLES[key];
    }
    // else has stateful value
    // check if the value is a function
    if (typeof statefulValue === 'function') {
      return formatter(statefulValue(node));
    }
    // or just a plain value
    return formatter(statefulValue);
  };
}

const VALUE_TYPE = {
  ACCESSOR: 'ACCESSOR',
  PLAIN_VALUE: 'PLAIN_VALUE'
};

export class StyleProperty {
  // for getting default style
  static getDefault(key) {
    return DEFAULT_STYLES[key];
  }

  // pass the key and value of the property
  // and format the value properly.
  constructor({key, value, updateTrigger}) {
    this.key = key;
    this._updateTrigger = false;

    // statefule property, ex:
    // fill: {default: 'red', hover: 'blue'}
    // note that offset: [0, 1], the type of array is object, too.
    if (typeof value === 'object' && !Array.isArray(value)) {
      // generate accessor function
      this._value = generateAccessor(key, value);
      this._valueType = VALUE_TYPE.ACCESSOR;
      this._updateTrigger = updateTrigger;
    }
    // default state property, but value = accessor
    // fill: () => 'red'
    else if (typeof value === 'function') {
      const formatter = PROPERTY_FORMATTERS[key] || IDENTITY;
      // the output of the function should be formated by
      // the corresponding formatter again.
      // Ex: colorAccessor might return '#f00', which needs to
      // be formated as [255, 0, 0];
      this._value = (d) => formatter(value(d));
      this._valueType = VALUE_TYPE.ACCESSOR;
      this._updateTrigger = value;
    }
    // default state property with plain value:
    // fill: 'red'
    else {
      // format the value properly
      const formatter = PROPERTY_FORMATTERS[key] || IDENTITY;
      this._value = formatter(value);
      this._valueType = VALUE_TYPE.PLAIN_VALUE;
      this._updateTrigger = false;
    }

    // sanity check
    if (this._value === null) {
      log.warn(`Invalid ${key} value: ${value}`)();
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
