import {describe, expect, it} from 'vitest';

import {brand, getPrimaryTiming} from '../trace-graph/trace-types';
import {findBlockAtTime, lowerBound, upperBound} from './build-trace-graph-from-chrome-trace';

import type {TraceSpan} from '../trace-graph/trace-types';

const makeBlock = (id: string, startTimeMs: number, endTimeMs: number): TraceSpan => {
  return {
    type: 'trace-span',
    spanId: brand<'block', string>(`span:${id}`),
    threadId: brand<'stream', string>(`stream:${id}`),
    processName: 'rank',
    name: `span-${id}`,
    primaryTimingKey: 'test',
    timings: {
      test: {
        status: 'finished',
        startTimeMs,
        endTimeMs,
        durationMs: Math.max(0, endTimeMs - startTimeMs),
        durationMsAsString: `${Math.max(0, endTimeMs - startTimeMs)} ms`
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
};

const makeLookup = (spans: TraceSpan[]) => {
  const startTimes = spans.map(span => getPrimaryTiming(span).startTimeMs);
  const endTimes = spans.map(span => getPrimaryTiming(span).endTimeMs);
  const maxEndTimes = new Array<number>(spans.length);
  let runningMax = Number.NEGATIVE_INFINITY;
  spans.forEach((span, index) => {
    runningMax = Math.max(runningMax, getPrimaryTiming(span).endTimeMs);
    maxEndTimes[index] = runningMax;
  });

  return {
    spans,
    startTimes,
    endTimes,
    maxEndTimes
  };
};

describe('upperBound', () => {
  it('returns the index after the last value <= target', () => {
    expect(upperBound([1, 3, 3, 5], 3)).toBe(3);
    expect(upperBound([1, 3, 3, 5], 4)).toBe(3);
    expect(upperBound([1, 3, 3, 5], 5)).toBe(4);
  });
});

describe('lowerBound', () => {
  it('returns the first index with value >= target within bounds', () => {
    expect(lowerBound([1, 3, 3, 5], 3, 0, 3)).toBe(1);
    expect(lowerBound([1, 3, 3, 5], 4, 0, 3)).toBe(3);
  });
});

describe('findBlockAtTime', () => {
  it('returns undefined for empty or missing lookups', () => {
    expect(findBlockAtTime(undefined, 5)).toBeUndefined();
    expect(findBlockAtTime(makeLookup([]), 5)).toBeUndefined();
  });

  it('finds a span that covers the given time', () => {
    const spans = [makeBlock('a', 0, 5), makeBlock('b', 6, 10)];
    const lookup = makeLookup(spans);

    expect(findBlockAtTime(lookup, 2)?.spanId).toBe(spans[0].spanId);
    expect(findBlockAtTime(lookup, 5)?.spanId).toBe(spans[0].spanId);
    expect(findBlockAtTime(lookup, 7)?.spanId).toBe(spans[1].spanId);
    expect(findBlockAtTime(lookup, 11)).toBeUndefined();
  });
});
