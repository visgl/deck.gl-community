import {describe, expect, it, vi} from 'vitest';

import {
  buildTraceGraphDataFromJSONTrace,
  buildTraceProcessSpanRefTables
} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {TraceGraph} from '../trace-graph/trace-graph';
import {DEFAULT_TRACE_STYLE} from '../trace-style/trace-style';
import {TraceEngine} from './trace-engine';

import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceDependencyId,
  TraceLocalDependency,
  TracePath,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';

const EMPTY_TRACE_PATHS: TracePath[] = [];
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

  it('reuses base layouts when normal selection changes without focus', () => {
    const graph = createDependencyTraceGraph('trace-engine-layout-reuse');
    const parentSpanRef = getRequiredSpanRef(graph, 'parent');
    const engine = createTraceEngine(graph);
    const baseLayout = engine.getActiveLayouts()[0];

    engine.dispatch({type: 'selectSpan', spanRef: parentSpanRef});

    expect(engine.getFocusedSelectionSpanRefs()).toEqual([]);
    expect(engine.getActiveLayouts()[0]).toBe(baseLayout);
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
    const visibleDependencyRef = graph.getVisibleLocalDependencyRefs(processRef)[0];
    if (visibleDependencyRef == null) {
      throw new Error('Expected visible dependency ref');
    }
    const engine = createTraceEngine(graph, {
      selectionPolicy: {type: 'immediate-visible-dependencies'}
    });
    const getTraceSpanCardModelSpy = vi.spyOn(graph, 'getTraceSpanCardModel');

    engine.dispatch({type: 'selectSpan', spanRef: parentSpanRef});

    expect(getTraceSpanCardModelSpy).not.toHaveBeenCalled();
    expect([...engine.getSnapshot().selectedLocalDependencyRefs!]).toEqual([visibleDependencyRef]);
    expect(
      engine.getSnapshot().selectedLocalDependencyDirectionByRef.get(visibleDependencyRef)
    ).toBe('outgoing');
  });

  it('caps unfiltered immediate visible dependency overlays before card materialization', () => {
    const graph = createTraceGraphFromData(
      'trace-engine-immediate-cap',
      buildTraceGraphDataFromJSONTrace(
        buildJSONTrace([createProcessWithManyImmediateDependencies('rank-a', 0, 101)], [], {
          name: 'trace-engine-immediate-cap'
        })
      )
    );
    const selectedSpanRef = getRequiredSpanRef(graph, 'selected');
    const engine = createTraceEngine(graph, {
      selectionPolicy: {type: 'immediate-visible-dependencies'}
    });
    const getTraceSpanCardModelSpy = vi.spyOn(graph, 'getTraceSpanCardModel');

    engine.dispatch({type: 'selectSpan', spanRef: selectedSpanRef});

    const snapshot = engine.getSnapshot();
    const selectedDependencyRefs = [...(snapshot.selectedLocalDependencyRefs ?? [])];
    expect(getTraceSpanCardModelSpy).not.toHaveBeenCalled();
    expect(selectedDependencyRefs).toHaveLength(200);
    expect(
      selectedDependencyRefs.filter(
        dependencyRef =>
          snapshot.selectedLocalDependencyDirectionByRef.get(dependencyRef) === 'incoming'
      )
    ).toHaveLength(100);
    expect(
      selectedDependencyRefs.filter(
        dependencyRef =>
          snapshot.selectedLocalDependencyDirectionByRef.get(dependencyRef) === 'outgoing'
      )
    ).toHaveLength(100);
  });

  it('caps filtered immediate visible dependency overlays after visible endpoint rewrites', () => {
    const graph = createTraceGraphFromData(
      'trace-engine-filtered-immediate-cap',
      buildTraceGraphDataFromJSONTrace(
        buildJSONTrace([createProcessWithFilteredIncomingDependencies('rank-a', 0, 101)], [], {
          name: 'trace-engine-filtered-immediate-cap'
        })
      ),
      {spanFilters: ['filtered-']}
    );
    const selectedSpanRef = getRequiredSpanRef(graph, 'selected');
    const engine = createTraceEngine(graph, {
      selectionPolicy: {type: 'immediate-visible-dependencies'}
    });
    const getTraceSpanCardModelSpy = vi.spyOn(graph, 'getTraceSpanCardModel');

    engine.dispatch({type: 'selectSpan', spanRef: selectedSpanRef});

    const snapshot = engine.getSnapshot();
    const selectedDependencyRefs = [...(snapshot.selectedLocalDependencyRefs ?? [])];
    expect(getTraceSpanCardModelSpy).not.toHaveBeenCalled();
    expect(selectedDependencyRefs).toHaveLength(100);
    expect(
      selectedDependencyRefs.every(dependencyRef => {
        const startSpanRef = graph.getVisibleDependencyStartSpan(dependencyRef);
        const endSpanRef = graph.getVisibleDependencyEndSpan(dependencyRef);
        return (
          startSpanRef != null &&
          !graph.spanIsFiltered(startSpanRef) &&
          endSpanRef === selectedSpanRef &&
          snapshot.selectedLocalDependencyDirectionByRef.get(dependencyRef) === 'incoming'
        );
      })
    ).toBe(true);
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
    expect([...engine.getSnapshot().selectedLocalDependencyRefs!]).toHaveLength(1);

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
      createProcessWithLocalDependency('rank-a', 0),
      'later'
    );
    const fullTraceGraphData = buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([loadedProcess], [], {name: 'trace-engine-growing-process-view'})
    );
    const fullTraceGraph = createTraceGraphFromData(
      'trace-engine-growing-process-view-full',
      fullTraceGraphData
    );
    const processRef = fullTraceGraph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected process ref');
    }
    const allSpanRefs = [...fullTraceGraph.getVisibleProcessRenderSpanRefs(processRef)];
    const laterSpanRef = getRequiredSpanRef(fullTraceGraph, 'later');
    const initialTraceGraph = createTraceGraphFromData(
      'trace-engine-growing-process-view-initial',
      createTraceGraphDataWithActiveSpanRefs(fullTraceGraphData, allSpanRefs.slice(0, 2))
    );
    const loadedTraceGraph = createTraceGraphFromData(
      'trace-engine-growing-process-view-loaded',
      createTraceGraphDataWithActiveSpanRefs(fullTraceGraphData, allSpanRefs)
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

    const collapsedRow = engine.getPreparedScene().foreground[0]?.rows[0];
    const laterSpanIndex = collapsedRow?.spans.indexOf(laterSpanRef) ?? -1;
    expect(collapsedRow?.spans).toEqual(allSpanRefs);
    expect(laterSpanIndex).toBeGreaterThanOrEqual(0);
    expect(getBinarySpanHeight(collapsedRow?.binaryBlockData, laterSpanIndex)).toBe(0);

    engine.dispatch({type: 'toggleProcess', graphIndex: 0, processRef: loadedProcessRef});

    const expandedRow = engine.getPreparedScene().foreground[0]?.rows[0];
    const laterThreadRef = loadedTraceGraph.getThreadRefBySpanRef(laterSpanRef);
    if (laterThreadRef == null) {
      throw new Error('Expected later span thread ref');
    }
    expect(
      engine
        .getActiveLayouts()[0]
        ?.threadLayoutMapByRef.get(laterThreadRef)
        ?.spanLaneMap?.has(laterSpanRef)
    ).toBe(true);
    expect(getBinarySpanHeight(expandedRow?.binaryBlockData, laterSpanIndex)).toBeGreaterThan(0);
  });

  it('rebuilds positive binary span heights after toggling a default-collapsed expanded-by-default process', () => {
    const graph = createDependencyTraceGraph('trace-engine-default-collapsed-expand');
    const processRef = graph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected process ref');
    }
    const spanRef = graph.getVisibleProcessRenderSpanRefs(processRef)[0];
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
    expect(collapsedLayout).not.toHaveProperty('localDependencyGeometryChunks');
    expect(collapsedLayout).not.toHaveProperty('crossDependencyGeometryChunks');
    expect(collapsedLayout).not.toHaveProperty('spanVisibilityMapBySpanRef');
    expect(collapsedLayout).not.toHaveProperty('geometryCache');
    expect(
      getBinarySpanHeight(engine.getPreparedScene().foreground[0]?.rows[0]?.binaryBlockData, 0)
    ).toBe(0);

    engine.dispatch({type: 'toggleProcess', graphIndex: 0, processRef});

    expect(
      getBinarySpanHeight(engine.getPreparedScene().foreground[0]?.rows[0]?.binaryBlockData, 0)
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
  } = {}
) {
  return {
    traceGraph,
    traceStyle: DEFAULT_TRACE_STYLE,
    paths: EMPTY_TRACE_PATHS,
    settings: overrides.settings ?? defaultTraceVisSettings,
    defaultExpandProcess: overrides.defaultExpandProcess ?? true,
    defaultCollapsedProcessIds: overrides.defaultCollapsedProcessIds,
    selectionPolicy: overrides.selectionPolicy
  };
}

