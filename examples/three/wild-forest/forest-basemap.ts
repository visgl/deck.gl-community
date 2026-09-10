// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {TileLayer} from '@deck.gl/geo-layers';
import {load} from '@loaders.gl/core';
import {MVTLoader} from '@loaders.gl/mvt';
import {GeoJsonLayer} from '@deck.gl/layers';
import type {Color} from '@deck.gl/core';
import type {Feature} from 'geojson';

// CARTO's OpenMapTiles source ends at z14; overzoom those tiles at tree scale.
const VECTOR_TILES =
  'https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt';
const SURFACES: {name: string; color: Color; line?: boolean}[] = [
  {name: 'landcover', color: [227, 234, 220]},
  {name: 'landuse', color: [234, 237, 224]},
  {name: 'park', color: [224, 233, 215]},
  {name: 'water', color: [178, 207, 216]},
  {name: 'waterway', color: [178, 207, 216], line: true},
  {name: 'building', color: [217, 216, 208]},
  {name: 'transportation', color: [255, 255, 253], line: true},
  {name: 'boundary', color: [188, 193, 182], line: true}
];

/** Muted vector geometry leaves the seasonal tree models as the visual focus. */
export function createForestBasemap({
  id,
  onLoad,
  onError
}: {
  id: string;
  onLoad: () => void;
  onError: () => void;
}) {
  return new TileLayer<Feature[]>({
    id,
    data: VECTOR_TILES,
    minZoom: 0,
    maxZoom: 14,
    tileSize: 512,
    maxRequests: 6,
    // Do not parse and upload detailed tiles for every intermediate flight frame.
    debounceTime: 200,
    maxCacheSize: 128,
    refinementStrategy: 'best-available',
    pickable: false,
    onTileLoad: onLoad,
    onTileError: onError,
    getTileData({url, index, signal}) {
      // Keep cached tile coordinates identical across GlobeView and MapView.
      // MVTLayer otherwise decodes local coordinates on the map and WGS84 on the globe.
      return load(url!, MVTLoader, {
        mvt: {shape: 'geojson', coordinates: 'wgs84', tileIndex: index},
        fetch: {signal}
      }) as Promise<Feature[]>;
    },
    renderSubLayers(props) {
      const {data, ...tileProps} = props;
      const features = (Array.isArray(data) ? data : []) as Feature[];
      return SURFACES.map(
        surface =>
          new GeoJsonLayer(tileProps, {
            id: `${props.id}-${surface.name}`,
            data: features.filter(
              feature =>
                feature.properties?.layerName === surface.name &&
                (surface.name !== 'boundary' ||
                  (feature.properties?.admin_level === 2 && !feature.properties?.maritime))
            ),
            filled: !surface.line,
            stroked: Boolean(surface.line),
            getFillColor: surface.color,
            getLineColor: surface.color,
            getLineWidth: surface.name === 'transportation' ? 2 : 1,
            lineWidthUnits: 'pixels',
            pointRadiusMaxPixels: 0,
            // Paint coplanar map surfaces in style order without depth fighting.
            // Depth testing still hides the far side behind the globe.
            parameters: {cullMode: 'none', depthCompare: 'less-equal', depthWriteEnabled: false},
            pickable: false
          })
      );
    }
  });
}
