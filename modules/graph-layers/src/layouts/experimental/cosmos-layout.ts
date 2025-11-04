// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Graph} from '../../graph/graph';
import type {Node} from '../../graph/node';
import type {Edge} from '../../graph/edge';
import {GraphLayout, type GraphLayoutOptions} from '../../core/graph-layout';

/* eslint-disable import/no-unresolved */
import {
  createCosmosLayout,
  type CosmosLayoutConfig,
  type CosmosLayoutController,
  type CosmosGraph,
  type CosmosNode,
  type CosmosEdge
} from 'cosmos.gl';
/* eslint-enable import/no-unresolved */

export type CosmosLayoutOptions = GraphLayoutOptions & {
  /** Options forwarded to the cosmos.gl GPU layout implementation. */
  cosmos?: CosmosLayoutConfig;
};

type EdgePosition = {
  type: 'line';
  sourcePosition: [number, number];
  targetPosition: [number, number];
  controlPoints: [number, number][];
};

/**
 * Adapter that wraps the cosmos.gl GPU layout and exposes it through the GraphLayout interface.
 */
export class CosmosLayout extends GraphLayout<CosmosLayoutOptions> {
  static defaultOptions: Required<CosmosLayoutOptions> = {
    cosmos: {}
  };

  protected readonly _name = 'CosmosLayout';

  private _graph: Graph | null = null;
  private _cosmos: CosmosLayoutController | null = null;
  private _nodePositions = new Map<string | number, [number, number]>();
  private _edgePositions = new Map<string | number, EdgePosition>();
  private _nodesById = new Map<string | number, Node>();
  private _edgesById = new Map<string | number, Edge>();

  private _handleStart = () => {
    this._onLayoutStart();
  };

  private _handleTick = () => {
    this._refreshPositionsFromCosmos();
    this._onLayoutChange();
  };

  private _handleEnd = () => {
    this._refreshPositionsFromCosmos();
    this._onLayoutDone();
  };

  constructor(options: CosmosLayoutOptions = {}) {
    super({...CosmosLayout.defaultOptions, ...options});
  }

  initializeGraph(graph: Graph): void {
    this._graph = graph;
    this._updateGraphCache(graph);
    const cosmos = this._ensureCosmos();
    cosmos.setOptions?.(this._options.cosmos ?? {});
    cosmos.setGraph(this._toCosmosGraph(graph));
    this._refreshPositionsFromCosmos();
  }

  updateGraph(graph: Graph): void {
    this._graph = graph;
    this._updateGraphCache(graph);
    if (!this._cosmos) {
      return;
    }

    this._cosmos.setOptions?.(this._options.cosmos ?? {});
    this._cosmos.setGraph(this._toCosmosGraph(graph));
    this._refreshPositionsFromCosmos();
  }

  start(): void {
    this._ensureCosmos().start();
  }

  update(): void {
    this._cosmos?.start();
  }

  resume(): void {
    if (this._cosmos?.resume) {
      this._cosmos.resume();
      return;
    }
    this._cosmos?.start();
  }

  stop(): void {
    this._cosmos?.stop?.();
  }

  getNodePosition(node: Node): [number, number] | null {
    return this._nodePositions.get(node.getId()) ?? null;
  }

  getEdgePosition(edge: Edge): EdgePosition | null {
    return this._edgePositions.get(edge.getId()) ?? null;
  }

  lockNodePosition(node: Node, x: number, y: number): void {
    const id = node.getId();
    this._nodePositions.set(id, [x, y]);
    node.setDataProperty?.('x', x);
    node.setDataProperty?.('y', y);
    if (this._cosmos) {
      if ('lockNode' in this._cosmos && typeof this._cosmos.lockNode === 'function') {
        this._cosmos.lockNode(id, {x, y});
      } else if ('pinNode' in this._cosmos && typeof (this._cosmos as any).pinNode === 'function') {
        (this._cosmos as any).pinNode(id, {x, y});
      }
    }
    this._refreshEdgePositions();
    this._onLayoutChange();
    this._onLayoutDone();
  }

  unlockNodePosition(node: Node): void {
    const id = node.getId();
    if (this._cosmos) {
      if ('unlockNode' in this._cosmos && typeof this._cosmos.unlockNode === 'function') {
        this._cosmos.unlockNode(id);
      } else if ('unpinNode' in this._cosmos && typeof (this._cosmos as any).unpinNode === 'function') {
        (this._cosmos as any).unpinNode(id);
      }
    }
  }

