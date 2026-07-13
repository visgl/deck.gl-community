import {describe, expect, it, vi} from 'vitest';

import {buildTraceProcessSpanRefTables} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {TraceGraph} from '../trace-graph/trace-graph';
import {
  createDatasetRuntimeTraceGraphForTest,
  createRuntimeTraceGraph,
  createTraceDatasetFromJSONTraceForTest
} from '../trace-graph/trace-graph-test-fixtures';
import {hasTraceLayoutSpanLaneIndex} from '../trace-layout/trace-layout';
import {DEFAULT_TRACE_STYLE} from '../trace-style/trace-style';
import {TraceEngine} from './trace-engine';

import type {TraceDataset} from '../trace-dataset';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceCounter,
  TraceCounterId,
  TraceDependencyId,
  TraceEventId,
  TraceInstant,
  TraceInstantId,
  TracePath,
  TraceProcess,
  TraceSameProcessDependency,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';

const EMPTY_TRACE_PATHS: TracePath[] = [];

/** Materializes one prepared span source only at assertion boundaries. */
function getPreparedSpanRefs(source: Iterable<SpanRef> | undefined): SpanRef[] | undefined {
  return source ? Array.from(source) : undefined;
}

/** Returns the explicit render owners retained by the current immutable engine snapshot. */
function getPreparedRenderState(engine: TraceEngine) {
  return engine.getSnapshot().traceViewState.renderSnapshot;
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

describe('TraceEngine', () => {
  it('syncs immutable graph snapshots and keeps renderer reads on the latest graph', () => {
    const graphA = createDependencyTraceGraph('trace-engine-graph-a');
    const graphB = createDependencyTraceGraph('trace-engine-graph-b');
    const engine = createTraceEngine(graphA);

    const update = engine.sync({
      ...createTraceEngineInputs(graphA),
      traceGraph: graphB
    });

    expect(update?.reason).toBe('sync');
    expect(engine.getSnapshot().traceGraph).toBe(graphB);
    expect(engine.getSnapshot().traceGraphs).toEqual([graphB]);
  });

  it('owns marker projections in the render snapshot with the engine event-row default', () => {
    const graph = createGlobalEventTraceGraph('trace-engine-render-snapshot');
    const engine = createTraceEngine(graph, {
      settings: {
        ...defaultTraceVisSettings,
        showGlobalEvents: true
      }
    });
    const traceViewState = engine.getSnapshot().traceViewState;
    const derivedData = traceViewState.renderSnapshot.derivedDataByGraph[0];
    const event = derivedData?.globalEvents.visibleEvents[0];

    expect(traceViewState.renderSnapshot.derivedDataByGraph).toHaveLength(
      traceViewState.activeLayouts.length
    );
    if (!event) {
      throw new Error('Expected one derived global event');
    }
    expect(derivedData?.globalEvents.positionMap.get(event.eventRef)?.[1]).toBe(-15);
  });

  it('counts owned marker projections in retained render diagnostics', () => {
    const graph = createGlobalEventTraceGraph('trace-engine-marker-retained-size');
    const hiddenEngine = createTraceEngine(graph);
    const visibleEngine = createTraceEngine(graph, {
      settings: {
        ...defaultTraceVisSettings,
        showGlobalEvents: true,
        showInstants: true,
        showCounters: true
      }
    });
    const derivedData =
      visibleEngine.getSnapshot().traceViewState.renderSnapshot.derivedDataByGraph[0];
    const hiddenBytes = hiddenEngine.getDiagnostics({
      includeRetainedSizeEstimates: true
    }).traceDeckInputsSizeBytes;
    const visibleBytes = visibleEngine.getDiagnostics({
      includeRetainedSizeEstimates: true
    }).traceDeckInputsSizeBytes;

    expect(derivedData?.globalEvents.visibleEvents).toHaveLength(1);
    expect(derivedData?.instants.visibleInstants).toHaveLength(1);
    expect(derivedData?.counters.counterPoints).toHaveLength(2);
    expect(visibleBytes).toBeGreaterThan(hiddenBytes ?? 0);
  });

  it('rebuilds binary geometry from native timing projections', () => {
    const graph = createAggregationTraceGraph('trace-engine-native-timing-aggregation');
    const engine = createTraceEngine(graph, {layoutTimingKey: 'envelope'});
    const initialRow = getPreparedRenderState(engine).foregroundScenes[0]?.rows[0];
    const initialBlockPosition = getBinaryAttributeValue(
      initialRow?.binaryBlockData,
      'getPosition'
    );
    const initialBlockFillColor = getBinaryAttributeValue(
      initialRow?.binaryBlockData,
      'getFillColor'
    );
    const initialDependencySourcePosition = getBinaryAttributeValue(
      initialRow?.binaryDependencyLineData,
      'getSourcePosition'
    );

    const update = engine.sync({
      ...createTraceEngineInputs(graph, {layoutTimingKey: 'latest_start'})
    });
    const refreshedRow = getPreparedRenderState(engine).foregroundScenes[0]?.rows[0];
    const refreshedBlockPosition = getBinaryAttributeValue(
      refreshedRow?.binaryBlockData,
      'getPosition'
    );
    const refreshedBlockFillColor = getBinaryAttributeValue(
      refreshedRow?.binaryBlockData,
      'getFillColor'
    );
    const refreshedDependencySourcePosition = getBinaryAttributeValue(
      refreshedRow?.binaryDependencyLineData,
      'getSourcePosition'
    );

    expect(update?.reason).toBe('sync');
    expect(engine.getSnapshot().traceGraph).toBe(graph);
    expect(refreshedBlockPosition).not.toBe(initialBlockPosition);
    expect(refreshedBlockPosition?.[0]).not.toBe(initialBlockPosition?.[0]);
    expect(refreshedDependencySourcePosition).not.toBe(initialDependencySourcePosition);
    expect(refreshedDependencySourcePosition?.[0]).not.toBe(initialDependencySourcePosition?.[0]);
    expect(refreshedBlockFillColor).not.toBe(initialBlockFillColor);
    expect(refreshedBlockFillColor).toEqual(initialBlockFillColor);
  });

  it('keeps current base layouts for non-layout sync inputs', () => {
    const graph = createDependencyTraceGraph('trace-engine-owned-base-layouts');
    const engine = createTraceEngine(graph);
    const baseLayout = engine.getActiveLayouts()[0];
    const renderState = getPreparedRenderState(engine);

    const update = engine.sync({
      ...createTraceEngineInputs(graph),
      settings: {
        ...defaultTraceVisSettings,
        dependencyOpacity: 0.5
      }
    });

    expect(update?.reason).toBe('sync');
    expect(engine.getActiveLayouts()[0]).toBe(baseLayout);
    expect(getPreparedRenderState(engine).foregroundScenes).not.toBe(renderState.foregroundScenes);
  });

  it('keeps current base layouts when normal selection changes without focus', () => {
    const graph = createDependencyTraceGraph('trace-engine-layout-reuse');
    const parentSpanRef = getRequiredSpanRef(graph, 'parent');
    const engine = createTraceEngine(graph);
    const baseLayout = engine.getActiveLayouts()[0];
    const renderState = getPreparedRenderState(engine);

    engine.dispatch({type: 'selectSpan', spanRef: parentSpanRef});

    expect(engine.getFocusedSelectionSpanRefs()).toEqual([]);
    expect(engine.getActiveLayouts()[0]).toBe(baseLayout);
    const nextRenderState = getPreparedRenderState(engine);
    expect(nextRenderState.foregroundScenes).toBe(renderState.foregroundScenes);
    expect(nextRenderState.overviewScenes).toBe(renderState.overviewScenes);
    expect(nextRenderState.pathData).toBe(renderState.pathData);
  });

  it('keeps controlled normal selection sync overlay-only', () => {
    const graph = createDependencyTraceGraph('trace-engine-controlled-selection-reuse');
    const parentSpanRef = getRequiredSpanRef(graph, 'parent');
    const engine = createTraceEngine(graph);
    const baseLayout = engine.getActiveLayouts()[0];
    const renderState = getPreparedRenderState(engine);

    engine.sync({
      ...createTraceEngineInputs(graph),
      selectedSpanRefs: [parentSpanRef]
    });

    expect(engine.getFocusedSelectionSpanRefs()).toEqual([]);
    expect(engine.getActiveLayouts()[0]).toBe(baseLayout);
    const nextRenderState = getPreparedRenderState(engine);
    expect(nextRenderState.foregroundScenes).toBe(renderState.foregroundScenes);
    expect(nextRenderState.overviewScenes).toBe(renderState.overviewScenes);
    expect(nextRenderState.pathData).toBe(renderState.pathData);
  });

  it('rebuilds render data when selection expands a collapsed process', () => {
    const graph = createDependencyTraceGraph('trace-engine-selection-expands-process');
    const parentSpanRef = getRequiredSpanRef(graph, 'parent');
    const engine = createTraceEngine(graph, {defaultExpandProcess: false});
    const baseLayout = engine.getActiveLayouts()[0];
    const renderState = getPreparedRenderState(engine);

    engine.dispatch({type: 'selectSpan', spanRef: parentSpanRef});

    expect(engine.getActiveLayouts()[0]).not.toBe(baseLayout);
    expect(getPreparedRenderState(engine).foregroundScenes).not.toBe(renderState.foregroundScenes);
  });

  it('enters focused relayout on focus selection and restores base layouts when cleared', () => {
    const graph = createDependencyTraceGraph('trace-engine-focus');
    const parentSpanRef = getRequiredSpanRef(graph, 'parent');
    const childSpanRef = getRequiredSpanRef(graph, 'child');
    const engine = createTraceEngine(graph, {
      selectionPolicy: {type: 'dependency-chain', keywords: ['PARENT']}
    });
    const baseLayout = engine.getActiveLayouts()[0];

    engine.dispatch({type: 'selectSpan', spanRef: parentSpanRef, isExtendedSelection: true});

    expect(engine.getFocusedSelectionSpanRefs()).toEqual([parentSpanRef, childSpanRef]);
    expect(engine.getActiveLayouts()[0]).not.toBe(baseLayout);
    expect(engine.getSnapshot().isOverviewEnabled).toBe(false);

    engine.dispatch({type: 'clearSelection'});

    expect(engine.getFocusedSelectionSpanRefs()).toEqual([]);
    expect(engine.getActiveLayouts()[0]).toBe(baseLayout);
  });

  it('selects immediate visible dependency overlays from engine actions', () => {
    const graph = createDependencyTraceGraph('trace-engine-immediate');
    const parentSpanRef = getRequiredSpanRef(graph, 'parent');
    const processRef = graph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected process ref');
    }
    const visibleDependencyRef = Array.from(
      graph.iterateVisibleSameProcessDependencyRefsByProcess(processRef)
    ).at(0);
    if (visibleDependencyRef == null) {
      throw new Error('Expected visible dependency ref');
    }
    const engine = createTraceEngine(graph, {
      selectionPolicy: {type: 'immediate-visible-dependencies'}
    });
    engine.dispatch({type: 'selectSpan', spanRef: parentSpanRef});

    expect([...engine.getSnapshot().selectedSameProcessDependencyRefs!]).toEqual([
      visibleDependencyRef
    ]);
    expect(
      engine.getSnapshot().selectedSameProcessDependencyDirectionByRef.get(visibleDependencyRef)
    ).toBe('outgoing');
  });

  it('caps unfiltered immediate visible dependency overlays before card materialization', () => {
    const graph = createRuntimeTraceGraph(
      buildJSONTrace([createProcessWithManyImmediateDependencies('rank-a', 0, 101)], [], {
        name: 'trace-engine-immediate-cap'
      })
    );
    const selectedSpanRef = getRequiredSpanRef(graph, 'selected');
    const engine = createTraceEngine(graph, {
      selectionPolicy: {type: 'immediate-visible-dependencies'}
    });
    engine.dispatch({type: 'selectSpan', spanRef: selectedSpanRef});

    const snapshot = engine.getSnapshot();
    const selectedDependencyRefs = [...(snapshot.selectedSameProcessDependencyRefs ?? [])];
    expect(selectedDependencyRefs).toHaveLength(200);
    expect(
      selectedDependencyRefs.filter(
        dependencyRef =>
          snapshot.selectedSameProcessDependencyDirectionByRef.get(dependencyRef) === 'incoming'
      )
    ).toHaveLength(100);
    expect(
      selectedDependencyRefs.filter(
        dependencyRef =>
          snapshot.selectedSameProcessDependencyDirectionByRef.get(dependencyRef) === 'outgoing'
      )
    ).toHaveLength(100);
  });

  it('drops filtered immediate dependency overlays with hidden endpoints', () => {
    const graph = createRuntimeTraceGraph(
      buildJSONTrace([createProcessWithFilteredIncomingDependencies('rank-a', 0, 101)], [], {
        name: 'trace-engine-filtered-immediate-cap'
      }),
      {spanFilters: ['filtered-']}
    );
    const selectedSpanRef = getRequiredSpanRef(graph, 'selected');
    const engine = createTraceEngine(graph, {
      selectionPolicy: {type: 'immediate-visible-dependencies'}
    });
    engine.dispatch({type: 'selectSpan', spanRef: selectedSpanRef});

    const snapshot = engine.getSnapshot();
    const selectedDependencyRefs = [...(snapshot.selectedSameProcessDependencyRefs ?? [])];
    expect(selectedDependencyRefs).toEqual([]);
  });

  it('selects dependency chains without focused span filters until focus is requested', () => {
    const graph = createDependencyTraceGraph('trace-engine-chain');
    const parentSpanRef = getRequiredSpanRef(graph, 'parent');
    const childSpanRef = getRequiredSpanRef(graph, 'child');
    const engine = createTraceEngine(graph, {
      selectionPolicy: {type: 'dependency-chain', keywords: ['PARENT']}
    });

    engine.dispatch({type: 'selectSpan', spanRef: parentSpanRef});

    expect(engine.getSnapshot().extendedSelectionSpanRefs).toEqual([]);
    expect([...engine.getSnapshot().selectedSameProcessDependencyRefs!]).toHaveLength(1);

    engine.dispatch({type: 'selectSpan', spanRef: parentSpanRef, isExtendedSelection: true});

    expect(engine.getSnapshot().extendedSelectionSpanRefs).toEqual([childSpanRef]);
    expect(engine.getFocusedSelectionSpanRefs()).toEqual([parentSpanRef, childSpanRef]);
  });

  it('owns process and thread collapse interactions', () => {
    const graph = createDependencyTraceGraph('trace-engine-collapse');
    const processRef = graph.getProcessRefs()[0];
    const threadRef = graph.getThreadRefs()[0];
    if (processRef == null || threadRef == null) {
      throw new Error('Expected process and thread refs');
    }
    const engine = createTraceEngine(graph);

    engine.dispatch({type: 'toggleProcess', graphIndex: 0, processRef});
    expect(engine.getSnapshot().collapseState.graphs[0]?.collapsedProcessRefs.has(processRef)).toBe(
      true
    );

    engine.dispatch({type: 'toggleThread', graphIndex: 0, threadRef});
    expect(engine.getSnapshot().collapseState.graphs[0]?.collapsedThreadRefs.has(threadRef)).toBe(
      true
    );
  });

  it('prunes thread collapse overrides when later layout filtering hides their threads', () => {
    const graph = createDependencyTraceGraph('trace-engine-thread-prune');
    const threadRef = graph.getThreadRefs()[0];
    if (threadRef == null) {
      throw new Error('Expected thread ref');
    }
    const engine = createTraceEngine(graph);

    engine.dispatch({type: 'toggleThread', graphIndex: 0, threadRef});
    expect(engine.getSnapshot().collapseState.graphs[0]?.collapsedThreadRefs.has(threadRef)).toBe(
      true
    );

    const update = engine.sync({
      ...createTraceEngineInputs(graph),
      settings: {
        ...defaultTraceVisSettings,
        threadDisplayMode: 'selected',
        selectedThreadNames: ['not-present']
      }
    });

    expect(update?.reason).toBe('sync');
    expect(engine.getSnapshot().collapseState.graphs[0]?.collapsedThreadRefs.has(threadRef)).toBe(
      false
    );
  });

  it('serializes expanded process ids for durable host persistence', () => {
    const graph = createDependencyTraceGraph('trace-engine-expanded-process-ids');
    const processRef = graph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected process ref');
    }
    const engine = createTraceEngine(graph, {defaultExpandProcess: false});

    expect(engine.getSerializedExpandedProcessIds()).toEqual([]);

    const update = engine.dispatch({type: 'toggleProcess', graphIndex: 0, processRef});

    expect(update.expandedProcessIdsChanged).toBe(true);
    expect(engine.getSerializedExpandedProcessIds()).toEqual(['rank-a']);
  });

  it('lane allocates later snapshot spans while one process remains collapsed before expansion', () => {
    const loadedProcess = appendSpanToProcess(
      createProcessWithSameProcessDependency('rank-a', 0),
      'later'
    );
    const fullTrace = buildJSONTrace([loadedProcess], [], {
      name: 'trace-engine-growing-process-view'
    });
    const fullTraceDataset = createTraceDatasetFromJSONTraceForTest(fullTrace);
    const fullTraceGraph = createRuntimeTraceGraph(fullTrace);
    const processRef = fullTraceGraph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected process ref');
    }
    const allSpanRefs = [...fullTraceGraph.iterateVisibleSpanRefsByProcess(processRef)];
    const laterSpanRef = getRequiredSpanRef(fullTraceGraph, 'later');
    const initialTraceGraph = createRawTraceGraphFromDataset(
      createTraceDatasetWithActiveSpanRefs(fullTraceDataset, allSpanRefs.slice(0, 2))
    );
    const loadedTraceGraph = createRawTraceGraphFromDataset(
      createTraceDatasetWithActiveSpanRefs(fullTraceDataset, allSpanRefs)
    );
    const loadedProcessRef = loadedTraceGraph.getProcessRefs()[0];
    if (loadedProcessRef == null) {
      throw new Error('Expected loaded process ref');
    }
    const settings = {
      ...defaultTraceVisSettings,
      trackAggregationMode: 'combine-threads'
    } satisfies TraceVisSettings;
    const engine = createTraceEngine(initialTraceGraph, {
      defaultExpandProcess: false,
      settings
    });

    engine.sync(createTraceEngineInputs(loadedTraceGraph, {defaultExpandProcess: false, settings}));

    const collapsedRow = getPreparedRenderState(engine).foregroundScenes[0]?.rows[0];
    const laterSpanIndex = collapsedRow
      ? Array.from(collapsedRow.binaryBlockData?.spans ?? []).indexOf(laterSpanRef)
      : -1;
    expect(getPreparedSpanRefs(collapsedRow?.binaryBlockData?.spans)).toEqual(allSpanRefs);
    expect(laterSpanIndex).toBeGreaterThanOrEqual(0);
    expect(getBinarySpanHeight(collapsedRow?.binaryBlockData, laterSpanIndex)).toBe(0);

    engine.dispatch({type: 'toggleProcess', graphIndex: 0, processRef: loadedProcessRef});

    const expandedRow = getPreparedRenderState(engine).foregroundScenes[0]?.rows[0];
    expect(hasTraceLayoutSpanLaneIndex(engine.getActiveLayouts()[0]!, laterSpanRef)).toBe(true);
    expect(getBinarySpanHeight(expandedRow?.binaryBlockData, laterSpanIndex)).toBeGreaterThan(0);
  });

  it('rebuilds positive binary span heights after toggling a default-collapsed expanded-by-default process', () => {
    const graph = createDependencyTraceGraph('trace-engine-default-collapsed-expand');
    const processRef = graph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected process ref');
    }
    const spanRef = Array.from(graph.iterateVisibleSpanRefsByProcess(processRef)).at(0);
    if (spanRef == null) {
      throw new Error('Expected span ref');
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = createTraceEngine(graph, {
      defaultExpandProcess: true,
      defaultCollapsedProcessIds: ['rank-a']
    });
    const collapsedLayout = engine.getActiveLayouts()[0];

    expect(collapsedLayout).not.toHaveProperty('spanGeometryChunks');
    expect(collapsedLayout).not.toHaveProperty('sameProcessDependencyGeometryChunks');
    expect(collapsedLayout).not.toHaveProperty('crossProcessDependencyGeometryChunks');
    expect(collapsedLayout).not.toHaveProperty('spanVisibilityMapBySpanRef');
    expect(collapsedLayout).not.toHaveProperty('geometryCache');
    expect(
      getBinarySpanHeight(
        getPreparedRenderState(engine).foregroundScenes[0]?.rows[0]?.binaryBlockData,
        0
      )
    ).toBe(0);

    engine.dispatch({type: 'toggleProcess', graphIndex: 0, processRef});

    expect(
      getBinarySpanHeight(
        getPreparedRenderState(engine).foregroundScenes[0]?.rows[0]?.binaryBlockData,
        0
      )
    ).toBeGreaterThan(0);
    expect(
      warnSpy.mock.calls.some(call =>
        String(call[0]).includes(
          'Expanded trace process row has invalid binary span or label geometry'
        )
      )
    ).toBe(false);
    warnSpy.mockRestore();
  });

  it('reports TraceEngine retained-state and build diagnostics', () => {
    const graph = createDependencyTraceGraph('trace-engine-diagnostics');
    const parentSpanRef = getRequiredSpanRef(graph, 'parent');
    const engine = createTraceEngine(graph);
    const unsubscribe = engine.subscribe(() => undefined);

    engine.dispatch({type: 'selectSpan', spanRef: parentSpanRef});

    const diagnostics = engine.getDiagnostics();
    expect(diagnostics.lastUpdateReason).toBe('selectSpan');
    expect(diagnostics.listenerCount).toBe(1);
    expect(diagnostics.displayedGraphCount).toBe(1);
    expect(diagnostics.displayedSpanCount).toBe(graph.stats.spanCount);
    expect(diagnostics.selectedSpanCount).toBe(1);
    expect(diagnostics.activeLayoutCount).toBe(engine.getActiveLayouts().length);
    expect(diagnostics.traceEngineRetainedSizeBytes).toBeNull();
    expect(diagnostics.retainedSizeEstimateDurationMs).toBeNull();

    const retainedSizeDiagnostics = engine.getDiagnostics({includeRetainedSizeEstimates: true});
    expect(retainedSizeDiagnostics.traceEngineRetainedSizeBytes).toBeGreaterThanOrEqual(
      retainedSizeDiagnostics.traceLayoutSizeBytes ?? 0
    );
    expect(retainedSizeDiagnostics.retainedSizeEstimateDurationMs).toBeGreaterThanOrEqual(0);

    unsubscribe();
    expect(engine.getDiagnostics().listenerCount).toBe(0);
  });
});

