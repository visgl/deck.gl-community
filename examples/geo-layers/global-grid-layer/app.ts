import {Deck, MapView, type MapViewState} from '@deck.gl/core';
import {GlobalGridLayer, H3Grid} from '@deck.gl-community/geo-layers';

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 180,
  latitude: 18,
  zoom: 2.5,
  minZoom: 1,
  maxZoom: 8
};

export function mountGlobalGridLayerExample(container: HTMLElement): () => void {
  const cells = [-179.5, 179.5].flatMap(longitude =>
    [-5, 5, 15, 25].map(latitude => ({cellId: H3Grid.lngLatToCell!([longitude, latitude], 3)}))
  );
  const deck = new Deck({
    parent: container,
    views: new MapView({repeat: true, controller: true}),
    initialViewState: INITIAL_VIEW_STATE,
    layers: [
      new GlobalGridLayer({
        id: 'global-grid',
        data: cells,
        globalGrid: H3Grid,
        filled: true,
        stroked: true,
        getFillColor: [30, 120, 220, 150],
        getLineColor: [255, 255, 255, 220],
        getLineWidth: 2,
        lineWidthMinPixels: 1
      })
    ]
  });
  return () => deck.finalize();
}
