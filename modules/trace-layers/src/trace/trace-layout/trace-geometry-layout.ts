import {getHeapUsageProbeFields, log} from '../log';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {TraceGraph} from '../trace-graph/trace-graph';
import {getProcessRefIndex} from '../trace-graph/trace-id-encoder';
import {compareNumericSortStrings} from '../utils/numeric-sort';
import {buildHierarchicalTrackLayout} from './hierarchical-track-layout';
import {visitKahnLaneAssignments} from './lane-layout';
import {
  applyRankDeltas,
  buildExplicitParentSpanMap,
  buildThreadOverflowLabelForThreads,
  calculateTraceLayout,
  computeInterleavedRankDeltas,
  computeRankBackgroundPolygon,
  computeRankSeparatorLineInfinite,
  computeRankTerminalSeparatorLineInfinite,
  computeSequentialRankDeltas,
  countOverflowSpans,
  getCollapsedProcessMinimumRankSpacing,
  getLaneAssignmentMode,
  getLayoutDensityPreset,
  getManualSpanLayoutGeometry,
  getProcessCollapsedActivityY,
  getProcessContentStartY,
  getProcessLabelY,
  getTraceLaneAffinityKey,
  hasParentHintsForSpans,
  hasTraceLaneAffinity,
  hasVisibleRankSpanContent,
  normalizeLaneCounts,
  streamIsVisible
} from './trace-geometry-layout-common';
import {buildTraceLayoutForSpanRefsImpl} from './trace-geometry-layout-focused';
import {
  buildThreadLayoutLookup,
  buildVisibleTraceGraph,
  buildVisibleTraceGraphForProcess,
  computeTraceLayoutBounds,
  getObjectIdentityId,
  getProcessSpanChunkCacheKey,
  getVisibleBlocksForProcess,
  getVisibleLaneBlocksForProcess,
  getVisibleLaneLocalDependenciesForProcess,
  getVisibleLocalDependenciesForProcess,
  resolveGeometryTimingKey
} from './trace-geometry-layout-helpers';
import {populateTraceLayoutGeometry} from './trace-geometry-layout-rebuild';
import {buildTraceLayoutOverflowLabels, buildTraceLayoutRows} from './trace-layout';

import type {TraceGraphData} from '../ingestion/arrow-trace';
import type {ThreadRef} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TrackAggregationMode
} from '../trace-graph/trace-types';
import type {
  HierarchicalTrackDescriptor,
  HierarchicalTrackLayoutResult
} from './hierarchical-track-layout';
import type {TraceLayoutMode, TraceSpanGeometrySource} from './trace-geometry-layout-common';
import type {
  ProcessLayout,
  ThreadLaneMetadata,
  ThreadLayout,
  TraceGraphCollapseState,
  TraceLayout,
  TraceLayoutBounds,
  TraceLayoutCollapseState,
  TraceLayoutVisibleGraph,
  TraceLayoutVisibleProcessMetadata
} from './trace-layout';

export type {TraceLayoutMode, SpanBoundingBox} from './trace-geometry-layout-common';
export {
  buildTraceCrossRankDependencyGeometries,
  buildTraceLocalDependencyGeometries,
  getSpanBoundingBox,
  getLocalDependencyPathFlat
} from './trace-geometry-layout-common';

type ProcessRelativeLayoutArtifact = {
  /** Reuse fingerprint for the process-local layout artifact. */
  readonly reuseKey: string;
  /** Single-process relative layout with y offsets anchored at process start. */
  readonly layout: TraceLayout;
  /** Process-local spacing used by graph-level delta composition. */
  readonly rankSpacing: number;
};

type ResolvedTraceGraphCollapseState = {
  readonly collapsedProcessIds?: ReadonlySet<string>;
  readonly expandedThreadIds?: ReadonlySet<TraceThreadId>;
  readonly collapsedThreadIds?: ReadonlySet<TraceThreadId>;
};

type ProcessRelativeLayoutEntry = {
  /** Rank id that owns the cached process-local artifacts. */
  readonly processId: string;
  /** Expanded-state process-local layout artifact. */
  readonly expanded: ProcessRelativeLayoutArtifact;
  /** Collapsed-state process-local layout artifact. */
  readonly collapsed: ProcessRelativeLayoutArtifact;
};

type TraceLayoutReuseState = {
  /** Per-rank process-local layout artifacts carried forward for reuse. */
  readonly entriesByProcessId: Readonly<Record<string, ProcessRelativeLayoutEntry>>;
};

type BuildProcessRelativeLayoutArtifactsResult = {
  /** Process-local expanded artifacts in visible process order. */
  readonly expandedArtifacts: readonly ProcessRelativeLayoutArtifact[];
  /** Process-local collapsed artifacts in visible process order. */
  readonly collapsedArtifacts: readonly ProcessRelativeLayoutArtifact[];
  /** Per-rank reuse entries attached to the final TraceLayout. */
  readonly entriesByProcessId: Readonly<Record<string, ProcessRelativeLayoutEntry>>;
  /** Number of process-local expanded artifacts reused from the previous layout. */
  readonly reusedExpandedProcessCount: number;
  /** Number of process-local collapsed artifacts reused from the previous layout. */
  readonly reusedCollapsedProcessCount: number;
};

const TRACE_LAYOUT_REUSE_STATE = Symbol('trace-layout-reuse-state');

type TraceLayoutWithReuseState = TraceLayout & {
  [TRACE_LAYOUT_REUSE_STATE]?: TraceLayoutReuseState;
};

const DEFAULT_MINIMAP_SUMMARY_PADDING_FRACTION = 0.04;
/** Reads the internal process-relative reuse state carried by a TraceLayout instance. */
function getTraceLayoutReuseState(traceLayout?: TraceLayout): TraceLayoutReuseState | undefined {
  return (traceLayout as TraceLayoutWithReuseState | undefined)?.[TRACE_LAYOUT_REUSE_STATE];
}

/**
 * Attaches immutable process-relative reuse state to a TraceLayout instance without changing the
 * public TraceLayout contract.
 */
function attachTraceLayoutReuseState(
  traceLayout: TraceLayout,
  reuseState: TraceLayoutReuseState
): TraceLayout {
  Object.defineProperty(traceLayout, TRACE_LAYOUT_REUSE_STATE, {
    configurable: false,
    enumerable: false,
    value: reuseState,
    writable: false
  });
  return traceLayout;
}

/** Copies internal reuse state from one TraceLayout to another when rebuilding geometry only. */
function copyTraceLayoutReuseState(source: TraceLayout, target: TraceLayout): TraceLayout {
  const reuseState = getTraceLayoutReuseState(source);
  if (!reuseState) {
    return target;
  }
  return attachTraceLayoutReuseState(target, reuseState);
}

/** Attaches ref-keyed thread and geometry indexes to a TraceLayout when a TraceGraph is available. */
function withTraceLayoutRefIndexes(params: {
  traceGraph?: Readonly<TraceGraph>;
  traceLayout: TraceLayout;
}): TraceLayout {
  const {traceGraph, traceLayout} = params;
  if (!traceGraph) {
    return traceLayout;
  }

  const threadLayoutMapByRef = new Map<ThreadRef, ThreadLayout>();
  for (const row of traceLayout.renderRows) {
    if (!row || row.processRef == null) {
      continue;
    }
    const processLayout = traceLayout.processLayouts[row.rankIndex];
    if (processLayout?.threadLayouts.length === 1) {
      const combinedThreadLayout = processLayout.threadLayouts[0];
      if (!combinedThreadLayout) {
        continue;
      }
      for (const [threadIndex, threadRef] of (row.threadRefs ?? []).entries()) {
        const thread = row.threads[threadIndex];
        const hiddenThreadLayout =
          thread != null && traceLayout.threadLayoutMap[thread.threadId]?.visible === false
            ? traceLayout.threadLayoutMap[thread.threadId]
            : undefined;
        /*
         * Combined rows normally share one visible layout for every thread ref. A masked/collapsed
         * logical thread is the exception: it keeps an invisible per-thread layout so selection and
         * navigable geometry stay zero-height for that specific ref.
         */
        threadLayoutMapByRef.set(threadRef, hiddenThreadLayout ?? combinedThreadLayout);
      }
      continue;
    }

    const {layoutByThreadId, layoutByThreadRef} = buildThreadLayoutLookup(processLayout);
    for (const [threadIndex, thread] of row.threads.entries()) {
      const threadRef = row.threadRefs?.[threadIndex];
      if (threadRef == null) {
        continue;
      }
      const threadLayout =
        layoutByThreadId.get(thread.threadId) ?? layoutByThreadRef.get(threadRef);
      if (!threadLayout) {
        continue;
      }
      threadLayoutMapByRef.set(threadRef, threadLayout);
    }
  }

  return {
    ...traceLayout,
    threadLayoutMapByRef
  };
}

/** Returns the per-process lane metadata slice that affects local layout structure. */
function getVisibleThreadLaneLayoutForProcess(params: {
  traceGraph: Readonly<TraceGraph>;
  process: Readonly<TraceLayoutVisibleProcessMetadata>;
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
}): Readonly<Record<TraceThreadId, ThreadLaneMetadata>> {
  const threadLaneLayoutMap =
    params.traceGraph.getVisibleLaneLayoutInfo().threadLaneLayoutMap ?? {};
  return params.process.threads.reduce(
    (acc, thread) => {
      const laneMetadata = threadLaneLayoutMap[thread.threadId];
      const override = params.threadLaneLayoutOverrides?.[thread.threadId];
      if (laneMetadata || override) {
        acc[thread.threadId] = laneMetadata
          ? {...laneMetadata, ...override}
          : {laneCount: 1, ...override};
      }
      return acc;
    },
    {} as Record<TraceThreadId, ThreadLaneMetadata>
  );
}

/** Filters explicit per-stream expansion overrides down to one process. */
function getProcessExpandedStreamIds(params: {
  process: Readonly<TraceLayoutVisibleProcessMetadata>;
  expandedThreadIds?: ReadonlySet<TraceThreadId>;
}): ReadonlySet<TraceThreadId> | undefined {
  if (!params.expandedThreadIds || params.expandedThreadIds.size === 0) {
    return undefined;
  }
  const threadIds = new Set(params.process.threads.map(thread => thread.threadId));
  const filtered = new Set<TraceThreadId>();
  for (const streamId of params.expandedThreadIds) {
    if (threadIds.has(streamId)) {
      filtered.add(streamId);
    }
  }
  return filtered.size > 0 ? filtered : undefined;
}

/** Filters explicit per-stream collapse overrides down to one process. */
function getProcessCollapsedStreamIds(params: {
  process: Readonly<TraceLayoutVisibleProcessMetadata>;
  collapsedThreadIds?: ReadonlySet<TraceThreadId>;
}): ReadonlySet<TraceThreadId> | undefined {
  if (!params.collapsedThreadIds || params.collapsedThreadIds.size === 0) {
    return undefined;
  }
  const threadIds = new Set(params.process.threads.map(thread => thread.threadId));
  const filtered = new Set<TraceThreadId>();
  for (const streamId of params.collapsedThreadIds) {
    if (threadIds.has(streamId)) {
      filtered.add(streamId);
    }
  }
  return filtered.size > 0 ? filtered : undefined;
}

/**
 * Builds a compact process-local reuse fingerprint from graph generation and structure-affecting
 * settings without serializing visible spans or dependencies.
 */
function buildProcessRelativeLayoutReuseKey(params: {
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>;
  process: Readonly<TraceLayoutVisibleProcessMetadata>;
  settings: TrackAggregationSettings & Pick<TraceVisSettings, 'layoutDensity'>;
  isProcessCollapsed?: boolean;
  expandedThreadIds?: ReadonlySet<TraceThreadId>;
  collapsedThreadIds?: ReadonlySet<TraceThreadId>;
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
}): string {
  const processDataGeneration = buildProcessDataGenerationKey({
    visibleTraceGraph: params.visibleTraceGraph,
    process: params.process
  });
  const selectedNamesForProcessKey = buildSelectedThreadNamesForProcessKey(
    params.process,
    params.settings.selectedThreadNames
  );
  const laneMetadataByThreadId = getVisibleThreadLaneLayoutForProcess({
    traceGraph: params.visibleTraceGraph.traceGraph,
    process: params.process,
    threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
  });
  const threadSummaryKey = buildProcessThreadSummaryKey(params.process);
  const expandedStreamKey = [...(params.expandedThreadIds ?? [])].sort().join('|');
  const collapsedStreamKey = [...(params.collapsedThreadIds ?? [])].sort().join('|');
  const laneMetadataKey = buildLaneMetadataSummaryKey(laneMetadataByThreadId);

  return [
    `data:${processDataGeneration}`,
    params.process.processId,
    params.process.processRef ?? '',
    params.visibleTraceGraph.traceGraph.spanLayout,
    params.settings.trackAggregationMode,
    params.settings.layoutDensity,
    params.settings.maxVisibleLanesPerThread ?? 'default',
    params.settings.maxVisibleLanesUnlimited === false ? 'limited' : 'unlimited',
    params.settings.threadDisplayMode,
    params.settings.sortThreads ? 'sort:1' : 'sort:0',
    params.settings.showEmptyProcesses === true ? 'showEmpty:1' : 'showEmpty:0',
    `collapsed:${params.isProcessCollapsed ? 1 : 0}`,
    `selected:${selectedNamesForProcessKey}`,
    `expanded:${expandedStreamKey}`,
    `collapsedStreams:${collapsedStreamKey}`,
    `threads:${threadSummaryKey}`,
    `laneMeta:${laneMetadataKey}`
  ].join('||');
}

function buildSelectedThreadNamesForProcessKey(
  process: Readonly<TraceLayoutVisibleProcessMetadata>,
  selectedThreadNames: readonly string[] | undefined
): string {
  if (!selectedThreadNames || selectedThreadNames.length === 0) {
    return '';
  }
  const selectedStreamNameSet = new Set(selectedThreadNames);
  const selectedNamesForProcess: string[] = [];
  for (const thread of process.threads) {
    const threadName = thread.name?.trim();
    if (threadName && selectedStreamNameSet.has(threadName)) {
      selectedNamesForProcess.push(threadName);
    }
  }
  selectedNamesForProcess.sort();
  return selectedNamesForProcess.join('|');
}

function buildProcessThreadSummaryKey(
  process: Readonly<TraceLayoutVisibleProcessMetadata>
): string {
  const firstThread = process.threads[0];
  const lastThread = process.threads[process.threads.length - 1];
  return [
    process.threads.length,
    firstThread?.threadId ?? '',
    firstThread?.name ?? '',
    lastThread?.threadId ?? '',
    lastThread?.name ?? '',
    process.threadRefs?.length ?? 0,
    process.threadRefs?.[0] ?? '',
    process.threadRefs?.[process.threadRefs.length - 1] ?? ''
  ].join(':');
}

