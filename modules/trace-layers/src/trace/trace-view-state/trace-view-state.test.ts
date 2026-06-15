import {describe, expect, it} from 'vitest';

import {buildTraceGraphDataFromJSONTrace} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {TraceGraph} from '../trace-graph/trace-graph';
import {DEFAULT_TRACE_COLOR_SCHEME} from '../trace-style/trace-color-scheme';
import {
  buildTraceViewBaseLayoutKey,
  buildTraceViewRenderInputs,
  buildTraceViewState
} from './trace-view-state';

import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceDependencyId,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {TraceLayoutCollapseState} from '../trace-layout/trace-layout';

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

const defaultTraceVisSettings: TraceVisSettings = {
  showDependencies: true,
  localDependencyMode: 'all',
  showCrossProcessDependencies: true,
  showInstants: false,
  showCounters: false,
  showGlobalEvents: false,
  transitions: false,
  showPathsOnly: false,
  showOverview: true,
  dependencyDisplayMode: 'all',
  dependencyKeywords: [],
  dependencyOpacity: 0.1,
  minSpanTimeMs: 0,
  threadDisplayMode: 'all',
  selectedThreadNames: [],
  sortThreads: false,
  lineRoutingMode: 'straight',
  layoutDensity: 'comfortable',
  processLayoutMode: 'interleaved',
  trackAggregationMode: 'separate-threads',
  traceOffsetMs: 0,
  traceScale: 1,
  traceColorSchemeId: 'processes',
  traceRunSummaryAggregationKey: 'latest',
  showEmptyProcesses: false
};

