// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// eslint-disable-next-line spaced-comment
/// <reference lib="webworker" />

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from 'd3-force';

import type {
  GraphLayoutColumn,
  GraphLayoutColumnarTable,
  GraphLayoutEdgeUpdateTable,
  GraphLayoutIdColumn,
  GraphLayoutNodeUpdateTable,
  GraphLayoutUpdates
} from '../../core/graph-layout';
import type {D3ForceLayoutOptions} from './d3-force-layout';

export type WorkerNodeUpdateRow = {
  id: string | number;
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
};

export type WorkerEdgeUpdateRow = {
  id: string | number;
  sourcePosition: [number, number];
  targetPosition: [number, number];
  controlPoints?: [number, number][];
};

type ForceNode = SimulationNodeDatum & {
  id: string | number;
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
};

type ForceEdge = SimulationLinkDatum<ForceNode> & {
  id: string | number;
  controlPoints?: [number, number][];
};

type WorkerNodeInput = Partial<ForceNode> & {id: string | number};
type NodeReference = string | number | ForceNode;

type WorkerEdgeInput = {
  id: string | number;
  source: NodeReference;
  target: NodeReference;
  controlPoints?: [number, number][];
};

type WorkerMessage = {
  nodes: WorkerNodeInput[];
  edges: WorkerEdgeInput[];
  options: D3ForceLayoutOptions;
};

type PreviousPosition = {x: number; y: number};

