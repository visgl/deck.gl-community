// The pole-of-inaccessibility search follows mapbox/polylabel (ISC License,
// Copyright (c) 2016 Mapbox), which MapLibre uses to place point labels on polygons.

type Cell = {
  /** Cell center. */
  x: number;
  y: number;
  /** Half the cell size. */
  half: number;
  /** Signed distance from the cell center to the polygon outline: positive inside. */
  distance: number;
  /** Largest distance any point in the cell can reach. */
  max: number;
};

/**
 * Returns the point inside a polygon farthest from its outline, to within `precision` in the
 * polygon's units. `polygon` is GeoJSON-style: an outer ring followed by hole rings. Coordinates
 * must be planar. Returns null for a polygon without vertices.
 */
export function getPoleOfInaccessibility(
  polygon: number[][][],
  precision: number
): [number, number] | null {
  const outer = polygon[0];
  if (!outer || outer.length === 0) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const cellSize = Math.min(width, height);
  if (cellSize === 0) {
    return [minX, minY];
  }

  const queue = new CellQueue();
  const half = cellSize / 2;
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      queue.push(createCell(x + half, y + half, half, polygon));
    }
  }

  // Start from the centroid, or the bounding box center when that is better.
  let best = getCentroidCell(polygon);
  const boxCell = createCell(minX + width / 2, minY + height / 2, 0, polygon);
  if (boxCell.distance > best.distance) {
    best = boxCell;
  }

  let cell = queue.pop();
  while (cell) {
    if (cell.distance > best.distance) {
      best = cell;
    }
    // Split the cell only if it can hold a meaningfully better point.
    if (cell.max - best.distance > precision) {
      const quarter = cell.half / 2;
      queue.push(createCell(cell.x - quarter, cell.y - quarter, quarter, polygon));
      queue.push(createCell(cell.x + quarter, cell.y - quarter, quarter, polygon));
      queue.push(createCell(cell.x - quarter, cell.y + quarter, quarter, polygon));
      queue.push(createCell(cell.x + quarter, cell.y + quarter, quarter, polygon));
    }
    cell = queue.pop();
  }

  return [best.x, best.y];
}

function createCell(x: number, y: number, half: number, polygon: number[][][]): Cell {
  const distance = getSignedDistance(x, y, polygon);
  return {x, y, half, distance, max: distance + half * Math.SQRT2};
}

/** Signed distance from a point to the polygon's rings: positive inside, negative outside. */
function getSignedDistance(x: number, y: number, polygon: number[][][]): number {
  let inside = false;
  let minDistanceSquared = Infinity;

  for (const ring of polygon) {
    for (let i = 0, length = ring.length, j = length - 1; i < length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
        inside = !inside;
      }
      minDistanceSquared = Math.min(minDistanceSquared, getSegmentDistanceSquared(x, y, a, b));
    }
  }

  return minDistanceSquared === 0 ? 0 : (inside ? 1 : -1) * Math.sqrt(minDistanceSquared);
}

function getSegmentDistanceSquared(px: number, py: number, a: number[], b: number[]): number {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}

function getCentroidCell(polygon: number[][][]): Cell {
  const ring = polygon[0];
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, length = ring.length, j = length - 1; i < length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const f = a[0] * b[1] - b[0] * a[1];
    x += (a[0] + b[0]) * f;
    y += (a[1] + b[1]) * f;
    area += f * 3;
  }
  return area === 0
    ? createCell(ring[0][0], ring[0][1], 0, polygon)
    : createCell(x / area, y / area, 0, polygon);
}

/** A binary max-heap of cells ordered by `max`. */
class CellQueue {
  private cells: Cell[] = [];

  push(cell: Cell): void {
    const {cells} = this;
    cells.push(cell);
    let index = cells.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (cells[parent].max >= cell.max) {
        break;
      }
      cells[index] = cells[parent];
      index = parent;
    }
    cells[index] = cell;
  }

  pop(): Cell | undefined {
    const {cells} = this;
    const top = cells[0];
    const last = cells.pop();
    if (cells.length > 0 && last) {
      let index = 0;
      const length = cells.length;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let largest = index;
        let largestMax = last.max;
        if (left < length && cells[left].max > largestMax) {
          largest = left;
          largestMax = cells[left].max;
        }
        if (right < length && cells[right].max > largestMax) {
          largest = right;
        }
        if (largest === index) {
          break;
        }
        cells[index] = cells[largest];
        index = largest;
      }
      cells[index] = last;
    }
    return top;
  }
}
