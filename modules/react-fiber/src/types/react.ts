import type {Deck, DeckProps, View} from '@deck.gl/core';
import type {MapboxOverlay, MapboxOverlayProps} from '@deck.gl/mapbox';
import type {ReactNode} from 'react';

type ViewOrViews = View | View[] | null;

/** A root-specific deck.gl renderer instance. */
export type DeckglInstance = Deck | MapboxOverlay;

/**
 * Lifecycle notification that receives the root instance after configuration and
 * `null` during cleanup. Changing its identity does not reconfigure or unmount
 * the root, and a replacement callback is used for later notifications.
 */
export type OnDeckglChange = (deckgl: DeckglInstance | null) => void;

/** Props accepted by the native React Fiber `DeckGL` root. */
export type DeckglProps<ViewsT extends ViewOrViews = null> = DeckProps<ViewsT> &
  MapboxOverlayProps & {
    children?: ReactNode;
    /** Lifecycle notification for the root-specific deck.gl instance and its cleanup. */
    onDeckglChange?: OnDeckglChange;
  };
