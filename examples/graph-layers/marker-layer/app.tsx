// deck.gl-community
// SPDX-License-Identifier: MIT

import React, {useMemo} from 'react';
import DeckGL from '@deck.gl/react';
import {MarkerLayer} from '@deck.gl-community/graph-layers';
import StaticMap from 'react-map-gl/maplibre';

const INITIAL_VIEW_STATE = {
  longitude: -98,
  latitude: 39,
  zoom: 3,
  pitch: 0,
  bearing: 0
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

type CityMarker = {
  position: [number, number];
  marker: string;
  color: [number, number, number, number];
  size: number;
  label: string;
};

const CITY_MARKERS: CityMarker[] = [
  {
    position: [-122.4, 37.78],
    marker: 'pin-filled',
    color: [220, 38, 38, 255],
    size: 32,
    label: 'San Francisco, CA'
  },
  {
    position: [-73.98, 40.75],
    marker: 'star-filled',
    color: [37, 99, 235, 255],
    size: 36,
    label: 'New York, NY'
  },
  {
    position: [-87.62, 41.88],
    marker: 'location-marker-filled',
    color: [16, 185, 129, 255],
    size: 28,
    label: 'Chicago, IL'
  }
];

export default function App(): React.ReactElement {
  const layers = useMemo(
    () => [
      new MarkerLayer({
        id: 'marker-layer',
        data: CITY_MARKERS,
        getPosition: (d) => d.position,
        getMarker: (d) => d.marker,
        getColor: (d) => d.color,
        getSize: (d) => d.size
      })
    ],
    []
  );

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={{dragPan: true, scrollZoom: true}}
      layers={layers}
      style={{width: '100vw', height: '100vh'}}
      getTooltip={(info) => {
        const {object} = info;
        return object ? object.label : null;
      }}
    >
      <StaticMap mapStyle={MAP_STYLE} />
    </DeckGL>
  );
}