function buildLaneMetadataSummaryKey(
  laneMetadataByThreadId: Readonly<Record<TraceThreadId, ThreadLaneMetadata>>
): string {
  let entryCount = 0;
  let laneCountTotal = 0;
  let collapsedCount = 0;
  let visibleLaneIndexCount = 0;
  let firstStreamId = '';
  let lastStreamId = '';

  for (const [streamId, laneMetadata] of Object.entries(laneMetadataByThreadId)) {
    if (entryCount === 0) {
      firstStreamId = streamId;
    }
    lastStreamId = streamId;
    entryCount += 1;
    laneCountTotal += laneMetadata.laneCount;
    if (laneMetadata.isCollapsed) {
      collapsedCount += 1;
    }
    visibleLaneIndexCount += laneMetadata.visibleLaneIndices?.length ?? 0;
  }

  return [
    entryCount,
    laneCountTotal,
    collapsedCount,
    visibleLaneIndexCount,
    firstStreamId,
    lastStreamId
  ].join(':');
}

/** Builds a compact data-generation token for one process without scanning its rows. */
function buildProcessDataGenerationKey(params: {
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>;
  process: Readonly<TraceLayoutVisibleProcessMetadata>;
}): string {
  if (params.visibleTraceGraph.traceGraph.hasActiveSpanFilter()) {
    return `graph:${getObjectIdentityId(params.visibleTraceGraph.traceGraph)}`;
  }

  return (
    getProcessSpanChunkCacheKey(params.visibleTraceGraph.traceGraph, params.process.processRef) ??
    `graph:${getObjectIdentityId(params.visibleTraceGraph.traceGraph)}`
  );
}

/** Extracts one reusable process-local relative layout artifact from a single-process layout. */
function createProcessRelativeLayoutArtifact(params: {
  reuseKey: string;
  layout: TraceLayout;
  rankSpacing: number;
}): ProcessRelativeLayoutArtifact {
  return {
    reuseKey: params.reuseKey,
    layout: params.layout,
    rankSpacing: params.rankSpacing
  } satisfies ProcessRelativeLayoutArtifact;
}

/** Builds one expanded process-local relative layout artifact. */
function buildExpandedProcessRelativeLayoutArtifact(params: {
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>;
  reuseKey: string;
  settings: TrackAggregationSettings & Pick<TraceVisSettings, 'layoutDensity'>;
  traceGraph: TraceGraph;
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
}): ProcessRelativeLayoutArtifact {
  const process = params.visibleTraceGraph.processes[0]!;
  const layoutConfiguration = getLayoutDensityPreset(params.settings.layoutDensity);
  const streamLaneLayoutMap = getVisibleThreadLaneLayoutForProcess({
    traceGraph: params.traceGraph,
    process,
    threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
  });

  if (params.settings.trackAggregationMode === 'combine-threads') {
    const result = calculateTraceLayout({
      processes: params.visibleTraceGraph.processes,
      maxTimeMs: params.visibleTraceGraph.maxTimeMs,
      settings: {
        threadDisplayMode: params.settings.threadDisplayMode,
        selectedThreadNames: params.settings.selectedThreadNames,
        sortThreads: params.settings.sortThreads,
        maxVisibleLanesPerThread: params.settings.maxVisibleLanesPerThread,
        maxVisibleLanesUnlimited: params.settings.maxVisibleLanesUnlimited,
        trackAggregationMode: 'combine-threads',
        showEmptyProcesses: params.settings.showEmptyProcesses
      },
      layoutConfiguration,
      streamLaneLayoutMap,
      traceGraph: params.traceGraph as TraceGraph,
      getSpansForProcess: processId =>
        getVisibleBlocksForProcess(params.visibleTraceGraph, processId),
      getLocalDependenciesForProcess: processId =>
        getVisibleLocalDependenciesForProcess(params.visibleTraceGraph, processId),
      getLaneBlocksForProcess: processId =>
        getVisibleLaneBlocksForProcess(params.visibleTraceGraph, processId),
      getLaneLocalDependenciesForProcess: processId =>
        getVisibleLaneLocalDependenciesForProcess(params.visibleTraceGraph, processId)
    });
    return createProcessRelativeLayoutArtifact({
      reuseKey: params.reuseKey,
      layout: result.layout,
      rankSpacing: result.rankSpacings[0] ?? result.layout.processLayouts[0]?.yHeight ?? 0
    });
  }

  const layout = buildSeparateThreadExpandedLayout({
    visibleTraceGraph: params.visibleTraceGraph,
    settings: {
      threadDisplayMode: params.settings.threadDisplayMode,
      selectedThreadNames: params.settings.selectedThreadNames,
      sortThreads: params.settings.sortThreads,
      maxVisibleLanesPerThread: params.settings.maxVisibleLanesPerThread,
      maxVisibleLanesUnlimited: params.settings.maxVisibleLanesUnlimited,
      trackAggregationMode: params.settings.trackAggregationMode,
      showEmptyProcesses: params.settings.showEmptyProcesses
    },
    layoutConfiguration,
    streamLaneLayoutMap,
    traceGraph: params.traceGraph
  });
  return createProcessRelativeLayoutArtifact({
    reuseKey: params.reuseKey,
    layout,
    rankSpacing: layout.processLayouts[0]?.yHeight ?? 0
  });
}

/** Builds one collapsed process-local relative layout artifact from an expanded artifact. */
function buildCollapsedProcessRelativeLayoutArtifact(params: {
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>;
  expandedArtifact: ProcessRelativeLayoutArtifact;
  reuseKey: string;
  settings: Pick<
    TraceVisSettings,
    | 'layoutDensity'
    | 'selectedThreadNames'
    | 'sortThreads'
    | 'maxVisibleLanesPerThread'
    | 'maxVisibleLanesUnlimited'
    | 'threadDisplayMode'
    | 'trackAggregationMode'
  >;
  traceGraph: TraceGraph;
  collapsedProcessIds?: ReadonlySet<string>;
  expandedThreadIds?: ReadonlySet<TraceThreadId>;
  collapsedThreadIds?: ReadonlySet<TraceThreadId>;
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
}): ProcessRelativeLayoutArtifact {
  const process = params.visibleTraceGraph.processes[0]!;
  const usesManualSpanLayout = params.traceGraph.spanLayout === 'manual';
  const processExpandedStreamIds = usesManualSpanLayout
    ? undefined
    : getProcessExpandedStreamIds({
        process,
        expandedThreadIds: params.expandedThreadIds
      });
  const processCollapsedStreamIds = usesManualSpanLayout
    ? undefined
    : getProcessCollapsedStreamIds({
        process,
        collapsedThreadIds: params.collapsedThreadIds
      });
  const isProcessCollapsed = params.collapsedProcessIds?.has(process.processId) ?? false;
  const hasProcessSpecificOverrides =
    isProcessCollapsed ||
    (processExpandedStreamIds?.size ?? 0) > 0 ||
    (processCollapsedStreamIds?.size ?? 0) > 0;
  if (!hasProcessSpecificOverrides) {
    return {
      ...params.expandedArtifact,
      reuseKey: params.reuseKey
    } satisfies ProcessRelativeLayoutArtifact;
  }

  const collapsedState = applyTraceLayoutCollapseState({
    visibleTraceGraph: params.visibleTraceGraph,
    expandedLayout: params.expandedArtifact.layout,
    expandedRankSpacings: [params.expandedArtifact.rankSpacing],
    aggregationMode: params.settings.trackAggregationMode,
    settings: params.settings,
    collapsedProcessIds: isProcessCollapsed ? new Set([process.processId]) : undefined,
    expandedThreadIds: processExpandedStreamIds,
    collapsedThreadIds: processCollapsedStreamIds,
    threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
  });
  return createProcessRelativeLayoutArtifact({
    reuseKey: params.reuseKey,
    layout: collapsedState.traceLayout,
    rankSpacing:
      collapsedState.rankSpacings[0] ?? collapsedState.traceLayout.processLayouts[0]?.yHeight ?? 0
  });
}

/** Merges per-process relative artifacts back into one graph-local TraceLayout. */
function composeTraceLayoutFromProcessRelativeArtifacts(params: {
  /** Filtered source graph that owns the composed layout, even when there are no artifacts. */
  traceGraph: Readonly<TraceGraph>;
  /** Process-local artifacts to merge into one graph-local layout. */
  artifacts: readonly ProcessRelativeLayoutArtifact[];
  /** Extra vertical space inserted only between adjacent process rows. */
  processSeparation: number;
}): {layout: TraceLayout; rankSpacings: number[]} {
  const processLayouts: ProcessLayout[] = [];
  const rankSpacings: number[] = [];
  const threadLayoutMap: Record<TraceThreadId, ThreadLayout> = {};
  const hasFollowingVisibleArtifact = new Array<boolean>(params.artifacts.length).fill(false);
  let seenFollowingVisibleArtifact = false;
  for (let index = params.artifacts.length - 1; index >= 0; index--) {
    hasFollowingVisibleArtifact[index] = seenFollowingVisibleArtifact;
    if (params.artifacts[index]?.layout.processLayouts[0]) {
      seenFollowingVisibleArtifact = true;
    }
  }

  params.artifacts.forEach((artifact, rankIndex) => {
    const processLayout = artifact.layout.processLayouts[0];
    if (processLayout) {
      processLayouts[rankIndex] = processLayout;
    }
    const processGap =
      processLayout && hasFollowingVisibleArtifact[rankIndex] ? params.processSeparation : 0;
    rankSpacings[rankIndex] = artifact.rankSpacing + processGap;
    for (const [streamId, threadLayout] of Object.entries(artifact.layout.threadLayoutMap)) {
      threadLayoutMap[streamId as TraceThreadId] = threadLayout;
    }
  });

  return {
    layout: {
      layoutConfiguration: params.artifacts[0]?.layout.layoutConfiguration,
      traceGraph: params.traceGraph as TraceGraph,
      processLayouts,
      renderRows: [],
      threadLayoutMap,
      spanGeometryChunks: [],
      spanVisibilityMapBySpanRef: new Map(),
      localDependencyGeometryChunks: [],
      crossDependencyGeometryChunks: [],
      overflowLabels: buildTraceLayoutOverflowLabels(processLayouts),
      currentBounds: [
        [0, 0],
        [0, 0]
      ],
      expandedBounds: [
        [0, 0],
        [0, 0]
      ]
    },
    rankSpacings
  };
}

/** Converts process-relative rank spacings into cumulative within-graph Y deltas. */
function computeProcessRelativeRankDeltas(rankSpacings: readonly number[]): number[] {
  const rankDeltas: number[] = new Array(rankSpacings.length).fill(0);
  let currentOffset = 0;
  for (let index = 0; index < rankSpacings.length; index += 1) {
    rankDeltas[index] = currentOffset;
    currentOffset += rankSpacings[index] ?? 0;
  }
  return rankDeltas;
}

/** Resolves ref-native collapse input into the id-keyed internals used by layout builders. */
function resolveTraceGraphCollapseState(params: {
  traceGraph: TraceGraph;
  collapseState?: TraceGraphCollapseState;
}): ResolvedTraceGraphCollapseState {
  if (!params.collapseState) {
    return {};
  }

  const collapsedProcessIds = new Set<string>();
  const expandedThreadIds = new Set<TraceThreadId>();
  const collapsedThreadIds = new Set<TraceThreadId>();

  for (const processRef of params.collapseState.collapsedProcessRefs) {
    const processIndex = getProcessRefIndex(processRef);
    const processId = params.traceGraph.processes[processIndex]?.processId;
    if (processId) {
      collapsedProcessIds.add(processId);
    }
  }
  for (const threadRef of params.collapseState.expandedThreadRefs) {
    const streamId = params.traceGraph.getThreadSourceByRef(threadRef)?.threadId;
    if (streamId) {
      expandedThreadIds.add(streamId);
    }
  }
  for (const threadRef of params.collapseState.collapsedThreadRefs) {
    const streamId = params.traceGraph.getThreadSourceByRef(threadRef)?.threadId;
    if (streamId) {
      collapsedThreadIds.add(streamId);
    }
  }

  return {
    collapsedProcessIds: collapsedProcessIds.size > 0 ? collapsedProcessIds : undefined,
    expandedThreadIds: expandedThreadIds.size > 0 ? expandedThreadIds : undefined,
    collapsedThreadIds: collapsedThreadIds.size > 0 ? collapsedThreadIds : undefined
  };
}

