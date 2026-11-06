// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  createWindField,
  sampleWindField,
  type WindField,
  type WindMeasurement,
  type WindStation
} from '@deck.gl-community/geo-layers';
import type {WindSampler} from '@deck.gl-community/layers';

/** Web Mercator metres per degree at the garden's origin, (0, 0), on both axes. */
const METERS_PER_DEGREE = 111_319.49;

/** Where the garden takes its scene-wide direction and speed: the central station. */
export const GARDEN_CENTER: [number, number] = [-7, 0];

// A calm southwest corner and a windy northeast one, so speed rises across the rows. Directions
// are eighth-turns counterclockwise from east: 0 blows toward the east, 1 toward the northeast.
const STATIONS: {name: string; position: [number, number]; measurement: WindMeasurement}[] = [
  {name: 'Southwest', position: [-70, -40], measurement: [1, 2, 18]},
  {name: 'Northwest', position: [-70, 40], measurement: [0, 7, 17]},
  {name: 'Southeast', position: [56, -40], measurement: [1, 9, 20]},
  {name: 'Northeast', position: [56, 40], measurement: [1, 15, 19]},
  {name: 'Centre', position: GARDEN_CENTER, measurement: [1, 6, 19]}
];

/** Garden metres to `[longitude, latitude]` around the deck's metre-offset origin. */
function getLngLat([x, y]: readonly number[]): [number, number] {
  return [x / METERS_PER_DEGREE, y / METERS_PER_DEGREE];
}

/** Five stations around the garden, in geo-layers' positive-west station format. One frame. */
export const GARDEN_WIND_FIELD: WindField = createWindField(
  STATIONS.map(({name, position}): WindStation => {
    const [longitude, latitude] = getLngLat(position);
    return {name, long: -longitude, lat: latitude, elv: 0};
  }),
  [STATIONS.map(station => station.measurement)]
);

/**
 * `WindSample.direction` to `WindEffect`'s bearing. geo-layers' direction is counterclockwise
 * radians from east, and it is the direction of travel: `WindLayer` draws each arrowhead at
 * `position + (cos, sin) × length`, and `ParticleLayer` advances particles along `(cos, sin)`.
 * `WindEffect` takes the bearing the wind blows toward, in degrees clockwise from north, so only
 * the angle convention changes. A source that reports where wind comes from would add 180°.
 */
export function getWindSampleBearing(direction: number): number {
  const bearing = 90 - (direction * 180) / Math.PI;
  return ((bearing % 360) + 360) % 360;
}

/** Adapt a geo-layers `WindField` to a sampler over garden metres. */
export function createStationSampler(field: WindField): WindSampler {
  return (position, time) => {
    const sample = sampleWindField(field, getLngLat(position), time);
    return sample && {speed: sample.speed, direction: getWindSampleBearing(sample.direction)};
  };
}

/** The garden's station wind, in m/s at 10 m. Null outside the stations. */
export const sampleGardenWind: WindSampler = createStationSampler(GARDEN_WIND_FIELD);
