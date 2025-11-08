// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutProps} from '../../core/graph-layout';
import {LegacyGraph} from '../../graph/legacy-graph';
import type {Node} from '../../graph/node';

export type RadialLayoutProps = GraphLayoutProps & {
  radius?: number;
  tree?: any;
};

const traverseTree = (nodeId, nodeMap) => {
  const node = nodeMap[nodeId];
  if (node.isLeaf) {
    return node;
  }
  return {
    ...node,
    children: node.children.map((nid) => traverseTree(nid, nodeMap))
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
  if (node.isLeaf) {
    return depth;
  }
  return getTreeDepth(node.children[0], depth + 1);
};

const getPath = (node, targetId, path) => {
  if (node.id === targetId) {
    path.push(node.id);
    return true;
  }
  const inChildren = node.children && node.children.some((c) => getPath(c, targetId, path));
  if (inChildren) {
    path.push(node.id);
    return true;
  }
  return false;
};

export class RadialLayout extends GraphLayout<RadialLayoutProps> {
  static defaultProps = {
    radius: 500,
    tree: []
  } as const satisfies Readonly<Required<RadialLayoutProps>>;

  _name = 'RadialLayout';
  _graph: LegacyGraph | null = null;
  // custom layout data structure
  _hierarchicalPoints = {};
  nestedTree;

  constructor(props: RadialLayoutProps = {}) {
    super({...RadialLayout.defaultProps, ...props});
  }

  initializeGraph(graph: LegacyGraph): void {
    this.setProps({graph});
  }

  protected override updateGraph(graph: LegacyGraph): void {
    this._graph = graph;
  }

  start(): void {
    if (!this._graph) {
      return;
    }
    const nodes = Array.isArray(this._graph.getNodes())
      ? (this._graph.getNodes() as Node[])
      : (Array.from(this._graph.getNodes()) as Node[]);
    const nodeCount = nodes.length;
    if (nodeCount === 0) {
      return;
    }

    const {tree} = this.props;

    if (!tree || tree.length === 0) {
      return;
    }

    this._onLayoutStart();

    const {radius} = this.props;
    const unitAngle = 360 / nodeCount;

    // hierarchical positions
    const rootNode = tree[0];

    const nodeMap = tree.reduce((res, node) => {
      res[node.id] = {
        ...node,
        isLeaf: !node.children || node.children.length === 0
      };
      return res;
    }, {});
    // nested structure
    this.nestedTree = traverseTree(rootNode.id, nodeMap);

    const totalLevels = getTreeDepth(this.nestedTree, 0);
    const distanceBetweenLevels = radius / (totalLevels - 1);

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
              distanceBetweenLevels * (level + 1),
              startAngle + unitAngle * (groupSize / 2)
            );
        // calculate children position
        let tempAngle = startAngle;
        node.children.forEach((n) => {
          calculatePosition(n, level + 1, tempAngle, positionMap);
          tempAngle += getLeafNodeCount(n, 0) * unitAngle;
        });
      } else {
        positionMap[node.id] = rotate(
          0,
          0,
          0,
          distanceBetweenLevels * (level + 1),
          startAngle + unitAngle
        );
      }
    };

    this._hierarchicalPoints = {};
    calculatePosition(this.nestedTree, 0, 0, this._hierarchicalPoints);
    // layout completes: notifiy component to re-render
    this._onLayoutChange();
    this._onLayoutDone();
  }

  stop(): void {}

  resume() {}

  update() {}

  getNodePosition = (node: Node) => {
    return this._hierarchicalPoints[node.getId()];
  };

  // spline curve version
  getEdgePosition = (edge) => {
    const sourceNodeId = edge.getSourceNodeId();
    const targetNodeId = edge.getTargetNodeId();
    const sourceNodePos = this._hierarchicalPoints[sourceNodeId];
    const targetNodePos = this._hierarchicalPoints[targetNodeId];

    const sourcePath = [];
    getPath(this.nestedTree, sourceNodeId, sourcePath);
    const targetPath = [];
    getPath(this.nestedTree, targetNodeId, targetPath);

    const totalLevels = sourcePath.length;
    let commonAncestorLevel = totalLevels - 1; // root
    for (let i = 0; i < totalLevels; i++) {
      if (sourcePath[i] === targetPath[i]) {
        commonAncestorLevel = i;
        break;
      }
    }

    const wayPoints = [];
    for (let i = 1; i <= commonAncestorLevel; i++) {
      const nodeId = sourcePath[i];
      wayPoints.push(this._hierarchicalPoints[nodeId]);
    }
    for (let i = commonAncestorLevel - 1; i > 0; i--) {
      const nodeId = targetPath[i];
      wayPoints.push(this._hierarchicalPoints[nodeId]);
    }

    return {
      type: 'spline-curve',
      sourcePosition: sourceNodePos,
      targetPosition: targetNodePos,
      controlPoints: wayPoints
    };
  };

  lockNodePosition = (node, x, y) => {
    this._hierarchicalPoints[node.id] = [x, y];
    this._onLayoutChange();
    this._onLayoutDone();
  };

  protected override _updateBounds(): void {
    const positions = Object.values(this._hierarchicalPoints ?? {}).map((position) =>
      this._normalizePosition(position)
    );
    this._bounds = this._calculateBounds(positions);
  }
}

function rotate(cx, cy, x, y, angle) {
  const radians = (Math.PI / 180) * angle;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const nx = cos * (x - cx) + sin * (y - cy) + cx;
  const ny = cos * (y - cy) - sin * (x - cx) + cy;
  return [nx, ny];
}
