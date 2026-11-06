export {createDeckGL, DeckGL} from './components';
/**
 * Re-export public types from the package root.
 *
 * This supports:
 * ```ts
 * import {type DeckGLInstance} from '@deck.gl-community/react-fiber';
 * ```
 */
export type {DeckGLRootProps, DeckGLInstance, DeckGLProps, OnDeckChange} from '../types/index';
export {DeckCanvas} from './deck-canvas';
export type {DeckCanvasProps} from './deck-canvas';
