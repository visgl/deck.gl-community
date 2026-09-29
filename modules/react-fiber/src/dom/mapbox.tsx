import 'client-only';
import {MapboxOverlay} from '@deck.gl/mapbox';
import type {MapboxOverlayProps} from '@deck.gl/mapbox';
import {createDeckGL} from './components';
import type {DeckGLRootProps} from '../types/index';

/** Props accepted by the Mapbox-overlay React Fiber root. */
export type MapboxDeckGLProps = DeckGLRootProps<MapboxOverlay, MapboxOverlayProps>;

/** A React Fiber root backed by one MapboxOverlay control. */
export const DeckGL = createDeckGL<MapboxOverlayProps, MapboxOverlay>({
  createExternalOverlay: props => new MapboxOverlay(props)
});

export type {MapboxOverlay, MapboxOverlayProps};
