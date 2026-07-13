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
  buildTraceLayoutRows,
  getTraceLayoutProcessLayoutByRef,
  getTraceLayoutSpanLaneIndex,
  getTraceLayoutSpanVisibility
} from './trace-layout';

import type {TraceGraph} from '../trace-graph/trace-graph';
import type {ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef} from '../trace-graph/trace-types';
import type {
  CombinedRankLaneAssignmentOverride,
  TraceLayoutLaneSpanSource
} from './trace-geometry-layout-common';
import type {
  ThreadLaneMetadata,
  TraceLayout,
  TraceLayoutSpanLaneAssignment,
  TraceLayoutVisibleProcessMetadata
} from './trace-layout';

/** Ref-native collapse state resolved by the public layout boundary for selected-lane internals. */
type ResolvedFocusedTraceGraphCollapseState = {
  /** Process ids derived from exact collapsed process refs. */
  readonly collapsedProcessIds?: ReadonlySet<string>;
  /** Exact expanded thread refs. */
  readonly expandedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Exact collapsed thread refs. */
  readonly collapsedThreadRefs?: ReadonlySet<ThreadRef>;
};

/** Selected-lane graph projection assembled before compact layout calculation. */
type FocusedTraceLayoutProjection = {
  /** Selected-process metadata used by the compact focused relayout. */
  readonly processes: readonly TraceLayoutVisibleProcessMetadata[];
  /** Selected lane spans keyed by owning process id. */
  readonly laneSpansByProcessId: Readonly<Record<string, readonly TraceLayoutLaneSpanSource[]>>;
  /** Lane indices that should remain visible keyed by canonical runtime thread ref. */
  readonly visibleLaneIndicesByThreadRef: ReadonlyMap<ThreadRef, ReadonlySet<number>>;
  /** Preserved source lane assignments keyed by canonical runtime thread ref. */
  readonly spanLaneAssignmentsByThreadRef: ReadonlyMap<
    ThreadRef,
    readonly TraceLayoutSpanLaneAssignment[]
  >;
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
  const spanLaneAssignmentsByThreadRef = new Map<ThreadRef, TraceLayoutSpanLaneAssignment[]>();

  for (const spanRef of params.includedSpanRefs) {
    const visibility = getTraceLayoutSpanVisibility({
      traceLayout: params.traceLayout,
      spanRef
    });
    if ((visibility && !visibility.visible) || !params.traceGraph.isSpanVisible(spanRef)) {
      continue;
    }
    const geometrySource = params.traceGraph.getSpanGeometrySource(
      spanRef,
      params.traceLayout.layoutConfiguration?.timingKey ?? null
    );
    if (!geometrySource) {
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
      processRef: geometrySource.processRef,
      threadRef,
      spanId: geometrySource.spanId,
      threadId: geometrySource.threadId,
      primaryTimingKey: geometrySource.primaryTimingKey,
      timings: geometrySource.timings,
      traceAffinityKey:
        (params.traceGraph.getSpanAttribute(spanRef, ['traceId']) as
          | string
          | number
          | bigint
          | undefined) ??
        (params.traceGraph.getSpanAttribute(spanRef, ['trace_id']) as
          | string
          | number
          | bigint
          | undefined)
    } satisfies TraceLayoutLaneSpanSource;
    if (!params.shouldIncludeSpan(span)) {
      continue;
    }
    const processIndex = getProcessRefIndex(processRef);
    const rawProcess = processIndex >= 0 ? params.traceGraph.processes[processIndex] : null;
    const ownerRefs = params.traceGraph.getSpanOwnerRefs(spanRef);
    const processSource =
      ownerRefs?.processRef == null
        ? null
        : params.traceGraph.getProcessSourceByRef(ownerRefs.processRef);
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

    const laneSpans = laneSpansByProcessId[rawProcess.processId] ?? [];
    laneSpansByProcessId[rawProcess.processId] = laneSpans;
    laneSpans.push(span);

    const laneIndices = visibleLaneIndicesByThreadRef.get(threadRef) ?? new Set<number>();
    visibleLaneIndicesByThreadRef.set(threadRef, laneIndices);
    const existingLaneIndex = getTraceLayoutSpanLaneIndex(params.traceLayout, span.spanRef);
    if (existingLaneIndex != null) {
      const spanLaneAssignments = spanLaneAssignmentsByThreadRef.get(threadRef) ?? [];
      spanLaneAssignmentsByThreadRef.set(threadRef, spanLaneAssignments);
      spanLaneAssignments.push({
        spanRef: span.spanRef,
        laneIndex: existingLaneIndex
      });
    }
    laneIndices.add(
      typeof existingLaneIndex === 'number' && Number.isFinite(existingLaneIndex)
        ? Math.max(0, Math.floor(existingLaneIndex))
        : getLaneIndexFromUserData({
            lane: params.traceGraph.getSpanAttribute(spanRef, ['lane']) as number | undefined
          })
    );
  }

  const processes = sortVisibleTraceLayoutProcessesByProcessOrder([
    ...processMetadataById.values()
  ]);

  return {
    processes,
    laneSpansByProcessId,
    visibleLaneIndicesByThreadRef,
    spanLaneAssignmentsByThreadRef,
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
    const spanLaneAssignments: TraceLayoutSpanLaneAssignment[] = [];
    let maxLane = -1;
    for (const span of spans) {
      if (span.threadRef == null) {
        continue;
      }
      const sourceLaneIndex = getTraceLayoutSpanLaneIndex(params.traceLayout, span.spanRef);
      if (typeof sourceLaneIndex !== 'number' || !Number.isFinite(sourceLaneIndex)) {
        continue;
      }
      const laneIndex = Math.max(0, Math.floor(sourceLaneIndex));
      spanLaneAssignments.push({
        spanRef: span.spanRef,
        laneIndex
      });
      if (laneIndex > maxLane) {
        maxLane = laneIndex;
      }
    }
    if (spanLaneAssignments.length === 0) {
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
      spanLaneAssignments,
      overflowSpanCount: countOverflowSpans(
        spanLaneAssignments,
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
 * Keeps source generated lane columns while focused visible-lane masks choose rendered lanes.
 */
function preserveFocusedSourceSpanLaneColumns(params: {
  /** Focused layout whose visible-lane masks should be preserved. */
  focusedLayout: TraceLayout;
  /** Source full layout that owns complete generated lane lookup. */
  sourceLayout: TraceLayout;
}): TraceLayout {
  return params.sourceLayout.spanLaneColumnsByChunkIndex
    ? {
        ...params.focusedLayout,
        spanLaneColumnsByChunkIndex: params.sourceLayout.spanLaneColumnsByChunkIndex
      }
    : params.focusedLayout;
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
    | 'sameProcessDependencyMode'
    | 'layoutDensity'
    | 'sortThreads'
    | 'maxVisibleLanesPerThread'
    | 'maxVisibleLanesUnlimited'
    | 'trackAggregationMode'
    | 'showEmptyProcesses'
  >;
  /** Collapse refs already resolved by the public ref-native layout boundary. */
  collapseState?: ResolvedFocusedTraceGraphCollapseState;
  /** Optional timing projection recorded for later prepared geometry derivation. */
  timingKey?: string | null;
  /** Optional minimum time override recorded for later prepared geometry derivation. */
  minTimeMs?: number;
  /** Refreshes focused layout timing and density inputs for later prepared geometry derivation. */
  refreshGeometryInputs: (params: {
    /** Canonical runtime graph used to resolve source timing. */
    traceGraph: TraceGraph;
    /** Compact layout whose prepared geometry inputs should be refreshed. */
    traceLayout: TraceLayout;
    /** Settings needed for dependency filtering and density-aware prepared geometry. */
    settings: Pick<TraceVisSettings, 'sameProcessDependencyMode' | 'layoutDensity'>;
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
  return buildTraceLayoutForSelectedLanes({
    ...params,
    collapsedProcessIds: params.collapseState?.collapsedProcessIds,
    expandedThreadRefs: params.collapseState?.expandedThreadRefs,
    collapsedThreadRefs: params.collapseState?.collapsedThreadRefs,
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
    | 'sameProcessDependencyMode'
    | 'layoutDensity'
    | 'sortThreads'
    | 'maxVisibleLanesPerThread'
    | 'maxVisibleLanesUnlimited'
    | 'trackAggregationMode'
    | 'showEmptyProcesses'
  >;
  /** Process ids derived from exact collapsed process refs. */
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
    /** Canonical runtime graph used to resolve source timing. */
    traceGraph: TraceGraph;
    /** Compact layout whose prepared geometry inputs should be refreshed. */
    traceLayout: TraceLayout;
    /** Settings needed for dependency filtering and density-aware prepared geometry. */
    settings: Pick<TraceVisSettings, 'sameProcessDependencyMode' | 'layoutDensity'>;
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
    processes,
    laneSpansByProcessId,
    visibleLaneIndicesByThreadRef,
    spanLaneAssignmentsByThreadRef,
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
      spanLaneAssignments: spanLaneAssignmentsByThreadRef.get(threadRef),
      visibleLaneIndices
    });
  }

  const {layout: compactLayout} = calculateTraceLayout({
    processes,
    maxTimeMs: params.traceGraph.maxTimeMs,
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
    getLaneSpansForProcess: processId => laneSpansByProcessId[processId] ?? [],
    getLaneSameProcessDependenciesForProcess: () => []
  });
  const compactLayoutWithSourceLaneColumns = preserveFocusedSourceSpanLaneColumns({
    focusedLayout: compactLayout,
    sourceLayout: params.traceLayout
  });
  const firstVisibleRankIndex = compactLayoutWithSourceLaneColumns.processLayouts.findIndex(
    rankLayout => rankLayout?.threadLayouts.some(threadLayout => threadLayout.visible)
  );
  if (firstVisibleRankIndex === -1) {
    return params.traceLayout;
  }

  const anchorLayout = compactLayoutWithSourceLaneColumns.processLayouts[firstVisibleRankIndex];
  const anchorProcess = processes[firstVisibleRankIndex];
  const anchorYOffset = anchorProcess
    ? findFocusedSourceProcessLayoutYOffset({
        traceLayout: params.traceLayout,
        processRef: anchorProcess.processRef
      })
    : undefined;
  const rankDelta = (anchorYOffset ?? anchorLayout?.yOffset ?? 0) - (anchorLayout?.yOffset ?? 0);
  const alignedLayout = applyRankDeltas({
    layout: compactLayoutWithSourceLaneColumns,
    processes,
    rankDeltas: compactLayoutWithSourceLaneColumns.processLayouts.map(() => rankDelta),
    trackAggregationMode: params.settings.trackAggregationMode
  });

  const refreshedLayout = params.refreshGeometryInputs({
    traceGraph: params.traceGraph,
    traceLayout: alignedLayout,
    settings: {
      sameProcessDependencyMode: params.settings.sameProcessDependencyMode,
      layoutDensity: params.settings.layoutDensity
    },
    timingKey: params.timingKey,
    minTimeMs: params.minTimeMs
  });
  return params.withRefIndexes({
    ...refreshedLayout,
    renderRows: buildTraceLayoutRows({
      processes,
      processLayouts: refreshedLayout.processLayouts
    }),
    globalEventRow: params.traceLayout.globalEventRow,
    minimapLayout: params.traceLayout.minimapLayout
  } satisfies TraceLayout);
}
