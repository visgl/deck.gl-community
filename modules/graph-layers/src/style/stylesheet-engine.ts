// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {StyleProperty} from './style-property';
import {error} from '../utils/log';

export type DeckGLAccessorMap = Record<string, Record<string, string>>;
export type DeckGLUpdateTriggers = Record<string, string[]>;

export type StylePropertyConstructor<T extends StyleProperty = StyleProperty> = new (args: {
  key: string;
  value: unknown;
  updateTrigger: unknown;
}) => T;

export type DefaultStyleValueFn = (property: string) => unknown;

export type StylesheetEngineOptions<T extends StyleProperty = StyleProperty> = {
  deckglAccessorMap: DeckGLAccessorMap;
  deckglUpdateTriggers?: DeckGLUpdateTriggers;
  stateUpdateTrigger?: unknown;
  StylePropertyClass?: StylePropertyConstructor<T>;
  getDefaultStyleValue?: DefaultStyleValueFn;
};

const DEFAULT_UPDATE_TRIGGERS: DeckGLUpdateTriggers = {};

export class StylesheetEngine<TStyleProperty extends StyleProperty = StyleProperty> {
  type: string;
  properties: Record<string, TStyleProperty>;

  protected readonly deckglAccessorMap: DeckGLAccessorMap;
  protected readonly deckglUpdateTriggers: DeckGLUpdateTriggers;
  protected readonly stateUpdateTrigger: unknown;
  protected readonly StylePropertyClass: StylePropertyConstructor<TStyleProperty>;
  protected readonly getDefaultStyleValue: DefaultStyleValueFn;

  constructor(style: Record<string, any>, options: StylesheetEngineOptions<TStyleProperty>) {
    const {
      deckglAccessorMap,
      deckglUpdateTriggers = DEFAULT_UPDATE_TRIGGERS,
      stateUpdateTrigger = false,
      StylePropertyClass = StyleProperty as unknown as StylePropertyConstructor<TStyleProperty>,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      getDefaultStyleValue = StyleProperty.getDefault
    } = options;

    const {type: layerType, ...restStyle} = style;

    if (!layerType || !(layerType in deckglAccessorMap)) {
      throw new Error(`illegal type: ${layerType}`);
    }

    this.type = layerType;
    this.deckglAccessorMap = deckglAccessorMap;
    this.deckglUpdateTriggers = deckglUpdateTriggers;
    this.stateUpdateTrigger = stateUpdateTrigger;
    this.StylePropertyClass = StylePropertyClass;
    this.getDefaultStyleValue = getDefaultStyleValue;

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
      {default: {}} as Record<string, Record<string, unknown>>
    );

    const attributes = Object.values(rules).reduce<string[]>((res, rule) => {
      const attrs = Object.keys(rule || {});
      const set = new Set([...res, ...attrs]);
      return Array.from(set);
    }, []);

    const attrMap = attributes.reduce(
      (res, attr) => {
        res[attr] = Object.entries(rules).reduce(
          (acc, entry) => {
            const [state, rule] = entry;
            if (rule && typeof (rule as any)[attr] !== 'undefined') {
              (acc as any)[state] = (rule as any)[attr];
            }
            return acc;
          },
          {} as Record<string, unknown>
        );
        return res;
      },
      {} as Record<string, any>
    );

    const simplifiedStyleMap = Object.entries(attrMap).reduce(
      (res, entry) => {
        const [attr, valueMap] = entry as [string, Record<string, unknown>];
        const states = Object.keys(valueMap);
        const onlyDefault = states.length === 1 && valueMap.default !== undefined;
        if (onlyDefault) {
          res[attr] = valueMap.default;
          return res;
        }
        res[attr] = valueMap;
        return res;
      },
      {} as Record<string, unknown>
    );

    this.properties = {} as Record<string, TStyleProperty>;
    for (const key in simplifiedStyleMap) {
      this.properties[key] = new this.StylePropertyClass({
        key,
        value: simplifiedStyleMap[key],
        updateTrigger: this.stateUpdateTrigger
      });
    }
  }

  protected getDeckGLAccessorMapForType() {
    return this.deckglAccessorMap[this.type];
  }

  protected getDeckGLUpdateTriggersForType() {
    return this.deckglUpdateTriggers[this.type] || [];
  }

  protected _getProperty(deckglAccessor: string) {
    const map = this.getDeckGLAccessorMapForType();
    if (!map) {
      throw new Error(`illegal type: ${this.type}`);
    }
    const styleProp = map[deckglAccessor];
    if (!styleProp) {
      error(`Invalid DeckGL accessor: ${deckglAccessor}`);
      throw new Error(`Invalid DeckGL accessor: ${deckglAccessor}`);
    }
    return this.properties[styleProp];
  }

  getDeckGLAccessor(deckglAccessor: string) {
    const property = this._getProperty(deckglAccessor);
    if (property) {
      const value = property.getValue();
      return typeof value === 'function' ? value : () => value;
    }
    const styleProp = this.getDeckGLAccessorMapForType()?.[deckglAccessor];
    return this.getDefaultStyleValue(styleProp);
  }

  getDeckGLAccessorUpdateTrigger(deckglAccessor: string) {
    const property = this._getProperty(deckglAccessor);
    if (property) {
      return property.getUpdateTrigger();
    }
    return false;
  }

  getDeckGLAccessors() {
    const accessorMap = this.getDeckGLAccessorMapForType();
    return Object.keys(accessorMap).reduce(
      (res, accessor) => {
        res[accessor] = this.getDeckGLAccessor(accessor);
        return res;
      },
      {} as Record<string, (...args: any[]) => unknown>
    );
  }

  getDeckGLUpdateTriggers() {
    return this.getDeckGLUpdateTriggersForType().reduce(
      (res, accessor) => {
        res[accessor] = this.getDeckGLAccessorUpdateTrigger(accessor);
        return res;
      },
      {} as Record<string, unknown>
    );
  }
}
