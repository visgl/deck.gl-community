// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable no-continue, complexity, max-statements */

import {GraphLayout, GraphLayoutOptions} from '../../core/graph-layout';
import type {Graph} from '../../graph/graph';
import {Node} from '../../graph/node';
import {Edge} from '../../graph/edge';
import {
  coordCenter,
  coordGreedy,
  coordQuad,
  coordSimplex,
  coordTopological,
  decrossDfs,
  decrossOpt,
  decrossTwoLayer,
  graph as createDagGraph,
  graphConnect,
  graphStratify,
  grid,
  layeringLongestPath,
  layeringSimplex,
  layeringTopological,
  sugiyama,
  zherebko,
  type Coord,
  type Decross,
  type DefaultGrid,
  type DefaultSugiyama,
  type DefaultZherebko,
  type LayoutResult,
  type MutGraph,
  type MutGraphNode,
  type MutGraphLink,
  type NodeSize
} from 'd3-dag';

export type D3DagLayoutBuilderName = 'sugiyama' | 'grid' | 'zherebko';
export type D3DagLayeringName = 'simplex' | 'longestPath' | 'topological';
export type D3DagDecrossName = 'twoLayer' | 'opt' | 'dfs';
export type D3DagCoordName = 'simplex' | 'greedy' | 'quad' | 'center' | 'topological';
export type D3DagDagBuilderName = 'graph' | 'connect' | 'stratify';
export type D3DagOrientation = 'TB' | 'BT' | 'LR' | 'RL';
export type D3DagCenterOption = boolean | {x?: boolean; y?: boolean};

export type D3DagLayoutOperator =
  | DefaultSugiyama
  | DefaultGrid
  | DefaultZherebko
  | ((dag: MutGraph<Node, Edge>) => LayoutResult);

export type D3DagLayoutOptions = GraphLayoutOptions & {
  /** Which high-level layout operator to use. */
  layout?: D3DagLayoutBuilderName | D3DagLayoutOperator;
  /** Layering operator used by sugiyama layouts. */
  layering?: D3DagLayeringName | LayeringOperator;
  /** Decrossing operator used by sugiyama layouts. */
  decross?: D3DagDecrossName | DecrossOperator;
  /** Coordinate assignment operator used by sugiyama layouts. */
  coord?: D3DagCoordName | CoordOperator;
  /** Node sizing accessor passed to the active layout. */
  nodeSize?: NodeSize<Node, Edge>;
  /** Optional gap between nodes. Alias: separation. */
  gap?: readonly [number, number];
  /** Optional gap between nodes. */
  separation?: readonly [number, number];
  /** Orientation transform applied after the layout finishes. */
  orientation?: D3DagOrientation;
  /** Whether to center the layout along each axis. */
  center?: D3DagCenterOption;
  /** How to convert the Graph into a DAG. */
  dagBuilder?: D3DagDagBuilderName | DagBuilder;
  /** Whether to collapse linear chains of nodes into a single representative. */
  collapseLinearChains?: boolean;
};

type DagBuilder = (graph: Graph) => MutGraph<Node, Edge>;

type LayeringOperator =
  | ReturnType<typeof layeringSimplex>
  | ReturnType<typeof layeringLongestPath>
  | ReturnType<typeof layeringTopological>;
type DecrossOperator =
  | ReturnType<typeof decrossTwoLayer>
  | ReturnType<typeof decrossOpt>
  | ReturnType<typeof decrossDfs>;
type CoordOperator =
  | ReturnType<typeof coordCenter>
  | ReturnType<typeof coordGreedy>
  | ReturnType<typeof coordQuad>
  | ReturnType<typeof coordSimplex>
  | ReturnType<typeof coordTopological>;

type LayoutCallable = (dag: MutGraph<Node, Edge>) => LayoutResult;

type LayoutWithConfiguration = LayoutCallable & {
  layering?: (layer?: any) => any;
  decross?: (decross?: any) => any;
  coord?: (coord?: any) => any;
  nodeSize?: (size?: NodeSize<Node, Edge>) => any;
  gap?: (gap?: readonly [number, number]) => any;
};

