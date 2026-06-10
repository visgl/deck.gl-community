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
import {buildTraceLayoutRows} from './trace-layout';

import type {TraceGraph} from '../trace-graph/trace-graph';
import type {ProcessRef} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef, TraceSpanId, TraceThreadId} from '../trace-graph/trace-types';
import type {
  CombinedRankLaneAssignmentOverride,
  TraceLayoutLaneBlockSource
} from './trace-geometry-layout-common';
import type {
  ThreadLaneMetadata,
  ThreadLayout,
  TraceLayout,
  TraceLayoutCollapseState,
  TraceLayoutVisibleGraph,
  TraceLayoutVisibleProcessMetadata
} from './trace-layout';

/** Id-keyed collapse state consumed by selected-lane relayout internals. */
type ResolvedTraceGraphCollapseState = {
  /** Collapsed process ids. */
  readonly collapsedProcessIds?: ReadonlySet<string>;
  /** Expanded thread ids. */
  readonly expandedThreadIds?: ReadonlySet<TraceThreadId>;
  /** Collapsed thread ids. */
  readonly collapsedThreadIds?: ReadonlySet<TraceThreadId>;
};

/** Selected-lane graph projection assembled before compact layout calculation. */
type FocusedTraceLayoutProjection = {
  /** Selected-process visible graph used by the compact focused relayout. */
  readonly visibleTraceGraph: TraceLayoutVisibleGraph;
  /** Selected lane blocks keyed by owning process id. */
  readonly laneBlocksByProcessId: Readonly<Record<string, readonly TraceLayoutLaneBlockSource[]>>;
  /** Selected block ids keyed by owning process id for focused geometry filtering. */
  readonly includedBlockIdsByProcessId: Readonly<Record<string, ReadonlySet<TraceSpanId>>>;
  /** Lane indices that should remain visible keyed by process-local thread id. */
  readonly visibleLaneIndicesByStream: ReadonlyMap<TraceThreadId, ReadonlySet<number>>;
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
  shouldIncludeBlock: (block: TraceLayoutLaneBlockSource) => boolean;
}): FocusedTraceLayoutProjection {
  const processMetadataById = new Map<string, TraceLayoutVisibleProcessMetadata>();
  const laneBlocksByProcessId: Record<string, TraceLayoutLaneBlockSource[]> = {};
  const includedBlockIdsByProcessId: Record<string, Set<TraceSpanId>> = {};
  const visibleLaneIndicesByStream = new Map<TraceThreadId, Set<number>>();

  for (const spanRef of params.includedSpanRefs) {
    const visibility = params.traceLayout.spanVisibilityMapBySpanRef?.get(spanRef);
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
    const block = {
      spanRef,
      spanId: displaySource.spanId,
      threadId: displaySource.threadId,
      primaryTimingKey: displaySource.primaryTimingKey,
      timings: displaySource.timings,
      userData: displaySource.userData
    } satisfies TraceLayoutLaneBlockSource;
    if (!params.shouldIncludeBlock(block)) {
      continue;
    }
    const processRef = params.traceGraph.getProcessRefBySpanRef(spanRef);
    if (processRef == null) {
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
      threadMap: rawProcess.threadMap,
      userData: processSource.userData
    });

    laneBlocksByProcessId[rawProcess.processId] ??= [];
    laneBlocksByProcessId[rawProcess.processId].push(block);
    includedBlockIdsByProcessId[rawProcess.processId] ??= new Set();
    includedBlockIdsByProcessId[rawProcess.processId].add(block.spanId);

    const laneIndices = visibleLaneIndicesByStream.get(block.threadId) ?? new Set<number>();
    visibleLaneIndicesByStream.set(block.threadId, laneIndices);
    const existingLaneIndex = params.traceLayout.threadLayoutMap[block.threadId]?.spanLaneMap?.get(
      block.spanRef
    );
    laneIndices.add(
      typeof existingLaneIndex === 'number' && Number.isFinite(existingLaneIndex)
        ? Math.max(0, Math.floor(existingLaneIndex))
        : getLaneIndexFromUserData(block.userData as {lane?: number} | undefined)
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
    laneBlocksByProcessId,
    includedBlockIdsByProcessId,
    visibleLaneIndicesByStream,
    combinedLaneAssignmentsByRankId: buildFocusedCombinedLaneAssignmentsByRankId({
      laneBlocksByProcessId,
      settings: params.settings,
      traceLayout: params.traceLayout
    })
  };
}

/**
 * Builds preserved combined-thread lane assignments for focused relayouts from selected blocks.
 */
