import SAMPLE_NODE from '../../core/__tests__/__fixtures__/node.json';
import {basicNodeParser} from '../node-parsers';

describe('loaders/node-parsers', () => {
  it('should pass sanity', () => {
    expect(basicNodeParser(SAMPLE_NODE)).toMatchObject({
      id: 'node1',
    });
  });
});
