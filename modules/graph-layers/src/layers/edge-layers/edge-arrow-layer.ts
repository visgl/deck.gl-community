// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';

import {Arrow2DGeometry} from './arrow-2d-geometry';

const DEFAULT_ARROW_GEOMETRY = new Arrow2DGeometry({length: 1, headSize: 0.35, tailWidth: 0.12});

type LayoutInfo = {
  sourcePosition: number[];
  targetPosition: number[];
  controlPoints?: number[][];
};

const DEFAULT_Z = 0;

function resolveSize(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric !== 0 ? numeric : 1;
}

function getOffsetComponents(offset: unknown): {along: number; perpendicular: number} {
  if (!Array.isArray(offset)) {
    return {along: 0, perpendicular: 0};
  }
  const along = Number(offset[0]);
  const perpendicular = Number(offset[1]);
  return {
    along: Number.isFinite(along) ? along : 0,
    perpendicular: Number.isFinite(perpendicular) ? perpendicular : 0
  };
}

export function isEdgeDirected(edge: any): boolean {
  if (!edge) {
    return false;
  }
  if (typeof edge.isDirected === 'function') {
    return Boolean(edge.isDirected());
  }
  if (typeof edge.directed === 'boolean') {
    return edge.directed;
  }
  return false;
}

function normalizeVector(vector: number[]): number[] {
  const length = Math.hypot(vector[0] ?? 0, vector[1] ?? 0, vector[2] ?? 0);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [(vector[0] ?? 0) / length, (vector[1] ?? 0) / length, (vector[2] ?? 0) / length];
}

function getTerminalDirection({sourcePosition, targetPosition, controlPoints = []}: LayoutInfo): {
  target: number[];
  direction: number[];
} {
  const anchor = controlPoints.length ? controlPoints[controlPoints.length - 1] : sourcePosition;
  const direction = [
    (targetPosition[0] ?? 0) - (anchor?.[0] ?? 0),
    (targetPosition[1] ?? 0) - (anchor?.[1] ?? 0),
    (targetPosition[2] ?? DEFAULT_Z) - (anchor?.[2] ?? DEFAULT_Z)
  ];
  return {target: targetPosition, direction};
}

export function getArrowTransform({
  layout,
  size,
  offset = null
}: {
  layout: LayoutInfo;
  size: number;
  offset?: number[] | null;
}): {position: [number, number, number]; angle: number} {
  const {target, direction} = getTerminalDirection(layout);
  const unit = normalizeVector(direction);

  const hasDirection = unit[0] !== 0 || unit[1] !== 0 || unit[2] !== 0;
  const resolvedSize = resolveSize(size);
  const basePosition: [number, number, number] = [
    target[0] ?? 0,
    target[1] ?? 0,
    target[2] ?? DEFAULT_Z
  ];

  if (!hasDirection) {
    return {position: basePosition, angle: 0};
  }

  const {along, perpendicular} = getOffsetComponents(offset);
  const alongDistance = resolvedSize * 0.5 + along;
  const position: [number, number, number] = [
    basePosition[0] - unit[0] * alongDistance,
    basePosition[1] - unit[1] * alongDistance,
    basePosition[2] - unit[2] * alongDistance
  ];

  if (perpendicular) {
    const perp = [-unit[1], unit[0], 0];
    position[0] += perp[0] * perpendicular;
    position[1] += perp[1] * perpendicular;
    position[2] += perp[2] * perpendicular;
  }

  const angle = (Math.atan2(unit[1], unit[0]) * 180) / Math.PI;

  return {position, angle};
}

export class EdgeArrowLayer extends CompositeLayer {
  static layerName = 'EdgeArrowLayer';

  renderLayers() {
    const {data, getLayoutInfo, positionUpdateTrigger = 0, stylesheet} = this.props as any;
    const directedEdges = (data || []).filter(isEdgeDirected);

    if (!directedEdges.length) {
      return [];
    }

    const {getColor, getSize, getOffset} = stylesheet.getDeckGLAccessors();
    const updateTriggers = stylesheet.getDeckGLUpdateTriggers();

    return [
      new SimpleMeshLayer(
        this.getSubLayerProps({
          id: '__edge-arrow-layer',
          data: directedEdges,
          mesh: DEFAULT_ARROW_GEOMETRY,
          getColor,
          getScale: (edge) => {
            const size = resolveSize(getSize(edge));
            return [size, size, size];
          },
          getOrientation: (edge) => {
            const layout = getLayoutInfo(edge);
            const size = resolveSize(getSize(edge));
            const offset = getOffset ? getOffset(edge) : null;
            const {angle} = getArrowTransform({layout, size, offset});
            return [0, -angle, 0];
          },
          getPosition: (edge) => {
            const layout = getLayoutInfo(edge);
            const size = resolveSize(getSize(edge));
            const offset = getOffset ? getOffset(edge) : null;
            const {position} = getArrowTransform({layout, size, offset});
            return position;
          },
          parameters: {
            depthTest: false
          },
          updateTriggers: {
            getColor: updateTriggers.getColor,
            getScale: updateTriggers.getSize,
            getOrientation: [
              positionUpdateTrigger,
              updateTriggers.getSize,
              updateTriggers.getOffset
            ],
            getPosition: [positionUpdateTrigger, updateTriggers.getSize, updateTriggers.getOffset]
          }
        })
      )
    ];
  }
}