describe('TraceViewState', () => {
  it('builds a stable base layout key for layout-affecting inputs', () => {
    const traceGraph = createDependencyTraceGraph();
    const collapseState = createEmptyCollapseState();
    const firstKey = buildTraceViewBaseLayoutKey({
      traceGraphs: [traceGraph],
      traceLayoutSettings: defaultTraceVisSettings,
      collapseStateForLayout: collapseState,
      layoutTopPadding: 0,
      layoutTimingKey: 'primary',
      minTimeMs: traceGraph.minTimeMs,
      shouldPrepareOverviewData: true,
      initialViewportFitKey: 'viewport-a'
    });
    const secondKey = buildTraceViewBaseLayoutKey({
      traceGraphs: [traceGraph],
      traceLayoutSettings: defaultTraceVisSettings,
      collapseStateForLayout: collapseState,
      layoutTopPadding: 0,
      layoutTimingKey: 'primary',
      minTimeMs: traceGraph.minTimeMs,
      shouldPrepareOverviewData: true,
      initialViewportFitKey: 'viewport-a'
    });
    const processRef = traceGraph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected process ref');
    }
    const collapsedState: TraceLayoutCollapseState = {
      graphs: [
        {
          collapsedProcessRefs: new Set([processRef]),
          collapsedThreadRefs: collapseState.graphs[0]!.collapsedThreadRefs,
          expandedThreadRefs: collapseState.graphs[0]!.expandedThreadRefs
        }
      ]
    };
    const collapsedKey = buildTraceViewBaseLayoutKey({
      traceGraphs: [traceGraph],
      traceLayoutSettings: defaultTraceVisSettings,
      collapseStateForLayout: collapsedState,
      layoutTopPadding: 0,
      layoutTimingKey: 'primary',
      minTimeMs: traceGraph.minTimeMs,
      shouldPrepareOverviewData: true,
      initialViewportFitKey: 'viewport-a'
    });

    expect(secondKey).toBe(firstKey);
    expect(collapsedKey).not.toBe(firstKey);
  });

  it('changes the base layout key when graph-owned filters change', () => {
    const traceGraphData = buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([createProcessWithLocalDependency('rank-a', 0)], [], {
        name: 'trace-view-state-filter-key-test'
      })
    );
    const unfilteredTraceGraph = createTestTraceGraph(traceGraphData);
    const filteredTraceGraph = createTestTraceGraph(traceGraphData, {
      overlappingParentSpanFilter: {maxChildDurationMs: 1}
    });
    const collapseState = createEmptyCollapseState();
    const unfilteredKey = buildTraceViewBaseLayoutKey({
      traceGraphs: [unfilteredTraceGraph],
      traceLayoutSettings: defaultTraceVisSettings,
      collapseStateForLayout: collapseState,
      layoutTopPadding: 0,
      layoutTimingKey: 'primary',
      minTimeMs: unfilteredTraceGraph.minTimeMs,
      shouldPrepareOverviewData: true,
      initialViewportFitKey: 'viewport-a'
    });
    const filteredKey = buildTraceViewBaseLayoutKey({
      traceGraphs: [filteredTraceGraph],
      traceLayoutSettings: defaultTraceVisSettings,
      collapseStateForLayout: collapseState,
      layoutTopPadding: 0,
      layoutTimingKey: 'primary',
      minTimeMs: filteredTraceGraph.minTimeMs,
      shouldPrepareOverviewData: true,
      initialViewportFitKey: 'viewport-a'
    });

    expect(filteredKey).not.toBe(unfilteredKey);
  });

  it('changes the base layout key when store-owned source filters change', () => {
    const traceGraphData = buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([createProcessWithLocalDependency('rank-a', 0)], [], {
        name: 'trace-view-state-store-filter-key-test'
      })
    );
    const runtimeSource = createStaticTraceGraphRuntimeSource({
      identityKey: 'trace-view-state-store-filter-key-test',
      traceGraphData
    });
    const traceGraph = new TraceGraph(runtimeSource);
    const traceStore = runtimeSource.traceStore as typeof runtimeSource.traceStore & {
      setSourceSpanFilters: (spanFilters: readonly string[] | undefined) => boolean;
    };
    const collapseState = createEmptyCollapseState();
    const firstKey = buildTraceViewBaseLayoutKey({
      traceGraphs: [traceGraph],
      traceLayoutSettings: defaultTraceVisSettings,
      collapseStateForLayout: collapseState,
      layoutTopPadding: 0,
      layoutTimingKey: 'primary',
      minTimeMs: traceGraph.minTimeMs,
      shouldPrepareOverviewData: true,
      initialViewportFitKey: 'viewport-a'
    });

    expect(traceStore.setSourceSpanFilters(['projects/runtime/runtime-crates'])).toBe(true);
    const secondKey = buildTraceViewBaseLayoutKey({
      traceGraphs: [traceGraph],
      traceLayoutSettings: defaultTraceVisSettings,
      collapseStateForLayout: collapseState,
      layoutTopPadding: 0,
      layoutTimingKey: 'primary',
      minTimeMs: traceGraph.minTimeMs,
      shouldPrepareOverviewData: true,
      initialViewportFitKey: 'viewport-a'
    });

    expect(secondKey).not.toBe(firstKey);
  });

  it('derives render inputs for trace view state construction', () => {
    const traceGraph = createDependencyTraceGraph();
    const collapseState = createEmptyCollapseState();
    const parentSpanRef = traceGraph.getSpanRefByExternalBlockId('parent' as TraceSpanId);
    const childSpanRef = traceGraph.getSpanRefByExternalBlockId('child' as TraceSpanId);
    if (parentSpanRef == null || childSpanRef == null) {
      throw new Error('Expected parent and child span refs');
    }

    const inputs = buildTraceViewRenderInputs({
      traceGraph,
      traceGraphs: [traceGraph],
      settings: {
        ...defaultTraceVisSettings,
        showGlobalEvents: true,
        selectedThreadNames: ['worker']
      },
      collapseStateForLayout: collapseState,
      layoutTopPadding: 4,
      layoutTimingKey: 'primary',
      minTimeMs: traceGraph.minTimeMs,
      shouldPrepareOverviewData: true,
      initialViewportFitKey: 'viewport-a',
      selectedSpanRefs: [parentSpanRef],
      extendedSelectionSpanRefs: [childSpanRef],
      isExtendedSelection: false
    });

    expect(inputs.focusedSelectionSpanRefs).toEqual([parentSpanRef, childSpanRef]);
    expect(inputs.traceLayoutSettings).toMatchObject({
      showGlobalEvents: true,
      selectedThreadNames: ['worker'],
      processLayoutMode: defaultTraceVisSettings.processLayoutMode
    });
    expect(inputs.traceViewBaseLayoutKey).toBe(
      buildTraceViewBaseLayoutKey({
        traceGraphs: [traceGraph],
        traceLayoutSettings: inputs.traceLayoutSettings,
        collapseStateForLayout: collapseState,
        layoutTopPadding: 4,
        layoutTimingKey: 'primary',
        minTimeMs: traceGraph.minTimeMs,
        shouldPrepareOverviewData: true,
        initialViewportFitKey: 'viewport-a'
      })
    );
  });

  it('reuses base layouts when only focused selection changes', () => {
    const traceGraph = createDependencyTraceGraph();
    const collapseState = createEmptyCollapseState();
    const first = buildTraceViewState({
      previousState: null,
      baseLayoutKey: 'base',
      traceGraphs: [traceGraph],
      sourceTraceGraphs: [traceGraph],
      primaryTraceGraph: traceGraph,
      paths: [],
      layoutSettings: defaultTraceVisSettings,
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      collapseState,
      threadLaneLayoutOverrides: {},
      layoutTopPadding: 0,
      layoutTimingKey: 'primary',
      minTimeMs: traceGraph.minTimeMs,
      buildMinimapLayouts: true,
      focusedSelectionSpanRefs: [],
      showCollapsedActivitySummary: false,
      isOverviewEnabled: true,
      getTraceModelMatrixForGraph: () => undefined
    });
    const parentSpanRef = traceGraph.getSpanRefByExternalBlockId('parent' as TraceSpanId);

    if (parentSpanRef == null) {
      throw new Error('Expected parent span ref');
    }
    const focused = buildTraceViewState({
      previousState: first,
      baseLayoutKey: 'base',
      traceGraphs: [traceGraph],
      sourceTraceGraphs: [traceGraph],
      primaryTraceGraph: traceGraph,
      paths: [],
      layoutSettings: defaultTraceVisSettings,
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      collapseState,
      threadLaneLayoutOverrides: {},
      layoutTopPadding: 0,
      layoutTimingKey: 'primary',
      minTimeMs: traceGraph.minTimeMs,
      buildMinimapLayouts: true,
      focusedSelectionSpanRefs: [parentSpanRef],
      showCollapsedActivitySummary: false,
      isOverviewEnabled: true,
      getTraceModelMatrixForGraph: () => undefined
    });

    expect(focused.baseLayouts).toBe(first.baseLayouts);
    expect(focused.focusedLayouts).not.toBeNull();
    expect(focused.activeLayouts).toBe(focused.focusedLayouts);
    expect(focused.preparedScene.foreground[0]?.rows.length).toBeGreaterThan(0);
  });

  it('restores prepared span geometry after focused selection clears', () => {
    const traceGraph = createDependencyTraceGraph();
    const parentSpanRef = traceGraph.getSpanRefByExternalBlockId('parent' as TraceSpanId);
    const childSpanRef = traceGraph.getSpanRefByExternalBlockId('child' as TraceSpanId);
    if (parentSpanRef == null || childSpanRef == null) {
      throw new Error('Expected parent and child span refs');
    }
    const expanded = buildTestTraceViewState(traceGraph, 'expanded');
    const focused = buildTestTraceViewState(
      traceGraph,
      'expanded',
      expanded,
      createEmptyCollapseState(),
      defaultTraceVisSettings,
      [parentSpanRef]
    );
    const restored = buildTestTraceViewState(traceGraph, 'expanded', focused);
    const focusedRow = focused.preparedScene.foreground[0]?.rows[0];
    const restoredRow = restored.preparedScene.foreground[0]?.rows[0];
    const childIndex = restoredRow?.spans.indexOf(childSpanRef) ?? -1;
    const focusedSizes = focusedRow?.binaryBlockData?.data.attributes.getSize?.value as
      | Float32Array
      | undefined;
    const restoredSizes = restoredRow?.binaryBlockData?.data.attributes.getSize?.value as
      | Float32Array
      | undefined;

    expect(focusedSizes?.[childIndex * 2]).toBe(0);
    expect(restoredSizes?.[childIndex * 2]).toBeGreaterThan(0);
    expect(restoredRow?.binaryBlockData).not.toBe(focusedRow?.binaryBlockData);
  });

  it('keeps prepared expanded row span payloads after focus clears with repeated thread ids', () => {
    const traceGraph = createRepeatedThreadTraceGraph();
    const selectedSpanRef = traceGraph.getSpanRefByExternalBlockId('rank-a-parent' as TraceSpanId);
    if (selectedSpanRef == null) {
      throw new Error('Expected selected span ref');
    }
    const expanded = buildTestTraceViewState(traceGraph, 'repeated-expanded');
    const focused = buildTestTraceViewState(
      traceGraph,
      'repeated-expanded',
      expanded,
      createEmptyCollapseState(),
      defaultTraceVisSettings,
      [selectedSpanRef]
    );
    const restored = buildTestTraceViewState(traceGraph, 'repeated-expanded', focused);

    for (const row of restored.preparedScene.foreground[0]?.rows ?? []) {
      const sizes = row.binaryBlockData?.data.attributes.getSize?.value as Float32Array | undefined;
      expect(row.binaryBlockData?.spans).toBe(row.spans);
      expect(row.spans.length).toBeGreaterThan(0);
      expect(Array.from(sizes ?? []).some(size => size > 0)).toBe(true);
    }
  });

  it('rebuilds base layouts when the base layout key changes', () => {
    const traceGraph = createDependencyTraceGraph();
    const first = buildTestTraceViewState(traceGraph, 'base-a');
    const second = buildTestTraceViewState(traceGraph, 'base-b', first);

    expect(second.baseLayouts).not.toBe(first.baseLayouts);
    expect(second.focusedLayouts).toBeNull();
    expect(second.activeLayouts).toBe(second.baseLayouts);
  });

  it('rebuilds base layouts when current trace graph identity changes', () => {
    const traceGraphData = buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([createProcessWithLocalDependency('rank-a', 0)], [], {
        name: 'trace-view-state-graph-replacement-test'
      })
    );
    const firstTraceGraph = createTestTraceGraph(traceGraphData);
    const secondTraceGraph = createTestTraceGraph(traceGraphData);
    const first = buildTestTraceViewState(firstTraceGraph, 'base');
    const second = buildTestTraceViewState(secondTraceGraph, 'base', first);

    expect(second.baseLayouts).not.toBe(first.baseLayouts);
    expect(second.baseLayouts[0]?.traceGraph).toBe(secondTraceGraph);
    expect(second.activeLayouts).toBe(second.baseLayouts);
  });

  it('rebuilds prepared row spans when current trace graph identity changes', () => {
    const traceGraphData = buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([createProcessWithLocalDependency('rank-a', 0)], [], {
        name: 'trace-view-state-prepared-row-replacement-test'
      })
    );
    const firstTraceGraph = createTestTraceGraph(traceGraphData);
    const secondTraceGraph = createTestTraceGraph(traceGraphData);
    const first = buildTestTraceViewState(firstTraceGraph, 'base');
    const second = buildTestTraceViewState(secondTraceGraph, 'base', first);
    const firstRow = first.preparedScene.foreground[0]?.rows[0];
    const secondRow = second.preparedScene.foreground[0]?.rows[0];

    expect(second.preparedScene.foreground[0]?.graph).toBe(secondTraceGraph);
    expect(secondRow?.spans).not.toBe(firstRow?.spans);
    expect(secondRow?.binaryBlockData).not.toBe(firstRow?.binaryBlockData);
    expect(secondRow?.binaryBlockData?.spans).toBe(secondRow?.spans);
  });

  it('keeps filtered row span refs stable across process collapse toggles', () => {
    const traceGraph = createTestTraceGraph(
      buildTraceGraphDataFromJSONTrace(
        buildJSONTrace([createProcessWithLocalDependency('rank-a', 0)], [], {
          name: 'trace-view-state-filter-collapse-test'
        })
      ),
      {spanFilters: ['parent']}
    );
    const processRef = traceGraph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected process ref');
    }
    const expanded = buildTestTraceViewState(traceGraph, 'filtered-expanded');
    const collapsed = buildTestTraceViewState(traceGraph, 'filtered-collapsed', expanded, {
      graphs: [
        {
          collapsedProcessRefs: new Set([processRef]),
          collapsedThreadRefs: new Set(),
          expandedThreadRefs: new Set()
        }
      ]
    });
    const expandedAgain = buildTestTraceViewState(traceGraph, 'filtered-expanded-again', collapsed);

    const expandedSpans = expanded.preparedScene.foreground[0]?.rows[0]?.spans;
    const collapsedSpans = collapsed.preparedScene.foreground[0]?.rows[0]?.spans;
    const expandedAgainSpans = expandedAgain.preparedScene.foreground[0]?.rows[0]?.spans;

    expect(collapsedSpans).toBe(expandedSpans);
    expect(expandedAgainSpans).toBe(expandedSpans);
  });

  it('increments thread prune revisions only when visible thread refs change', () => {
    const traceGraph = createDependencyTraceGraph();
    const threadRef = traceGraph.getThreadRefs()[0];
    if (threadRef == null) {
      throw new Error('Expected thread ref');
    }
    const collapseWithThreadOverride: TraceLayoutCollapseState = {
      graphs: [
        {
          collapsedProcessRefs: new Set(),
          collapsedThreadRefs: new Set([threadRef]),
          expandedThreadRefs: new Set()
        }
      ]
    };
    const first = buildTestTraceViewState(
      traceGraph,
      'thread-prune-a',
      null,
      collapseWithThreadOverride
    );
    const second = buildTestTraceViewState(
      traceGraph,
      'thread-prune-a',
      first,
      collapseWithThreadOverride
    );
    const third = buildTestTraceViewState(
      traceGraph,
      'thread-prune-b',
      second,
      collapseWithThreadOverride,
      {
        ...defaultTraceVisSettings,
        threadDisplayMode: 'selected',
        selectedThreadNames: ['not-present']
      }
    );
    const withoutThreadOverrides = buildTestTraceViewState(
      traceGraph,
      'thread-prune-c',
      third,
      createEmptyCollapseState()
    );

    expect(first.threadCollapsePruneRequest?.revision).toBe(1);
    expect(second.threadCollapsePruneRequest).toBe(first.threadCollapsePruneRequest);
    expect(third.threadCollapsePruneRequest?.revision).toBe(2);
    expect(third.threadCollapsePruneRequest?.validThreadRefsByGraph[0]?.has(threadRef)).toBe(false);
    expect(withoutThreadOverrides.threadCollapsePruneRequest).toBeNull();
  });
});

