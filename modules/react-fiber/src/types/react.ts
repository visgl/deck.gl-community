import type {Deck, DeckProps, View} from '@deck.gl/core';
import type {ReactNode} from 'react';

type ViewOrViews = View | View[] | null;

/** A root-specific standalone deck.gl renderer instance. */
export type DeckGLInstance = Deck;

/**
 * Lifecycle notification that receives the root instance after configuration and
 * `null` during cleanup. Changing its identity does not reconfigure or unmount
 * the root, and a replacement callback is used for later notifications.
 */
export type OnDeckChange<Instance = DeckGLInstance> = (instance: Instance | null) => void;

/** Shared React-owned props for a concrete deck.gl renderer root. */
export type DeckGLRootProps<Instance, Props> = Props & {
  children?: ReactNode;
  /** Lifecycle notification for the root-specific deck.gl instance and its cleanup. */
  onDeckChange?: OnDeckChange<Instance>;
};

/**
 * Props accepted by the standalone native React Fiber `DeckGL` root.
 *
 * Import a provider entry point or use `createDeckGL` for an external overlay;
 * the root package never selects one implicitly.
 */
export type DeckGLProps<ViewsT extends ViewOrViews = null> = DeckGLRootProps<
  Deck,
  DeckProps<ViewsT>
>;
