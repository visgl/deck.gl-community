// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Edge} from '../graph/edge';
import {Node} from '../graph/node';
import {ClassicGraph} from '../graph/classic-graph';

/**
 * @deprecated Use `new ClassicGraph(name, nodes, edges)`
 * Create a graph from a list of Nodes and edges
 */
export function createGraph(props: {name; nodes; edges; nodeParser; edgeParser}): ClassicGraph {
  const {name, nodes, edges, nodeParser, edgeParser} = props;
  // create a new empty graph
  const graph = new ClassicGraph();

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
