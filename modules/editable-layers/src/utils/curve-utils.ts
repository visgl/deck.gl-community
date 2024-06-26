// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import hermite from 'cubic-hermite-spline';
import turfDistance from '@turf/distance';
import {lineString} from '@turf/helpers';
import type {Feature, MultiLineString, LineString, Position} from '@turf/helpers';

const INTERPOLATION_INTERVAL = 0.005;
const INTERPOLATION_THRESHOLD = 0.001;

function calculateSingleTangent(p0: [number, number], p1: [number, number], d: number): number[] {
  const x = (p1[0] - p0[0]) / d;
  const y = (p1[1] - p0[1]) / d;
  return [x, y];
}

// eslint-disable-next-line max-statements
export function generateCurveFromControlPoints(
  line: Feature<MultiLineString>
): Feature<LineString> {
  // calculate knots
  const knots = [0];
  let prev: Position[] | null = null;
  let totalDistance = 0;

  const {coordinates: coords} = line.geometry;

  for (let i = 0; i < coords.length; i++) {
    const cur = coords[i];
    if (prev !== null) {
      // @ts-expect-error turf types diff
      totalDistance += turfDistance(prev, cur);
      knots.push(totalDistance);
    }
    prev = cur;
  }

  // calculate tangents
  const tangents: number[][] = [];

  // first tangent
  // @ts-expect-error TODO
  tangents.push(calculateSingleTangent(coords[0], coords[1], knots[1] - knots[0]));

  // second to before last
  for (let i = 1; i < coords.length - 1; i++) {
    // @ts-expect-error TODO
    const A = calculateSingleTangent(coords[i], coords[i + 1], knots[i + 1] - knots[i]);
    // @ts-expect-error TODO
    const B = calculateSingleTangent(coords[i - 1], coords[i], knots[i] - knots[i - 1]);
    const x = (A[0] + B[0]) / 2.0;
    const y = (A[1] + B[1]) / 2.0;
    tangents.push([x, y]);
  }

  // last tangent
  const last = coords.length - 1;
  tangents.push(
    // @ts-expect-error TODO
    calculateSingleTangent(coords[last - 1], coords[last], knots[last] - knots[last - 1])
  );

  // generate curve
  const result: any[] = [];
  for (let i = 0; i < coords.length; i++) {
    // add control point
    result.push(coords[i]);

    // add interpolated values
    for (let t = knots[i] + INTERPOLATION_INTERVAL; t < knots[i + 1]; t += INTERPOLATION_INTERVAL) {
      if (knots[i + 1] - t > INTERPOLATION_THRESHOLD) {
        // Only add if not too close to a control point (knot = control point)
        result.push(hermite(t, coords, tangents, knots));
      }
    }
  }

  return lineString(result);
}
