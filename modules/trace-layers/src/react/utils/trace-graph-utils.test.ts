import {describe, expect, it} from 'vitest';

import {buildJSONTrace, buildTraceGraphDataFromJSONTrace, TraceGraph} from '../../trace/index';
import {createStaticTraceGraphRuntimeSource} from '../../trace/trace-chunk-store';
import {getRankNumForSpanRef} from './trace-graph-utils';

import type {
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../../trace/index';

function createTestTraceGraph(
  traceGraphData: Parameters<typeof createStaticTraceGraphRuntimeSource>[0]['traceGraphData'],
  options?: ConstructorParameters<typeof TraceGraph>[1]
): TraceGraph {
  return new TraceGraph(
    createStaticTraceGraphRuntimeSource({
      identityKey: `${traceGraphData.name}:test`,
      traceGraphData
    }),
    options
  );
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
    localDependencyIds: [],
    localDependencies: [],
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
    localDependencies: [],
    remoteDependencies: []
  };
}

describe('getRankNumForSpanRef', () => {
  it('resolves rank numbers from TraceGraph instances', () => {
    const graph = createTestTraceGraph(
      buildTraceGraphDataFromJSONTrace(
        buildJSONTrace(
          [createProcess('rank-1', 0, 'span-1'), createProcess('rank-2', 1, 'span-2')],
          [],
          {name: 'rank-helper-test'}
        )
      )
    );

    const spanRef = graph.getSpanRefByExternalBlockId('span-2' as TraceSpanId);

    expect(getRankNumForSpanRef(graph, spanRef)).toBe(1);
    expect(getRankNumForSpanRef(graph, null)).toBeNull();
    expect(getRankNumForSpanRef(null, spanRef)).toBeNull();
  });
});
