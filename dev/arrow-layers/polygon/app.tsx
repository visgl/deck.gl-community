// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {PickingInfo} from '@deck.gl/core';
import {GeoArrowPolygonLayer} from '@deck.gl-community/arrow-layers';
import * as arrow from 'apache-arrow';
import {mountGeoArrowMapExample} from '../mount-geoarrow-map-example';

// const GEOARROW_POLYGON_DATA = "http://localhost:8080/small.feather";

const GEOARROW_POLYGON_DATA = 'http://localhost:8080/nybb.feather';

const INITIAL_VIEW_STATE = {
  latitude: 40.71,
  // longitude: -111.9,
  longitude: -74.0,
  zoom: 9,
  bearing: 0,
  pitch: 0
};

/**
 * Mounts the GeoArrow Polygon example.
 */
export function mountGeoArrowPolygonExample(container: HTMLElement): () => void {
  return mountGeoArrowMapExample(container, {
    dataUrl: GEOARROW_POLYGON_DATA,
    initialViewState: INITIAL_VIEW_STATE,
    onClick: handleClick,
    getLayers: table => [
      new GeoArrowPolygonLayer({
        id: 'geoarrow-polygons',
        stroked: true,
        filled: true,
        data: new arrow.Table(table.batches.slice(0, 10)),
        getFillColor: [0, 100, 60, 160],
        getLineColor: [255, 0, 0],
        lineWidthMinPixels: 1,
        extruded: false,
        wireframe: true,
        pickable: true,
        positionFormat: 'XY',
        _normalize: false,
        autoHighlight: false,
        earcutWorkerUrl: new URL(
          'https://cdn.jsdelivr.net/npm/@geoarrow/geoarrow-js@0.3.0-beta.1/dist/earcut-worker.min.js'
        )
      })
    ]
  });
}

function handleClick(info: PickingInfo) {
  if (info.object) {
    console.log(info.object.BoroName);
  }
}
