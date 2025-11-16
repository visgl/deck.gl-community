import {ArrowGraph} from '../arrow-graph';
import {ClassicGraph} from '../classic-graph';
import {Node} from '../node';
import {Edge} from '../edge';

import {getVectorLength} from './arrow-utils'

export function convertArrowGraphToClassicGraph(graph: ArrowGraph): ClassicGraph {
  // @ts-expect-error Accessing protected member
  const nodeCount = getVectorLength(graph.nodeVectors.id);
  // @ts-expect-error Accessing protected member
  const edgeCount = getVectorLength(graph.edgeVectors.id);

  const legacyNodes: Node[] = [];
  for (let index = 0; index < nodeCount; index++) {
    const node = new Node({
      id: graph.getNodeIdByIndex(index),
      selectable: graph.isNodeSelectableByIndex(index),
      highlightConnectedEdges: graph.shouldHighlightConnectedEdgesByIndex(index),
      data: graph.getNodeDataByIndex(index)
    });
    node.setState(graph.getNodeStateByIndex(index));
    legacyNodes.push(node);
  }

  const legacyEdges: Edge[] = [];
  for (let index = 0; index < edgeCount; index++) {
    const edge = new Edge({
      id: graph.getEdgeIdByIndex(index),
      sourceId: graph.getEdgeSourceIdByIndex(index),
      targetId: graph.getEdgeTargetIdByIndex(index),
      directed: graph.isEdgeDirectedByIndex(index),
      data: graph.getEdgeDataByIndex(index)
    });
    edge.setState(graph.getEdgeStateByIndex(index));
    legacyEdges.push(edge);
  }

  const classicGraph = new ClassicGraph(graph.props);
  if (legacyNodes.length > 0) {
    classicGraph.batchAddNodes(legacyNodes);
  }
  if (legacyEdges.length > 0) {
    classicGraph.batchAddEdges(legacyEdges);
  }
  return classicGraph;
}