/** Builds one mounted TraceEngine test fixture around the supplied graph. */
function createTraceEngine(
  traceGraph: TraceGraph,
  overrides: Partial<Parameters<typeof createTraceEngineInputs>[1]> = {}
): TraceEngine {
  return new TraceEngine(createTraceEngineInputs(traceGraph, overrides));
}

/** Builds the minimal TraceEngine input bundle used by engine tests. */
function createTraceEngineInputs(
  traceGraph: TraceGraph,
  overrides: {
    /** Trace settings used by the mounted engine fixture. */
    settings?: TraceVisSettings;
    /** Optional selection policy used by the mounted engine fixture. */
    selectionPolicy?: Parameters<TraceEngine['sync']>[0]['selectionPolicy'];
    /** Whether the mounted engine fixture expands processes by default. */
    defaultExpandProcess?: boolean;
    /** Process ids forced collapsed even when processes expand by default. */
    defaultCollapsedProcessIds?: readonly string[];
    /** Timing projection used for layout geometry. */
    layoutTimingKey?: string | null;
  } = {}
) {
  return {
    traceGraph,
    traceStyle: DEFAULT_TRACE_STYLE,
    paths: EMPTY_TRACE_PATHS,
    settings: overrides.settings ?? defaultTraceVisSettings,
    defaultExpandProcess: overrides.defaultExpandProcess ?? true,
    defaultCollapsedProcessIds: overrides.defaultCollapsedProcessIds,
    layoutTimingKey: overrides.layoutTimingKey,
    selectionPolicy: overrides.selectionPolicy
  };
}

