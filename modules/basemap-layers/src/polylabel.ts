// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Point labels on polygons sit at the polygon's pole of inaccessibility: the interior point
// farthest from the outline. MapLibre places them there too. This file finds that point with the
// grid refinement of Garcia-Castellanos and Lombardo, "Poles of inaccessibility: a calculation
// algorithm for the remotest places on Earth" (Scottish Geographical Journal 123(3), 2007),
// in its best-first form: candidate squares wait in a priority queue, ordered by the largest
// distance any point in them could have, and a square is split into four only while it could
// still beat the best point found by more than the precision.
//
// Tile geometry is untrusted input, so the search is bounded by the work it does. Scoring one
// candidate costs one point-to-segment distance test per polygon vertex. The search counts those
// tests against a budget, and returns the best point found when the budget runs out. A caller
// can share one budget across all polygons of a tile, so a tile with many large polygons cannot
// hold the main thread either. The first grid also has at most MAX_GRID_CELLS_PER_AXIS squares
// along the longer side, and the precision has a floor relative to the polygon's size.

const MAX_GRID_CELLS_PER_AXIS = 64;
const MIN_RELATIVE_PRECISION = 1e-6;
/** Default budget for one search: point-to-segment distance tests. */
export const DEFAULT_POLE_SEARCH_SEGMENT_TESTS = 5e6;

/** Remaining work, in point-to-segment distance tests, shared by the searches that use it. */
export type PoleSearchBudget = {
  segmentTests: number;
};

/**
 * Returns the point inside a polygon farthest from its outline, to within `precision` in the
 * polygon's units. `polygon` is GeoJSON-style: an outer ring followed by hole rings. Coordinates
 * must be planar.
 *
 * The search spends at most `budget.segmentTests` point-to-segment distance tests and deducts
 * what it spends, so one budget can bound several searches. When the budget runs out the best
 * point found so far is returned. Returns null for a polygon without vertices, with a non-finite
 * coordinate, or when the budget cannot pay for the first scored point.
 */
export function getPoleOfInaccessibility(
  polygon: number[][][],
  precision: number,
  budget: PoleSearchBudget = {segmentTests: DEFAULT_POLE_SEARCH_SEGMENT_TESTS}
): [number, number] | null {
  const outline = polygon[0];
  if (!outline || outline.length === 0) {
    return null;
  }
  const vertexCount = countFiniteVertices(polygon);
  if (vertexCount < 0) {
    return null;
  }

  const box = getRingBox(outline);
  const width = box.right - box.left;
  const height = box.top - box.bottom;
  if (width === 0 || height === 0) {
    return [box.left, box.bottom];
  }
  const longSide = Math.max(width, height);
  const tolerance = Math.max(
    Number.isFinite(precision) && precision > 0 ? precision : 0,
    longSide * MIN_RELATIVE_PRECISION
  );

  const search = new PoleSearch(polygon, vertexCount, budget);

  // Two cheap first guesses: the area centroid, which is inside most convex-ish shapes, and the
  // middle of the bounding box.
  const [centroidX, centroidY] = getAreaCentroid(polygon[0]);
  if (!search.score(centroidX, centroidY, 0)) {
    return null;
  }
  if (!search.score(box.left + width / 2, box.bottom + height / 2, 0)) {
    return search.bestPoint();
  }

  // The first grid uses squares as wide as the polygon's short side, so a long, thin polygon is
  // covered by squares that fit it. The cap keeps a sliver from starting with millions of them.
  const side = Math.max(Math.min(width, height), longSide / MAX_GRID_CELLS_PER_AXIS);
  const columns = Math.ceil(width / side);
  const rows = Math.ceil(height / side);
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const x = box.left + (column + 0.5) * side;
      const y = box.bottom + (row + 0.5) * side;
      if (!search.score(x, y, side / 2)) {
        return search.bestPoint();
      }
    }
  }

  search.refine(tolerance);
  return search.bestPoint();
}

/** Returns the number of vertices in all rings, or -1 if any coordinate is not finite. */
function countFiniteVertices(polygon: number[][][]): number {
  let count = 0;
  for (const ring of polygon) {
    for (const point of ring) {
      if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        return -1;
      }
    }
    count += ring.length;
  }
  return count;
}

function getRingBox(ring: number[][]): {left: number; bottom: number; right: number; top: number} {
  let left = Infinity;
  let bottom = Infinity;
  let right = -Infinity;
  let top = -Infinity;
  for (const point of ring) {
    left = Math.min(left, point[0]);
    right = Math.max(right, point[0]);
    bottom = Math.min(bottom, point[1]);
    top = Math.max(top, point[1]);
  }
  return {left, bottom, right, top};
}

/** The centroid of the area a ring encloses, or its first vertex when that area is zero. */
function getAreaCentroid(ring: number[][]): [number, number] {
  let twiceArea = 0;
  let sumX = 0;
  let sumY = 0;
  let previous = ring[ring.length - 1];
  for (const current of ring) {
    const cross = previous[0] * current[1] - current[0] * previous[1];
    twiceArea += cross;
    sumX += (previous[0] + current[0]) * cross;
    sumY += (previous[1] + current[1]) * cross;
    previous = current;
  }
  if (twiceArea === 0) {
    return [ring[0][0], ring[0][1]];
  }
  return [sumX / (3 * twiceArea), sumY / (3 * twiceArea)];
}

