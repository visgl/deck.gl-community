import SAMPLE_EDGE from '../../core/__tests__/__fixtures__/edge.json';
import {basicEdgeParser} from '../edge-parsers';

describe('loaders/edge-parsers', () => {
  it('should pass sanity', () => {
    expect(basicEdgeParser(SAMPLE_EDGE)).toMatchObject({
      id: 'edge1',
      sourceId: 'node1',
      targetId: 'node2',
      directed: false,
    });
  });
});
