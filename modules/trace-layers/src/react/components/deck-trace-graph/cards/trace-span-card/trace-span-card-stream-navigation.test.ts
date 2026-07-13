import {describe, expect, it, vi} from 'vitest';

import {buildJSONTrace, TraceGraph} from '../../../../../trace';
import {createRuntimeTraceGraph} from '../../../../../trace/trace-graph/trace-graph-test-fixtures';
import {getRequiredSpanRef} from '../../../../../trace/trace-graph/trace-graph-test-utils';
import {getThreadNavigation} from './trace-span-card-stream-navigation';

import type {
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../../../../../trace';

function createTestTraceGraph(
  traceGraph: Parameters<typeof createRuntimeTraceGraph>[0],
  options?: Parameters<typeof createRuntimeTraceGraph>[1]
): TraceGraph {
  return createRuntimeTraceGraph(traceGraph, options);
}

describe('getThreadNavigation', () => {
  it('returns previous and next spans ordered by stream timing', () => {
    const threadId = 'stream-1' as TraceThreadId;
    const thread: TraceThread = {
      type: 'trace-thread',
      name: 'main-stream',
      threadId,
      processId: 'rank-1'
    };
    const spans: TraceSpan[] = [
      createBlock({
        spanId: 'later' as TraceSpanId,
        threadId,
        startTimeMs: 20,
        endTimeMs: 25
      }),
      createBlock({
        spanId: 'earlier' as TraceSpanId,
        threadId,
        startTimeMs: 10,
        endTimeMs: 12
      }),
      createBlock({
        spanId: 'selected' as TraceSpanId,
        threadId,
        startTimeMs: 15,
        endTimeMs: 16
      })
    ];
    const process: TraceProcess = {
      type: 'trace-process',
      processId: 'rank-1',
      name: 'rank-1',
      rankNum: 3,
      stepNum: 0,
      threads: [thread],
      threadMap: {[threadId]: thread},
      spans,
      spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      sameProcessDependencies: [],
      remoteDependencies: []
    };
    const sourceTraceGraph = buildJSONTrace([process], [], {name: 'stream-navigation'});
    const traceGraph = createTestTraceGraph(sourceTraceGraph);

    expect(getThreadNavigation(getRequiredSpanRef(traceGraph, spans[2]!), traceGraph)).toEqual({
      previousSpanRef: getRequiredSpanRef(traceGraph, spans[1]!),
      nextSpanRef: getRequiredSpanRef(traceGraph, spans[0]!),
      previousSpanId: 'earlier',
      nextSpanId: 'later',
      streamName: 'main-stream',
      positionLabel: '2 / 3',
      rankNum: 3
    });
  });

  it('returns the empty state when the span is not in the graph', () => {
    const sourceTraceGraph = buildJSONTrace([], [], {name: 'empty-stream-navigation'});
    const traceGraph = createTestTraceGraph(sourceTraceGraph);
    expect(getThreadNavigation(0 as never, traceGraph)).toEqual({
      previousSpanRef: null,
      nextSpanRef: null,
      previousSpanId: null,
      nextSpanId: null,
      streamName: null,
      positionLabel: null,
      rankNum: null
    });
  });

  it('uses visible display sources instead of materializing every process span', () => {
    const threadId = 'stream-1' as TraceThreadId;
    const thread: TraceThread = {
      type: 'trace-thread',
      name: 'main-stream',
      threadId,
      processId: 'rank-1'
    };
    const spans: TraceSpan[] = [
      createBlock({
        spanId: 'selected' as TraceSpanId,
        threadId,
        startTimeMs: 15,
        endTimeMs: 16
      }),
      createBlock({
        spanId: 'later' as TraceSpanId,
        threadId,
        startTimeMs: 20,
        endTimeMs: 25
      })
    ];
    const process: TraceProcess = {
      type: 'trace-process',
      processId: 'rank-1',
      name: 'rank-1',
      rankNum: 3,
      stepNum: 0,
      threads: [thread],
      threadMap: {[threadId]: thread},
      spans,
      spanMap: Object.fromEntries(spans.map(candidate => [candidate.spanId, candidate])),
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      sameProcessDependencies: [],
      remoteDependencies: []
    };
    const sourceTraceGraph = buildJSONTrace([process], [], {
      name: 'stream-navigation-no-process-spans'
    });
    const traceGraph = createTestTraceGraph(sourceTraceGraph);
    const getProcessSpanRefsSpy = vi.spyOn(traceGraph, 'iterateVisibleSpanRefsByProcess');

    expect(
      getThreadNavigation(getRequiredSpanRef(traceGraph, spans[0]!), traceGraph)
    ).toMatchObject({
      nextSpanRef: getRequiredSpanRef(traceGraph, spans[1]!),
      nextSpanId: 'later',
      previousSpanRef: null,
      previousSpanId: null,
      positionLabel: '1 / 2'
    });

    expect(getProcessSpanRefsSpy).toHaveBeenCalled();
    getProcessSpanRefsSpy.mockRestore();
  });
});

function createBlock(params: {
  spanId: TraceSpanId;
  threadId: TraceThreadId;
  startTimeMs: number;
  endTimeMs: number;
}): TraceSpan {
  return {
    type: 'trace-span',
    spanId: params.spanId,
    threadId: params.threadId,
    processName: 'rank-1',
    name: String(params.spanId),
    keywords: [],
    primaryTimingKey: 'default',
    timings: {
      default: {
        status: 'finished',
        startTimeMs: params.startTimeMs,
        endTimeMs: params.endTimeMs,
        durationMs: params.endTimeMs - params.startTimeMs,
        durationMsAsString: `${params.endTimeMs - params.startTimeMs}ms`
      }
    },
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}
