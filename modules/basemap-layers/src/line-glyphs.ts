// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Glyphs of a label along a line, each placed on the line and turned to the segment it lands on,
 * as MapLibre GL JS's `placeGlyphsAlongLine`, `placeFirstAndLastGlyph` and `placeGlyphAlongLine`
 * (symbol/projection.ts) place them in the label plane. Here the label plane is the map plane at
 * the current zoom: the line, measured in pixels at the placement zoom, is scaled about the anchor.
 *
 * Coordinates are pixels with y pointing down. Angles returned are counter-clockwise on screen, in
 * degrees, as deck.gl's `getAngle` takes them.
 */

/** A line a label is placed along, and where on it the label's anchor lies. */
export type LabelLine = {
  /** The line's vertices, `x, y` pairs in pixels at the placement zoom. */
  points: ArrayLike<number>;
  /** The segment the anchor lies on: from vertex `segment` to `segment + 1`. */
  segment: number;
  /** The anchor's position along that segment, from 0 to 1. */
  t: number;
};

export type LineGlyphOptions = {
  /**
   * Each glyph's advance centre along the label, in pixels at the current zoom, from the anchor
   * (MapLibre's `glyphOffsetArray` times the font scale).
   */
  offsets: ArrayLike<number>;
  /** The label's `text-offset` in pixels: along the line, and across it (MapLibre's `lineOffset`). */
  lineOffsetX?: number;
  lineOffsetY?: number;
  /** Pixels at the current zoom per pixel of `line.points`. */
  scale: number;
  /** Whether the label reads against the line's direction (turned upright). */
  flip: boolean;
};

/** Where each glyph of a label is drawn, from the anchor, and the path its collision follows. */
export type LineGlyphs = {
  /** For each glyph: `dx, dy` in pixels from the anchor, and its angle. */
  glyphs: Float32Array;
  /**
   * The path from the first glyph to the last along the line, `x, y` pairs in pixels from the
   * anchor, as MapLibre builds the collision circles of a label along a line.
   */
  path: number[];
};

type PlacedGlyph = {x: number; y: number; angle: number; path: number[]};

/** The anchor's position and the projected line, relative to the anchor and scaled. */
type Projection = {
  vertex: (index: number) => [number, number];
  count: number;
};

function getProjection(line: LabelLine, scale: number): Projection {
  const {points, segment, t} = line;
  const ax = points[segment * 2] + (points[segment * 2 + 2] - points[segment * 2]) * t;
  const ay = points[segment * 2 + 1] + (points[segment * 2 + 3] - points[segment * 2 + 1]) * t;
  return {
    vertex: index => [(points[index * 2] - ax) * scale, (points[index * 2 + 1] - ay) * scale],
    count: points.length / 2
  };
}

/** `transformToOffsetNormal`: the segment's normal, of length `offset * direction`. */
function getOffsetNormal(
  dx: number,
  dy: number,
  offset: number,
  direction: number
): [number, number] {
  const length = Math.hypot(dx, dy);
  const k = (offset * direction) / length;
  // `Point.perp()` is (-y, x).
  return [-dy * k, dx * k];
}

/** `findLineIntersection`: where lines a1-a2 and b1-b2 meet, or null if parallel. */
function intersectLines(
  a1: number[],
  a2: number[],
  b1: number[],
  b2: number[]
): [number, number] | null {
  const aDx = a2[0] - a1[0];
  const aDy = a2[1] - a1[1];
  const bDx = b2[0] - b1[0];
  const bDy = b2[1] - b1[1];
  const denominator = bDy * aDx - bDx * aDy;
  if (denominator === 0) {
    return null;
  }
  const ua = (bDx * (a1[1] - b1[1]) - bDy * (a1[0] - b1[0])) / denominator;
  return [a1[0] + ua * aDx, a1[1] + ua * aDy];
}

/**
 * `placeGlyphAlongLine`: walks the line from the anchor until the distance travelled equals the
 * glyph's offset, on the line moved `lineOffsetY` across it when that is set. Returns null when the
 * glyph does not fit on the line.
 */
