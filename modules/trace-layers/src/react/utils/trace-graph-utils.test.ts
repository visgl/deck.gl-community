import {describe, expect, it} from 'vitest';

import {buildJSONTrace, TraceGraph} from '../../trace';
import {createRuntimeTraceGraph} from '../../trace/trace-graph/trace-graph-test-fixtures';
import {getRankNumForSpanRef} from './trace-graph-utils';

import type {TraceProcess, TraceSpan, TraceSpanId, TraceThread, TraceThreadId} from '../../trace';

function createTestTraceGraph(
  traceGraph: Parameters<typeof createRuntimeTraceGraph>[0],
  options?: Parameters<typeof createRuntimeTraceGraph>[1]
): TraceGraph {
  return createRuntimeTraceGraph(traceGraph, options);
}

/**
 * Builds one minimal process with a single span for filtered rank helper tests.
 */
function createProcess(processId: string, rankNum: number, spanId: string): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-thread`,
    threadId: `${processId}-thread` as TraceThreadId,
    processId
  };
  const span: TraceSpan = {
    type: 'trace-span',
    spanId: spanId as TraceSpanId,
    threadId: thread.threadId,
    processName: processId,
    name: spanId,
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
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };

  return {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [span],
    spanMap: {[span.spanId]: span},
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    sameProcessDependencies: [],
    remoteDependencies: []
  };
}

describe('getRankNumForSpanRef', () => {
  it('resolves rank numbers from TraceGraph instances', () => {
    const graph = createTestTraceGraph(
      buildJSONTrace(
        [createProcess('rank-1', 0, 'span-1'), createProcess('rank-2', 1, 'span-2')],
        [],
        {name: 'rank-helper-test'}
      )
    );

    const spanRef = graph.getSpanRefById('span-2' as TraceSpanId);

    expect(getRankNumForSpanRef(graph, spanRef)).toBe(1);
    expect(getRankNumForSpanRef(graph, null)).toBeNull();
    expect(getRankNumForSpanRef(null, spanRef)).toBeNull();
  });
});
