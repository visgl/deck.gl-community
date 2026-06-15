import {getProcessRefIndex} from '../trace-graph/trace-id-encoder';
import {
  applyRankDeltas,
  calculateTraceLayout,
  countOverflowSpans,
  getLaneIndexFromUserData,
  getLayoutDensityPreset,
  normalizeLaneCounts
} from './trace-geometry-layout-common';
import {sortVisibleTraceLayoutProcessesByProcessOrder} from './trace-geometry-layout-helpers';
import {
  buildTraceLayoutProcessLayoutMapByRef,
  buildTraceLayoutRows,
  getTraceLayoutProcessLayoutByRef,
  getTraceLayoutSpanVisibility
} from './trace-layout';

import type {TraceGraph} from '../trace-graph/trace-graph';
import type {ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef, TraceThreadId} from '../trace-graph/trace-types';
import type {
  CombinedRankLaneAssignmentOverride,
  TraceLayoutLaneSpanSource
} from './trace-geometry-layout-common';
import type {
  ThreadLaneMetadata,
  ThreadLayout,
  TraceLayout,
  TraceLayoutCollapseState,
  TraceLayoutVisibleGraph,
  TraceLayoutVisibleProcessMetadata
} from './trace-layout';

/** Ref-native collapse state resolved for selected-lane relayout compatibility paths. */
type LegacyTraceGraphCollapseState = {
  /** Legacy id-based collapsed process ids. */
  readonly collapsedProcessIds?: ReadonlySet<string>;
  /** Exact expanded thread refs. */
  readonly expandedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Exact collapsed thread refs. */
  readonly collapsedThreadRefs?: ReadonlySet<ThreadRef>;
};

/** Selected-lane graph projection assembled before compact layout calculation. */
type FocusedTraceLayoutProjection = {
  /** Selected-process visible graph used by the compact focused relayout. */
  readonly visibleTraceGraph: TraceLayoutVisibleGraph;
  /** Selected lane spans keyed by owning process id. */
  readonly laneSpansByProcessId: Readonly<Record<string, readonly TraceLayoutLaneSpanSource[]>>;
  /** Lane indices that should remain visible keyed by canonical runtime thread ref. */
  readonly visibleLaneIndicesByThreadRef: ReadonlyMap<ThreadRef, ReadonlySet<number>>;
  /** Preserved combined-thread lane assignments for selected spans. */
  readonly combinedLaneAssignmentsByRankId?: Readonly<
    Record<string, CombinedRankLaneAssignmentOverride>
  >;
};

/** Copies selected span refs into a mutable Set for focused-layout membership checks. */
function toSpanRefSet(spanRefs: ReadonlySet<SpanRef> | ReadonlyArray<SpanRef>): Set<SpanRef> {
  return spanRefs instanceof Set ? new Set(spanRefs) : new Set(spanRefs);
}

/**
 * Builds the selected-process graph and lane metadata needed by focused relayout without scanning
 * every visible span in each source process.
 */
