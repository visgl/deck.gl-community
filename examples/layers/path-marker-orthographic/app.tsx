// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React from 'react';
import DeckGL from '@deck.gl/react';
import {COORDINATE_SYSTEM, OrthographicView} from '@deck.gl/core';
import {PathMarkerLayer, PathOutlineLayer} from '@deck.gl-community/layers';

const DATA = [
  {
    path: [
      [0, 0],
      [100, 0],
      [100, 100]
    ],
    color: [64, 160, 255, 255],
    direction: {forward: true, backward: false}
  }
];

const INITIAL_VIEW_STATE = {
  target: [50, 50, 0],
  zoom: 0
};

export default function App(): React.ReactElement {
  const layers = [
    new PathOutlineLayer({
      id: 'outline',
      data: DATA,
      getPath: (d) => d.path,
      getColor: (d) => d.color,
      widthUnits: 'pixels',
      widthScale: 2,
      coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
      coordinateOrigin: [0, 0]
    }),
    new PathMarkerLayer({
      id: 'markers',
      data: DATA,
      getPath: (d) => d.path,
      getColor: () => [0, 0, 0, 0],
      getMarkerColor: () => [0, 0, 0, 255],
      coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
      coordinateOrigin: [0, 0]
    })
  ];

  return (
    <DeckGL
      views={new OrthographicView()}
      controller={true}
      layers={layers}
      initialViewState={INITIAL_VIEW_STATE}
    />
  );
}
