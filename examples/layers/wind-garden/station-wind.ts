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

/** Web Mercator metres per degree at the garden's origin, (0, 0), on both axes. */
const METERS_PER_DEGREE = 111_319.49;

/** Wind at one place: m/s at 10 m, and the compass bearing it blows toward. */
export type StationWind = {speed: number; direction: number};

/** Where the garden takes its one scene-wide wind: the central station. */
export const GARDEN_CENTER: [number, number] = [-7, 0];

// A calm southwest corner and a windy northeast one. Directions are eighth-turns counterclockwise
// from east: 0 blows toward the east, 1 toward the northeast.
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

/** Sample a geo-layers `WindField` at garden metres, as `WindEffect` speed and bearing. */
export function sampleStationWind(
  field: WindField,
  position: readonly number[],
  time = 0
): StationWind | null {
  const sample = sampleWindField(field, getLngLat(position), time);
  return sample && {speed: sample.speed, direction: getWindSampleBearing(sample.direction)};
}

/** The garden's one wind: the station field at its centre. */
export const GARDEN_STATION_WIND: StationWind = sampleStationWind(
  GARDEN_WIND_FIELD,
  GARDEN_CENTER
)!;