/** Builds one single-process dependency graph fixture with the supplied graph name. */
function createDependencyTraceGraph(name: string): TraceGraph {
  return createRuntimeTraceGraph(
    buildJSONTrace([createProcessWithSameProcessDependency('rank-a', 0)], [], {name})
  );
}

/** Builds one dependency graph with global, instant, and counter marker fixtures. */
function createGlobalEventTraceGraph(name: string): TraceGraph {
  const process = createProcessWithSameProcessDependency('rank-a', 0);
  const threadId = process.threads[0]?.threadId;
  if (threadId == null) {
    throw new Error('Expected one marker fixture thread');
  }
  const instant: TraceInstant = {
    type: 'trace-instant',
    instantId: 'instant' as TraceInstantId,
    threadId,
    name: 'instant',
    atTimeMs: 2,
    scope: 't'
  };
  const counters: TraceCounter[] = [
    {
      type: 'trace-counter',
      counterId: 'counter-a' as TraceCounterId,
      threadId,
      name: 'counter',
      atTimeMs: 2,
      totalValue: 1,
      series: {}
    },
    {
      type: 'trace-counter',
      counterId: 'counter-b' as TraceCounterId,
      threadId,
      name: 'counter',
      atTimeMs: 3,
      totalValue: 2,
      series: {}
    }
  ];
  process.instants = [instant];
  process.instantMap = {[instant.instantId]: instant};
  process.threadInstantMap = {[threadId]: [instant]};
  process.counters = counters;
  process.counterMap = Object.fromEntries(counters.map(counter => [counter.counterId, counter]));
  process.threadCounterMap = {[threadId]: counters};
  return createRuntimeTraceGraph(
    buildJSONTrace([process], [], {
      name,
      events: [
        {
          type: 'trace-event',
          eventId: 'event' as TraceEventId,
          name: 'event',
          atTimeMs: 2
        }
      ]
    })
  );
}

