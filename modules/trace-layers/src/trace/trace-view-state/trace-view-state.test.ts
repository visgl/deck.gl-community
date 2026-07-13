import {describe, expect, it} from 'vitest';

import {buildJSONTrace} from '../ingestion/json-trace';
import {TraceGraph} from '../trace-graph/trace-graph';
import {createRuntimeTraceGraph} from '../trace-graph/trace-graph-test-fixtures';
import {DEFAULT_TRACE_COLOR_SCHEME} from '../trace-style/trace-color-scheme';
import {
  areTraceViewLayoutSettingsEqual,
  buildTraceViewRenderInputs,
  buildTraceViewState
} from './trace-view-state';

import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceDependencyId,
  TraceProcess,
  TraceSameProcessDependency,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {TraceLayout, TraceLayoutCollapseState} from '../trace-layout/trace-layout';

/** Materializes one prepared span source only at assertion boundaries. */
function getPreparedSpanRefs(source: Iterable<SpanRef> | undefined): SpanRef[] | undefined {
  return source ? Array.from(source) : undefined;
}

const defaultTraceVisSettings: TraceVisSettings = {
  showDependencies: true,
  sameProcessDependencyMode: 'all',
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
  traceTimingKey: 'latest',
  showEmptyProcesses: false
};

describe('TraceViewState', () => {
  it('compares direct layout settings without serialized keys', () => {
    expect(
      areTraceViewLayoutSettingsEqual(defaultTraceVisSettings, {
        ...defaultTraceVisSettings,
        selectedThreadNames: []
      })
    ).toBe(true);
    expect(
      areTraceViewLayoutSettingsEqual(defaultTraceVisSettings, {
        ...defaultTraceVisSettings,
        layoutDensity: 'compact'
      })
    ).toBe(false);
  });

  it('derives render inputs for trace view state construction', () => {
    const traceGraph = createDependencyTraceGraph();
    const parentSpanRef = traceGraph.getSpanRefById('parent' as TraceSpanId);
    const childSpanRef = traceGraph.getSpanRefById('child' as TraceSpanId);
    if (parentSpanRef == null || childSpanRef == null) {
      throw new Error('Expected parent and child span refs');
    }

    const inputs = buildTraceViewRenderInputs({
      traceGraph,
      selectedSpanRefs: [parentSpanRef],
      extendedSelectionSpanRefs: [childSpanRef],
      isExtendedSelection: false
    });

    expect(inputs.focusedSelectionSpanRefs).toEqual([parentSpanRef, childSpanRef]);
  });

  it('accepts caller-owned base layouts for focused selection', () => {
    const traceGraph = createDependencyTraceGraph();
    const first = buildTestTraceViewState(traceGraph);
    const parentSpanRef = traceGraph.getSpanRefById('parent' as TraceSpanId);

    if (parentSpanRef == null) {
      throw new Error('Expected parent span ref');
    }
    const focused = buildTestTraceViewState(traceGraph, {
      baseLayouts: first.baseLayouts,
      focusedSelectionSpanRefs: [parentSpanRef]
    });

    expect(focused.baseLayouts).toBe(first.baseLayouts);
    expect(focused.activeLayouts).not.toBe(focused.baseLayouts);
    expect(focused.renderSnapshot.foregroundScenes[0]?.rows.length).toBeGreaterThan(0);
  });

  it('restores prepared span geometry after focused selection clears', () => {
    const traceGraph = createDependencyTraceGraph();
    const parentSpanRef = traceGraph.getSpanRefById('parent' as TraceSpanId);
    const childSpanRef = traceGraph.getSpanRefById('child' as TraceSpanId);
    if (parentSpanRef == null || childSpanRef == null) {
      throw new Error('Expected parent and child span refs');
    }
    const expanded = buildTestTraceViewState(traceGraph);
    const focused = buildTestTraceViewState(traceGraph, {
      baseLayouts: expanded.baseLayouts,
      focusedSelectionSpanRefs: [parentSpanRef]
    });
    const restored = buildTestTraceViewState(traceGraph, {
      baseLayouts: expanded.baseLayouts
    });
    const focusedRow = focused.renderSnapshot.foregroundScenes[0]?.rows[0];
    const restoredRow = restored.renderSnapshot.foregroundScenes[0]?.rows[0];
    const childIndex = restoredRow
      ? Array.from(restoredRow.binaryBlockData?.spans ?? []).indexOf(childSpanRef)
      : -1;
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
    const selectedSpanRef = traceGraph.getSpanRefById('rank-a-parent' as TraceSpanId);
    if (selectedSpanRef == null) {
      throw new Error('Expected selected span ref');
    }
    const expanded = buildTestTraceViewState(traceGraph);
    const focused = buildTestTraceViewState(traceGraph, {
      baseLayouts: expanded.baseLayouts,
      focusedSelectionSpanRefs: [selectedSpanRef]
    });
    const restored = buildTestTraceViewState(traceGraph, {
      baseLayouts: expanded.baseLayouts
    });

    expect(focused.activeLayouts).not.toBe(focused.baseLayouts);
    for (const row of restored.renderSnapshot.foregroundScenes[0]?.rows ?? []) {
      const sizes = row.binaryBlockData?.data.attributes.getSize?.value as Float32Array | undefined;
      expect(row.binaryBlockData?.spans.length).toBeGreaterThan(0);
      expect(row).not.toHaveProperty('spans');
      expect(Array.from(sizes ?? []).some(size => size > 0)).toBe(true);
    }
  });

  it('builds fresh base layouts when the caller does not supply owned layouts', () => {
    const traceGraph = createDependencyTraceGraph();
    const first = buildTestTraceViewState(traceGraph);
    const second = buildTestTraceViewState(traceGraph);

    expect(second.baseLayouts).not.toBe(first.baseLayouts);
    expect(second.activeLayouts).toBe(second.baseLayouts);
    expect(second.renderSnapshot.derivedDataByGraph).toHaveLength(second.activeLayouts.length);
  });

  it('rebuilds base layouts when current trace graph identity changes', () => {
    const trace = buildJSONTrace([createProcessWithSameProcessDependency('rank-a', 0)], [], {
      name: 'trace-view-state-graph-replacement-test'
    });
    const firstTraceGraph = createRuntimeTraceGraph(trace);
    const secondTraceGraph = createRuntimeTraceGraph(trace);
    const first = buildTestTraceViewState(firstTraceGraph);
    const second = buildTestTraceViewState(secondTraceGraph);

    expect(second.baseLayouts).not.toBe(first.baseLayouts);
    expect(second.baseLayouts[0]?.traceGraph).toBe(secondTraceGraph);
    expect(second.activeLayouts).toBe(second.baseLayouts);
  });

  it('reprojects row span refs while rebuilding binary rows for a new graph snapshot', () => {
    const trace = buildJSONTrace([createProcessWithSameProcessDependency('rank-a', 0)], [], {
      name: 'trace-view-state-prepared-row-replacement-test'
    });
    const firstTraceGraph = createRuntimeTraceGraph(trace);
    const secondTraceGraph = createRuntimeTraceGraph(trace);
    const first = buildTestTraceViewState(firstTraceGraph);
    const second = buildTestTraceViewState(secondTraceGraph);
    const firstRow = first.renderSnapshot.foregroundScenes[0]?.rows[0];
    const secondRow = second.renderSnapshot.foregroundScenes[0]?.rows[0];

    expect(second.renderSnapshot.foregroundScenes[0]?.layout.traceGraph).toBe(secondTraceGraph);
    expect(getPreparedSpanRefs(secondRow?.binaryBlockData?.spans)).toEqual(
      getPreparedSpanRefs(firstRow?.binaryBlockData?.spans)
    );
    expect(secondRow?.binaryBlockData).not.toBe(firstRow?.binaryBlockData);
    expect(secondRow).not.toHaveProperty('spans');
  });

  it('keeps filtered row span refs stable across process collapse toggles', () => {
    const traceGraph = createRuntimeTraceGraph(
      buildJSONTrace([createProcessWithSameProcessDependency('rank-a', 0)], [], {
        name: 'trace-view-state-filter-collapse-test'
      }),
      {spanFilters: ['parent']}
    );
    const processRef = traceGraph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected process ref');
    }
    const expanded = buildTestTraceViewState(traceGraph);
    const collapsed = buildTestTraceViewState(traceGraph, {
      collapseState: {
        graphs: [
          {
            collapsedProcessRefs: new Set([processRef]),
            collapsedThreadRefs: new Set(),
            expandedThreadRefs: new Set()
          }
        ]
      }
    });
    const expandedAgain = buildTestTraceViewState(traceGraph);

    const expandedSpans =
      expanded.renderSnapshot.foregroundScenes[0]?.rows[0]?.binaryBlockData?.spans;
    const collapsedSpans =
      collapsed.renderSnapshot.foregroundScenes[0]?.rows[0]?.binaryBlockData?.spans;
    const expandedAgainSpans =
      expandedAgain.renderSnapshot.foregroundScenes[0]?.rows[0]?.binaryBlockData?.spans;

    expect(getPreparedSpanRefs(collapsedSpans)).toEqual(getPreparedSpanRefs(expandedSpans));
    expect(getPreparedSpanRefs(expandedAgainSpans)).toEqual(getPreparedSpanRefs(expandedSpans));
  });
});

