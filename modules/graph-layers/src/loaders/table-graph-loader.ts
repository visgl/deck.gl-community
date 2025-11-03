// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {NodeOptions} from '../graph/node';
import type {EdgeOptions} from '../graph/edge';
import {Edge} from '../graph/edge';
import {Node} from '../graph/node';
import {Graph} from '../graph/graph';

import {error} from '../utils/log';

export type ParseGraphOptions = {
  nodeIdField?: string;
  edgeSourceField?: string;
  edgeTargetField?: string;
  edgeDirectedField?: string;
  edgeDirected?: boolean;
  nodeParser?: (nodeRow: any) => NodeOptions;
  edgeParser?: (edgeRow: any) => EdgeOptions;
};

const defaultParseGraphOptions = {
  nodeIdField: 'id',
  edgeSourceField: 'sourceId',
  edgeTargetField: 'targetId',
  edgeDirectedField: undefined,
  edgeDirected: false
  // nodeParser: (nodeRow: any, options: ParseGraphOptions) => ({id: nodeRow.name, data: nodeRow}),
  // edgeParser: (edgeRow: any, nodeIndexMap, options: ParseGraphOptions)=> {
  //   const sourceNodeId = edge[options.edgeSourceField];
  //   const targetNodeId = edge[options.edgeTargetField];
  //   return {
  //     id: `${sourceNodeId}-${targetNodeId}`,
  //     sourceId: nodeIndexMap[sourceNodeId],
  //     targetId: nodeIndexMap[targetNodeId],
  //     directed: true
  //   };
  // };
} as const satisfies ParseGraphOptions;

export function tableGraphLoader(
  tables: {nodes: any[]; edges: any[]},
  options?: ParseGraphOptions
): Graph {
  options = {...defaultParseGraphOptions, ...options};

  const {nodes, edges} = tables;

  // const nodeIndexMap = nodes.reduce((res, node, idx) => {
  //   res[idx] = node[options.nodeIdField];
  //   return res;
  // }, {});

  function defaultNodeParser(nodeRow: any): NodeOptions {
    return {id: nodeRow[options.nodeIdField]};
  }

  function defaultEdgeParser(edgeRow: any): EdgeOptions {
    const sourceNodeId = edgeRow[options.edgeSourceField];
    const targetNodeId = edgeRow[options.edgeTargetField];
    return {
      id: edgeRow.id || `${sourceNodeId}-${targetNodeId}`,
      sourceId: sourceNodeId,
      targetId: targetNodeId,
      directed: options.edgeDirected
    };
  }

  const nodeParser = options.nodeParser || defaultNodeParser;
  const edgeParser = options.edgeParser || defaultEdgeParser;

  // add nodes

  if (!nodes) {
    error('Invalid graph: nodes is missing.');
    return null;
  }

  const glNodes = nodes.map((node) => {
    const {id} = nodeParser(node);
    return new Node({id, data: node});
  });

  const glEdges = edges.map((edge) => {
    const {id, sourceId, targetId, directed} = edgeParser(edge);
    return new Edge({
      id,
      sourceId,
      targetId,
      directed: directed || false,
      data: edge
    });
  });

  // create a new empty graph
  const name = 'loaded';
  const graph = new Graph({name, nodes: glNodes, edges: glEdges});
  return graph;
}

// export function basicNodeParser(node: any): Pick<NodeOptions, 'id'> {
//   if (node.id === undefined) {
//     log.error('Invalid node: id is missing.')();
//     return null;
//   }
//   return {id: node.id};
// }

// export function basicEdgeParser(edge: any): Omit<EdgeOptions, 'data'> {
//   const {id, directed, sourceId, targetId} = edge;

//   if (sourceId === undefined || targetId === undefined) {
//     log.error('Invalid edge: sourceId or targetId is missing.')();
//     return null;
//   }

//   return {
//     id,
//     directed: directed || false,
//     sourceId,
//     targetId
//   };
// }
