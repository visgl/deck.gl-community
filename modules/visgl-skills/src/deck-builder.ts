// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * # DeckBuilder
 *
 * A fluent builder that composes a full deck.gl Deck configuration from layer
 * descriptors.  Designed for easy use by AI coding agents that need to
 * assemble visualisations programmatically.
 *
 * @example
 * ```ts
 * import {DeckBuilder, createScatterplotLayer} from '@deck.gl-community/visgl-skills';
 *
 * const config = new DeckBuilder()
 *   .setViewState({longitude: -122.4, latitude: 37.8, zoom: 11})
 *   .addLayer(createScatterplotLayer({ data: cities, getPosition: d => d.coord }))
 *   .setContainer('map')
 *   .build();
 * ```
 */

import type {LayerDescriptor, ViewState} from './types';

/** Options produced by {@link DeckBuilder.build}. */
export type DeckConfig = {
  /** Unique id for the Deck instance. */
  id?: string;
  /** The DOM element or element id to mount the canvas into. */
  container?: string | HTMLElement;
  /** Initial view state. */
  initialViewState: ViewState;
  /** Controller configuration. `true` enables the default map controller. */
  controller: boolean | Record<string, unknown>;
  /** Ordered array of layer descriptors. */
  layers: LayerDescriptor[];
  /** Canvas width. `'100%'` fills the container. */
  width: string | number;
  /** Canvas height. `'100%'` fills the container. */
  height: string | number;
};

/**
 * Fluent builder for assembling a deck.gl configuration object.
 *
 * All methods return `this` so that calls can be chained.
 */
export class DeckBuilder {
  private _id?: string;
  private _container?: string | HTMLElement;
  private _viewState: ViewState = {longitude: 0, latitude: 0, zoom: 1};
  private _controller: boolean | Record<string, unknown> = true;
  private _layers: LayerDescriptor[] = [];
  private _width: string | number = '100%';
  private _height: string | number = '100%';

  /** Set the deck instance identifier. */
  setId(id: string): this {
    this._id = id;
    return this;
  }

  /** Set the DOM container (id string or HTMLElement). */
  setContainer(container: string | HTMLElement): this {
    this._container = container;
    return this;
  }

  /** Set the initial map view state. */
  setViewState(viewState: ViewState): this {
    this._viewState = viewState;
    return this;
  }

  /** Configure the map controller (pass `false` to disable). */
  setController(controller: boolean | Record<string, unknown>): this {
    this._controller = controller;
    return this;
  }

  /** Set the canvas dimensions. Defaults to '100%'. */
  setSize(width: string | number, height: string | number): this {
    this._width = width;
    this._height = height;
    return this;
  }

  /** Append a layer descriptor. Layers are rendered in insertion order. */
  addLayer(layer: LayerDescriptor): this {
    this._layers = [...this._layers, layer];
    return this;
  }

  /** Prepend a layer descriptor (rendered below existing layers). */
  prependLayer(layer: LayerDescriptor): this {
    this._layers = [layer, ...this._layers];
    return this;
  }

  /** Remove a layer by its id. */
  removeLayer(id: string): this {
    this._layers = this._layers.filter((l) => l.id !== id);
    return this;
  }

  /** Replace an existing layer (matched by id) with a new descriptor. */
  replaceLayer(layer: LayerDescriptor): this {
    this._layers = this._layers.map((l) => (l.id === layer.id ? layer : l));
    return this;
  }

  /** Produce the final DeckConfig object. */
  build(): DeckConfig {
    const config: DeckConfig = {
      initialViewState: {...this._viewState},
      controller: this._controller,
      layers: [...this._layers],
      width: this._width,
      height: this._height
    };
    if (this._id !== undefined) config.id = this._id;
    if (this._container !== undefined) config.container = this._container;
    return config;
  }

  /** Return the current list of layer descriptors (non-mutating). */
  getLayers(): LayerDescriptor[] {
    return [...this._layers];
  }

  /** Return the current view state (non-mutating). */
  getViewState(): ViewState {
    return {...this._viewState};
  }
}
