import {describe, expect, it} from 'vitest';

import {buildTraceThreadNameOptions} from './thread-name-options';

describe('buildTraceThreadNameOptions', () => {
  it('dedupes non-empty thread names in numeric-aware order', () => {
    expect(
      buildTraceThreadNameOptions([
        {name: 'stream-10'},
        {name: 'stream-2'},
        {name: 'stream-2'},
        {name: ''},
        {name: 'all_threads'},
        {name: 'stream-1'}
      ])
    ).toEqual([
      {label: 'stream-1', value: 'stream-1'},
      {label: 'stream-2', value: 'stream-2'},
      {label: 'stream-10', value: 'stream-10'}
    ]);
  });
});