/** Builds one dependency graph with a native non-primary timing projection. */
function createAggregationTraceGraph(name: string): TraceGraph {
  const process = createProcessWithSameProcessDependency('rank-a', 0);
  for (const span of process.spans) {
    const primaryTiming = span.timings.primary;
    if (!primaryTiming) {
      throw new Error('Expected primary timing');
    }
    span.primaryTimingKey = 'envelope';
    span.timings = {
      envelope: primaryTiming,
      latest_start: {
        ...primaryTiming,
        startTimeMs: primaryTiming.startTimeMs + 20,
        endTimeMs: primaryTiming.endTimeMs + 20
      }
    };
  }
  return createRuntimeTraceGraph(buildJSONTrace([process], [], {name}));
}

/** Builds one raw test TraceGraph from a deliberately narrowed dataset snapshot. */
function createRawTraceGraphFromDataset(
  traceDataset: TraceDataset,
  options?: Parameters<typeof createRuntimeTraceGraph>[1]
): TraceGraph {
  return createDatasetRuntimeTraceGraphForTest(traceDataset, options);
}

/** Builds one dataset snapshot whose visible process SpanRef views contain the provided refs. */
function createTraceDatasetWithActiveSpanRefs(
  traceDataset: TraceDataset,
  spanRefs: readonly SpanRef[]
): TraceDataset {
  return {
    ...traceDataset,
    spanRefs,
    processSpanTableMap: buildTraceProcessSpanRefTables(
      traceDataset.chunks,
      traceDataset.processes,
      {
        processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex,
        spanRefs
      }
    ),
    stats: {
      ...traceDataset.stats,
      spanCount: spanRefs.length
    }
  };
}

