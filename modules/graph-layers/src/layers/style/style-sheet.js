import StyleProperty from './style-property';

import {NODE_TYPE, EDGE_DECORATOR_TYPE} from '../../index';
import {log} from '../../utils/log';

const COMMON_DECKGL_PROPS = {
  getOffset: 'offset',
  opacity: 'opacity'
};

const DECKGL_ACCESSOR_MAP = {
  [NODE_TYPE.CIRCLE]: {
    ...COMMON_DECKGL_PROPS,
    getFillColor: 'fill',
    getLineColor: 'stroke',
    getLineWidth: 'strokeWidth',
    getRadius: 'radius'
  },

  [NODE_TYPE.RECTANGLE]: {
    ...COMMON_DECKGL_PROPS,
    getWidth: 'width',
    getHeight: 'height',
    getFillColor: 'fill',
    getLineColor: 'stroke',
    getLineWidth: 'strokeWidth'
  },

  [NODE_TYPE.ROUNDED_RECTANGLE]: {
    ...COMMON_DECKGL_PROPS,
    getCornerRadius: 'cornerRadius',
    getRadius: 'radius',
    getWidth: 'width',
    getHeight: 'height',
    getFillColor: 'fill',
    getLineColor: 'stroke',
    getLineWidth: 'strokeWidth'
  },

  [NODE_TYPE.PATH_ROUNDED_RECTANGLE]: {
    ...COMMON_DECKGL_PROPS,
    getWidth: 'width',
    getHeight: 'height',
    getFillColor: 'fill',
    getLineColor: 'stroke',
    getLineWidth: 'strokeWidth',
    getCornerRadius: 'cornerRadius'
  },

  [NODE_TYPE.LABEL]: {
    ...COMMON_DECKGL_PROPS,
    getColor: 'color',
    getText: 'text',
    getSize: 'fontSize',
    getTextAnchor: 'textAnchor',
    getAlignmentBaseline: 'alignmentBaseline',
    getAngle: 'angle',
    scaleWithZoom: 'scaleWithZoom',
    textMaxWidth: 'textMaxWidth',
    textWordBreak: 'textWordBreak',
    textSizeMinPixels: 'textSizeMinPixels'
  },

  [NODE_TYPE.MARKER]: {
    ...COMMON_DECKGL_PROPS,
    getColor: 'fill',
    getSize: 'size',
    getMarker: 'marker',
    scaleWithZoom: 'scaleWithZoom'
  },

  // --------- Edge related ---------
  Edge: {
    getColor: 'stroke',
    getWidth: 'strokeWidth'
  },
  [EDGE_DECORATOR_TYPE.LABEL]: {
    getColor: 'color',
    getText: 'text',
    getSize: 'fontSize',
    getTextAnchor: 'textAnchor',
    getAlignmentBaseline: 'alignmentBaseline',
    scaleWithZoom: 'scaleWithZoom',
    textMaxWidth: 'textMaxWidth',
    textWordBreak: 'textWordBreak',
    textSizeMinPixels: 'textSizeMinPixels'
  },
  [EDGE_DECORATOR_TYPE.FLOW]: {
    getColor: 'color',
    getWidth: 'width',
    getSpeed: 'speed',
    getTailLength: 'tailLength'
  }
};

const DECKGL_UPDATE_TRIGGERS = {
  [NODE_TYPE.CIRCLE]: ['getFillColor', 'getRadius', 'getLineColor', 'getLineWidth'],
  [NODE_TYPE.RECTANGLE]: ['getFillColor', 'getLineColor', 'getLineWidth'],
  [NODE_TYPE.ROUNDED_RECTANGLE]: [
    'getFillColor',
    'getLineColor',
    'getLineWidth',
    'getCornerRadius'
  ],
  [NODE_TYPE.PATH_ROUNDED_RECTANGLE]: [
    'getFillColor',
    'getLineColor',
    'getLineWidth',
    'getCornerRadius'
  ],
  [NODE_TYPE.LABEL]: [
    'getColor',
    'getText',
    'getSize',
    'getTextAnchor',
    'getAlignmentBaseline',
    'getAngle'
  ],
  [NODE_TYPE.MARKER]: ['getColor', 'getSize', 'getMarker'],
  Edge: ['getColor', 'getWidth'],
  [EDGE_DECORATOR_TYPE.LABEL]: [
    'getColor',
    'getText',
    'getSize',
    'getTextAnchor',
    'getAlignmentBaseline'
  ],
  [EDGE_DECORATOR_TYPE.FLOW]: ['getColor', 'getWidth', 'getSpeed', 'getTailLength']
};

