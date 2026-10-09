import 'client-only';
import {MapLibreOverlay} from '@deck.gl/maplibre';
import type {MapLibreOverlayProps} from '@deck.gl/maplibre';
import {createDeckGL} from './components';
import type {DeckGLRootProps} from '../types/index';

/** Props accepted by the MapLibre-overlay React Fiber root. */
export type MapLibreDeckGLProps = DeckGLRootProps<MapLibreOverlay, MapLibreOverlayProps>;

/** A React Fiber root backed by one MapLibreOverlay control. */
export const DeckGL = createDeckGL<MapLibreOverlayProps, MapLibreOverlay>({
  createExternalOverlay: props => new MapLibreOverlay(props),
  /** `MapLibreOverlay` reads `interleaved` only in its constructor. */
  recreateOnChange: ['interleaved']
});

export type {MapLibreOverlay, MapLibreOverlayProps};