function placeGlyph(
  projection: Projection,
  anchorSegment: number,
  offsetX: number,
  lineOffsetX: number,
  lineOffsetY: number,
  flip: boolean,
  offsets: Map<number, [number, number]>
): PlacedGlyph | null {
  const combinedOffsetX = flip ? offsetX - lineOffsetX : offsetX + lineOffsetX;
  let direction = combinedOffsetX > 0 ? 1 : -1;
  let angle = 0;
  if (flip) {
    direction *= -1;
    angle = Math.PI;
  }
  if (direction < 0) {
    angle += Math.PI;
  }
  let currentIndex = direction > 0 ? anchorSegment : anchorSegment + 1;
  const anchor: [number, number] = [0, 0];
  let currentVertex = anchor;
  let previousVertex = anchor;
  let offsetIntersectionPoint: [number, number] | undefined;
  let offsetPreviousVertex: [number, number] | undefined;
  let distanceFromAnchor = 0;
  let currentSegmentDistance = 0;
  const absOffsetX = Math.abs(combinedOffsetX);
  const path: number[] = [];
  let segmentX = 0;
  let segmentY = 0;

  while (distanceFromAnchor + currentSegmentDistance <= absOffsetX) {
    currentIndex += direction;
    if (currentIndex < 0 || currentIndex >= projection.count) {
      return null;
    }
    distanceFromAnchor += currentSegmentDistance;
    previousVertex = currentVertex;
    offsetPreviousVertex = offsetIntersectionPoint;
    currentVertex = projection.vertex(currentIndex);
    if (lineOffsetY === 0) {
      path.push(previousVertex[0], previousVertex[1]);
      segmentX = currentVertex[0] - previousVertex[0];
      segmentY = currentVertex[1] - previousVertex[1];
    } else {
      let normal: [number, number];
      const dx = currentVertex[0] - previousVertex[0];
      const dy = currentVertex[1] - previousVertex[1];
      if (dx === 0 && dy === 0) {
        // The anchor lies on a vertex: the next segment gives the normal.
        const next = projection.vertex(currentIndex + direction);
        normal = getOffsetNormal(
          next[0] - currentVertex[0],
          next[1] - currentVertex[1],
          lineOffsetY,
          direction
        );
      } else {
        normal = getOffsetNormal(dx, dy, lineOffsetY, direction);
      }
      offsetPreviousVertex ||= [previousVertex[0] + normal[0], previousVertex[1] + normal[1]];
      offsetIntersectionPoint = getOffsetIntersection(
        projection,
        currentIndex,
        normal,
        currentVertex,
        offsetPreviousVertex,
        lineOffsetY,
        direction,
        offsets
      );
      path.push(offsetPreviousVertex[0], offsetPreviousVertex[1]);
      segmentX = offsetIntersectionPoint[0] - offsetPreviousVertex[0];
      segmentY = offsetIntersectionPoint[1] - offsetPreviousVertex[1];
    }
    currentSegmentDistance = Math.hypot(segmentX, segmentY);
  }

  const k = (absOffsetX - distanceFromAnchor) / currentSegmentDistance;
  const start = offsetPreviousVertex || previousVertex;
  const x = start[0] + segmentX * k;
  const y = start[1] + segmentY * k;
  path.push(x, y);
  return {
    x,
    y,
    angle:
      angle +
      Math.atan2(currentVertex[1] - previousVertex[1], currentVertex[0] - previousVertex[0]),
    path
  };
}

/** `findOffsetIntersectionPoint`, with MapLibre's per-vertex cache of offset vertices. */
function getOffsetIntersection(
  projection: Projection,
  index: number,
  normal: [number, number],
  currentVertex: [number, number],
  offsetPreviousVertex: [number, number],
  lineOffsetY: number,
  direction: number,
  offsets: Map<number, [number, number]>
): [number, number] {
  const cached = offsets.get(index);
  if (cached) {
    return cached;
  }
  const offsetCurrentVertex: [number, number] = [
    currentVertex[0] + normal[0],
    currentVertex[1] + normal[1]
  ];
  let result = offsetCurrentVertex;
  const nextIndex = index + direction;
  if (nextIndex >= 0 && nextIndex < projection.count) {
    const next = projection.vertex(nextIndex);
    const nextNormal = getOffsetNormal(
      next[0] - currentVertex[0],
      next[1] - currentVertex[1],
      lineOffsetY,
      direction
    );
    const begin = [currentVertex[0] + nextNormal[0], currentVertex[1] + nextNormal[1]];
    const end = [next[0] + nextNormal[0], next[1] + nextNormal[1]];
    result = intersectLines(offsetPreviousVertex, offsetCurrentVertex, begin, end) || result;
  }
  offsets.set(index, result);
  return result;
}

/** Radians, clockwise on screen with y down, to deck.gl degrees, counter-clockwise. */
function toDeckAngle(radians: number): number {
  return (-radians * 180) / Math.PI;
}

/**
 * Places each glyph of a label along `line`, as MapLibre GL JS draws text along a line. Returns
 * null when the first or the last glyph does not fit on the line: MapLibre then hides the label.
 * `flip` is decided by the caller (see {@link needsFlip}); MapLibre's own flip test is on screen.
 */
