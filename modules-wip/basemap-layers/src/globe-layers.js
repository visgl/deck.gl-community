// Copyright (c) 2020 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import {COORDINATE_SYSTEM} from '@deck.gl/core';
import {TileLayer} from '@deck.gl/geo-layers';
import {BitmapLayer, SolidPolygonLayer} from '@deck.gl/layers';
import GL from '@luma.gl/constants';
import {getGlobeAtmosphereLayer, getGlobeAtmosphereSkyLayer} from './AtmosphereLayer';
import {getGlobeBasemapLayer} from './MVTLabelLayer';

// const GLOBE_MESH = new SphereGeometry({
//   radius: 6.35e6,
//   nlat: 100,
//   nlong: 100
// });

const BACKGROUND_PARAMETERS = {
  depthTest: true,

  // Force normal blending and keep tiles opaque
  blendFunc: [GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA, GL.ONE, GL.ONE_MINUS_SRC_ALPHA],
  blendEquation: [GL.FUNC_ADD, GL.FUNC_ADD]
};

const BASEMAP_RASTER_PARAMETERS = {
  // Force normal blending and keep tiles opaque
  blendFunc: [GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA, GL.ONE, GL.ONE_MINUS_SRC_ALPHA],
  blendEquation: [GL.FUNC_ADD, GL.FUNC_ADD]
};

const BACKGROUND_DATA = [[[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]]];

const BACKGROUND_NORTH_POLE_DATA = [
  [[-180, 90], [0, 90], [180, 90], [180, 85], [0, 85], [-180, 85]]
];

// TODO: This could be expanded to search for matching layer names from any Mapbox style
// Layer names used for the below:
// background for backgroundFillColor
// water for basemapWaterFillColor
// admin-3-4-boundaries for basemapAdminLineColor
const getBasemapColors = styleType => {
  const colors = {
    backgroundFillColor: [100, 100, 100],
    basemapDefaultFillColor: [255, 255, 255],
    basemapWaterFillColor: [20, 25, 35],
    basemapDefaultLineColor: [0, 0, 0],
    basemapAdminLineColor: [50, 50, 50]
  };

  switch (styleType) {
    case 'dark':
      colors.backgroundFillColor = [9, 16, 29];
      colors.basemapWaterFillColor = [17, 35, 48];
      colors.basemapAdminLineColor = [40, 63, 93];
      break;
    case 'light':
      colors.backgroundFillColor = [235, 240, 240];
      colors.basemapWaterFillColor = [219, 226, 230];
      colors.basemapAdminLineColor = [203, 205, 207];
      break;
    case 'muted':
      colors.backgroundFillColor = [241, 241, 241];
      colors.basemapWaterFillColor = [229, 229, 228];
      colors.basemapAdminLineColor = [222, 222, 222];
      break;
    case 'muted_night':
      colors.backgroundFillColor = [25, 29, 33];
      colors.basemapWaterFillColor = [30, 34, 39];
      colors.basemapAdminLineColor = [76, 89, 103];
      break;
    default:
      break;
  }

  return colors;
};

export const getGlobeBaseLayers = ({mapboxApiUrl, mapboxApiAccessToken, globe, mapStyle}) => {
  const {config} = globe;

  const {styleType} = mapStyle;
  const isSatellite = styleType === 'satellite';
  const colors = getBasemapColors(styleType);

  return [
    config.atmosphere && getGlobeAtmosphereSkyLayer({config}),

    // GLOBE: Planet mesh
    // new SimpleMeshLayer({
    //   id: 'planet',
    //   data: [[0, 0, 0]],
    //   // Requires geospatialOrigin = null in deck viewport-uniforms
    //   coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    //   coordinateOrigin: [0, 0, 0],
    //   getPosition: d => d,
    //   getColor: [26, 38, 55, 255],
    //   // Initialising mesh outside of the render function for better performance
    //   mesh: GLOBE_MESH,
    // }),

    // GLOBE: Background
    (!config.basemap || !isSatellite) &&
      new SolidPolygonLayer({
        id: 'background',
        data: BACKGROUND_DATA,
        getPolygon: d => d,
        stroked: false,
        filled: true,
        getFillColor: colors.backgroundFillColor,
        parameters: BACKGROUND_PARAMETERS
      }),

    // GLOBE: Fill hole at north pole
    config.basemap &&
      new SolidPolygonLayer({
        id: 'background-north-pole',
        data: BACKGROUND_NORTH_POLE_DATA,
        getPolygon: d => d,
        stroked: false,
        filled: true,
        getFillColor: colors.basemapWaterFillColor,
        parameters: BACKGROUND_PARAMETERS
      }),

    config.basemap &&
      !isSatellite &&
      getGlobeBasemapLayer({mapboxApiUrl, mapboxApiAccessToken, config, colors}),

    config.basemap &&
      isSatellite &&
      new TileLayer({
        data: [
          `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.png?access_token=${mapboxApiAccessToken}`
        ],

        // TODO: Find a way to force a higher resolution of tile per zoom to avoid pixellation zoomed out (as tiles are spread across a large area of the globe)
        minZoom: 0,
        maxZoom: 19,
        tileSize: 512 / devicePixelRatio,

        renderSubLayers: props => {
          const {
            bbox: {west, south, east, north}
          } = props.tile;

          return [
            new BitmapLayer(props, {
              _imageCoordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
              data: null,
              image: props.data,
              bounds: [west, south, east, north]
            })
          ];
        },

        parameters: BASEMAP_RASTER_PARAMETERS
      })
  ].filter(Boolean);
};

export const getGlobeTopLayers = ({globe}) => {
  const {config} = globe;
  return [config.atmosphere && getGlobeAtmosphereLayer({config})].filter(Boolean);
};