function buildFocusedTraceLayoutProjection(params: {
  traceGraph: TraceGraph;
  traceLayout: TraceLayout;
  settings: Pick<
    TraceVisSettings,
    | 'maxVisibleLanesPerThread'
    | 'maxVisibleLanesUnlimited'
    | 'trackAggregationMode'
    | 'showEmptyProcesses'
  >;
  includedSpanRefs: ReadonlySet<SpanRef>;
  /** Predicate retaining only spans included in the focused projection. */
  shouldIncludeSpan: (span: TraceLayoutLaneSpanSource) => boolean;
}): FocusedTraceLayoutProjection {
  const processMetadataById = new Map<string, TraceLayoutVisibleProcessMetadata>();
  const laneSpansByProcessId: Record<string, TraceLayoutLaneSpanSource[]> = {};
  const visibleLaneIndicesByThreadRef = new Map<ThreadRef, Set<number>>();

  for (const spanRef of params.includedSpanRefs) {
    const visibility = getTraceLayoutSpanVisibility({
      traceLayout: params.traceLayout,
      spanRef
    });
    if (
      (visibility && !visibility.visible) ||
      params.traceGraph.getVisibleSpanBlockId(spanRef) == null
    ) {
      continue;
    }
    const displaySource = params.traceGraph.getDisplaySourceBySpanRef(spanRef);
    if (!displaySource) {
      continue;
    }
    const processRef = params.traceGraph.getProcessRefBySpanRef(spanRef);
    if (processRef == null) {
      continue;
    }
    const threadRef = params.traceGraph.getThreadRefBySpanRef(spanRef);
    if (threadRef == null) {
      continue;
    }
    const span = {
      spanRef,
      processRef: displaySource.processRef,
      threadRef,
      spanId: displaySource.spanId,
      threadId: displaySource.threadId,
      primaryTimingKey: displaySource.primaryTimingKey,
      timings: displaySource.timings,
      userData: displaySource.userData
    } satisfies TraceLayoutLaneSpanSource;
    if (!params.shouldIncludeSpan(span)) {
      continue;
    }
    const processIndex = getProcessRefIndex(processRef);
    const rawProcess = processIndex >= 0 ? params.traceGraph.processes[processIndex] : null;
    const processSource = params.traceGraph.getProcessSourceBySpanRef(spanRef);
    if (!rawProcess || !processSource) {
      continue;
    }

    processMetadataById.set(rawProcess.processId, {
      processRef,
      processId: rawProcess.processId,
      processOrder: processSource.processOrder,
      name: processSource.name,
      rankNum: processSource.rankNum,
      threads: rawProcess.threads,
      threadRefs: params.traceGraph.getThreadRefsByProcessRef(processRef),
      userData: processSource.userData
    });

    laneSpansByProcessId[rawProcess.processId] ??= [];
    laneSpansByProcessId[rawProcess.processId].push(span);

    const laneIndices = visibleLaneIndicesByThreadRef.get(threadRef) ?? new Set<number>();
    visibleLaneIndicesByThreadRef.set(threadRef, laneIndices);
    const existingLaneIndex = getFocusedSourceThreadLayout({
      traceLayout: params.traceLayout,
      threadRef
    })?.spanLaneMap?.get(span.spanRef);
    laneIndices.add(
      typeof existingLaneIndex === 'number' && Number.isFinite(existingLaneIndex)
        ? Math.max(0, Math.floor(existingLaneIndex))
        : getLaneIndexFromUserData(
            span.userData as
              | {
                  /** Optional source-authored lane index. */
                  lane?: number;
                }
              | undefined
          )
    );
  }

  const visibleTraceGraph = {
    name: params.traceGraph.name,
    minTimeMs: params.traceGraph.minTimeMs,
    maxTimeMs: params.traceGraph.maxTimeMs,
    traceGraph: params.traceGraph,
    processes: sortVisibleTraceLayoutProcessesByProcessOrder([...processMetadataById.values()]),
    crossDependencies: params.traceGraph.getVisibleCrossDependencySources()
  } satisfies TraceLayoutVisibleGraph;

  return {
    visibleTraceGraph,
    laneSpansByProcessId,
    visibleLaneIndicesByThreadRef,
    combinedLaneAssignmentsByRankId: buildFocusedCombinedLaneAssignmentsByRankId({
      laneSpansByProcessId,
      settings: params.settings,
      traceLayout: params.traceLayout
    })
  };
}

/**
 * Builds preserved combined-thread lane assignments for focused relayouts from selected spans.
 */
