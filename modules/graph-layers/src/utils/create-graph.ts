// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Edge} from '../core/edge';
import {Node} from '../core/node';
import {Graph} from '../core/graph';

export function createGraph({name, nodes, edges, nodeParser, edgeParser}) {
  // create a new empty graph
  const graph = new Graph();

  const graphName = name || Date.now();
  graph.setGraphName(graphName);

  // add nodes
  const glNodes = nodes.map((node) => {
    const {id} = nodeParser(node);
    return new Node({
      id,
      data: node
    });
  });
  graph.batchAddNodes(glNodes);

  const glEdges = edges.map((edge) => {
    const {id, sourceId, targetId, directed} = edgeParser(edge);
    return new Edge({
      id,
      sourceId,
      targetId,
      directed,
      data: edge
    });
  });
  graph.batchAddEdges(glEdges);
  return graph;
}
