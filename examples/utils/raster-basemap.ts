// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {TileLayer} from '@deck.gl/geo-layers';
import {BitmapLayer} from '@deck.gl/layers';

/** A stock deck.gl raster backdrop for examples that do not need a vector style renderer. */
export function createRasterBasemap(id = 'basemap') {
  return new TileLayer({
    id,
    data: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    renderSubLayers: props => {
      const {bbox} = props.tile;
      if (!('west' in bbox)) return null;
      const {west, south, east, north} = bbox;
      return new BitmapLayer(props, {image: props.data, bounds: [west, south, east, north]});
    }
  });
}
