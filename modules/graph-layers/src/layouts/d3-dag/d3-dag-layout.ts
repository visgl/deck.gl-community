// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Edge} from '../../graph/edge';
import type {Graph} from '../../graph/graph';
import type {Node} from '../../graph/node';

import {GraphLayout, GraphLayoutOptions} from '../../core/graph-layout';
import {EDGE_TYPE, type ValueOf} from '../../core/constants';

import {
  coordCenter,
  coordGreedy,
  coordQuad,
  dagStratify,
  decrossOpt,
  decrossTwoLayer,
  layeringCoffmanGraham,
  layeringLongestPath,
  layeringSimplex,
  layeringTopological,
  sugiyama
} from 'd3-dag';

export type LayeringPreset = 'longest-path' | 'simplex' | 'topological' | 'coffman-graham';
export type DecrossPreset = 'two-layer' | 'opt';
export type CoordPreset = 'center' | 'greedy' | 'quad';

export type LayeringOperator = ReturnType<typeof layeringSimplex>;
export type DecrossOperator = ReturnType<typeof decrossTwoLayer>;
export type CoordOperator = ReturnType<typeof coordCenter>;

export type D3DagLayoutOptions = GraphLayoutOptions & {
  /** Size (width, height) assigned to each node when running the Sugiyama pipeline. */
  nodeSize?: [number, number];
  /** Layering strategy used by Sugiyama. */
  layering?: LayeringPreset | LayeringOperator;
  /** Decross strategy used by Sugiyama. */
  decross?: DecrossPreset | DecrossOperator;
  /** Coordinate assignment strategy used by Sugiyama. */
  coord?: CoordPreset | CoordOperator;
};

type NodePosition = [number, number];
type EdgeLayout = {
  type: ValueOf<typeof EDGE_TYPE>;
  sourcePosition: NodePosition;
  targetPosition: NodePosition;
  controlPoints: NodePosition[];
};

type DagInputNode = {
  id: string;
  parentIds: string[];
  graphNodeId: string | number;
};

const LAYERING_FACTORIES: Record<LayeringPreset, () => LayeringOperator> = {
  'longest-path': () => layeringLongestPath(),
  simplex: () => layeringSimplex(),
  topological: () => layeringTopological(),
  'coffman-graham': () => layeringCoffmanGraham()
};

const DECROSS_FACTORIES: Record<DecrossPreset, () => DecrossOperator> = {
  'two-layer': () => decrossTwoLayer(),
  opt: () => decrossOpt()
};

const COORD_FACTORIES: Record<CoordPreset, () => CoordOperator> = {
  center: () => coordCenter(),
  greedy: () => coordGreedy(),
  quad: () => coordQuad()
};

export class D3DagLayout extends GraphLayout<D3DagLayoutOptions> {
  static defaultOptions: Required<D3DagLayoutOptions> = {
    nodeSize: [1, 1],
    layering: 'longest-path',
    decross: 'two-layer',
    coord: 'center'
  };

  protected readonly _name = 'D3DagLayout';

  private _graph: Graph | null = null;
  private _dag: ReturnType<ReturnType<typeof dagStratify>> | null = null;
  private _nodePositions = new Map<string | number, NodePosition>();
  private _edgeLayoutById = new Map<string | number, EdgeLayout>();
  private _edgesByEndpoints = new Map<string, Edge[]>();

  constructor(options: D3DagLayoutOptions = {}) {
    super({...D3DagLayout.defaultOptions, ...options});
  }

  initializeGraph(graph: Graph): void {
    this.updateGraph(graph);
  }

