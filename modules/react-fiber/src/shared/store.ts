import type {Deck, LayersList} from '@deck.gl/core';
import type {MapboxOverlay} from '@deck.gl/mapbox';
import {create} from 'zustand';
import type {StoreApi} from 'zustand';

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
   * Null until the Deckgl component mounts and creates the instance.
   */
  deckgl: Deck | MapboxOverlay | null;

  /**
   * Updates the deck.gl instance reference
   *
   * Called during Deckgl component mount/update lifecycle.
   */
  setDeckgl: (instance: Deck | MapboxOverlay) => void;

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

/**
 * Zustand hook for accessing deckgl-fiber global state
 *
 * Used internally by the reconciler. External consumers should use
 * the selectors object for optimized state access.
 *
 * @example
 * ```typescript
 * import { useStore, selectors } from '@deck.gl-community/react-fiber/shared';
 *
 * // Optimized selector usage (recommended)
 * const deckgl = useStore(selectors.deckgl);
 *
 * // Direct state access (causes re-render on any state change)
 * const state = useStore();
 * ```
 */
export const useStore = create<State>()(set => ({
  // NOTE: we want to support a "mix-mode" of sorts where a user can pass an explicit `layers` prop alongside
  // traditional usage of creating layers as JSX children.
  _passedLayers: [],

  deckgl: null,

  setDeckgl: instance => {
    set({deckgl: instance});
  }
}));

/**
 * Optimized selectors for deckgl-fiber state access
 *
 * Use these with useStore() to prevent unnecessary re-renders. Each
 * selector only triggers re-renders when its specific slice of state changes.
 *
 * @example
 * ```typescript
 * import { useStore, selectors } from '@deck.gl-community/react-fiber/shared';
 *
 * function MyComponent() {
 *   const deckgl = useStore(selectors.deckgl);
 *   const setDeckgl = useStore(selectors.setDeckgl);
 *
 *   // Component only re-renders when deckgl instance changes
 * }
 * ```
 */
export const selectors = {
  deckgl: (s: State): Deck | MapboxOverlay | null => s.deckgl,
  setDeckgl: (s: State): ((instance: Deck | MapboxOverlay) => void) => s.setDeckgl
} satisfies Record<string, (state: State) => State[keyof State]>;
