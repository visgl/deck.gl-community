// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {GraphEngine} from '../core/graph-engine';
import type {Node} from '../graph/node';

import {Stylesheet} from '../style/style-sheet';
import {NODE_TYPE} from '../core/constants';
import type {ValueOf} from '../core/constants';
import {getNodeBoundaryIntersection, type NodeGeometry} from '../utils/node-boundary';

const GEOMETRY_NODE_TYPES = new Set<ValueOf<typeof NODE_TYPE>>([
  NODE_TYPE.CIRCLE,
  NODE_TYPE.RECTANGLE,
  NODE_TYPE.ROUNDED_RECTANGLE,
  NODE_TYPE.PATH_ROUNDED_RECTANGLE,
  NODE_TYPE.MARKER
]);

type NumericAccessor = ((node: Node) => number | null | undefined) | null | undefined;
type OffsetAccessor = ((node: Node) => [number, number] | null | undefined) | null | undefined;

type NodeGeometryAccessors = {
  type: ValueOf<typeof NODE_TYPE>;
  getOffset?: OffsetAccessor;
  getRadius?: NumericAccessor;
  getWidth?: NumericAccessor;
  getHeight?: NumericAccessor;
  getCornerRadius?: NumericAccessor;
};

type GeometryAccessorMap = Map<string | number, NodeGeometryAccessors>;

type LayoutInfo = ReturnType<GraphEngine['getEdgePosition']>;

export type NodeStyleLayoutContext = {
  stylesheet: Stylesheet;
  dataAccessor: (nodes: Node[]) => Node[];
};

function normalizePosition(value: unknown): [number, number] | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }

  return null;
}

function toNumericAccessor(accessor: unknown): NumericAccessor {
  if (typeof accessor === 'function') {
    return (node: Node) => {
      const value = accessor(node);
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };
  }

  const numeric = Number(accessor);
  if (Number.isFinite(numeric)) {
    return () => numeric;
  }

  return null;
}

function toOffsetAccessor(accessor: unknown): OffsetAccessor {
  if (typeof accessor === 'function') {
    return (node: Node) => {
      const value = accessor(node);
      if (!Array.isArray(value) || value.length < 2) {
        return null;
      }
      const offsetX = Number(value[0]);
      const offsetY = Number(value[1]);
      if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
        return [offsetX, offsetY];
      }
      return null;
    };
  }

  if (Array.isArray(accessor) && accessor.length >= 2) {
    const offsetX = Number(accessor[0]);
    const offsetY = Number(accessor[1]);
    if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
      return () => [offsetX, offsetY];
    }
  }

  return null;
}

function buildGeometryAccessors(
  stylesheet: Stylesheet
): NodeGeometryAccessors | null {
  const {type} = stylesheet;
  if (!type || !GEOMETRY_NODE_TYPES.has(type)) {
    return null;
  }

  const accessors: NodeGeometryAccessors = {
    type,
    getOffset: toOffsetAccessor(stylesheet.getDeckGLAccessor('getOffset'))
  };

  switch (type) {
    case NODE_TYPE.CIRCLE:
      accessors.getRadius = toNumericAccessor(stylesheet.getDeckGLAccessor('getRadius'));
      break;
    case NODE_TYPE.MARKER: {
      const sizeAccessor = toNumericAccessor(stylesheet.getDeckGLAccessor('getSize'));
      if (sizeAccessor) {
        accessors.getRadius = (node) => {
          const size = sizeAccessor(node);
          return typeof size === 'number' ? size / 2 : size ?? null;
        };
      }
      break;
    }
    case NODE_TYPE.RECTANGLE:
      accessors.getWidth = toNumericAccessor(stylesheet.getDeckGLAccessor('getWidth'));
      accessors.getHeight = toNumericAccessor(stylesheet.getDeckGLAccessor('getHeight'));
      break;
    case NODE_TYPE.ROUNDED_RECTANGLE:
      accessors.getWidth = toNumericAccessor(stylesheet.getDeckGLAccessor('getWidth'));
      accessors.getHeight = toNumericAccessor(stylesheet.getDeckGLAccessor('getHeight'));
      accessors.getCornerRadius = toNumericAccessor(
        stylesheet.getDeckGLAccessor('getCornerRadius')
      );
      accessors.getRadius = toNumericAccessor(stylesheet.getDeckGLAccessor('getRadius'));
      break;
    case NODE_TYPE.PATH_ROUNDED_RECTANGLE:
      accessors.getWidth = toNumericAccessor(stylesheet.getDeckGLAccessor('getWidth'));
      accessors.getHeight = toNumericAccessor(stylesheet.getDeckGLAccessor('getHeight'));
      accessors.getCornerRadius = toNumericAccessor(
        stylesheet.getDeckGLAccessor('getCornerRadius')
      );
      break;
    default:
      break;
  }

  return accessors;
}

