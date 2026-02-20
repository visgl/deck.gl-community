// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import turfCenter from '@turf/center';
import {mapCoords} from '../edit-modes/utils';
import {geoCoordinateSystem} from '../edit-modes/coordinate-system';
import type {CoordinateSystem} from '../edit-modes/coordinate-system';
import type {SimpleFeature} from './geojson-types';

// This function takes feature's center, moves it,
// and builds new feature around it keeping the proportions
export function translateFromCenter(
  feature: SimpleFeature,
  distance: number,
  direction: number,
  coordinateSystem: CoordinateSystem = geoCoordinateSystem
) {
  const initialCenter = turfCenter(feature).geometry.coordinates;

  const movedCenter = coordinateSystem.destination(initialCenter, distance, direction);

  const movedCoordinates = mapCoords(feature.geometry.coordinates, (coordinate) => {
    const dist = coordinateSystem.distance(initialCenter, coordinate);
    const dir = coordinateSystem.bearing(initialCenter, coordinate);
    return coordinateSystem.destination(movedCenter, dist, dir);
  });

  feature.geometry.coordinates = movedCoordinates;

  return feature;
}
