export {createDeckGL, DeckGL} from './components';
/**
 * Re-export public types from the package root.
 *
 * This supports:
 * ```ts
 * import {type DeckglInstance} from '@deck.gl-community/react-fiber';
 * ```
 */
export type {DeckGLRootProps, DeckglInstance, DeckglProps, OnDeckglChange} from '../types/index';
export {DeckCanvas} from './deck-canvas';
export type {DeckCanvasProps} from './deck-canvas';
