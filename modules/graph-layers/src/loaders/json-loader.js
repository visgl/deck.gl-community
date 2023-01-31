import {createGraph} from '../index';
import {basicNodeParser} from './node-parsers';
import {basicEdgeParser} from './edge-parsers';
import {log} from '../utils/log';

const JSONLoader = ({
  json,
  nodeParser = basicNodeParser,
  edgeParser = basicEdgeParser,
}) => {
  const {name = 'default', nodes, edges} = json;
  if (!nodes) {
    log.error('Invalid graph: nodes is missing.')();
    return null;
  }

  const graph = createGraph({name, nodes, edges, nodeParser, edgeParser});
  return graph;
};

export default JSONLoader;
