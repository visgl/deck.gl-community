// import SAMPLE_GRAPH1 from '../../core/__tests__/__fixtures__/graph1.json';
// import SAMPLE_GRAPH2 from '../../core/__tests__/__fixtures__/graph2.json';
// import JSONLoader from '../json-loader';

// TODO: Fix ESM errors and uncomment test below.
describe('loaders/node-parsers', () => {
  it('not implemented', () => {
    expect(true).toBeTruthy();
  });
});

// describe('loaders/node-parsers', () => {
//   it('should work with default parsers', () => {
//     const graph = JSONLoader({json: SAMPLE_GRAPH1});
//     expect(graph.getEdges().map((e) => e.getId())).toEqual(
//       expect.arrayContaining(SAMPLE_GRAPH1.edges.map((e) => e.id))
//     );
//     expect(graph.getNodes().map((n) => n.getId())).toEqual(
//       expect.arrayContaining(SAMPLE_GRAPH1.nodes.map((n) => n.id))
//     );
//   });

//   it('should work with custom parsers', () => {
//     const graph = JSONLoader({
//       json: SAMPLE_GRAPH2,
//       nodeParser: (node) => ({id: node.name}),
//       edgeParser: (edge) => ({
//         id: edge.name,
//         directed: false,
//         sourceId: edge.source,
//         targetId: edge.target
//       })
//     });
//     expect(graph.getEdges().map((n) => n.getId())).toEqual(
//       expect.arrayContaining(SAMPLE_GRAPH2.edges.map((e) => e.name))
//     );
//     expect(graph.getNodes().map((n) => n.getId())).toEqual(
//       expect.arrayContaining(SAMPLE_GRAPH2.nodes.map((n) => n.name))
//     );
//   });
// });
