import {Deck, _GlobeView, type MapViewState} from '@deck.gl/core';
import {
  A5Grid,
  GeohashGrid,
  GlobalGridLayer,
  H3Grid,
  QuadkeyGrid,
  S2Grid
} from '@deck.gl-community/geo-layers';

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 0,
  latitude: 15,
  zoom: 1.7,
  minZoom: 1,
  maxZoom: 8
};

export function mountGlobalGridLayerExample(container: HTMLElement): () => void {
  const sampleLocations = [-150, -90, -30, 30, 90, 150].flatMap(longitude =>
    [-45, 0, 45].map(latitude => [longitude, latitude] as [number, number])
  );
  const cells = sampleLocations.map(lngLat => ({cellId: H3Grid.lngLatToCell!(lngLat, 2)}));
  const a5Cells = sampleLocations.map(lngLat => ({cellId: A5Grid.lngLatToCell!(lngLat, 2)}));

  // The string based grids use stable world-spanning samples so the example is
  // deterministic and shows the different cell shapes at a glance.
  const geohashCells = ['2b', '8n', '9q', 'd2', 'ex', 'g0', 's0', 'u0'].map(cellId => ({cellId}));
  const quadkeyCells = ['00', '01', '02', '03', '10', '11', '12', '13'].map(cellId => ({cellId}));
  const s2Cells = ['04', '0c', '14', '1c', '24', '2c', '34', '3c'].map(cellId => ({cellId}));

  const gridLayers = [
    {id: 'h3', data: cells, globalGrid: H3Grid, color: [30, 120, 220, 150], filled: true},
    {id: 'a5', data: a5Cells, globalGrid: A5Grid, color: [245, 158, 11, 130], filled: true},
    {
      id: 'geohash',
      data: geohashCells,
      globalGrid: GeohashGrid,
      color: [16, 185, 129, 110],
      filled: true
    },
    {
      id: 'quadkey',
      data: quadkeyCells,
      globalGrid: QuadkeyGrid,
      color: [168, 85, 247, 220],
      filled: false
    },
    {id: 's2', data: s2Cells, globalGrid: S2Grid, color: [239, 68, 68, 220], filled: false}
  ];

  const deck = new Deck({
    parent: container,
    views: new _GlobeView({controller: true}),
    initialViewState: INITIAL_VIEW_STATE,
    layers: gridLayers.map(
      ({id, data, globalGrid, color, filled}) =>
        new GlobalGridLayer({
          id: `global-grid-${id}`,
          data,
          globalGrid,
          filled,
          stroked: true,
          getFillColor: color,
          getLineColor: color,
          getLineWidth: 2,
          lineWidthMinPixels: 1
        })
    )
  });
  return () => deck.finalize();
}
