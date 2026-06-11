// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Feature, Polygon} from 'geojson';
import {Position} from '../utils/geojson-types';

/** Given 3 positions compute cross product of vectors (q-p) and (r-p)
 * @param p start of directed line segment
 * @param q end of directed line segment
 * @param r position being tested
 * @returns positive num if r is left, negative if right, 0 if collienar with p-q
 */
export function orientation(p: Position, q: Position, r: Position): number {
  return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
}

/** Check if two line segments intersect given 4 points - segment1(p1,p2), segment2(p3,p4)
 * Are p3→ p4 on opposite sides of line p1→ p2? And p1→ p2 on opposite sides of p3→ p4?
 * If both yes then the segments cross, not just touch
 * @param p1 start segment 1
 * @param p2 end segment 1
 * @param p3 start segment 2
 * @param p4 end segment 2
 * @returns true if segements intersect - false if non-intersecting
 */
export function segmentsIntersect(p1: Position, p2: Position, p3: Position, p4: Position): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Check if two polygons have intersecting edges and returns true for intersection
 * @param featureA polygon feature
 * @param featureB polyfon feature
 * @returns true if intersection
 */
export function polygonEdgesIntersect(
  featureA: Feature<Polygon>,
  featureB: Feature<Polygon>
): boolean {
  const ringA = featureA.geometry.coordinates[0];
  const ringB = featureB.geometry.coordinates[0];
  for (let i = 0; i < ringA.length - 1; i++) {
    for (let j = 0; j < ringB.length - 1; j++) {
      if (segmentsIntersect(ringA[i], ringA[i + 1], ringB[j], ringB[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

/** Check if point in polygon using standard ray casting algorithm
 * @param point the position to test
 * @param ring the polygon to test
 * @returns true if point inside polygon
 */
export function pointInPolygon(point: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Uses pointInPolygon() to check if one polygon is inside another
 * @param featureA inner polygon
 * @param featureB outer polygon
 * @returns true if featureA is inside of featureB
 */
export function polygonWithinPolygon(
  featureA: Feature<Polygon>,
  featureB: Feature<Polygon>
): boolean {
  const inner = featureA.geometry.coordinates[0];
  const outer = featureB.geometry.coordinates[0];
  for (const p of inner) {
    if (!pointInPolygon(p, outer)) return false;
  }
  return true;
}
