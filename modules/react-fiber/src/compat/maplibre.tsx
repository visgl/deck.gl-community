import type {MapLibreOverlay, MapLibreOverlayProps} from '@deck.gl/maplibre';
import {DeckGL as NativeDeckGL} from '../dom/maplibre';
import {createDeckGLAdapter} from './deckgl';
import type {
  CompatibilityDeckGLProps,
  DeckGLContextValue as BaseDeckGLContextValue,
  DeckGLRef as BaseDeckGLRef
} from './types';

/** Props supported by the MapLibre-overlay compatibility adapter. */
export type DeckGLProps = CompatibilityDeckGLProps<MapLibreOverlayProps, MapLibreOverlay>;

/** Context value supplied by the MapLibre-overlay compatibility adapter. */
export type DeckGLContextValue = BaseDeckGLContextValue<MapLibreOverlay>;

/** Imperative ref exposed by the MapLibre-overlay compatibility adapter. */
export type DeckGLRef = BaseDeckGLRef<MapLibreOverlay>;

/** A bounded `@deck.gl/react` adapter backed by one MapLibreOverlay control. */
export const DeckGL = createDeckGLAdapter(NativeDeckGL);
