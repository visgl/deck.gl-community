import {describe, expect, it} from 'vitest';

import {
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_SOURCE,
  TRACE_SPAN_FILTER_MASK_TOPOLOGY
} from '../../trace/index';
import {
  getTraceSpanFilterReasonLabel,
  getTraceSpanFilterReasonParts
} from './trace-span-filter-reason';

describe('trace span filter reasons', () => {
  it('returns precise ordered reason parts for combined filters', () => {
    const filterMask = TRACE_SPAN_FILTER_MASK_SOURCE | TRACE_SPAN_FILTER_MASK_TOPOLOGY;

    expect(getTraceSpanFilterReasonParts(filterMask)).toEqual([
      'filename filter',
      'topological filter'
    ]);
    expect(getTraceSpanFilterReasonLabel(filterMask)).toBe(
      'Hidden by: filename filter, topological filter'
    );
  });

  it('labels span-name filters independently from filename filters', () => {
    expect(getTraceSpanFilterReasonLabel(TRACE_SPAN_FILTER_MASK_REGEXP)).toBe(
      'Hidden by: span-name filter'
    );
    expect(getTraceSpanFilterReasonLabel(TRACE_SPAN_FILTER_MASK_SOURCE)).toBe(
      'Hidden by: filename filter'
    );
  });
});
