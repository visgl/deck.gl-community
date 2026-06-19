import {describe, expect, it} from 'vitest';

import {buildNumericSortTokens, compareNumericSortStrings} from './numeric-sort';

describe('numeric sort utilities', () => {
  it('tokenizes numeric substrings separated by whitespace, dashes, or underscores', () => {
    expect(buildNumericSortTokens('Thread 10')).toEqual(['Thread', 10]);
    expect(buildNumericSortTokens('Thread-2')).toEqual(['Thread', 2]);
    expect(buildNumericSortTokens('Thread_3')).toEqual(['Thread', 3]);
  });

  it('sorts numeric substrings by value', () => {
    const streams = ['Thread 1', 'Thread 0', 'Thread 10', 'Thread 2'];

    const sorted = [...streams].sort(compareNumericSortStrings);

    expect(sorted).toEqual(['Thread 0', 'Thread 1', 'Thread 2', 'Thread 10']);
  });

  it('sorts mixed separators consistently', () => {
    const streams = ['Worker-2', 'Worker 10', 'Worker_1'];

    const sorted = [...streams].sort(compareNumericSortStrings);

    expect(sorted).toEqual(['Worker_1', 'Worker-2', 'Worker 10']);
  });
});
