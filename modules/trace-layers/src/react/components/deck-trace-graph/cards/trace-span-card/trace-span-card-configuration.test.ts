import {describe, expect, it, vi} from 'vitest';

import {
  buildJSONTrace,
  buildTraceGraphDataFromJSONTrace,
  DEFAULT_TRACE_STYLE,
  materializeJSONTrace,
  TraceGraph
} from '../../../../../trace/index';
import {createStaticTraceGraphRuntimeSource} from '../../../../../trace/trace-chunk-store';
import {getRequiredSpanRef} from '../../../../../trace/trace-graph/trace-graph-test-utils';
import {buildTraceSpanCardConfiguration} from './trace-span-card-configuration';

import type {
  JSONTrace,
  TraceDependencyId,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
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

describe('buildTraceSpanCardConfiguration', () => {
  it('derives tab availability in the configured tab order', () => {
    const {span, traceGraph} = createConfiguredTraceGraph();

    const configuration = buildTraceSpanCardConfiguration({
      traceGraph: createTestTraceGraph(buildTraceGraphDataFromJSONTrace(traceGraph), {}),
      spanRef: getRequiredSpanRef(
        createTestTraceGraph(buildTraceGraphDataFromJSONTrace(traceGraph), {}),
        span
      ),
      traceLabels: DEFAULT_TRACE_STYLE.labels,
      traceSettings: {timingAggregationKey: 'latest'} as TraceVisSettings,
      interactive: true,
      tabOptions: {
        dependencyLabel: 'Parents',
        showChildren: true,
        dependencyMetric: 'duration'
      }
    });

    expect(configuration.availableTabs).toEqual([
      'all',
      'dependencies',
      'children',
      'histogram',
      'timings',
      'span-data'
    ]);
    expect(configuration.tabAvailability['all']).toBe(true);
    expect(configuration.tabAvailability['dependencies']).toBe(true);
    expect(configuration.tabAvailability['children']).toBe(true);
    expect(configuration.tabAvailability['histogram']).toBe(true);
    expect(configuration.tabAvailability['timings']).toBe(true);
    expect(configuration.tabAvailability['span-data']).toBe(true);
    expect(configuration.activeTimingKey).toBe('latest');
    expect(configuration.highlightedTimingColumnIndex).toBe(
      configuration.spanTimings?.timingKeys.indexOf('latest')
    );
  });

  it('keeps data tabs visible when alwaysShowAll is enabled', () => {
    const {span, traceGraph} = createConfiguredTraceGraph();
    const traceGraphOptions = {
      ...DEFAULT_TRACE_STYLE.labels,
      processLabel: 'Process',
      spanLabel: 'Span'
    };

    const defaultOptionsConfiguration = buildTraceSpanCardConfiguration({
      traceGraph: createTestTraceGraph(buildTraceGraphDataFromJSONTrace(traceGraph), {}),
      spanRef: getRequiredSpanRef(
        createTestTraceGraph(buildTraceGraphDataFromJSONTrace(traceGraph), {}),
        span
      ),
      traceLabels: traceGraphOptions,
      traceSettings: {timingAggregationKey: 'latest'} as TraceVisSettings,
      interactive: true,
      tabOptions: {
        dependencyLabel: 'Parents',
        showChildren: false
      }
    });
    const alwaysShowAllConfiguration = buildTraceSpanCardConfiguration({
      traceGraph: createTestTraceGraph(buildTraceGraphDataFromJSONTrace(traceGraph), {}),
      spanRef: getRequiredSpanRef(
        createTestTraceGraph(buildTraceGraphDataFromJSONTrace(traceGraph), {}),
        span
      ),
      traceLabels: traceGraphOptions,
      traceSettings: {timingAggregationKey: 'latest'} as TraceVisSettings,
      interactive: true,
      tabOptions: {
        dependencyLabel: 'Parents',
        alwaysShowAll: true,
        showChildren: false
      }
    });

    expect(alwaysShowAllConfiguration.tabOptions.dependencyLabel).toBe('Parents');
    expect(alwaysShowAllConfiguration.tabOptions.alwaysShowAll).toBe(true);
    expect(defaultOptionsConfiguration.availableTabs).toEqual([
      'dependencies',
      'histogram',
      'timings',
      'span-data'
    ]);
    expect(alwaysShowAllConfiguration.availableTabs).toEqual([
      'dependencies',
      'histogram',
      'timings',
      'span-data'
    ]);
  });

  it('keeps empty data tabs visible when alwaysShowAll is enabled', () => {
    const traceGraphOptions = {
      ...DEFAULT_TRACE_STYLE.labels,
      processLabel: 'Process',
      spanLabel: 'Span'
    };
    const {span, traceGraph} = createLeafTraceGraph();
    const graph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(traceGraph), {});
    const configuration = buildTraceSpanCardConfiguration({
      traceGraph: graph,
      spanRef: getRequiredSpanRef(graph, span),
      traceLabels: traceGraphOptions,
      traceSettings: {} as TraceVisSettings,
      interactive: true,
      tabOptions: {
        dependencyLabel: 'Parents',
        alwaysShowAll: true,
        showChildren: false
      }
    });

    expect(configuration.histogramSpecs).toEqual([]);
    expect(configuration.spanTimings).toBeNull();
    expect(configuration.tabAvailability['histogram']).toBe(true);
    expect(configuration.tabAvailability['timings']).toBe(true);
    expect(configuration.tabAvailability['span-data']).toBe(true);
    expect(configuration.availableTabs).toEqual([
      'dependencies',
      'histogram',
      'timings',
      'span-data'
    ]);
  });

  it('prefers mean timings for aggregated duration summaries and duration-column defaults', () => {
    const {span, traceGraph: sourceTraceGraph} = createConfiguredTraceGraph();
    span.timings.envelope = createTiming(8, 52);
    span.timings.mean = createTiming(12, 17);
    span.timings.p50 = createTiming(13, 19);
    const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(sourceTraceGraph), {});

    const configuration = buildTraceSpanCardConfiguration({
      spanRef: getRequiredSpanRef(traceGraph, span),
      traceGraph,
      traceLabels: DEFAULT_TRACE_STYLE.labels,
      traceSettings: {} as TraceVisSettings,
      interactive: true
    });
    expect(configuration.aggregatedDurationSummary).toMatchObject({
      envelopeTiming: span.timings.envelope,
      representativeTiming: span.timings.mean,
      representativeTimingKey: 'mean'
    });
    expect(configuration.defaultDependencyDurationTimingKeys).toEqual(['envelope', 'mean']);
  });

  it('falls back to p50 for aggregated duration summaries when mean is unavailable', () => {
    const {span, traceGraph: sourceTraceGraph} = createConfiguredTraceGraph();
    span.timings.envelope = createTiming(8, 52);
    span.timings.p50 = createTiming(13, 19);
    const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(sourceTraceGraph), {});

    const configuration = buildTraceSpanCardConfiguration({
      spanRef: getRequiredSpanRef(traceGraph, span),
      traceGraph,
      traceLabels: DEFAULT_TRACE_STYLE.labels,
      traceSettings: {} as TraceVisSettings,
      interactive: true
    });

    expect(configuration.aggregatedDurationSummary).toMatchObject({
      envelopeTiming: span.timings.envelope,
      representativeTiming: span.timings.p50,
      representativeTimingKey: 'p50'
    });
    expect(configuration.defaultDependencyDurationTimingKeys).toEqual(['envelope', 'p50']);
  });

  it('leaves the aggregated representative duration empty when mean and p50 are unavailable', () => {
    const {span, traceGraph: sourceTraceGraph} = createConfiguredTraceGraph();
    span.timings.envelope = createTiming(8, 52);
    const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(sourceTraceGraph), {});

    const configuration = buildTraceSpanCardConfiguration({
      spanRef: getRequiredSpanRef(traceGraph, span),
      traceGraph,
      traceLabels: DEFAULT_TRACE_STYLE.labels,
      traceSettings: {} as TraceVisSettings,
      interactive: true
    });

    expect(configuration.aggregatedDurationSummary).toMatchObject({
      envelopeTiming: span.timings.envelope,
      representativeTiming: null,
      representativeTimingKey: null
    });
  });

  it('builds unfiltered dependency rows without graph-wide projection', () => {
    const {span, traceGraph: sourceTraceGraph} = createConfiguredTraceGraph();
    const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(sourceTraceGraph), {});
    const projectionSpy = vi.spyOn(traceGraph, 'getProjection');
    const sourceProjectionSpy = vi.spyOn(traceGraph, 'getSourceProjection');
    const dependencyChainSpy = vi.spyOn(traceGraph, 'getParentDependencyChainEntriesBySpanRef');
    const spanRef = getRequiredSpanRef(traceGraph, span);

    const configuration = buildTraceSpanCardConfiguration({
      spanRef,
      traceGraph,
      traceLabels: DEFAULT_TRACE_STYLE.labels,
      traceSettings: {} as TraceVisSettings,
      interactive: false
    });

    expect(configuration.inDependencies.map(entry => entry.dependency.dependencyId)).toEqual([
      'dep-parent'
    ]);
    expect(configuration.fullInDependencies.map(entry => entry.dependency.dependencyId)).toEqual([
      'dep-parent'
    ]);
    expect(projectionSpy).not.toHaveBeenCalled();
    expect(sourceProjectionSpy).not.toHaveBeenCalled();
    expect(dependencyChainSpy).toHaveBeenCalledWith(spanRef);
  });

  it('derives aggregated span labels and summary timing from aggregate metadata', () => {
    const {span, traceGraph} = createConfiguredTraceGraph();

    const configuration = buildTraceSpanCardConfiguration({
      traceGraph: createTestTraceGraph(buildTraceGraphDataFromJSONTrace(traceGraph), {}),
      spanRef: getRequiredSpanRef(
        createTestTraceGraph(buildTraceGraphDataFromJSONTrace(traceGraph), {}),
        span
      ),
      traceLabels: DEFAULT_TRACE_STYLE.labels,
      traceSettings: {timingAggregationKey: 'latest'} as TraceVisSettings,
      interactive: true
    });

    expect(configuration.isAggregatedSpan).toBe(true);
    expect(configuration.aggregateParticipantsLabel).toBe('(2 source spans)');
    expect(configuration.blockTiming.startTimeMs).toBe(span.timings.latest!.startTimeMs);
    expect(configuration.relativeStartTimeMs).toBe(
      span.timings.latest!.startTimeMs - materializeJSONTrace(traceGraph).minTimeMs
    );
  });

  it('keeps the dependencies tab available even when a span has no dependencies', () => {
    const {span, traceGraph: sourceTraceGraph} = createLeafTraceGraph();
    const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(sourceTraceGraph), {});

    const configuration = buildTraceSpanCardConfiguration({
      spanRef: getRequiredSpanRef(traceGraph, span),
      traceGraph,
      traceLabels: DEFAULT_TRACE_STYLE.labels,
      traceSettings: {} as TraceVisSettings,
      interactive: true
    });

    expect(configuration.hasDependencyTab).toBe(false);
    expect(configuration.tabAvailability['dependencies']).toBe(true);
    expect(configuration.availableTabs).toEqual(['dependencies', 'span-data']);
  });

  it('shows Arrow span table columns in the span data tab', () => {
    const {span, traceGraph: sourceTraceGraph} = createLeafTraceGraph();
    const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(sourceTraceGraph), {});

    const configuration = buildTraceSpanCardConfiguration({
      spanRef: getRequiredSpanRef(traceGraph, span),
      traceGraph,
      traceLabels: DEFAULT_TRACE_STYLE.labels,
      traceSettings: {} as TraceVisSettings,
      interactive: true
    });

    expect(configuration.tabAvailability['span-data']).toBe(true);
    expect(configuration.userDataRows).toContainEqual(['spanTable.span_id', 'leaf']);
    expect(configuration.userDataRows).toContainEqual(['spanTable.name', 'leaf']);
    expect(configuration.userDataRows).toContainEqual(['spanTable.duration_ms', '1']);
  });

  it('reads the span source from the Arrow span table', () => {
    const {span, traceGraph: sourceTraceGraph} = createLeafTraceGraph({
      userData: {source: 'worker-trace.json'}
    });
    const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(sourceTraceGraph), {});

    const configuration = buildTraceSpanCardConfiguration({
      spanRef: getRequiredSpanRef(traceGraph, span),
      traceGraph,
      traceLabels: DEFAULT_TRACE_STYLE.labels,
      traceSettings: {} as TraceVisSettings,
      interactive: true
    });

    expect(configuration.spanSource).toBe('worker-trace.json');
  });
});

