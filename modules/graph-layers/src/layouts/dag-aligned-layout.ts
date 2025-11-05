// deck.gl-community
// SPDX-License-Identifier: MIT

import type {Graph} from '../graph/graph';
import {Node} from '../graph/node';
import {Edge} from '../graph/edge';
import {GraphLayout, type GraphLayoutOptions} from '../core/graph-layout';
import {log} from '../utils/log';

import {
  layoutDagAligned,
  type DagAlignedOptions,
  type DagAlignedResult,
  type DagLink,
  type DagNode,
  type YScale
} from './layout-dag-aligned';

export type DagAlignedLayoutOptions = GraphLayoutOptions & {
  rank: (node: Node) => number;
  yScale?: YScale;
  layering?: DagAlignedOptions<DagNode<Node>>['layering'];
  decross?: DagAlignedOptions<DagNode<Node>>['decross'];
  coord?: DagAlignedOptions<DagNode<Node>>['coord'];
  gap?: [number, number];
  nodeSize?: (node: Node) => [number, number];
  debug?: boolean;
};

type PositionedNode = DagAlignedResult<DagNode<Node>>['nodes'][number];

/**
 * GraphLayout adapter that runs layoutDagAligned and exposes the results
 * through the standard GraphLayout interface used by GraphLayer.
 */
export class DagAlignedLayout extends GraphLayout<DagAlignedLayoutOptions> {
  static defaultOptions: Required<Pick<DagAlignedLayoutOptions, 'gap' | 'debug'>> = {
    gap: [24, 40],
    debug: false
  };

  protected readonly _name = 'DagAlignedLayout';

  private _graph: Graph | null = null;
  private _nodePositions = new Map<string | number, [number, number]>();
  private _lockedNodePositions = new Map<string | number, [number, number]>();

  constructor(options: DagAlignedLayoutOptions) {
    super({...DagAlignedLayout.defaultOptions, ...options});
  }

  initializeGraph(graph: Graph): void {
    this._graph = graph;
  }

  updateGraph(graph: Graph): void {
    this._graph = graph;
  }

  start(): void {
    this._runLayout();
  }

  update(): void {
    this._runLayout();
  }

  resume(): void {
    this._runLayout();
  }

  stop(): void {}

  getNodePosition(node: Node): [number, number] {
    if (!node) {
      return [0, 0];
    }
    return this._nodePositions.get(node.getId()) ?? [0, 0];
  }

  getEdgePosition(edge: Edge) {
    const graph = this._graph;
    const sourceNode = graph?.findNode(edge.getSourceNodeId());
    const targetNode = graph?.findNode(edge.getTargetNodeId());
    const source = sourceNode ? this.getNodePosition(sourceNode) : [0, 0];
    const target = targetNode ? this.getNodePosition(targetNode) : [0, 0];

    return {
      type: 'line' as const,
      sourcePosition: source,
      targetPosition: target,
      controlPoints: [] as [number, number][]
    };
  }

  lockNodePosition(node: Node, x: number, y: number): void {
    this._lockedNodePositions.set(node.getId(), [x, y]);
    this._nodePositions.set(node.getId(), [x, y]);
    this._onLayoutChange();
    this._onLayoutDone();
  }

  unlockNodePosition(node: Node): void {
    this._lockedNodePositions.delete(node.getId());
    this._nodePositions.delete(node.getId());
    this._onLayoutChange();
    this._onLayoutDone();
  }

  protected override _updateBounds(): void {
    this._bounds = this._calculateBounds(this._nodePositions.values());
  }

  private _runLayout(): void {
    if (!this._graph) {
      return;
    }

    const nodes = this._graph.getNodes();
    const edges = this._graph.getEdges().filter((edge) => edge.isDirected());

    if (!nodes.length) {
      this._nodePositions.clear();
      this._onLayoutStart();
      this._onLayoutChange();
      this._onLayoutDone();
      return;
    }

    try {
      const result = this._computeLayout(nodes, edges);
      this._applyLayout(result);
      this._onLayoutStart();
      this._onLayoutChange();
      this._onLayoutDone();
    } catch (error) {
      log.error(error);
      this._onLayoutError();
    }
  }

  private _computeLayout(nodes: Node[], edges: Edge[]): DagAlignedResult<DagNode<Node>> {
    const {rank, yScale, layering, decross, coord, gap = DagAlignedLayout.defaultOptions.gap, nodeSize, debug} =
      this._options;

    const dagNodes: DagNode<Node>[] = nodes.map((node) => ({id: node.getId(), data: node}));
    const dagLinks: DagLink[] = edges.map((edge) => ({
      source: edge.getSourceNodeId(),
      target: edge.getTargetNodeId()
    }));

    return layoutDagAligned(dagNodes, dagLinks, {
      rank: ({data}) => (data ? rank(data) : 0),
      yScale,
      layering,
      decross,
      coord,
      gap,
      nodeSize: nodeSize ? ({data}) => (data ? nodeSize(data) : [0, 0]) : undefined,
      debug
    });
  }

  private _applyLayout(result: DagAlignedResult<DagNode<Node>>): void {
    this._nodePositions.clear();

    for (const node of result.nodes as PositionedNode[]) {
      const locked = this._lockedNodePositions.get(node.id);
      const position: [number, number] = locked ?? [node.x, node.y];
      this._nodePositions.set(node.id, position);
    }

    for (const [id, position] of this._lockedNodePositions) {
      this._nodePositions.set(id, position);
    }
  }
}
