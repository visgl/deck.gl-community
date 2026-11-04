import type {MapboxOverlay, MapboxOverlayProps} from '@deck.gl/mapbox';
import {DeckGL as NativeDeckGL} from '../dom/mapbox';
import {createDeckGLAdapter} from './deckgl';
import type {
  CompatibilityDeckGLProps,
  DeckGLContextValue as BaseDeckGLContextValue,
  DeckGLRef as BaseDeckGLRef
} from './types';

/** Props supported by the Mapbox-overlay compatibility adapter. */
export type DeckGLProps = CompatibilityDeckGLProps<MapboxOverlayProps, MapboxOverlay>;

/** Context value supplied by the Mapbox-overlay compatibility adapter. */
export type DeckGLContextValue = BaseDeckGLContextValue<MapboxOverlay>;

/** Imperative ref exposed by the Mapbox-overlay compatibility adapter. */
export type DeckGLRef = BaseDeckGLRef<MapboxOverlay>;

/** A bounded `@deck.gl/react` adapter backed by one MapboxOverlay control. */
export const DeckGL = createDeckGLAdapter(NativeDeckGL);
