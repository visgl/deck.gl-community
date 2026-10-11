// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
import * as deck from '@deck.gl/core';
import * as layers from '@deck.gl/layers';
import * as luma from '@luma.gl/engine';
import * as vega from 'vega';

export type VegaBase = typeof vega;
export type DeckBase = typeof deck;
export type DeckLayerBase = typeof layers;
export type LumaBase = typeof luma;

/** Dependencies are loaded as ES modules; callers can supply a compatible Vega runtime. */
export const base = {deck, layers, luma, vega};
export type Base = typeof base;
export function use(vegaRuntime: VegaBase) {
  base.vega = vegaRuntime;
}
