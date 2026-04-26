// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {PickingInfo} from '@deck.gl/core';
import {GeoArrowSolidPolygonLayer} from '@deck.gl-community/arrow-layers';
import {mountGeoArrowMapExample} from '../mount-geoarrow-map-example';

const GEOARROW_POLYGON_DATA = 'http://localhost:8080/ne_10m_admin_0_countries.feather';

const INITIAL_VIEW_STATE = {
  latitude: 25,
  longitude: 0,
  zoom: 1.5,
  bearing: 0,
  pitch: 0
};

/**
 * Mounts the GeoArrow MultiPolygon example.
 */
export function mountGeoArrowMultiPolygonExample(container: HTMLElement): () => void {
  return mountGeoArrowMapExample(container, {
    dataUrl: GEOARROW_POLYGON_DATA,
    initialViewState: INITIAL_VIEW_STATE,
    onClick: handleClick,
    getLayers: table => [
      new GeoArrowSolidPolygonLayer({
        id: 'geoarrow-polygons',
        data: table,
        getPolygon: table.getChild('geometry'),
        getFillColor: table.getChild('pop_colors'),
        pickable: true,
        autoHighlight: true
      })
    ]
  });
}

function handleClick(info: PickingInfo) {
  if (info.object) {
    console.log(JSON.stringify(info.object.toJSON()));
  }
}