/** Builds or reuses process-local relative layout artifacts for one visible graph. */
function buildProcessRelativeLayoutArtifacts(params: {
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>;
  previousLayout?: TraceLayout;
  settings: Pick<
    TraceVisSettings,
    | 'threadDisplayMode'
    | 'selectedThreadNames'
    | 'sortThreads'
    | 'maxVisibleLanesPerThread'
    | 'maxVisibleLanesUnlimited'
    | 'layoutDensity'
    | 'trackAggregationMode'
    | 'showEmptyProcesses'
  >;
  traceGraph: TraceGraph;
  collapsedProcessIds?: ReadonlySet<string>;
  expandedThreadIds?: ReadonlySet<TraceThreadId>;
  collapsedThreadIds?: ReadonlySet<TraceThreadId>;
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
}): BuildProcessRelativeLayoutArtifactsResult {
  const previousEntriesByRankId = getTraceLayoutReuseState(
    params.previousLayout
  )?.entriesByProcessId;
  const expandedArtifacts: ProcessRelativeLayoutArtifact[] = [];
  const collapsedArtifacts: ProcessRelativeLayoutArtifact[] = [];
  const entriesByProcessId: Record<string, ProcessRelativeLayoutEntry> = {};
  let reusedExpandedProcessCount = 0;
  let reusedCollapsedProcessCount = 0;
  let expandedReuseKeyDurationMs = 0;
  let collapsedReuseKeyDurationMs = 0;
  let expandedArtifactBuildDurationMs = 0;
  let collapsedArtifactBuildDurationMs = 0;
  let visibleGraphForProcessDurationMs = 0;
  let collapseSetResolutionDurationMs = 0;
  let slowestProcessDurationMs = 0;
  let slowestProcessId: string | undefined;
  let slowestProcessThreadCount = 0;
  let slowestProcessHadPreviousEntry = false;
  let slowestProcessReusedExpanded = false;
  let slowestProcessReusedCollapsed = false;
  let slowestProcessExpandedArtifactBuildDurationMs = 0;
  let slowestProcessCollapsedArtifactBuildDurationMs = 0;

  for (const process of params.visibleTraceGraph.processes) {
    const processStartTime = performance.now();
    const visibleGraphForProcessStartTime = performance.now();
    const singleProcessVisibleTraceGraph = buildVisibleTraceGraphForProcess({
      visibleTraceGraph: params.visibleTraceGraph,
      process
    });
    visibleGraphForProcessDurationMs += performance.now() - visibleGraphForProcessStartTime;
    const previousEntry = previousEntriesByRankId?.[process.processId];
    const expandedReuseKeyStartTime = performance.now();
    const expandedReuseKey = buildProcessRelativeLayoutReuseKey({
      visibleTraceGraph: singleProcessVisibleTraceGraph,
      process,
      settings: params.settings,
      threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
    });
    expandedReuseKeyDurationMs += performance.now() - expandedReuseKeyStartTime;
    let expandedArtifact: ProcessRelativeLayoutArtifact;
    let processExpandedArtifactBuildDurationMs = 0;
    if (previousEntry?.expanded.reuseKey === expandedReuseKey) {
      expandedArtifact = previousEntry.expanded;
    } else {
      const expandedArtifactBuildStartTime = performance.now();
      expandedArtifact = buildExpandedProcessRelativeLayoutArtifact({
        visibleTraceGraph: singleProcessVisibleTraceGraph,
        reuseKey: expandedReuseKey,
        settings: params.settings,
        traceGraph: params.traceGraph,
        threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
      });
      processExpandedArtifactBuildDurationMs = performance.now() - expandedArtifactBuildStartTime;
      expandedArtifactBuildDurationMs += processExpandedArtifactBuildDurationMs;
    }
    if (expandedArtifact === previousEntry?.expanded) {
      reusedExpandedProcessCount += 1;
    }

    const collapseSetResolutionStartTime = performance.now();
    const usesManualSpanLayout = params.traceGraph.spanLayout === 'manual';
    const processExpandedStreamIds = usesManualSpanLayout
      ? undefined
      : getProcessExpandedStreamIds({
          process,
          expandedThreadIds: params.expandedThreadIds
        });
    const processCollapsedStreamIds = usesManualSpanLayout
      ? undefined
      : getProcessCollapsedStreamIds({
          process,
          collapsedThreadIds: params.collapsedThreadIds
        });
    const isProcessCollapsed = params.collapsedProcessIds?.has(process.processId) ?? false;
    collapseSetResolutionDurationMs += performance.now() - collapseSetResolutionStartTime;
    const collapsedReuseKeyStartTime = performance.now();
    const collapsedReuseKey = buildProcessRelativeLayoutReuseKey({
      visibleTraceGraph: singleProcessVisibleTraceGraph,
      process,
      settings: params.settings,
      isProcessCollapsed,
      expandedThreadIds: processExpandedStreamIds,
      collapsedThreadIds: processCollapsedStreamIds,
      threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
    });
    collapsedReuseKeyDurationMs += performance.now() - collapsedReuseKeyStartTime;
    let collapsedArtifact: ProcessRelativeLayoutArtifact;
    let processCollapsedArtifactBuildDurationMs = 0;
    if (previousEntry?.collapsed.reuseKey === collapsedReuseKey) {
      collapsedArtifact = previousEntry.collapsed;
    } else if (!isProcessCollapsed && !processExpandedStreamIds && !processCollapsedStreamIds) {
      collapsedArtifact = {
        ...expandedArtifact,
        reuseKey: collapsedReuseKey
      } satisfies ProcessRelativeLayoutArtifact;
    } else {
      const collapsedArtifactBuildStartTime = performance.now();
      collapsedArtifact = buildCollapsedProcessRelativeLayoutArtifact({
        visibleTraceGraph: singleProcessVisibleTraceGraph,
        expandedArtifact,
        reuseKey: collapsedReuseKey,
        settings: params.settings,
        traceGraph: params.traceGraph,
        collapsedProcessIds: params.collapsedProcessIds,
        expandedThreadIds: params.expandedThreadIds,
        collapsedThreadIds: params.collapsedThreadIds,
        threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
      });
      processCollapsedArtifactBuildDurationMs = performance.now() - collapsedArtifactBuildStartTime;
      collapsedArtifactBuildDurationMs += processCollapsedArtifactBuildDurationMs;
    }
    if (collapsedArtifact === previousEntry?.collapsed) {
      reusedCollapsedProcessCount += 1;
    }

    expandedArtifacts.push(expandedArtifact);
    collapsedArtifacts.push(collapsedArtifact);
    entriesByProcessId[process.processId] = {
      processId: process.processId,
      expanded: expandedArtifact,
      collapsed: collapsedArtifact
    };

    const processDurationMs = performance.now() - processStartTime;
    const reusedExpanded = expandedArtifact === previousEntry?.expanded;
    const reusedCollapsed = collapsedArtifact === previousEntry?.collapsed;
    if (processDurationMs > slowestProcessDurationMs) {
      slowestProcessDurationMs = processDurationMs;
      slowestProcessId = process.processId;
      slowestProcessThreadCount = process.threads.length;
      slowestProcessHadPreviousEntry = previousEntry != null;
      slowestProcessReusedExpanded = reusedExpanded;
      slowestProcessReusedCollapsed = reusedCollapsed;
      slowestProcessExpandedArtifactBuildDurationMs = processExpandedArtifactBuildDurationMs;
      slowestProcessCollapsedArtifactBuildDurationMs = processCollapsedArtifactBuildDurationMs;
    }
    if (processDurationMs >= TRACE_LAYOUT_SLOW_PROCESS_PROBE_THRESHOLD_MS) {
      log.probe(0, 'buildProcessRelativeLayoutArtifacts slow process', {
        graphName: params.visibleTraceGraph.name,
        processId: process.processId,
        processName: process.name,
        threadCount: process.threads.length,
        hadPreviousEntry: previousEntry != null,
        reusedExpanded,
        reusedCollapsed,
        isProcessCollapsed,
        expandedThreadOverrideCount: processExpandedStreamIds?.size ?? 0,
        collapsedThreadOverrideCount: processCollapsedStreamIds?.size ?? 0,
        expandedArtifactBuildDurationMs: processExpandedArtifactBuildDurationMs,
        collapsedArtifactBuildDurationMs: processCollapsedArtifactBuildDurationMs,
        durationMs: processDurationMs
      })();
    }
  }

  log.probe(0, 'buildProcessRelativeLayoutArtifacts done', {
    graphName: params.visibleTraceGraph.name,
    processCount: params.visibleTraceGraph.processes.length,
    visibleSpanCount: params.visibleTraceGraph.traceGraph.getVisibleBlockCount(),
    reusedExpandedProcessCount,
    reusedCollapsedProcessCount,
    expandedReuseKeyDurationMs,
    collapsedReuseKeyDurationMs,
    expandedArtifactBuildDurationMs,
    collapsedArtifactBuildDurationMs,
    visibleGraphForProcessDurationMs,
    collapseSetResolutionDurationMs,
    slowestProcessId,
    slowestProcessDurationMs,
    slowestProcessThreadCount,
    slowestProcessHadPreviousEntry,
    slowestProcessReusedExpanded,
    slowestProcessReusedCollapsed,
    slowestProcessExpandedArtifactBuildDurationMs,
    slowestProcessCollapsedArtifactBuildDurationMs,
    ...getHeapUsageProbeFields()
  })();

  return {
    expandedArtifacts,
    collapsedArtifacts,
    entriesByProcessId,
    reusedExpandedProcessCount,
    reusedCollapsedProcessCount
  };
}

function canReuseTraceLayoutGeometry(params: {
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>;
  timingKey?: string | null;
  minTimeMs?: number;
}): boolean {
  if (!params.timingKey || params.minTimeMs !== undefined) {
    return false;
  }

  for (const process of params.visibleTraceGraph.processes) {
    const blocks = getVisibleBlocksForProcess(params.visibleTraceGraph, process.processId);
    for (const block of blocks) {
      if (resolveGeometryTimingKey(block, params.timingKey) !== block.primaryTimingKey) {
        return false;
      }
    }
  }
  return true;
}

function attachMinimapLayouts(params: {
  layouts: readonly TraceLayout[];
  minimapLayouts: readonly TraceLayout[];
  summaryPaddingFraction: number;
}): TraceLayout[] {
  return params.layouts.map((layout, index) => {
    const minimapTraceLayout = params.minimapLayouts[index];
    if (!minimapTraceLayout) {
      return layout;
    }

    return copyTraceLayoutReuseState(layout, {
      ...layout,
      minimapLayout: {
        traceLayout: minimapTraceLayout,
        bounds: addTraceLayoutBottomPadding(
          minimapTraceLayout.currentBounds,
          params.summaryPaddingFraction
        )
      }
    } satisfies TraceLayout);
  });
}

/**
 * Builds minimap layout projections from existing foreground layouts without re-running span lane
 * assignment or geometry construction.
 */
function buildLightweightTraceMinimapLayouts(params: {
  layouts: readonly TraceLayout[];
}): TraceLayout[] {
  return params.layouts.map(layout => {
    const processLayouts = layout.processLayouts.map(processLayout => ({
      ...processLayout,
      isCollapsed: true,
      threadLayouts: processLayout.threadLayouts.map(threadLayout => ({
        ...threadLayout,
        lanes: threadLayout.lanes
          ? {
              ...threadLayout.lanes,
              isCollapsed: true
            }
          : threadLayout.lanes
      }))
    }));
    const traceLayout: TraceLayout = {
      layoutConfiguration: layout.layoutConfiguration,
      traceGraph: layout.traceGraph,
      processLayouts,
      renderRows: layout.renderRows.map(row => ({
        ...row,
        isCollapsed: true
      })),
      globalEventRow: layout.globalEventRow,
      threadLayoutMap: layout.threadLayoutMap,
      threadLayoutMapByRef: layout.threadLayoutMapByRef,
      spanGeometryChunks: layout.spanGeometryChunks,
      spanVisibilityMapBySpanRef: layout.spanVisibilityMapBySpanRef,
      localDependencyGeometryChunks: [],
      crossDependencyGeometryChunks: [],
      overflowLabels: [],
      currentBounds: [
        [0, 0],
        [0, 0]
      ],
      expandedBounds: layout.expandedBounds
    };
    return {
      ...traceLayout,
      currentBounds: computeTraceLayoutBounds({
        traceLayout,
        minTimeMs: layout.traceGraph.minTimeMs,
        maxTimeMs: layout.traceGraph.maxTimeMs
      })
    };
  });
}

/** Adds bottom-only padding to minimap bounds so downward overview graphics do not hug the border. */
function addTraceLayoutBottomPadding(
  bounds: TraceLayoutBounds,
  paddingFractionInput: number
): TraceLayoutBounds {
  const height = bounds[1][1] - bounds[0][1];
  const paddingFraction = Number.isFinite(paddingFractionInput)
    ? Math.max(0, paddingFractionInput)
    : 0;
  const bottomPadding = Number.isFinite(height) ? Math.max(0, height * paddingFraction) : 0;
  return [
    [bounds[0][0], bounds[0][1]],
    [bounds[1][0], bounds[1][1] + bottomPadding]
  ];
}

const HIDDEN_LAYOUT_Y = -1000;

/** Returns the rendered aggregation mode after trace-owned layout constraints are applied. */
function getEffectiveTrackAggregationMode(
  traceGraph: Pick<TraceGraph, 'spanLayout'>,
  requestedMode: TrackAggregationMode
): TrackAggregationMode {
  return traceGraph.spanLayout === 'manual' ? 'separate-threads' : requestedMode;
}

/** Infers the reserved stream-band height for one manual-layout thread. */
function getManualThreadContentHeight(
  blocks: readonly TraceSpanGeometrySource[],
  minimumHeight: number
): number {
  let maxBottomY = 0;
  for (const block of blocks) {
    const manualSpanLayout = getManualSpanLayoutGeometry(block);
    if (!manualSpanLayout) {
      continue;
    }
    maxBottomY = Math.max(maxBottomY, manualSpanLayout.topY + manualSpanLayout.height);
  }
  return Math.max(minimumHeight, maxBottomY);
}

type TrackAggregationSettings = Pick<
  TraceVisSettings,
  | 'threadDisplayMode'
  | 'selectedThreadNames'
  | 'sortThreads'
  | 'maxVisibleLanesPerThread'
  | 'maxVisibleLanesUnlimited'
  | 'trackAggregationMode'
  | 'showEmptyProcesses'
>;

type SeparateThreadTrackObject =
  | {
      nodeType: 'rank';
      processId: string;
      rankIndex: number;
    }
  | {
      nodeType: 'stream';
      processId: string;
      rankIndex: number;
      threadId: TraceThreadId;
      /** Authored manual thread-band height when spans bypass generated lanes. */
      manualContentHeight?: number;
    }
  | {
      nodeType: 'laneStack';
      /** Process id that owns the stacked lane extent. */
      processId: string;
      /** Rank index that owns the stacked lane extent. */
      rankIndex: number;
      /** Thread id whose non-primary lanes are represented by this compact track. */
      threadId: TraceThreadId;
      /** Number of lanes represented by the compact track. */
      laneCount: number;
    };

type SeparateThreadTrackDescriptor = HierarchicalTrackDescriptor<SeparateThreadTrackObject>;

type SeparateThreadRankState = {
  processId: string;
  rankIndex: number;
  orderedStreamIds: TraceThreadId[];
};

type SeparateThreadStreamState = {
  processId: string;
  rankIndex: number;
  threadId: TraceThreadId;
  threadRef?: ThreadRef;
  threadName: string;
  visibleInExpandedLayout: boolean;
  /** Whether this stream bypasses lane generation and uses authored manual span geometry. */
  usesManualSpanLayout?: boolean;
  /** Reserved stream-band height for authored manual span geometry. */
  manualContentHeight?: number;
  laneCount: number;
  renderedLaneCount: number;
  overflowSpanCount: number;
  spanLaneMap?: ReadonlyMap<SpanRef, number>;
  /** Optional explicit lane indices to render while hiding all other lanes. */
  visibleLaneIndices?: readonly number[];
  collapseMode?: 'top-only' | 'stack-all';
  baseIsCollapsed: boolean;
};

type ThreadLaneLayoutOverrides = Readonly<
  Record<TraceThreadId, Pick<ThreadLaneMetadata, 'visibleLaneIndices'>>
>;

const TRACE_LAYOUT_SLOW_PROCESS_PROBE_THRESHOLD_MS = 16;
const TRACE_LAYOUT_SLOW_RANK_PROBE_THRESHOLD_MS = 16;

type SeparateThreadTrackBuildResult = {
  descriptors: SeparateThreadTrackDescriptor[];
  rootTrackIds: string[];
  rankStates: SeparateThreadRankState[];
  streamStatesById: Readonly<Record<TraceThreadId, SeparateThreadStreamState>>;
};

function getRankTrackId(processId: string): string {
  return `rank:${processId}`;
}

function getStreamTrackId(threadId: TraceThreadId): string {
  return `stream:${threadId}`;
}

function getLaneStackTrackId(threadId: TraceThreadId): string {
  return `lane-stack:${threadId}`;
}

