// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {PickingInfo} from '@deck.gl/core';
import {GeoArrowPathLayer} from '@deck.gl-community/arrow-layers';
import {mountGeoArrowMapExample} from '../mount-geoarrow-map-example';

const GEOARROW_POINT_DATA = 'http://localhost:8080/ne_10m_roads_north_america.arrow';

const INITIAL_VIEW_STATE = {
  latitude: 40,
  longitude: -95,
  zoom: 4,
  bearing: 0,
  pitch: 0
};

/**
 * Mounts the GeoArrow LineString example.
 */
export function mountGeoArrowLineStringExample(container: HTMLElement): () => void {
  return mountGeoArrowMapExample(container, {
    dataUrl: GEOARROW_POINT_DATA,
    initialViewState: INITIAL_VIEW_STATE,
    onClick: handleClick,
    getLayers: (table) => [
      new GeoArrowPathLayer({
        id: 'geoarrow-linestring',
        data: table,
        getColor: [255, 0, 0],
        widthMinPixels: 1,
        pickable: true
      })
    ]
  });
}

function handleClick(info: PickingInfo) {
  if (info.object) {
    console.log(JSON.stringify(info.object.toJSON()));
  }
}