/** Builds one single-process dependency graph fixture with the supplied graph name. */
function createDependencyTraceGraph(name: string): TraceGraph {
  return createTraceGraphFromData(
    name,
    buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([createProcessWithLocalDependency('rank-a', 0)], [], {name})
    )
  );
}

/** Builds one test TraceGraph from Arrow-backed graph data. */
function createTraceGraphFromData(
  name: string,
  traceGraphData: ReturnType<typeof buildTraceGraphDataFromJSONTrace>,
  options?: ConstructorParameters<typeof TraceGraph>[1]
): TraceGraph {
  return new TraceGraph(
    createStaticTraceGraphRuntimeSource({
      identityKey: `${name}:test`,
      traceGraphData
    }),
    options
  );
}

/** Builds one graph-data snapshot whose visible process SpanRef views contain the provided refs. */
function createTraceGraphDataWithActiveSpanRefs(
  traceGraphData: ReturnType<typeof buildTraceGraphDataFromJSONTrace>,
  spanRefs: readonly SpanRef[]
): ReturnType<typeof buildTraceGraphDataFromJSONTrace> {
  return {
    ...traceGraphData,
    spanRefs,
    processSpanTableMap: buildTraceProcessSpanRefTables(
      traceGraphData.chunks,
      traceGraphData.processes,
      {
        processIdsByIndex: traceGraphData.processIdsByIndex,
        spanRefs
      }
    ),
    stats: {
      ...traceGraphData.stats,
      spanCount: spanRefs.length
    }
  };
}

