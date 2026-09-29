import type {MapLibreOverlay} from '@deck.gl-community/react-fiber/maplibre';
import {Map as MaplibreMap} from 'maplibre-gl';
import {INITIAL_VIEW_STATE} from './constants';

/**
 * Connect deck.gl to a Maplibre map instance for interleaved rendering
 */
export function connect(deckgl: MapLibreOverlay) {
  const map = new MaplibreMap({
    center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
    container: 'maplibre',
    style: {
      layers: [
        {
          id: 'simple-tiles',
          maxzoom: 22,
          minzoom: 0,
          source: 'raster-tiles',
          type: 'raster'
        }
      ],
      sources: {
        'raster-tiles': {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          tileSize: 256,
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          type: 'raster'
        }
      },
      version: 8
    },
    zoom: INITIAL_VIEW_STATE.zoom
  });
  const mapControl = deckgl as unknown as Parameters<MaplibreMap['addControl']>[0];

  let attached = false;
  let disposed = false;

  const attachOverlay = () => {
    if (!disposed) {
      map.addControl(mapControl);
      attached = true;
    }
  };

  if (map.loaded()) {
    attachOverlay();
  } else {
    map.once('load', attachOverlay);
  }

  return () => {
    disposed = true;
    map.off('load', attachOverlay);
    if (attached) {
      map.removeControl(mapControl);
    }
    map.remove();
  };
}