type CollapsedChainDescriptor = {
  id: string;
  nodeIds: (string | number)[];
  edgeIds: (string | number)[];
  representativeId: string | number;
};

type DagBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
};

const DEFAULT_NODE_SIZE: readonly [number, number] = [140, 120];
const DEFAULT_GAP: readonly [number, number] = [0, 0];

const LAYERING_FACTORIES: Record<D3DagLayeringName, () => LayeringOperator> = {
  simplex: layeringSimplex,
  longestPath: layeringLongestPath,
  topological: layeringTopological
};

const DECROSS_FACTORIES: Record<D3DagDecrossName, () => DecrossOperator> = {
  twoLayer: decrossTwoLayer,
  opt: decrossOpt,
  dfs: decrossDfs
};

const COORD_FACTORIES: Record<D3DagCoordName, () => CoordOperator> = {
  simplex: coordSimplex,
  greedy: coordGreedy,
  quad: coordQuad,
  center: coordCenter,
  topological: coordTopological
};

const LAYOUT_FACTORIES: Record<D3DagLayoutBuilderName, () => LayoutWithConfiguration> = {
  sugiyama: () => sugiyama(),
  grid: () => grid(),
  zherebko: () => zherebko()
};

const DAG_ID_SEPARATOR = '::';

/**
 * Layout that orchestrates d3-dag operators from declarative options.
 */
export class D3DagLayout extends GraphLayout<D3DagLayoutOptions> {
  static defaultOptions: Required<Omit<D3DagLayoutOptions, 'layout'>> & {layout: D3DagLayoutBuilderName} = {
    layout: 'sugiyama',
    layering: 'topological',
    decross: 'twoLayer',
    coord: 'greedy',
    nodeSize: DEFAULT_NODE_SIZE,
    gap: DEFAULT_GAP,
    separation: DEFAULT_GAP,
    orientation: 'TB',
    center: true,
    dagBuilder: 'graph',
    collapseLinearChains: false
  };

  protected readonly _name = 'D3DagLayout';

  private _graph: Graph | null = null;
  private _dag: MutGraph<Node, Edge> | null = null;
  private _layoutOperator: LayoutWithConfiguration | null = null;
  private _rawNodePositions = new Map<string | number, [number, number]>();
  private _rawEdgePoints = new Map<string | number, [number, number][]>();
  private _nodePositions = new Map<string | number, [number, number]>();
  private _edgePoints = new Map<string | number, [number, number][]>();
  private _edgeControlPoints = new Map<string | number, [number, number][]>();
  private _lockedNodePositions = new Map<string | number, [number, number]>();
  private _bounds: DagBounds | null = null;

  private _nodeLookup = new Map<string | number, Node>();
  private _stringIdLookup = new Map<string, string | number>();
  private _edgeLookup = new Map<string, Edge>();
  private _incomingParentMap = new Map<string | number, (string | number)[]>();
  private _chainDescriptors = new Map<string, CollapsedChainDescriptor>();
  private _nodeToChainId = new Map<string | number, string>();
  private _collapsedChainState = new Map<string, boolean>();
  private _hiddenNodeIds = new Set<string | number>();

  constructor(options: D3DagLayoutOptions = {}) {
    super({...D3DagLayout.defaultOptions, ...options});
  }

  initializeGraph(graph: Graph): void {
    this.updateGraph(graph);
  }

