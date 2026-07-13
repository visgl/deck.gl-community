import {describe, expect, it} from 'vitest';

import {TRACE_SPAN_FILTER_MASK_REGEXP, TRACE_SPAN_FILTER_MASK_SOURCE} from '../../trace';
import {
  getTraceSpanFilterReasonLabel,
  getTraceSpanFilterReasonParts
} from './trace-span-filter-reason';

describe('trace span filter reasons', () => {
  it('returns precise ordered reason parts for combined filters', () => {
    const filterMask = TRACE_SPAN_FILTER_MASK_REGEXP | TRACE_SPAN_FILTER_MASK_SOURCE;

    expect(getTraceSpanFilterReasonParts(filterMask)).toEqual([
      'span-name filter',
      'filename filter'
    ]);
    expect(getTraceSpanFilterReasonLabel(filterMask)).toBe(
      'Hidden by: span-name filter, filename filter'
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
