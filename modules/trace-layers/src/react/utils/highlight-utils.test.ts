import {describe, expect, it, vi} from 'vitest';

import {filterValidSpanIds} from './highlight-utils';

import type {TraceSpan, TraceSpanId, TraceThreadId} from '../../trace/index';

function makeBlock(spanId: TraceSpanId): TraceSpan {
  return {
    type: 'trace-span',
    spanId,
    threadId: 'stream-1' as TraceThreadId,
    processName: 'rank',
    name: 'span',
    keywords: [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: 0,
        endTimeMs: 1,
        durationMs: 1,
        durationMsAsString: '1ms'
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}

describe('filterValidSpanIds', () => {
  const blockA = 'a' as TraceSpanId;
  const blockB = 'b' as TraceSpanId;
  const spanMap: Record<string, TraceSpan> = {
    [blockA]: makeBlock(blockA),
    [blockB]: makeBlock(blockB)
  };

  it('returns undefined when no ids are provided', () => {
    expect(filterValidSpanIds(new Set(), spanMap)).toBeUndefined();
    expect(filterValidSpanIds(undefined, spanMap)).toBeUndefined();
  });

  it('returns the original ids when the span lookup is null or undefined', () => {
    expect(filterValidSpanIds(new Set([blockA]), null)).toEqual(new Set([blockA]));
    expect(filterValidSpanIds(new Set([blockA, blockB]), undefined)).toEqual(
      new Set([blockA, blockB])
    );
  });

  it('filters out ids missing from a record lookup', () => {
    expect(filterValidSpanIds(new Set([blockA, 'missing' as TraceSpanId]), spanMap)).toEqual(
      new Set([blockA])
    );
  });

  it('filters out ids missing from a function lookup', () => {
    const resolveBlock = vi.fn((spanId: TraceSpanId) => spanMap[spanId] ?? null);

    expect(
      filterValidSpanIds(new Set([blockA, 'missing' as TraceSpanId, blockB]), resolveBlock)
    ).toEqual(new Set([blockA, blockB]));
    expect(resolveBlock).toHaveBeenCalledTimes(3);
  });

  it('returns undefined when no ids remain after filtering', () => {
    expect(filterValidSpanIds(new Set(['missing' as TraceSpanId]), spanMap)).toBeUndefined();
  });
});