function getTrackEntryYOffset(
  entry:
    | HierarchicalTrackLayoutResult<SeparateThreadTrackObject>['trackLayoutsById'][string]
    | undefined,
  useExpandedOffsets: boolean
): number | null {
  if (!entry) {
    return null;
  }
  return useExpandedOffsets ? entry.expandedYOffset : entry.currentYOffset;
}

function buildOrderedThreadIds(threads: readonly Pick<TraceThread, 'threadId'>[]): TraceThreadId[] {
  const orderedThreadIds = new Array<TraceThreadId>(threads.length);
  for (let index = 0; index < threads.length; index++) {
    orderedThreadIds[index] = threads[index]!.threadId;
  }
  return orderedThreadIds;
}

function buildSeparateThreadDescriptorsFromSourceGraph(params: {
  visibleTraceGraph: TraceLayoutVisibleGraph;
  maxTimeMs: number;
  settings: TrackAggregationSettings;
  layoutConfiguration: ReturnType<typeof getLayoutDensityPreset>;
  streamLaneLayoutMap?: Readonly<Record<TraceThreadId, ThreadLaneMetadata>>;
}): SeparateThreadTrackBuildResult {
  const {visibleTraceGraph, maxTimeMs, settings} = params;
  const usesManualSpanLayout = visibleTraceGraph.traceGraph.spanLayout === 'manual';
  const startTime = performance.now();
  const descriptors: SeparateThreadTrackDescriptor[] = [];
  const rootTrackIds: string[] = [];
  const rankStates: SeparateThreadRankState[] = [];
  const streamStatesById: Record<TraceThreadId, SeparateThreadStreamState> = {};
  let visibleBlockSourceDurationMs = 0;
  let blockBucketingDurationMs = 0;
  let laneAssignmentDurationMs = 0;
  let visibleBlockCount = 0;
  let laneLayoutCallCount = 0;
  let laneLayoutBlockCount = 0;
  let threadOrderingDurationMs = 0;
  let threadLoopDurationMs = 0;
  let descriptorAssemblyDurationMs = 0;
  let slowestProcessDurationMs = 0;
  let slowestProcessId: string | undefined;
  let slowestProcessThreadCount = 0;
  let slowestProcessVisibleBlockCount = 0;
  let slowestProcessLaneAssignmentDurationMs = 0;

  for (const [rankIndex, rank] of visibleTraceGraph.processes.entries()) {
    const processStartTime = performance.now();
    const descriptorCountBeforeProcess = descriptors.length;
    const processLaneAssignmentStartDurationMs = laneAssignmentDurationMs;
    const orderedThreads = settings.sortThreads ? [...rank.threads] : rank.threads;
    const threadRefById = settings.sortThreads
      ? new Map(
          rank.threads.map((thread, index) => [thread.threadId, rank.threadRefs?.[index]] as const)
        )
      : undefined;
    if (settings.sortThreads) {
      const threadOrderingStartTime = performance.now();
      orderedThreads.sort((a, b) => {
        const aName = a.name?.trim() || String(a.threadId);
        const bName = b.name?.trim() || String(b.threadId);
        return compareNumericSortStrings(aName, bName);
      });
      threadOrderingDurationMs += performance.now() - threadOrderingStartTime;
    }

    const threadBlocks = new Map<TraceThreadId, TraceSpanGeometrySource[]>();
    const visibleBlockSourceStartTime = performance.now();
    const rankBlocks = getVisibleBlocksForProcess(visibleTraceGraph, rank.processId);
    const rankLaneBlocks = usesManualSpanLayout
      ? []
      : getVisibleLaneBlocksForProcess(visibleTraceGraph, rank.processId);
    const rankLaneLocalDependencies = usesManualSpanLayout
      ? []
      : getVisibleLaneLocalDependenciesForProcess(visibleTraceGraph, rank.processId);
    const explicitParentByChild = usesManualSpanLayout
      ? new Map<TraceSpanId, TraceSpanId>()
      : buildExplicitParentSpanMap({
          spans: rankLaneBlocks,
          localDependencies: rankLaneLocalDependencies,
          maxTimeMs
        });
    visibleBlockSourceDurationMs += performance.now() - visibleBlockSourceStartTime;
    const blockBucketingStartTime = performance.now();
    visibleBlockCount += rankBlocks.length;
    for (const block of rankBlocks) {
      const blocksForThread = threadBlocks.get(block.threadId);
      if (blocksForThread) {
        blocksForThread.push(block);
      } else {
        threadBlocks.set(block.threadId, [block]);
      }
    }
    blockBucketingDurationMs += performance.now() - blockBucketingStartTime;

    const rankTrackId = getRankTrackId(rank.processId);
    rootTrackIds.push(rankTrackId);
    rankStates.push({
      processId: rank.processId,
      rankIndex,
      orderedStreamIds: buildOrderedThreadIds(orderedThreads)
    });
    const rankDescriptorAssemblyStartTime = performance.now();
    descriptors.push({
      id: rankTrackId,
      kind: 'group',
      type: 'rank',
      object: {
        nodeType: 'rank',
        processId: rank.processId,
        rankIndex
      }
    });
    descriptorAssemblyDurationMs += performance.now() - rankDescriptorAssemblyStartTime;

    for (const [threadIndex, thread] of orderedThreads.entries()) {
      const threadLoopStartTime = performance.now();
      const blocksForThread = threadBlocks.get(thread.threadId) ?? [];
      const visibleInExpandedLayout = streamIsVisible(thread, settings);
      if (usesManualSpanLayout) {
        const manualContentHeight = getManualThreadContentHeight(
          blocksForThread,
          params.layoutConfiguration.laneSeparation
        );
        streamStatesById[thread.threadId] = {
          processId: rank.processId,
          rankIndex,
          threadId: thread.threadId,
          threadRef: threadRefById?.get(thread.threadId) ?? rank.threadRefs?.[threadIndex],
          threadName: thread.name?.trim() || String(thread.threadId),
          visibleInExpandedLayout,
          usesManualSpanLayout: true,
          manualContentHeight,
          laneCount: 0,
          renderedLaneCount: 0,
          overflowSpanCount: 0,
          baseIsCollapsed: false
        };
        threadLoopDurationMs += performance.now() - threadLoopStartTime;
        if (!visibleInExpandedLayout) {
          continue;
        }
        const streamDescriptorAssemblyStartTime = performance.now();
        descriptors.push({
          id: getStreamTrackId(thread.threadId),
          parentId: rankTrackId,
          kind: 'group',
          type: 'stream',
          object: {
            nodeType: 'stream',
            processId: rank.processId,
            rankIndex,
            threadId: thread.threadId,
            manualContentHeight
          }
        });
        descriptorAssemblyDurationMs += performance.now() - streamDescriptorAssemblyStartTime;
        continue;
      }

      const disableLaneAssignment = getLaneAssignmentMode(rank.userData) === 'none';
      const laneAssignmentStartTime = performance.now();
      const inferredLaneMap = {
        map: new Map<SpanRef, number>(),
        maxLane: -1
      };
      if (disableLaneAssignment) {
        for (const block of blocksForThread) {
          if (block.spanRef != null) {
            inferredLaneMap.map.set(block.spanRef, 0);
          }
        }
        inferredLaneMap.maxLane = blocksForThread.length > 0 ? 0 : -1;
      } else {
        laneLayoutCallCount += 1;
        laneLayoutBlockCount += blocksForThread.length;
        const hasSeparateParentHints = hasParentHintsForSpans(
          blocksForThread,
          explicitParentByChild
        );
        const hasSeparateLaneAffinity = hasTraceLaneAffinity(blocksForThread);
        inferredLaneMap.maxLane = visitKahnLaneAssignments<TraceSpanGeometrySource>(
          blocksForThread,
          {
            ...(hasSeparateParentHints
              ? {
                  getParentSpanId: (block: TraceSpanGeometrySource) =>
                    explicitParentByChild.get(block.spanId)
                }
              : {}),
            ...(hasSeparateLaneAffinity ? {getLaneAffinityKey: getTraceLaneAffinityKey} : {}),
            maxTimeMs
          },
          (block, lane) => {
            if (block.spanRef != null) {
              inferredLaneMap.map.set(block.spanRef, lane);
            }
          }
        );
      }
      laneAssignmentDurationMs += performance.now() - laneAssignmentStartTime;
      const inferredLaneCount = inferredLaneMap.maxLane >= 0 ? inferredLaneMap.maxLane + 1 : 0;
      const laneMetadata = params.streamLaneLayoutMap?.[thread.threadId];
      const totalLaneCount = Math.max(1, laneMetadata?.laneCount ?? 1, inferredLaneCount);
      const normalizedLaneCount = normalizeLaneCounts(
        totalLaneCount,
        params.settings.maxVisibleLanesPerThread,
        params.settings.maxVisibleLanesUnlimited
      );
      const visibleLaneIndices = laneMetadata?.visibleLaneIndices?.filter(
        laneIndex =>
          Number.isInteger(laneIndex) && laneIndex >= 0 && laneIndex < normalizedLaneCount.laneCount
      );
      const effectiveSpanLaneMap = laneMetadata?.spanLaneMap ?? inferredLaneMap.map;
      const overflowSpanCount = countOverflowSpans(
        effectiveSpanLaneMap,
        normalizedLaneCount.renderedLaneCount,
        normalizedLaneCount.hasOverflow
      );
      const effectiveLaneCount = Math.max(
        visibleLaneIndices ? visibleLaneIndices.length : normalizedLaneCount.laneCount,
        1
      );
      const effectiveRenderedLaneCount = visibleLaneIndices
        ? visibleLaneIndices.length
        : normalizedLaneCount.renderedLaneCount;
      const collapseMode =
        (thread.userData as {laneCollapseMode?: string} | undefined)?.laneCollapseMode ===
        'top-only'
          ? 'top-only'
          : undefined;
      streamStatesById[thread.threadId] = {
        processId: rank.processId,
        rankIndex,
        threadId: thread.threadId,
        threadRef: threadRefById?.get(thread.threadId) ?? rank.threadRefs?.[threadIndex],
        threadName: thread.name?.trim() || String(thread.threadId),
        visibleInExpandedLayout,
        laneCount: effectiveLaneCount,
        renderedLaneCount: effectiveRenderedLaneCount,
        overflowSpanCount,
        spanLaneMap: effectiveSpanLaneMap,
        visibleLaneIndices,
        collapseMode,
        baseIsCollapsed: false
      };
      threadLoopDurationMs += performance.now() - threadLoopStartTime;

      if (!visibleInExpandedLayout) {
        continue;
      }

      const streamDescriptorAssemblyStartTime = performance.now();
      const streamTrackId = getStreamTrackId(thread.threadId);
      descriptors.push({
        id: streamTrackId,
        parentId: rankTrackId,
        kind: 'group',
        type: 'stream',
        object: {
          nodeType: 'stream',
          processId: rank.processId,
          rankIndex,
          threadId: thread.threadId
        }
      });

      const stackedLaneCount = Math.max(effectiveLaneCount - 1, 0);
      if (stackedLaneCount > 0) {
        descriptors.push({
          id: getLaneStackTrackId(thread.threadId),
          parentId: streamTrackId,
          kind: 'leaf',
          type: 'laneStack',
          object: {
            nodeType: 'laneStack',
            processId: rank.processId,
            rankIndex,
            threadId: thread.threadId,
            laneCount: stackedLaneCount
          }
        });
      }
      descriptorAssemblyDurationMs += performance.now() - streamDescriptorAssemblyStartTime;
    }

    const processDurationMs = performance.now() - processStartTime;
    const processLaneAssignmentDurationMs =
      laneAssignmentDurationMs - processLaneAssignmentStartDurationMs;
    if (processDurationMs > slowestProcessDurationMs) {
      slowestProcessDurationMs = processDurationMs;
      slowestProcessId = rank.processId;
      slowestProcessThreadCount = rank.threads.length;
      slowestProcessVisibleBlockCount = rankBlocks.length;
      slowestProcessLaneAssignmentDurationMs = processLaneAssignmentDurationMs;
    }
    if (processDurationMs >= TRACE_LAYOUT_SLOW_PROCESS_PROBE_THRESHOLD_MS) {
      log.probe(0, 'buildSeparateThreadDescriptorsFromSourceGraph slow process', {
        graphName: visibleTraceGraph.name,
        processId: rank.processId,
        processName: rank.name,
        threadCount: rank.threads.length,
        visibleBlockCount: rankBlocks.length,
        descriptorCount: descriptors.length - descriptorCountBeforeProcess,
        laneAssignmentDurationMs: processLaneAssignmentDurationMs,
        durationMs: processDurationMs
      })();
    }
  }

  log.probe(0, 'buildSeparateThreadDescriptorsFromSourceGraph done', {
    graphName: visibleTraceGraph.name,
    processCount: visibleTraceGraph.processes.length,
    visibleBlockCount,
    descriptorCount: descriptors.length,
    streamCount: Object.keys(streamStatesById).length,
    laneLayoutCallCount,
    laneLayoutBlockCount,
    visibleBlockSourceDurationMs,
    blockBucketingDurationMs,
    laneAssignmentDurationMs,
    threadOrderingDurationMs,
    threadLoopDurationMs,
    descriptorAssemblyDurationMs,
    slowestProcessId,
    slowestProcessDurationMs,
    slowestProcessThreadCount,
    slowestProcessVisibleBlockCount,
    slowestProcessLaneAssignmentDurationMs,
    durationMs: performance.now() - startTime,
    ...getHeapUsageProbeFields()
  })();

  return {
    descriptors,
    rootTrackIds,
    rankStates,
    streamStatesById
  };
}

