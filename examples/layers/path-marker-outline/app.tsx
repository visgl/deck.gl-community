// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useMemo} from 'react';
import DeckGL from '@deck.gl/react';
import type {MapViewState, TooltipInfo} from '@deck.gl/core';
import {PathOutlineLayer, PathMarkerLayer} from '@deck.gl-community/layers';

type TransitRoute = {
  name: string;
  path: [number, number][];
  color: [number, number, number, number];
  markerColor: [number, number, number, number];
  width: number;
  direction: {forward: boolean; backward: boolean};
};

const TRANSIT_ROUTES: TransitRoute[] = [
  {
    name: 'Embarcadero Loop',
    path: [
      [-122.3959, 37.7946],
      [-122.4024, 37.7981],
      [-122.4091, 37.8033],
      [-122.4156, 37.8085],
      [-122.4209, 37.8118]
    ],
    color: [17, 138, 178, 220],
    markerColor: [17, 138, 178, 255],
    width: 4,
    direction: {forward: true, backward: false}
  },
  {
    name: 'Mission Flyer',
    path: [
      [-122.423, 37.7818],
      [-122.4168, 37.7778],
      [-122.4099, 37.7719],
      [-122.405, 37.7659],
      [-122.4011, 37.7587]
    ],
    color: [245, 101, 101, 220],
    markerColor: [245, 101, 101, 255],
    width: 4,
    direction: {forward: true, backward: true}
  },
  {
    name: 'Twin Peaks Shuttle',
    path: [
      [-122.4468, 37.7681],
      [-122.4406, 37.7647],
      [-122.4338, 37.7633],
      [-122.4262, 37.7648],
      [-122.4193, 37.7675]
    ],
    color: [94, 234, 212, 220],
    markerColor: [16, 185, 129, 255],
    width: 5,
    direction: {forward: true, backward: false}
  }
];

type WaterfrontSegment = {
  name: string;
  path: [number, number][];
  color: [number, number, number, number];
  width: number;
  dashArray?: [number, number];
  zLevel?: number;
};

const WATERFRONT_SEGMENTS: WaterfrontSegment[] = [
  {
    name: 'Bay Trail',
    path: [
      [-122.3933, 37.7936],
      [-122.3908, 37.7985],
      [-122.3879, 37.8041],
      [-122.3849, 37.8096]
    ],
    color: [129, 140, 248, 220],
    width: 6,
    dashArray: [8, 6],
    zLevel: 1
  },
  {
    name: 'Presidio Promenade',
    path: [
      [-122.454, 37.8053],
      [-122.4474, 37.8037],
      [-122.4412, 37.8002],
      [-122.4366, 37.7971],
      [-122.431, 37.7948]
    ],
    color: [96, 165, 250, 220],
    width: 7,
    dashArray: [10, 6],
    zLevel: 0
  },
  {
    name: 'Panhandle Path',
    path: [
      [-122.4525, 37.7737],
      [-122.445, 37.7747],
      [-122.4376, 37.7759],
      [-122.4307, 37.7767],
      [-122.424, 37.7769]
    ],
    color: [56, 189, 248, 220],
    width: 5,
    dashArray: [6, 4],
    zLevel: 0
  }
];

type LayerDatum = TransitRoute | WaterfrontSegment;

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -122.428,
  latitude: 37.783,
  zoom: 12.2,
  pitch: 35,
  bearing: -10
};

export default function App(): React.ReactElement {
  const layers = useMemo(
    () => [
      new PathOutlineLayer<WaterfrontSegment>({
        id: 'trail-outlines',
        data: WATERFRONT_SEGMENTS,
        pickable: true,
        autoHighlight: true,
        widthUnits: 'pixels',
        widthScale: 8,
        getWidth: (d) => d.width,
        getColor: (d) => d.color,
        getDashArray: (d) => d.dashArray ?? null,
        dashJustified: true,
        getZLevel: (d) => d.zLevel ?? 0,
        parameters: {depthTest: false}
      }),
      new PathMarkerLayer<TransitRoute>({
        id: 'transit-routes',
        data: TRANSIT_ROUTES,
        pickable: true,
        autoHighlight: true,
        widthUnits: 'pixels',
        widthScale: 10,
        getWidth: (d) => d.width,
        getColor: (d) => d.color,
        getMarkerColor: (d) => d.markerColor,
        getDirection: (d) => d.direction,
        getMarkerPercentages: (object, {lineLength}) =>
          lineLength > 800 ? [0.2, 0.5, 0.8] : [0.5],
        parameters: {depthTest: false}
      })
    ],
    []
  );

  const getTooltip = useCallback(
    (info: TooltipInfo<LayerDatum>) => {
      const {object, layer, index} = info;
      if (!object) {
        return null;
      }

      if (typeof (object as any).name === 'string') {
        return {text: (object as any).name};
      }

      if (Array.isArray(object) && layer?.props?.data) {
        const data = layer.props.data as LayerDatum[];
        const datum = data[index];
        if (datum && typeof (datum as any).name === 'string') {
          return {text: (datum as any).name};
        }
      }

      return null;
    },
    []
  );

  return (
    <DeckGL
      layers={layers}
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      getTooltip={getTooltip}
      parameters={{clearColor: [0.96, 0.97, 1, 1]}}
      style={{position: 'absolute', width: '100%', height: '100%'}}
    />
  );
}
