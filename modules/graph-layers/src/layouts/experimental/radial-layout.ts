// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutProps} from '../../core/graph-layout';
import type {Graph, NodeInterface, EdgeInterface} from '../../graph/graph';

export type RadialLayoutProps = GraphLayoutProps & {
  radius?: number;
  tree?: any;
};

const getTreeNode = (
  nodeId: string,
  nodeMap: Record<string, {children?: string[]; isLeaf?: boolean}>
) => {
  const node = nodeMap[nodeId];
  if (node) {
    return node;
  }
  return {
    id: nodeId,
    children: [],
    isLeaf: true
  };
};

const traverseTree = (nodeId, nodeMap) => {
  const node = getTreeNode(nodeId, nodeMap);
  if (node.isLeaf) {
    return node;
  }
  return {
    ...node,
    children: (node.children ?? []).map(nid => traverseTree(nid, nodeMap))
  };
};

const getLeafNodeCount = (node, count) => {
  if (!node.children || node.children.length === 0) {
    return count + 1;
  }
  const sum = node.children.reduce((res, c) => {
    return res + getLeafNodeCount(c, 0);
  }, 0);
  return count + sum;
};

const getTreeDepth = (node, depth = 0) => {
  if (!node.children?.length) {
    return depth;
  }
  return node.children.reduce(
    (maxDepth, child) => Math.max(maxDepth, getTreeDepth(child, depth + 1)),
    depth
  );
};

const getPath = (node, targetId, path) => {
  if (!node) {
    return false;
  }
  if (node.id === targetId) {
    path.push(node.id);
    return true;
  }
  const inChildren = node.children && node.children.some(c => getPath(c, targetId, path));
  if (inChildren) {
    path.push(node.id);
    return true;
  }
  return false;
};

export class RadialLayout extends GraphLayout<RadialLayoutProps> {
  static defaultProps = {
    ...GraphLayout.defaultProps,
    radius: 500,
    tree: []
  } as const satisfies Readonly<Required<RadialLayoutProps>>;

  _name = 'RadialLayout';
  _graph: Graph | null = null;
  // custom layout data structure
  _hierarchicalPoints: Record<string, [number, number]> = Object.create(null);
  nestedTree;

  constructor(props: RadialLayoutProps = {}) {
    super(props, RadialLayout.defaultProps);
  }

  initializeGraph(graph: Graph): void {
    this.updateGraph(graph);
  }

  updateGraph(graph: Graph): void {
    this._graph = graph;
  }

  /** Computes concentric rings using maximum hierarchy depth and evenly spaced leaf sectors. */
  start(): void {
    if (!this._graph) {
      return;
    }
    this._hierarchicalPoints = Object.create(null);
    this.nestedTree = null;
    this._onLayoutStart();
    const nodes = Array.from(this._graph.getNodes());
    const nodeCount = nodes.length;
    const {tree} = this.props;
    if (nodeCount === 0 || !tree?.length) {
      this._onLayoutChange();
      this._onLayoutDone();
      return;
    }

    const {radius} = this.props;

    // hierarchical positions
    const rootNode = tree[0];

    const nodeMap = tree.reduce((res, node) => {
      res[node.id] = {
        ...node,
        isLeaf: !node.children || node.children.length === 0
      };
      return res;
    }, Object.create(null));
    // nested structure
    this.nestedTree = traverseTree(rootNode.id, nodeMap);

    const totalLevels = getTreeDepth(this.nestedTree, 0);
    const distanceBetweenLevels = radius / Math.max(totalLevels, 1);
    const unitAngle = 360 / getLeafNodeCount(this.nestedTree, 0);

    const calculatePosition = (node, level, startAngle, positionMap) => {
      const isRoot = node.id === rootNode.id;

      if (node.children && node.children.length !== 0) {
        const groupSize = getLeafNodeCount(node, 0);
        // center the pos
        positionMap[node.id] = isRoot
          ? [0, 0]
          : rotate(
              0,
              0,
              0,
              distanceBetweenLevels * level,
              startAngle + unitAngle * (groupSize / 2)
            );
        // calculate children position
        let tempAngle = startAngle;
        node.children.forEach(n => {
          calculatePosition(n, level + 1, tempAngle, positionMap);
          tempAngle += getLeafNodeCount(n, 0) * unitAngle;
        });
      } else {
        positionMap[node.id] = isRoot
          ? [0, 0]
          : rotate(0, 0, 0, distanceBetweenLevels * level, startAngle + unitAngle / 2);
      }
    };

    calculatePosition(this.nestedTree, 0, 0, this._hierarchicalPoints);
    // layout completes: notifiy component to re-render
    this._onLayoutChange();
    this._onLayoutDone();
  }

  stop(): void {}

  resume() {}

  update() {}

  /** Returns null when the node is absent from the configured hierarchy. */
  getNodePosition = (node: NodeInterface) => {
    return this._hierarchicalPoints[node.getId()] ?? null;
  };

  /** Routes edges through their shared ancestor, excluding either endpoint from control points. */
  getEdgePosition = (edge: EdgeInterface) => {
    const sourceNodeId = edge.getSourceNodeId();
    const targetNodeId = edge.getTargetNodeId();
    const sourceNodePos = this._hierarchicalPoints[sourceNodeId];
    const targetNodePos = this._hierarchicalPoints[targetNodeId];
    if (!sourceNodePos || !targetNodePos) {
      return null;
    }

    const sourcePath = [];
    getPath(this.nestedTree, sourceNodeId, sourcePath);
    const targetPath = [];
    getPath(this.nestedTree, targetNodeId, targetPath);

    let sourceAncestor = sourcePath.length - 1;
    let targetAncestor = targetPath.length - 1;
    while (
      sourceAncestor >= 0 &&
      targetAncestor >= 0 &&
      sourcePath[sourceAncestor] === targetPath[targetAncestor]
    ) {
      sourceAncestor--;
      targetAncestor--;
    }
    const wayPoints = [
      ...sourcePath.slice(1, sourceAncestor + 2),
      ...targetPath.slice(1, targetAncestor + 1).reverse()
    ]
      .filter(nodeId => nodeId !== sourceNodeId && nodeId !== targetNodeId)
      .map(nodeId => this._hierarchicalPoints[nodeId]);

    return {
      type: wayPoints.length > 0 ? 'spline-curve' : 'line',
      sourcePosition: sourceNodePos,
      targetPosition: targetNodePos,
      controlPoints: wayPoints
    };
  };

  lockNodePosition = (node: NodeInterface, x: number, y: number) => {
    this._hierarchicalPoints[node.getId()] = [x, y];
    this._onLayoutChange();
    this._onLayoutDone();
  };

  protected override _updateBounds(): void {
    const positions = Object.values(this._hierarchicalPoints ?? {}).map(position =>
      this._normalizePosition(position)
    );
    this._bounds = this._calculateBounds(positions);
  }
}

function rotate(cx: number, cy: number, x: number, y: number, angle: number): [number, number] {
  const radians = (Math.PI / 180) * angle;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const nx = cos * (x - cx) + sin * (y - cy) + cx;
  const ny = cos * (y - cy) - sin * (x - cx) + cy;
  return [nx, ny];
}
