// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {TabularGraphSource} from '../graph/tabular-graph';
import {TabularGraph} from '../graph/tabular-graph';
import type {NodeState, EdgeState} from '../core/constants';
import {basicNodeParser} from './node-parsers';
import {basicEdgeParser} from './edge-parsers';
import {error} from '../utils/log';

const NODE_STATES: ReadonlySet<NodeState> = new Set(['default', 'hover', 'dragging', 'selected']);
const EDGE_STATES: ReadonlySet<EdgeState> = new Set(['default', 'hover', 'dragging', 'selected']);

type GraphJSON = {
  version?: number;
  nodes?: unknown[] | null;
  edges?: unknown[] | null;
};

type JSONTabularNodeHandle = {
  id: string | number;
  state: NodeState;
  selectable: boolean;
  highlightConnectedEdges: boolean;
  data: Record<string, unknown>;
};

type JSONTabularEdgeHandle = {
  id: string | number;
  directed: boolean;
  sourceId: string | number;
  targetId: string | number;
  state: EdgeState;
  data: Record<string, unknown>;
};

export type JSONTabularGraphLoaderOptions = {
  json: GraphJSON;
  nodeParser?: (node: any) => {
    id: string | number;
    state?: NodeState;
    selectable?: boolean;
    highlightConnectedEdges?: boolean;
  } | null;
  edgeParser?: (edge: any) => {
    id: string | number;
    directed?: boolean;
    sourceId: string | number;
    targetId: string | number;
    state?: EdgeState;
  } | null;
};

const ACCESSORS: TabularGraphSource<JSONTabularNodeHandle, JSONTabularEdgeHandle>['getAccessors'] = () => ({
  node: {
    getId: (handle) => handle.id,
    getState: (handle) => handle.state,
    setState: (handle, state) => {
      handle.state = state;
    },
    isSelectable: (handle) => handle.selectable,
    shouldHighlightConnectedEdges: (handle) => handle.highlightConnectedEdges,
    getPropertyValue: (handle, key) => handle.data?.[key],
    setData: (handle, data) => {
      handle.data = {...data};
    },
    setDataProperty: (handle, key, value) => {
      handle.data[key] = value;
    },
    getData: (handle) => handle.data
  },
  edge: {
    getId: (handle) => handle.id,
    getSourceId: (handle) => handle.sourceId,
    getTargetId: (handle) => handle.targetId,
    isDirected: (handle) => handle.directed,
    getState: (handle) => handle.state,
    setState: (handle, state) => {
      handle.state = state;
    },
    getPropertyValue: (handle, key) => handle.data?.[key],
    setData: (handle, data) => {
      handle.data = {...data};
    },
    setDataProperty: (handle, key, value) => {
      handle.data[key] = value;
    },
    getData: (handle) => handle.data
  }
});

export function JSONTabularGraphLoader({
  json,
  nodeParser = basicNodeParser,
  edgeParser = basicEdgeParser
}: JSONTabularGraphLoaderOptions): TabularGraph | null {
  const nodes = json?.nodes ?? null;
  const edges = json?.edges ?? null;
  if (!Array.isArray(nodes)) {
    error('Invalid graph: nodes is missing.');
    return null;
  }

  const normalizedNodes: JSONTabularNodeHandle[] = [];
  const nodeMap = new Map<string | number, JSONTabularNodeHandle>();

  for (const node of nodes) {
    const parsed = nodeParser(node);
    if (!parsed || typeof parsed.id === 'undefined') {
      continue;
    }

    const handle = createNodeHandle(parsed.id, node, parsed);
    normalizedNodes.push(handle);
    nodeMap.set(handle.id, handle);
  }

  const normalizedEdges: JSONTabularEdgeHandle[] = [];
  if (Array.isArray(edges)) {
    for (const edge of edges) {
      const parsed = edgeParser(edge);
      if (!parsed || typeof parsed.sourceId === 'undefined' || typeof parsed.targetId === 'undefined') {
        continue;
      }

      const handle = createEdgeHandle(parsed, edge);
      normalizedEdges.push(handle);
    }
  }

  const source: TabularGraphSource<JSONTabularNodeHandle, JSONTabularEdgeHandle> = {
    version: normalizeVersion(json?.version),
    getNodes: () => normalizedNodes,
    getEdges: () => normalizedEdges,
    getAccessors: ACCESSORS,
    findNodeById: (id) => nodeMap.get(id)
  };

  return new TabularGraph(source);
}

function createNodeHandle(
  id: string | number,
  rawNode: unknown,
  parsed: {
    state?: NodeState;
    selectable?: boolean;
    highlightConnectedEdges?: boolean;
  }
): JSONTabularNodeHandle {
  const data = cloneRecord(rawNode);
  const stateCandidate = parsed.state ?? (data.state as NodeState | undefined);
  const selectableCandidate = parsed.selectable ?? (data.selectable as boolean | undefined);
  const highlightCandidate = parsed.highlightConnectedEdges ?? (data.highlightConnectedEdges as boolean | undefined);

  return {
    id,
    state: normalizeNodeState(stateCandidate),
    selectable: Boolean(selectableCandidate),
    highlightConnectedEdges: Boolean(highlightCandidate),
    data
  };
}

function createEdgeHandle(
  parsed: {
    id: string | number;
    directed?: boolean;
    sourceId: string | number;
    targetId: string | number;
    state?: EdgeState;
  },
  rawEdge: unknown
): JSONTabularEdgeHandle {
  const data = cloneRecord(rawEdge);
  const stateCandidate = parsed.state ?? (data.state as EdgeState | undefined);
  const directedCandidate = parsed.directed ?? (data.directed as boolean | undefined);

  return {
    id: parsed.id,
    directed: Boolean(directedCandidate),
    sourceId: parsed.sourceId,
    targetId: parsed.targetId,
    state: normalizeEdgeState(stateCandidate),
    data
  };
}

function normalizeNodeState(state: NodeState | undefined): NodeState {
  if (state && NODE_STATES.has(state)) {
    return state;
  }
  return 'default';
}

function normalizeEdgeState(state: EdgeState | undefined): EdgeState {
  if (state && EDGE_STATES.has(state)) {
    return state;
  }
  return 'default';
}

function normalizeVersion(version: unknown): number {
  if (typeof version === 'number' && Number.isFinite(version)) {
    return version;
  }
  return 0;
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return {...(value as Record<string, unknown>)};
  }
  return {};
}