/** Builds TraceViewState with the shared test fixture settings. */
function buildTestTraceViewState(
  traceGraph: TraceGraph,
  options: {
    /** Exact base layouts explicitly owned by the test caller. */
    readonly baseLayouts?: readonly TraceLayout[];
    /** Ref-native collapse state aligned with the test graph. */
    readonly collapseState?: TraceLayoutCollapseState;
    /** Visualization settings used by the test view state. */
    readonly settings?: TraceVisSettings;
    /** Span refs that should drive focused layouts. */
    readonly focusedSelectionSpanRefs?: readonly SpanRef[];
  } = {}
) {
  const collapseState = options.collapseState ?? createEmptyCollapseState();
  const settings = options.settings ?? defaultTraceVisSettings;
  return buildTraceViewState({
    baseLayouts: options.baseLayouts,
    traceGraphs: [traceGraph],
    sourceTraceGraphs: [traceGraph],
    primaryTraceGraph: traceGraph,
    paths: [],
    settings,
    colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
    collapseState,
    threadLaneLayoutOverrides: {},
    layoutTopPadding: 0,
    layoutTimingKey: 'primary',
    minTimeMs: traceGraph.minTimeMs,
    buildMinimapLayouts: true,
    focusedSelectionSpanRefs: options.focusedSelectionSpanRefs ?? [],
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

/** Creates a one-process trace graph with a parent-to-child same-process dependency. */
function createDependencyTraceGraph(): TraceGraph {
  return createRuntimeTraceGraph(
    buildJSONTrace([createProcessWithSameProcessDependency('rank-a', 0)], [], {
      name: 'trace-view-state-test'
    })
  );
}

/** Creates a two-process trace graph whose process-local thread ids intentionally repeat. */
function createRepeatedThreadTraceGraph(): TraceGraph {
  const sharedThreadId = 'shared-thread' as TraceThreadId;
  return createRuntimeTraceGraph(
    buildJSONTrace(
      [
        retargetProcessThreadId(
          createProcessWithSameProcessDependency('rank-a', 0),
          sharedThreadId
        ),
        retargetProcessThreadId(createProcessWithSameProcessDependency('rank-b', 1), sharedThreadId)
      ],
      [],
      {name: 'trace-view-state-repeated-thread-test'}
    )
  );
}

/** Creates a process fixture with two spans linked by one same-process dependency. */
function createProcessWithSameProcessDependency(processId: string, rankNum: number): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-thread`,
    threadId: `${processId}-thread` as TraceThreadId,
    processId
  };
  const parentSpan = createSpan('parent', thread);
  const childSpan = createSpan('child', thread);
  const dependencyId = 'dep-parent-child' as TraceDependencyId;
  const dependency: TraceSameProcessDependency = {
    type: 'trace-same-process-dependency',
    dependencyId,
    startSpanId: parentSpan.spanId,
    endSpanId: childSpan.spanId,
    keywords: new Set(['SUBMIT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 1_000
  };
  parentSpan.sameProcessDependencyIds = [dependencyId];
  parentSpan.sameProcessDependencies = [dependency];

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
    sameProcessDependencies: [dependency],
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
  const dependencies = process.sameProcessDependencies.map(dependency => ({
    ...dependency,
    dependencyId: `${process.processId}-${dependency.dependencyId}` as TraceDependencyId,
    startSpanId: spanIdBySourceId.get(dependency.startSpanId) ?? dependency.startSpanId,
    endSpanId: spanIdBySourceId.get(dependency.endSpanId) ?? dependency.endSpanId
  })) satisfies TraceSameProcessDependency[];
  const dependencyBySourceId = new Map(
    process.sameProcessDependencies.map((dependency, index) => [
      dependency.dependencyId,
      dependencies[index]!
    ])
  );
  const spans = process.spans.map(span => ({
    ...span,
    spanId: spanIdBySourceId.get(span.spanId) ?? span.spanId,
    threadId,
    name: `${process.processId}-${span.name}`,
    sameProcessDependencyIds: span.sameProcessDependencyIds.map(
      dependencyId => dependencyBySourceId.get(dependencyId)?.dependencyId ?? dependencyId
    ),
    sameProcessDependencies: span.sameProcessDependencies.map(
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
    sameProcessDependencies: dependencies
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
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}
