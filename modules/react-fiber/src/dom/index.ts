export {DeckGL} from './components';
/**
 * Re-export public types from the package root.
 *
 * This supports:
 * ```ts
 * import {type DeckglInstance} from '@deck.gl-community/react-fiber';
 * ```
 *
 * Without this export, consumers must import from the `/types` entry point:
 * ```ts
 * import type {DeckglInstance} from '@deck.gl-community/react-fiber/types';
 * ```
 */
export type {DeckglInstance, DeckglProps, OnDeckglChange} from '../types/index';