/**
 * The state of one search: the best point so far and a max-heap of candidate squares. The
 * squares are kept in parallel arrays, and the heap holds their indices, ordered by `reach`.
 */
class PoleSearch {
  private readonly polygon: number[][][];
  private readonly vertexCount: number;
  private readonly budget: PoleSearchBudget;

  private readonly centerX: number[] = [];
  private readonly centerY: number[] = [];
  private readonly halfSide: number[] = [];
  /** The largest distance to the outline that any point of the square can have. */
  private readonly reach: number[] = [];
  private readonly heap: number[] = [];

  private bestX = NaN;
  private bestY = NaN;
  private bestDistance = -Infinity;

  constructor(polygon: number[][][], vertexCount: number, budget: PoleSearchBudget) {
    this.polygon = polygon;
    this.vertexCount = vertexCount;
    this.budget = budget;
  }

  bestPoint(): [number, number] {
    return [this.bestX, this.bestY];
  }

  /**
   * Scores the square centered at (x, y), keeps its center if it is the best so far, and queues
   * the square if it has area. Returns false, without scoring, when the budget cannot pay.
   */
  score(x: number, y: number, half: number): boolean {
    if (this.budget.segmentTests < this.vertexCount) {
      return false;
    }
    this.budget.segmentTests -= this.vertexCount;
    const distance = getSignedOutlineDistance(this.polygon, x, y);
    if (distance > this.bestDistance) {
      this.bestX = x;
      this.bestY = y;
      this.bestDistance = distance;
    }
    if (half > 0) {
      // No point in the square is farther from the center than half its diagonal.
      this.enqueue(x, y, half, distance + half * Math.SQRT2);
    }
    return true;
  }

  /** Splits the most promising squares until none can beat the best point by `tolerance`. */
  refine(tolerance: number): void {
    while (this.heap.length > 0) {
      const index = this.dequeue();
      if (this.reach[index] - this.bestDistance <= tolerance) {
        // The heap is ordered by reach, so no remaining square can do better either.
        return;
      }
      const quarter = this.halfSide[index] / 2;
      const x = this.centerX[index];
      const y = this.centerY[index];
      if (
        !this.score(x - quarter, y - quarter, quarter) ||
        !this.score(x + quarter, y - quarter, quarter) ||
        !this.score(x - quarter, y + quarter, quarter) ||
        !this.score(x + quarter, y + quarter, quarter)
      ) {
        return;
      }
    }
  }

  private enqueue(x: number, y: number, half: number, reach: number): void {
    const index = this.reach.length;
    this.centerX.push(x);
    this.centerY.push(y);
    this.halfSide.push(half);
    this.reach.push(reach);

    const {heap} = this;
    let slot = heap.length;
    heap.push(index);
    while (slot > 0) {
      const parentSlot = (slot - 1) >> 1;
      if (this.reach[heap[parentSlot]] >= reach) {
        break;
      }
      heap[slot] = heap[parentSlot];
      slot = parentSlot;
    }
    heap[slot] = index;
  }

  private dequeue(): number {
    const {heap, reach} = this;
    const top = heap[0];
    const moved = heap.pop() as number;
    const size = heap.length;
    if (size === 0) {
      return top;
    }
    let slot = 0;
    for (;;) {
      let next = slot * 2 + 1;
      if (next >= size) {
        break;
      }
      if (next + 1 < size && reach[heap[next + 1]] > reach[heap[next]]) {
        next += 1;
      }
      if (reach[heap[next]] <= reach[moved]) {
        break;
      }
      heap[slot] = heap[next];
      slot = next;
    }
    heap[slot] = moved;
    return top;
  }
}

/**
 * Distance from (x, y) to the nearest edge of any ring: positive inside the polygon, negative
 * outside, and 0 on an edge. Inside is decided by the even-odd rule, so holes count as outside.
 */
function getSignedOutlineDistance(polygon: number[][][], x: number, y: number): number {
  let nearestSquared = Infinity;
  let crossings = 0;
  for (const ring of polygon) {
    let start = ring[ring.length - 1];
    for (const end of ring) {
      // Count edges that cross the horizontal ray from (x, y) toward +x.
      if (start[1] <= y !== end[1] <= y) {
        const t = (y - start[1]) / (end[1] - start[1]);
        if (start[0] + t * (end[0] - start[0]) > x) {
          crossings++;
        }
      }
      nearestSquared = Math.min(nearestSquared, getSquaredSegmentDistance(x, y, start, end));
      start = end;
    }
  }
  if (nearestSquared === 0) {
    return 0;
  }
  const distance = Math.sqrt(nearestSquared);
  return crossings % 2 === 1 ? distance : -distance;
}

/** Squared distance from (x, y) to the segment from `start` to `end`. */
function getSquaredSegmentDistance(x: number, y: number, start: number[], end: number[]): number {
  const edgeX = end[0] - start[0];
  const edgeY = end[1] - start[1];
  const lengthSquared = edgeX * edgeX + edgeY * edgeY;
  // Where the perpendicular from (x, y) meets the edge's line, as a fraction of the edge.
  const along =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - start[0]) * edgeX + (y - start[1]) * edgeY) / lengthSquared));
  const offsetX = start[0] + along * edgeX - x;
  const offsetY = start[1] + along * edgeY - y;
  return offsetX * offsetX + offsetY * offsetY;
}
