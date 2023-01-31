import NgraphGenerators from 'ngraph.generators';

import lesGraph from './les-miserable.json';
import randomGraphGenerator from './random-graph-generator';

const convertNgraphDataset = ngraph => {
  const nodes = [];
  const edges = [];
  ngraph.forEachNode(n => {
    nodes.push({id: n.id});
  });
  ngraph.forEachLink(link => {
    edges.push({
      id: link.id,
      sourceId: link.fromId,
      targetId: link.toId,
    });
  });
  return {nodes, edges};
};

const SAMPLE_GRAPH_DATASETS = {
  'Les Miserable': () => lesGraph,
  'Random (20, 40)': () => randomGraphGenerator(20, 40, 'Random (20, 40)'),
  'Random (100, 200)': () =>
    randomGraphGenerator(100, 200, 'Random (100, 200)'),
  'Random (1000, 2000)': () =>
    randomGraphGenerator(1000, 2000, 'Random (1000, 2000)'),
  'Random (5000, 3000)': () =>
    randomGraphGenerator(5000, 3000, 'Random (5000, 3000)'),
  'Ladder (10)': () => convertNgraphDataset(NgraphGenerators.ladder(10)),
  'BalancedBinTree (5)': () =>
    convertNgraphDataset(NgraphGenerators.balancedBinTree(5)),
  'BalancedBinTree (8)': () =>
    convertNgraphDataset(NgraphGenerators.balancedBinTree(8)),
  'Grid (10, 10)': () => convertNgraphDataset(NgraphGenerators.grid(10, 10)),
  'WattsStrogatz (100, 10, 0.06)': () =>
    convertNgraphDataset(NgraphGenerators.wattsStrogatz(100, 10, 0.06)),
};

export default SAMPLE_GRAPH_DATASETS;
