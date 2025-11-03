// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {InteractionManager} from '../core/interaction-manager';
import type {GraphEngine} from '../core/graph-engine';
import type {Node} from '../graph/node';

import {GraphStyleEngine, type GraphStylesheet} from '../style/graph-style-engine';
import type {GraphLayerNodeStyle} from '../style/graph-layer-stylesheet';
import {getNodeBoundaryIntersection, type GeometryNodeType, type NodeGeometry} from '../utils/node-boundary';
import {warn} from '../utils/log';

type NumericAccessor = ((node: Node) => number) | number | null | undefined;
type OffsetAccessor =
  | ((node: Node) => [number, number])
  | [number, number]
  | null
  | undefined;

type NodeStyleAccessors = {
  type: GeometryNodeType;
  getOffset?: OffsetAccessor;
  getRadius?: NumericAccessor;
  getWidth?: NumericAccessor;
  getHeight?: NumericAccessor;
  getCornerRadius?: NumericAccessor;
  getSize?: NumericAccessor;
};

const GEOMETRY_NODE_TYPES = new Set<GeometryNodeType>([
  'circle',
  'rectangle',
  'rounded-rectangle',
  'path-rounded-rectangle',
  'marker'
]);

function evaluateNumericAccessor(accessor: NumericAccessor, node: Node): number | undefined {
  if (typeof accessor === 'function') {
    const value = accessor(node);
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }
  if (typeof accessor === 'number' && Number.isFinite(accessor)) {
    return accessor;
  }
  return undefined;
}

function evaluateOffsetAccessor(accessor: OffsetAccessor, node: Node): [number, number] {
  if (!accessor) {
    return [0, 0];
  }

  let value = accessor as [number, number];
  if (typeof accessor === 'function') {
    value = accessor(node);
  }

  if (Array.isArray(value) && value.length >= 2) {
    const offsetX = Number(value[0]);
    const offsetY = Number(value[1]);
    if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
      return [offsetX, offsetY];
    }
  }

  return [0, 0];
}

function normalizePosition(value: any): [number, number] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {length?: number; [index: number]: number};
  if (typeof candidate.length === 'number' && candidate.length >= 2) {
    const x = Number(candidate[0]);
    const y = Number(candidate[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }

  return null;
}

function resolveAccessorValue(accessor: NumericAccessor | undefined, node: Node) {
  if (!accessor) {
    return undefined;
  }
  return evaluateNumericAccessor(accessor, node);
}

function assignDimension(
  geometry: NodeGeometry,
  key: 'radius' | 'width' | 'height' | 'cornerRadius',
  value: number | undefined
) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    geometry[key] = Math.max(value, 0);
  }
}

function assignRectangleDimensions(
  node: Node,
  accessors: NodeStyleAccessors,
  geometry: NodeGeometry
) {
  assignDimension(geometry, 'width', resolveAccessorValue(accessors.getWidth, node));
  assignDimension(geometry, 'height', resolveAccessorValue(accessors.getHeight, node));
}

const GEOMETRY_APPLIERS: Record<GeometryNodeType, (node: Node, accessors: NodeStyleAccessors, geometry: NodeGeometry) => void> = {
  circle: (node, accessors, geometry) => {
    assignDimension(geometry, 'radius', resolveAccessorValue(accessors.getRadius, node));
  },
  marker: (node, accessors, geometry) => {
    const size = resolveAccessorValue(accessors.getSize, node);
    assignDimension(geometry, 'radius', typeof size === 'number' ? size / 2 : undefined);
  },
  rectangle: (node, accessors, geometry) => {
    assignRectangleDimensions(node, accessors, geometry);
  },
  'rounded-rectangle': (node, accessors, geometry) => {
    assignRectangleDimensions(node, accessors, geometry);
    assignDimension(geometry, 'cornerRadius', resolveAccessorValue(accessors.getCornerRadius, node));
    assignDimension(geometry, 'radius', resolveAccessorValue(accessors.getRadius, node));
  },
  'path-rounded-rectangle': (node, accessors, geometry) => {
    assignRectangleDimensions(node, accessors, geometry);
    assignDimension(geometry, 'cornerRadius', resolveAccessorValue(accessors.getCornerRadius, node));
  }
};

export class EdgeAttachmentHelper {
  getLayoutAccessor({
    engine,
    interactionManager,
    nodeStyle
  }: {
    engine: GraphEngine;
    interactionManager: InteractionManager;
    nodeStyle?: GraphLayerNodeStyle[] | GraphLayerNodeStyle;
  }) {
    const nodeAccessorMap = this._buildNodeStyleAccessorMap({
      engine,
      interactionManager,
      nodeStyle
    });

    if (nodeAccessorMap.size === 0) {
      return (edge) => engine.getEdgePosition(edge);
    }

    const nodeMap = engine
      .getNodes()
      .reduce(
        (acc, node) => acc.set(node.getId(), node),
        new Map<string | number, Node>()
      );

    return (edge) =>
      this._getAdjustedEdgeLayout(engine, nodeAccessorMap, nodeMap, edge);
  }

