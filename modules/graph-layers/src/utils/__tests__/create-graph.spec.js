import SAMPLE_GRAPH from './__fixtures__/graph';
import createGraph from '../create-graph';

describe('util/create-graph', () => {
  it('test createGraph with custom parsers', () => {
    const graph = createGraph({
      nodes: SAMPLE_GRAPH.nodes,
      edges: SAMPLE_GRAPH.edges,
      nodeParser: node => ({id: node.name}),
      edgeParser: edge => ({
        id: edge.name,
        directed: false,
        sourceId: edge.source,
        targetId: edge.target,
      }),
    });
    const nodeIds = graph.getNodes().map(n => n.getId());
    expect(SAMPLE_GRAPH.nodes.map(n => n.name)).toEqual(
      expect.arrayContaining(nodeIds)
    );

    const edgeIds = graph.getEdges().map(e => e.getId());
    expect(SAMPLE_GRAPH.edges.map(n => n.name)).toEqual(
      expect.arrayContaining(edgeIds)
    );
  });
});