function createConfiguredTraceGraph(): {
  span: TraceSpan;
  traceGraph: JSONTrace;
} {
  const processId = 'rank-1';
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId
  };
  const parentBlock = createBlock({
    spanId: 'parent',
    threadId: thread.threadId,
    processName: processId,
    name: 'parent',
    startTimeMs: 0,
    endTimeMs: 10
  });
  const currentBlock = createBlock({
    spanId: 'current',
    threadId: thread.threadId,
    processName: processId,
    name: 'current',
    startTimeMs: 10,
    endTimeMs: 30,
    userData: {
      parent: {
        span_id: '123'
      },
      aggregates: {
        participants: 2,
        variance: 9_004_586_556.25,
        duration_cv: 0.9539,
        duration_distribution_us: {
          lower_bound: 0,
          upper_bound: 213_347,
          buckets: [1, 0, 0, 0, 0, 0, 0, 0, 0, 1]
        },
        completion_distribution_us: {
          lower_bound: 10_000_000,
          upper_bound: 10_213_347,
          buckets: [1, 0, 0, 0, 0, 0, 0, 0, 0, 1]
        }
      }
    },
    timings: {
      default: {
        status: 'finished',
        startTimeMs: 10,
        endTimeMs: 30,
        durationMs: 20,
        durationMsAsString: '20ms'
      },
      latest: {
        status: 'finished',
        startTimeMs: 12,
        endTimeMs: 42,
        durationMs: 30,
        durationMsAsString: '30ms'
      }
    }
  });
  const childBlock = createBlock({
    spanId: 'child',
    threadId: thread.threadId,
    processName: processId,
    name: 'child',
    startTimeMs: 32,
    endTimeMs: 48
  });
  const parentDependency = createDependency({
    dependencyId: 'dep-parent',
    startSpanId: parentBlock.spanId,
    endSpanId: currentBlock.spanId,
    keywords: ['PARENT']
  });
  const childDependency = createDependency({
    dependencyId: 'dep-child',
    startSpanId: currentBlock.spanId,
    endSpanId: childBlock.spanId,
    keywords: ['SUBMIT']
  });

  currentBlock.localDependencyIds = [parentDependency.dependencyId];
  childBlock.localDependencyIds = [childDependency.dependencyId];

  const process: TraceProcess = {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [parentBlock, currentBlock, childBlock],
    spanMap: {
      [parentBlock.spanId]: parentBlock,
      [currentBlock.spanId]: currentBlock,
      [childBlock.spanId]: childBlock
    },
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: [parentDependency, childDependency],
    remoteDependencies: []
  };

  return {
    span: currentBlock,
    traceGraph: buildJSONTrace([process], [], {name: 'trace-span-card-configuration'})
  };
}

