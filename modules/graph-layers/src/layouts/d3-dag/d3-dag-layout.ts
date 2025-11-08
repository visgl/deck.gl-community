// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable no-continue, complexity, max-statements */

import {GraphLayout, GraphLayoutProps} from '../../core/graph-layout';
import type {LegacyGraph} from '../../graph/legacy-graph';
import type {NodeInterface, EdgeInterface} from '../../graph/graph';
import {Node} from '../../graph/node';
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
  // type Coord,
  // type Decross,
  type DefaultGrid,
  type DefaultSugiyama,
  type DefaultZherebko,
  type LayoutResult,
  type MutGraph,
  type MutGraphNode,
  type MutGraphLink,
  type NodeSize
} from 'd3-dag';
import {log} from '../../utils/log';

export type D3DagLayoutProps = GraphLayoutProps & {
  /** Which high-level layout operator to use. */
  layout?: 'sugiyama' | 'grid' | 'zherebko';
  /** Layering operator used by sugiyama layouts. */
  layering?: 'simplex' | 'longestPath' | 'topological';
  /** Accessor for node rank for layering */
  nodeRank?: string | ((node: NodeInterface) => number | undefined);
  /** Decrossing operator used by sugiyama layouts. */
  decross?: 'twoLayer' | 'opt' | 'dfs';
  /** Coordinate assignment operator used by sugiyama layouts. */
  coord?: 'simplex' | 'greedy' | 'quad' | 'center' | 'topological';
  /** Node sizing accessor passed to the active layout. */
  nodeSize?: NodeSize<NodeInterface, EdgeInterface>;
  /** Optional gap between nodes. Alias: separation. */
  gap?: readonly [number, number];
  /** Optional gap between nodes. */
  separation?: readonly [number, number];
  /** Orientation transform applied after the layout finishes. */
  orientation?: 'TB' | 'BT' | 'LR' | 'RL';
  /** Whether to center the layout along each axis. */
  center?: boolean | {x?: boolean; y?: boolean};
  /** How to convert the Graph into a DAG. */
  dagBuilder?: 'graph' | 'connect' | 'stratify';

  customDagBuilder?: DagBuilder;
  customLayout?: D3DagLayoutOperator;
  customLayering?: LayeringOperator;
  customDecross?: DecrossOperator;
  customCoord?: CoordOperator;
};

export type D3DagLayoutOperator =
  | DefaultSugiyama
  | DefaultGrid
  | DefaultZherebko
  | ((dag: MutGraph<NodeInterface, EdgeInterface>) => LayoutResult);

type DagBuilder = (graph: LegacyGraph) => MutGraph<NodeInterface, EdgeInterface>;

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

type LayoutCallable = (dag: MutGraph<NodeInterface, EdgeInterface>) => LayoutResult;

type LayoutWithConfiguration = LayoutCallable & {
  layering?: (layer?: any) => any;
  decross?: (decross?: any) => any;
  coord?: (coord?: any) => any;
  nodeSize?: (size?: NodeSize<NodeInterface, EdgeInterface>) => any;
  gap?: (gap?: readonly [number, number]) => any;
};

type DagBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
};

const DAG_ID_SEPARATOR = '::';

const DEFAULT_NODE_SIZE: readonly [number, number] = [140, 120];
const DEFAULT_GAP: readonly [number, number] = [0, 0];

const LAYERING_FACTORIES = {
  simplex: layeringSimplex,
  longestPath: layeringLongestPath,
  topological: layeringTopological
} as const satisfies Record<string, () => LayeringOperator>;

const DECROSS_FACTORIES = {
  twoLayer: decrossTwoLayer,
  opt: decrossOpt,
  dfs: decrossDfs
} as const satisfies Record<string, () => DecrossOperator>;

const COORD_FACTORIES = {
  simplex: coordSimplex,
  greedy: coordGreedy,
  quad: coordQuad,
  center: coordCenter,
  topological: coordTopological
} as const satisfies Record<string, () => CoordOperator>;

const LAYOUT_FACTORIES = {
  sugiyama: () => sugiyama(),
  grid: () => grid(),
  zherebko: () => zherebko()
} as const satisfies Record<string, () => LayoutWithConfiguration>;

