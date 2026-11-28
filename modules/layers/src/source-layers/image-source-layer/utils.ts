// loaders.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {lngLatToWorld} from '@math.gl/geospatial/web-mercator';

const HALF_EARTH_CIRCUMFERENCE = 6378137 * Math.PI;

/** Projects EPSG:4326 coordinates to EPSG:3857 meters. */
export function projectWGS84ToPseudoMercator(coord: [number, number]): [number, number] {
  const mercator = lngLatToWorld(coord);
  mercator[0] = (mercator[0] / 256 - 1) * HALF_EARTH_CIRCUMFERENCE;
  mercator[1] = (mercator[1] / 256 - 1) * HALF_EARTH_CIRCUMFERENCE;
  return mercator;
}

export function unprojectPseudoMercatorBounds(
  bounds: [[number, number], [number, number]]
): [number, number, number, number] {
  const minimum = unprojectPseudoMercator(bounds[0]);
  const maximum = unprojectPseudoMercator(bounds[1]);
  return [minimum[0], minimum[1], maximum[0], maximum[1]];
}

export function unprojectPseudoMercator(position: [number, number]): [number, number] {
  const earthRadius = 6378137;
  const longitude = (position[0] / earthRadius) * (180 / Math.PI);
  const latitude =
    (2 * Math.atan(Math.exp(position[1] / earthRadius)) - Math.PI / 2) * (180 / Math.PI);
  return [longitude, latitude];
}
