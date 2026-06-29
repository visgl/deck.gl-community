// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GeoArrowPathLayer} from '@deck.gl-community/arrow-layers';
import {mountGeoArrowMapExample} from '../mount-geoarrow-map-example';

const GEOARROW_MULTILINESTRING_DATA = 'http://localhost:8080/ne_10m_roads_north_america.feather';

const INITIAL_VIEW_STATE = {
  latitude: 40,
  longitude: -90,
  zoom: 4,
  bearing: 0,
  pitch: 0
};

// https://colorbrewer2.org/#type=sequential&scheme=PuBuGn&n=9
const COLORS_LOOKUP = {
  '3': [255, 247, 251],
  '4': [236, 226, 240],
  '5': [208, 209, 230],
  '6': [166, 189, 219],
  '7': [103, 169, 207],
  '8': [54, 144, 192],
  '9': [2, 129, 138],
  '10': [1, 108, 89],
  '11': [1, 70, 54]
};

/**
 * Mounts the GeoArrow MultiLineString example.
 */
export function mountGeoArrowMultiLineStringExample(container: HTMLElement): () => void {
  return mountGeoArrowMapExample(container, {
    dataUrl: GEOARROW_MULTILINESTRING_DATA,
    initialViewState: INITIAL_VIEW_STATE,
    getLayers: table => [
      new GeoArrowPathLayer({
        id: 'geoarrow-path',
        data: table,
        getColor: ({index, data}) => {
          const recordBatch = data.data;
          const row = recordBatch.get(index);
          return COLORS_LOOKUP[row.scalerank];
        },
        widthMinPixels: 0.8,
        pickable: true
      })
    ]
  });
}