function buildSeparateThreadDescriptorsFromExpandedLayout(params: {
  visibleTraceGraph: TraceLayoutVisibleGraph;
  expandedLayout: TraceLayout;
}): SeparateThreadTrackBuildResult {
  const descriptors: SeparateThreadTrackDescriptor[] = [];
  const rootTrackIds: string[] = [];
  const rankStates: SeparateThreadRankState[] = [];
  const streamStatesById: Record<TraceThreadId, SeparateThreadStreamState> = {};
  const threadIdByLayout = new Map<ThreadLayout, TraceThreadId>();

  for (const [streamId, threadLayout] of Object.entries(params.expandedLayout.threadLayoutMap)) {
    threadIdByLayout.set(threadLayout, streamId as TraceThreadId);
  }

  for (const [rankIndex, rank] of params.visibleTraceGraph.processes.entries()) {
    const processLayout = params.expandedLayout.processLayouts[rankIndex];
    const orderedStreamIds =
      processLayout?.threadLayouts
        .map(threadLayout => threadIdByLayout.get(threadLayout))
        .filter((streamId): streamId is TraceThreadId => Boolean(streamId)) ?? [];
    const rankTrackId = getRankTrackId(rank.processId);
    rootTrackIds.push(rankTrackId);
    rankStates.push({
      processId: rank.processId,
      rankIndex,
      orderedStreamIds
    });
    descriptors.push({
      id: rankTrackId,
      kind: 'group',
      type: 'rank',
      object: {
        nodeType: 'rank',
        processId: rank.processId,
        rankIndex
      }
    });

    for (const streamId of orderedStreamIds) {
      const sourceThreadLayout = params.expandedLayout.threadLayoutMap[streamId];
      if (!sourceThreadLayout) {
        continue;
      }
      const laneCount = Math.max(
        sourceThreadLayout.lanes?.laneCount ?? (sourceThreadLayout.visible ? 1 : 0),
        sourceThreadLayout.visible ? 1 : 0
      );
      streamStatesById[streamId] = {
        processId: rank.processId,
        rankIndex,
        threadId: streamId,
        threadRef: sourceThreadLayout.threadRef,
        threadName: rank.threadMap[streamId]?.name?.trim() || String(streamId),
        visibleInExpandedLayout: sourceThreadLayout.visible,
        usesManualSpanLayout: sourceThreadLayout.manualContentHeight != null,
        manualContentHeight: sourceThreadLayout.manualContentHeight,
        laneCount,
        renderedLaneCount: sourceThreadLayout.lanes?.renderedLaneCount ?? laneCount,
        overflowSpanCount: sourceThreadLayout.overflowSpanCount ?? 0,
        spanLaneMap: sourceThreadLayout.spanLaneMap,
        visibleLaneIndices: sourceThreadLayout.lanes?.visibleLaneIndices,
        collapseMode: sourceThreadLayout.lanes?.collapseMode,
        baseIsCollapsed: sourceThreadLayout.lanes?.isCollapsed ?? false
      };

      if (!sourceThreadLayout.visible) {
        continue;
      }

      const streamTrackId = getStreamTrackId(streamId);
      descriptors.push({
        id: streamTrackId,
        parentId: rankTrackId,
        kind: 'group',
        type: 'stream',
        object: {
          nodeType: 'stream',
          processId: rank.processId,
          rankIndex,
          threadId: streamId,
          manualContentHeight: sourceThreadLayout.manualContentHeight
        }
      });

      if (sourceThreadLayout.manualContentHeight != null) {
        continue;
      }

      const stackedLaneCount = Math.max(laneCount - 1, 0);
      if (stackedLaneCount > 0) {
        descriptors.push({
          id: getLaneStackTrackId(streamId),
          parentId: streamTrackId,
          kind: 'leaf',
          type: 'laneStack',
          object: {
            nodeType: 'laneStack',
            processId: rank.processId,
            rankIndex,
            threadId: streamId,
            laneCount: stackedLaneCount
          }
        });
      }
    }
  }

  return {
    descriptors,
    rootTrackIds,
    rankStates,
    streamStatesById
  };
}

function buildSeparateThreadTrackLayout(params: {
  descriptors: readonly SeparateThreadTrackDescriptor[];
  rootTrackIds: readonly string[];
  layoutConfiguration: ReturnType<typeof getLayoutDensityPreset>;
  maxTimeMs: number;
  collapsedTrackIds?: ReadonlySet<string>;
}): HierarchicalTrackLayoutResult<SeparateThreadTrackObject> {
  return buildHierarchicalTrackLayout({
    descriptors: params.descriptors,
    rootTrackIds: params.rootTrackIds,
    collapsedTrackIds: params.collapsedTrackIds,
    measureTrack: descriptor => {
      if (descriptor.type === 'rank') {
        return {
          height: getProcessContentStartY({
            yOffset: 0,
            layoutConfiguration: params.layoutConfiguration
          }),
          width: params.maxTimeMs
        };
      }
      if (descriptor.type === 'laneStack') {
        return {
          height:
            params.layoutConfiguration.laneSeparation *
            Math.max(
              0,
              descriptor.object?.nodeType === 'laneStack' ? descriptor.object.laneCount : 0
            ),
          width: params.maxTimeMs
        };
      }
      return {
        height:
          descriptor.object?.nodeType === 'stream' && descriptor.object.manualContentHeight != null
            ? descriptor.object.manualContentHeight
            : params.layoutConfiguration.laneSeparation,
        width: params.maxTimeMs
      };
    },
    getSiblingGap: (parentDescriptor, previousChildDescriptor, nextChildDescriptor) => {
      if (
        parentDescriptor.type === 'rank' &&
        previousChildDescriptor.type === 'stream' &&
        nextChildDescriptor.type === 'stream'
      ) {
        return (
          params.layoutConfiguration.threadSeparation - params.layoutConfiguration.laneSeparation
        );
      }
      return 0;
    }
  });
}

function buildHiddenSeparateThreadLayout(params: {
  maxTimeMs: number;
  streamState: SeparateThreadStreamState;
}): ThreadLayout {
  return {
    threadRef: params.streamState.threadRef,
    threadId: params.streamState.threadId,
    visible: false,
    yPosition: HIDDEN_LAYOUT_Y,
    startPosition: [0, HIDDEN_LAYOUT_Y, 0],
    targetPosition: [params.maxTimeMs, HIDDEN_LAYOUT_Y, 0],
    spanLaneMap: params.streamState.spanLaneMap,
    manualContentHeight: params.streamState.manualContentHeight,
    lanes: params.streamState.usesManualSpanLayout
      ? undefined
      : {
          laneCount: params.streamState.laneCount,
          renderedLaneCount: params.streamState.renderedLaneCount,
          visibleLaneIndices: params.streamState.visibleLaneIndices
            ? [...params.streamState.visibleLaneIndices]
            : undefined,
          isCollapsed: params.streamState.baseIsCollapsed,
          laneYPositions: [],
          collapseMode: params.streamState.collapseMode
        },
    overflowSpanCount: params.streamState.overflowSpanCount,
    overflowLabel: undefined
  } satisfies ThreadLayout;
}

function materializeSeparateThreadLayout(params: {
  visibleTraceGraph: TraceLayoutVisibleGraph;
  maxTimeMs: number;
  layoutConfiguration: ReturnType<typeof getLayoutDensityPreset>;
  trackLayout: HierarchicalTrackLayoutResult<SeparateThreadTrackObject>;
  rankStates: readonly SeparateThreadRankState[];
  streamStatesById: Readonly<Record<TraceThreadId, SeparateThreadStreamState>>;
  traceGraph: TraceGraph;
  useExpandedOffsets: boolean;
  showEmptyProcesses?: boolean;
}): {layout: TraceLayout; rankSpacings: number[]} {
  const startTime = performance.now();
  const {laneSeparation, processSeparation, labelPadding, labelMinGap} = params.layoutConfiguration;
  const processContentTopInset =
    getProcessContentStartY({
      yOffset: 0,
      layoutConfiguration: params.layoutConfiguration
    }) || labelPadding + labelMinGap;
  const processLayouts: ProcessLayout[] = new Array(params.rankStates.length);
  const rankSpacings: number[] = new Array(params.rankStates.length).fill(0);
  const threadLayoutMap: Record<TraceThreadId, ThreadLayout> = {};
  let nextRankYOffset = 0;
  const showEmptyProcesses = params.showEmptyProcesses ?? false;
  const rankDisplayableScanStartTime = performance.now();
  const rankHasDisplayableSpanContent = params.rankStates.map(rankState =>
    rankState.orderedStreamIds.some(streamId => {
      const streamState = params.streamStatesById[streamId];
      return (
        streamState?.visibleInExpandedLayout === true &&
        (streamState.usesManualSpanLayout === true || (streamState.spanLaneMap?.size ?? 0) > 0)
      );
    })
  );
  const rankDisplayableScanDurationMs = performance.now() - rankDisplayableScanStartTime;
  const followingProcessScanStartTime = performance.now();
  const hasFollowingDisplayableProcessByPosition = new Array<boolean>(
    params.rankStates.length
  ).fill(false);
  let seenFollowingDisplayableProcess = false;
  for (let index = params.rankStates.length - 1; index >= 0; index--) {
    hasFollowingDisplayableProcessByPosition[index] = seenFollowingDisplayableProcess;
    if (rankHasDisplayableSpanContent[index]) {
      seenFollowingDisplayableProcess = true;
    }
  }
  const followingProcessScanDurationMs = performance.now() - followingProcessScanStartTime;
  let threadLayoutBuildDurationMs = 0;
  let visibleThreadFilterDurationMs = 0;
  let overflowLabelDurationMs = 0;
  let backgroundGeometryDurationMs = 0;
  let slowestRankDurationMs = 0;
  let slowestRankProcessId: string | undefined;
  let slowestRankThreadCount = 0;
  let slowestRankVisibleThreadCount = 0;
  let slowestRankIsCollapsed = false;
  let skippedEmptyProcessCount = 0;
  let materializedRankCount = 0;

  for (const [rankStatePosition, rankState] of params.rankStates.entries()) {
    if (!showEmptyProcesses && !rankHasDisplayableSpanContent[rankStatePosition]) {
      skippedEmptyProcessCount += 1;
      continue;
    }

    const rankStartTime = performance.now();
    const rankTrackId = getRankTrackId(rankState.processId);
    const rankEntry = params.trackLayout.trackLayoutsById[rankTrackId];
    if (!rankEntry) {
      continue;
    }

    const baseRankYOffset = getTrackEntryYOffset(rankEntry, params.useExpandedOffsets) ?? 0;
    const rankDelta = nextRankYOffset - baseRankYOffset;
    const rankStartY = nextRankYOffset + processContentTopInset;
    const threadLayoutBuildStartTime = performance.now();
    const threadLayouts = rankState.orderedStreamIds.map(streamId => {
      const streamState = params.streamStatesById[streamId];
      if (!streamState) {
        return undefined;
      }
      if (!streamState.visibleInExpandedLayout) {
        const hiddenLayout = buildHiddenSeparateThreadLayout({
          maxTimeMs: params.maxTimeMs,
          streamState
        });
        threadLayoutMap[streamId] = hiddenLayout;
        return hiddenLayout;
      }

      const streamEntry = params.trackLayout.trackLayoutsById[getStreamTrackId(streamId)];
      const baseStreamY = getTrackEntryYOffset(streamEntry, params.useExpandedOffsets);
      if (!streamEntry || baseStreamY == null) {
        const hiddenLayout = buildHiddenSeparateThreadLayout({
          maxTimeMs: params.maxTimeMs,
          streamState
        });
        threadLayoutMap[streamId] = hiddenLayout;
        return hiddenLayout;
      }

      if (streamState.usesManualSpanLayout) {
        const manualLayout = {
          threadRef: streamState.threadRef,
          threadId: streamState.threadId,
          visible: true,
          yPosition: baseStreamY + rankDelta,
          manualContentHeight:
            streamState.manualContentHeight ?? params.layoutConfiguration.laneSeparation,
          startPosition: [0, baseStreamY + rankDelta, 0] as [number, number, number],
          targetPosition: [params.maxTimeMs, baseStreamY + rankDelta, 0] as [
            number,
            number,
            number
          ],
          overflowSpanCount: 0,
          overflowLabel: undefined
        } satisfies ThreadLayout;
        threadLayoutMap[streamId] = manualLayout;
        return manualLayout;
      }

      const isCollapsed = params.useExpandedOffsets
        ? streamState.baseIsCollapsed
        : streamEntry.isCollapsed;
      const visibleLaneCount = isCollapsed ? 1 : streamState.laneCount;
      const laneYPositions = buildLaneYPositions(
        baseStreamY + rankDelta,
        visibleLaneCount,
        laneSeparation
      );

      const visibleLayout = {
        threadRef: streamState.threadRef,
        threadId: streamState.threadId,
        visible: true,
        yPosition: baseStreamY + rankDelta,
        startPosition: [0, baseStreamY + rankDelta, 0] as [number, number, number],
        targetPosition: [params.maxTimeMs, baseStreamY + rankDelta, 0] as [number, number, number],
        spanLaneMap: streamState.spanLaneMap,
        lanes: {
          laneCount: streamState.laneCount,
          renderedLaneCount: streamState.renderedLaneCount,
          visibleLaneIndices: streamState.visibleLaneIndices
            ? [...streamState.visibleLaneIndices]
            : undefined,
          isCollapsed,
          laneYPositions,
          collapseMode: streamState.collapseMode
        },
        overflowSpanCount: streamState.overflowSpanCount,
        overflowLabel: undefined
      } satisfies ThreadLayout;

      const overflowLabelStartTime = performance.now();
      const withOverflow = {
        ...visibleLayout,
        overflowLabel: isCollapsed
          ? undefined
          : buildThreadOverflowLabelForThreads({
              threadLayout: visibleLayout,
              overflowSpanCount: streamState.overflowSpanCount,
              threads: [{name: streamState.threadName, threadId: streamId}],
              threadRefs: streamState.threadRef != null ? [streamState.threadRef] : undefined,
              traceGraph: params.traceGraph,
              labelLaneSeparation: laneSeparation
            })
      } satisfies ThreadLayout;
      overflowLabelDurationMs += performance.now() - overflowLabelStartTime;

      threadLayoutMap[streamId] = withOverflow;
      return withOverflow;
    });
    threadLayoutBuildDurationMs += performance.now() - threadLayoutBuildStartTime;

    const visibleThreadFilterStartTime = performance.now();
    const visibleThreadLayouts = threadLayouts.filter(
      (threadLayout): threadLayout is ThreadLayout => Boolean(threadLayout?.visible)
    );
    visibleThreadFilterDurationMs += performance.now() - visibleThreadFilterStartTime;
    const rankIsCollapsed = !params.useExpandedOffsets ? rankEntry.isCollapsed : false;
    const hasOverflowLabel = visibleThreadLayouts.some(threadLayout => threadLayout.overflowLabel);
    const rankHasVisibleSpanContent = hasVisibleRankSpanContent(visibleThreadLayouts);
    const baseRankSpacing =
      (params.useExpandedOffsets
        ? rankEntry.expandedSubtreeHeight
        : rankEntry.currentSubtreeHeight) +
      (hasOverflowLabel ? laneSeparation : 0) +
      (visibleThreadLayouts.length === 0 ? laneSeparation : 0);
    const rankContentSpacing =
      !rankIsCollapsed && !rankHasVisibleSpanContent
        ? Math.max(
            baseRankSpacing,
            getCollapsedProcessMinimumRankSpacing(params.layoutConfiguration)
          )
        : baseRankSpacing;
    const hasFollowingDisplayableProcess =
      hasFollowingDisplayableProcessByPosition[rankStatePosition] ?? false;
    const processGap = !showEmptyProcesses
      ? hasFollowingDisplayableProcess
        ? processSeparation
        : 0
      : rankStatePosition < params.rankStates.length - 1
        ? processSeparation
        : 0;
    const rankSpacing = rankContentSpacing + processGap;
    const rankLayout = {
      isCollapsed: rankIsCollapsed,
      yOffset: nextRankYOffset,
      yHeight: rankContentSpacing,
      labelY: getProcessLabelY({
        yOffset: nextRankYOffset,
        layoutConfiguration: params.layoutConfiguration
      }),
      collapsedActivityY: getProcessCollapsedActivityY({
        yOffset: nextRankYOffset,
        yHeight: rankContentSpacing
      }),
      startPosition:
        visibleThreadLayouts[0]?.startPosition ?? ([0, rankStartY, 0] as [number, number, number]),
      label: params.visibleTraceGraph.processes[rankState.rankIndex]?.name ?? rankState.processId,
      threadLayouts: threadLayouts.filter((threadLayout): threadLayout is ThreadLayout =>
        Boolean(threadLayout)
      ),
      backgroundPolygon: new Float32Array() as Float32Array<ArrayBuffer>,
      backgroundPolygonInfinite: new Float32Array() as Float32Array<ArrayBuffer>,
      separatorLineInfinite: new Float32Array() as Float32Array<ArrayBuffer>,
      terminalSeparatorLineInfinite: new Float32Array() as Float32Array<ArrayBuffer>
    } satisfies ProcessLayout;

    const backgroundGeometryStartTime = performance.now();
    rankLayout.backgroundPolygon = computeRankBackgroundPolygon({
      rankLayout,
      threadLayouts: rankLayout.threadLayouts
    }) as Float32Array<ArrayBuffer>;
    rankLayout.backgroundPolygonInfinite = computeRankBackgroundPolygon({
      rankLayout,
      threadLayouts: rankLayout.threadLayouts,
      infiniteWidth: true
    }) as Float32Array<ArrayBuffer>;
    rankLayout.separatorLineInfinite = computeRankSeparatorLineInfinite(
      rankLayout
    ) as Float32Array<ArrayBuffer>;
    rankLayout.terminalSeparatorLineInfinite = computeRankTerminalSeparatorLineInfinite(
      rankLayout
    ) as Float32Array<ArrayBuffer>;
    backgroundGeometryDurationMs += performance.now() - backgroundGeometryStartTime;

    processLayouts[rankState.rankIndex] = rankLayout;
    rankSpacings[rankState.rankIndex] = rankSpacing;
    materializedRankCount += 1;
    nextRankYOffset += rankSpacing;
    const rankDurationMs = performance.now() - rankStartTime;
    if (rankDurationMs > slowestRankDurationMs) {
      slowestRankDurationMs = rankDurationMs;
      slowestRankProcessId = rankState.processId;
      slowestRankThreadCount = rankState.orderedStreamIds.length;
      slowestRankVisibleThreadCount = visibleThreadLayouts.length;
      slowestRankIsCollapsed = rankIsCollapsed;
    }
    if (rankDurationMs >= TRACE_LAYOUT_SLOW_RANK_PROBE_THRESHOLD_MS) {
      log.probe(0, 'materializeSeparateThreadLayout slow rank', {
        graphName: params.visibleTraceGraph.name,
        processId: rankState.processId,
        rankIndex: rankState.rankIndex,
        threadCount: rankState.orderedStreamIds.length,
        visibleThreadCount: visibleThreadLayouts.length,
        rankIsCollapsed,
        useExpandedOffsets: params.useExpandedOffsets,
        rankSpacing,
        durationMs: rankDurationMs
      })();
    }
  }

  log.probe(0, 'materializeSeparateThreadLayout done', {
    graphName: params.visibleTraceGraph.name,
    rankCount: params.rankStates.length,
    materializedRankCount,
    skippedEmptyProcessCount,
    useExpandedOffsets: params.useExpandedOffsets,
    rankDisplayableScanDurationMs,
    followingProcessScanDurationMs,
    threadLayoutBuildDurationMs,
    visibleThreadFilterDurationMs,
    overflowLabelDurationMs,
    backgroundGeometryDurationMs,
    slowestRankProcessId,
    slowestRankDurationMs,
    slowestRankThreadCount,
    slowestRankVisibleThreadCount,
    slowestRankIsCollapsed,
    durationMs: performance.now() - startTime,
    ...getHeapUsageProbeFields()
  })();

  return {
    layout: {
      layoutConfiguration: {laneSeparation: params.layoutConfiguration.laneSeparation},
      traceGraph: params.traceGraph,
      processLayouts,
      renderRows: [],
      threadLayoutMap,
      spanGeometryChunks: [],
      spanVisibilityMapBySpanRef: new Map(),
      localDependencyGeometryChunks: [],
      crossDependencyGeometryChunks: [],
      overflowLabels: buildTraceLayoutOverflowLabels(processLayouts),
      currentBounds: [
        [0, 0],
        [0, 0]
      ],
      expandedBounds: [
        [0, 0],
        [0, 0]
      ]
    },
    rankSpacings
  };
}