/** Builds TraceViewState with the shared test fixture settings. */
function buildTestTraceViewState(
  traceGraph: TraceGraph,
  baseLayoutKey: string,
  previousState: Parameters<typeof buildTraceViewState>[0]['previousState'] = null,
  collapseState: TraceLayoutCollapseState = createEmptyCollapseState(),
  settings: TraceVisSettings = defaultTraceVisSettings,
  focusedSelectionSpanRefs: readonly SpanRef[] = []
) {
  return buildTraceViewState({
    previousState,
    baseLayoutKey,
    traceGraphs: [traceGraph],
    sourceTraceGraphs: [traceGraph],
    primaryTraceGraph: traceGraph,
    paths: [],
    layoutSettings: settings,
    settings,
    colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
    collapseState,
    threadLaneLayoutOverrides: {},
    layoutTopPadding: 0,
    layoutTimingKey: 'primary',
    minTimeMs: traceGraph.minTimeMs,
    buildMinimapLayouts: true,
    focusedSelectionSpanRefs,
    showCollapsedActivitySummary: false,
    isOverviewEnabled: true,
    getTraceModelMatrixForGraph: () => undefined
  });
}

/** Creates an empty single-graph collapse state for TraceViewState tests. */
function createEmptyCollapseState(): TraceLayoutCollapseState {
  return {
    graphs: [
      {
        collapsedProcessRefs: new Set(),
        collapsedThreadRefs: new Set(),
        expandedThreadRefs: new Set()
      }
    ]
  };
}

