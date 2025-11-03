// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {InteractionManager} from '../core/interaction-manager';
import type {GraphEngine} from '../core/graph-engine';
import type {Node} from '../graph/node';

import {Stylesheet} from '../style/style-sheet';
import {NODE_TYPE} from '../core/constants';
import type {ValueOf} from '../core/constants';
import {getNodeBoundaryIntersection, type NodeGeometry} from '../utils/node-boundary';

type NumericAccessor = ((node: Node) => number) | number | null | undefined;
type OffsetAccessor =
  | ((node: Node) => [number, number])
  | [number, number]
  | null
  | undefined;

type NodeStyleAccessors = {
  type: ValueOf<typeof NODE_TYPE>;
  getOffset?: OffsetAccessor;
  getRadius?: NumericAccessor;
  getWidth?: NumericAccessor;
  getHeight?: NumericAccessor;
  getCornerRadius?: NumericAccessor;
  getSize?: NumericAccessor;
};

const GEOMETRY_NODE_TYPES = new Set<NodeStyleAccessors['type']>([
  NODE_TYPE.CIRCLE,
  NODE_TYPE.RECTANGLE,
  NODE_TYPE.ROUNDED_RECTANGLE,
  NODE_TYPE.PATH_ROUNDED_RECTANGLE,
  NODE_TYPE.MARKER
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

export class EdgeAttachmentHelper {
  getLayoutAccessor({
    engine,
    interactionManager,
    nodeStyle
  }: {
    engine: GraphEngine;
    interactionManager: InteractionManager;
    nodeStyle?: any[] | any;
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

    return (edge) => {
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
    };
  }

  private _buildNodeStyleAccessorMap({
    engine,
    interactionManager,
    nodeStyle
  }: {
    engine: GraphEngine;
    interactionManager: InteractionManager;
    nodeStyle?: any[] | any;
  }) {
    const nodeAccessorMap = new Map<string | number, NodeStyleAccessors>();

    if (!nodeStyle) {
      return nodeAccessorMap;
    }

    const styles = Array.isArray(nodeStyle) ? nodeStyle : [nodeStyle];

    styles
      .filter(Boolean)
      .forEach((style) => {
        const {data = (nodes) => nodes, ...restStyle} = style as any;
        const type = restStyle.type as NodeStyleAccessors['type'] | undefined;

        if (!type || !GEOMETRY_NODE_TYPES.has(type)) {
          return;
        }

        const stylesheet = new Stylesheet(restStyle, {
          stateUpdateTrigger: (interactionManager as any).getLastInteraction()
        });

        const nodes = data(engine.getNodes());
        if (!Array.isArray(nodes)) {
          return;
        }

        const accessors: NodeStyleAccessors = {
          type,
          getOffset: stylesheet.getDeckGLAccessor('getOffset')
        };

        switch (type) {
          case NODE_TYPE.CIRCLE:
            accessors.getRadius = stylesheet.getDeckGLAccessor('getRadius');
            break;
          case NODE_TYPE.MARKER:
            accessors.getSize = stylesheet.getDeckGLAccessor('getSize');
            break;
          case NODE_TYPE.RECTANGLE:
            accessors.getWidth = stylesheet.getDeckGLAccessor('getWidth');
            accessors.getHeight = stylesheet.getDeckGLAccessor('getHeight');
            break;
          case NODE_TYPE.ROUNDED_RECTANGLE:
            accessors.getWidth = stylesheet.getDeckGLAccessor('getWidth');
            accessors.getHeight = stylesheet.getDeckGLAccessor('getHeight');
            accessors.getCornerRadius = stylesheet.getDeckGLAccessor('getCornerRadius');
            accessors.getRadius = stylesheet.getDeckGLAccessor('getRadius');
            break;
          case NODE_TYPE.PATH_ROUNDED_RECTANGLE:
            accessors.getWidth = stylesheet.getDeckGLAccessor('getWidth');
            accessors.getHeight = stylesheet.getDeckGLAccessor('getHeight');
            accessors.getCornerRadius = stylesheet.getDeckGLAccessor('getCornerRadius');
            break;
          default:
            break;
        }

        nodes.forEach((node: Node) => {
          const id = node.getId();
          if (!nodeAccessorMap.has(id)) {
            nodeAccessorMap.set(id, accessors);
          }
        });
      });

    return nodeAccessorMap;
  }

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

    switch (accessors.type) {
      case NODE_TYPE.CIRCLE: {
        const radius = evaluateNumericAccessor(accessors.getRadius, node);
        if (typeof radius === 'number') {
          geometry.radius = Math.max(radius, 0);
        }
        break;
      }
      case NODE_TYPE.MARKER: {
        const size = evaluateNumericAccessor(accessors.getSize, node);
        if (typeof size === 'number') {
          geometry.radius = Math.max(size / 2, 0);
        }
        break;
      }
      case NODE_TYPE.RECTANGLE: {
        const width = evaluateNumericAccessor(accessors.getWidth, node);
        const height = evaluateNumericAccessor(accessors.getHeight, node);
        if (typeof width === 'number') {
          geometry.width = Math.max(width, 0);
        }
        if (typeof height === 'number') {
          geometry.height = Math.max(height, 0);
        }
        break;
      }
      case NODE_TYPE.ROUNDED_RECTANGLE: {
        const width = evaluateNumericAccessor(accessors.getWidth, node);
        const height = evaluateNumericAccessor(accessors.getHeight, node);
        if (typeof width === 'number') {
          geometry.width = Math.max(width, 0);
        }
        if (typeof height === 'number') {
          geometry.height = Math.max(height, 0);
        }
        const cornerRadius = evaluateNumericAccessor(accessors.getCornerRadius, node);
        if (typeof cornerRadius === 'number') {
          geometry.cornerRadius = Math.max(cornerRadius, 0);
        }
        const radius = evaluateNumericAccessor(accessors.getRadius, node);
        if (typeof radius === 'number') {
          geometry.radius = Math.max(radius, 0);
        }
        break;
      }
      case NODE_TYPE.PATH_ROUNDED_RECTANGLE: {
        const width = evaluateNumericAccessor(accessors.getWidth, node);
        const height = evaluateNumericAccessor(accessors.getHeight, node);
        if (typeof width === 'number') {
          geometry.width = Math.max(width, 0);
        }
        if (typeof height === 'number') {
          geometry.height = Math.max(height, 0);
        }
        const cornerRadius = evaluateNumericAccessor(accessors.getCornerRadius, node);
        if (typeof cornerRadius === 'number') {
          geometry.cornerRadius = Math.max(cornerRadius, 0);
        }
        break;
      }
      default: {
        const radius = evaluateNumericAccessor(accessors.getRadius, node);
        if (typeof radius === 'number') {
          geometry.radius = Math.max(radius, 0);
        }
        const width = evaluateNumericAccessor(accessors.getWidth, node);
        const height = evaluateNumericAccessor(accessors.getHeight, node);
        if (typeof width === 'number') {
          geometry.width = Math.max(width, 0);
        }
        if (typeof height === 'number') {
          geometry.height = Math.max(height, 0);
        }
        break;
      }
    }

    return geometry;
  }
}
