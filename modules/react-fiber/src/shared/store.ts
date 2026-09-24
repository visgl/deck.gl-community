import type {Deck, LayersList} from '@deck.gl/core';
import type {MapboxOverlay} from '@deck.gl/mapbox';
import {createStore as createVanillaStore} from 'zustand/vanilla';
import type {StateCreator, StoreApi} from 'zustand/vanilla';

/**
 * Global state shape for deckgl-fiber internal state management
 *
 * Manages the deck.gl instance reference and layers passed via props.
 * Used internally by the reconciler to coordinate between React and deck.gl.
 */
export interface State {
  /**
   * Current deck.gl instance (Deck or MapboxOverlay)
   *
   * Null until the DeckGL component mounts and creates the instance.
   */
  deckgl: Deck | MapboxOverlay | null;

  /**
   * Updates the deck.gl instance reference
   *
   * Called during DeckGL component mount/update lifecycle.
   */
  setDeckgl: (instance: Deck | MapboxOverlay | null) => void;

  /**
   * Layers passed directly via the `layers` prop (internal use)
   *
   * Supports "mix-mode" where users can pass explicit `layers` prop
   * alongside JSX children. Private API - do not use directly.
   *
   * @internal
   */
  _passedLayers: LayersList;
}

/**
 * Zustand store API for deckgl-fiber global state
 *
 * Provides access to store methods like getState(), setState(), subscribe().
 */
export type Store = StoreApi<State>;

const createState: StateCreator<State> = set => ({
  // NOTE: we want to support a "mix-mode" of sorts where a user can pass an explicit `layers` prop alongside
  // traditional usage of creating layers as JSX children.
  _passedLayers: [],

  deckgl: null,

  setDeckgl: instance => {
    set({deckgl: instance});
  }
});

/**
 * Creates an isolated store for a reconciler root.
 *
 * Each root owns its deck.gl instance and the layers supplied through its
 * component props.
 */
export function createStore(): Store {
  return createVanillaStore<State>(createState);
}
