// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutDefaultProps, GraphLayoutProps} from '../../core/graph-layout';
import type {LegacyGraph} from '../../graph/legacy-graph';
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
  } as const satisfies GraphLayoutDefaultProps<D3ForceLayoutOptions>;

  protected readonly _name = 'D3';
  private _positionsByNodeId = new Map();
  private _graph: LegacyGraph | null = null;
  private _worker: any;

  constructor(props: D3ForceLayoutOptions = {}) {
    super(props, D3ForceLayout.defaultProps);
  }

  initializeGraph(graph: LegacyGraph) {
    this.setProps({graph});
  }

  // for streaming new data on the same graph
  protected override updateGraph(graph: LegacyGraph) {
    this._graph = graph;

    this._positionsByNodeId = new Map(
      this._graph
        .getNodes()
        .map((node) => {
          const nodeId = node.getId();
          return [nodeId, this._positionsByNodeId.get(nodeId)];
        })
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

    if (!this._graph) {
      return;
    }

    this._worker = new Worker(new URL('./worker.js', import.meta.url).href);

    const options = (({graph: _graph, ...rest}) => rest)(this.props);

    this._worker.postMessage({
      nodes: this._graph.getNodes().map((node) => {
        const nodeId = node.getId();
        return {
          id: nodeId,
          ...this._positionsByNodeId.get(nodeId)
        };
      }),
      edges: this._graph.getEdges().map((edge) => ({
        id: edge.getId(),
        source: edge.getSourceNodeId(),
        target: edge.getTargetNodeId()
      })),
      options
    });

    this._worker.onmessage = (event) => {
      log.log(0, 'D3ForceLayout: worker message', event.data?.type, event.data);
      if (event.data.type !== 'end') {
        return;
      }

      event.data.nodes.forEach(({id, ...d3}) =>
        this._positionsByNodeId.set(id, {
          ...d3,
          // precompute so that when we return the node position we do not need to do the conversion
          coordinates: [d3.x, d3.y]
        })
      );

      this._onLayoutChange();
      this._onLayoutDone();
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

  getNodePosition = (node) => {
    if (!node) {
      return null;
    }

    const d3Node = this._positionsByNodeId.get(node.getId());
    if (d3Node) {
      return d3Node.coordinates;
    }

    return null;
  };

  lockNodePosition = (node, x, y) => {
    const nodeId = node.getId();
    const d3Node = this._positionsByNodeId.get(nodeId);
    this._positionsByNodeId.set(nodeId, {
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
    const d3Node = this._positionsByNodeId.get(node.getId());
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
}