function buildFocusedCombinedLaneAssignmentsByRankId(params: {
  laneBlocksByProcessId: Readonly<Record<string, readonly TraceLayoutLaneBlockSource[]>>;
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
  for (const [processId, blocks] of Object.entries(params.laneBlocksByProcessId)) {
    const spanLaneMap = new Map<SpanRef, number>();
    let maxLane = -1;
    for (const block of blocks) {
      const sourceLaneIndex = params.traceLayout.threadLayoutMap[block.threadId]?.spanLaneMap?.get(
        block.spanRef
      );
      if (typeof sourceLaneIndex !== 'number' || !Number.isFinite(sourceLaneIndex)) {
        continue;
      }
      const laneIndex = Math.max(0, Math.floor(sourceLaneIndex));
      spanLaneMap.set(block.spanRef, laneIndex);
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
  processId: string;
  processRef?: ProcessRef;
}): number | undefined {
  const sourceRow = params.traceLayout.renderRows.find(row =>
    params.processRef != null
      ? row.processRef === params.processRef
      : row.processId === params.processId
  );
  return sourceRow ? params.traceLayout.processLayouts[sourceRow.rankIndex]?.yOffset : undefined;
}

/**
 * Keeps full source span-to-lane lookup metadata on focused layouts while the focused
 * `visibleLaneIndices` mask controls which lanes are actually rendered.
 */
function preserveFocusedSourceSpanLaneMaps(params: {
  focusedLayout: TraceLayout;
  sourceLayout: TraceLayout;
}): TraceLayout {
  const threadLayoutMap = Object.fromEntries(
    Object.entries(params.focusedLayout.threadLayoutMap).map(([threadId, threadLayout]) => {
      const sourceSpanLaneMap =
        params.sourceLayout.threadLayoutMap[threadId as TraceThreadId]?.spanLaneMap;
      return [
        threadId,
        sourceSpanLaneMap ? {...threadLayout, spanLaneMap: sourceSpanLaneMap} : threadLayout
      ] as const;
    })
  ) as Record<TraceThreadId, ThreadLayout>;

  return {
    ...params.focusedLayout,
    threadLayoutMap,
    processLayouts: params.focusedLayout.processLayouts.map(processLayout => ({
      ...processLayout,
      threadLayouts: processLayout.threadLayouts.map(threadLayout => {
        const threadId = threadLayout.threadId;
        if (threadId == null) {
          return threadLayout;
        }
        return threadLayoutMap[threadId] ?? threadLayout;
      })
    }))
  };
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
  /** Layout settings that affect selected-lane relayout and geometry rebuilds. */
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
  /** Optional timing projection used when rebuilding block geometry. */
  timingKey?: string | null;
  /** Optional minimum time override used when rebuilding block geometry. */
  minTimeMs?: number;
  /** Resolves ref-native collapse state into id-keyed layout internals for this graph. */
  resolveCollapseState: (params: {
    /** Graph whose refs should resolve the collapse state. */
    traceGraph: TraceGraph;
    /** Ref-native collapse state for this graph. */
    collapseState?: TraceLayoutCollapseState['graphs'][number];
  }) => ResolvedTraceGraphCollapseState;
  /** Rebuilds focused span and dependency geometry for the compact layout. */
  rebuildGeometry: (params: {
    /** Trace graph data used to resolve source geometry. */
    traceGraph: TraceGraph;
    /** Prebuilt TraceGraph instance for the same graph. */
    prebuiltTraceGraph: TraceGraph;
    /** Visible graph projection for the focused process set. */
    visibleTraceGraph: TraceLayoutVisibleGraph;
    /** Compact layout whose geometry should be rebuilt. */
    traceLayout: TraceLayout;
    /** Settings needed for dependency filtering and density-aware geometry. */
    settings: Pick<TraceVisSettings, 'localDependencyMode' | 'layoutDensity'>;
    /** Optional timing projection used when rebuilding block geometry. */
    timingKey?: string | null;
    /** Optional minimum time override used when rebuilding block geometry. */
    minTimeMs?: number;
    /** Exact visible block ids retained in the focused geometry. */
    includedBlockIdsByProcessId: Readonly<Record<string, ReadonlySet<TraceSpanId>>>;
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
  const resolvedCollapseState = params.resolveCollapseState({
    traceGraph: params.traceGraph,
    collapseState: params.collapseState?.graphs[0]
  });
  return buildTraceLayoutForSelectedLanes({
    ...params,
    collapsedProcessIds: resolvedCollapseState.collapsedProcessIds,
    expandedThreadIds: resolvedCollapseState.expandedThreadIds,
    collapsedThreadIds: resolvedCollapseState.collapsedThreadIds,
    includedSpanRefs: selectedSpanRefs,
    shouldIncludeBlock: block => selectedSpanRefs.has(block.spanRef)
  });
}

/** Builds and aligns the compact selected-lane layout before rebuilding its geometry. */
function buildTraceLayoutForSelectedLanes(params: {
  /** Runtime filtered graph used as the source for selected-lane relayout. */
  traceGraph: TraceGraph;
  /** Existing full layout used as the vertical anchor and lane metadata source. */
  traceLayout: TraceLayout;
  /** Layout settings that affect selected-lane relayout and geometry rebuilds. */
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
  /** Legacy id-based expanded thread ids. */
  expandedThreadIds?: ReadonlySet<TraceThreadId>;
  /** Legacy id-based collapsed thread ids. */
  collapsedThreadIds?: ReadonlySet<TraceThreadId>;
  /** Optional timing projection used when rebuilding block geometry. */
  timingKey?: string | null;
  /** Optional minimum time override used when rebuilding block geometry. */
  minTimeMs?: number;
  /** Exact span refs retained in the focused layout. */
  includedSpanRefs: ReadonlySet<SpanRef>;
  /** Predicate for keeping a block in the focused layout projection. */
  shouldIncludeBlock: (block: TraceLayoutLaneBlockSource) => boolean;
  /** Rebuilds focused span and dependency geometry for the compact layout. */
  rebuildGeometry: (params: {
    /** Trace graph data used to resolve source geometry. */
    traceGraph: TraceGraph;
    /** Prebuilt TraceGraph instance for the same graph. */
    prebuiltTraceGraph: TraceGraph;
    /** Visible graph projection for the focused process set. */
    visibleTraceGraph: TraceLayoutVisibleGraph;
    /** Compact layout whose geometry should be rebuilt. */
    traceLayout: TraceLayout;
    /** Settings needed for dependency filtering and density-aware geometry. */
    settings: Pick<TraceVisSettings, 'localDependencyMode' | 'layoutDensity'>;
    /** Optional timing projection used when rebuilding block geometry. */
    timingKey?: string | null;
    /** Optional minimum time override used when rebuilding block geometry. */
    minTimeMs?: number;
    /** Exact visible block ids retained in the focused geometry. */
    includedBlockIdsByProcessId: Readonly<Record<string, ReadonlySet<TraceSpanId>>>;
  }) => TraceLayout;
  /** Attaches ref indexes to a focused layout. */
  withRefIndexes: (traceLayout: TraceLayout) => TraceLayout;
}): TraceLayout {
  const focusedProjection = buildFocusedTraceLayoutProjection(params);
  const {
    visibleTraceGraph,
    laneBlocksByProcessId,
    includedBlockIdsByProcessId,
    visibleLaneIndicesByStream,
    combinedLaneAssignmentsByRankId
  } = focusedProjection;

  if (visibleLaneIndicesByStream.size === 0) {
    return params.traceLayout;
  }

  const streamLaneLayoutMap: Record<TraceThreadId, ThreadLaneMetadata> = {};
  for (const [streamId, laneIndices] of visibleLaneIndicesByStream) {
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
    streamLaneLayoutMap[streamId] = {
      laneCount: maxLaneIndex + 1,
      visibleLaneIndices
    };
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
    expandedStreamIds: params.expandedThreadIds,
    collapsedStreamIds: params.collapsedThreadIds,
    streamLaneLayoutMap,
    hideStreamsWithoutLaneMetadata: true,
    combinedLaneAssignmentsByRankId,
    traceGraph: params.traceGraph,
    getSpansForProcess: processId => laneBlocksByProcessId[processId] ?? [],
    getLocalDependenciesForProcess: () => [],
    getLaneBlocksForProcess: processId => laneBlocksByProcessId[processId] ?? [],
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
        processId: anchorProcess.processId,
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

  const rebuiltLayout = params.rebuildGeometry({
    traceGraph: params.traceGraph,
    prebuiltTraceGraph: params.traceGraph,
    visibleTraceGraph,
    traceLayout: alignedLayout,
    settings: {
      localDependencyMode: params.settings.localDependencyMode,
      layoutDensity: params.settings.layoutDensity
    },
    timingKey: params.timingKey,
    minTimeMs: params.minTimeMs,
    includedBlockIdsByProcessId
  });
  return params.withRefIndexes({
    ...rebuiltLayout,
    renderRows: buildTraceLayoutRows({
      traceGraph: visibleTraceGraph,
      processLayouts: rebuiltLayout.processLayouts
    }),
    globalEventRow: params.traceLayout.globalEventRow,
    minimapLayout: params.traceLayout.minimapLayout,
    expandedBounds: params.traceLayout.expandedBounds
  } satisfies TraceLayout);
}