  updateGraph(graph: Graph): void {
    this._graph = graph;
    this._nodeLookup = new Map();
    this._stringIdLookup = new Map();
    this._edgeLookup = new Map();
    this._incomingParentMap = new Map();
    this._chainDescriptors = new Map();
    this._nodeToChainId = new Map();
    this._hiddenNodeIds = new Set();

    for (const node of graph.getNodes()) {
      const id = node.getId();
      const key = this._toDagId(id);
      this._nodeLookup.set(id, node);
      this._stringIdLookup.set(key, id);
    }

    for (const edge of graph.getEdges()) {
      if (!edge.isDirected()) {
        continue;
      }
      const key = this._edgeKey(edge.getSourceNodeId(), edge.getTargetNodeId());
      this._edgeLookup.set(key, edge);

      const targetId = edge.getTargetNodeId();
      const parents = this._incomingParentMap.get(targetId) ?? [];
      parents.push(edge.getSourceNodeId());
      this._incomingParentMap.set(targetId, parents);
    }
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

  toggleCollapsedChain(chainId: string): void {
    if (!this._graph) {
      return;
    }
    if (!this._chainDescriptors.has(chainId)) {
      this._refreshCollapsedChains();
    }
    if (!this._chainDescriptors.has(chainId)) {
      return;
    }
    const collapsed = this._isChainCollapsed(chainId);
    this._collapsedChainState.set(chainId, !collapsed);
    this._runLayout();
  }

  setCollapsedChains(chainIds: Iterable<string>): void {
    if (!this._graph) {
      return;
    }
    if (!this._chainDescriptors.size) {
      this._refreshCollapsedChains();
    }
    const desired = new Set(chainIds);
    let changed = false;
    for (const chainId of this._chainDescriptors.keys()) {
      const next = desired.has(chainId);
      if (this._isChainCollapsed(chainId) !== next) {
        this._collapsedChainState.set(chainId, next);
        changed = true;
      }
    }
    if (changed) {
      this._runLayout();
    }
  }

  setPipelineOptions(options: Partial<D3DagLayoutOptions>): void {
    this._options = {...this._options, ...options};
    if (
      options.layout !== undefined ||
      options.layering !== undefined ||
      options.decross !== undefined ||
      options.coord !== undefined ||
      options.nodeSize !== undefined ||
      options.gap !== undefined ||
      options.separation !== undefined
    ) {
      this._layoutOperator = null;
    }
    if (options.collapseLinearChains !== undefined && this._graph) {
      this._runLayout();
    }
  }

  getNodePosition(node: Node): [number, number] | null {
    if (this._shouldSkipNode(node.getId())) {
      return null;
    }
    const mappedId = this._mapNodeId(node.getId());
    return this._nodePositions.get(mappedId) || null;
  }

  getEdgePosition(edge: Edge):
    | {
        type: string;
        sourcePosition: [number, number];
        targetPosition: [number, number];
        controlPoints: [number, number][];
      }
    | null {
    const mappedSourceId = this._mapNodeId(edge.getSourceNodeId());
    const mappedTargetId = this._mapNodeId(edge.getTargetNodeId());
    if (mappedSourceId === mappedTargetId) {
      return null;
    }

    const sourcePosition = this._nodePositions.get(mappedSourceId);
    const targetPosition = this._nodePositions.get(mappedTargetId);
    if (!sourcePosition || !targetPosition) {
      return null;
    }

    if (!this._edgePoints.has(edge.getId())) {
      return null;
    }

    // const points = this._edgePoints.get(edge.getId()) || [sourcePosition, targetPosition];
    const controlPoints = this._edgeControlPoints.get(edge.getId()) || [];
    const edgeType = controlPoints.length ? 'spline-curve' : 'line';

    return {
      type: edgeType,
      sourcePosition,
      targetPosition,
      controlPoints
    };
  }

  getLinkControlPoints(edge: Edge): [number, number][] {
    return this._edgeControlPoints.get(edge.getId()) || [];
  }

  lockNodePosition(node: Node, x: number, y: number): void {
    this._lockedNodePositions.set(node.getId(), [x, y]);
    this._nodePositions.set(node.getId(), [x, y]);
    this._onLayoutChange();
    this._onLayoutDone();
  }

  unlockNodePosition(node: Node): void {
    this._lockedNodePositions.delete(node.getId());
  }

  private _runLayout(): void {
    if (!this._graph) {
      return;
    }
    this._refreshCollapsedChains();
    this._onLayoutStart();

    try {
      this._dag = this._buildDag();
      const layout = this._getLayoutOperator();
      layout(this._dag);
      this._cacheGeometry();
      this._onLayoutChange();
      this._onLayoutDone();
    } catch (error) {
      this._onLayoutError();
      throw error;
    }
  }

  private _refreshCollapsedChains(): void {
    if (!this._graph) {
      this._chainDescriptors.clear();
      this._nodeToChainId.clear();
      this._hiddenNodeIds.clear();
      return;
    }

    const collapseDefault =
      this._options.collapseLinearChains ?? D3DagLayout.defaultOptions.collapseLinearChains;

    const previousStates = new Map(this._collapsedChainState);

    this._chainDescriptors.clear();
    this._nodeToChainId.clear();
    this._hiddenNodeIds.clear();

    const nodes = this._graph.getNodes();
    const candidateNodes = new Set<string | number>();
    const incomingCache = new Map<string | number, Edge[]>();
    const outgoingCache = new Map<string | number, Edge[]>();

    for (const node of nodes) {
      const incoming = this._getIncomingEdges(node);
      const outgoing = this._getOutgoingEdges(node);
      incomingCache.set(node.getId(), incoming);
      outgoingCache.set(node.getId(), outgoing);
      if (incoming.length <= 1 && outgoing.length <= 1 && incoming.length + outgoing.length > 0) {
        candidateNodes.add(node.getId());
      }
    }

    const visited = new Set<string | number>();
    for (const node of nodes) {
      const nodeId = node.getId();
      if (!candidateNodes.has(nodeId) || visited.has(nodeId)) {
        continue;
      }

      const incoming = incomingCache.get(nodeId) ?? [];
      const hasCandidateParent =
        incoming.length === 1 && candidateNodes.has(incoming[0].getSourceNodeId());
      if (hasCandidateParent) {
        continue;
      }

      const chainNodeIds: (string | number)[] = [];
      const chainEdgeIds: (string | number)[] = [];
      let currentNode: Node | undefined = node;

      while (currentNode) {
        const currentId = currentNode.getId();
        if (!candidateNodes.has(currentId) || visited.has(currentId)) {
          break;
        }

        visited.add(currentId);
        chainNodeIds.push(currentId);

        const outgoing = outgoingCache.get(currentId) ?? [];
        if (outgoing.length !== 1) {
          break;
        }

        const nextEdge = outgoing[0];
        const nextNodeId = nextEdge.getTargetNodeId();
        if (!candidateNodes.has(nextNodeId)) {
          break;
        }

        const nextIncoming = incomingCache.get(nextNodeId) ?? [];
        if (nextIncoming.length !== 1) {
          break;
        }

        chainEdgeIds.push(nextEdge.getId());
        currentNode = this._nodeLookup.get(nextNodeId);
      }

      if (chainNodeIds.length > 1) {
        const chainId = this._createChainId(chainNodeIds);
        const collapsed = previousStates.has(chainId)
          ? previousStates.get(chainId)!
          : collapseDefault;
        this._chainDescriptors.set(chainId, {
          id: chainId,
          nodeIds: chainNodeIds,
          edgeIds: chainEdgeIds,
          representativeId: chainNodeIds[0]
        });
        this._collapsedChainState.set(chainId, collapsed);
        for (const chainNodeId of chainNodeIds) {
          this._nodeToChainId.set(chainNodeId, chainId);
        }
      }
    }

    for (const key of previousStates.keys()) {
      if (!this._chainDescriptors.has(key)) {
        this._collapsedChainState.delete(key);
      }
    }

    this._hiddenNodeIds.clear();
    for (const [chainId, descriptor] of this._chainDescriptors) {
      const collapsed = this._isChainCollapsed(chainId);
      if (collapsed) {
        for (const nodeId of descriptor.nodeIds) {
          if (nodeId !== descriptor.representativeId) {
            this._hiddenNodeIds.add(nodeId);
          }
        }
      }
    }

    this._updateCollapsedChainNodeMetadata();
  }

  private _buildDag(): MutGraph<Node, Edge> {
    const builder = this._options.dagBuilder ?? D3DagLayout.defaultOptions.dagBuilder;

    if (typeof builder === 'function') {
      const dag = builder(this._graph);
      return this._ensureEdgeData(dag);
    }

    switch (builder) {
      case 'connect':
        return this._buildDagWithConnect();
      case 'stratify':
        return this._buildDagWithStratify();
      case 'graph':
      default:
        return this._buildDagWithGraph();
    }
  }

  private _buildDagWithGraph(): MutGraph<Node, Edge> {
    const dag = createDagGraph<Node, Edge>();
    const dagNodeLookup = new Map<string | number, MutGraphNode<Node, Edge>>();

    for (const node of this._graph.getNodes()) {
      if (this._shouldSkipNode(node.getId())) {
        continue;
      }
      const dagNode = dag.node(node);
      dagNodeLookup.set(node.getId(), dagNode);
    }

    for (const edge of this._graph.getEdges()) {
      if (!edge.isDirected()) {
        continue;
      }
      const sourceId = this._mapNodeId(edge.getSourceNodeId());
      const targetId = this._mapNodeId(edge.getTargetNodeId());
      if (sourceId === targetId) {
        continue;
      }
      const source = dagNodeLookup.get(sourceId);
      const target = dagNodeLookup.get(targetId);
      if (!source || !target) {
        continue;
      }
      dag.link(source, target, edge);
    }

    return dag;
  }

  private _buildDagWithConnect(): MutGraph<Node, Edge> {
    type ConnectDatum = {source: string; target: string; edge: Edge};

    const connect = graphConnect()
      .sourceId(({source}: ConnectDatum): string => source)
      .targetId(({target}: ConnectDatum): string => target)
      .nodeDatum((id: string): Node => this._nodeLookup.get(this._fromDagId(id)) ?? new Node({id}))
      .single(true);

    const data: ConnectDatum[] = this._graph
      .getEdges()
      .filter((edge) => edge.isDirected())
      .map((edge) => {
        const sourceId = this._mapNodeId(edge.getSourceNodeId());
        const targetId = this._mapNodeId(edge.getTargetNodeId());
        return {sourceId, targetId, edge};
      })
      .filter(({sourceId, targetId}) => sourceId !== targetId)
      .map(({sourceId, targetId, edge}) => ({
        source: this._toDagId(sourceId),
        target: this._toDagId(targetId),
        edge
      }));

    const dag = connect(data);

    const seenIds = new Set<string | number>();
    for (const dagNode of dag.nodes()) {
      const datum = dagNode.data;
      if (datum instanceof Node) {
        seenIds.add(datum.getId());
      }
    }

    for (const node of this._graph.getNodes()) {
      if (this._shouldSkipNode(node.getId())) {
        continue;
      }
      if (!seenIds.has(node.getId())) {
        dag.node(node);
      }
    }

    return this._ensureEdgeData(dag);
  }

  private _buildDagWithStratify(): MutGraph<Node, Edge> {
    const stratify = graphStratify()
      .id((node: Node): string => this._toDagId(node.getId()))
      .parentIds((node: Node): Iterable<string> => {
        const parentIds = this._incomingParentMap.get(node.getId()) ?? [];
        const mapped = new Set<string>();
        for (const parentId of parentIds) {
          if (!this._nodeLookup.has(parentId)) {
            continue;
          }
          const mappedId = this._mapNodeId(parentId);
          if (mappedId === node.getId()) {
            continue;
          }
          mapped.add(this._toDagId(mappedId));
        }
        return mapped;
      });

    const dag = stratify(this._graph.getNodes().filter((node) => !this._shouldSkipNode(node.getId())));
    return this._ensureEdgeData(dag);
  }

  private _isChainCollapsed(chainId: string): boolean {
    const collapseDefault =
      this._options.collapseLinearChains ?? D3DagLayout.defaultOptions.collapseLinearChains;
    return this._collapsedChainState.get(chainId) ?? collapseDefault;
  }

  private _shouldSkipNode(nodeId: string | number): boolean {
    return this._hiddenNodeIds.has(nodeId);
  }

  private _mapNodeId(nodeId: string | number): string | number {
    const chainId = this._nodeToChainId.get(nodeId);
    if (!chainId) {
      return nodeId;
    }
    const descriptor = this._chainDescriptors.get(chainId);
    if (!descriptor) {
      return nodeId;
    }
    return this._isChainCollapsed(chainId) ? descriptor.representativeId : nodeId;
  }

  private _updateCollapsedChainNodeMetadata(): void {
    if (!this._graph) {
      return;
    }
    for (const node of this._graph.getNodes()) {
      const nodeId = node.getId();
      const chainId = this._nodeToChainId.get(nodeId);
      if (!chainId) {
        node.setDataProperty('collapsedChainId', null);
        node.setDataProperty('collapsedChainLength', 1);
        node.setDataProperty('collapsedNodeIds', []);
        node.setDataProperty('collapsedEdgeIds', []);
        node.setDataProperty('collapsedChainRepresentativeId', null);
        node.setDataProperty('isCollapsedChain', false);
        continue;
      }
      const descriptor = this._chainDescriptors.get(chainId);
      if (!descriptor) {
        node.setDataProperty('collapsedChainId', null);
        node.setDataProperty('collapsedChainLength', 1);
        node.setDataProperty('collapsedNodeIds', []);
        node.setDataProperty('collapsedEdgeIds', []);
        node.setDataProperty('collapsedChainRepresentativeId', null);
        node.setDataProperty('isCollapsedChain', false);
        continue;
      }
      const collapsed = this._isChainCollapsed(chainId);
      node.setDataProperty('collapsedChainId', chainId);
      node.setDataProperty('collapsedChainLength', collapsed ? descriptor.nodeIds.length : 1);
      node.setDataProperty('collapsedNodeIds', descriptor.nodeIds);
      node.setDataProperty('collapsedEdgeIds', descriptor.edgeIds);
      node.setDataProperty('collapsedChainRepresentativeId', descriptor.representativeId);
      node.setDataProperty('isCollapsedChain', collapsed);
    }
  }

  private _createChainId(nodeIds: (string | number)[]): string {
    return `chain:${nodeIds.map((id) => this._toDagId(id)).join('>')}`;
  }

  private _getIncomingEdges(node: Node): Edge[] {
    const nodeId = node.getId();
    return node
      .getConnectedEdges()
      .filter((edge) => edge.isDirected() && edge.getTargetNodeId() === nodeId);
  }

  private _getOutgoingEdges(node: Node): Edge[] {
    const nodeId = node.getId();
    return node
      .getConnectedEdges()
      .filter((edge) => edge.isDirected() && edge.getSourceNodeId() === nodeId);
  }

  private _ensureEdgeData<T>(dag: MutGraph<Node, T>): MutGraph<Node, Edge> {
    for (const link of dag.links()) {
      if (link.data instanceof Edge) {
        continue;
      }
      const sourceNode = link.source.data;
      const targetNode = link.target.data;
      if (!(sourceNode instanceof Node) || !(targetNode instanceof Node)) {
        continue;
      }
      const key = this._edgeKey(sourceNode.getId(), targetNode.getId());
      const edge = this._edgeLookup.get(key);
      if (edge) {
        (link as unknown as MutGraphLink<Node, Edge>).data = edge;
      }
    }

    return dag as unknown as MutGraph<Node, Edge>;
  }

  private _getLayoutOperator(): LayoutWithConfiguration {
    if (this._layoutOperator) {
      return this._layoutOperator;
    }

    const layoutOption = this._options.layout ?? D3DagLayout.defaultOptions.layout;
    let layout: LayoutWithConfiguration;

    if (typeof layoutOption === 'string') {
      layout = LAYOUT_FACTORIES[layoutOption]();
    } else {
      layout = layoutOption as LayoutWithConfiguration;
    }

    if (layout.layering && this._options.layering) {
      layout = layout.layering(this._resolveLayering(this._options.layering));
    }

    if (layout.decross && this._options.decross) {
      layout = layout.decross(this._resolveDecross(this._options.decross));
    }

    if (layout.coord && this._options.coord) {
      layout = layout.coord(this._resolveCoord(this._options.coord));
    }

    const nodeSize = this._options.nodeSize ?? DEFAULT_NODE_SIZE;
    if (layout.nodeSize) {
      layout = layout.nodeSize(nodeSize);
    }

    const gap = this._options.separation ?? this._options.gap ?? DEFAULT_GAP;
    if (layout.gap) {
      layout = layout.gap(gap);
    }

    this._layoutOperator = layout;
    return layout;
  }

  private _resolveLayering(option: D3DagLayeringName | LayeringOperator): LayeringOperator {
    if (typeof option === 'string') {
      return LAYERING_FACTORIES[option]();
    }
    return option;
  }

  private _resolveDecross(option: D3DagDecrossName | DecrossOperator): Decross<Node, Edge> {
    if (typeof option === 'string') {
      return DECROSS_FACTORIES[option]();
    }
    return option;
  }

  private _resolveCoord(option: D3DagCoordName | CoordOperator): Coord<Node, Edge> {
    if (typeof option === 'string') {
      return COORD_FACTORIES[option]();
    }
    return option;
  }

  private _cacheGeometry(): void {
    this._rawNodePositions.clear();
    this._rawEdgePoints.clear();

    if (!this._dag) {
      return;
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const dagNode of this._dag.nodes()) {
      const node = dagNode.data;
      const id = node.getId();
      const x = dagNode.x ?? 0;
      const y = dagNode.y ?? 0;

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      this._rawNodePositions.set(id, [x, y]);
    }

    if (minX === Number.POSITIVE_INFINITY) {
      this._bounds = null;
      this._nodePositions.clear();
      this._edgePoints.clear();
      this._edgeControlPoints.clear();
      return;
    }

    this._bounds = {
      minX,
      maxX,
      minY,
      maxY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    };

    for (const link of this._dag.links()) {
      const source = link.source.data;
      const target = link.target.data;
      const edge = link.data instanceof Edge ? link.data : this._edgeLookup.get(this._edgeKey(source.getId(), target.getId()));
      if (!edge) {
        continue;
      }
      const points = (link.points && link.points.length ? link.points : [[link.source.x ?? 0, link.source.y ?? 0], [link.target.x ?? 0, link.target.y ?? 0]]);
      this._rawEdgePoints.set(edge.getId(), points.map((point) => [...point] as [number, number]));
    }

    this._updateTransformedGeometry();
  }

  private _updateTransformedGeometry(): void {
    this._nodePositions.clear();
    this._edgePoints.clear();
    this._edgeControlPoints.clear();

    if (!this._bounds) {
      return;
    }

    const {offsetX, offsetY} = this._getOffsets();
    const orientation = this._options.orientation ?? D3DagLayout.defaultOptions.orientation;

    const transform = (x: number, y: number): [number, number] => {
      const localX = x - offsetX;
      const localY = y - offsetY;
      switch (orientation) {
        case 'BT':
          return [localX, localY];
        case 'LR':
          return [localY, localX];
        case 'RL':
          return [-localY, localX];
        case 'TB':
        default:
          return [localX, -localY];
      }
    };

    for (const [id, [x, y]] of this._rawNodePositions) {
      this._nodePositions.set(id, transform(x, y));
    }

    for (const [edgeId, points] of this._rawEdgePoints) {
      const transformed = points.map(([x, y]) => transform(x, y));
      this._edgePoints.set(edgeId, transformed);
      this._edgeControlPoints.set(
        edgeId,
        transformed.length > 2 ? transformed.slice(1, -1) : []
      );
    }

    for (const [id, position] of this._lockedNodePositions) {
      this._nodePositions.set(id, position);
    }
  }

  private _getOffsets(): {offsetX: number; offsetY: number} {
    if (!this._bounds) {
      return {offsetX: 0, offsetY: 0};
    }
    const centerOption = this._options.center ?? true;
    let offsetX = 0;
    let offsetY = 0;
    if (centerOption === true) {
      offsetX = this._bounds.centerX;
      offsetY = this._bounds.centerY;
    } else if (centerOption && typeof centerOption === 'object') {
      if (centerOption.x) {
        offsetX = this._bounds.centerX;
      }
      if (centerOption.y) {
        offsetY = this._bounds.centerY;
      }
    }
    return {offsetX, offsetY};
  }

  private _edgeKey(sourceId: string | number, targetId: string | number): string {
    return `${this._toDagId(sourceId)}${DAG_ID_SEPARATOR}${this._toDagId(targetId)}`;
  }

  private _toDagId(id: string | number): string {
    return String(id);
  }

  private _fromDagId(id: string): string | number {
    return this._stringIdLookup.get(id) ?? id;
  }
}
