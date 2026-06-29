import {describe, expect, it, vi} from 'vitest';

import {createTraceStreamReplaceChunk, createTraceStreamSession} from './trace-stream-session';

import type {
  TraceCrossProcessDependency,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceThread
} from './index';

/**
 * Create one minimal thread for a streamed process.
 */
function createThread(processId: string, threadId: string): TraceThread {
  return {
    type: 'trace-thread',
    name: threadId,
    threadId: threadId as TraceThread['threadId'],
    processId
  };
}

/**
 * Create one minimal span for streamed-session tests.
 */
function createSpan(
  processId: string,
  threadId: string,
  spanId: string,
  startTimeMs: number
): TraceSpan {
  return {
    type: 'trace-span',
    spanId: spanId as TraceSpan['spanId'],
    threadId: threadId as TraceSpan['threadId'],
    processName: processId,
    name: spanId,
    primaryTimingKey: 'default',
    timings: {
      default: {
        status: 'finished',
        startTimeMs,
        endTimeMs: startTimeMs + 1,
        durationMs: 1,
        durationMsAsString: '1 ms'
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}

/**
 * Create one minimal local dependency for streamed-session tests.
 */
function createLocalDependency(
  startSpanId: string,
  endSpanId: string,
  dependencyId: string
): TraceLocalDependency {
  return {
    type: 'trace-local-dependency',
    dependencyId: dependencyId as TraceLocalDependency['dependencyId'],
    startSpanId: startSpanId as TraceLocalDependency['startSpanId'],
    endSpanId: endSpanId as TraceLocalDependency['endSpanId'],
    keywords: new Set(),
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: 1
  };
}

/**
 * Create one minimal cross dependency for streamed-session tests.
 */
function createCrossDependency(
  startSpanId: string,
  endSpanId: string,
  dependencyId: string
): TraceCrossProcessDependency {
  return {
    type: 'trace-cross-process-dependency',
    dependencyId: dependencyId as TraceCrossProcessDependency['dependencyId'],
    endpointId: `${dependencyId}:endpoint` as TraceCrossProcessDependency['endpointId'],
    startRankNum: 0,
    endRankNum: 1,
    startSpanId: startSpanId as TraceCrossProcessDependency['startSpanId'],
    endSpanId: endSpanId as TraceCrossProcessDependency['endSpanId'],
    waitMode: 'end-to-start',
    bidirectional: false,
    topology: 'test',
    waitTimeMs: 1,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set()
  };
}

/**
 * Create one minimal immutable process snapshot.
 */
function createProcess(processId: string, rankNum: number, spans: TraceSpan[]): TraceProcess {
  const thread = createThread(processId, `${processId}-thread`);
  return {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum,
    stepNum: 0,
    threads: [thread],
    threadMap: {
      [thread.threadId]: thread
    },
    spans: spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: [],
    remoteDependencies: []
  };
}

describe('createTraceStreamSession', () => {
  it('publishes appended spans with stable row ordering', () => {
    const session = createTraceStreamSession({name: 'stream', publishIntervalMs: 0});
    const processId = 'rank-a';
    const threadId = `${processId}-thread`;

    session.applyChunk({
      processUpserts: [{processId: processId, name: processId, rankNum: 0}],
      threadUpserts: [{processId, thread: createThread(processId, threadId)}],
      appendSpans: [
        {processId, span: createSpan(processId, threadId, 'span-a', 0)},
        {processId, span: createSpan(processId, threadId, 'span-b', 1)}
      ]
    });
    const firstSnapshot = session.publishSnapshot();

    session.applyChunk({
      upsertSpans: [{processId, span: createSpan(processId, threadId, 'span-a', 10)}]
    });
    const secondSnapshot = session.publishSnapshot();

    expect(firstSnapshot?.traceGraphData.stats.spanCount).toBe(2);
    expect(
      secondSnapshot?.traceGraph.getSpanRefByExternalBlockId('span-a' as TraceSpan['spanId'])
    ).toBe(firstSnapshot?.traceGraph.getSpanRefByExternalBlockId('span-a' as TraceSpan['spanId']));
    const updatedSpanRef =
      secondSnapshot?.traceGraph.getSpanRefByExternalBlockId('span-a' as TraceSpan['spanId']) ??
      null;
    expect(
      updatedSpanRef == null
        ? null
        : secondSnapshot?.traceGraph.getVisibleDisplaySourceBySpanRef(updatedSpanRef)?.timings
            .default.startTimeMs
    ).toBe(10);
  });

  it('replaces mutable state from an immutable snapshot', () => {
    const session = createTraceStreamSession({publishIntervalMs: 0});
    const process = createProcess('rank-a', 0, [
      createSpan('rank-a', 'rank-a-thread', 'span-a', 0)
    ]);

    session.applyChunk(
      createTraceStreamReplaceChunk({
        name: 'replacement',
        processes: [process],
        crossDependencies: []
      })
    );
    const snapshot = session.publishSnapshot();

    expect(snapshot?.traceGraphData.name).toBe('replacement');
    expect(snapshot?.traceGraphData.stats.spanCount).toBe(1);
    const spanRef =
      snapshot?.traceGraph.getSpanRefByExternalBlockId('span-a' as TraceSpan['spanId']) ?? null;
    expect(
      spanRef == null ? null : snapshot?.traceGraph.getVisibleDisplaySourceBySpanRef(spanRef)?.name
    ).toBe('span-a');
  });

  it('publishes local and cross dependencies with listeners', async () => {
    const session = createTraceStreamSession({publishIntervalMs: 0});
    const listener = vi.fn();
    const processA = 'rank-a';
    const processB = 'rank-b';
    const streamA = `${processA}-thread`;
    const streamB = `${processB}-thread`;
    session.subscribe(listener);

    session.applyChunk({
      processUpserts: [
        {processId: processA, name: processA, rankNum: 0},
        {processId: processB, name: processB, rankNum: 1}
      ],
      threadUpserts: [
        {processId: processA, thread: createThread(processA, streamA)},
        {processId: processB, thread: createThread(processB, streamB)}
      ],
      appendSpans: [
        {processId: processA, span: createSpan(processA, streamA, 'span-a', 0)},
        {processId: processA, span: createSpan(processA, streamA, 'span-b', 1)},
        {processId: processB, span: createSpan(processB, streamB, 'span-c', 2)}
      ],
      appendLocalDependencies: [
        {
          processId: processA,
          dependency: createLocalDependency('span-a', 'span-b', 'local-dep')
        }
      ],
      appendCrossDependencies: [createCrossDependency('span-b', 'span-c', 'cross-dep')]
    });

    const snapshot = session.publishSnapshot();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(snapshot?.traceGraphData.stats.dependencyCount).toBe(2);
    expect(snapshot?.traceGraph.processes[0]?.localDependencies).toHaveLength(1);
    expect(snapshot?.traceGraph.getVisibleCrossDependencySources()).toHaveLength(1);
  });
});