function buildFocusedCombinedLaneAssignmentsByRankId(params: {
  /** Focused visible spans grouped by process id. */
  laneSpansByProcessId: Readonly<Record<string, readonly TraceLayoutLaneSpanSource[]>>;
  settings: Pick<
    TraceVisSettings,
    'maxVisibleLanesPerThread' | 'maxVisibleLanesUnlimited' | 'trackAggregationMode'
  >;
  traceLayout: TraceLayout;
}): Readonly<Record<string, CombinedRankLaneAssignmentOverride>> | undefined {
  if (params.settings.trackAggregationMode !== 'combine-threads') {
    return undefined;
  }

  const overrides: Record<string, CombinedRankLaneAssignmentOverride> = {};
  let overrideCount = 0;
  for (const [processId, spans] of Object.entries(params.laneSpansByProcessId)) {
    const spanLaneMap = new Map<SpanRef, number>();
    let maxLane = -1;
    for (const span of spans) {
      if (span.threadRef == null) {
        continue;
      }
      const sourceLaneIndex = getFocusedSourceThreadLayout({
        traceLayout: params.traceLayout,
        threadRef: span.threadRef
      })?.spanLaneMap?.get(span.spanRef);
      if (typeof sourceLaneIndex !== 'number' || !Number.isFinite(sourceLaneIndex)) {
        continue;
      }
      const laneIndex = Math.max(0, Math.floor(sourceLaneIndex));
      spanLaneMap.set(span.spanRef, laneIndex);
      if (laneIndex > maxLane) {
        maxLane = laneIndex;
      }
    }
    if (spanLaneMap.size === 0) {
      continue;
    }

    const laneCount = Math.max(maxLane + 1, 0);
    const normalizedLaneCount = normalizeLaneCounts(
      laneCount,
      params.settings.maxVisibleLanesPerThread,
      params.settings.maxVisibleLanesUnlimited
    );
    overrides[processId] = {
      laneCount,
      maxLane,
      spanLaneMap,
      overflowSpanCount: countOverflowSpans(
        spanLaneMap,
        normalizedLaneCount.renderedLaneCount,
        normalizedLaneCount.hasOverflow
      )
    };
    overrideCount += 1;
  }

  return overrideCount > 0 ? overrides : undefined;
}

/**
 * Finds the source layout Y offset for a focused process so compact layouts keep their visual
 * anchor near the original selected process row.
 */
function findFocusedSourceProcessLayoutYOffset(params: {
  traceLayout: TraceLayout;
  /** Focused process ref whose source row should anchor compact relayout. */
  processRef: ProcessRef;
}): number | undefined {
  const sourceRow = params.traceLayout.renderRows.find(row => row.processRef === params.processRef);
  return sourceRow
    ? getTraceLayoutProcessLayoutByRef(params.traceLayout, sourceRow.processRef)?.yOffset
    : undefined;
}

/**
 * Keeps full source span-to-lane lookup metadata on focused layouts while the focused
 * `visibleLaneIndices` mask controls which lanes are actually rendered.
 */
function preserveFocusedSourceSpanLaneMaps(params: {
  focusedLayout: TraceLayout;
  sourceLayout: TraceLayout;
}): TraceLayout {
  const threadLayoutMapByRef = new Map<ThreadRef, ThreadLayout>();
  for (const [threadRef, threadLayout] of params.focusedLayout.threadLayoutMapByRef) {
    threadLayoutMapByRef.set(
      threadRef,
      preserveFocusedSourceSpanLaneMap({
        focusedThreadLayout: threadLayout,
        sourceLayout: params.sourceLayout
      })
    );
  }

  const processLayouts = params.focusedLayout.processLayouts.map(processLayout => ({
    ...processLayout,
    threadLayouts: processLayout.threadLayouts.map(threadLayout =>
      preserveFocusedSourceSpanLaneMap({
        focusedThreadLayout: threadLayout,
        sourceLayout: params.sourceLayout
      })
    )
  }));

  return {
    ...params.focusedLayout,
    threadLayoutMapByRef,
    processLayouts,
    processLayoutMapByRef: buildTraceLayoutProcessLayoutMapByRef(processLayouts)
  };
}

/** Keeps one focused thread layout's source span lane map without crossing thread refs. */
function preserveFocusedSourceSpanLaneMap(params: {
  /** Focused thread layout whose selected-lane mask should be preserved. */
  focusedThreadLayout: ThreadLayout;
  /** Source full layout that owns the complete span-to-lane map. */
  sourceLayout: TraceLayout;
}): ThreadLayout {
  const threadRef = params.focusedThreadLayout.threadRef;
  if (threadRef == null) {
    return params.focusedThreadLayout;
  }
  const sourceSpanLaneMap = getFocusedSourceThreadLayout({
    traceLayout: params.sourceLayout,
    threadRef
  })?.spanLaneMap;

  return sourceSpanLaneMap
    ? {...params.focusedThreadLayout, spanLaneMap: sourceSpanLaneMap}
    : params.focusedThreadLayout;
}

