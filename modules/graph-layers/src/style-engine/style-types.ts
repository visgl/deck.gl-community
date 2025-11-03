// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export type GraphStyleScaleType =
  | 'linear'
  | 'log'
  | 'pow'
  | 'sqrt'
  | 'quantize'
  | 'quantile'
  | 'ordinal';

export type GraphStyleScale = {
  type?: GraphStyleScaleType;
  domain?: Array<number | string>;
  range?: any[];
  clamp?: boolean;
  nice?: boolean | number;
  base?: number;
  exponent?: number;
  unknown?: unknown;
};

export type GraphStylePrimitive =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>;

export type GraphStyleAttributeReference<TValue = unknown> =
  | string
  | {
      attribute: string;
      fallback?: TValue;
      scale?: GraphStyleScale | ((value: unknown) => unknown);
    };

export type GraphStyleLeafValue<TValue = unknown> =
  | GraphStylePrimitive
  | GraphStyleAttributeReference<TValue>
  | ((datum: unknown) => TValue);

export type GraphStyleValue<TValue = unknown> =
  | GraphStyleLeafValue<TValue>
  | Record<string, GraphStyleLeafValue<TValue>>;