function isNodeInterface(value: unknown): value is NodeInterface {
  return Boolean(value) && typeof value === 'object' && (value as NodeInterface).isNode === true;
}

function isEdgeInterface(value: unknown): value is EdgeInterface {
  return Boolean(value) && typeof value === 'object' && (value as EdgeInterface).isEdge === true;
}

/**
 * Layout that orchestrates d3-dag operators from declarative options.
 */
export class D3DagLayout<PropsT extends D3DagLayoutProps = D3DagLayoutProps> extends GraphLayout<PropsT> {
  static defaultProps: Readonly<Required<D3DagLayoutProps>> = {
    layout: 'sugiyama',
    layering: 'topological',
    decross: 'twoLayer',
    coord: 'greedy',
    nodeRank: undefined,
    nodeSize: DEFAULT_NODE_SIZE,
    gap: DEFAULT_GAP,
    separation: DEFAULT_GAP,
    orientation: 'TB',
    center: true,
    dagBuilder: 'graph',

    customLayout: undefined,
    customLayering: undefined,
    customDecross: undefined,
    customCoord: undefined,
    customDagBuilder: undefined
  } as const;

  protected readonly _name = 'D3DagLayout';

  protected _graph: LegacyGraph | null = null;
  private _dag: MutGraph<NodeInterface, EdgeInterface> | null = null;
  private _layoutOperator: LayoutWithConfiguration | null = null;
  private _rawNodePositions = new Map<string | number, [number, number]>();
  private _rawEdgePoints = new Map<string | number, [number, number][]>();
  private _nodePositions = new Map<string | number, [number, number]>();
  private _edgePoints = new Map<string | number, [number, number][]>();
  private _edgeControlPoints = new Map<string | number, [number, number][]>();
  private _lockedNodePositions = new Map<string | number, [number, number]>();
  private _dagBounds: DagBounds | null = null;

  protected _nodeLookup = new Map<string | number, NodeInterface>();
  protected _stringIdLookup = new Map<string, string | number>();
  protected _edgeLookup = new Map<string, EdgeInterface>();
  protected _incomingParentMap = new Map<string | number, (string | number)[]>();

  constructor(props: D3DagLayoutProps, defaultProps?: Required<PropsT>) {
    // @ts-expect-error TS2345 - Type 'Required<D3DagLayoutProps>' is not assignable to type 'Required<PropsT>'.
    super(props, defaultProps || D3DagLayout.defaultProps);
  }

  setProps(options: Partial<D3DagLayoutProps>): void {
    this.props = {...this.props, ...options};
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
  }


  initializeGraph(graph: LegacyGraph): void {
    this.updateGraph(graph);
  }

  updateGraph(graph: LegacyGraph): void {
    this._graph = graph;
    this._nodeLookup = new Map();
    this._stringIdLookup = new Map();
    this._edgeLookup = new Map();
    this._incomingParentMap = new Map();

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
    log.log(1, `D3DagLayout: toggleCollapsedChain(${chainId}) ignored (collapsing disabled)`);
  }

  setCollapsedChains(chainIds: Iterable<string>): void {
    const desired = Array.isArray(chainIds) ? chainIds : Array.from(chainIds);
    log.log(1, `D3DagLayout: setCollapsedChains(${desired.length}) ignored (collapsing disabled)`);
  }

  getNodePosition(node: NodeInterface): [number, number] | null {
    if (this._shouldSkipNode(node.getId())) {
      return null;
    }
    const mappedId = this._mapNodeId(node.getId());
    return this._nodePositions.get(mappedId) || null;
  }

  getEdgePosition(edge: EdgeInterface):
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

  getLinkControlPoints(edge: EdgeInterface): [number, number][] {
    return this._edgeControlPoints.get(edge.getId()) || [];
  }

  lockNodePosition(node: NodeInterface, x: number, y: number): void {
    this._lockedNodePositions.set(node.getId(), [x, y]);
    this._nodePositions.set(node.getId(), [x, y]);
    this._onLayoutChange();
    this._onLayoutDone();
  }

