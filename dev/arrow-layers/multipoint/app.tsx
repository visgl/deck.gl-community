// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GeoArrowScatterplotLayer} from '@deck.gl-community/arrow-layers';
import type {PickingInfo} from '@deck.gl/core';
import {mountGeoArrowMapExample} from '../mount-geoarrow-map-example';

const GEOARROW_MULTIPOINT_DATA = 'http://localhost:8080/naturalearth_cities_multipoint.feather';

const INITIAL_VIEW_STATE = {
  latitude: 20,
  longitude: 0,
  zoom: 2,
  bearing: 0,
  pitch: 0
};

/**
 * Mounts the GeoArrow MultiPoint example.
 */
export function mountGeoArrowMultiPointExample(container: HTMLElement): () => void {
  return mountGeoArrowMapExample(container, {
    dataUrl: GEOARROW_MULTIPOINT_DATA,
    initialViewState: INITIAL_VIEW_STATE,
    onClick: handleClick,
    getLayers: (table) => [
      new GeoArrowScatterplotLayer({
        id: 'geoarrow-points',
        data: table,
        getPosition: table.getChild('geometry'),
        getFillColor: [255, 0, 0],
        radiusMinPixels: 4,
        getPointRadius: 10,
        pointRadiusMinPixels: 0.8
      })
    ]
  });
}

function handleClick(info: PickingInfo) {
  if (info.object) {
    alert(`${info.object.properties.name} (${info.object.properties.abbrev})`);
  }
}