type NodeUpdateResult = {
  rows: WorkerNodeUpdateRow[];
  changedIds: Set<string | number>;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function buildIdColumn(values: readonly (string | number)[]): GraphLayoutIdColumn {
  const allNumeric = values.every((value) => typeof value === 'number' && Number.isFinite(value));
  if (allNumeric) {
    const column = new Float64Array(values.length);
    for (let index = 0; index < values.length; ++index) {
      column[index] = Number(values[index]);
    }
    return column;
  }

  return Array.from(values);
}

function buildRequiredFloatColumn<T>(rows: readonly T[], accessor: (row: T) => number): Float64Array {
  const column = new Float64Array(rows.length);
  for (let index = 0; index < rows.length; ++index) {
    column[index] = accessor(rows[index]);
  }
  return column;
}

function buildOptionalFloatColumn<T>(
  rows: readonly T[],
  accessor: (row: T) => number | null | undefined
): {column: Float64Array; hasValue: boolean} {
  const column = new Float64Array(rows.length);
  column.fill(Number.NaN);

  let hasValue = false;
  for (let index = 0; index < rows.length; ++index) {
    const value = accessor(rows[index]);
    if (value !== null && value !== undefined && isFiniteNumber(value)) {
      column[index] = value;
      hasValue = true;
    }
  }

  return {column, hasValue};
}

function isForceNode(value: NodeReference): value is ForceNode {
  return typeof value === 'object';
}

function getNodeFromRef(nodeById: Map<string | number, ForceNode>, ref: NodeReference): ForceNode | undefined {
  if (isForceNode(ref)) {
    return ref;
  }

  return nodeById.get(ref);
}

function getNodeIdFromRef(ref: NodeReference): string | number {
  return isForceNode(ref) ? ref.id : ref;
}

function formatNodeUpdate(node: ForceNode): WorkerNodeUpdateRow {
  return {
    id: node.id,
    x: node.x,
    y: node.y,
    fx: node.fx ?? null,
    fy: node.fy ?? null,
    vx: node.vx,
    vy: node.vy
  };
}

function formatEdgeUpdate(
  edge: ForceEdge,
  sourceNode: ForceNode,
  targetNode: ForceNode
): WorkerEdgeUpdateRow {
  return {
    id: edge.id,
    sourcePosition: [sourceNode.x, sourceNode.y],
    targetPosition: [targetNode.x, targetNode.y],
    controlPoints: edge.controlPoints || []
  };
}

function collectNodeUpdates(
  nodes: ForceNode[],
  previousPositions: Map<string | number, PreviousPosition>
): NodeUpdateResult {
  const rows: WorkerNodeUpdateRow[] = [];
  const changedIds = new Set<string | number>();

  for (const node of nodes) {
    if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const previous = previousPositions.get(node.id);
    if (!previous || previous.x !== node.x || previous.y !== node.y) {
      previousPositions.set(node.id, {x: node.x, y: node.y});
      rows.push(formatNodeUpdate(node));
      changedIds.add(node.id);
    }
  }

  return {rows, changedIds};
}

function collectEdgeUpdates(
  edges: ForceEdge[],
  nodeById: Map<string | number, ForceNode>,
  changedIds: Set<string | number>
): WorkerEdgeUpdateRow[] {
  const rows: WorkerEdgeUpdateRow[] = [];

  for (const edge of edges) {
    const sourceNode = getNodeFromRef(nodeById, edge.source);
    const targetNode = getNodeFromRef(nodeById, edge.target);

    if (!sourceNode || !targetNode) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const sourceId = getNodeIdFromRef(edge.source);
    const targetId = getNodeIdFromRef(edge.target);
    if (!changedIds.has(sourceId) && !changedIds.has(targetId)) {
      // eslint-disable-next-line no-continue
      continue;
    }

    rows.push(formatEdgeUpdate(edge, sourceNode, targetNode));
  }

  return rows;
}

function createFinalEdgeUpdates(
  edges: ForceEdge[],
  nodeById: Map<string | number, ForceNode>
): WorkerEdgeUpdateRow[] {
  const rows: WorkerEdgeUpdateRow[] = [];

  for (const edge of edges) {
    const sourceNode = getNodeFromRef(nodeById, edge.source);
    const targetNode = getNodeFromRef(nodeById, edge.target);

    if (sourceNode && targetNode) {
      rows.push(formatEdgeUpdate(edge, sourceNode, targetNode));
    }
  }

  return rows;
}

export function createColumnarNodeUpdates(
  rows: readonly WorkerNodeUpdateRow[]
): GraphLayoutNodeUpdateTable | null {
  const length = rows.length;
  if (length === 0) {
    return null;
  }

  const id = buildIdColumn(rows.map((row) => row.id));
  const x = buildRequiredFloatColumn(rows, (row) => row.x);
  const y = buildRequiredFloatColumn(rows, (row) => row.y);
  const {column: fx, hasValue: hasFx} = buildOptionalFloatColumn(rows, (row) => row.fx);
  const {column: fy, hasValue: hasFy} = buildOptionalFloatColumn(rows, (row) => row.fy);
  const {column: vx, hasValue: hasVx} = buildOptionalFloatColumn(rows, (row) => row.vx);
  const {column: vy, hasValue: hasVy} = buildOptionalFloatColumn(rows, (row) => row.vy);

  const columns: GraphLayoutNodeUpdateTable['columns'] = {id, x, y};
  if (hasFx) {
    columns.fx = fx;
  }
  if (hasFy) {
    columns.fy = fy;
  }
  if (hasVx) {
    columns.vx = vx;
  }
  if (hasVy) {
    columns.vy = vy;
  }

  return {length, columns};
}

export function createColumnarEdgeUpdates(
  rows: readonly WorkerEdgeUpdateRow[]
): GraphLayoutEdgeUpdateTable | null {
  const length = rows.length;
  if (length === 0) {
    return null;
  }

  const id = buildIdColumn(rows.map((row) => row.id));
  const sourceX = buildRequiredFloatColumn(rows, (row) => row.sourcePosition[0]);
  const sourceY = buildRequiredFloatColumn(rows, (row) => row.sourcePosition[1]);
  const targetX = buildRequiredFloatColumn(rows, (row) => row.targetPosition[0]);
  const targetY = buildRequiredFloatColumn(rows, (row) => row.targetPosition[1]);
  const controlPoints = rows.map((row) => row.controlPoints ?? []);
  const hasControlPoints = controlPoints.some((value) => value.length > 0);

  const columns: GraphLayoutEdgeUpdateTable['columns'] = {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY
  };

  if (hasControlPoints) {
    columns.controlPoints = controlPoints;
  }

  return {length, columns};
}

function collectTableTransferables(
  table?: GraphLayoutColumnarTable<Record<string, GraphLayoutColumn | undefined>> | null
): ArrayBuffer[] {
  if (!table) {
    return [];
  }

  const buffers: ArrayBuffer[] = [];
  for (const column of Object.values(table.columns ?? {})) {
    if (column instanceof Float64Array) {
      buffers.push(column.buffer);
    }
  }
  return buffers;
}

export function collectTransferablesFromUpdates(
  updates: GraphLayoutUpdates | null | undefined
): ArrayBuffer[] {
  if (!updates) {
    return [];
  }

  const buffers = new Set<ArrayBuffer>();

  for (const buffer of collectTableTransferables(updates.nodes)) {
    buffers.add(buffer);
  }
  for (const buffer of collectTableTransferables(updates.edges)) {
    buffers.add(buffer);
  }

  return Array.from(buffers);
}

function initializeSimulationNodes(nodes: WorkerNodeInput[]): ForceNode[] {
  return nodes.map((node) => ({
    id: node.id,
    x: isFiniteNumber(node.x) ? node.x : 0,
    y: isFiniteNumber(node.y) ? node.y : 0,
    fx: node.fx ?? undefined,
    fy: node.fy ?? undefined,
    vx: node.vx,
    vy: node.vy
  }));
}

function initializeSimulationEdges(edges: WorkerEdgeInput[]): ForceEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    controlPoints: edge.controlPoints
  }));
}

