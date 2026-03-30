// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {PickingInfo} from '@deck.gl/core';
import {GeoArrowTripsLayer} from '@deck.gl-community/arrow-layers';
import {mountGeoArrowMapExample} from '../mount-geoarrow-map-example';

const GEOARROW_POINT_DATA = 'http://localhost:8080/trips.feather';

const INITIAL_VIEW_STATE = {
  longitude: -74,
  latitude: 40.72,
  zoom: 13,
  pitch: 45,
  bearing: 0
};

/**
 * Mounts the GeoArrow Trips example.
 */
export function mountGeoArrowTripsExample(container: HTMLElement): () => void {
  return mountGeoArrowMapExample(container, {
    dataUrl: GEOARROW_POINT_DATA,
    initialViewState: INITIAL_VIEW_STATE,
    onClick: handleClick,
    animation: {
      loopLength: 1800,
      animationSpeed: 1
    },
    getLayers: (table, animationState) => [
      new GeoArrowTripsLayer({
        id: 'geoarrow-linestring',
        data: table,
        getColor: [255, 0, 0],
        getPath: table.getChild('geometry'),
        getTimestamps: table.getChild('timestamps'),
        widthMinPixels: 2,
        pickable: true,
        trailLength: 180,
        currentTime: animationState.currentTime
      })
    ]
  });
}

function handleClick(info: PickingInfo) {
  if (info.object) {
    console.log(JSON.stringify(info.object.toJSON()));
  }
}
