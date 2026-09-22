import type {Deck, DeckProps, View} from '@deck.gl/core';
import type {MapboxOverlay, MapboxOverlayProps} from '@deck.gl/mapbox';
import type {ReactNode} from 'react';

type ViewOrViews = View | View[] | null;

/** A root-specific deck.gl renderer instance. */
export type DeckglInstance = Deck | MapboxOverlay;

/** Receives the root instance after configuration and `null` during cleanup. */
export type OnDeckglChange = (deckgl: DeckglInstance | null) => void;

/** Props accepted by the native React Fiber `DeckGL` root. */
export type DeckglProps<ViewsT extends ViewOrViews = null> = DeckProps<ViewsT> &
  MapboxOverlayProps & {
    children?: ReactNode;
    /** Receives the root-specific deck.gl instance and `null` during cleanup. */
    onDeckglChange?: OnDeckglChange;
  };