  destroy(): void {
    if (this._cosmos) {
      this._detachCosmosEventHandlers(this._cosmos);
      this._cosmos.destroy?.();
      this._cosmos = null;
    }

    this._nodePositions.clear();
    this._edgePositions.clear();
    this._nodesById.clear();
    this._edgesById.clear();
    this._graph = null;
  }

  private _ensureCosmos(): CosmosLayoutController {
    if (this._cosmos) {
      return this._cosmos;
    }

    const cosmos = createCosmosLayout(this._options.cosmos ?? {});
    this._attachCosmosEventHandlers(cosmos);
    this._cosmos = cosmos;
    return cosmos;
  }

  private _attachCosmosEventHandlers(cosmos: CosmosLayoutController) {
    cosmos.on?.('start', this._handleStart);
    cosmos.on?.('tick', this._handleTick);
    cosmos.on?.('end', this._handleEnd);

    if (!cosmos.on && 'addEventListener' in cosmos) {
      (cosmos as any).addEventListener?.('start', this._handleStart);
      (cosmos as any).addEventListener?.('tick', this._handleTick);
      (cosmos as any).addEventListener?.('end', this._handleEnd);
    }
  }

  private _detachCosmosEventHandlers(cosmos: CosmosLayoutController) {
    cosmos.off?.('start', this._handleStart);
    cosmos.off?.('tick', this._handleTick);
    cosmos.off?.('end', this._handleEnd);

    if (!cosmos.off && 'removeEventListener' in cosmos) {
      (cosmos as any).removeEventListener?.('start', this._handleStart);
      (cosmos as any).removeEventListener?.('tick', this._handleTick);
      (cosmos as any).removeEventListener?.('end', this._handleEnd);
    }
  }

  private _updateGraphCache(graph: Graph) {
    const nodes = graph.getNodes();
    const edges = graph.getEdges();
    this._nodesById = new Map(nodes.map((node) => [node.getId(), node]));
    this._edgesById = new Map(edges.map((edge) => [edge.getId(), edge]));

    const validNodeIds = new Set(this._nodesById.keys());
    const validEdgeIds = new Set(this._edgesById.keys());
    this._nodePositions = new Map(
      Array.from(this._nodePositions.entries()).filter(([id]) => validNodeIds.has(id))
    );
    this._edgePositions = new Map(
      Array.from(this._edgePositions.entries()).filter(([id]) => validEdgeIds.has(id))
    );
  }

  private _toCosmosGraph(graph: Graph): CosmosGraph {
    const nodes: CosmosNode[] = graph.getNodes().map((node) => {
      const id = node.getId();
      const x = Number(node.getPropertyValue('x'));
      const y = Number(node.getPropertyValue('y'));
      if (Number.isFinite(x) && Number.isFinite(y)) {
        this._nodePositions.set(id, [x, y]);
      }
      return {
        id,
        position: Number.isFinite(x) && Number.isFinite(y) ? {x, y} : undefined,
        locked: Boolean(node.getPropertyValue('locked'))
      };
    });

    const edges: CosmosEdge[] = graph.getEdges().map((edge) => {
      const rawWeight = (edge as any)?._data?.weight ?? (edge as any)?.weight;
      const weight = Number(rawWeight);

      return {
        id: edge.getId(),
        source: edge.getSourceNodeId(),
        target: edge.getTargetNodeId(),
        weight: Number.isFinite(weight) ? weight : undefined
      };
    });

    return {nodes, edges};
  }

  private _refreshPositionsFromCosmos(): void {
    if (!this._cosmos || !this._graph) {
      return;
    }

    for (const [id, node] of this._nodesById) {
      const position = this._cosmos.getNodePosition?.(id);
      if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
        const coordinates: [number, number] = [position.x, position.y];
        this._nodePositions.set(id, coordinates);
        node.setDataProperty?.('x', position.x);
        node.setDataProperty?.('y', position.y);
      }
    }

    this._refreshEdgePositions();
  }

  private _refreshEdgePositions(): void {
    for (const [edgeId, edge] of this._edgesById) {
      const source = this._nodePositions.get(edge.getSourceNodeId());
      const target = this._nodePositions.get(edge.getTargetNodeId());
      if (source && target) {
        this._edgePositions.set(edgeId, {
          type: 'line',
          sourcePosition: source,
          targetPosition: target,
          controlPoints: []
        });
      } else {
        this._edgePositions.delete(edgeId);
      }
    }
  }
}
