// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {eciToGeodetic, gstime, propagate, type EciVec3, type SatRec} from 'satellite.js';

export type OrbitClass = 'LEO' | 'MEO' | 'GEO' | 'HEO';

export const ORBIT_CLASSES: OrbitClass[] = ['LEO', 'MEO', 'GEO', 'HEO'];

const EARTH_MU_KM3_S2 = 398600.4418;
const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const MINUTES_TO_MS = 60000;

/** Returns the orbital period in minutes from the SGP4 mean motion (radians per minute). */
export function getOrbitalPeriodMinutes(satrec: SatRec): number {
  return (2 * Math.PI) / satrec.no;
}

/**
 * Classifies an orbit by its mean elements.
 * HEO: eccentricity above 0.25. LEO: apogee below 2,000 km.
 * GEO: period within 2 % of one sidereal day. MEO: the rest.
 */
export function classifyOrbit(satrec: SatRec): OrbitClass {
  const meanMotionRadS = satrec.no / 60;
  const semiMajorAxisKm = Math.cbrt(EARTH_MU_KM3_S2 / (meanMotionRadS * meanMotionRadS));
  const apogeeKm = semiMajorAxisKm * (1 + satrec.ecco) - EARTH_EQUATORIAL_RADIUS_KM;
  if (satrec.ecco > 0.25) {
    return 'HEO';
  }
  if (apogeeKm < 2000) {
    return 'LEO';
  }
  if (Math.abs(getOrbitalPeriodMinutes(satrec) - 1436.07) < 29) {
    return 'GEO';
  }
  return 'MEO';
}

/**
 * Propagates one satellite and writes `[longitude, latitude, altitude]` (degrees, degrees,
 * meters above the WGS84 ellipsoid) to `target` at `offset`.
 * @returns the inertial speed in km/s, or `NaN` when SGP4 fails (the position is then NaN).
 */
export function propagateToLngLatAlt(
  satrec: SatRec,
  date: Date,
  gmst: number,
  target: Float64Array,
  offset: number
): number {
  const state = propagate(satrec, date);
  if (!state) {
    target[offset] = target[offset + 1] = target[offset + 2] = Number.NaN;
    return Number.NaN;
  }
  writeLngLatAlt(state.position, gmst, target, offset);
  const {x, y, z} = state.velocity;
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Samples one orbital period around `date` in the inertial frame and rotates all samples to
 * Earth-fixed coordinates with the sidereal time at `date`. The result is the closed orbit
 * ellipse as it is placed at that instant, as `[lng, lat, altitude meters]` vertices.
 */
export function getOrbitPath(satrec: SatRec, date: Date, segments = 180): number[][] {
  const gmst = gstime(date);
  const periodMs = getOrbitalPeriodMinutes(satrec) * MINUTES_TO_MS;
  return samplePositions(satrec, date.getTime(), periodMs / segments, 0, segments, () => gmst);
}

/**
 * Samples the ground track from one period before `date` to one period after it, at the
 * surface (altitude 0). Each sample uses the sidereal time of its own instant.
 */
export function getGroundTrack(satrec: SatRec, date: Date, segmentsPerOrbit = 180): number[][] {
  const periodMs = getOrbitalPeriodMinutes(satrec) * MINUTES_TO_MS;
  const path = samplePositions(
    satrec,
    date.getTime(),
    periodMs / segmentsPerOrbit,
    -segmentsPerOrbit,
    segmentsPerOrbit,
    time => gstime(new Date(time))
  );
  for (const point of path) {
    point[2] = 0;
  }
  return path;
}

function samplePositions(
  satrec: SatRec,
  centerMs: number,
  stepMs: number,
  firstStep: number,
  lastStep: number,
  getGmst: (timeMs: number) => number
): number[][] {
  const path: number[][] = [];
  const point = new Float64Array(3);
  for (let step = firstStep; step <= lastStep; step++) {
    const time = centerMs + step * stepMs;
    const state = propagate(satrec, new Date(time));
    if (state) {
      writeLngLatAlt(state.position, getGmst(time), point, 0);
      path.push([point[0], point[1], point[2]]);
    }
  }
  return path;
}

function writeLngLatAlt(
  positionEci: EciVec3<number>,
  gmst: number,
  target: Float64Array,
  offset: number
): void {
  const geodetic = eciToGeodetic(positionEci, gmst);
  target[offset] = geodetic.longitude * RADIANS_TO_DEGREES;
  target[offset + 1] = geodetic.latitude * RADIANS_TO_DEGREES;
  target[offset + 2] = geodetic.height * 1000;
}

/**
 * Linear interpolation of `[lng, lat, alt]` triplets that takes the short way across the
 * antimeridian. Writes to `target`, with the longitude in [-180, 180).
 */
export function interpolateLngLatAlt(
  from: Float64Array,
  to: Float64Array,
  t: number,
  target: Float64Array
): void {
  for (let i = 0; i < target.length; i += 3) {
    let deltaLng = to[i] - from[i];
    if (deltaLng > 180) deltaLng -= 360;
    else if (deltaLng < -180) deltaLng += 360;
    let lng = from[i] + deltaLng * t;
    if (lng >= 180) lng -= 360;
    else if (lng < -180) lng += 360;
    target[i] = lng;
    target[i + 1] = from[i + 1] + (to[i + 1] - from[i + 1]) * t;
    target[i + 2] = from[i + 2] + (to[i + 2] - from[i + 2]) * t;
  }
}