/** Builds one process fixture containing a local parent-child dependency. */
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
    keywords: new Set(['PARENT']),
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

/** Builds one process fixture with many immediate incoming and outgoing same process dependencies. */
function createProcessWithManyImmediateDependencies(
  processId: string,
  rankNum: number,
  dependencyCountPerDirection: number
): TraceProcess {
  const thread = createThread(processId);
  const selectedSpan = createSpan('selected', thread);
  const incomingSpans = Array.from({length: dependencyCountPerDirection}, (_entry, index) =>
    createSpan(`incoming-${index}`, thread)
  );
  const outgoingSpans = Array.from({length: dependencyCountPerDirection}, (_entry, index) =>
    createSpan(`outgoing-${index}`, thread)
  );
  const sameProcessDependencies = [
    ...incomingSpans.map((span, index) =>
      attachOutgoingSameProcessDependency(
        span,
        createSameProcessDependencyForSpans(`dep-incoming-${index}`, span, selectedSpan)
      )
    ),
    ...outgoingSpans.map((span, index) =>
      attachOutgoingSameProcessDependency(
        selectedSpan,
        createSameProcessDependencyForSpans(`dep-outgoing-${index}`, selectedSpan, span)
      )
    )
  ];

  return createProcessFromSpans({
    processId,
    rankNum,
    thread,
    spans: [selectedSpan, ...incomingSpans, ...outgoingSpans],
    sameProcessDependencies
  });
}

