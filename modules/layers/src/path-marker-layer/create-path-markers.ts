// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Vector2} from '@math.gl/core';

import type {Color, Position} from '@deck.gl/core';

export type {Color, Position};

/** Direction flags supported by {@link PathMarkerLayer}. */
export type PathMarkerDirection = {
  forward?: boolean;
  backward?: boolean;
};

/** One directional marker resolved against a path segment. */
export interface PathMarker<DataT = unknown> {
  /** Marker anchor position retained for legacy custom `MarkerLayer` implementations. */
  position: Position;
  /** Marker angle in screen-space degrees retained for legacy custom `MarkerLayer` implementations. */
  angle: number;
  /** Marker color. */
  color: Color;
  /** Original source datum. */
  object: DataT;
  /** Original source datum index. */
  index: number;
  /** Source metadata used by deck.gl composite-layer accessor forwarding. */
  __source: {
    object: DataT;
    index: number;
  };
  /** Path segment start used by the default pixel-sized marker layer. */
  source: Position;
  /** Path segment end used by the default pixel-sized marker layer. */
  target: Position;
  /** Marker ratio within the source/target segment. */
  percentage: number;
}

type ProjectFlat = (position: Position) => [number, number] | number[];
type AccessorValue<DataT, ValueT> = ValueT | ((datum: DataT, context: {index: number}) => ValueT);

const DEFAULT_COLOR: Color = [0, 0, 0, 255];
const DEFAULT_DIRECTION: Required<PathMarkerDirection> = {forward: true, backward: false};

export function createPathMarkers<DataT>({
  data,
  getPath = (x: any) => x.path,
  getDirection = (x: any) => x.direction,
  getColor = () => DEFAULT_COLOR,
  getMarkerPercentages = () => [0.5],
  projectFlat
}: {
  data: Iterable<DataT>;
  getPath?: AccessorValue<DataT, Position[]>;
  getDirection?: (datum: DataT, context: {index: number}) => PathMarkerDirection | null | undefined;
  getColor?: AccessorValue<DataT, Color>;
  getMarkerPercentages?: (datum: DataT, context: {index: number; lineLength: number}) => number[];
  projectFlat: ProjectFlat;
}): PathMarker<DataT>[] {
  const markers: PathMarker<DataT>[] = [];
  if (!data || typeof data === 'string' || !(Symbol.iterator in Object(data))) {
    return markers;
  }

  let index = -1;
  for (const object of data) {
    index++;
    const context = {index};
    const path = resolveAccessor(getPath, object, context);
    if (!path || path.length < 2) {
      continue;
    }

    const projectedPath = path.map(position => new Vector2(projectFlat(position)));
    const lineLength = getLineLength(projectedPath);
    if (!Number.isFinite(lineLength) || lineLength <= 0) {
      continue;
    }

    const direction = getDirection(object, context) ?? DEFAULT_DIRECTION;
    const color = resolveAccessor(getColor, object, context);
    const markerContext = {index, lineLength};
    const percentages = getMarkerPercentages(object, markerContext);

    for (const percentage of percentages) {
      if (direction.forward) {
        markers.push(
          createMarkerAlongPath({
            path,
            projectedPath,
            percentage,
            lineLength,
            color,
            object,
            index
          })
        );
      }

      if (direction.backward) {
        markers.push(
          createMarkerAlongPath({
            path: path.slice().reverse(),
            projectedPath: projectedPath.slice().reverse(),
            percentage,
            lineLength,
            color,
            object,
            index
          })
        );
      }
    }
  }

  return markers;
}

function resolveAccessor<DataT, ValueT>(
  accessor: AccessorValue<DataT, ValueT>,
  datum: DataT,
  context: {index: number}
): ValueT {
  return typeof accessor === 'function'
    ? (accessor as (datum: DataT, context: {index: number}) => ValueT)(datum, context)
    : accessor;
}

function getLineLength(points: Vector2[]): number {
  let lineLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    lineLength += points[i]!.distance(points[i + 1]!);
  }
  return lineLength;
}

function createMarkerAlongPath<DataT>({
  path,
  projectedPath,
  percentage,
  lineLength,
  color,
  object,
  index
}: {
  path: Position[];
  projectedPath: Vector2[];
  percentage: number;
  lineLength: number;
  color: Color;
  object: DataT;
  index: number;
}): PathMarker<DataT> {
  const distanceAlong = lineLength * percentage;
  let currentDistance = 0;
  let previousDistance = 0;
  let segmentIndex = 0;

  for (segmentIndex = 0; segmentIndex < projectedPath.length - 1; segmentIndex++) {
    currentDistance += projectedPath[segmentIndex]!.distance(projectedPath[segmentIndex + 1]!);
    if (currentDistance >= distanceAlong) {
      break;
    }
    previousDistance = currentDistance;
  }

  if (segmentIndex === projectedPath.length - 1) {
    segmentIndex -= 1;
  }

  const segmentLength = projectedPath[segmentIndex + 1]!.distance(projectedPath[segmentIndex]!);
  const segmentPercentage =
    segmentLength > 0 ? (distanceAlong - previousDistance) / segmentLength : 0;
  const source = path[segmentIndex]!;
  const target = path[segmentIndex + 1]!;
  const position = interpolatePosition(source, target, segmentPercentage);
  const projectedDirection = projectedPath[segmentIndex + 1]!.clone().subtract(
    projectedPath[segmentIndex]!
  );
  const angle = (projectedDirection.verticalAngle() * 180) / Math.PI;

  return {
    position,
    angle,
    color,
    object,
    index,
    __source: {object, index},
    source,
    target,
    percentage: segmentPercentage
  };
}

function interpolatePosition(source: Position, target: Position, percentage: number): Position {
  const z = (source[2] ?? 0) + ((target[2] ?? 0) - (source[2] ?? 0)) * percentage;

  return [
    source[0] + (target[0] - source[0]) * percentage,
    source[1] + (target[1] - source[1]) * percentage,
    z
  ];
}
