// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutProps} from '../../core/graph-layout';
import {log} from '../../utils/log';

export type D3ForceLayoutOptions = GraphLayoutProps & {
  alpha?: number;
  resumeAlpha?: number;
  nBodyStrength?: number;
  nBodyDistanceMin?: number;
  nBodyDistanceMax?: number;
  getCollisionRadius?: number;
};

export class D3ForceLayout extends GraphLayout<D3ForceLayoutOptions> {
  static defaultProps = {
    alpha: 0.3,
    resumeAlpha: 0.1,
    nBodyStrength: -900,
    nBodyDistanceMin: 100,
    nBodyDistanceMax: 400,
    getCollisionRadius: 0
  } as const satisfies Readonly<Required<D3ForceLayoutOptions>>;

  protected readonly _name = 'D3';
  private _positionsByNodeId = new Map();
  private _edgePositionsById = new Map();
  private _graph: any;
  private _worker: any;

  constructor(props?: D3ForceLayoutOptions) {
    super({
      ...D3ForceLayout.defaultProps,
      ...props
    });
  }

  initializeGraph(graph) {
    this._graph = graph;
  }

  // for streaming new data on the same graph
  updateGraph(graph) {
    this._graph = graph;

    this._positionsByNodeId = new Map(
      this._graph.getNodes().map((node) => [node.id, this._positionsByNodeId.get(node.id)])
    );

    this._edgePositionsById = new Map(
      this._graph.getEdges().map((edge) => [edge.id, this._edgePositionsById.get(edge.id)])
    );
  }

  start() {
    this._engageWorker();

    this._onLayoutStart();
  }

  update() {
    this._engageWorker();
  }

  _engageWorker() {
    // prevent multiple start
    if (this._worker) {
      this._worker.terminate();
    }

    this._worker = new Worker(new URL('./worker.js', import.meta.url).href);

    this._edgePositionsById.clear();

    this._worker.postMessage({
      nodes: this._graph.getNodes().map((node) => ({
        id: node.id,
        ...this._positionsByNodeId.get(node.id)
      })),
      edges: this._graph.getEdges().map((edge) => ({
        id: edge.id,
        source: edge.getSourceNodeId(),
        target: edge.getTargetNodeId()
      })),
      options: this.props
    });

    this._worker.onmessage = (event) => {
      log.log(0, 'D3ForceLayout: worker message', event.data?.type, event.data);

      const {type} = event.data ?? {};
      if (type === 'tick' || type === 'end') {
        const didUpdate = this._applyWorkerUpdate(event.data);

        if (didUpdate) {
          this._onLayoutChange();
        }

        if (type === 'end') {
          this._onLayoutDone();
        }
      }
    };
  }

  resume() {
    throw new Error('Resume unavailable');
  }

  stop() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }

  getEdgePosition = (edge) => {
    const cachedEdge = this._edgePositionsById.get(edge.id);
    if (cachedEdge?.sourcePosition && cachedEdge?.targetPosition) {
      return cachedEdge;
    }

    const sourceNode = this._graph.findNode(edge.getSourceNodeId());
    const targetNode = this._graph.findNode(edge.getTargetNodeId());
    if (!sourceNode || !targetNode) {
      return null;
    }

    const sourcePosition = this.getNodePosition(sourceNode);
    const targetPosition = this.getNodePosition(targetNode);

    if (!sourcePosition || !targetPosition) {
      return null;
    }

    return {
      type: 'line',
      sourcePosition,
      targetPosition,
      controlPoints: []
    };
  };

  getNodePosition = (node) => {
    if (!node) {
      return null;
    }

    const d3Node = this._positionsByNodeId.get(node.id);
    if (d3Node) {
      return d3Node.coordinates;
    }

    return null;
  };

  lockNodePosition = (node, x, y) => {
    const d3Node = this._positionsByNodeId.get(node.id);
    this._positionsByNodeId.set(node.id, {
      ...d3Node,
      x,
      y,
      fx: x,
      fy: y,
      coordinates: [x, y]
    });
    this._onLayoutChange();
    this._onLayoutDone();
  };

  unlockNodePosition = (node) => {
    const d3Node = this._positionsByNodeId.get(node.id);
    d3Node.fx = null;
    d3Node.fy = null;
  };

  protected override _updateBounds(): void {
    const positions = Array.from(
      this._positionsByNodeId.values(),
      (data) => data?.coordinates as [number, number] | null | undefined
    );
    this._bounds = this._calculateBounds(positions);
  }

  private _applyWorkerUpdate(data: any): boolean {
    const nodesUpdated = this._updateNodesFromWorker(data?.nodes);
    const edgesUpdated = this._updateEdgesFromWorker(data?.edges);

    return nodesUpdated || edgesUpdated;
  }

  private _updateNodesFromWorker(nodes: unknown): boolean {
    if (!Array.isArray(nodes)) {
      return false;
    }

    let updated = false;

    for (const rawNode of nodes) {
      if (this._isValidNodeUpdate(rawNode)) {
        const {id, x, y, ...rest} = rawNode;

        this._positionsByNodeId.set(id, {
          ...rest,
          id,
          x,
          y,
          coordinates: [x, y]
        });
        updated = true;
      }
    }

    return updated;
  }

  private _updateEdgesFromWorker(edges: unknown): boolean {
    if (!Array.isArray(edges)) {
      return false;
    }

    let updated = false;

    for (const rawEdge of edges) {
      if (this._isValidEdgeUpdate(rawEdge)) {
        const {id, sourcePosition, targetPosition, controlPoints = []} = rawEdge;

        this._edgePositionsById.set(id, {
          type: 'line',
          sourcePosition,
          targetPosition,
          controlPoints
        });
        updated = true;
      }
    }

    return updated;
  }

  private _isValidNodeUpdate(value: unknown): value is {
    id: string | number;
    x: number;
    y: number;
    [key: string]: unknown;
  } {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as {id?: unknown; x?: unknown; y?: unknown};
    return (
      (typeof candidate.id === 'string' || typeof candidate.id === 'number') &&
      this._isFinite(candidate.x) &&
      this._isFinite(candidate.y)
    );
  }

  private _isValidEdgeUpdate(value: unknown): value is {
    id: string | number;
    sourcePosition: [number, number];
    targetPosition: [number, number];
    controlPoints?: [number, number][];
  } {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as {
      id?: unknown;
      sourcePosition?: unknown;
      targetPosition?: unknown;
    };

    const hasValidId = typeof candidate.id === 'string' || typeof candidate.id === 'number';
    return (
      hasValidId &&
      this._isValidWorkerPosition(candidate.sourcePosition) &&
      this._isValidWorkerPosition(candidate.targetPosition)
    );
  }

  private _isValidWorkerPosition(position: unknown): position is [number, number] {
    if (!Array.isArray(position) || position.length < 2) {
      return false;
    }

    const [x, y] = position as [unknown, unknown];
    return this._isFinite(x) && this._isFinite(y);
  }

  private _isFinite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }
}
