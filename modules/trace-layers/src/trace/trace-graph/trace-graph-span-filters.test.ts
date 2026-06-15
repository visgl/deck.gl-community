import {describe, expect, it, vi} from 'vitest';

import {
  buildCompiledTraceSpanFilterPlan,
  getTraceSpanNameFilterMatchMask,
  getTraceSpanSourceFilterMatchMask
} from './trace-graph-span-filters';
import {
  hasTraceSpanNameFilter,
  hasTraceSpanRegexpFilter,
  hasTraceSpanSourceFilter,
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_SOURCE
} from './trace-graph-types';

describe('trace graph span filters', () => {
  it('attributes span-name and filename matches through separate helpers', () => {
    const filterPlan = buildCompiledTraceSpanFilterPlan(['target']);

    expect(
      getTraceSpanNameFilterMatchMask({
        spanName: 'target span',
        filterPlan
      })
    ).toBe(TRACE_SPAN_FILTER_MASK_REGEXP);
    expect(
      getTraceSpanSourceFilterMatchMask({
        source: 'target_file.py:10',
        filterPlan
      })
    ).toBe(TRACE_SPAN_FILTER_MASK_SOURCE);
    expect(
      getTraceSpanSourceFilterMatchMask({
        source: 'source.ts:10',
        filterPlan
      })
    ).toBe(TRACE_SPAN_FILTER_MASK_NONE);
  });

  it('keeps slash-prefixed literal paths out of regexp compilation', () => {
    const regexSpy = vi.spyOn(globalThis, 'RegExp');

    try {
      const filterPlan = buildCompiledTraceSpanFilterPlan(['/workspace/project/crates']);

      expect(filterPlan.literalPrefixes).toEqual(['/workspace/project/crates']);
      expect(filterPlan.regexMatchers).toEqual([]);
      expect(regexSpy).not.toHaveBeenCalled();
    } finally {
      regexSpy.mockRestore();
    }
  });

  it('preserves regexp-filter compatibility helpers for source matches', () => {
    const sourceMask = TRACE_SPAN_FILTER_MASK_SOURCE;

    expect(hasTraceSpanNameFilter(sourceMask)).toBe(false);
    expect(hasTraceSpanSourceFilter(sourceMask)).toBe(true);
    expect(hasTraceSpanRegexpFilter(sourceMask)).toBe(true);
    expect(hasTraceSpanRegexpFilter(TRACE_SPAN_FILTER_MASK_NONE)).toBe(false);
  });
});
