// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {PickingInfo} from '@deck.gl/core';
import {_GeoArrowTextLayer} from '@deck.gl-community/arrow-layers';
import {mountGeoArrowMapExample} from '../mount-geoarrow-map-example';

const GEOARROW_POLYGON_DATA = 'http://localhost:8080/text.arrow';

const INITIAL_VIEW_STATE = {
  latitude: 40.63403641639511,
  longitude: -111.91530172951025,
  zoom: 11,
  bearing: 0,
  pitch: 0
};

/**
 * Mounts the GeoArrow Text example.
 */
export function mountGeoArrowTextExample(container: HTMLElement): () => void {
  return mountGeoArrowMapExample(container, {
    dataUrl: GEOARROW_POLYGON_DATA,
    initialViewState: INITIAL_VIEW_STATE,
    onClick: handleClick,
    getLayers: (table) => [
      new _GeoArrowTextLayer({
        id: 'geoarrow-polygons',
        data: table,
        getColor: [0, 100, 60, 160],
        getText: table.getChild('name'),
        character_set: 'auto',
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
