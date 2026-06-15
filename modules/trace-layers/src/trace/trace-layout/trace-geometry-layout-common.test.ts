import {describe, expect, it} from 'vitest';

import {
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef
} from '../trace-graph/trace-id-encoder';
import {
  buildTraceCrossRankDependencyGeometry,
  computeInterleavedRankDeltas,
  getLocalDependencyPathFlat
} from './trace-geometry-layout-common';

import type {ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceDependencyId,
  TraceSpanId,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {TraceGeometryLayoutLookup} from './trace-geometry-layout-common';
import type {ProcessLayout, ThreadLayout, TraceLayout} from './trace-layout';

type TestLayoutGraph = {
  /** Process rows exposed to inter-graph rank matching. */
  processes: {
    /** Stable process id used for inter-graph rank matching. */
    processId: string;
    /** Exact graph-local process ref used by ref-native layout lookup. */
    processRef: ProcessRef;
  }[];
};

/** Creates the minimum graph shape needed by rank-delta tests. */
function createTestLayoutGraph(processIds: string[]): TestLayoutGraph {
  return {
    processes: processIds.map((processId, processIndex) => ({
      processId,
      processRef: encodeProcessRef(processIndex)
    }))
  };
}

/** Creates the minimum trace layout shape needed by rank-delta tests. */
function createTestTraceLayout(yOffsets: number[]): TraceLayout {
  return {
    processLayouts: yOffsets.map(
      (yOffset, processIndex) =>
        ({processRef: encodeProcessRef(processIndex), yOffset}) as ProcessLayout
    )
  } as unknown as TraceLayout;
}

/** Builds one finished span span used by dependency geometry tests. */
function createDependencyPathSpan(
  spanId: string,
  spanRef: SpanRef,
  processRef: ProcessRef,
  threadRef: ThreadRef,
  threadId: TraceThreadId,
  startTimeMs: number,
  endTimeMs: number
): Parameters<typeof getLocalDependencyPathFlat>[0]['startSpan'] {
  const durationMs = endTimeMs - startTimeMs;
  return {
    spanRef,
    processRef,
    threadRef,
    spanId: spanId as TraceSpanId,
    threadId,
    primaryTimingKey: 'test',
    timings: {
      test: {
        status: 'finished',
        startTimeMs,
        endTimeMs,
        durationMs,
        durationMsAsString: `${durationMs}ms`
      }
    }
  };
}

/** Builds ref-native visible thread lookup state at stable dependency-test y positions. */
function createDependencyLayoutLookup(params: {
  /** Parent span rendered at the start dependency endpoint. */
  parentSpan: Parameters<typeof getLocalDependencyPathFlat>[0]['startSpan'];
  /** Parent thread ref owning the start dependency endpoint. */
  parentThreadRef: ThreadRef;
  /** Child span rendered at the end dependency endpoint. */
  childSpan: Parameters<typeof getLocalDependencyPathFlat>[0]['endSpan'];
  /** Child thread ref owning the end dependency endpoint. */
  childThreadRef: ThreadRef;
}): TraceGeometryLayoutLookup {
  const parentThreadLayout = {
    visible: true,
    yPosition: 1,
    startPosition: [0, 1, 0],
    targetPosition: [100, 1, 0]
  } satisfies ThreadLayout;
  const childThreadLayout = {
    visible: true,
    yPosition: 2,
    startPosition: [0, 2, 0],
    targetPosition: [100, 2, 0]
  } satisfies ThreadLayout;
  return {
    traceGraph: {
      getProcessRefBySpanRef: () => null,
      getThreadRefBySpanRef: spanRef =>
        spanRef === params.parentSpan.spanRef ? params.parentThreadRef : params.childThreadRef
    },
    threadLayoutsByRef: new Map([
      [params.parentThreadRef, parentThreadLayout],
      [params.childThreadRef, childThreadLayout]
    ]),
    processLayoutsByRef: new Map()
  };
}

/** Builds one cross-process parent dependency for dependency geometry tests. */
function createCrossParentDependency(
  startSpanId: TraceSpanId,
  endSpanId: TraceSpanId
): TraceCrossProcessDependency {
  return {
    type: 'trace-cross-process-dependency',
    dependencyId: 'cross-parent' as TraceDependencyId,
    endpointId: 'cross-parent:endpoint' as TraceCrossProcessDependency['endpointId'],
    startRankNum: 0,
    endRankNum: 1,
    startSpanId,
    endSpanId,
    waitMode: 'end-to-start',
    bidirectional: false,
    topology: 'parent',
    waitTimeMs: 0,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set(['PARENT'])
  };
}

describe('getLocalDependencyPathFlat', () => {
  it('routes dependency paths from the source span timing to the dependent span timing', () => {
    /** Parameter shape accepted by local dependency path construction. */
    type LocalDependencyPathParams = Parameters<typeof getLocalDependencyPathFlat>[0];
    const startThreadId = 'source-thread' as TraceThreadId;
    const endThreadId = 'dependent-thread' as TraceThreadId;
    const startThreadRef = encodeProcessThreadRef(0, 0);
    const endThreadRef = encodeProcessThreadRef(0, 1);
    const startSpan = {
      spanRef: encodeSpanRef(0, 0),
      processRef: encodeProcessRef(0),
      threadRef: startThreadRef,
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
    } satisfies LocalDependencyPathParams['startSpan'];
    const endSpan = {
      spanRef: encodeSpanRef(0, 1),
      processRef: encodeProcessRef(0),
      threadRef: endThreadRef,
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
    } satisfies LocalDependencyPathParams['endSpan'];
    const layoutLookup = createDependencyLayoutLookup({
      parentSpan: startSpan,
      parentThreadRef: startThreadRef,
      childSpan: endSpan,
      childThreadRef: endThreadRef
    });

    const commonParams = {
      startSpan,
      endSpan,
      layoutLookup,
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

  it('starts parent dependency paths at the parent start', () => {
    /** Parameter shape accepted by local dependency path construction. */
    type LocalDependencyPathParams = Parameters<typeof getLocalDependencyPathFlat>[0];
    const parentThreadId = 'parent-thread' as TraceThreadId;
    const childThreadId = 'child-thread' as TraceThreadId;
    const parentThreadRef = encodeProcessThreadRef(0, 0);
    const childThreadRef = encodeProcessThreadRef(0, 1);
    const parentSpan = createDependencyPathSpan(
      'parent-span',
      encodeSpanRef(0, 10),
      encodeProcessRef(0),
      parentThreadRef,
      parentThreadId,
      10,
      20
    );
    const childSpan = createDependencyPathSpan(
      'child-span',
      encodeSpanRef(0, 30),
      encodeProcessRef(0),
      childThreadRef,
      childThreadId,
      30,
      40
    );
    const layoutLookup = createDependencyLayoutLookup({
      parentSpan,
      parentThreadRef,
      childSpan,
      childThreadRef
    });

    expect(
      Array.from(
        getLocalDependencyPathFlat({
          startSpan: parentSpan,
          endSpan: childSpan,
          layoutLookup,
          maxTimeMs: 100,
          minTimeMs: 0,
          waitMode: 'end-to-start',
          bidirectional: false,
          isParentDependency: true
        } satisfies LocalDependencyPathParams)
      )
    ).toEqual([10, 1, 30, 2]);
  });

  it('lands cross-rank parent dependency paths on the child span start', () => {
    const parentThreadId = 'parent-thread' as TraceThreadId;
    const childThreadId = 'child-thread' as TraceThreadId;
    const parentThreadRef = encodeProcessThreadRef(0, 0);
    const childThreadRef = encodeProcessThreadRef(1, 0);
    const parentSpan = createDependencyPathSpan(
      'parent-span',
      encodeSpanRef(0, 10),
      encodeProcessRef(0),
      parentThreadRef,
      parentThreadId,
      10,
      20
    );
    const childSpan = createDependencyPathSpan(
      'child-span',
      encodeSpanRef(1, 30),
      encodeProcessRef(1),
      childThreadRef,
      childThreadId,
      30,
      40
    );
    const dependency = {
      ...createCrossParentDependency(parentSpan.spanId, childSpan.spanId),
      startSpanRef: parentSpan.spanRef,
      endSpanRef: childSpan.spanRef
    } satisfies Parameters<typeof buildTraceCrossRankDependencyGeometry>[0]['crossDependency'];
    const layoutLookup = createDependencyLayoutLookup({
      parentSpan,
      parentThreadRef,
      childSpan,
      childThreadRef
    });

    const result = buildTraceCrossRankDependencyGeometry({
      crossDependency: dependency,
      maxTimeMs: 100,
      minTimeMs: 0,
      spanByRef: new Map([
        [parentSpan.spanRef, parentSpan],
        [childSpan.spanRef, childSpan]
      ]),
      layoutLookup
    });

    expect(result.skippedEndpoint).toBeNull();
    expect(Array.from(result.geometry ?? [])).toEqual([10, 1, 30, 2]);
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
