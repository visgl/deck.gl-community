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
  buildVisibleTraceGraph,
  buildVisibleTraceGraphForProcess,
  computeTraceLayoutBounds,
  getObjectIdentityId,
  getProcessSpanChunkCacheKey,
  getVisibleGeometrySpansForProcess,
  getVisibleLaneLocalDependenciesForProcess,
  getVisibleLaneSpansForProcess,
  getVisibleLocalDependenciesForProcess
} from './trace-geometry-layout-helpers';
import {
  buildTraceLayoutOverflowLabels,
  buildTraceLayoutProcessLayoutMapByRef,
  buildTraceLayoutRows,
  getTraceLayoutProcessLayoutByRef
} from './trace-layout';

import type {TraceGraphData} from '../ingestion/arrow-trace';
import type {ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
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

/** Ref-native process and thread collapse overrides resolved for one layout build. */
type ResolvedTraceGraphCollapseState = {
  /** Optional process ids rendered as collapsed rows. */
  readonly collapsedProcessIds?: ReadonlySet<string>;
  /** Optional thread refs forced open in the rendered layout. */
  readonly expandedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Optional thread refs forced closed in the rendered layout. */
  readonly collapsedThreadRefs?: ReadonlySet<ThreadRef>;
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

/** Copies internal lane-layout reuse state from one TraceLayout to another. */
function copyTraceLayoutReuseState(source: TraceLayout, target: TraceLayout): TraceLayout {
  const reuseState = getTraceLayoutReuseState(source);
  if (!reuseState) {
    return target;
  }
  return attachTraceLayoutReuseState(target, reuseState);
}

/** Preserves the ref-native TraceLayout contract at final layout assembly. */
function withTraceLayoutRefIndexes(params: {
  traceGraph?: Readonly<TraceGraph>;
  traceLayout: TraceLayout;
}): TraceLayout {
  void params.traceGraph;
  return {
    ...params.traceLayout,
    processLayoutMapByRef: buildTraceLayoutProcessLayoutMapByRef(params.traceLayout.processLayouts)
  };
}

/** Returns the per-process lane metadata slice that affects local layout structure. */
function getVisibleThreadLaneLayoutForProcess(params: {
  traceGraph: Readonly<TraceGraph>;
  process: Readonly<TraceLayoutVisibleProcessMetadata>;
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
}): ReadonlyMap<ThreadRef, ThreadLaneMetadata> {
  const threadLaneLayoutMapByRef =
    params.traceGraph.getVisibleLaneLayoutInfo().threadLaneLayoutMapByRef ?? new Map();
  const laneMetadataByRef = new Map<ThreadRef, ThreadLaneMetadata>();
  params.process.threads.forEach((thread, threadIndex) => {
    const threadRef = params.process.threadRefs[threadIndex];
    if (threadRef == null) {
      return;
    }
    const laneMetadata = threadLaneLayoutMapByRef.get(threadRef);
    const override = params.threadLaneLayoutOverrides?.[thread.threadId];
    if (laneMetadata || override) {
      laneMetadataByRef.set(
        threadRef,
        laneMetadata ? {...laneMetadata, ...override} : {laneCount: 1, ...override}
      );
    }
  });
  return laneMetadataByRef;
}

/** Filters explicit per-thread expansion overrides down to one process. */
function getProcessExpandedThreadRefs(params: {
  process: Readonly<TraceLayoutVisibleProcessMetadata>;
  /** Optional global thread refs forced open before process filtering. */
  expandedThreadRefs?: ReadonlySet<ThreadRef>;
}): ReadonlySet<ThreadRef> | undefined {
  if (!params.expandedThreadRefs || params.expandedThreadRefs.size === 0) {
    return undefined;
  }
  const processThreadRefs = new Set(params.process.threadRefs ?? []);
  const filtered = new Set<ThreadRef>();
  for (const threadRef of params.expandedThreadRefs) {
    if (processThreadRefs.has(threadRef)) {
      filtered.add(threadRef);
    }
  }
  return filtered.size > 0 ? filtered : undefined;
}

/** Filters explicit per-thread collapse overrides down to one process. */
function getProcessCollapsedThreadRefs(params: {
  process: Readonly<TraceLayoutVisibleProcessMetadata>;
  /** Optional global thread refs forced closed before process filtering. */
  collapsedThreadRefs?: ReadonlySet<ThreadRef>;
}): ReadonlySet<ThreadRef> | undefined {
  if (!params.collapsedThreadRefs || params.collapsedThreadRefs.size === 0) {
    return undefined;
  }
  const processThreadRefs = new Set(params.process.threadRefs ?? []);
  const filtered = new Set<ThreadRef>();
  for (const threadRef of params.collapsedThreadRefs) {
    if (processThreadRefs.has(threadRef)) {
      filtered.add(threadRef);
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
  /** Optional process-local thread refs forced open in the reuse fingerprint. */
  expandedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Optional process-local thread refs forced closed in the reuse fingerprint. */
  collapsedThreadRefs?: ReadonlySet<ThreadRef>;
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
  const laneMetadataByThreadRef = getVisibleThreadLaneLayoutForProcess({
    traceGraph: params.visibleTraceGraph.traceGraph,
    process: params.process,
    threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
  });
  const threadSummaryKey = buildProcessThreadSummaryKey(params.process);
  const expandedStreamKey = [...(params.expandedThreadRefs ?? [])].sort().join('|');
  const collapsedStreamKey = [...(params.collapsedThreadRefs ?? [])].sort().join('|');
  const laneMetadataKey = buildLaneMetadataSummaryKey(laneMetadataByThreadRef);

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
    process.threadRefs.length,
    process.threadRefs[0] ?? '',
    process.threadRefs[process.threadRefs.length - 1] ?? ''
  ].join(':');
}

function buildLaneMetadataSummaryKey(
  laneMetadataByThreadRef: ReadonlyMap<ThreadRef, ThreadLaneMetadata>
): string {
  let entryCount = 0;
  let laneCountTotal = 0;
  let collapsedCount = 0;
  let visibleLaneIndexCount = 0;
  let firstThreadRef = '';
  let lastThreadRef = '';

  for (const [threadRef, laneMetadata] of laneMetadataByThreadRef) {
    if (entryCount === 0) {
      firstThreadRef = String(threadRef);
    }
    lastThreadRef = String(threadRef);
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
    firstThreadRef,
    lastThreadRef
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
  const threadLaneLayoutMapByRef = getVisibleThreadLaneLayoutForProcess({
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
      threadLaneLayoutMapByRef,
      traceGraph: params.traceGraph as TraceGraph,
      getSpansForProcess: processId =>
        getVisibleGeometrySpansForProcess(params.visibleTraceGraph, processId),
      getLocalDependenciesForProcess: processId =>
        getVisibleLocalDependenciesForProcess(params.visibleTraceGraph, processId),
      getLaneSpansForProcess: processId =>
        getVisibleLaneSpansForProcess(params.visibleTraceGraph, processId),
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
    threadLaneLayoutMapByRef,
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
  /** Optional process-local thread refs forced open in the relative layout. */
  expandedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Optional process-local thread refs forced closed in the relative layout. */
  collapsedThreadRefs?: ReadonlySet<ThreadRef>;
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
}): ProcessRelativeLayoutArtifact {
  const process = params.visibleTraceGraph.processes[0]!;
  const usesManualSpanLayout = params.traceGraph.spanLayout === 'manual';
  const processExpandedThreadRefs = usesManualSpanLayout
    ? undefined
    : getProcessExpandedThreadRefs({
        process,
        expandedThreadRefs: params.expandedThreadRefs
      });
  const processCollapsedThreadRefs = usesManualSpanLayout
    ? undefined
    : getProcessCollapsedThreadRefs({
        process,
        collapsedThreadRefs: params.collapsedThreadRefs
      });
  const isProcessCollapsed = params.collapsedProcessIds?.has(process.processId) ?? false;
  const hasProcessSpecificOverrides =
    isProcessCollapsed ||
    (processExpandedThreadRefs?.size ?? 0) > 0 ||
    (processCollapsedThreadRefs?.size ?? 0) > 0;
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
    expandedThreadRefs: processExpandedThreadRefs,
    collapsedThreadRefs: processCollapsedThreadRefs,
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
  const threadLayoutMapByRef = new Map<ThreadRef, ThreadLayout>();
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
    for (const [threadRef, threadLayout] of artifact.layout.threadLayoutMapByRef) {
      threadLayoutMapByRef.set(threadRef, threadLayout);
    }
  });

  return {
    layout: {
      layoutConfiguration: params.artifacts[0]?.layout.layoutConfiguration,
      traceGraph: params.traceGraph as TraceGraph,
      processLayouts,
      processLayoutMapByRef: buildTraceLayoutProcessLayoutMapByRef(processLayouts),
      renderRows: [],
      threadLayoutMapByRef,
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

/** Resolves public collapse inputs into exact runtime refs used by layout internals. */
function resolveLegacyTraceGraphCollapseState(params: {
  traceGraph: TraceGraph;
  collapseState?: TraceGraphCollapseState;
  collapsedProcessIds?: ReadonlySet<string>;
  expandedThreadIds?: ReadonlySet<TraceThreadId>;
  collapsedThreadIds?: ReadonlySet<TraceThreadId>;
}): ResolvedTraceGraphCollapseState {
  if (!params.collapseState) {
    return {
      collapsedProcessIds: params.collapsedProcessIds,
      expandedThreadRefs: getThreadRefsForLegacyIds(params.traceGraph, params.expandedThreadIds),
      collapsedThreadRefs: getThreadRefsForLegacyIds(params.traceGraph, params.collapsedThreadIds)
    };
  }

  const collapsedProcessIds = new Set<string>();

  for (const processRef of params.collapseState.collapsedProcessRefs) {
    const processIndex = getProcessRefIndex(processRef);
    const processId = params.traceGraph.processes[processIndex]?.processId;
    if (processId) {
      collapsedProcessIds.add(processId);
    }
  }
  return {
    collapsedProcessIds: collapsedProcessIds.size > 0 ? collapsedProcessIds : undefined,
    expandedThreadRefs:
      params.collapseState.expandedThreadRefs.size > 0
        ? params.collapseState.expandedThreadRefs
        : undefined,
    collapsedThreadRefs:
      params.collapseState.collapsedThreadRefs.size > 0
        ? params.collapseState.collapsedThreadRefs
        : undefined
  };
}

/** Resolves deprecated thread ids to every exact matching runtime thread ref. */
function getThreadRefsForLegacyIds(
  traceGraph: TraceGraph,
  threadIds: ReadonlySet<TraceThreadId> | undefined
): ReadonlySet<ThreadRef> | undefined {
  if (!threadIds || threadIds.size === 0) {
    return undefined;
  }

  const threadRefs = new Set<ThreadRef>();
  for (const threadRef of traceGraph.getThreadRefs()) {
    const threadId = traceGraph.getThreadSourceByRef(threadRef)?.threadId;
    if (threadId != null && threadIds.has(threadId)) {
      threadRefs.add(threadRef);
    }
  }
  return threadRefs.size > 0 ? threadRefs : undefined;
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
  /** Optional graph-wide thread refs forced open before process filtering. */
  expandedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Optional graph-wide thread refs forced closed before process filtering. */
  collapsedThreadRefs?: ReadonlySet<ThreadRef>;
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
    const processExpandedThreadRefs = usesManualSpanLayout
      ? undefined
      : getProcessExpandedThreadRefs({
          process,
          expandedThreadRefs: params.expandedThreadRefs
        });
    const processCollapsedThreadRefs = usesManualSpanLayout
      ? undefined
      : getProcessCollapsedThreadRefs({
          process,
          collapsedThreadRefs: params.collapsedThreadRefs
        });
    const isProcessCollapsed = params.collapsedProcessIds?.has(process.processId) ?? false;
    collapseSetResolutionDurationMs += performance.now() - collapseSetResolutionStartTime;
    const collapsedReuseKeyStartTime = performance.now();
    const collapsedReuseKey = buildProcessRelativeLayoutReuseKey({
      visibleTraceGraph: singleProcessVisibleTraceGraph,
      process,
      settings: params.settings,
      isProcessCollapsed,
      expandedThreadRefs: processExpandedThreadRefs,
      collapsedThreadRefs: processCollapsedThreadRefs,
      threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
    });
    collapsedReuseKeyDurationMs += performance.now() - collapsedReuseKeyStartTime;
    let collapsedArtifact: ProcessRelativeLayoutArtifact;
    let processCollapsedArtifactBuildDurationMs = 0;
    if (previousEntry?.collapsed.reuseKey === collapsedReuseKey) {
      collapsedArtifact = previousEntry.collapsed;
    } else if (!isProcessCollapsed && !processExpandedThreadRefs && !processCollapsedThreadRefs) {
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
        expandedThreadRefs: params.expandedThreadRefs,
        collapsedThreadRefs: params.collapsedThreadRefs,
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
        expandedThreadOverrideCount: processExpandedThreadRefs?.size ?? 0,
        collapsedThreadOverrideCount: processCollapsedThreadRefs?.size ?? 0,
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
      processLayoutMapByRef: buildTraceLayoutProcessLayoutMapByRef(processLayouts),
      renderRows: layout.renderRows.map(row => ({
        ...row,
        isCollapsed: true
      })),
      globalEventRow: layout.globalEventRow,
      threadLayoutMapByRef: layout.threadLayoutMapByRef,
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
  spans: readonly TraceSpanGeometrySource[],
  minimumHeight: number
): number {
  let maxBottomY = 0;
  for (const span of spans) {
    const manualSpanLayout = getManualSpanLayoutGeometry(span);
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
      /** Exact runtime ref for the thread track. */
      threadRef: ThreadRef;
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
      /** Exact runtime ref for the thread track. */
      threadRef: ThreadRef;
      /** Thread id whose non-primary lanes are represented by this compact track. */
      threadId: TraceThreadId;
      /** Number of lanes represented by the compact track. */
      laneCount: number;
    };

type SeparateThreadTrackDescriptor = HierarchicalTrackDescriptor<SeparateThreadTrackObject>;

type SeparateThreadRankState = {
  /** Exact graph-local process ref owning this separate-thread rank state. */
  processRef: ProcessRef;
  processId: string;
  rankIndex: number;
  /** Ordered visible thread refs retained under this separate-thread rank. */
  orderedThreadRefs: ThreadRef[];
};

type SeparateThreadStreamState = {
  processId: string;
  rankIndex: number;
  threadId: TraceThreadId;
  /** Exact graph-local thread ref owning this separate-thread stream state. */
  threadRef: ThreadRef;
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
  /** Separate-thread stream state keyed by canonical runtime thread ref. */
  streamStatesByRef: ReadonlyMap<ThreadRef, SeparateThreadStreamState>;
};

function getRankTrackId(processId: string): string {
  return `rank:${processId}`;
}

/** Returns the hierarchical track id for one rendered thread row. */
function getStreamTrackId(threadRef: ThreadRef): string {
  return `stream:${threadRef}`;
}

/** Returns the hierarchical track id for one rendered thread lane stack. */
function getLaneStackTrackId(threadRef: ThreadRef): string {
  return `lane-stack:${threadRef}`;
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

function buildSeparateThreadDescriptorsFromSourceGraph(params: {
  visibleTraceGraph: TraceLayoutVisibleGraph;
  maxTimeMs: number;
  settings: TrackAggregationSettings;
  layoutConfiguration: ReturnType<typeof getLayoutDensityPreset>;
  /** Optional lane metadata keyed by canonical runtime thread ref. */
  threadLaneLayoutMapByRef?: ReadonlyMap<ThreadRef, ThreadLaneMetadata>;
}): SeparateThreadTrackBuildResult {
  const {visibleTraceGraph, maxTimeMs, settings} = params;
  const usesManualSpanLayout = visibleTraceGraph.traceGraph.spanLayout === 'manual';
  const startTime = performance.now();
  const descriptors: SeparateThreadTrackDescriptor[] = [];
  const rootTrackIds: string[] = [];
  const rankStates: SeparateThreadRankState[] = [];
  const streamStatesByRef = new Map<ThreadRef, SeparateThreadStreamState>();
  let visibleSpanSourceDurationMs = 0;
  let spanBucketingDurationMs = 0;
  let laneAssignmentDurationMs = 0;
  let visibleSpanCount = 0;
  let laneLayoutCallCount = 0;
  let laneLayoutSpanCount = 0;
  let threadOrderingDurationMs = 0;
  let threadLoopDurationMs = 0;
  let descriptorAssemblyDurationMs = 0;
  let slowestProcessDurationMs = 0;
  let slowestProcessId: string | undefined;
  let slowestProcessThreadCount = 0;
  let slowestProcessVisibleSpanCount = 0;
  let slowestProcessLaneAssignmentDurationMs = 0;

  for (const [rankIndex, rank] of visibleTraceGraph.processes.entries()) {
    const processStartTime = performance.now();
    const descriptorCountBeforeProcess = descriptors.length;
    const processLaneAssignmentStartDurationMs = laneAssignmentDurationMs;
    const orderedThreads = [...rank.threads];
    const threadRefByThread = new Map<TraceThread, ThreadRef>();
    rank.threads.forEach((thread, threadIndex) => {
      const threadRef = rank.threadRefs[threadIndex];
      if (threadRef != null) {
        threadRefByThread.set(thread, threadRef);
      }
    });
    if (settings.sortThreads) {
      const threadOrderingStartTime = performance.now();
      orderedThreads.sort((a, b) => {
        const aName = a.name?.trim() || String(a.threadId);
        const bName = b.name?.trim() || String(b.threadId);
        return compareNumericSortStrings(aName, bName);
      });
      threadOrderingDurationMs += performance.now() - threadOrderingStartTime;
    }

    const threadSpans = new Map<ThreadRef, TraceSpanGeometrySource[]>();
    const visibleSpanSourceStartTime = performance.now();
    const rankSpans = getVisibleGeometrySpansForProcess(visibleTraceGraph, rank.processId);
    const rankLaneSpans = usesManualSpanLayout
      ? []
      : getVisibleLaneSpansForProcess(visibleTraceGraph, rank.processId);
    const rankLaneLocalDependencies = usesManualSpanLayout
      ? []
      : getVisibleLaneLocalDependenciesForProcess(visibleTraceGraph, rank.processId);
    const explicitParentByChild = usesManualSpanLayout
      ? new Map<SpanRef, SpanRef>()
      : buildExplicitParentSpanMap({
          spans: rankLaneSpans,
          localDependencies: rankLaneLocalDependencies,
          maxTimeMs
        });
    visibleSpanSourceDurationMs += performance.now() - visibleSpanSourceStartTime;
    const spanBucketingStartTime = performance.now();
    visibleSpanCount += rankSpans.length;
    for (const span of rankSpans) {
      const threadRef = visibleTraceGraph.traceGraph.getThreadRefBySpanRef(span.spanRef);
      if (threadRef == null) {
        continue;
      }
      const spansForThread = threadSpans.get(threadRef);
      if (spansForThread) {
        spansForThread.push(span);
      } else {
        threadSpans.set(threadRef, [span]);
      }
    }
    spanBucketingDurationMs += performance.now() - spanBucketingStartTime;

    const rankTrackId = getRankTrackId(rank.processId);
    rootTrackIds.push(rankTrackId);
    rankStates.push({
      processRef: rank.processRef,
      processId: rank.processId,
      rankIndex,
      orderedThreadRefs: orderedThreads.flatMap(thread => {
        const threadRef = threadRefByThread.get(thread);
        return threadRef != null ? [threadRef] : [];
      })
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

    for (const thread of orderedThreads) {
      const threadLoopStartTime = performance.now();
      const threadRef = threadRefByThread.get(thread);
      if (threadRef == null) {
        continue;
      }
      const spansForThread = threadSpans.get(threadRef) ?? [];
      const visibleInExpandedLayout = streamIsVisible(thread, settings);
      if (usesManualSpanLayout) {
        const manualContentHeight = getManualThreadContentHeight(
          spansForThread,
          params.layoutConfiguration.laneSeparation
        );
        streamStatesByRef.set(threadRef, {
          processId: rank.processId,
          rankIndex,
          threadId: thread.threadId,
          threadRef,
          threadName: thread.name?.trim() || String(thread.threadId),
          visibleInExpandedLayout,
          usesManualSpanLayout: true,
          manualContentHeight,
          laneCount: 0,
          renderedLaneCount: 0,
          overflowSpanCount: 0,
          baseIsCollapsed: false
        });
        threadLoopDurationMs += performance.now() - threadLoopStartTime;
        if (!visibleInExpandedLayout) {
          continue;
        }
        const streamDescriptorAssemblyStartTime = performance.now();
        descriptors.push({
          id: getStreamTrackId(threadRef),
          parentId: rankTrackId,
          kind: 'group',
          type: 'stream',
          object: {
            nodeType: 'stream',
            processId: rank.processId,
            rankIndex,
            threadRef,
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
        for (const span of spansForThread) {
          if (span.spanRef != null) {
            inferredLaneMap.map.set(span.spanRef, 0);
          }
        }
        inferredLaneMap.maxLane = spansForThread.length > 0 ? 0 : -1;
      } else {
        laneLayoutCallCount += 1;
        laneLayoutSpanCount += spansForThread.length;
        const hasSeparateParentHints = hasParentHintsForSpans(
          spansForThread,
          explicitParentByChild
        );
        const hasSeparateLaneAffinity = hasTraceLaneAffinity(spansForThread);
        inferredLaneMap.maxLane = visitKahnLaneAssignments<TraceSpanGeometrySource>(
          spansForThread,
          {
            ...(hasSeparateParentHints
              ? {
                  getParentSpanRef: (span: TraceSpanGeometrySource) =>
                    explicitParentByChild.get(span.spanRef)
                }
              : {}),
            ...(hasSeparateLaneAffinity ? {getLaneAffinityKey: getTraceLaneAffinityKey} : {}),
            maxTimeMs
          },
          (span, lane) => {
            if (span.spanRef != null) {
              inferredLaneMap.map.set(span.spanRef, lane);
            }
          }
        );
      }
      laneAssignmentDurationMs += performance.now() - laneAssignmentStartTime;
      const inferredLaneCount = inferredLaneMap.maxLane >= 0 ? inferredLaneMap.maxLane + 1 : 0;
      const laneMetadata = params.threadLaneLayoutMapByRef?.get(threadRef);
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
      streamStatesByRef.set(threadRef, {
        processId: rank.processId,
        rankIndex,
        threadId: thread.threadId,
        threadRef,
        threadName: thread.name?.trim() || String(thread.threadId),
        visibleInExpandedLayout,
        laneCount: effectiveLaneCount,
        renderedLaneCount: effectiveRenderedLaneCount,
        overflowSpanCount,
        spanLaneMap: effectiveSpanLaneMap,
        visibleLaneIndices,
        collapseMode,
        baseIsCollapsed: false
      });
      threadLoopDurationMs += performance.now() - threadLoopStartTime;

      if (!visibleInExpandedLayout) {
        continue;
      }

      const streamDescriptorAssemblyStartTime = performance.now();
      const streamTrackId = getStreamTrackId(threadRef);
      descriptors.push({
        id: streamTrackId,
        parentId: rankTrackId,
        kind: 'group',
        type: 'stream',
        object: {
          nodeType: 'stream',
          processId: rank.processId,
          rankIndex,
          threadRef,
          threadId: thread.threadId
        }
      });

      const stackedLaneCount = Math.max(effectiveLaneCount - 1, 0);
      if (stackedLaneCount > 0) {
        descriptors.push({
          id: getLaneStackTrackId(threadRef),
          parentId: streamTrackId,
          kind: 'leaf',
          type: 'laneStack',
          object: {
            nodeType: 'laneStack',
            processId: rank.processId,
            rankIndex,
            threadRef,
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
      slowestProcessVisibleSpanCount = rankSpans.length;
      slowestProcessLaneAssignmentDurationMs = processLaneAssignmentDurationMs;
    }
    if (processDurationMs >= TRACE_LAYOUT_SLOW_PROCESS_PROBE_THRESHOLD_MS) {
      log.probe(0, 'buildSeparateThreadDescriptorsFromSourceGraph slow process', {
        graphName: visibleTraceGraph.name,
        processId: rank.processId,
        processName: rank.name,
        threadCount: rank.threads.length,
        visibleSpanCount: rankSpans.length,
        descriptorCount: descriptors.length - descriptorCountBeforeProcess,
        laneAssignmentDurationMs: processLaneAssignmentDurationMs,
        durationMs: processDurationMs
      })();
    }
  }

  log.probe(0, 'buildSeparateThreadDescriptorsFromSourceGraph done', {
    graphName: visibleTraceGraph.name,
    processCount: visibleTraceGraph.processes.length,
    visibleSpanCount,
    descriptorCount: descriptors.length,
    streamCount: streamStatesByRef.size,
    laneLayoutCallCount,
    laneLayoutSpanCount,
    visibleSpanSourceDurationMs,
    spanBucketingDurationMs,
    laneAssignmentDurationMs,
    threadOrderingDurationMs,
    threadLoopDurationMs,
    descriptorAssemblyDurationMs,
    slowestProcessId,
    slowestProcessDurationMs,
    slowestProcessThreadCount,
    slowestProcessVisibleSpanCount,
    slowestProcessLaneAssignmentDurationMs,
    durationMs: performance.now() - startTime,
    ...getHeapUsageProbeFields()
  })();

  return {
    descriptors,
    rootTrackIds,
    rankStates,
    streamStatesByRef
  };
}

function buildSeparateThreadDescriptorsFromExpandedLayout(params: {
  visibleTraceGraph: TraceLayoutVisibleGraph;
  expandedLayout: TraceLayout;
}): SeparateThreadTrackBuildResult {
  const descriptors: SeparateThreadTrackDescriptor[] = [];
  const rootTrackIds: string[] = [];
  const rankStates: SeparateThreadRankState[] = [];
  const streamStatesByRef = new Map<ThreadRef, SeparateThreadStreamState>();

  for (const [rankIndex, rank] of params.visibleTraceGraph.processes.entries()) {
    const processLayout = getTraceLayoutProcessLayoutByRef(params.expandedLayout, rank.processRef);
    const orderedThreadRefs =
      processLayout?.threadLayouts
        .map(threadLayout => threadLayout.threadRef)
        .filter((threadRef): threadRef is ThreadRef => threadRef != null) ?? [];
    const rankTrackId = getRankTrackId(rank.processId);
    rootTrackIds.push(rankTrackId);
    rankStates.push({
      processRef: rank.processRef,
      processId: rank.processId,
      rankIndex,
      orderedThreadRefs
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

    for (const threadRef of orderedThreadRefs) {
      const sourceThreadLayout = params.expandedLayout.threadLayoutMapByRef.get(threadRef);
      if (!sourceThreadLayout) {
        continue;
      }
      const threadSource = params.visibleTraceGraph.traceGraph.getThreadSourceByRef(threadRef);
      if (!threadSource) {
        continue;
      }
      const threadId = threadSource.threadId;
      const laneCount = Math.max(
        sourceThreadLayout.lanes?.laneCount ?? (sourceThreadLayout.visible ? 1 : 0),
        sourceThreadLayout.visible ? 1 : 0
      );
      streamStatesByRef.set(threadRef, {
        processId: rank.processId,
        rankIndex,
        threadId,
        threadRef,
        threadName: threadSource.name?.trim() || String(threadId),
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
      });

      if (!sourceThreadLayout.visible) {
        continue;
      }

      const streamTrackId = getStreamTrackId(threadRef);
      descriptors.push({
        id: streamTrackId,
        parentId: rankTrackId,
        kind: 'group',
        type: 'stream',
        object: {
          nodeType: 'stream',
          processId: rank.processId,
          rankIndex,
          threadRef,
          threadId,
          manualContentHeight: sourceThreadLayout.manualContentHeight
        }
      });

      if (sourceThreadLayout.manualContentHeight != null) {
        continue;
      }

      const stackedLaneCount = Math.max(laneCount - 1, 0);
      if (stackedLaneCount > 0) {
        descriptors.push({
          id: getLaneStackTrackId(threadRef),
          parentId: streamTrackId,
          kind: 'leaf',
          type: 'laneStack',
          object: {
            nodeType: 'laneStack',
            processId: rank.processId,
            rankIndex,
            threadRef,
            threadId,
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
    streamStatesByRef
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
  /** Separate-thread stream state keyed by canonical runtime thread ref. */
  streamStatesByRef: ReadonlyMap<ThreadRef, SeparateThreadStreamState>;
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
  const threadLayoutMapByRef = new Map<ThreadRef, ThreadLayout>();
  let nextRankYOffset = 0;
  const showEmptyProcesses = params.showEmptyProcesses ?? false;
  const rankDisplayableScanStartTime = performance.now();
  const rankHasDisplayableSpanContent = params.rankStates.map(rankState =>
    rankState.orderedThreadRefs.some(threadRef => {
      const streamState = params.streamStatesByRef.get(threadRef);
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
    const threadLayouts = rankState.orderedThreadRefs.map(threadRef => {
      const streamState = params.streamStatesByRef.get(threadRef);
      if (!streamState) {
        return undefined;
      }
      if (!streamState.visibleInExpandedLayout) {
        const hiddenLayout = buildHiddenSeparateThreadLayout({
          maxTimeMs: params.maxTimeMs,
          streamState
        });
        threadLayoutMapByRef.set(threadRef, hiddenLayout);
        return hiddenLayout;
      }

      const streamEntry = params.trackLayout.trackLayoutsById[getStreamTrackId(threadRef)];
      const baseStreamY = getTrackEntryYOffset(streamEntry, params.useExpandedOffsets);
      if (!streamEntry || baseStreamY == null) {
        const hiddenLayout = buildHiddenSeparateThreadLayout({
          maxTimeMs: params.maxTimeMs,
          streamState
        });
        threadLayoutMapByRef.set(threadRef, hiddenLayout);
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
        threadLayoutMapByRef.set(threadRef, manualLayout);
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
              threads: [{name: streamState.threadName, threadId: streamState.threadId}],
              threadRefs: [streamState.threadRef],
              traceGraph: params.traceGraph,
              labelLaneSeparation: laneSeparation
            })
      } satisfies ThreadLayout;
      overflowLabelDurationMs += performance.now() - overflowLabelStartTime;

      threadLayoutMapByRef.set(threadRef, withOverflow);
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
      processRef: rankState.processRef,
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
      slowestRankThreadCount = rankState.orderedThreadRefs.length;
      slowestRankVisibleThreadCount = visibleThreadLayouts.length;
      slowestRankIsCollapsed = rankIsCollapsed;
    }
    if (rankDurationMs >= TRACE_LAYOUT_SLOW_RANK_PROBE_THRESHOLD_MS) {
      log.probe(0, 'materializeSeparateThreadLayout slow rank', {
        graphName: params.visibleTraceGraph.name,
        processId: rankState.processId,
        rankIndex: rankState.rankIndex,
        threadCount: rankState.orderedThreadRefs.length,
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
      layoutConfiguration: {
        laneSeparation: params.layoutConfiguration.laneSeparation,
        spanHeight: params.layoutConfiguration.spanHeight,
        minTimeMs: params.traceGraph.minTimeMs
      },
      traceGraph: params.traceGraph,
      processLayouts,
      processLayoutMapByRef: buildTraceLayoutProcessLayoutMapByRef(processLayouts),
      renderRows: [],
      threadLayoutMapByRef,
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
  /** Optional lane metadata keyed by canonical runtime thread ref. */
  threadLaneLayoutMapByRef?: ReadonlyMap<ThreadRef, ThreadLaneMetadata>;
  traceGraph: TraceGraph;
}): TraceLayout {
  const startTime = performance.now();
  const buildState = buildSeparateThreadDescriptorsFromSourceGraph({
    visibleTraceGraph: params.visibleTraceGraph,
    maxTimeMs: params.visibleTraceGraph.maxTimeMs,
    settings: params.settings,
    layoutConfiguration: params.layoutConfiguration,
    threadLaneLayoutMapByRef: params.threadLaneLayoutMapByRef
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
    streamStatesByRef: buildState.streamStatesByRef,
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
  /** Optional thread refs forced open while applying separate-thread collapse state. */
  expandedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Optional thread refs forced closed while applying separate-thread collapse state. */
  collapsedThreadRefs?: ReadonlySet<ThreadRef>;
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
  for (const threadRef of params.collapsedThreadRefs ?? []) {
    if (params.visibleTraceGraph.traceGraph.spanLayout === 'manual') {
      break;
    }
    if (params.expandedThreadRefs?.has(threadRef)) {
      continue;
    }
    collapsedTrackIds.add(getStreamTrackId(threadRef));
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
    streamStatesByRef: buildState.streamStatesByRef,
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
    expandedThreadCount: params.expandedThreadRefs?.size ?? 0,
    collapsedThreadCount: params.collapsedThreadRefs?.size ?? 0,
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
      processLayoutMapByRef: buildTraceLayoutProcessLayoutMapByRef(layout.processLayouts),
      threadLayoutMapByRef: layout.threadLayoutMapByRef
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
  /** Optional thread refs forced open without recomputing combined-thread rows. */
  expandedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Optional thread refs forced closed without recomputing combined-thread rows. */
  collapsedThreadRefs?: ReadonlySet<ThreadRef>;
}): TraceLayout {
  const shouldCollapseThread = (threadRef: ThreadRef, baseIsCollapsed: boolean): boolean => {
    if (params.expandedThreadRefs?.has(threadRef)) {
      return false;
    }
    if (params.collapsedThreadRefs?.has(threadRef)) {
      return true;
    }
    return baseIsCollapsed;
  };

  const threadLayoutMapByRef = new Map<ThreadRef, ThreadLayout>();
  for (const process of params.visibleTraceGraph.processes) {
    process.threads.forEach((thread, threadIndex) => {
      const threadRef = process.threadRefs[threadIndex];
      if (threadRef == null) {
        return;
      }
      const threadLayout = params.traceLayout.threadLayoutMapByRef.get(threadRef);
      if (!threadLayout) {
        return;
      }
      const isCollapsed = shouldCollapseThread(threadRef, threadLayout.lanes?.isCollapsed ?? false);
      const nextThreadLayout = isCollapsed
        ? ({
            ...threadLayout,
            threadRef,
            threadId: thread.threadId,
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
            threadRef,
            threadId: thread.threadId,
            lanes: threadLayout.lanes
              ? {
                  ...threadLayout.lanes,
                  isCollapsed: false
                }
              : undefined
          } satisfies ThreadLayout);
      threadLayoutMapByRef.set(threadRef, nextThreadLayout);
    });
  }

  return {
    ...params.traceLayout,
    threadLayoutMapByRef
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
  /** Optional thread refs forced open while applying combined-thread collapse state. */
  expandedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Optional thread refs forced closed while applying combined-thread collapse state. */
  collapsedThreadRefs?: ReadonlySet<ThreadRef>;
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
}): {traceLayout: TraceLayout; rankSpacings: number[]} {
  const hasCollapsedProcesses = (params.collapsedProcessIds?.size ?? 0) > 0;
  const hasStreamVisibilityOverrides =
    (params.expandedThreadRefs?.size ?? 0) > 0 || (params.collapsedThreadRefs?.size ?? 0) > 0;
  const hasStreamLaneLayoutOverrides =
    Object.keys(params.threadLaneLayoutOverrides ?? {}).length > 0;
  if (!hasCollapsedProcesses && !hasStreamLaneLayoutOverrides) {
    return {
      traceLayout: hasStreamVisibilityOverrides
        ? applyMaskOnlyCombinedThreadStreamCollapseState({
            traceLayout: params.expandedLayout,
            visibleTraceGraph: params.visibleTraceGraph,
            expandedThreadRefs: params.expandedThreadRefs,
            collapsedThreadRefs: params.collapsedThreadRefs
          })
        : params.expandedLayout,
      rankSpacings: [...params.expandedRankSpacings]
    };
  }

  const layoutConfiguration = getLayoutDensityPreset(params.settings.layoutDensity);
  const threadLaneLayoutMapByRef = buildThreadLaneLayoutMapByRef(
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
    threadLaneLayoutMapByRef,
    traceGraph: params.expandedLayout.traceGraph,
    getSpansForProcess: processId =>
      getVisibleGeometrySpansForProcess(params.visibleTraceGraph, processId),
    getLocalDependenciesForProcess: processId =>
      getVisibleLocalDependenciesForProcess(params.visibleTraceGraph, processId),
    getLaneSpansForProcess: processId =>
      getVisibleLaneSpansForProcess(params.visibleTraceGraph, processId),
    getLaneLocalDependenciesForProcess: processId =>
      getVisibleLaneLocalDependenciesForProcess(params.visibleTraceGraph, processId)
  });
  const collapsedLayout = collapsedLayoutComputation.layout;

  return {
    traceLayout: hasStreamVisibilityOverrides
      ? applyMaskOnlyCombinedThreadStreamCollapseState({
          traceLayout: collapsedLayout,
          visibleTraceGraph: params.visibleTraceGraph,
          expandedThreadRefs: params.expandedThreadRefs,
          collapsedThreadRefs: params.collapsedThreadRefs
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
  /** Optional thread refs forced open while applying graph collapse state. */
  expandedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Optional thread refs forced closed while applying graph collapse state. */
  collapsedThreadRefs?: ReadonlySet<ThreadRef>;
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
}): {traceLayout: TraceLayout; rankSpacings: number[]} {
  if (params.aggregationMode === 'separate-threads') {
    return applySeparateThreadTrackLayoutCollapseState({
      visibleTraceGraph: params.visibleTraceGraph,
      expandedLayout: params.expandedLayout,
      layoutDensity: params.settings.layoutDensity,
      collapsedProcessIds: params.collapsedProcessIds,
      expandedThreadRefs: params.expandedThreadRefs,
      collapsedThreadRefs: params.collapsedThreadRefs,
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
      expandedThreadRefs: params.expandedThreadRefs,
      collapsedThreadRefs: params.collapsedThreadRefs,
      threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
    });
  }
  throw new Error(`Unsupported track aggregation mode: ${String(params.aggregationMode)}`);
}

/** Builds visible thread lane metadata keyed by canonical runtime thread ref. */
function buildThreadLaneLayoutMapByRef(
  traceGraph: TraceLayoutVisibleGraph,
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides
): ReadonlyMap<ThreadRef, ThreadLaneMetadata> | undefined {
  const threadLaneLayoutMapByRef =
    traceGraph.traceGraph.getVisibleLaneLayoutInfo().threadLaneLayoutMapByRef;
  if (!threadLaneLayoutOverrides) {
    return threadLaneLayoutMapByRef;
  }
  const nextThreadLaneLayoutMapByRef = new Map(threadLaneLayoutMapByRef);
  for (const process of traceGraph.processes) {
    process.threads.forEach((thread, threadIndex) => {
      const override = threadLaneLayoutOverrides[thread.threadId];
      const threadRef = process.threadRefs[threadIndex];
      if (!override || threadRef == null) {
        return;
      }
      const laneMetadata = nextThreadLaneLayoutMapByRef.get(threadRef);
      nextThreadLaneLayoutMapByRef.set(threadRef, {
        laneCount: laneMetadata?.laneCount ?? 1,
        ...laneMetadata,
        ...override
      } satisfies ThreadLaneMetadata);
    });
  }
  return nextThreadLaneLayoutMapByRef;
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
  /** @deprecated Use `collapseState.graphs[index].collapsedProcessRefs` instead. */
  collapsedProcessIds?: ReadonlySet<string>;
  /** @deprecated Use `collapseState.graphs[index].expandedThreadRefs` instead. */
  expandedThreadIds?: ReadonlySet<TraceThreadId>;
  /** @deprecated Use `collapseState.graphs[index].collapsedThreadRefs` instead. */
  collapsedThreadIds?: ReadonlySet<TraceThreadId>;
  /** Optional per-stream lane focus overrides used by interactive lane hiding. */
  threadLaneLayoutOverrides?: Readonly<
    Record<TraceThreadId, Pick<ThreadLaneMetadata, 'visibleLaneIndices'>>
  >;
  /** Optional timing key recorded for later prepared binary geometry derivation. */
  timingKey?: string | null;
  /** Canonical minimum time paired with timing-key prepared geometry derivation. */
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
    const legacyCollapseState = resolveLegacyTraceGraphCollapseState({
      traceGraph,
      collapseState: params.collapseState?.graphs[index],
      collapsedProcessIds: params.collapsedProcessIds,
      expandedThreadIds: params.expandedThreadIds,
      collapsedThreadIds: params.collapsedThreadIds
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
      collapsedProcessIds: legacyCollapseState.collapsedProcessIds,
      expandedThreadRefs: legacyCollapseState.expandedThreadRefs,
      collapsedThreadRefs: legacyCollapseState.collapsedThreadRefs,
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
    log.probe(0, 'buildTraceLayouts expanded composition done', {
      graphIndex: index,
      graphName: traceGraph.name,
      artifactCount: processRelativeLayouts.expandedArtifacts.length,
      durationMs: performance.now() - layoutCompositionStartTime
    })();
    const collapsedLayoutCompositionStartTime = performance.now();
    const collapsedState = composeTraceLayoutFromProcessRelativeArtifacts({
      traceGraph: visibleTraceGraph.traceGraph,
      artifacts: processRelativeLayouts.collapsedArtifacts,
      processSeparation
    });
    log.probe(0, 'buildTraceLayouts collapsed composition done', {
      graphIndex: index,
      graphName: traceGraph.name,
      artifactCount: processRelativeLayouts.collapsedArtifacts.length,
      durationMs: performance.now() - collapsedLayoutCompositionStartTime
    })();
    layoutCompositionDurationMs += performance.now() - layoutCompositionStartTime;
    const withinGraphRankDeltaStartTime = performance.now();
    const withinGraphExpandedRankDeltaStartTime = performance.now();
    const withinGraphExpandedLayout = applyRankDeltas({
      layout: expandedLayoutComputation.layout,
      traceGraph: visibleTraceGraph,
      rankDeltas: computeProcessRelativeRankDeltas(expandedLayoutComputation.rankSpacings),
      trackAggregationMode: aggregationMode
    });
    log.probe(0, 'buildTraceLayouts expanded rank deltas done', {
      graphIndex: index,
      graphName: traceGraph.name,
      processCount: visibleTraceGraph.processes.length,
      durationMs: performance.now() - withinGraphExpandedRankDeltaStartTime
    })();
    const withinGraphCollapsedRankDeltaStartTime = performance.now();
    const withinGraphCollapsedLayout = applyRankDeltas({
      layout: collapsedState.layout,
      traceGraph: visibleTraceGraph,
      rankDeltas: computeProcessRelativeRankDeltas(collapsedState.rankSpacings),
      trackAggregationMode: aggregationMode
    });
    log.probe(0, 'buildTraceLayouts collapsed rank deltas done', {
      graphIndex: index,
      graphName: traceGraph.name,
      processCount: visibleTraceGraph.processes.length,
      durationMs: performance.now() - withinGraphCollapsedRankDeltaStartTime
    })();
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
    const geometryMinTimeMs =
      getTraceLayoutGeometryMinTimeMs({
        graphCount: sourceGraphsToLayout.length,
        traceGraph: computation.traceGraph,
        minTimeMs: params.minTimeMs
      }) ?? computation.traceGraph.minTimeMs;
    const resolvedLayout = {
      ...adjustedLayout,
      layoutConfiguration: {
        laneSeparation:
          adjustedLayout.layoutConfiguration?.laneSeparation ??
          getLayoutDensityPreset(params.settings.layoutDensity).laneSeparation,
        spanHeight: getLayoutDensityPreset(params.settings.layoutDensity).spanHeight,
        minTimeMs: geometryMinTimeMs,
        timingKey: params.timingKey
      },
      currentBounds: computeTraceLayoutBounds({
        traceLayout: adjustedLayout,
        minTimeMs: computation.traceGraph.minTimeMs,
        maxTimeMs: computation.traceGraph.maxTimeMs
      })
    } satisfies TraceLayout;
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
      processLayouts: resolvedLayout.processLayouts
    });
    const buildRowsDurationMs = performance.now() - buildRowsStartTime;
    const refIndexStartTime = performance.now();
    const updatedLayout = attachTraceLayoutReuseState(
      withTraceLayoutRefIndexes({
        traceGraph: computation.traceGraph,
        traceLayout: {
          ...resolvedLayout,
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
      processCount: resolvedLayout.processLayouts.length,
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
  /** Optional caller-provided origin for single-graph layout compatibility. */
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
  /** @deprecated Use `collapseState.graphs[0].collapsedProcessRefs` instead. */
  collapsedProcessIds?: ReadonlySet<string>;
  /** @deprecated Use `collapseState.graphs[0].expandedThreadRefs` instead. */
  expandedThreadIds?: ReadonlySet<TraceThreadId>;
  /** @deprecated Use `collapseState.graphs[0].collapsedThreadRefs` instead. */
  collapsedThreadIds?: ReadonlySet<TraceThreadId>;
  layoutMode?: TraceLayoutMode;
}): TraceLayout {
  const layouts = buildTraceLayouts({
    traceGraphs: [params.traceGraph],
    previousLayouts: params.previousLayout ? [params.previousLayout] : undefined,
    topPadding: params.topPadding,
    settings: params.settings,
    collapseState: params.collapseState,
    collapsedProcessIds: params.collapsedProcessIds,
    expandedThreadIds: params.expandedThreadIds,
    collapsedThreadIds: params.collapsedThreadIds,
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
}): TraceLayout {
  return buildTraceLayoutForSpanRefsImpl({
    ...params,
    refreshGeometryInputs: rebuildTraceLayoutGeometry,
    resolveLegacyCollapseState: resolveLegacyTraceGraphCollapseState,
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
}): TraceLayout {
  const resolvedTraceGraph =
    params.prebuiltTraceGraph ??
    (params.visibleTraceGraph
      ? params.traceLayout.traceGraph
      : new TraceGraph(
          createStaticTraceGraphRuntimeSource({
            identityKey: `${params.traceGraph.name}:geometry-layout`,
            traceGraphData: params.traceGraph
          })
        ));
  const rebuiltLayout = {
    ...params.traceLayout,
    traceGraph: resolvedTraceGraph,
    layoutConfiguration: {
      laneSeparation:
        params.traceLayout.layoutConfiguration?.laneSeparation ??
        getLayoutDensityPreset(params.settings.layoutDensity).laneSeparation,
      spanHeight: getLayoutDensityPreset(params.settings.layoutDensity).spanHeight,
      minTimeMs: params.minTimeMs ?? resolvedTraceGraph.minTimeMs,
      timingKey: params.timingKey
    },
    currentBounds: computeTraceLayoutBounds({
      traceLayout: params.traceLayout,
      minTimeMs: resolvedTraceGraph.minTimeMs,
      maxTimeMs: resolvedTraceGraph.maxTimeMs
    })
  } satisfies TraceLayout;
  return copyTraceLayoutReuseState(
    params.traceLayout,
    withTraceLayoutRefIndexes({
      traceGraph: resolvedTraceGraph,
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