export function placeLineGlyphs(line: LabelLine, options: LineGlyphOptions): LineGlyphs | null {
  const {offsets, flip, scale} = options;
  const lineOffsetX = options.lineOffsetX || 0;
  const lineOffsetY = options.lineOffsetY || 0;
  const count = offsets.length;
  const {segment} = line;
  if (
    !count ||
    !(scale > 0) ||
    !(segment >= 0) ||
    segment * 2 + 3 >= line.points.length ||
    !(line.t >= 0 && line.t <= 1)
  ) {
    return null;
  }
  const projection = getProjection(line, scale);
  // MapLibre keeps one cache of offset vertices per label, whichever way a glyph walks: either way
  // the offset vertex is where the same two offset segments meet.
  const offsetVertices = new Map<number, [number, number]>();
  const place = (offsetX: number) =>
    placeGlyph(projection, segment, offsetX, lineOffsetX, lineOffsetY, flip, offsetVertices);
  const first = place(offsets[0]);
  const last = count > 1 ? place(offsets[count - 1]) : first;
  if (!first || !last) {
    return null;
  }
  const glyphs = new Float32Array(count * 3);
  const write = (i: number, glyph: PlacedGlyph) => {
    glyphs[i * 3] = glyph.x;
    glyphs[i * 3 + 1] = glyph.y;
    glyphs[i * 3 + 2] = toDeckAngle(glyph.angle);
  };
  write(0, first);
  for (let i = 1; i < count - 1; i++) {
    const glyph = place(offsets[i]);
    if (!glyph) {
      return null;
    }
    write(i, glyph);
  }
  write(count - 1, last);
  // The collision path: the first glyph's path reversed, then the last glyph's, without the anchor
  // each starts from (MapLibre's `placeCollisionCircles`).
  const path: number[] = [];
  for (let i = first.path.length - 2; i >= 2; i -= 2) {
    path.push(first.path[i], first.path[i + 1]);
  }
  for (let i = 2; i < last.path.length; i += 2) {
    path.push(last.path[i], last.path[i + 1]);
  }
  return {glyphs, path};
}

/**
 * MapLibre's `requiresOrientationChange` for horizontal text: whether a label placed unflipped reads
 * right to left on screen, its first glyph right of its last, on a flat map turned by `bearing`.
 */
export function needsFlip(unflipped: LineGlyphs, bearing: number): boolean {
  const {glyphs} = unflipped;
  const n = glyphs.length / 3;
  const dx = glyphs[(n - 1) * 3] - glyphs[0];
  const dy = glyphs[(n - 1) * 3 + 1] - glyphs[1];
  // A direction of the map plane is drawn turned counter-clockwise by the bearing on screen, as in
  // `getUprightAngle`: the chord's x on screen.
  const radians = (bearing * Math.PI) / 180;
  const x = dx * Math.cos(radians) + dy * Math.sin(radians);
  return x < 0;
}

/**
 * Collision circles along a path on screen, as MapLibre GL JS's `placeCollisionCircles` lays them
 * out with its `PathInterpolator`: the path's ends inset by a quarter radius, circles at most 2.5
 * radii apart, and one circle on a path shorter than half a radius (or at the middle of the path
 * for a radius of 0). Returns `x, y, radius` triples.
 */
export function getPathCircles(path: ArrayLike<number>, radius: number): number[] {
  const count = path.length / 2;
  if (!count) {
    return [];
  }
  const distances = [0];
  for (let i = 1; i < count; i++) {
    distances[i] =
      distances[i - 1] +
      Math.hypot(path[i * 2] - path[i * 2 - 2], path[i * 2 + 1] - path[i * 2 - 1]);
  }
  const length = distances[count - 1];
  const padding = Math.min(radius * 0.25, length * 0.5);
  const paddedLength = length - padding * 2;
  // A label without height has one circle, at the middle of its path.
  const circleCount =
    !(radius > 0) || length <= 0.5 * radius ? 1 : Math.ceil(paddedLength / (radius * 2.5)) + 1;
  const circles: number[] = [];
  for (let k = 0; k < circleCount; k++) {
    const t = circleCount === 1 && !(radius > 0) ? 0.5 : k / Math.max(circleCount - 1, 1);
    if (count === 1) {
      circles.push(path[0], path[1], radius);
      continue;
    }
    const target = t * paddedLength + padding;
    let index = 1;
    while (distances[index] < target && index < count - 1) {
      index++;
    }
    const segment = distances[index] - distances[index - 1];
    const u = segment > 0 ? (target - distances[index - 1]) / segment : 0;
    circles.push(
      path[index * 2 - 2] * (1 - u) + path[index * 2] * u,
      path[index * 2 - 1] * (1 - u) + path[index * 2 + 1] * u,
      radius
    );
  }
  return circles;
}
