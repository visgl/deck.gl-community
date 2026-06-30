// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createIterable} from '@deck.gl/core';
import {Vector2} from '@math.gl/core';

import type {Accessor, AccessorContext, AccessorFunction, Position} from '@deck.gl/core';
import type {NumericArray} from '@math.gl/core';

/** Path positions accepted by dependency marker helpers. */
export type PathGeometry = Position[] | NumericArray;
type PathAccessor<DataT> = AccessorFunction<DataT, PathGeometry>;
/** Accessor context passed while resolving dependency marker placements. */
export type MarkerPlacementsAccessorContext<DataT> = AccessorContext<DataT> & {
  /** Total resolved dependency path length. */
  lineLength: number;
};
/** Accessor that resolves dependency marker direction for one datum. */
export type PathDirectionAccessor<DataT> = Accessor<DataT, PathDirection>;
/** Accessor that resolves marker placements along one dependency path. */
export type MarkerPlacementsAccessor<DataT> =
  | number[]
  | ((datum: DataT, context: MarkerPlacementsAccessorContext<DataT>) => number[]);

/** One marker placement resolved along a dependency path. */
export interface PathMarker<DataT> {
  /** Segment start used to orient the marker. */
  source: Position;
  /** Segment end used to orient the marker. */
  target: Position;
  /** Marker ratio within the resolved segment. */
  percentage: number;
  /** Original source datum used for picking and accessor forwarding. */
  __source: {
    /** Original source datum. */
    object: DataT;
    /** Original source datum index. */
    index: number;
  };
}

/** Directions in which dependency markers may be rendered. */
export enum PathDirection {
  /** Do not render dependency markers. */
  NONE = 0,
  /** Render markers from source to target. */
  FORWARD = 1,
  /** Render markers from target to source. */
  BACKWARD = 2,
  /** Render markers in both directions. */
  BOTH = 3
}

/**
 * Resolves directional marker placements for dependency path data.
 * @param options - Marker resolution options.
 * @param options.data - Dependency path data to inspect.
 * @param options.getPath - Accessor returning nested or flat path coordinates.
 * @param options.positionSize - Number of coordinate values in one flat path position.
 * @param options.getDirection - Accessor returning marker direction flags.
 * @param options.getMarkerPlacements - Accessor returning path ratios for marker placement.
 * @param options.mode - Routing mode used by the dependency line.
 * @returns Marker placements resolved against each dependency path.
 */
export function createPathMarkers<DataT>({
  data,
  getPath,
  positionSize,
  getDirection,
  getMarkerPlacements,
  mode
}: {
  data: Iterable<DataT>;
  getPath: PathAccessor<DataT>;
  positionSize: number;
  getDirection: PathDirectionAccessor<DataT>;
  getMarkerPlacements: MarkerPlacementsAccessor<DataT>;
  mode: 'line' | 'arc' | 'path';
}): PathMarker<DataT>[] {
  const markers: PathMarker<DataT>[] = [];
  if (!data || typeof data === 'string' || !(Symbol.iterator in Object(data))) {
    return markers;
  }

  const {iterable, objectInfo} = createIterable(data) as {
    iterable: Iterable<DataT>;
    objectInfo: MarkerPlacementsAccessorContext<DataT>;
  };

  for (const object of iterable) {
    objectInfo.index++;
    const path = normalizePath(getPath(object, objectInfo), positionSize);
    if (path.length < 2) {
      continue;
    }
    if (mode !== 'path') {
      path.splice(1, path.length - 2);
    }
    const direction =
      typeof getDirection === 'function' ? getDirection(object, objectInfo) : getDirection;

    // calculate total length
    const lineLength = getLineLength(path);
    if (!Number.isFinite(lineLength) || lineLength <= 0) {
      continue;
    }
    objectInfo.lineLength = lineLength;
    const placements =
      typeof getMarkerPlacements === 'function'
        ? getMarkerPlacements(object, objectInfo)
        : getMarkerPlacements;

    const sourceObject = {object, index: objectInfo.index};

    // Create the markers
    for (const dir of [PathDirection.FORWARD, PathDirection.BACKWARD]) {
      if (!(direction & dir)) continue;
      if (dir === PathDirection.BACKWARD) {
        path.reverse();
      }
      for (const percentage of placements) {
        const marker =
          mode === 'arc'
            ? ({
                source: path[0] as unknown as Position,
                target: path[1] as unknown as Position,
                percentage,
                __source: sourceObject
              } satisfies PathMarker<DataT>)
            : createMarkerAlongPath({
                path,
                percentage,
                lineLength,
                sourceObject
              });
        markers.push(marker);
      }
    }
  }

  return markers;
}

function normalizePath(path: PathGeometry, size: number): Vector2[] {
  if (!path) {
    return [];
  }
  if (Array.isArray(path[0])) {
    return (path as NumericArray[]).map(([x, y]) => new Vector2(x, y));
  }
  const flatPath = path as NumericArray;
  const length = flatPath.length / size;
  const points: Vector2[] = new Array(length);
  for (let i = 0; i < length; i++) {
    points[i] = new Vector2(flatPath[i * size], flatPath[i * size + 1]);
  }
  return points;
}

function getLineLength(vPoints: Vector2[]): number {
  // calculate total length
  let lineLength = 0;
  for (let i = 0; i < vPoints.length - 1; i++) {
    lineLength += vPoints[i]!.distance(vPoints[i + 1]!);
  }
  return lineLength;
}

function createMarkerAlongPath<DataT>({
  path,
  percentage,
  lineLength,
  sourceObject
}: {
  path: Vector2[];
  percentage: number;
  lineLength: number;
  sourceObject: PathMarker<DataT>['__source'];
}): PathMarker<DataT> {
  const distanceAlong = lineLength * percentage;
  let currentDistance = 0;
  let previousDistance = 0;
  let i = 0;
  for (i = 0; i < path.length - 1; i++) {
    currentDistance += path[i]!.distance(path[i + 1]!);
    if (currentDistance >= distanceAlong) {
      break;
    }
    previousDistance = currentDistance;
  }

  // If reached the end of the loop without exiting early,
  // undo the final increment to avoid a null-pointer exception
  if (i === path.length - 1) {
    i -= 1;
  }

  const along = distanceAlong - previousDistance;
  const segmentLength = path[i + 1]!.distance(path[i]!);

  return {
    source: path[i] as unknown as Position,
    target: path[i + 1]! as unknown as Position,
    percentage: segmentLength > 0 ? along / segmentLength : 0,
    __source: sourceObject
  };
}