function populateAccessorMap(
  map: GeometryAccessorMap,
  nodes: Node[] | undefined,
  accessors: NodeGeometryAccessors
): void {
  if (!nodes || !Array.isArray(nodes)) {
    return;
  }

  for (const node of nodes) {
    const nodeId = node.getId();
    if (!map.has(nodeId)) {
      map.set(nodeId, accessors);
    }
  }
}

function resolveOffset(node: Node, accessor?: OffsetAccessor): [number, number] {
  if (!accessor) {
    return [0, 0];
  }

  const value = accessor(node);
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }

  return [0, 0];
}

function resolveNumeric(node: Node, accessor?: NumericAccessor): number | null {
  if (!accessor) {
    return null;
  }

  const value = accessor(node);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return null;
}

function computeGeometry(
  engine: GraphEngine,
  node: Node,
  accessors?: NodeGeometryAccessors
): NodeGeometry | null {
  const basePosition = engine.getNodePosition(node);
  if (!basePosition) {
    return null;
  }

  const offset = resolveOffset(node, accessors?.getOffset);
  const center: [number, number] = [basePosition[0] + offset[0], basePosition[1] + offset[1]];

  if (!accessors) {
    return {center};
  }

  const geometry: NodeGeometry = {
    type: accessors.type,
    center
  };

  const radius = resolveNumeric(node, accessors.getRadius);
  if (typeof radius === 'number') {
    geometry.radius = Math.max(radius, 0);
  }

  const width = resolveNumeric(node, accessors.getWidth);
  if (typeof width === 'number') {
    geometry.width = Math.max(width, 0);
  }

  const height = resolveNumeric(node, accessors.getHeight);
  if (typeof height === 'number') {
    geometry.height = Math.max(height, 0);
  }

  const cornerRadius = resolveNumeric(node, accessors.getCornerRadius);
  if (typeof cornerRadius === 'number') {
    geometry.cornerRadius = Math.max(cornerRadius, 0);
  }

  return geometry;
}

export class EdgeAttachmentHelper {
  getLayoutAccessor({
    engine,
    nodeStyles
  }: {
    engine: GraphEngine;
    nodeStyles?: Array<NodeStyleLayoutContext>;
  }): GraphEngine['getEdgePosition'] {
    const styles = nodeStyles ?? [];
    if (styles.length === 0) {
      return (edge) => engine.getEdgePosition(edge);
    }

    const accessorMap: GeometryAccessorMap = new Map();
    const nodesById = new Map<string | number, Node>();

    const allNodes = engine.getNodes();
    for (const node of allNodes) {
      nodesById.set(node.getId(), node);
    }

    for (const context of styles) {
      if (!context) {
        continue;
      }

      const accessors = buildGeometryAccessors(context.stylesheet);
      if (!accessors) {
        continue;
      }

      const nodes = context.dataAccessor(allNodes);
      populateAccessorMap(accessorMap, nodes, accessors);
    }

    if (accessorMap.size === 0) {
      return (edge) => engine.getEdgePosition(edge);
    }

    return (edge) => {
      const layoutInfo: LayoutInfo = engine.getEdgePosition(edge);
      if (!layoutInfo) {
        return layoutInfo;
      }

      const sourceNode = nodesById.get(edge.getSourceNodeId());
      const targetNode = nodesById.get(edge.getTargetNodeId());

      if (!sourceNode || !targetNode) {
        return layoutInfo;
      }

      const sourceGeometry = computeGeometry(
        engine,
        sourceNode,
        accessorMap.get(sourceNode.getId())
      );
      const targetGeometry = computeGeometry(
        engine,
        targetNode,
        accessorMap.get(targetNode.getId())
      );

      if (!sourceGeometry && !targetGeometry) {
        return layoutInfo;
      }

      const adjusted = {...layoutInfo};

      const targetReference = targetGeometry?.center ?? normalizePosition(layoutInfo.targetPosition);
      const sourceReference = sourceGeometry?.center ?? normalizePosition(layoutInfo.sourcePosition);

      if (sourceGeometry && targetReference) {
        adjusted.sourcePosition = getNodeBoundaryIntersection(sourceGeometry, targetReference);
      } else if (sourceGeometry) {
        adjusted.sourcePosition = [...sourceGeometry.center];
      }

      if (targetGeometry && sourceReference) {
        adjusted.targetPosition = getNodeBoundaryIntersection(targetGeometry, sourceReference);
      } else if (targetGeometry) {
        adjusted.targetPosition = [...targetGeometry.center];
      }

      return adjusted;
    };
  }
}
