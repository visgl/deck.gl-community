import type {Deck} from '@deck.gl/core';
import type {ReactNode} from 'react';
import type {DeckglProps} from '../types/index';

/** The deck.gl instance exposed by the standalone compatibility adapter. */
export type DeckGLInstance = Deck;

/** The bounded context value supplied through a caller-provided ContextProvider. */
export interface DeckGLContextValue<Instance = DeckGLInstance> {
  deck: Instance | null;
}

/** Props shared by compatibility adapters backed by a concrete native root. */
export type CompatibilityDeckGLProps<NativeProps, Instance> = Omit<
  NativeProps,
  'canvas' | 'children' | 'gl' | 'parent' | '_customRender' | 'onDeckglChange'
> & {
  children?: ReactNode;
  /** Optional provider that receives the bounded `{deck}` compatibility context. */
  ContextProvider?: React.JSXElementConstructor<React.ProviderProps<DeckGLContextValue<Instance>>>;
};

/** Props supported by the standalone `@deck.gl/react` compatibility adapter. */
export type DeckGLProps = CompatibilityDeckGLProps<DeckglProps, DeckGLInstance>;

/** Imperative surface exposed by a compatibility adapter. */
export interface DeckGLRef<Instance = DeckGLInstance> {
  deck: Instance | null;
  pickObject: Deck['pickObject'];
  pickObjects: Deck['pickObjects'];
  pickMultipleObjects: Deck['pickMultipleObjects'];
  pickObjectAsync: Deck['pickObjectAsync'];
  pickObjectsAsync: Deck['pickObjectsAsync'];
}
