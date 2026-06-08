import {describe, expect, it, vi} from 'vitest';

import {buildTraceGraphDataFromJSONTrace} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {TraceGraph} from './trace-graph';

import type {
  TraceDependencyId,
  TraceLocalDependency,
  TraceProcess,
  TraceProcessId,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from './trace-types';

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

describe('TraceGraph dependency neighborhoods', () => {
  it('reads unfiltered immediate dependencies from span sidecars without projections', () => {
    const parentSpanId = 'rank-1-parent' as TraceSpanId;
    const childSpanId = 'rank-1-child' as TraceSpanId;
    const grandchildSpanId = 'rank-1-grandchild' as TraceSpanId;
    const graph = createTestTraceGraph(
      buildTraceGraphDataFromJSONTrace(
        buildJSONTrace(
          [
            createProcess({
              processId: 'rank-1' as TraceProcessId,
              spans: [
                createSpan({spanId: parentSpanId, startTimeMs: 0, endTimeMs: 5}),
                createSpan({spanId: childSpanId, startTimeMs: 6, endTimeMs: 10}),
                createSpan({spanId: grandchildSpanId, startTimeMs: 12, endTimeMs: 15})
              ],
              localDependencies: [
                createLocalDependency('dep-a', parentSpanId, childSpanId, 10),
                createLocalDependency('dep-b', parentSpanId, childSpanId, 20),
                createLocalDependency('dep-c', childSpanId, grandchildSpanId, 30),
                createLocalDependency('dep-d', childSpanId, grandchildSpanId, 40)
              ]
            })
          ],
          []
        )
      )
    );
    const childSpanRef = graph.getSpanRefByExternalBlockId(childSpanId)!;
    const projectionSpy = vi.spyOn(graph, 'getProjection');
    const sourceProjectionSpy = vi.spyOn(graph, 'getSourceProjection');

    const dependencyRefs = graph.getSpanDirectionalDependencyRefs(childSpanRef, 'incoming');
    const cardModel = graph.getTraceSpanCardModel(childSpanRef);

    expect(dependencyRefs.localDependencyRefs).toHaveLength(2);
    expect(
      cardModel?.visibleIncomingDependencyEntries.map(entry => entry.dependency.dependencyId)
    ).toEqual(['dep-b', 'dep-a']);
    expect(
      cardModel?.visibleOutgoingDependencyEntries.map(entry => entry.dependency.dependencyId)
    ).toEqual(['dep-d', 'dep-c']);
    expect(projectionSpy).not.toHaveBeenCalled();
    expect(sourceProjectionSpy).not.toHaveBeenCalled();
  });

  it('reads filtered immediate dependencies from visible refs without projections', () => {
    const parentSpanId = 'rank-1-parent' as TraceSpanId;
    const childSpanId = 'rank-1-child' as TraceSpanId;
    const grandchildSpanId = 'rank-1-grandchild' as TraceSpanId;
    const graph = createTestTraceGraph(
      buildTraceGraphDataFromJSONTrace(
        buildJSONTrace(
          [
            createProcess({
              processId: 'rank-1' as TraceProcessId,
              spans: [
                createSpan({spanId: parentSpanId, startTimeMs: 0, endTimeMs: 5}),
                createSpan({spanId: childSpanId, startTimeMs: 6, endTimeMs: 10}),
                createSpan({spanId: grandchildSpanId, startTimeMs: 12, endTimeMs: 15})
              ],
              localDependencies: [
                createLocalDependency('dep-a', parentSpanId, childSpanId, 10),
                createLocalDependency('dep-b', childSpanId, grandchildSpanId, 20)
              ]
            })
          ],
          []
        )
      ),
      {spanFilters: ['child']}
    );
    const childSpanRef = graph.getSpanRefByExternalBlockId(childSpanId)!;
    const projectionSpy = vi.spyOn(graph, 'getProjection');
    const sourceProjectionSpy = vi.spyOn(graph, 'getSourceProjection');

    const dependencySources = graph.getSpanDirectionalDependencySources(childSpanRef, 'outgoing');
    const visibleRefs = graph.getVisibleDependencyRefsForSpan(childSpanRef);

    expect(dependencySources.map(source => source.dependencyId)).toEqual(['dep-b']);
    expect(visibleRefs).toHaveLength(2);
    expect(projectionSpy).not.toHaveBeenCalled();
    expect(sourceProjectionSpy).not.toHaveBeenCalled();
  });
});

function createProcess(params: {
  /** Stable source process id. */
  processId: TraceProcessId;
  /** Process-local spans. */
  spans: TraceSpan[];
  /** Process-local dependencies. */
  localDependencies: TraceLocalDependency[];
}): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId: params.processId
  };
  return {
    type: 'trace-process',
    processId: params.processId,
    name: params.processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: params.spans,
    spanMap: Object.fromEntries(params.spans.map(span => [span.spanId, span])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: params.localDependencies,
    remoteDependencies: []
  };
}

function createSpan(params: {
  /** Stable source span id. */
  spanId: TraceSpanId;
  /** Primary start time in milliseconds. */
  startTimeMs: number;
  /** Primary end time in milliseconds. */
  endTimeMs: number;
}): TraceSpan {
  return {
    type: 'trace-span',
    spanId: params.spanId,
    threadId: 'thread-1' as TraceThreadId,
    processName: 'rank-1',
    name: params.spanId,
    keywords: [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
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

function createLocalDependency(
  dependencyId: string,
  startSpanId: TraceSpanId,
  endSpanId: TraceSpanId,
  waitTimeMs: number
): TraceLocalDependency {
  return {
    type: 'trace-local-dependency',
    dependencyId: dependencyId as TraceDependencyId,
    startSpanId,
    endSpanId,
    keywords: new Set(['PARENT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs
  };
}
