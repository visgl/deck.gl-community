// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, test, expect} from 'vitest';
import {
  GeoCoordinateSystem,
  CartesianCoordinateSystem,
  geoCoordinateSystem,
  cartesianCoordinateSystem
} from '../../src/edit-modes/coordinate-system';

// Tolerance for floating-point comparisons
const CART_TOLERANCE = 1e-6;

describe('GeoCoordinateSystem', () => {
  const cs = new GeoCoordinateSystem();

  test('distance: same point returns 0', () => {
    expect(cs.distance([0, 0], [0, 0])).toBeCloseTo(0, 5);
  });

  test('distance: known distance along equator (~111km per degree)', () => {
    const d = cs.distance([0, 0], [1, 0]);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  test('bearing: due east is ~90°', () => {
    expect(cs.bearing([0, 0], [1, 0])).toBeCloseTo(90, 0);
  });

  test('bearing: due north is 0°', () => {
    expect(cs.bearing([0, 0], [0, 1])).toBeCloseTo(0, 0);
  });

  test('bearing: due west is ~-90°', () => {
    expect(cs.bearing([0, 0], [-1, 0])).toBeCloseTo(-90, 0);
  });

  test('destination: round-trip with bearing/distance', () => {
    const start: [number, number] = [10, 20];
    const dist = cs.distance(start, [11, 20]);
    const brng = cs.bearing(start, [11, 20]);
    const dest = cs.destination(start, dist, brng);
    expect(dest[0]).toBeCloseTo(11, 3);
    expect(dest[1]).toBeCloseTo(20, 3);
  });

  test('midpoint: midpoint between two positions', () => {
    const mid = cs.midpoint([0, 0], [2, 0]);
    expect(mid[0]).toBeCloseTo(1, 3);
    expect(mid[1]).toBeCloseTo(0, 3);
  });

  test('singleton geoCoordinateSystem is a GeoCoordinateSystem', () => {
    expect(geoCoordinateSystem).toBeInstanceOf(GeoCoordinateSystem);
  });
});

describe('CartesianCoordinateSystem', () => {
  const cs = new CartesianCoordinateSystem();

  test('distance: same point returns 0', () => {
    expect(cs.distance([0, 0], [0, 0])).toBeCloseTo(0, 5);
  });

  test('distance: Pythagorean 3-4-5 triangle', () => {
    expect(cs.distance([0, 0], [3, 4])).toBeCloseTo(5, 5);
  });

  test('distance: horizontal segment', () => {
    expect(cs.distance([0, 0], [100, 0])).toBeCloseTo(100, 5);
  });

  test('distance: vertical segment', () => {
    expect(cs.distance([0, 0], [0, 50])).toBeCloseTo(50, 5);
  });

  test('bearing: due east (positive X) is 90°', () => {
    expect(cs.bearing([0, 0], [1, 0])).toBeCloseTo(90, 5);
  });

  test('bearing: due north (positive Y) is 0°', () => {
    expect(cs.bearing([0, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  test('bearing: due south (negative Y) is 180°', () => {
    expect(Math.abs(cs.bearing([0, 0], [0, -1]))).toBeCloseTo(180, 5);
  });

  test('bearing: due west (negative X) is -90°', () => {
    expect(cs.bearing([0, 0], [-1, 0])).toBeCloseTo(-90, 5);
  });

  test('destination: move east by 100 units', () => {
    const dest = cs.destination([0, 0], 100, 90);
    expect(dest[0]).toBeCloseTo(100, CART_TOLERANCE);
    expect(dest[1]).toBeCloseTo(0, CART_TOLERANCE);
  });

  test('destination: move north by 50 units', () => {
    const dest = cs.destination([0, 0], 50, 0);
    expect(dest[0]).toBeCloseTo(0, CART_TOLERANCE);
    expect(dest[1]).toBeCloseTo(50, CART_TOLERANCE);
  });

  test('destination: round-trip with bearing/distance', () => {
    const start: [number, number] = [100, 200];
    const end: [number, number] = [400, 600];
    const dist = cs.distance(start, end);
    const brng = cs.bearing(start, end);
    const dest = cs.destination(start, dist, brng);
    expect(dest[0]).toBeCloseTo(end[0], 5);
    expect(dest[1]).toBeCloseTo(end[1], 5);
  });

  test('midpoint: midpoint between two positions', () => {
    const mid = cs.midpoint([0, 0], [200, 100]);
    expect(mid[0]).toBeCloseTo(100, 5);
    expect(mid[1]).toBeCloseTo(50, 5);
  });

  test('singleton cartesianCoordinateSystem is a CartesianCoordinateSystem', () => {
    expect(cartesianCoordinateSystem).toBeInstanceOf(CartesianCoordinateSystem);
  });
});

describe('CartesianCoordinateSystem bearing/destination consistency', () => {
  const cs = new CartesianCoordinateSystem();

  test('translate feature: destination is consistent with distance and bearing', () => {
    // Simulate translateFromCenter logic: center at origin, coord at [100, 0]
    // Move center by [50, 50]
    const center: [number, number] = [0, 0];
    const coord: [number, number] = [100, 0];
    const newCenter: [number, number] = [50, 50];

    const dist = cs.distance(center, coord);
    const brng = cs.bearing(center, coord);
    const newCoord = cs.destination(newCenter, dist, brng);

    // newCoord should be center moved by [100, 0], i.e. [150, 50]
    expect(newCoord[0]).toBeCloseTo(150, 4);
    expect(newCoord[1]).toBeCloseTo(50, 4);
  });
});
