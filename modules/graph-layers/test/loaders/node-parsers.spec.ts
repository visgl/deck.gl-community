import {describe, it, expect} from 'vitest';
import SAMPLE_NODE from '../__fixtures__/node.json';
import {basicNodeParser} from '../../src/loaders/node-parsers';

describe('loaders/node-parsers', () => {
  it('should pass sanity', () => {
    expect(basicNodeParser(SAMPLE_NODE)).toMatchObject({
      id: 'node1'
    });
  });
});