function buildNodeIndex(nodes: ForceNode[]): Map<string | number, ForceNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function initializePreviousPositions(nodes: ForceNode[]): Map<string | number, PreviousPosition> {
  const positions = new Map<string | number, PreviousPosition>();
  for (const node of nodes) {
    if (isFiniteNumber(node.x) && isFiniteNumber(node.y)) {
      positions.set(node.id, {x: node.x, y: node.y});
    }
  }
  return positions;
}

function createSimulation(
  nodes: ForceNode[],
  edges: ForceEdge[],
  options: D3ForceLayoutOptions
) {
  const {
    nBodyStrength = -900,
    nBodyDistanceMin = 100,
    nBodyDistanceMax = 400,
    getCollisionRadius = 0
  } = options;

  return forceSimulation(nodes)
    .force('edge', forceLink<ForceNode, ForceEdge>(edges).id((node) => node.id))
    .force(
      'charge',
      forceManyBody()
        .strength(nBodyStrength)
        .distanceMin(nBodyDistanceMin)
        .distanceMax(nBodyDistanceMax)
    )
    .force('center', forceCenter())
    .force('collision', forceCollide().radius(getCollisionRadius))
    .stop();
}

function getTotalTicks(simulation: ReturnType<typeof createSimulation>): number {
  const decay = 1 - simulation.alphaDecay();
  return decay === 0 ? 0 : Math.ceil(Math.log(simulation.alphaMin()) / Math.log(decay));
}

const workerScope: DedicatedWorkerGlobalScope | undefined =
  typeof self !== 'undefined' && 'postMessage' in self ? (self as DedicatedWorkerGlobalScope) : undefined;

if (workerScope) {
  workerScope.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const {nodes = [], edges = [], options} = event.data ?? {};

    const simulationNodes = initializeSimulationNodes(nodes);
    const simulationEdges = initializeSimulationEdges(edges);
    const nodeById = buildNodeIndex(simulationNodes);
    const previousPositions = initializePreviousPositions(simulationNodes);

    const simulation = createSimulation(simulationNodes, simulationEdges, options ?? ({} as D3ForceLayoutOptions));
    const totalTicks = getTotalTicks(simulation);

    for (let tick = 0; tick < totalTicks; ++tick) {
      simulation.tick();

      const {rows: nodeRows, changedIds} = collectNodeUpdates(simulationNodes, previousPositions);
      if (nodeRows.length === 0) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const edgeRows = collectEdgeUpdates(simulationEdges, nodeById, changedIds);
      const nodesTable = createColumnarNodeUpdates(nodeRows);
      const edgesTable = createColumnarEdgeUpdates(edgeRows);
      const updates: GraphLayoutUpdates = {nodes: nodesTable, edges: edgesTable};

      const transferables = collectTransferablesFromUpdates(updates);

      workerScope.postMessage(
        {
          type: 'tick',
          progress: totalTicks === 0 ? 1 : (tick + 1) / totalTicks,
          nodes: nodesTable,
          edges: edgesTable
        },
        transferables
      );
    }

    const finalNodeRows = simulationNodes.map(formatNodeUpdate);
    const finalEdgeRows = createFinalEdgeUpdates(simulationEdges, nodeById);
    const finalNodesTable = createColumnarNodeUpdates(finalNodeRows);
    const finalEdgesTable = createColumnarEdgeUpdates(finalEdgeRows);
    const finalUpdates: GraphLayoutUpdates = {
      nodes: finalNodesTable,
      edges: finalEdgesTable
    };

    workerScope.postMessage(
      {
        type: 'end',
        nodes: finalNodesTable,
        edges: finalEdgesTable
      },
      collectTransferablesFromUpdates(finalUpdates)
    );

    workerScope.close();
  };
}
