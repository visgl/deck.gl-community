// deck.gl-community
// SPDX-License-Identifier: MIT

import { Deck, _GlobeView } from '@deck.gl/core';
import { GlobalGridLayer, H3Grid, A5Grid, S2Grid, GeohashGrid, QuadkeyGrid } from '@deck.gl-community/layers';
import { getRes0Cells } from 'h3-js';

const INITIAL_VIEW_STATE = {
  latitude: 0,
  longitude: 0,
  zoom: 1,
  minZoom: 1,
  maxZoom: 1,
  pitch: 0,
  bearing: 0
};

const GRIDS = [
  {
    globalGrid: H3Grid,
    data: getRes0Cells(),
    // data: ['85283473fffffff', '85283477fffffff'],
    color: [255, 0, 0, 100],
    padding: { left: 100, right: 0, top: 100, bottom: 0 }
  },
  {
    globalGrid: H3Grid,
    data: getRes0Cells(),
    // data: ['85283473fffffff', '85283477fffffff'],
    color: [0, 255, 0, 100],
    padding: { left: 0, right: 0, top: 400, bottom: 0 }
  },
  // {
  //   grid: A5Grid,
  //   data: ['63605e0000000000', '63606a0000000000']
  // },
  // {
  //   grid: S2Grid,
  //   data: ['89c25', '89c259']
  // },
  // {
  //   grid: GeohashGrid,
  //   data: ['u4pruydqqvj', 'u4pruydqqvm']
  // },
  // {
  //   grid: QuadkeyGrid,
  //   data: ['023112232', '023112233']
  // }
];

const ViewProps = [
  [255, 0, 0, 100],
  [0, 128, 255, 100],
  [0, 255, 0, 100],
  [255, 255, 0, 100],
  [255, 0, 255, 100]
] as const satisfies [number, number, number, number][];


export function exampleApplication() {
  const views = GRIDS.map(({ globalGrid, padding }, i) => new _GlobeView({
    id: globalGrid.name,
    controller: true,
    padding,
  }));

  const layers = GRIDS.map(({ globalGrid, data, color }, i) => new GlobalGridLayer({
    id: globalGrid.name,
    data: data.map(cellId => ({ cellId })),
    globalGrid,
    filled: true,
    stroked: true,
    getFillColor: color as [number, number, number, number],
    getLineColor: [255, 255, 255],
    lineWidthUnits: 'pixels',
    lineWidthScale: 10,
    lineWidthMinPixels: 1,
    parameters: {
      depthWriteEnabled: true,
      depthCompare: 'less-equal',
      cullMode: 'back'
    }
  }));

  const deck = new Deck<_GlobeView[]>({
    initialViewState: {
      H3: INITIAL_VIEW_STATE,
      A5: INITIAL_VIEW_STATE,
    },
    views,
    layerFilter: ({ layer, viewport }) => layer.id == viewport.id,
    layers
  });
}