/** Builds one process fixture whose filtered parents rewrite many incoming visible dependencies. */
function createProcessWithFilteredIncomingDependencies(
  processId: string,
  rankNum: number,
  dependencyCount: number
): TraceProcess {
  const thread = createThread(processId);
  const selectedSpan = createSpan('selected', thread);
  const rootSpans = Array.from({length: dependencyCount}, (_entry, index) =>
    createSpan(`root-${index}`, thread)
  );
  const filteredSpans = Array.from({length: dependencyCount}, (_entry, index) =>
    createSpan(`filtered-${index}`, thread)
  );
  const sameProcessDependencies = rootSpans.flatMap((rootSpan, index) => {
    const filteredSpan = filteredSpans[index]!;
    return [
      attachOutgoingSameProcessDependency(
        rootSpan,
        createSameProcessDependencyForSpans(`dep-root-filtered-${index}`, rootSpan, filteredSpan, [
          'PARENT'
        ])
      ),
      attachOutgoingSameProcessDependency(
        filteredSpan,
        createSameProcessDependencyForSpans(
          `dep-filtered-selected-${index}`,
          filteredSpan,
          selectedSpan,
          ['PARENT']
        )
      )
    ];
  });

  return createProcessFromSpans({
    processId,
    rankNum,
    thread,
    spans: [selectedSpan, ...rootSpans, ...filteredSpans],
    sameProcessDependencies
  });
}

