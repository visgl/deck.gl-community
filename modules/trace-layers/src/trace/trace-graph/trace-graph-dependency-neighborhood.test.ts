import {describe, expect, it, vi} from 'vitest';

import {buildJSONTrace} from '../ingestion/json-trace';
import {getTraceSpanCardModel} from './build-trace-span-card-data';
import {TraceGraph} from './trace-graph';
import {
  createDatasetRuntimeTraceGraphForTest,
  createDatasetTraceGraphRuntimeSourceForTest,
  createRuntimeTraceGraph,
  createTraceDatasetFromJSONTraceForTest
} from './trace-graph-test-fixtures';

import type {
  TraceDependencyId,
  TraceProcess,
  TraceProcessId,
  TraceSameProcessDependency,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from './trace-types';

/** Builds a canonical chunk/dataset-backed graph for ordinary JSON fixtures. */
function createTestTraceGraph(
  traceGraph: Parameters<typeof createRuntimeTraceGraph>[0],
  options?: Parameters<typeof createRuntimeTraceGraph>[1]
): TraceGraph {
  return createRuntimeTraceGraph(traceGraph, options);
}

/** Wraps dataset fixtures that intentionally remove canonical sidecar tables. */
function createRawTestTraceGraph(
  traceDataset: Parameters<typeof createDatasetTraceGraphRuntimeSourceForTest>[0],
  options?: Parameters<typeof createRuntimeTraceGraph>[1]
): TraceGraph {
  return createDatasetRuntimeTraceGraphForTest(traceDataset, options);
}

describe('TraceGraph dependency neighborhoods', () => {
  it('reads unfiltered immediate dependencies from canonical dependency rows without projections', () => {
    const parentSpanId = 'rank-1-parent' as TraceSpanId;
    const childSpanId = 'rank-1-child' as TraceSpanId;
    const grandchildSpanId = 'rank-1-grandchild' as TraceSpanId;
    const graph = createTestTraceGraph(
      buildJSONTrace(
        [
          createProcess({
            processId: 'rank-1' as TraceProcessId,
            spans: [
              createSpan({spanId: parentSpanId, startTimeMs: 0, endTimeMs: 5}),
              createSpan({spanId: childSpanId, startTimeMs: 6, endTimeMs: 10}),
              createSpan({spanId: grandchildSpanId, startTimeMs: 12, endTimeMs: 15})
            ],
            sameProcessDependencies: [
              createSameProcessDependency('dep-a', parentSpanId, childSpanId, 10),
              createSameProcessDependency('dep-b', parentSpanId, childSpanId, 20),
              createSameProcessDependency('dep-c', childSpanId, grandchildSpanId, 30),
              createSameProcessDependency('dep-d', childSpanId, grandchildSpanId, 40)
            ]
          })
        ],
        []
      )
    );
    const childSpanRef = graph.getSpanRefById(childSpanId)!;

    const dependencyRefs = graph.getSpanDirectionalDependencyRefs(childSpanRef, 'incoming');
    const cardModel = getTraceSpanCardModel(graph, childSpanRef);

    expect(dependencyRefs.sameProcessDependencyRefs).toHaveLength(2);
    expect(
      cardModel?.visibleIncomingDependencyEntries.map(entry => entry.dependency.dependencyId)
    ).toEqual(['dep-b', 'dep-a']);
    expect(
      cardModel?.visibleOutgoingDependencyEntries.map(entry => entry.dependency.dependencyId)
    ).toEqual(['dep-d', 'dep-c']);
  });

  it('reads filtered immediate dependencies from canonical refs without projections', () => {
    const parentSpanId = 'rank-1-parent' as TraceSpanId;
    const childSpanId = 'rank-1-child' as TraceSpanId;
    const grandchildSpanId = 'rank-1-grandchild' as TraceSpanId;
    const graph = createTestTraceGraph(
      buildJSONTrace(
        [
          createProcess({
            processId: 'rank-1' as TraceProcessId,
            spans: [
              createSpan({spanId: parentSpanId, startTimeMs: 0, endTimeMs: 5}),
              createSpan({spanId: childSpanId, startTimeMs: 6, endTimeMs: 10}),
              createSpan({spanId: grandchildSpanId, startTimeMs: 12, endTimeMs: 15})
            ],
            sameProcessDependencies: [
              createSameProcessDependency('dep-a', parentSpanId, childSpanId, 10),
              createSameProcessDependency('dep-b', childSpanId, grandchildSpanId, 20)
            ]
          })
        ],
        []
      ),
      {spanFilters: ['child']}
    );
    const childSpanRef = graph.getSpanRefById(childSpanId)!;

    const dependencySources = graph.getSpanDirectionalDependencySources(childSpanRef, 'outgoing');
    const visibleRefs = Array.from(
      new Set(
        (['incoming', 'outgoing'] as const).flatMap(
          direction =>
            graph.getVisibleDirectionalDependencyRefSlice(
              childSpanRef,
              direction,
              Number.POSITIVE_INFINITY
            ).dependencyRefs
        )
      )
    );

    expect(
      dependencySources.map(source =>
        source.type === 'trace-cross-process-dependency'
          ? graph.getDependencyId(source.dependencyRef)
          : source.dependencyId
      )
    ).toEqual(['dep-b']);
    expect(visibleRefs).toHaveLength(2);
  });

  it('scans canonical same-process dependency rows and returns empty for an unmatched direction', () => {
    const parentSpanId = 'rank-1-parent' as TraceSpanId;
    const childSpanId = 'rank-1-child' as TraceSpanId;
    const graph = createTestTraceGraph(
      buildJSONTrace(
        [
          createProcess({
            processId: 'rank-1' as TraceProcessId,
            spans: [
              createSpan({spanId: parentSpanId, startTimeMs: 0, endTimeMs: 5}),
              createSpan({spanId: childSpanId, startTimeMs: 6, endTimeMs: 10})
            ],
            sameProcessDependencies: [
              createSameProcessDependency('dep-a', parentSpanId, childSpanId, 10)
            ]
          })
        ],
        []
      )
    );
    const parentSpanRef = graph.getSpanRefById(parentSpanId)!;
    const dependencyTable = graph.sameProcessDependencyTableMap['rank-1' as TraceProcessId];
    if (!dependencyTable) {
      throw new Error('Expected same-process dependency table');
    }
    const getChildSpy = vi.spyOn(dependencyTable, 'getChild');

    expect(
      graph.getSpanDirectionalDependencyRefs(parentSpanRef, 'incoming').sameProcessDependencyRefs
    ).toEqual([]);
    expect(getChildSpy).toHaveBeenCalledWith('endSpanRef');
    getChildSpy.mockRestore();
  });

  it('reads directional refs from canonical dependency rows when the process sidecar map is absent', () => {
    const parentSpanId = 'rank-1-parent' as TraceSpanId;
    const childSpanId = 'rank-1-child' as TraceSpanId;
    const traceDataset = createTraceDatasetFromJSONTraceForTest(
      buildJSONTrace(
        [
          createProcess({
            processId: 'rank-1' as TraceProcessId,
            spans: [
              createSpan({spanId: parentSpanId, startTimeMs: 0, endTimeMs: 5}),
              createSpan({spanId: childSpanId, startTimeMs: 6, endTimeMs: 10})
            ],
            sameProcessDependencies: [
              createSameProcessDependency('dep-a', parentSpanId, childSpanId, 10)
            ]
          })
        ],
        []
      )
    );
    const graph = createRawTestTraceGraph({
      ...traceDataset,
      spanSidecarTableMap: undefined
    });
    const childSpanRef = graph.getSpanRefById(childSpanId)!;
    const dependencyTable = graph.sameProcessDependencyTableMap['rank-1' as TraceProcessId];
    if (!dependencyTable) {
      throw new Error('Expected canonical dependency table');
    }
    const getChildSpy = vi.spyOn(dependencyTable, 'getChild');
    expect(
      traceDataset.chunks[0]?.spanSidecarTable?.getChild('incomingSameProcessDependencyRefs')
    ).toBeNull();

    expect(
      graph.getSpanDirectionalDependencyRefs(childSpanRef, 'incoming').sameProcessDependencyRefs
    ).toHaveLength(1);
    expect(getChildSpy).toHaveBeenCalledWith('endSpanRef');
    expect(getChildSpy).not.toHaveBeenCalledWith('dependencyRef');
    getChildSpy.mockRestore();
  });

  it('keeps canonical dependency traversal when stored chunk sidecars are absent', () => {
    const parentSpanId = 'rank-1-parent' as TraceSpanId;
    const childSpanId = 'rank-1-child' as TraceSpanId;
    const traceDataset = createTraceDatasetFromJSONTraceForTest(
      buildJSONTrace(
        [
          createProcess({
            processId: 'rank-1' as TraceProcessId,
            spans: [
              createSpan({spanId: parentSpanId, startTimeMs: 0, endTimeMs: 5}),
              createSpan({spanId: childSpanId, startTimeMs: 6, endTimeMs: 10})
            ],
            sameProcessDependencies: [
              createSameProcessDependency('dep-a', parentSpanId, childSpanId, 10)
            ]
          })
        ],
        []
      )
    );
    const graph = createRawTestTraceGraph({
      ...traceDataset,
      spanSidecarTableMap: undefined,
      chunks: traceDataset.chunks.map(chunk => ({
        ...chunk,
        spanSidecarTable: undefined
      }))
    });
    const childSpanRef = graph.getSpanRefById(childSpanId)!;
    const decodeRefSpy = vi.spyOn(graph, 'decodeRef').mockImplementation(() => {
      throw new Error('Unexpected same-process dependency ref decode');
    });

    expect(
      graph.getSpanDirectionalDependencyRefs(childSpanRef, 'incoming').sameProcessDependencyRefs
    ).toHaveLength(1);
    expect(decodeRefSpy).not.toHaveBeenCalled();
    decodeRefSpy.mockRestore();
  });
});

function createProcess(params: {
  /** Stable source process id. */
  processId: TraceProcessId;
  /** Process-local spans. */
  spans: TraceSpan[];
  /** Same-process dependencies owned by this process. */
  sameProcessDependencies: TraceSameProcessDependency[];
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
    sameProcessDependencies: params.sameProcessDependencies,
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
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}

function createSameProcessDependency(
  dependencyId: string,
  startSpanId: TraceSpanId,
  endSpanId: TraceSpanId,
  waitTimeMs: number
): TraceSameProcessDependency {
  return {
    type: 'trace-same-process-dependency',
    dependencyId: dependencyId as TraceDependencyId,
    startSpanId,
    endSpanId,
    keywords: new Set(['PARENT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs
  };
}
