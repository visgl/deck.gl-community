// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * DeckBuilder — fluent builder that composes layer descriptors and view state
 * into a single serializable DeckConfig.
 *
 * Works with both the native-code path (wrap factory output in createDescriptor)
 * and the JSON descriptor path directly.
 *
 * Example:
 *   import {DeckBuilder, createDescriptor, fitViewport} from '@deck.gl-community/ai-skills';
 *
 *   const config = new DeckBuilder()
 *     .addLayer(createDescriptor('ScatterplotLayer', {data: cities, getPosition: 'coordinates'}))
 *     .setViewState(fitViewport(cities.map(c => c.coordinates)))
 *     .setMapStyle('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json')
 *     .build();
 */

import type {DeckConfig, LayerDescriptor, ViewState} from './types';

export class DeckBuilder {
  private _layers: LayerDescriptor[] = [];
  private _viewState: ViewState = {longitude: 0, latitude: 0, zoom: 2};
  private _mapStyle?: string;

  addLayer(descriptor: LayerDescriptor): this {
    this._layers.push(descriptor);
    return this;
  }

  setViewState(viewState: ViewState): this {
    this._viewState = viewState;
    return this;
  }

  setMapStyle(mapStyle: string): this {
    this._mapStyle = mapStyle;
    return this;
  }

  build(): DeckConfig {
    return {
      layers: [...this._layers],
      viewState: {...this._viewState},
      ...(this._mapStyle ? {mapStyle: this._mapStyle} : {})
    };
  }
}
