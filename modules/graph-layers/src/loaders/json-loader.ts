// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createGraph} from './create-graph';
import {basicNodeParser} from './node-parsers';
import {basicEdgeParser} from './edge-parsers';
import {log} from '../utils/log';

type RawNode = Record<string, unknown> & {id?: string | number};
type RawEdge = Record<string, unknown> & {
  id?: string | number;
  sourceId?: string | number;
  targetId?: string | number;
  source?: string | number | RawNode;
  target?: string | number | RawNode;
};

type RawGraph = {
  name?: string;
  nodes?: RawNode[];
  edges?: RawEdge[];
};

const DEFAULT_GRAPH_NAME = 'default';

const getEndpointId = (
  edge: RawEdge,
  endpoint: 'source' | 'target'
): string | number | undefined => {
  const endpointIdKey = `${endpoint}Id` as const;
  if (edge[endpointIdKey] !== undefined && edge[endpointIdKey] !== null) {
    return edge[endpointIdKey] as string | number;
  }

  const value = edge[endpoint];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'object') {
    const {id} = value as RawNode;
    return id as string | number;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }

  return undefined;
};

const normalizeEdge = (edge: RawEdge, index: number): RawEdge | null => {
  const sourceId = getEndpointId(edge, 'source');
  const targetId = getEndpointId(edge, 'target');

  if (sourceId === undefined || targetId === undefined) {
    log.error('Invalid edge: source or target id is missing.')();
    return null;
  }

  return {
    ...edge,
    id: edge.id ?? `${sourceId}-${targetId}-${index}`,
    sourceId,
    targetId
  } as RawEdge;
};

const normalizeEdges = (edges: RawEdge[] | undefined): RawEdge[] => {
  if (!edges || !Array.isArray(edges)) {
    return [];
  }

  return edges
    .map((edge, index) => normalizeEdge(edge, index))
    .filter((edge): edge is RawEdge => Boolean(edge));
};

const createNodeFromEndpoint = (
  edge: RawEdge,
  endpoint: 'source' | 'target',
  nodeId: string | number
): RawNode => {
  const value = edge[endpoint];
  if (value && typeof value === 'object') {
    return {...(value as RawNode), id: (value as RawNode).id ?? nodeId};
  }

  return {id: nodeId};
};

const normalizeNodes = (nodes: RawNode[] | undefined, edges: RawEdge[]): RawNode[] => {
  const nodeMap = new Map<string | number, RawNode>();
  const normalizedNodes: RawNode[] = [];

  if (Array.isArray(nodes)) {
    nodes.forEach((node) => {
      normalizedNodes.push(node);
      if (node?.id !== undefined && !nodeMap.has(node.id)) {
        nodeMap.set(node.id, node);
      }
    });
  }

  edges.forEach((edge) => {
    const {sourceId, targetId} = edge;
    if (sourceId !== undefined && !nodeMap.has(sourceId)) {
      const node = createNodeFromEndpoint(edge, 'source', sourceId);
      nodeMap.set(sourceId, node);
      normalizedNodes.push(node);
    }
    if (targetId !== undefined && !nodeMap.has(targetId)) {
      const node = createNodeFromEndpoint(edge, 'target', targetId);
      nodeMap.set(targetId, node);
      normalizedNodes.push(node);
    }
  });

  return normalizedNodes;
};

const normalizeGraph = (json: unknown): RawGraph | null => {
  if (!json) {
    return null;
  }

  if (Array.isArray(json)) {
    const edges = normalizeEdges(json as RawEdge[]);
    return {
      name: DEFAULT_GRAPH_NAME,
      edges,
      nodes: normalizeNodes(undefined, edges)
    };
  }

  if (typeof json === 'object') {
    const rawGraph = json as RawGraph;
    const edges = normalizeEdges(rawGraph.edges);
    return {
      name: rawGraph.name ?? DEFAULT_GRAPH_NAME,
      edges,
      nodes: normalizeNodes(rawGraph.nodes, edges)
    };
  }

  return null;
};

export const JSONLoader = ({json, nodeParser = basicNodeParser, edgeParser = basicEdgeParser}) => {
  const normalized = normalizeGraph(json);

  if (!normalized) {
    log.error('Invalid graph: unsupported data format.')();
    return null;
  }

  const {name = DEFAULT_GRAPH_NAME, nodes, edges} = normalized;

  if (!nodes || nodes.length === 0) {
    log.error('Invalid graph: nodes is missing.')();
    return null;
  }

  const graph = createGraph({name, nodes, edges, nodeParser, edgeParser});
  return graph;
};
