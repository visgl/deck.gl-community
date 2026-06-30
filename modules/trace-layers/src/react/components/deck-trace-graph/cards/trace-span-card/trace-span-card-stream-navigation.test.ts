import {describe, expect, it, vi} from 'vitest';

import {
  buildJSONTrace,
  buildTraceGraphDataFromJSONTrace,
  TraceGraph
} from '../../../../../trace/index';
import {createStaticTraceGraphRuntimeSource} from '../../../../../trace/trace-chunk-store';
import {getRequiredSpanRef} from '../../../../../trace/trace-graph/trace-graph-test-utils';
import {getSameNameNavigation, getThreadNavigation} from './trace-span-card-stream-navigation';

import type {
  TraceDependencyId,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../../../../../trace/index';

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
      localDependencies: [],
      remoteDependencies: []
    };
    const sourceTraceGraph = buildJSONTrace([process], [], {name: 'stream-navigation'});
    const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(sourceTraceGraph));

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
    const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(sourceTraceGraph));
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
      localDependencies: [],
      remoteDependencies: []
    };
    const sourceTraceGraph = buildJSONTrace([process], [], {
      name: 'stream-navigation-no-process-spans'
    });
    const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(sourceTraceGraph));
    const getProcessDisplaySourcesSpy = vi.spyOn(traceGraph, 'getVisibleProcessDisplaySources');

    expect(
      getThreadNavigation(getRequiredSpanRef(traceGraph, spans[0]!), traceGraph)
    ).toMatchObject({
      nextSpanRef: getRequiredSpanRef(traceGraph, spans[1]!),
      nextSpanId: 'later',
      previousSpanRef: null,
      previousSpanId: null,
      positionLabel: '1 / 2'
    });

    expect(getProcessDisplaySourcesSpy).toHaveBeenCalled();
    getProcessDisplaySourcesSpy.mockRestore();
  });
});

describe('getSameNameNavigation', () => {
  it('walks exact-name matches across visible and hidden spans in trace search order', () => {
    const threadId = 'stream-1' as TraceThreadId;
    const thread: TraceThread = {
      type: 'trace-thread',
      name: 'main-stream',
      threadId,
      processId: 'rank-1'
    };
    const parent = {
      ...createBlock({
        spanId: 'same-parent' as TraceSpanId,
        threadId,
        startTimeMs: 0,
        endTimeMs: 10
      }),
      name: 'same-name'
    };
    const hiddenChild = {
      ...createBlock({
        spanId: 'same-hidden-child' as TraceSpanId,
        threadId,
        startTimeMs: 5,
        endTimeMs: 5
      }),
      name: 'same-name'
    };
    const later = {
      ...createBlock({
        spanId: 'same-later' as TraceSpanId,
        threadId,
        startTimeMs: 20,
        endTimeMs: 25
      }),
      name: 'same-name'
    };
    const dependencyId = 'dep-same-hidden-child' as TraceDependencyId;
    const parentDependency: TraceLocalDependency = {
      type: 'trace-local-dependency',
      dependencyId,
      startSpanId: parent.spanId,
      endSpanId: hiddenChild.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    };
    parent.localDependencyIds = [dependencyId];
    const spans = [parent, hiddenChild, later];
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
      localDependencies: [parentDependency],
      remoteDependencies: []
    };
    const traceGraph = createTestTraceGraph(
      buildTraceGraphDataFromJSONTrace(buildJSONTrace([process], [], {name: 'same-name-nav'})),
      {overlappingParentSpanFilter: {maxChildDurationMs: 1}}
    );

    expect(getSameNameNavigation(getRequiredSpanRef(traceGraph, hiddenChild), traceGraph)).toEqual({
      previousSpanRef: getRequiredSpanRef(traceGraph, parent),
      nextSpanRef: getRequiredSpanRef(traceGraph, later),
      spanName: 'same-name',
      positionLabel: '2'
    });
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
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}