  private _buildNodeStyleAccessorMap({
    engine,
    interactionManager,
    nodeStyle
  }: {
    engine: GraphEngine;
    interactionManager: InteractionManager;
    nodeStyle?: GraphLayerNodeStyle[] | GraphLayerNodeStyle;
  }) {
    const nodeAccessorMap = new Map<string | number, NodeStyleAccessors>();

    if (!nodeStyle) {
      return nodeAccessorMap;
    }

    const styles = Array.isArray(nodeStyle) ? nodeStyle : [nodeStyle];

    styles
      .filter(Boolean)
      .forEach((style) => {
        const {data = (nodes) => nodes, ...restStyle} = style;
        const type = restStyle.type;

        if (!type || !GEOMETRY_NODE_TYPES.has(type as GeometryNodeType)) {
          return;
        }

        const geometryType = type as GeometryNodeType;

        let stylesheet: GraphStyleEngine | null = null;
        try {
          stylesheet = new GraphStyleEngine(restStyle as GraphStylesheet, {
            stateUpdateTrigger: (interactionManager as any).getLastInteraction()
          });
        } catch (error) {
          warn(
            `GraphLayer: Failed to evaluate node stylesheet for edge attachment (${String(
              (error as Error).message ?? error
            )}).`
          );
          return;
        }

        const nodes = data(engine.getNodes());
        if (!Array.isArray(nodes)) {
          return;
        }

        const accessors = this._createAccessorsForType(geometryType, stylesheet);

        nodes.forEach((node: Node) => {
          const id = node.getId();
          if (!nodeAccessorMap.has(id)) {
            nodeAccessorMap.set(id, accessors);
          }
        });
      });

    return nodeAccessorMap;
  }

  private _getAdjustedEdgeLayout(
    engine: GraphEngine,
    nodeAccessorMap: Map<string | number, NodeStyleAccessors>,
    nodeMap: Map<string | number, Node>,
    edge: any
  ) {
    const layoutInfo = engine.getEdgePosition(edge);
    if (!layoutInfo) {
      return layoutInfo;
    }

    const sourceNode = nodeMap.get(edge.getSourceNodeId());
    const targetNode = nodeMap.get(edge.getTargetNodeId());

    if (!sourceNode || !targetNode) {
      return layoutInfo;
    }

    const sourceGeometry = this._computeNodeGeometry(
      engine,
      sourceNode,
      nodeAccessorMap.get(sourceNode.getId())
    );
    const targetGeometry = this._computeNodeGeometry(
      engine,
      targetNode,
      nodeAccessorMap.get(targetNode.getId())
    );

    if (!sourceGeometry && !targetGeometry) {
      return layoutInfo;
    }

    return this._applyGeometryToLayout(layoutInfo, sourceGeometry, targetGeometry);
  }

  private _applyGeometryToLayout(
    layoutInfo: any,
    sourceGeometry: NodeGeometry | null,
    targetGeometry: NodeGeometry | null
  ) {
    const adjustedLayout = {...layoutInfo};

    const targetReference = targetGeometry?.center ?? normalizePosition(layoutInfo.targetPosition);
    const sourceReference = sourceGeometry?.center ?? normalizePosition(layoutInfo.sourcePosition);

    if (sourceGeometry) {
      adjustedLayout.sourcePosition = targetReference
        ? getNodeBoundaryIntersection(sourceGeometry, targetReference)
        : [...sourceGeometry.center];
    }

    if (targetGeometry) {
      adjustedLayout.targetPosition = sourceReference
        ? getNodeBoundaryIntersection(targetGeometry, sourceReference)
        : [...targetGeometry.center];
    }

    return adjustedLayout;
  }

  private _createAccessorsForType(
    geometryType: GeometryNodeType,
    stylesheet: GraphStyleEngine
  ): NodeStyleAccessors {
    const base: NodeStyleAccessors = {
      type: geometryType,
      getOffset: stylesheet.getDeckGLAccessor('getOffset')
    };

    switch (geometryType) {
      case 'circle':
        base.getRadius = stylesheet.getDeckGLAccessor('getRadius');
        break;
      case 'marker':
        base.getSize = stylesheet.getDeckGLAccessor('getSize');
        break;
      case 'rectangle':
        base.getWidth = stylesheet.getDeckGLAccessor('getWidth');
        base.getHeight = stylesheet.getDeckGLAccessor('getHeight');
        break;
      case 'rounded-rectangle':
        base.getWidth = stylesheet.getDeckGLAccessor('getWidth');
        base.getHeight = stylesheet.getDeckGLAccessor('getHeight');
        base.getCornerRadius = stylesheet.getDeckGLAccessor('getCornerRadius');
        base.getRadius = stylesheet.getDeckGLAccessor('getRadius');
        break;
      case 'path-rounded-rectangle':
        base.getWidth = stylesheet.getDeckGLAccessor('getWidth');
        base.getHeight = stylesheet.getDeckGLAccessor('getHeight');
        base.getCornerRadius = stylesheet.getDeckGLAccessor('getCornerRadius');
        break;
      default:
        break;
    }

    return base;
  }

  // eslint-disable-next-line complexity, max-statements
  private _computeNodeGeometry(
    engine: GraphEngine,
    node: Node,
    accessors?: NodeStyleAccessors
  ): NodeGeometry | null {
    const basePosition = engine.getNodePosition(node);
    if (!basePosition) {
      return null;
    }

    const offset = evaluateOffsetAccessor(accessors?.getOffset, node);
    const center: [number, number] = [basePosition[0] + offset[0], basePosition[1] + offset[1]];

    const geometry: NodeGeometry = {
      type: accessors?.type,
      center
    };

    if (!accessors) {
      return geometry;
    }

    const applier = accessors.type ? GEOMETRY_APPLIERS[accessors.type] : undefined;
    if (applier) {
      applier(node, accessors, geometry);
    }

    return geometry;
  }
}