function buildLaneYPositions(
  startY: number,
  visibleLaneCount: number,
  laneSeparation: number
): number[] {
  const laneYPositions = new Array<number>(visibleLaneCount);
  for (let laneIndex = 0; laneIndex < visibleLaneCount; laneIndex++) {
    laneYPositions[laneIndex] = startY + laneIndex * laneSeparation;
  }
  return laneYPositions;
}

function buildSeparateThreadExpandedLayout(params: {
  visibleTraceGraph: TraceLayoutVisibleGraph;
  settings: TrackAggregationSettings;
  layoutConfiguration: ReturnType<typeof getLayoutDensityPreset>;
  streamLaneLayoutMap?: Readonly<Record<TraceThreadId, ThreadLaneMetadata>>;
  traceGraph: TraceGraph;
}): TraceLayout {
  const startTime = performance.now();
  const buildState = buildSeparateThreadDescriptorsFromSourceGraph({
    visibleTraceGraph: params.visibleTraceGraph,
    maxTimeMs: params.visibleTraceGraph.maxTimeMs,
    settings: params.settings,
    layoutConfiguration: params.layoutConfiguration,
    streamLaneLayoutMap: params.streamLaneLayoutMap
  });
  const descriptorDurationMs = performance.now() - startTime;
  const trackLayoutStartTime = performance.now();
  const trackLayout = buildSeparateThreadTrackLayout({
    descriptors: buildState.descriptors,
    rootTrackIds: buildState.rootTrackIds,
    layoutConfiguration: params.layoutConfiguration,
    maxTimeMs: params.visibleTraceGraph.maxTimeMs
  });
  const trackLayoutDurationMs = performance.now() - trackLayoutStartTime;
  const materializeStartTime = performance.now();
  const layout = materializeSeparateThreadLayout({
    visibleTraceGraph: params.visibleTraceGraph,
    maxTimeMs: params.visibleTraceGraph.maxTimeMs,
    layoutConfiguration: params.layoutConfiguration,
    trackLayout,
    rankStates: buildState.rankStates,
    streamStatesById: buildState.streamStatesById,
    traceGraph: params.traceGraph,
    useExpandedOffsets: true,
    showEmptyProcesses: params.settings.showEmptyProcesses
  }).layout;
  const materializeDurationMs = performance.now() - materializeStartTime;
  log.probe(0, 'buildSeparateThreadExpandedLayout done', {
    graphName: params.visibleTraceGraph.name,
    processCount: params.visibleTraceGraph.processes.length,
    descriptorCount: buildState.descriptors.length,
    descriptorDurationMs,
    trackLayoutDurationMs,
    materializeDurationMs,
    durationMs: performance.now() - startTime,
    ...getHeapUsageProbeFields()
  })();
  return layout;
}

function applySeparateThreadTrackLayoutCollapseState(params: {
  visibleTraceGraph: TraceLayoutVisibleGraph;
  expandedLayout: TraceLayout;
  layoutDensity: TraceVisSettings['layoutDensity'];
  collapsedProcessIds?: ReadonlySet<string>;
  expandedThreadIds?: ReadonlySet<TraceThreadId>;
  collapsedThreadIds?: ReadonlySet<TraceThreadId>;
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
}): {traceLayout: TraceLayout; rankSpacings: number[]} {
  const startTime = performance.now();
  const descriptorStartTime = performance.now();
  const buildState = buildSeparateThreadDescriptorsFromExpandedLayout({
    visibleTraceGraph: params.visibleTraceGraph,
    expandedLayout: params.expandedLayout
  });
  const descriptorDurationMs = performance.now() - descriptorStartTime;
  const collapsedTrackIdStartTime = performance.now();
  const collapsedTrackIds = new Set<string>();
  for (const rankId of params.collapsedProcessIds ?? []) {
    collapsedTrackIds.add(getRankTrackId(rankId));
  }
  for (const streamId of params.collapsedThreadIds ?? []) {
    if (params.visibleTraceGraph.traceGraph.spanLayout === 'manual') {
      break;
    }
    if (params.expandedThreadIds?.has(streamId)) {
      continue;
    }
    collapsedTrackIds.add(getStreamTrackId(streamId));
  }
  const collapsedTrackIdDurationMs = performance.now() - collapsedTrackIdStartTime;
  const trackLayoutStartTime = performance.now();
  const trackLayout = buildSeparateThreadTrackLayout({
    descriptors: buildState.descriptors,
    rootTrackIds: buildState.rootTrackIds,
    layoutConfiguration: getLayoutDensityPreset(params.layoutDensity),
    maxTimeMs: params.visibleTraceGraph.maxTimeMs,
    collapsedTrackIds
  });
  const trackLayoutDurationMs = performance.now() - trackLayoutStartTime;
  const materializeStartTime = performance.now();
  const {layout, rankSpacings} = materializeSeparateThreadLayout({
    visibleTraceGraph: params.visibleTraceGraph,
    maxTimeMs: params.visibleTraceGraph.maxTimeMs,
    layoutConfiguration: getLayoutDensityPreset(params.layoutDensity),
    trackLayout,
    rankStates: buildState.rankStates,
    streamStatesById: buildState.streamStatesById,
    traceGraph: params.expandedLayout.traceGraph,
    useExpandedOffsets: false
  });
  const materializeDurationMs = performance.now() - materializeStartTime;
  log.probe(0, 'applySeparateThreadTrackLayoutCollapseState done', {
    graphName: params.visibleTraceGraph.name,
    processCount: params.visibleTraceGraph.processes.length,
    descriptorCount: buildState.descriptors.length,
    collapsedTrackCount: collapsedTrackIds.size,
    collapsedProcessCount: params.collapsedProcessIds?.size ?? 0,
    expandedThreadCount: params.expandedThreadIds?.size ?? 0,
    collapsedThreadCount: params.collapsedThreadIds?.size ?? 0,
    descriptorDurationMs,
    collapsedTrackIdDurationMs,
    trackLayoutDurationMs,
    materializeDurationMs,
    durationMs: performance.now() - startTime,
    ...getHeapUsageProbeFields()
  })();
  return {
    traceLayout: {
      ...params.expandedLayout,
      processLayouts: layout.processLayouts,
      threadLayoutMap: layout.threadLayoutMap
    },
    rankSpacings
  };
}

/**
 * Applies mask-only stream visibility overrides in combined-thread mode without reflowing ranks.
 */
function applyMaskOnlyCombinedThreadStreamCollapseState(params: {
  traceLayout: TraceLayout;
  visibleTraceGraph: TraceLayoutVisibleGraph;
  expandedThreadIds?: ReadonlySet<TraceThreadId>;
  collapsedThreadIds?: ReadonlySet<TraceThreadId>;
}): TraceLayout {
  const shouldCollapseStream = (threadId: TraceThreadId, baseIsCollapsed: boolean): boolean => {
    if (params.expandedThreadIds?.has(threadId)) {
      return false;
    }
    if (params.collapsedThreadIds?.has(threadId)) {
      return true;
    }
    return baseIsCollapsed;
  };

  const threadRefByStreamId = new Map<TraceThreadId, ThreadRef>();
  for (const process of params.visibleTraceGraph.processes) {
    process.threads.forEach((thread, threadIndex) => {
      const threadRef = process.threadRefs?.[threadIndex];
      if (threadRef != null) {
        threadRefByStreamId.set(thread.threadId, threadRef);
      }
    });
  }

  const threadLayoutMap = Object.entries(params.traceLayout.threadLayoutMap).reduce(
    (acc, [streamIdKey, threadLayout]) => {
      const streamId = streamIdKey as TraceThreadId;
      const isCollapsed = shouldCollapseStream(streamId, threadLayout.lanes?.isCollapsed ?? false);
      acc[streamId] = isCollapsed
        ? ({
            ...threadLayout,
            threadId: streamId,
            threadRef: threadLayout.threadRef ?? threadRefByStreamId.get(streamId),
            visible: false,
            yPosition: HIDDEN_LAYOUT_Y,
            startPosition: [
              threadLayout.startPosition[0],
              HIDDEN_LAYOUT_Y,
              threadLayout.startPosition[2]
            ],
            targetPosition: [
              threadLayout.targetPosition[0],
              HIDDEN_LAYOUT_Y,
              threadLayout.targetPosition[2]
            ],
            lanes: threadLayout.lanes
              ? {
                  ...threadLayout.lanes,
                  laneYPositions: []
                }
              : undefined,
            overflowLabel: undefined
          } satisfies ThreadLayout)
        : ({
            ...threadLayout,
            lanes: threadLayout.lanes
              ? {
                  ...threadLayout.lanes,
                  isCollapsed: false
                }
              : undefined
          } satisfies ThreadLayout);
      return acc;
    },
    {} as Record<TraceThreadId, ThreadLayout>
  );

  return {
    ...params.traceLayout,
    threadLayoutMap
  };
}

/**
 * Rebuilds `combine-threads` process collapse structurally while keeping per-thread stream
 * collapse as a mask-only visibility override.
 */
