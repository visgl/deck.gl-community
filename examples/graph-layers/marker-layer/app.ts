// deck.gl-community
// SPDX-License-Identifier: MIT

import {Deck} from '@deck.gl/core';
import {Map} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {MarkerLayer, type Marker} from '@deck.gl-community/graph-layers';

const INITIAL_VIEW_STATE = {
  longitude: -98,
  latitude: 39,
  zoom: 3,
  pitch: 0,
  bearing: 0
};

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

type CityMarker = {
  position: [number, number];
  marker: Marker;
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

export function mountMarkerLayerExample(container: HTMLElement): () => void {
  const host = container.ownerDocument.createElement('div');
  Object.assign(host.style, {position: 'relative', width: '100%', height: '100%'});
  const basemap = container.ownerDocument.createElement('div');
  Object.assign(basemap.style, {position: 'absolute', inset: '0'});
  host.append(basemap);
  container.append(host);

  const map = new Map({
    container: basemap,
    style: MAP_STYLE,
    center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
    zoom: INITIAL_VIEW_STATE.zoom,
    interactive: false
  });
  const deck = new Deck({
    parent: host,
    initialViewState: INITIAL_VIEW_STATE,
    controller: true,
    layers: [
      new MarkerLayer({
        id: 'marker-layer',
        data: CITY_MARKERS,
        getPosition: d => d.position,
        getMarker: d => d.marker,
        getColor: d => d.color,
        pickable: true,
        getSize: d => d.size
      })
    ],
    onResize: () => {
      map.resize();
    },
    onViewStateChange: ({viewState: {longitude, latitude, zoom, bearing, pitch}}) => {
      map.jumpTo({center: [longitude, latitude], zoom, bearing, pitch});
    },
    getTooltip: ({object}) => object?.label ?? null
  });

  return () => {
    deck.finalize();
    map.remove();
    host.remove();
  };
}
