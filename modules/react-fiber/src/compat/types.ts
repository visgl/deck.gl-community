import type {Deck} from '@deck.gl/core';
import type {MapboxOverlay} from '@deck.gl/mapbox';
import type {ReactNode} from 'react';
import type {DeckglProps} from '../types/index';

/** The deck.gl instance exposed by the compatibility adapter. */
export type DeckGLInstance = Deck | MapboxOverlay;

/**
 * The bounded context value supplied through a caller-provided ContextProvider.
 *
 * `deck` is null until the local renderer initializes its deck.gl instance.
 */
export interface DeckGLContextValue {
  deck: DeckGLInstance | null;
}

/**
 * Props supported by the `DeckGL` compatibility adapter.
 *
 * Low-level renderer ownership props and the native lifecycle notification are
 * intentionally unsupported. Use the native `DeckGL` component when an application
 * needs to provide `gl`, `canvas`, `parent`, `_customRender`, or `onDeckglChange`.
 * Use this adapter's imperative ref or optional context provider to access its instance.
 */
export type DeckGLProps = Omit<
  DeckglProps,
  'canvas' | 'children' | 'gl' | 'parent' | '_customRender' | 'onDeckglChange'
> & {
  children?: ReactNode;
  /** Optional provider that receives the bounded `{deck}` compatibility context. */
  ContextProvider?: React.JSXElementConstructor<React.ProviderProps<DeckGLContextValue>>;
};

/**
 * Imperative surface exposed by the `DeckGL` compatibility adapter.
 *
 * Before renderer initialization, `deck` is null and picking calls throw an error.
 * Async picking is unavailable for interleaved `MapboxOverlay` roots because that
 * deck.gl integration exposes only synchronous picking methods.
 */
export interface DeckGLRef {
  deck: DeckGLInstance | null;
  pickObject: Deck['pickObject'];
  pickObjects: Deck['pickObjects'];
  pickMultipleObjects: Deck['pickMultipleObjects'];
  pickObjectAsync: Deck['pickObjectAsync'];
  pickObjectsAsync: Deck['pickObjectsAsync'];
}
