// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutProps} from '../../core/graph-layout';
import type {Graph, NodeInterface, EdgeInterface} from '../../graph/graph';
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
    ...GraphLayout.defaultProps,
    alpha: 0.3,
    resumeAlpha: 0.1,
    nBodyStrength: -900,
    nBodyDistanceMin: 100,
    nBodyDistanceMax: 400,
    getCollisionRadius: 0
  } as const satisfies Readonly<Required<D3ForceLayoutOptions>>;

  protected readonly _name = 'D3';
  private _positionsByNodeId = new Map<string | number, any>();
  private _graph: Graph | null = null;
  private _worker: Worker | null = null;

  constructor(props?: D3ForceLayoutOptions) {
    super(props, D3ForceLayout.defaultProps);
  }

  initializeGraph(graph: Graph) {
    this._graph = graph;
  }

  // for streaming new data on the same graph
  updateGraph(graph: Graph) {
    this._graph = graph;

    this._positionsByNodeId = new Map(
      Array.from(this._graph.getNodes(), node => {
        const id = node.getId();
        return [id, this._positionsByNodeId.get(id)];
      })
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

    if (!this._graph) {
      return;
    }

    this._worker = new Worker(new URL('./worker.js', import.meta.url).href);

    const options = {
      ...this.props,
      ...(isResume ? {alpha: this.props.resumeAlpha} : {})
    };
    delete options.onLayoutStart;
    delete options.onLayoutChange;
    delete options.onLayoutDone;
    delete options.onLayoutError;

    this._worker.postMessage({
      nodes: Array.from(this._graph.getNodes(), node => {
        const id = node.getId();
        return {
          id,
          ...this._positionsByNodeId.get(id)
        };
      }),
      edges: Array.from(this._graph.getEdges(), edge => ({
        id: edge.getId(),
        source: edge.getSourceNodeId(),
        target: edge.getTargetNodeId()
      })),
      options
    });

    this._worker.onmessage = event => {
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

  getEdgePosition = (edge: EdgeInterface) => {
    if (!this._graph) {
      return null;
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

  getNodePosition = (node: NodeInterface | null) => {
    if (!node) {
      return null;
    }

    const d3Node = this._positionsByNodeId.get(node.getId());
    if (d3Node) {
      return d3Node.coordinates;
    }

    return null;
  };

  lockNodePosition = (node: NodeInterface, x: number, y: number) => {
    const id = node.getId();
    const d3Node = this._positionsByNodeId.get(id);
    this._positionsByNodeId.set(id, {
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

  unlockNodePosition = (node: NodeInterface) => {
    const id = node.getId();
    const d3Node = this._positionsByNodeId.get(id);
    if (!d3Node) {
      return;
    }
    d3Node.fx = null;
    d3Node.fy = null;
  };

  private _refreshCachedPositions(nodes?: Array<{id: string | number}>) {
    if (!Array.isArray(nodes)) {
      return;
    }

    nodes.forEach(node => {
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

      if (
        typeof next.x === 'number' &&
        Number.isFinite(next.x) &&
        typeof next.y === 'number' &&
        Number.isFinite(next.y)
      ) {
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
      data => data?.coordinates as [number, number] | null | undefined
    );
    this._bounds = this._calculateBounds(positions);
  }
}