export default class Stylesheet {
  constructor(style, updateTriggers) {
    const {type: layerType, ...restStyle} = style;
    if (!layerType || !(layerType in DECKGL_ACCESSOR_MAP)) {
      throw new Error(`illegal type: ${layerType}`);
    }
    this.type = layerType;

    // style = {
    //  type: 'circle',
    //  fill: 'red'
    //  radius: 5,
    //
    //  ':hover': {
    //    fill: 'blue',
    //    stroke: 'red'
    //  }
    // };
    // step 1: extract 'rules': default, hover
    // default: {fill: 'red', radius: 5};
    // hover: {fill: 'blue', stroke: 'red'};
    const rules = Object.keys(restStyle).reduce(
      (res, key) => {
        const isSelector = key.startsWith(':');
        if (isSelector) {
          const state = key.substring(1);
          res[state] = restStyle[key];
          return res;
        }
        res.default[key] = restStyle[key];
        return res;
      },
      {
        default: {}
      }
    );

    // step 2: extract all unique attributes from rules
    // attributes: ['fill', 'radius', 'stroke']
    const attributes = Object.values(rules).reduce((res, rule) => {
      const attrs = Object.keys(rule);
      const set = new Set([...res, ...attrs]);
      return Array.from(set);
    }, []);
    // step 3: create a attribute map as:
    // attrMap = {
    //  fill: {default: 'red', hover: 'blue'},
    //  radius: {default: 5},
    //  stroke: {hover: 'red'},
    // }
    const attrMap = attributes.reduce((res, attr) => {
      res[attr] = Object.entries(rules).reduce((acc, entry) => {
        const [state, rule] = entry;
        if (typeof rule[attr] !== 'undefined') {
          acc[state] = rule[attr];
        }
        return acc;
      }, {});
      return res;
    }, {});

    // step 4: simplify the attribute map if only default exists for the attribute
    // simplifiedStyleMap = {
    //  fill: {default: 'red', hover: 'blue'},
    //  radius: 5,
    //  stroke: {hover: 'red'},
    // }
    const simplifiedStyleMap = Object.entries(attrMap).reduce((res, entry) => {
      const [attr, valueMap] = entry;
      const onlyDefault = Object.keys(valueMap).length === 1 && valueMap.default !== undefined;
      if (onlyDefault) {
        res[attr] = valueMap.default;
        return res;
      }
      res[attr] = valueMap;
      return res;
    }, {});

    // step 5: create style property
    // if the propety only maps to default state => return value only
    // if the property maps to other states => return accessor function

    // start to parse properties
    this.properties = {};
    for (const key in simplifiedStyleMap) {
      this.properties[key] = new StyleProperty({
        key,
        value: simplifiedStyleMap[key],
        updateTrigger: updateTriggers.stateUpdateTrigger
      });
    }
  }

  _getProperty(deckglAccessor) {
    const map = DECKGL_ACCESSOR_MAP[this.type];
    if (!map) {
      throw new Error(`illegal type: ${this.type}`);
    }
    const styleProp = map[deckglAccessor];
    if (!styleProp) {
      log.error(`Invalid DeckGL accessor: ${deckglAccessor}`)();
      throw new Error(`Invalid DeckGL accessor: ${deckglAccessor}`);
    }
    return this.properties[styleProp];
  }

  getDeckGLAccessor(deckglAccessor) {
    const property = this._getProperty(deckglAccessor);
    // get the value
    if (property) {
      return property.getValue();
    }
    // return default value
    const styleProp = DECKGL_ACCESSOR_MAP[this.type][deckglAccessor];
    return StyleProperty.getDefault(styleProp);
  }

  getDeckGLAccessorUpdateTrigger(deckglAccessor) {
    const property = this._getProperty(deckglAccessor);
    // get the value
    if (property) {
      return property.getUpdateTrigger();
    }
    return false;
  }

  getDeckGLAccessors() {
    const accessorMap = DECKGL_ACCESSOR_MAP[this.type];
    return Object.keys(accessorMap).reduce((res, accessor) => {
      res[accessor] = this.getDeckGLAccessor(accessor);
      return res;
    }, {});
  }

  getDeckGLUpdateTriggers() {
    return DECKGL_UPDATE_TRIGGERS[this.type].reduce((res, accessor) => {
      res[accessor] = this.getDeckGLAccessorUpdateTrigger(accessor);
      return res;
    }, {});
  }
}
