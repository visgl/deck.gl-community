// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {PickingInfo} from '@deck.gl/core';
import {GeoArrowScatterplotLayer} from '@deck.gl-community/arrow-layers';
import {mountGeoArrowMapExample} from '../mount-geoarrow-map-example';

const GEOARROW_POINT_DATA = 'http://localhost:8080/2019-01-01_performance_mobile_tiles.feather';

const INITIAL_VIEW_STATE = {
  latitude: 20,
  longitude: 0,
  zoom: 2,
  bearing: 0,
  pitch: 0
};

/**
 * Mounts the GeoArrow Point example.
 */
export function mountGeoArrowPointExample(container: HTMLElement): () => void {
  return mountGeoArrowMapExample(container, {
    dataUrl: GEOARROW_POINT_DATA,
    initialViewState: INITIAL_VIEW_STATE,
    onClick: handleClick,
    getLayers: table => [
      new GeoArrowScatterplotLayer({
        id: 'geoarrow-points',
        data: table,
        getFillColor: table.getChild('colors'),
        opacity: 0.01,
        getRadius: ({index, data}) => {
          const recordBatch = data.data;
          const row = recordBatch.get(index);
          return row.avg_d_kbps / 10;
        },
        radiusMinPixels: 0.1,
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
