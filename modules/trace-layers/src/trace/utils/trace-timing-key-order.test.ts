import {describe, expect, it} from 'vitest';

import {orderTraceTimingKeys, TRACE_TIMING_DISPLAY_ORDER} from './trace-timing-key-order';

describe('orderTraceTimingKeys', () => {
  it('orders known timing keys using the shared display order', () => {
    expect(
      orderTraceTimingKeys(['latest', 'p90', 'earliest_start', 'p50', 'envelope', 'earliest'])
    ).toEqual(['envelope', 'earliest_start', 'earliest', 'p50', 'p90', 'latest']);
  });

  it('places unknown timing keys after the known keys in alphabetical order', () => {
    expect(orderTraceTimingKeys(['zeta', 'latest', 'alpha', 'p50'])).toEqual([
      'p50',
      'latest',
      'alpha',
      'zeta'
    ]);
  });

  it('exposes the default display order for empty option sets', () => {
    expect([...TRACE_TIMING_DISPLAY_ORDER]).toEqual([
      'envelope',
      'earliest_start',
      'earliest',
      'p50',
      'p90',
      'latest_start',
      'latest'
    ]);
  });
});
