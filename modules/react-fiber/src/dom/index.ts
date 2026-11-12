export {createDeckGL, DeckGL} from './components';
/**
 * Re-export public types from the package root.
 *
 * This supports:
 * ```ts
 * import {type DeckGLProps} from '@deck.gl-community/react-fiber';
 * ```
 */
export type {DeckGLRootProps, DeckGLProps, OnDeckChange} from '../types/index';
export {DeckCanvas} from './deck-canvas';
export type {DeckCanvasProps} from './deck-canvas';
export type {
  DeckEffectProps,
  DeckGLElementComponents,
  DeckLayerProps,
  DeckViewProps,
  DeckWidgetProps
} from './elements';
