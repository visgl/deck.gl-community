import {describe, expect, it} from 'vitest';

import {
  computeInterleavedRankDeltas,
  getLocalDependencyPathFlat
} from './trace-geometry-layout-common';

import type {TraceSpanId, TraceThreadId} from '../trace-graph/trace-types';
import type {ProcessLayout, ThreadLayout, TraceLayout} from './trace-layout';

type TestLayoutGraph = {
  /** Process rows exposed to inter-graph rank matching. */
  processes: {processId: string}[];
};

/** Creates the minimum graph shape needed by rank-delta tests. */
function createTestLayoutGraph(processIds: string[]): TestLayoutGraph {
  return {
    processes: processIds.map(processId => ({processId}))
  };
}

/** Creates the minimum trace layout shape needed by rank-delta tests. */
function createTestTraceLayout(yOffsets: number[]): TraceLayout {
  return {
    processLayouts: yOffsets.map(yOffset => ({yOffset}) as ProcessLayout)
  } as unknown as TraceLayout;
}

describe('getLocalDependencyPathFlat', () => {
  it('routes dependency paths from the source span timing to the dependent span timing', () => {
    type LocalDependencyPathParams = Parameters<typeof getLocalDependencyPathFlat>[0];
    const startThreadId = 'source-thread' as TraceThreadId;
    const endThreadId = 'dependent-thread' as TraceThreadId;
    const startBlock = {
      spanId: 'source-span' as TraceSpanId,
      threadId: startThreadId,
      primaryTimingKey: 'test',
      timings: {
        test: {
          status: 'finished',
          startTimeMs: 10,
          endTimeMs: 20,
          durationMs: 10,
          durationMsAsString: '10ms'
        }
      }
    } satisfies LocalDependencyPathParams['startBlock'];
    const endBlock = {
      spanId: 'dependent-span' as TraceSpanId,
      threadId: endThreadId,
      primaryTimingKey: 'test',
      timings: {
        test: {
          status: 'finished',
          startTimeMs: 30,
          endTimeMs: 40,
          durationMs: 10,
          durationMsAsString: '10ms'
        }
      }
    } satisfies LocalDependencyPathParams['endBlock'];
    const threadLayoutMap = {
      [startThreadId]: {
        visible: true,
        yPosition: 1,
        startPosition: [0, 1, 0],
        targetPosition: [100, 1, 0]
      },
      [endThreadId]: {
        visible: true,
        yPosition: 2,
        startPosition: [0, 2, 0],
        targetPosition: [100, 2, 0]
      }
    } satisfies Record<TraceThreadId, ThreadLayout>;

    const commonParams = {
      startBlock,
      endBlock,
      threadLayoutMap,
      maxTimeMs: 100,
      minTimeMs: 0,
      bidirectional: false
    } satisfies Omit<LocalDependencyPathParams, 'waitMode'>;

    expect(
      Array.from(getLocalDependencyPathFlat({...commonParams, waitMode: 'end-to-start'}))
    ).toEqual([20, 1, 30, 2]);
    expect(
      Array.from(getLocalDependencyPathFlat({...commonParams, waitMode: 'end-to-end'}))
    ).toEqual([20, 1, 40, 2]);
    expect(
      Array.from(getLocalDependencyPathFlat({...commonParams, waitMode: 'start-to-start'}))
    ).toEqual([10, 1, 30, 2]);
  });
});

describe('computeInterleavedRankDeltas', () => {
  it('falls back to rank position when process ids do not match across graphs', () => {
    const deltas = computeInterleavedRankDeltas([
      {
        traceGraph: createTestLayoutGraph(['rank-a', 'rank-b']),
        layout: createTestTraceLayout([0, 10]),
        rankSpacings: [10, 10]
      },
      {
        traceGraph: createTestLayoutGraph(['other-a', 'other-b']),
        layout: createTestTraceLayout([0, 10]),
        rankSpacings: [10, 10]
      }
    ]);

    expect(deltas).toEqual([
      [0, 10],
      [10, 20]
    ]);
  });

  it('prefers exact process id matches over rank-position fallback', () => {
    const deltas = computeInterleavedRankDeltas([
      {
        traceGraph: createTestLayoutGraph(['rank-a', 'rank-b']),
        layout: createTestTraceLayout([0, 10]),
        rankSpacings: [10, 10]
      },
      {
        traceGraph: createTestLayoutGraph(['unmatched-rank', 'rank-a']),
        layout: createTestTraceLayout([0, 10]),
        rankSpacings: [10, 10]
      }
    ]);

    expect(deltas).toEqual([
      [0, 10],
      [30, 0]
    ]);
  });
});