/** Builds one test thread owned by the supplied process. */
function createThread(processId: string): TraceThread {
  return {
    type: 'trace-thread',
    name: `${processId}-thread`,
    threadId: `${processId}-thread` as TraceThreadId,
    processId
  };
}

/** Builds one same-process dependency between the supplied test spans. */
function createSameProcessDependencyForSpans(
  dependencyId: string,
  startSpan: TraceSpan,
  endSpan: TraceSpan,
  keywords: readonly string[] = []
): TraceSameProcessDependency {
  return {
    type: 'trace-same-process-dependency',
    dependencyId: dependencyId as TraceDependencyId,
    startSpanId: startSpan.spanId,
    endSpanId: endSpan.spanId,
    keywords: new Set(keywords),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 1_000
  };
}

/** Records one outgoing dependency on its source span and returns the dependency. */
function attachOutgoingSameProcessDependency(
  startSpan: TraceSpan,
  dependency: TraceSameProcessDependency
): TraceSameProcessDependency {
  startSpan.sameProcessDependencyIds.push(dependency.dependencyId);
  startSpan.sameProcessDependencies.push(dependency);
  return dependency;
}

/** Builds one process fixture from the supplied thread, spans, and same process dependencies. */
function createProcessFromSpans(params: {
  /** Stable process id used by graph lookup helpers. */
  processId: string;
  /** Rank number assigned to process metadata. */
  rankNum: number;
  /** Source thread owned by the process. */
  thread: TraceThread;
  /** Span rows owned by the process. */
  spans: TraceSpan[];
  /** Same-process dependency rows owned by the process. */
  sameProcessDependencies: TraceSameProcessDependency[];
}): TraceProcess {
  return {
    type: 'trace-process',
    processId: params.processId,
    name: params.processId,
    rankNum: params.rankNum,
    stepNum: 0,
    threads: [params.thread],
    threadMap: {[params.thread.threadId]: params.thread},
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

/** Returns one process copy with an additional span in its existing source thread. */
function appendSpanToProcess(process: TraceProcess, spanName: string): TraceProcess {
  const thread = process.threads[0];
  if (!thread) {
    throw new Error('Expected source thread');
  }
  const span = createSpan(spanName, thread);
  return {
    ...process,
    spans: [...process.spans, span],
    spanMap: {
      ...process.spanMap,
      [span.spanId]: span
    }
  };
}

/** Builds one timed span fixture owned by the supplied test thread. */
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

/** Returns one required runtime span ref by external span id. */
function getRequiredSpanRef(traceGraph: TraceGraph, spanId: string): SpanRef {
  const spanRef = traceGraph.getSpanRefById(spanId as TraceSpanId);
  if (spanRef == null) {
    throw new Error(`Expected span ref for ${spanId}`);
  }
  return spanRef;
}

/** Returns one rendered binary span height or zero when geometry is absent. */
function getBinarySpanHeight(
  binaryBlockData:
    | {
        /** Binary layer payload containing packed attribute columns. */
        readonly data: {
          /** Packed binary attributes keyed by deck.gl attribute name. */
          readonly attributes: Readonly<
            Record<
              string,
              {
                /** Packed binary attribute values. */
                readonly value: Float32Array | Uint8Array | Uint32Array;
              }
            >
          >;
        };
      }
    | undefined,
  spanIndex: number
): number {
  const sizes = binaryBlockData?.data.attributes.getSize?.value;
  return sizes instanceof Float32Array ? (sizes[spanIndex * 2 + 1] ?? 0) : 0;
}

/** Returns one packed binary attribute buffer from a prepared graph-scene row. */
function getBinaryAttributeValue(
  binaryData:
    | {
        /** Binary layer payload containing packed attribute columns. */
        readonly data: {
          /** Packed binary attributes keyed by deck.gl attribute name. */
          readonly attributes: Readonly<
            Record<
              string,
              {
                /** Packed binary attribute values. */
                readonly value: Float32Array | Uint8Array | Uint32Array;
              }
            >
          >;
        };
      }
    | undefined,
  attributeName: string
): Float32Array | Uint8Array | Uint32Array | undefined {
  return binaryData?.data.attributes[attributeName]?.value;
}