/** Builds one process fixture containing a local parent-child dependency. */
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
    keywords: new Set(['PARENT']),
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

/** Builds one process fixture with many immediate incoming and outgoing local dependencies. */
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
  const localDependencies = [
    ...incomingSpans.map((span, index) =>
      attachOutgoingLocalDependency(
        span,
        createLocalDependencyForSpans(`dep-incoming-${index}`, span, selectedSpan)
      )
    ),
    ...outgoingSpans.map((span, index) =>
      attachOutgoingLocalDependency(
        selectedSpan,
        createLocalDependencyForSpans(`dep-outgoing-${index}`, selectedSpan, span)
      )
    )
  ];

  return createProcessFromSpans({
    processId,
    rankNum,
    thread,
    spans: [selectedSpan, ...incomingSpans, ...outgoingSpans],
    localDependencies
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
  const localDependencies = rootSpans.flatMap((rootSpan, index) => {
    const filteredSpan = filteredSpans[index]!;
    return [
      attachOutgoingLocalDependency(
        rootSpan,
        createLocalDependencyForSpans(`dep-root-filtered-${index}`, rootSpan, filteredSpan, [
          'PARENT'
        ])
      ),
      attachOutgoingLocalDependency(
        filteredSpan,
        createLocalDependencyForSpans(
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
    localDependencies
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

/** Builds one local dependency between the supplied test spans. */
function createLocalDependencyForSpans(
  dependencyId: string,
  startSpan: TraceSpan,
  endSpan: TraceSpan,
  keywords: readonly string[] = []
): TraceLocalDependency {
  return {
    type: 'trace-local-dependency',
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
function attachOutgoingLocalDependency(
  startSpan: TraceSpan,
  dependency: TraceLocalDependency
): TraceLocalDependency {
  startSpan.localDependencyIds.push(dependency.dependencyId);
  startSpan.localDependencies.push(dependency);
  return dependency;
}

/** Builds one process fixture from the supplied thread, spans, and local dependencies. */
function createProcessFromSpans(params: {
  /** Stable process id used by graph lookup helpers. */
  processId: string;
  /** Rank number assigned to process metadata. */
  rankNum: number;
  /** Source thread owned by the process. */
  thread: TraceThread;
  /** Span rows owned by the process. */
  spans: TraceSpan[];
  /** Process-local dependency rows owned by the process. */
  localDependencies: TraceLocalDependency[];
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
    localDependencies: params.localDependencies,
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
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}

/** Returns one required runtime span ref by external span id. */
function getRequiredSpanRef(traceGraph: TraceGraph, spanId: string): SpanRef {
  const spanRef = traceGraph.getSpanRefByExternalBlockId(spanId as TraceSpanId);
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
