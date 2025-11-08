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
  }

  start() {
    this._onLayoutStart();
    this._engageWorker();
  }

  update() {
    this._onLayoutStart();
    this._engageWorker();
  }

  _engageWorker(isResume = false) {
    // prevent multiple start
    if (this._worker) {
      this._worker.terminate();
    }

    this._worker = new Worker(new URL('./worker.js', import.meta.url).href);

    const options = isResume
      ? {
          ...this.props,
          alpha: this.props.resumeAlpha
        }
      : this.props;

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
      options
    });

    this._worker.onmessage = (event) => {
      log.log(0, 'D3ForceLayout: worker message', event.data?.type, event.data);
      const {type} = event.data ?? {};
      switch (type) {
        case 'tick':
          this._refreshCachedPositions(event.data.nodes);
          this._onLayoutChange();
          break;
        case 'end':
          this._refreshCachedPositions(event.data.nodes);
          this._onLayoutChange();
          this._onLayoutDone();
          break;
        default:
          break;
      }
    };
  }

  resume() {
    this._onLayoutStart();
    this._engageWorker(true);
  }

  stop() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }

  getEdgePosition = (edge) => {
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

  private _refreshCachedPositions(nodes?: Array<{id: string | number}>) {
    if (!Array.isArray(nodes)) {
      return;
    }

    nodes.forEach((node) => {
      if (!node || node.id === undefined) {
        return;
      }

      const {id, ...rest} = node as {id: string | number; x?: number; y?: number};
      const existing = this._positionsByNodeId.get(id) ?? {};
      const next = {
        ...existing,
        ...rest
      } as {
        x?: number;
        y?: number;
        coordinates?: [number, number];
      };

      if (typeof next.x === 'number' && Number.isFinite(next.x) && typeof next.y === 'number' && Number.isFinite(next.y)) {
        next.coordinates = [next.x, next.y];
      } else if (existing.coordinates) {
        next.coordinates = existing.coordinates;
      }

      this._positionsByNodeId.set(id, next);
    });
  }

  protected override _updateBounds(): void {
    const positions = Array.from(
      this._positionsByNodeId.values(),
      (data) => data?.coordinates as [number, number] | null | undefined
    );
    this._bounds = this._calculateBounds(positions);
  }
}