function createBlock(params: {
  spanId: string;
  threadId: TraceThreadId;
  processName: string;
  name: string;
  startTimeMs: number;
  endTimeMs: number;
  timings?: TraceSpan['timings'];
  userData?: Record<string, unknown>;
}): TraceSpan {
  return {
    type: 'trace-span',
    spanId: params.spanId as TraceSpanId,
    threadId: params.threadId,
    processName: params.processName,
    name: params.name,
    keywords: [],
    primaryTimingKey: 'default',
    timings: params.timings ?? {
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
    crossProcessDependencyEndpoints: [],
    userData: params.userData
  };
}

/** Build one finished timing fixture with a compact duration label. */
function createTiming(startTimeMs: number, endTimeMs: number): TraceSpan['timings'][string] {
  return {
    status: 'finished',
    startTimeMs,
    endTimeMs,
    durationMs: endTimeMs - startTimeMs,
    durationMsAsString: `${endTimeMs - startTimeMs}ms`
  };
}

function createDependency(params: {
  dependencyId: string;
  startSpanId: TraceSpanId;
  endSpanId: TraceSpanId;
  keywords: string[];
}): TraceLocalDependency {
  return {
    type: 'trace-local-dependency',
    dependencyId: params.dependencyId as TraceDependencyId,
    startSpanId: params.startSpanId,
    endSpanId: params.endSpanId,
    keywords: new Set(params.keywords),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 0
  };
}

function createLeafTraceGraph(params?: {userData?: Record<string, unknown>}): {
  span: TraceSpan;
  traceGraph: JSONTrace;
} {
  const processId = 'rank-1';
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId
  };
  const span = createBlock({
    spanId: 'leaf',
    threadId: thread.threadId,
    processName: processId,
    name: 'leaf',
    startTimeMs: 0,
    endTimeMs: 1,
    userData: params?.userData
  });
  const process: TraceProcess = {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: 0,
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

  return {
    span,
    traceGraph: buildJSONTrace([process], [], {name: 'trace-span-card-configuration-leaf'})
  };
}
