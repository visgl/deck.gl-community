import {describe, it, expect} from 'vitest';
import {SAMPLE_GRAPH_DATASETS} from '@deck.gl-community/test-utils';

describe('sample data', () => {
  it('includes graphgl data', () => {
    const datasetKeys = Object.keys(SAMPLE_GRAPH_DATASETS);
    expect(datasetKeys).toContain('Les Miserable');
    expect(datasetKeys).toContain('Random (20, 40)');
    expect(datasetKeys).toContain('Random (100, 200)');
  });
});