  updateGraph(graph: Graph): void {
    this._graph = graph;
    this._nodePositions.clear();
    this._edgeLayoutById.clear();
    try {
      this._edgesByEndpoints = this._buildEdgeBuckets(graph.getEdges());
    } catch (error) {
      this._edgesByEndpoints.clear();
      this._dag = null;
      this._onLayoutError();
      return;
    }
    this._dag = this._buildDag(graph);
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

  getNodePosition = (node: Node): NodePosition | null => {
    return this._nodePositions.get(node.getId()) || null;
  };

  getEdgePosition = (edge: Edge): EdgeLayout | null => {
    return this._edgeLayoutById.get(edge.getId()) || null;
  };

  lockNodePosition = (node: Node, x: number, y: number): void => {
    const updatedPosition: NodePosition = [x, y];
    this._nodePositions.set(node.getId(), updatedPosition);

    node.getConnectedEdges().forEach((edge) => {
      const layout = this._edgeLayoutById.get(edge.getId());
      if (!layout) {
        return;
      }

      const isSource = edge.getSourceNodeId() === node.getId();
      const isTarget = edge.getTargetNodeId() === node.getId();

      const nextLayout: EdgeLayout = {
        ...layout,
        sourcePosition: isSource ? updatedPosition : layout.sourcePosition,
        targetPosition: isTarget ? updatedPosition : layout.targetPosition
      };
      this._edgeLayoutById.set(edge.getId(), nextLayout);
    });

    this._onLayoutChange();
    this._onLayoutDone();
  };

  private _runLayout(): void {
    if (!this._graph) {
      return;
    }

    if (!this._dag) {
      this._onLayoutError();
      return;
    }

    this._onLayoutStart();

    try {
      const pipeline = this._createSugiyamaPipeline();
      pipeline(this._dag);

      this._cacheNodePositions();
      this._cacheEdgeLayouts();

      this._onLayoutChange();
      this._onLayoutDone();
    } catch (error) {
      this._onLayoutError();
    }
  }

  private _createSugiyamaPipeline() {
    const pipeline = sugiyama();

    const nodeSize = this._options.nodeSize || D3DagLayout.defaultOptions.nodeSize;
    pipeline.nodeSize(nodeSize);

    const layering = this._resolveStageOption(
      this._options.layering,
      LAYERING_FACTORIES,
      D3DagLayout.defaultOptions.layering
    );
    pipeline.layering(layering);

    const decross = this._resolveStageOption(
      this._options.decross,
      DECROSS_FACTORIES,
      D3DagLayout.defaultOptions.decross
    );
    pipeline.decross(decross);

    const coord = this._resolveStageOption(
      this._options.coord,
      COORD_FACTORIES,
      D3DagLayout.defaultOptions.coord
    );
    pipeline.coord(coord);

    return pipeline;
  }

  private _resolveStageOption<T, K extends string>(
    value: T | K | undefined,
    factories: Record<K, () => T>,
    fallbackKey: K
  ): T {
    if (!value) {
      return factories[fallbackKey]();
    }

    if (typeof value === 'string') {
      const factory = factories[value];
      if (factory) {
        return factory();
      }
      return factories[fallbackKey]();
    }

    return value;
  }

  private _buildDag(graph: Graph): ReturnType<ReturnType<typeof dagStratify>> | null {
    const nodes = graph.getNodes();
    const parentsById = new Map<string, string[]>();
    nodes.forEach((node) => {
      parentsById.set(this._normalizeId(node.getId()), []);
    });

    for (const edge of graph.getEdges()) {
      if (!edge.isDirected()) {
        throw new Error('D3DagLayout requires directed edges.');
      }

      const sourceId = this._normalizeId(edge.getSourceNodeId());
      const targetId = this._normalizeId(edge.getTargetNodeId());

      const parentList = parentsById.get(targetId);
      if (!parentList) {
        throw new Error(`Edge references missing node: ${targetId}`);
      }

      parentList.push(sourceId);
    }

    const stratifyInput: DagInputNode[] = nodes.map((node) => {
      const normalizedId = this._normalizeId(node.getId());
      return {
        id: normalizedId,
        parentIds: parentsById.get(normalizedId) || [],
        graphNodeId: node.getId()
      };
    });

    try {
      const stratify = dagStratify();
      return stratify(stratifyInput);
    } catch (error) {
      this._onLayoutError();
      return null;
    }
  }

  private _cacheNodePositions(): void {
    this._nodePositions.clear();
    for (const dagNode of this._dag!.descendants()) {
      const data = dagNode.data as DagInputNode;
      this._nodePositions.set(data.graphNodeId, [dagNode.x, dagNode.y]);
    }
  }

  private _cacheEdgeLayouts(): void {
    this._edgeLayoutById.clear();
    const links = this._dag!.links();
    for (const link of links) {
      const sourceData = link.source.data as DagInputNode;
      const targetData = link.target.data as DagInputNode;
      const sourcePosition = this._nodePositions.get(sourceData.graphNodeId);
      const targetPosition = this._nodePositions.get(targetData.graphNodeId);

      if (sourcePosition && targetPosition) {
        const controlPoints: NodePosition[] = (link.points || [])
          .slice(1, -1)
          .map((point: {x: number; y: number}): NodePosition => [point.x, point.y]);

        const type = controlPoints.length ? EDGE_TYPE.PATH : EDGE_TYPE.LINE;
        const layout: EdgeLayout = {
          type,
          sourcePosition,
          targetPosition,
          controlPoints
        };

        const bucketKey = this._edgeKey(sourceData.graphNodeId, targetData.graphNodeId);
        const bucket = this._edgesByEndpoints.get(bucketKey) || [];
        bucket.forEach((edge) => this._edgeLayoutById.set(edge.getId(), layout));
      }
    }
  }

  private _buildEdgeBuckets(edges: Edge[]): Map<string, Edge[]> {
    const buckets = new Map<string, Edge[]>();
    edges.forEach((edge) => {
      if (!edge.isDirected()) {
        throw new Error('D3DagLayout requires directed edges.');
      }
      const key = this._edgeKey(edge.getSourceNodeId(), edge.getTargetNodeId());
      const list = buckets.get(key);
      if (list) {
        list.push(edge);
      } else {
        buckets.set(key, [edge]);
      }
    });
    return buckets;
  }

  private _edgeKey(sourceId: string | number, targetId: string | number): string {
    return `${this._normalizeId(sourceId)}->${this._normalizeId(targetId)}`;
  }

  private _normalizeId(id: string | number): string {
    return String(id);
  }
}