/** Creates a one-process trace graph with a parent-to-child local dependency. */
function createDependencyTraceGraph(): TraceGraph {
  return createTestTraceGraph(
    buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([createProcessWithLocalDependency('rank-a', 0)], [], {
        name: 'trace-view-state-test'
      })
    )
  );
}

/** Creates a two-process trace graph whose process-local thread ids intentionally repeat. */
function createRepeatedThreadTraceGraph(): TraceGraph {
  const sharedThreadId = 'shared-thread' as TraceThreadId;
  return createTestTraceGraph(
    buildTraceGraphDataFromJSONTrace(
      buildJSONTrace(
        [
          retargetProcessThreadId(createProcessWithLocalDependency('rank-a', 0), sharedThreadId),
          retargetProcessThreadId(createProcessWithLocalDependency('rank-b', 1), sharedThreadId)
        ],
        [],
        {name: 'trace-view-state-repeated-thread-test'}
      )
    )
  );
}

/** Creates a process fixture with two spans linked by one local dependency. */
function createProcessWithLocalDependency(processId: string, rankNum: number): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-thread`,
    threadId: `${processId}-thread` as TraceThreadId,
    processId
  };
  const parentSpan = createSpan('parent', thread);
  const childSpan = createSpan('child', thread);
  const dependencyId = 'dep-parent-child' as TraceDependencyId;
  const dependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId,
    startSpanId: parentSpan.spanId,
    endSpanId: childSpan.spanId,
    keywords: new Set(['SUBMIT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 1_000
  };
  parentSpan.localDependencyIds = [dependencyId];
  parentSpan.localDependencies = [dependency];

  return {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [parentSpan, childSpan],
    spanMap: {
      [parentSpan.spanId]: parentSpan,
      [childSpan.spanId]: childSpan
    },
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: [dependency],
    remoteDependencies: []
  };
}

/** Rewrites one single-thread process fixture to use a shared process-local thread id. */
function retargetProcessThreadId(process: TraceProcess, threadId: TraceThreadId): TraceProcess {
  const sourceThread = process.threads[0]!;
  const thread = {...sourceThread, threadId} satisfies TraceThread;
  const spanIdBySourceId = new Map(
    process.spans.map(span => [span.spanId, `${process.processId}-${span.spanId}` as TraceSpanId])
  );
  const dependencies = process.localDependencies.map(dependency => ({
    ...dependency,
    dependencyId: `${process.processId}-${dependency.dependencyId}` as TraceDependencyId,
    startSpanId: spanIdBySourceId.get(dependency.startSpanId) ?? dependency.startSpanId,
    endSpanId: spanIdBySourceId.get(dependency.endSpanId) ?? dependency.endSpanId
  })) satisfies TraceLocalDependency[];
  const dependencyBySourceId = new Map(
    process.localDependencies.map((dependency, index) => [
      dependency.dependencyId,
      dependencies[index]!
    ])
  );
  const spans = process.spans.map(span => ({
    ...span,
    spanId: spanIdBySourceId.get(span.spanId) ?? span.spanId,
    threadId,
    name: `${process.processId}-${span.name}`,
    localDependencyIds: span.localDependencyIds.map(
      dependencyId => dependencyBySourceId.get(dependencyId)?.dependencyId ?? dependencyId
    ),
    localDependencies: span.localDependencies.map(
      dependency => dependencyBySourceId.get(dependency.dependencyId) ?? dependency
    )
  })) satisfies TraceSpan[];
  return {
    ...process,
    threads: [thread],
    threadMap: {[threadId]: thread},
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])) as Record<
      string,
      TraceSpan
    >,
    localDependencies: dependencies
  } satisfies TraceProcess;
}

/** Creates a finished span fixture for TraceViewState tests. */
function createSpan(name: string, thread: TraceThread): TraceSpan {
  const startTimeMs = name === 'parent' ? 0 : 1;
  const endTimeMs = name === 'parent' ? 10 : 9;
  return {
    type: 'trace-span',
    spanId: name as TraceSpanId,
    threadId: thread.threadId,
    processName: thread.processId,
    name,
    keywords: [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs,
        endTimeMs,
        durationMs: endTimeMs - startTimeMs,
        durationMsAsString: `${endTimeMs - startTimeMs}ms`
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}