function applyCombinedThreadProcessCollapseState(params: {
  visibleTraceGraph: TraceLayoutVisibleGraph;
  expandedLayout: TraceLayout;
  expandedRankSpacings: readonly number[];
  settings: Pick<
    TraceVisSettings,
    | 'layoutDensity'
    | 'selectedThreadNames'
    | 'sortThreads'
    | 'maxVisibleLanesPerThread'
    | 'maxVisibleLanesUnlimited'
    | 'threadDisplayMode'
    | 'showEmptyProcesses'
  >;
  collapsedProcessIds?: ReadonlySet<string>;
  expandedThreadIds?: ReadonlySet<TraceThreadId>;
  collapsedThreadIds?: ReadonlySet<TraceThreadId>;
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
}): {traceLayout: TraceLayout; rankSpacings: number[]} {
  const hasCollapsedProcesses = (params.collapsedProcessIds?.size ?? 0) > 0;
  const hasStreamVisibilityOverrides =
    (params.expandedThreadIds?.size ?? 0) > 0 || (params.collapsedThreadIds?.size ?? 0) > 0;
  const hasStreamLaneLayoutOverrides =
    Object.keys(params.threadLaneLayoutOverrides ?? {}).length > 0;
  if (!hasCollapsedProcesses && !hasStreamLaneLayoutOverrides) {
    return {
      traceLayout: hasStreamVisibilityOverrides
        ? applyMaskOnlyCombinedThreadStreamCollapseState({
            traceLayout: params.expandedLayout,
            visibleTraceGraph: params.visibleTraceGraph,
            expandedThreadIds: params.expandedThreadIds,
            collapsedThreadIds: params.collapsedThreadIds
          })
        : params.expandedLayout,
      rankSpacings: [...params.expandedRankSpacings]
    };
  }

  const layoutConfiguration = getLayoutDensityPreset(params.settings.layoutDensity);
  const streamLaneLayoutMap = buildStreamLaneLayoutMap(
    params.visibleTraceGraph,
    params.threadLaneLayoutOverrides
  );
  const collapsedLayoutComputation = calculateTraceLayout({
    processes: params.visibleTraceGraph.processes,
    maxTimeMs: params.visibleTraceGraph.maxTimeMs,
    settings: {
      threadDisplayMode: params.settings.threadDisplayMode,
      selectedThreadNames: params.settings.selectedThreadNames,
      sortThreads: params.settings.sortThreads,
      maxVisibleLanesPerThread: params.settings.maxVisibleLanesPerThread,
      maxVisibleLanesUnlimited: params.settings.maxVisibleLanesUnlimited,
      trackAggregationMode: 'combine-threads',
      showEmptyProcesses: params.settings.showEmptyProcesses
    },
    layoutConfiguration,
    collapsedProcessIds: params.collapsedProcessIds,
    streamLaneLayoutMap,
    traceGraph: params.expandedLayout.traceGraph,
    getSpansForProcess: processId =>
      getVisibleBlocksForProcess(params.visibleTraceGraph, processId),
    getLocalDependenciesForProcess: processId =>
      getVisibleLocalDependenciesForProcess(params.visibleTraceGraph, processId),
    getLaneBlocksForProcess: processId =>
      getVisibleLaneBlocksForProcess(params.visibleTraceGraph, processId),
    getLaneLocalDependenciesForProcess: processId =>
      getVisibleLaneLocalDependenciesForProcess(params.visibleTraceGraph, processId)
  });
  const collapsedLayout = collapsedLayoutComputation.layout;

  return {
    traceLayout: hasStreamVisibilityOverrides
      ? applyMaskOnlyCombinedThreadStreamCollapseState({
          traceLayout: collapsedLayout,
          visibleTraceGraph: params.visibleTraceGraph,
          expandedThreadIds: params.expandedThreadIds,
          collapsedThreadIds: params.collapsedThreadIds
        })
      : collapsedLayout,
    rankSpacings: collapsedLayoutComputation.rankSpacings
  };
}

function applyTraceLayoutCollapseState(params: {
  visibleTraceGraph: TraceLayoutVisibleGraph;
  expandedLayout: TraceLayout;
  expandedRankSpacings: readonly number[];
  aggregationMode: TrackAggregationMode;
  settings: Pick<
    TraceVisSettings,
    | 'layoutDensity'
    | 'selectedThreadNames'
    | 'sortThreads'
    | 'maxVisibleLanesPerThread'
    | 'maxVisibleLanesUnlimited'
    | 'threadDisplayMode'
    | 'trackAggregationMode'
    | 'showEmptyProcesses'
  >;
  collapsedProcessIds?: ReadonlySet<string>;
  expandedThreadIds?: ReadonlySet<TraceThreadId>;
  collapsedThreadIds?: ReadonlySet<TraceThreadId>;
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
}): {traceLayout: TraceLayout; rankSpacings: number[]} {
  if (params.aggregationMode === 'separate-threads') {
    return applySeparateThreadTrackLayoutCollapseState({
      visibleTraceGraph: params.visibleTraceGraph,
      expandedLayout: params.expandedLayout,
      layoutDensity: params.settings.layoutDensity,
      collapsedProcessIds: params.collapsedProcessIds,
      expandedThreadIds: params.expandedThreadIds,
      collapsedThreadIds: params.collapsedThreadIds,
      threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
    });
  }
  if (params.aggregationMode === 'combine-threads') {
    return applyCombinedThreadProcessCollapseState({
      visibleTraceGraph: params.visibleTraceGraph,
      expandedLayout: params.expandedLayout,
      expandedRankSpacings: params.expandedRankSpacings,
      settings: params.settings,
      collapsedProcessIds: params.collapsedProcessIds,
      expandedThreadIds: params.expandedThreadIds,
      collapsedThreadIds: params.collapsedThreadIds,
      threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
    });
  }
  throw new Error(`Unsupported track aggregation mode: ${String(params.aggregationMode)}`);
}

function buildStreamLaneLayoutMap(
  traceGraph: TraceLayoutVisibleGraph,
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides
): Readonly<Record<TraceThreadId, ThreadLaneMetadata>> | undefined {
  const threadLaneLayoutMap = traceGraph.traceGraph.getVisibleLaneLayoutInfo().threadLaneLayoutMap;
  if (!threadLaneLayoutOverrides) {
    return threadLaneLayoutMap;
  }
  return {
    ...threadLaneLayoutMap,
    ...Object.fromEntries(
      Object.entries(threadLaneLayoutOverrides).map(([streamId, override]) => [
        streamId,
        {
          laneCount: threadLaneLayoutMap?.[streamId as TraceThreadId]?.laneCount ?? 1,
          ...threadLaneLayoutMap?.[streamId as TraceThreadId],
          ...override
        } satisfies ThreadLaneMetadata
      ])
    )
  };
}

export function buildTraceLayouts(params: {
  /** Optional prebuilt filtered graphs used as the canonical layout inputs. */
  prebuiltTraceGraphs?: Readonly<TraceGraph[]>;
  /** Source graphs used to build filtered graphs when no filtered inputs are supplied. */
  traceGraphs: Readonly<TraceGraphData[]>;
  /** Optional prior layouts paired by graph index for process-local reuse. */
  previousLayouts?: ReadonlyArray<TraceLayout | undefined>;
  /** Vertical inset applied to the first visible process row in each final graph layout. */
  topPadding?: number;
  settings: Pick<
    TraceVisSettings,
    | 'threadDisplayMode'
    | 'selectedThreadNames'
    | 'sortThreads'
    | 'maxVisibleLanesPerThread'
    | 'maxVisibleLanesUnlimited'
    | 'showCrossProcessDependencies'
    | 'localDependencyMode'
    | 'layoutDensity'
    | 'processLayoutMode'
    | 'trackAggregationMode'
    | 'spanFilter'
    | 'showEmptyProcesses'
  > & {showGlobalEvents?: boolean};
  layoutMode?: TraceLayoutMode;
  /** Ref-native collapse state aligned to the input graph list. */
  collapseState?: TraceLayoutCollapseState;
  /** Optional per-stream lane focus overrides used by interactive lane hiding. */
  threadLaneLayoutOverrides?: Readonly<
    Record<TraceThreadId, Pick<ThreadLaneMetadata, 'visibleLaneIndices'>>
  >;
  /** Optional timing key used to rebuild block geometry before returning the final layouts. */
  timingKey?: string | null;
  /** Canonical minimum time paired with timing-key geometry rebuilds. */
  minTimeMs?: number;
  /** Whether to attach a precomputed collapsed-process minimap layout to each returned layout. */
  buildMinimapLayouts?: boolean;
  /** Overview-summary minimap padding as a fraction of minimap layout height. */
  minimapTopPaddingFraction?: number;
}): TraceLayout[] {
  const buildStartTime = performance.now();
  const layoutMode = params.layoutMode ?? params.settings.processLayoutMode ?? 'interleaved';
  const topPadding = params.topPadding ?? 0;
  const filteredGraphsToLayout = params.prebuiltTraceGraphs
    ? layoutMode === 'step1'
      ? params.prebuiltTraceGraphs.slice(0, 1)
      : params.prebuiltTraceGraphs
    : undefined;
  const sourceGraphsToLayout =
    filteredGraphsToLayout?.map(traceGraph => traceGraph) ??
    (layoutMode === 'step1' ? params.traceGraphs.slice(0, 1) : params.traceGraphs);
  if (sourceGraphsToLayout.length === 0) {
    return [];
  }
  log.probe(0, 'buildTraceLayouts start', {
    graphCount: sourceGraphsToLayout.length,
    hasPrebuiltFilteredGraphs: Boolean(filteredGraphsToLayout),
    layoutMode,
    spanFilter: params.settings.spanFilter ?? '',
    previousLayoutCount: params.previousLayouts?.length ?? 0,
    buildMinimapLayouts: params.buildMinimapLayouts === true,
    totalSpanCount: sourceGraphsToLayout.reduce(
      (count, traceGraph) => count + (traceGraph.stats?.spanCount ?? 0),
      0
    )
  })();
  const collapsedComputationStartTime = performance.now();
  let traceGraphConstructDurationMs = 0;
  let visibleTraceGraphDurationMs = 0;
  let processRelativeLayoutDurationMs = 0;
  let layoutCompositionDurationMs = 0;
  let withinGraphRankDeltaDurationMs = 0;
  const collapsedComputation = sourceGraphsToLayout.map((sourceTraceGraph, index) => {
    const traceGraphConstructStartTime = performance.now();
    const traceGraph =
      filteredGraphsToLayout?.[index] ??
      new TraceGraph(
        createStaticTraceGraphRuntimeSource({
          identityKey: `${sourceTraceGraph.name}:collapsed-layout:${index}`,
          traceGraphData: sourceTraceGraph
        }),
        {
          spanFilters: params.settings.spanFilter ? [params.settings.spanFilter] : undefined
        }
      );
    traceGraphConstructDurationMs += performance.now() - traceGraphConstructStartTime;
    const visibleTraceGraphStartTime = performance.now();
    const visibleTraceGraph = buildVisibleTraceGraph(traceGraph);
    visibleTraceGraphDurationMs += performance.now() - visibleTraceGraphStartTime;
    const aggregationMode = getEffectiveTrackAggregationMode(
      traceGraph,
      params.settings.trackAggregationMode
    );
    const resolvedCollapseState = resolveTraceGraphCollapseState({
      traceGraph,
      collapseState: params.collapseState?.graphs[index]
    });
    const processRelativeLayoutStartTime = performance.now();
    log.probe(0, 'buildTraceLayouts process-relative start', {
      graphIndex: index,
      graphName: traceGraph.name,
      processCount: visibleTraceGraph.processes.length,
      spanCount: traceGraph.stats.spanCount,
      hasPreviousLayout: Boolean(params.previousLayouts?.[index])
    })();
    const processRelativeLayouts = buildProcessRelativeLayoutArtifacts({
      visibleTraceGraph,
      previousLayout: params.previousLayouts?.[index],
      settings: {
        threadDisplayMode: params.settings.threadDisplayMode,
        selectedThreadNames: params.settings.selectedThreadNames,
        sortThreads: params.settings.sortThreads,
        layoutDensity: params.settings.layoutDensity,
        maxVisibleLanesPerThread: params.settings.maxVisibleLanesPerThread,
        maxVisibleLanesUnlimited: params.settings.maxVisibleLanesUnlimited,
        trackAggregationMode: aggregationMode,
        showEmptyProcesses: params.settings.showEmptyProcesses
      },
      traceGraph,
      collapsedProcessIds: resolvedCollapseState.collapsedProcessIds,
      expandedThreadIds: resolvedCollapseState.expandedThreadIds,
      collapsedThreadIds: resolvedCollapseState.collapsedThreadIds,
      threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
    });
    processRelativeLayoutDurationMs += performance.now() - processRelativeLayoutStartTime;
    log.probe(0, 'buildTraceLayouts process-relative done', {
      graphIndex: index,
      graphName: traceGraph.name,
      processCount: visibleTraceGraph.processes.length,
      durationMs: performance.now() - processRelativeLayoutStartTime
    })();
    const layoutCompositionStartTime = performance.now();
    const processSeparation = getLayoutDensityPreset(
      params.settings.layoutDensity
    ).processSeparation;
    const expandedLayoutComputation = composeTraceLayoutFromProcessRelativeArtifacts({
      traceGraph: visibleTraceGraph.traceGraph,
      artifacts: processRelativeLayouts.expandedArtifacts,
      processSeparation
    });
    const collapsedState = composeTraceLayoutFromProcessRelativeArtifacts({
      traceGraph: visibleTraceGraph.traceGraph,
      artifacts: processRelativeLayouts.collapsedArtifacts,
      processSeparation
    });
    layoutCompositionDurationMs += performance.now() - layoutCompositionStartTime;
    const withinGraphRankDeltaStartTime = performance.now();
    const withinGraphExpandedLayout = applyRankDeltas({
      layout: expandedLayoutComputation.layout,
      traceGraph: visibleTraceGraph,
      rankDeltas: computeProcessRelativeRankDeltas(expandedLayoutComputation.rankSpacings),
      trackAggregationMode: aggregationMode
    });
    const withinGraphCollapsedLayout = applyRankDeltas({
      layout: collapsedState.layout,
      traceGraph: visibleTraceGraph,
      rankDeltas: computeProcessRelativeRankDeltas(collapsedState.rankSpacings),
      trackAggregationMode: aggregationMode
    });
    const graphRankDeltaDurationMs = performance.now() - withinGraphRankDeltaStartTime;
    withinGraphRankDeltaDurationMs += graphRankDeltaDurationMs;

    log.probe(0, 'buildTraceLayouts graph composition done', {
      graphIndex: index,
      graphName: traceGraph.name,
      processCount: visibleTraceGraph.processes.length,
      expandedArtifactCount: processRelativeLayouts.expandedArtifacts.length,
      collapsedArtifactCount: processRelativeLayouts.collapsedArtifacts.length,
      layoutCompositionDurationMs: performance.now() - layoutCompositionStartTime,
      rankDeltaDurationMs: graphRankDeltaDurationMs
    })();

    return {
      traceGraph,
      traceLayout: withinGraphCollapsedLayout,
      rankSpacings: collapsedState.rankSpacings,
      visibleTraceGraph,
      expandedLayout: withinGraphExpandedLayout,
      aggregationMode,
      reuseState: {
        entriesByProcessId: processRelativeLayouts.entriesByProcessId
      } satisfies TraceLayoutReuseState,
      reusedExpandedProcessCount: processRelativeLayouts.reusedExpandedProcessCount,
      reusedCollapsedProcessCount: processRelativeLayouts.reusedCollapsedProcessCount
    };
  });
  const reusedExpandedProcessCount = collapsedComputation.reduce(
    (sum, computation) => sum + computation.reusedExpandedProcessCount,
    0
  );
  const reusedCollapsedProcessCount = collapsedComputation.reduce(
    (sum, computation) => sum + computation.reusedCollapsedProcessCount,
    0
  );
  const collapsedComputationDurationMs = performance.now() - collapsedComputationStartTime;

  const interGraphRankDeltaStartTime = performance.now();
  const effectiveLayoutMode = layoutMode === 'interleaved' ? 'interleaved' : 'sequential';
  const rankDeltas =
    effectiveLayoutMode === 'interleaved'
      ? computeInterleavedRankDeltas(
          collapsedComputation.map(computation => ({
            traceGraph: computation.visibleTraceGraph,
            layout: computation.traceLayout,
            rankSpacings: computation.rankSpacings
          }))
        )
      : computeSequentialRankDeltas(
          collapsedComputation.map(computation => ({
            traceGraph: computation.visibleTraceGraph,
            layout: computation.traceLayout,
            rankSpacings: computation.rankSpacings
          }))
        );
  const interGraphRankDeltaDurationMs = performance.now() - interGraphRankDeltaStartTime;

  const collapsedProcessMinimumRankSpacing = getCollapsedProcessMinimumRankSpacing(
    getLayoutDensityPreset(params.settings.layoutDensity)
  );
  const globalEventRowHeights = collapsedComputation.map(computation =>
    params.settings.showGlobalEvents && computation.traceGraph.events.numRows > 0
      ? getGlobalEventRowHeight({
          collapsedProcessMinimumRankSpacing,
          firstRankSpacing:
            computation.rankSpacings[0] ?? computation.traceLayout.processLayouts[0]?.yHeight
        })
      : 0
  );
  const normalizedRankDeltas = normalizeInterGraphRankDeltas({
    computations: collapsedComputation.map((computation, index) => ({
      traceLayout: computation.traceLayout,
      rankDeltas: rankDeltas[index] ?? [],
      minimumVisibleRankYOffset: topPadding
    }))
  });

  const updatedLayouts: TraceLayout[] = [];
  let finalRankDeltaDurationMs = 0;
  let geometryRebuildDurationMs = 0;
  let layoutFinalizeDurationMs = 0;
  for (const [index, computation] of collapsedComputation.entries()) {
    const layoutFinalizeStartTime = performance.now();
    const globalEventRowHeight = globalEventRowHeights[index] ?? 0;
    const rankDeltasForGraph = normalizedRankDeltas[index] ?? [];
    const finalRankDeltaStartTime = performance.now();
    const adjustedLayout = applyRankDeltas({
      layout: computation.traceLayout,
      traceGraph: computation.visibleTraceGraph,
      rankDeltas: rankDeltasForGraph,
      trackAggregationMode: computation.aggregationMode
    });
    const adjustedExpandedLayout = applyRankDeltas({
      layout: computation.expandedLayout,
      traceGraph: computation.visibleTraceGraph,
      rankDeltas: rankDeltasForGraph,
      trackAggregationMode: computation.aggregationMode
    });
    finalRankDeltaDurationMs += performance.now() - finalRankDeltaStartTime;
    const previousGeometryCache = params.previousLayouts?.[index]?.geometryCache;
    const geometryInputLayout = previousGeometryCache
      ? ({
          ...adjustedLayout,
          geometryCache: previousGeometryCache
        } satisfies TraceLayout)
      : adjustedLayout;

    const geometryRebuildStartTime = performance.now();
    log.probe(0, 'buildTraceLayouts geometry rebuild start', {
      graphIndex: index,
      graphName: computation.traceGraph.name,
      processCount: computation.visibleTraceGraph.processes.length,
      spanCount: computation.traceGraph.stats.spanCount,
      hasPreviousGeometryCache: Boolean(previousGeometryCache)
    })();
    const geometryMinTimeMs = getTraceLayoutGeometryMinTimeMs({
      graphCount: sourceGraphsToLayout.length,
      traceGraph: computation.traceGraph,
      minTimeMs: params.minTimeMs
    });
    const rebuiltLayout = rebuildTraceLayoutGeometry({
      traceGraph: computation.traceGraph,
      prebuiltTraceGraph: computation.traceGraph,
      visibleTraceGraph: computation.visibleTraceGraph,
      traceLayout: geometryInputLayout,
      settings: {
        localDependencyMode: params.settings.localDependencyMode,
        layoutDensity: params.settings.layoutDensity
      },
      timingKey: params.timingKey,
      minTimeMs: geometryMinTimeMs
    });
    geometryRebuildDurationMs += performance.now() - geometryRebuildStartTime;
    log.probe(0, 'buildTraceLayouts geometry rebuild done', {
      graphIndex: index,
      graphName: computation.traceGraph.name,
      durationMs: performance.now() - geometryRebuildStartTime
    })();

    const expandedBoundsStartTime = performance.now();
    const expandedBounds = computeTraceLayoutBounds({
      traceLayout: adjustedExpandedLayout,
      minTimeMs: computation.traceGraph.minTimeMs,
      maxTimeMs: computation.traceGraph.maxTimeMs
    });
    const expandedBoundsDurationMs = performance.now() - expandedBoundsStartTime;

    const buildRowsStartTime = performance.now();
    const renderRows = buildTraceLayoutRows({
      traceGraph: computation.visibleTraceGraph,
      processLayouts: rebuiltLayout.processLayouts
    });
    const buildRowsDurationMs = performance.now() - buildRowsStartTime;
    const refIndexStartTime = performance.now();
    const updatedLayout = attachTraceLayoutReuseState(
      withTraceLayoutRefIndexes({
        traceGraph: computation.traceGraph,
        traceLayout: {
          ...rebuiltLayout,
          renderRows,
          globalEventRow:
            globalEventRowHeight > 0
              ? {
                  yPosition: topPadding - globalEventRowHeight * 0.5,
                  height: globalEventRowHeight
                }
              : undefined,
          expandedBounds
        } satisfies TraceLayout
      }),
      computation.reuseState
    );
    const refIndexDurationMs = performance.now() - refIndexStartTime;

    updatedLayouts.push(updatedLayout);
    layoutFinalizeDurationMs += performance.now() - layoutFinalizeStartTime;
    log.probe(0, 'buildTraceLayouts finalize layout done', {
      graphIndex: index,
      graphName: computation.traceGraph.name,
      processCount: rebuiltLayout.processLayouts.length,
      renderRowCount: renderRows.length,
      expandedBoundsDurationMs,
      buildRowsDurationMs,
      refIndexDurationMs,
      durationMs: performance.now() - layoutFinalizeStartTime,
      ...getHeapUsageProbeFields()
    })();
  }
  const minimapStartTime = performance.now();
  const layoutsWithMinimap = params.buildMinimapLayouts
    ? attachMinimapLayouts({
        layouts: updatedLayouts,
        minimapLayouts: buildLightweightTraceMinimapLayouts({layouts: updatedLayouts}),
        summaryPaddingFraction:
          params.minimapTopPaddingFraction ?? DEFAULT_MINIMAP_SUMMARY_PADDING_FRACTION
      })
    : updatedLayouts;
  const minimapDurationMs = performance.now() - minimapStartTime;
  if (params.buildMinimapLayouts) {
    log.probe(0, 'buildTraceLayouts minimap attach done', {
      graphCount: layoutsWithMinimap.length,
      durationMs: minimapDurationMs,
      ...getHeapUsageProbeFields()
    })();
  }

  log.probe(0, 'buildTraceLayouts done', {
    graphCount: layoutsWithMinimap.length,
    hasPrebuiltFilteredGraphs: Boolean(filteredGraphsToLayout),
    layoutMode,
    spanFilter: params.settings.spanFilter ?? '',
    reusedExpandedProcessCount,
    reusedCollapsedProcessCount,
    traceGraphConstructDurationMs,
    visibleTraceGraphDurationMs,
    processRelativeLayoutDurationMs,
    layoutCompositionDurationMs,
    withinGraphRankDeltaDurationMs,
    collapsedComputationDurationMs,
    interGraphRankDeltaDurationMs,
    finalRankDeltaDurationMs,
    geometryRebuildDurationMs,
    layoutFinalizeDurationMs,
    minimapDurationMs,
    durationMs: performance.now() - buildStartTime,
    ...getHeapUsageProbeFields()
  })();
  return layoutsWithMinimap;
}

