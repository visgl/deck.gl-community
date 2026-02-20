// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import turfBearing from '@turf/bearing';
import turfDistance from '@turf/distance';
import turfDestination from '@turf/destination';
import turfMidpoint from '@turf/midpoint';
import {point} from '@turf/helpers';
import {COORDINATE_SYSTEM} from '@deck.gl/core';

import {Position} from '../utils/geojson-types';

/**
 * Abstraction layer for coordinate system math used by edit modes.
 *
 * Allows edit modes to be used with geographic (WGS84) or Cartesian (screen/local)
 * coordinate systems without changing the mode logic.
 *
 * Naming note: this interface is intentionally distinct from deck.gl's own
 * `CoordinateSystem` type (a numeric enum from `@deck.gl/core`), which describes how
 * positions are projected for *rendering*. `EditModeCoordinateSystem` describes how edit
 * modes should perform *geometric math* on those positions.
 *
 * - GeoCoordinateSystem: wraps turf.js — uses geodesic math, assumes WGS84 lon/lat.
 * - CartesianCoordinateSystem: uses Euclidean math — suitable for OrthographicView or pixel space.
 */
export interface EditModeCoordinateSystem {
  /**
   * Returns the distance between two positions.
   * For GeoCoordinateSystem the unit is kilometers; for CartesianCoordinateSystem it is the
   * native coordinate unit (consistent with destination()).
   */
  distance(a: Position, b: Position): number;

  /**
   * Returns the bearing from position `a` to position `b`.
   * Uses compass convention: 0° = north, clockwise, range [-180, 180].
   */
  bearing(a: Position, b: Position): number;

  /**
   * Returns a new position reached by traveling `distance` units in the given `bearing`
   * direction from `origin`.
   */
  destination(origin: Position, distance: number, bearing: number): Position;

  /**
   * Returns the midpoint between two positions.
   */
  midpoint(a: Position, b: Position): Position;
}

/**
 * Geographic coordinate system using turf.js (WGS84 lon/lat, geodesic math).
 * This is the default and preserves the existing behavior of all edit modes.
 */
export class GeoCoordinateSystem implements EditModeCoordinateSystem {
  distance(a: Position, b: Position): number {
    return turfDistance(point(a), point(b));
  }

  bearing(a: Position, b: Position): number {
    return turfBearing(point(a), point(b));
  }

  destination(origin: Position, distance: number, bearing: number): Position {
    return turfDestination(point(origin), distance, bearing).geometry.coordinates;
  }

  midpoint(a: Position, b: Position): Position {
    return turfMidpoint(point(a), point(b)).geometry.coordinates;
  }
}

/**
 * Cartesian (Euclidean) coordinate system for non-geographic use cases such as
 * OrthographicView or pixel/local coordinates.
 *
 * Bearing follows the same compass convention as the geographic system so that
 * destination() and bearing() are consistent with each other:
 * 0° = +Y axis, 90° = +X axis (clockwise from north/up).
 */
export class CartesianCoordinateSystem implements EditModeCoordinateSystem {
  distance(a: Position, b: Position): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  bearing(a: Position, b: Position): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    // atan2(dx, dy): angle from the +Y axis, clockwise — matches compass bearing convention
    const angle = Math.atan2(dx, dy) * (180 / Math.PI);
    // Normalize to [-180, 180] to match turf's bearing range
    return angle > 180 ? angle - 360 : angle <= -180 ? angle + 360 : angle;
  }

  destination(origin: Position, distance: number, bearing: number): Position {
    const bearingRad = bearing * (Math.PI / 180);
    return [
      origin[0] + distance * Math.sin(bearingRad),
      origin[1] + distance * Math.cos(bearingRad)
    ] as Position;
  }

  midpoint(a: Position, b: Position): Position {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Position;
  }
}

/**
 * Default geographic coordinate system instance.
 * Used by edit modes when no coordinate system is provided.
 */
export const geoCoordinateSystem = new GeoCoordinateSystem();

/**
 * Default Cartesian coordinate system instance.
 * Use this with OrthographicView or any non-geographic coordinate system.
 */
export const cartesianCoordinateSystem = new CartesianCoordinateSystem();

/**
 * Returns the provided coordinate system, or `geoCoordinateSystem` as the default.
 * Use this helper inside edit modes to avoid null checks scattered throughout the code.
 */
export function getEditModeCoordinateSystem(
  coordinateSystem?: EditModeCoordinateSystem
): EditModeCoordinateSystem {
  return coordinateSystem ?? geoCoordinateSystem;
}

/**
 * Maps a deck.gl `COORDINATE_SYSTEM` constant to the appropriate `EditModeCoordinateSystem`
 * implementation for edit-mode geometric math.
 *
 * This allows the `EditableGeoJsonLayer` to automatically derive the correct math from
 * its own `coordinateSystem` prop without requiring consumers to configure it separately.
 *
 * | deck.gl constant                   | Math used             |
 * |------------------------------------|-----------------------|
 * | `COORDINATE_SYSTEM.LNGLAT`         | GeoCoordinateSystem   |
 * | `COORDINATE_SYSTEM.DEFAULT`        | GeoCoordinateSystem   |
 * | `COORDINATE_SYSTEM.CARTESIAN`      | CartesianCoordinateSystem |
 * | `COORDINATE_SYSTEM.METER_OFFSETS`  | CartesianCoordinateSystem |
 * | `COORDINATE_SYSTEM.LNGLAT_OFFSETS` | GeoCoordinateSystem   |
 */
export function fromDeckCoordinateSystem(
  deckCoordSystem: number | undefined
): EditModeCoordinateSystem {
  switch (deckCoordSystem) {
    case COORDINATE_SYSTEM.CARTESIAN:
    case COORDINATE_SYSTEM.METER_OFFSETS:
      return cartesianCoordinateSystem;
    case COORDINATE_SYSTEM.LNGLAT:
    case COORDINATE_SYSTEM.LNGLAT_OFFSETS:
    case COORDINATE_SYSTEM.DEFAULT:
    default:
      return geoCoordinateSystem;
  }
}