/** Resolves one source thread layout from its exact runtime thread ref. */
function getFocusedSourceThreadLayout(params: {
  /** Layout that owns the source thread lane map. */
  traceLayout: TraceLayout;
  /** Canonical runtime thread ref used by ref-native layouts. */
  threadRef: ThreadRef;
}): ThreadLayout | undefined {
  return params.traceLayout.threadLayoutMapByRef.get(params.threadRef);
}

/**
 * Builds a compact layout that only keeps lanes containing the requested span refs visible.
 */
export function buildTraceLayoutForSpanRefsImpl(params: {
  /** Runtime filtered graph used as the source for selected-lane relayout. */
  traceGraph: TraceGraph;
  /** Existing layout whose vertical anchor should be preserved. */
  traceLayout: TraceLayout;
  /** Exact span refs whose lanes should remain visible. */
  spanRefs: ReadonlySet<SpanRef> | ReadonlyArray<SpanRef>;
  /** Layout settings that affect selected-lane relayout and prepared geometry derivation. */
  settings: Pick<
    TraceVisSettings,
    | 'localDependencyMode'
    | 'layoutDensity'
    | 'sortThreads'
    | 'maxVisibleLanesPerThread'
    | 'maxVisibleLanesUnlimited'
    | 'trackAggregationMode'
    | 'showEmptyProcesses'
  >;
  /** Ref-native collapse state to preserve during relayout. */
  collapseState?: TraceLayoutCollapseState;
  /** @deprecated Use `collapseState.graphs[0].collapsedProcessRefs` instead. */
  collapsedProcessIds?: ReadonlySet<string>;
  /** @deprecated Use `collapseState.graphs[0].expandedThreadRefs` instead. */
  expandedThreadIds?: ReadonlySet<TraceThreadId>;
  /** @deprecated Use `collapseState.graphs[0].collapsedThreadRefs` instead. */
  collapsedThreadIds?: ReadonlySet<TraceThreadId>;
  /** Optional timing projection recorded for later prepared geometry derivation. */
  timingKey?: string | null;
  /** Optional minimum time override recorded for later prepared geometry derivation. */
  minTimeMs?: number;
  /** Converts legacy id-based collapse state into ref-native state for this graph. */
  resolveLegacyCollapseState: (params: {
    /** Graph whose refs should back the legacy collapse state. */
    traceGraph: TraceGraph;
    /** Ref-native collapse state for this graph. */
    collapseState?: TraceLayoutCollapseState['graphs'][number];
    /** Legacy id-based collapsed process ids. */
    collapsedProcessIds?: ReadonlySet<string>;
    /** Legacy id-based expanded thread ids. */
    expandedThreadIds?: ReadonlySet<TraceThreadId>;
    /** Legacy id-based collapsed thread ids. */
    collapsedThreadIds?: ReadonlySet<TraceThreadId>;
  }) => LegacyTraceGraphCollapseState;
  /** Refreshes focused layout timing and density inputs for later prepared geometry derivation. */
  refreshGeometryInputs: (params: {
    /** Trace graph data used to resolve source timing. */
    traceGraph: TraceGraph;
    /** Prebuilt TraceGraph instance for the same graph. */
    prebuiltTraceGraph: TraceGraph;
    /** Visible graph projection for the focused process set. */
    visibleTraceGraph: TraceLayoutVisibleGraph;
    /** Compact layout whose prepared geometry inputs should be refreshed. */
    traceLayout: TraceLayout;
    /** Settings needed for dependency filtering and density-aware prepared geometry. */
    settings: Pick<TraceVisSettings, 'localDependencyMode' | 'layoutDensity'>;
    /** Optional timing projection recorded for later prepared geometry derivation. */
    timingKey?: string | null;
    /** Optional minimum time override recorded for later prepared geometry derivation. */
    minTimeMs?: number;
  }) => TraceLayout;
  /** Attaches ref indexes to a focused layout. */
  withRefIndexes: (traceLayout: TraceLayout) => TraceLayout;
}): TraceLayout {
  if (params.traceGraph.spanLayout === 'manual') {
    return params.traceLayout;
  }

  const selectedSpanRefs = toSpanRefSet(params.spanRefs);
  if (selectedSpanRefs.size === 0) {
    return params.traceLayout;
  }
  const legacyCollapseState = params.resolveLegacyCollapseState({
    traceGraph: params.traceGraph,
    collapseState: params.collapseState?.graphs[0],
    collapsedProcessIds: params.collapsedProcessIds,
    expandedThreadIds: params.expandedThreadIds,
    collapsedThreadIds: params.collapsedThreadIds
  });
  return buildTraceLayoutForSelectedLanes({
    ...params,
    collapsedProcessIds: legacyCollapseState.collapsedProcessIds,
    expandedThreadRefs: legacyCollapseState.expandedThreadRefs,
    collapsedThreadRefs: legacyCollapseState.collapsedThreadRefs,
    includedSpanRefs: selectedSpanRefs,
    shouldIncludeSpan: span => selectedSpanRefs.has(span.spanRef)
  });
}