/**
 * Returns the X-origin to use for geometry normalization within one layout graph.
 */
function getTraceLayoutGeometryMinTimeMs(params: {
  /** Number of graphs participating in the current layout build. */
  graphCount: number;
  /** Runtime graph whose spans are being converted into layout geometry. */
  traceGraph: TraceGraph;
  /** Optional caller-provided origin for single-graph layout bounds. */
  minTimeMs?: number;
}): number | undefined {
  return params.graphCount > 1 ? params.traceGraph.minTimeMs : params.minTimeMs;
}

export function buildTraceLayout(params: {
  traceGraph: TraceGraphData;
  /** Optional prior layout for process-local reuse when rebuilding the same graph. */
  previousLayout?: TraceLayout;
  /** Vertical inset applied to the first visible process row in the final layout. */
  topPadding?: number;
  settings: Pick<
    TraceVisSettings,
    | 'threadDisplayMode'
    | 'selectedThreadNames'
    | 'sortThreads'
    | 'maxVisibleLanesPerThread'
    | 'maxVisibleLanesUnlimited'
    | 'showCrossProcessDependencies'
    | 'localDependencyMode'
    | 'layoutDensity'
    | 'processLayoutMode'
    | 'trackAggregationMode'
    | 'spanFilter'
    | 'showEmptyProcesses'
  > & {showGlobalEvents?: boolean};
  /** Ref-native collapse state for this single graph layout. */
  collapseState?: TraceLayoutCollapseState;
  layoutMode?: TraceLayoutMode;
}): TraceLayout {
  const layouts = buildTraceLayouts({
    traceGraphs: [params.traceGraph],
    previousLayouts: params.previousLayout ? [params.previousLayout] : undefined,
    topPadding: params.topPadding,
    settings: params.settings,
    collapseState: params.collapseState,
    layoutMode: params.layoutMode
  });
  return layouts[0]!;
}

/**
 * Builds a compact layout that only keeps lanes containing the requested span refs visible.
 */
export function buildTraceLayoutForSpanRefs(params: {
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
}): TraceLayout {
  return buildTraceLayoutForSpanRefsImpl({
    ...params,
    rebuildGeometry: rebuildTraceLayoutGeometry,
    resolveCollapseState: resolveTraceGraphCollapseState,
    withRefIndexes: traceLayout =>
      withTraceLayoutRefIndexes({traceGraph: params.traceGraph, traceLayout})
  });
}

export function rebuildTraceLayoutGeometry(params: {
  traceGraph: TraceGraphData;
  prebuiltTraceGraph?: TraceGraph;
  visibleTraceGraph?: TraceLayoutVisibleGraph;
  traceLayout: TraceLayout;
  settings: Pick<TraceVisSettings, 'localDependencyMode' | 'layoutDensity'>;
  timingKey?: string | null;
  minTimeMs?: number;
  /** Optional exact visible block ids to retain when rebuilding focused geometry. */
  includedBlockIdsByProcessId?: Readonly<Record<string, ReadonlySet<TraceSpanId>>>;
}): TraceLayout {
  const resolvedTraceGraph =
    params.prebuiltTraceGraph ??
    (params.visibleTraceGraph
      ? undefined
      : new TraceGraph(
          createStaticTraceGraphRuntimeSource({
            identityKey: `${params.traceGraph.name}:geometry-layout`,
            traceGraphData: params.traceGraph
          })
        ));
  const sourceTraceGraph: TraceGraphData = resolvedTraceGraph ?? params.traceGraph;
  const visibleTraceGraph = resolvedTraceGraph
    ? buildVisibleTraceGraph(resolvedTraceGraph)
    : params.visibleTraceGraph;
  if (
    visibleTraceGraph &&
    canReuseTraceLayoutGeometry({
      visibleTraceGraph,
      timingKey: params.timingKey,
      minTimeMs: params.minTimeMs
    })
  ) {
    return params.traceLayout;
  }
  const rebuiltLayout = populateTraceLayoutGeometry({
    traceGraph: sourceTraceGraph,
    visibleTraceGraph,
    traceLayout: params.traceLayout,
    settings: {
      localDependencyMode: params.settings.localDependencyMode
    },
    timingKey: params.timingKey,
    minTimeMs: params.minTimeMs,
    blockHeight: getLayoutDensityPreset(params.settings.layoutDensity).blockHeight,
    includedBlockIdsByProcessId: params.includedBlockIdsByProcessId
  });
  return copyTraceLayoutReuseState(
    params.traceLayout,
    withTraceLayoutRefIndexes({
      traceGraph: resolvedTraceGraph ?? params.traceLayout.traceGraph,
      traceLayout: {
        ...rebuiltLayout,
        minimapLayout: params.traceLayout.minimapLayout,
        expandedBounds: rebuiltLayout.currentBounds
      } satisfies TraceLayout
    })
  );
}

/**
 * Adds one shared top-padding normalization to all graph rank deltas after inter-graph stacking.
 */
function normalizeInterGraphRankDeltas(params: {
  /** Per-graph rank delta inputs to normalize with one shared additive offset. */
  computations: ReadonlyArray<{
    /** Graph-local layout before the final inter-graph rank translation is applied. */
    traceLayout: TraceLayout;
    /** Per-rank Y deltas produced by the inter-graph rank stacking algorithm. */
    rankDeltas: readonly number[];
    /** Minimum visible Y position allowed for this graph after translation. */
    minimumVisibleRankYOffset: number;
  }>;
}): number[][] {
  let normalizationDelta = 0;
  for (const computation of params.computations) {
    let minYOffset = Number.POSITIVE_INFINITY;
    computation.traceLayout.processLayouts.forEach((rankLayout, rankIndex) => {
      const yOffset = rankLayout.yOffset + (computation.rankDeltas[rankIndex] ?? 0);
      if (Number.isFinite(yOffset)) {
        minYOffset = Math.min(minYOffset, yOffset);
      }
    });

    if (Number.isFinite(minYOffset) && minYOffset < computation.minimumVisibleRankYOffset) {
      normalizationDelta = Math.max(
        normalizationDelta,
        computation.minimumVisibleRankYOffset - minYOffset
      );
    }
  }

  return params.computations.map(computation =>
    computation.rankDeltas.map(delta => delta + normalizationDelta)
  );
}

/**
 * Returns a dedicated global-event track height that stays above the collapsed-process minimum
 * while avoiding a full process-sized row.
 */
function getGlobalEventRowHeight(params: {
  collapsedProcessMinimumRankSpacing: number;
  firstRankSpacing: number | undefined;
}): number {
  const baseHeight = params.collapsedProcessMinimumRankSpacing;
  if (
    params.firstRankSpacing === undefined ||
    !Number.isFinite(params.firstRankSpacing) ||
    params.firstRankSpacing <= baseHeight
  ) {
    return baseHeight;
  }
  return baseHeight + (params.firstRankSpacing - baseHeight) * 0.5;
}
