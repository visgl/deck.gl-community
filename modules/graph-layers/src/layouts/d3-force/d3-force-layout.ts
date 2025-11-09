// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutProps} from '../../core/graph-layout';
import type {
  GraphLayoutEdgeColumns,
  GraphLayoutNodeColumns,
  GraphLayoutNodeUpdateTable,
  GraphLayoutUpdates,
  GraphLayoutColumn
} from '../../core/graph-layout';
import {log} from '../../utils/log';
import type {Graph} from '../../graph/graph';
import type {Node as GraphNode} from '../../graph/node';
import type {Edge as GraphEdge} from '../../graph/edge';

type CachedNode = {
  id: string | number;
  x: number;
  y: number;
  coordinates: [number, number];
} & Record<string, unknown>;

type CachedEdge = {
  type: 'line';
  sourcePosition: [number, number];
  targetPosition: [number, number];
  controlPoints: [number, number][];
};

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
  private _positionsByNodeId = new Map<string | number, CachedNode>();
  private _edgePositionsById = new Map<string | number, CachedEdge>();
  private _graph: Graph | null = null;
  private _worker: Worker | null = null;

  constructor(props?: D3ForceLayoutOptions) {
    super({
      ...D3ForceLayout.defaultProps,
      ...props
    });
  }

  initializeGraph(graph: Graph) {
    this._graph = graph;
  }

  // for streaming new data on the same graph
  updateGraph(graph: Graph) {
    this._graph = graph;

    const nextNodePositions = new Map<string | number, CachedNode>();
    for (const node of this._graph.getNodes()) {
      const cached = this._positionsByNodeId.get(node.id);
      if (cached) {
        nextNodePositions.set(node.id, cached);
      }
    }
    this._positionsByNodeId = nextNodePositions;

    const nextEdgePositions = new Map<string | number, CachedEdge>();
    for (const edge of this._graph.getEdges()) {
      const cached = this._edgePositionsById.get(edge.id);
      if (cached) {
        nextEdgePositions.set(edge.id, cached);
      }
    }
    this._edgePositionsById = nextEdgePositions;
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

    const graph = this._graph;
    if (!graph) {
      return;
    }

    this._worker = new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'});

    this._edgePositionsById.clear();

    this._worker.postMessage({
      nodes: graph.getNodes().map((node) => ({
        id: node.id,
        ...this._positionsByNodeId.get(node.id)
      })),
      edges: graph.getEdges().map((edge) => ({
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
        const didUpdate = this.applyGraphLayoutUpdates({
          nodes: event.data?.nodes,
          edges: event.data?.edges
        });

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

  getEdgePosition = (edge: GraphEdge) => {
    const cachedEdge = this._edgePositionsById.get(edge.id);
    if (cachedEdge?.sourcePosition && cachedEdge?.targetPosition) {
      return cachedEdge;
    }

    const sourceNode = this._graph?.findNode(edge.getSourceNodeId());
    const targetNode = this._graph?.findNode(edge.getTargetNodeId());
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

  getNodePosition = (node: GraphNode) => {
    if (!node) {
      return null;
    }

    const d3Node = this._positionsByNodeId.get(node.id);
    if (d3Node) {
      return d3Node.coordinates;
    }

    return null;
  };

  lockNodePosition = (node: GraphNode, x: number, y: number) => {
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

  unlockNodePosition = (node: GraphNode) => {
    const d3Node = this._positionsByNodeId.get(node.id);
    if (d3Node) {
      d3Node.fx = null;
      d3Node.fy = null;
    }
  };

  protected override _updateBounds(): void {
    const graph = this._graph;

    if (graph) {
      const nodeMap = graph.getNodeMap();
      const positions = Array.from(this._positionsByNodeId.entries(), ([id, cached]) =>
        nodeMap[id] ? cached.coordinates : null
      );
      this._bounds = this._calculateBounds(positions);
      return;
    }

    const cachedPositions = Array.from(
      this._positionsByNodeId.values(),
      (data) => data?.coordinates ?? null
    );
    this._bounds = this._calculateBounds(cachedPositions);
  }

  protected override _applyNodeUpdates(nodes: GraphLayoutUpdates['nodes']): boolean {
    const normalized = this._normalizeNodeUpdates(nodes);
    if (!normalized) {
      return false;
    }

    const {length, idColumn, xColumn, yColumn, extraColumns} = normalized;

    let updated = false;

    for (let index = 0; index < length; ++index) {
      const id = this._getIdFromColumn(idColumn, index);
      const x = xColumn[index];
      const y = yColumn[index];

      if (id === null || !this._isFinite(x) || !this._isFinite(y)) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const nodeData = this._createNodeCache(id, x, y);
      this._assignNodeExtraColumns(nodeData, extraColumns, index);
      this._positionsByNodeId.set(id, nodeData);
      updated = true;
    }

    return updated;
  }

  protected override _applyEdgeUpdates(edges: GraphLayoutUpdates['edges']): boolean {
    const normalized = this._normalizeEdgeUpdates(edges);
    if (!normalized) {
      return false;
    }

    const {
      length,
      idColumn,
      sourceXColumn,
      sourceYColumn,
      targetXColumn,
      targetYColumn,
      controlPointsColumn
    } = normalized;

    let updated = false;

    for (let index = 0; index < length; ++index) {
      const id = this._getIdFromColumn(idColumn, index);
      const sourceX = sourceXColumn[index];
      const sourceY = sourceYColumn[index];
      const targetX = targetXColumn[index];
      const targetY = targetYColumn[index];

      if (
        id === null ||
        !this._isFinite(sourceX) ||
        !this._isFinite(sourceY) ||
        !this._isFinite(targetX) ||
        !this._isFinite(targetY)
      ) {
        // eslint-disable-next-line no-continue
        continue;
      }

      this._edgePositionsById.set(id, {
        type: 'line',
        sourcePosition: [sourceX, sourceY],
        targetPosition: [targetX, targetY],
        controlPoints: this._extractControlPoints(controlPointsColumn, index)
      });
      updated = true;
    }

    return updated;
  }

  private _getIdFromColumn(column: GraphLayoutNodeUpdateTable['columns']['id'], index: number):
    | string
    | number
    | null {
    const value = column[index] as unknown;
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return null;
  }

  private _getColumnValue(column: GraphLayoutColumn, index: number): unknown {
    if (column instanceof Float64Array) {
      return column[index];
    }
    if (Array.isArray(column)) {
      return column[index];
    }
    return undefined;
  }

  private _isFinite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private _normalizeNodeUpdates(
    nodes: GraphLayoutUpdates['nodes']
  ): {
    length: number;
    idColumn: GraphLayoutNodeColumns['id'];
    xColumn: Float64Array;
    yColumn: Float64Array;
    extraColumns: [string, GraphLayoutColumn | undefined][];
  } | null {
    if (!nodes || typeof nodes !== 'object') {
      return null;
    }

    const {length, columns} = nodes;
    if (!this._hasPositiveLength(length) || !columns || !this._hasRequiredNodeColumns(columns)) {
      return null;
    }

    const {id, x, y, ...rest} = columns;

    return {
      length,
      idColumn: id,
      xColumn: x,
      yColumn: y,
      extraColumns: Object.entries(rest)
    };
  }

  private _normalizeEdgeUpdates(
    edges: GraphLayoutUpdates['edges']
  ): {
    length: number;
    idColumn: GraphLayoutEdgeColumns['id'];
    sourceXColumn: Float64Array;
    sourceYColumn: Float64Array;
    targetXColumn: Float64Array;
    targetYColumn: Float64Array;
    controlPointsColumn?: GraphLayoutEdgeColumns['controlPoints'];
  } | null {
    if (!edges || typeof edges !== 'object') {
      return null;
    }

    const {length, columns} = edges;
    if (!this._hasPositiveLength(length) || !columns || !this._hasRequiredEdgeColumns(columns)) {
      return null;
    }

    const {id, sourceX, sourceY, targetX, targetY, controlPoints} = columns;

    return {
      length,
      idColumn: id,
      sourceXColumn: sourceX,
      sourceYColumn: sourceY,
      targetXColumn: targetX,
      targetYColumn: targetY,
      controlPointsColumn: Array.isArray(controlPoints)
        ? (controlPoints as GraphLayoutEdgeColumns['controlPoints'])
        : undefined
    };
  }

  private _createNodeCache(id: string | number, x: number, y: number): CachedNode {
    return {
      id,
      x,
      y,
      coordinates: [x, y]
    };
  }

  private _assignNodeExtraColumns(
    target: CachedNode,
    columns: [string, GraphLayoutColumn | undefined][],
    index: number
  ): void {
    for (const [columnName, columnValues] of columns) {
      if (!columnValues) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const value = this._getColumnValue(columnValues, index);
      target[columnName] =
        columnValues instanceof Float64Array && Number.isNaN(value as number) ? null : value;
    }
  }

  private _extractControlPoints(
    column: GraphLayoutEdgeColumns['controlPoints'],
    index: number
  ): [number, number][] {
    if (!Array.isArray(column)) {
      return [];
    }

    const value = column[index];
    return Array.isArray(value) ? (value as [number, number][]) : [];
  }

  private _hasPositiveLength(length: number): boolean {
    return Number.isFinite(length) && length > 0;
  }

  private _hasRequiredNodeColumns(
    columns: GraphLayoutNodeColumns
  ): columns is GraphLayoutNodeColumns & Required<Pick<GraphLayoutNodeColumns, 'id' | 'x' | 'y'>> {
    return Boolean(columns.id && columns.x && columns.y);
  }

  private _hasRequiredEdgeColumns(
    columns: GraphLayoutEdgeColumns
  ): columns is GraphLayoutEdgeColumns &
    Required<Pick<GraphLayoutEdgeColumns, 'id' | 'sourceX' | 'sourceY' | 'targetX' | 'targetY'>> {
    return Boolean(columns.id && columns.sourceX && columns.sourceY && columns.targetX && columns.targetY);
  }
}