/** Builds and aligns the compact selected-lane layout before refreshing prepared geometry inputs. */
function buildTraceLayoutForSelectedLanes(params: {
  /** Runtime filtered graph used as the source for selected-lane relayout. */
  traceGraph: TraceGraph;
  /** Existing full layout used as the vertical anchor and lane metadata source. */
  traceLayout: TraceLayout;
  /** Layout settings that affect selected-lane relayout and prepared geometry derivation. */
  settings: Pick<
    TraceVisSettings,
    | 'localDependencyMode'
    | 'layoutDensity'
    | 'sortThreads'
    | 'maxVisibleLanesPerThread'
    | 'maxVisibleLanesUnlimited'
    | 'trackAggregationMode'
    | 'showEmptyProcesses'
  >;
  /** Legacy id-based collapsed process ids. */
  collapsedProcessIds?: ReadonlySet<string>;
  /** Exact expanded thread refs. */
  expandedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Exact collapsed thread refs. */
  collapsedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Optional timing projection recorded for later prepared geometry derivation. */
  timingKey?: string | null;
  /** Optional minimum time override recorded for later prepared geometry derivation. */
  minTimeMs?: number;
  /** Exact span refs retained in the focused layout. */
  includedSpanRefs: ReadonlySet<SpanRef>;
  /** Predicate for keeping a span in the focused layout projection. */
  shouldIncludeSpan: (span: TraceLayoutLaneSpanSource) => boolean;
  /** Refreshes focused layout timing and density inputs for later prepared geometry derivation. */
  refreshGeometryInputs: (params: {
    /** Trace graph data used to resolve source timing. */
    traceGraph: TraceGraph;
    /** Prebuilt TraceGraph instance for the same graph. */
    prebuiltTraceGraph: TraceGraph;
    /** Visible graph projection for the focused process set. */
    visibleTraceGraph: TraceLayoutVisibleGraph;
    /** Compact layout whose prepared geometry inputs should be refreshed. */
    traceLayout: TraceLayout;
    /** Settings needed for dependency filtering and density-aware prepared geometry. */
    settings: Pick<TraceVisSettings, 'localDependencyMode' | 'layoutDensity'>;
    /** Optional timing projection recorded for later prepared geometry derivation. */
    timingKey?: string | null;
    /** Optional minimum time override recorded for later prepared geometry derivation. */
    minTimeMs?: number;
  }) => TraceLayout;
  /** Attaches ref indexes to a focused layout. */
  withRefIndexes: (traceLayout: TraceLayout) => TraceLayout;
}): TraceLayout {
  const focusedProjection = buildFocusedTraceLayoutProjection(params);
  const {
    visibleTraceGraph,
    laneSpansByProcessId,
    visibleLaneIndicesByThreadRef,
    combinedLaneAssignmentsByRankId
  } = focusedProjection;

  if (visibleLaneIndicesByThreadRef.size === 0) {
    return params.traceLayout;
  }

  const threadLaneLayoutMapByRef = new Map<ThreadRef, ThreadLaneMetadata>();
  for (const [threadRef, laneIndices] of visibleLaneIndicesByThreadRef) {
    const visibleLaneIndices: number[] = [];
    for (const laneIndex of laneIndices) {
      const normalizedLaneIndex = Math.floor(laneIndex);
      if (Number.isFinite(normalizedLaneIndex) && normalizedLaneIndex >= 0) {
        visibleLaneIndices.push(normalizedLaneIndex);
      }
    }
    visibleLaneIndices.sort((a, b) => a - b);
    let maxLaneIndex = 0;
    for (const laneIndex of visibleLaneIndices) {
      if (laneIndex > maxLaneIndex) {
        maxLaneIndex = laneIndex;
      }
    }
    threadLaneLayoutMapByRef.set(threadRef, {
      laneCount: maxLaneIndex + 1,
      visibleLaneIndices
    });
  }

  const {layout: compactLayout} = calculateTraceLayout({
    processes: visibleTraceGraph.processes,
    maxTimeMs: visibleTraceGraph.maxTimeMs,
    settings: {
      threadDisplayMode: 'all',
      selectedThreadNames: [],
      sortThreads: params.settings.sortThreads,
      maxVisibleLanesPerThread: params.settings.maxVisibleLanesPerThread,
      maxVisibleLanesUnlimited: params.settings.maxVisibleLanesUnlimited,
      trackAggregationMode: params.settings.trackAggregationMode,
      showEmptyProcesses: params.settings.showEmptyProcesses
    },
    layoutConfiguration: getLayoutDensityPreset(params.settings.layoutDensity),
    collapsedProcessIds: params.collapsedProcessIds,
    expandedThreadRefs: params.expandedThreadRefs,
    collapsedThreadRefs: params.collapsedThreadRefs,
    threadLaneLayoutMapByRef,
    hideStreamsWithoutLaneMetadata: true,
    combinedLaneAssignmentsByRankId,
    traceGraph: params.traceGraph,
    getSpansForProcess: processId => laneSpansByProcessId[processId] ?? [],
    getLocalDependenciesForProcess: () => [],
    getLaneSpansForProcess: processId => laneSpansByProcessId[processId] ?? [],
    getLaneLocalDependenciesForProcess: () => []
  });
  const compactLayoutWithSourceLaneMaps = preserveFocusedSourceSpanLaneMaps({
    focusedLayout: compactLayout,
    sourceLayout: params.traceLayout
  });

  const firstVisibleRankIndex = compactLayoutWithSourceLaneMaps.processLayouts.findIndex(
    rankLayout => rankLayout?.threadLayouts.some(threadLayout => threadLayout.visible)
  );
  if (firstVisibleRankIndex === -1) {
    return params.traceLayout;
  }

  const anchorLayout = compactLayoutWithSourceLaneMaps.processLayouts[firstVisibleRankIndex];
  const anchorProcess = visibleTraceGraph.processes[firstVisibleRankIndex];
  const anchorYOffset = anchorProcess
    ? findFocusedSourceProcessLayoutYOffset({
        traceLayout: params.traceLayout,
        processRef: anchorProcess.processRef
      })
    : undefined;
  const rankDelta = (anchorYOffset ?? anchorLayout?.yOffset ?? 0) - (anchorLayout?.yOffset ?? 0);
  const alignedLayout = applyRankDeltas({
    layout: compactLayoutWithSourceLaneMaps,
    traceGraph: visibleTraceGraph,
    rankDeltas: compactLayoutWithSourceLaneMaps.processLayouts.map(() => rankDelta),
    trackAggregationMode: params.settings.trackAggregationMode
  });

  const refreshedLayout = params.refreshGeometryInputs({
    traceGraph: params.traceGraph,
    prebuiltTraceGraph: params.traceGraph,
    visibleTraceGraph,
    traceLayout: alignedLayout,
    settings: {
      localDependencyMode: params.settings.localDependencyMode,
      layoutDensity: params.settings.layoutDensity
    },
    timingKey: params.timingKey,
    minTimeMs: params.minTimeMs
  });
  return params.withRefIndexes({
    ...refreshedLayout,
    renderRows: buildTraceLayoutRows({
      traceGraph: visibleTraceGraph,
      processLayouts: refreshedLayout.processLayouts
    }),
    globalEventRow: params.traceLayout.globalEventRow,
    minimapLayout: params.traceLayout.minimapLayout,
    expandedBounds: params.traceLayout.expandedBounds
  } satisfies TraceLayout);
}
