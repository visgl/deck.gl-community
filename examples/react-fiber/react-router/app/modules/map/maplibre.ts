import {Map as MaplibreMap} from 'maplibre-gl';
import {INITIAL_VIEW_STATE} from './constants';

/**
 * Connect deck.gl to a Maplibre map instance for interleaved rendering
 */
export function connect(deckgl: unknown) {
  const map = new MaplibreMap({
    center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
    container: 'maplibre',
    style: {
      layers: [
        {
          id: 'simple-tiles',
          type: 'raster',
          source: 'raster-tiles',
          minzoom: 0,
          maxzoom: 22
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

  map.once('load', () => {
    map.addControl(deckgl as Parameters<MaplibreMap['addControl']>[0]);
  });

  return () => {
    map.removeControl(deckgl as Parameters<MaplibreMap['removeControl']>[0]);
    map.remove();
  };
}