  unlockNodePosition(node: NodeInterface): void {
    this._lockedNodePositions.delete(node.getId());
  }

  protected _runLayout(): void {
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

  protected _refreshCollapsedChains(): void {
    this._updateCollapsedChainNodeMetadata();
  }

  private _buildDag(): MutGraph<NodeInterface, EdgeInterface> {
    if (this.props.customDagBuilder) {
      const dag = this.props.customDagBuilder(this._graph);
      return this._ensureEdgeData(dag);
    }

    switch (this.props.dagBuilder) {
      case 'connect':
        return this._buildDagWithConnect();
      case 'stratify':
        return this._buildDagWithStratify();
      case 'graph':
      default:
        return this._buildDagWithGraph();
    }
  }

  private _buildDagWithGraph(): MutGraph<NodeInterface, EdgeInterface> {
    const dag = createDagGraph<NodeInterface, EdgeInterface>();
    const dagNodeLookup = new Map<string | number, MutGraphNode<NodeInterface, EdgeInterface>>();

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

  private _buildDagWithConnect(): MutGraph<NodeInterface, EdgeInterface> {
    type ConnectDatum = {source: string; target: string; edge: EdgeInterface};

    const connect = graphConnect()
      .sourceId(({source}: ConnectDatum): string => source)
      .targetId(({target}: ConnectDatum): string => target)
      .nodeDatum((id: string): NodeInterface => this._nodeLookup.get(this._fromDagId(id)) ?? new Node({id}))
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
      if (isNodeInterface(datum)) {
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

  private _buildDagWithStratify(): MutGraph<NodeInterface, EdgeInterface> {
    const stratify = graphStratify()
      .id((node: NodeInterface): string => this._toDagId(node.getId()))
      .parentIds((node: NodeInterface): Iterable<string> => {
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

  protected _shouldSkipNode(_nodeId: string | number): boolean {
    return false;
  }

  protected _mapNodeId(nodeId: string | number): string | number {
    return nodeId;
  }

  protected _updateCollapsedChainNodeMetadata(): void {
    if (!this._graph) {
      return;
    }
    for (const node of this._graph.getNodes()) {
      node.setDataProperty('collapsedChainId', null);
      node.setDataProperty('collapsedChainLength', 1);
      node.setDataProperty('collapsedNodeIds', []);
      node.setDataProperty('collapsedEdgeIds', []);
      node.setDataProperty('collapsedChainRepresentativeId', null);
      node.setDataProperty('isCollapsedChain', false);
    }
  }

  protected _getIncomingEdges(node: NodeInterface): EdgeInterface[] {
    const nodeId = node.getId();
    return node
      .getConnectedEdges()
      .filter((edge) => edge.isDirected() && edge.getTargetNodeId() === nodeId);
  }

  protected _getOutgoingEdges(node: NodeInterface): EdgeInterface[] {
    const nodeId = node.getId();
    return node
      .getConnectedEdges()
      .filter((edge) => edge.isDirected() && edge.getSourceNodeId() === nodeId);
  }

  private _ensureEdgeData<T>(dag: MutGraph<NodeInterface, T>): MutGraph<NodeInterface, EdgeInterface> {
    for (const link of dag.links()) {
      if (isEdgeInterface(link.data)) {
        continue;
      }
      const sourceNode = link.source.data;
      const targetNode = link.target.data;
      if (!isNodeInterface(sourceNode) || !isNodeInterface(targetNode)) {
        continue;
      }
      const key = this._edgeKey(sourceNode.getId(), targetNode.getId());
      const edge = this._edgeLookup.get(key);
      if (edge) {
        (link as unknown as MutGraphLink<NodeInterface, EdgeInterface>).data = edge;
      }
    }

    return dag as unknown as MutGraph<NodeInterface, EdgeInterface>;
  }

  private _getLayoutOperator(): LayoutWithConfiguration {
    if (this._layoutOperator) {
      return this._layoutOperator;
    }

    const layoutOption = this.props.layout ?? D3DagLayout.defaultProps.layout;
    let layout: LayoutWithConfiguration;

    if (typeof layoutOption === 'string') {
      layout = LAYOUT_FACTORIES[layoutOption]();
    } else {
      layout = layoutOption as LayoutWithConfiguration;
    }

    // TODO - is 'none' operator an option in d3-dag?
    if (layout.layering && this.props.layering) {
      let layeringOperator = this.props.customLayering || LAYERING_FACTORIES[this.props.layering]();
      layout = layout.layering(layeringOperator);
      const {nodeRank} = this.props;
      if (nodeRank) {
        // @ts-expect-error TS2345 - Argument of type '(dagNode: MutGraphNode<NodeInterface, EdgeInterface>) => number | undefined' is not assignable to parameter of type '(dagNode: MutGraphNode<NodeInterface, EdgeInterface>) => number'.
        layeringOperator = layeringOperator.rank((dagNode) => {
          const node = dagNode.data as NodeInterface;
          const rank = typeof nodeRank === 'function' ? nodeRank?.(node) : node?.getPropertyValue(nodeRank) || undefined;
          // if (rank !== undefined) {
          //   console.log(`Node ${node.getId()} assigned to rank ${rank}`);
          // }
          return rank;
        });
      }
      layout = layout.layering(layeringOperator);
    }

    if (layout.decross && this.props.decross) {
      const decrossOperator = this.props.customDecross || DECROSS_FACTORIES[this.props.decross]();
      layout = layout.decross(decrossOperator);
    }

    if (layout.coord && this.props.coord) {
      const coordOperator = this.props.customCoord || COORD_FACTORIES[this.props.coord]();
      layout = layout.coord(coordOperator);
    }

    const nodeSize = this.props.nodeSize ?? DEFAULT_NODE_SIZE;
    if (layout.nodeSize) {
      layout = layout.nodeSize(nodeSize);
    }

    const gap = this.props.separation ?? this.props.gap ?? DEFAULT_GAP;
    if (layout.gap) {
      layout = layout.gap(gap);
    }

    this._layoutOperator = layout;
    return layout;
  }

  private _cacheGeometry(): void {
    this._rawNodePositions.clear();
    this._rawEdgePoints.clear();

    if (!this._dag) {
      this._dagBounds = null;
      this._bounds = null;
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
      this._dagBounds = null;
      this._bounds = null;
      this._nodePositions.clear();
      this._edgePoints.clear();
      this._edgeControlPoints.clear();
      return;
    }

    this._dagBounds = {
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
      if (!isNodeInterface(source) || !isNodeInterface(target)) {
        continue;
      }
      const edge = isEdgeInterface(link.data)
        ? link.data
        : this._edgeLookup.get(this._edgeKey(source.getId(), target.getId()));
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

    if (!this._dagBounds) {
      this._bounds = null;
      return;
    }

    const {offsetX, offsetY} = this._getOffsets();
    const orientation = this.props.orientation ?? D3DagLayout.defaultProps.orientation;

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

    this._bounds = this._calculateBounds(this._nodePositions.values());
  }

  private _getOffsets(): {offsetX: number; offsetY: number} {
    if (!this._dagBounds) {
      return {offsetX: 0, offsetY: 0};
    }
    const centerOption = this.props.center ?? true;
    let offsetX = 0;
    let offsetY = 0;
    if (centerOption === true) {
      offsetX = this._dagBounds.centerX;
      offsetY = this._dagBounds.centerY;
    } else if (centerOption && typeof centerOption === 'object') {
      if (centerOption.x) {
        offsetX = this._dagBounds.centerX;
      }
      if (centerOption.y) {
        offsetY = this._dagBounds.centerY;
      }
    }
    return {offsetX, offsetY};
  }

  protected override _updateBounds(): void {
    this._bounds = this._calculateBounds(this._nodePositions.values());
  }

  protected _edgeKey(sourceId: string | number, targetId: string | number): string {
    return `${this._toDagId(sourceId)}${DAG_ID_SEPARATOR}${this._toDagId(targetId)}`;
  }

  protected _toDagId(id: string | number): string {
    return String(id);
  }

  protected _fromDagId(id: string): string | number {
    return this._stringIdLookup.get(id) ?? id;
  }
}
