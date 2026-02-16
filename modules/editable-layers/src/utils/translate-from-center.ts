// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import turfCenter from '@turf/center';
import turfRhumbBearing from '@turf/rhumb-bearing';
import turfRhumbDistance from '@turf/rhumb-distance';
import turfRhumbDestination from '@turf/rhumb-destination';
import {mapCoords} from '../edit-modes/utils';
import type {SimpleFeature} from './geojson-types';

// This function takes feature's center, moves it,
// and builds new feature around it keeping the proportions
export function translateFromCenter(feature: SimpleFeature, distance: number, direction: number) {
  const initialCenterPoint = turfCenter(feature);

  const movedCenterPoint = turfRhumbDestination(initialCenterPoint, distance, direction);

  const movedCoordinates = mapCoords(feature.geometry.coordinates, (coordinate) => {
    const rhumbDistance = turfRhumbDistance(initialCenterPoint.geometry.coordinates, coordinate);
    const rhumbDirection = turfRhumbBearing(initialCenterPoint.geometry.coordinates, coordinate);

    const movedPosition = turfRhumbDestination(
      movedCenterPoint.geometry.coordinates,
      rhumbDistance,
      rhumbDirection
    ).geometry.coordinates;
    return movedPosition;
  });

  feature.geometry.coordinates = movedCoordinates;

  return feature;
}
