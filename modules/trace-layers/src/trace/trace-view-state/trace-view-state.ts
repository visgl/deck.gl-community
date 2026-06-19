import {getHeapUsageProbeFields, log as traceLog} from '../log';
import {buildTraceLayoutThreadPruneRequest} from '../trace-layout/trace-collapse-resolution';
import {cloneTraceGraphCollapseState} from '../trace-layout/trace-collapse-state';
import {
  buildTraceLayoutForSpanRefs,
  buildTraceLayouts
} from '../trace-layout/trace-geometry-layout';
import {estimateTraceLayoutSize} from '../trace-layout/trace-layout-size';
import {buildTracePreparedScene, estimateTracePreparedSceneSize} from './trace-prepared-scene';
import {getVisibleDependencyEndpointSpanRefs} from './trace-view-selection';

import type {TraceProcessActivityAggregation} from '../trace-graph/collapsed-activity';
import type {TraceGraph} from '../trace-graph/trace-graph';
import type {
  ThreadRef,
  VisibleCrossDependencyRef,
  VisibleLocalDependencyRef
} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef, TracePath, TraceThreadId} from '../trace-graph/trace-types';
import type {TraceLayoutThreadPruneRequest} from '../trace-layout/trace-collapse-resolution';
import type {
  ThreadLaneMetadata,
  TraceLayout,
  TraceLayoutCollapseState
} from '../trace-layout/trace-layout';
import type {TraceColorScheme} from '../trace-style/trace-color-scheme';
import type {TracePreparedScene} from './trace-prepared-scene';
import type {Matrix4} from '@math.gl/core';

/** Layout-affecting trace settings consumed by TraceViewState. */
export type TraceViewLayoutSettings = Pick<
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
> & {
  /** Whether graph-global events should be represented in the layout. */
  readonly showGlobalEvents?: boolean;
};

/** Inputs used to build or update TraceViewState. */
export type BuildTraceViewStateParams = {
  /** Previous state whose base layouts and prepared scene inputs may be reused. */
  readonly previousState?: TraceViewState | null;
  /** Key representing graph, settings, collapse, lane, and timing inputs that require a base layout rebuild. */
  readonly baseLayoutKey: string;
  /** Filtered trace graphs currently displayed by the trace view. */
  readonly traceGraphs: readonly TraceGraph[];
  /** Source trace graphs represented by the view before comparison/layout slicing. */
  readonly sourceTraceGraphs: readonly TraceGraph[];
  /** Primary filtered trace graph used for path highlighting. */
  readonly primaryTraceGraph: TraceGraph;
  /** Trace paths that should be highlighted in prepared scene inputs. */
  readonly paths: readonly TracePath[];
  /** Layout-affecting trace settings. */
  readonly layoutSettings: TraceViewLayoutSettings;
  /** Full visualization settings used by prepared scene builders. */
  readonly settings: TraceVisSettings;
  /** Active trace color scheme used by prepared scene builders. */
  readonly colorScheme: TraceColorScheme;
  /** Ref-native collapse state aligned to traceGraphs. */
  readonly collapseState: TraceLayoutCollapseState;
  /** Optional per-thread lane visibility overrides used by interactive lane focus. */
  readonly threadLaneLayoutOverrides?: Readonly<
    Record<TraceThreadId, Pick<ThreadLaneMetadata, 'visibleLaneIndices'>>
  >;
  /** Vertical inset applied to the first visible process row. */
  readonly layoutTopPadding?: number;
  /** Optional timing key used to rebuild block geometry. */
  readonly layoutTimingKey?: string | null;
  /** Canonical minimum time paired with timing-key geometry rebuilds. */
  readonly minTimeMs?: number;
  /** Whether minimap layouts should be attached to base layouts. */
  readonly buildMinimapLayouts: boolean;
  /** Span refs that should produce a compact focused layout. */
  readonly focusedSelectionSpanRefs: readonly SpanRef[];
  /** Whether collapsed process activity summaries should be projected for foreground rows. */
  readonly showCollapsedActivitySummary: boolean;
  /** Collapsed process activity aggregation algorithm. */
  readonly collapsedActivityAggregation?: TraceProcessActivityAggregation;
  /** Whether overview/minimap prepared scene inputs should be generated. */
  readonly isOverviewEnabled: boolean;
  /** Returns the model matrix for a graph index in comparison mode. */
  readonly getTraceModelMatrixForGraph: (graphIndex: number) => Matrix4 | undefined;
};

/** Thread collapse pruning request emitted by TraceViewState when visible lane controls change. */
export type TraceViewThreadCollapsePruneRequest = TraceLayoutThreadPruneRequest & {
  /** Monotonic value that increments only when the graph-aligned visible thread-ref sets change. */
  readonly revision: number;
};

/** Phase timings captured while building one TraceViewState. */
export type TraceViewStateBuildPhaseTimings = {
  /** Total elapsed TraceViewState build time. */
  readonly totalDurationMs: number;
  /** Time spent building or reusing base layouts. */
  readonly baseLayoutDurationMs: number;
  /** Time spent building focused-selection layouts. */
  readonly focusedLayoutDurationMs: number;
  /** Time spent deriving thread-collapse prune requests. */
  readonly threadCollapsePruneDurationMs: number;
  /** Time spent building prepared scene inputs. */
  readonly preparedSceneDurationMs: number;
  /** Time spent estimating retained render-state sizes. */
  readonly sizeEstimateDurationMs: number;
};

/** Inputs used to build the TraceViewState base layout reuse key. */
export type BuildTraceViewBaseLayoutKeyParams = {
  /** Filtered trace graphs currently displayed by the trace view. */
  readonly traceGraphs: readonly TraceGraph[];
  /** Layout-affecting trace settings. */
  readonly traceLayoutSettings: TraceViewLayoutSettings;
  /** Ref-native collapse state aligned to traceGraphs. */
  readonly collapseStateForLayout: TraceLayoutCollapseState;
  /** Optional per-thread lane visibility overrides used by custom renderers. */
  readonly threadLaneLayoutOverrides?: Readonly<
    Record<TraceThreadId, Pick<ThreadLaneMetadata, 'visibleLaneIndices'>>
  >;
  /** Vertical inset applied to the first visible process row. */
  readonly layoutTopPadding: number;
  /** Optional timing key used to rebuild block geometry. */
  readonly layoutTimingKey?: string | null;
  /** Canonical minimum time paired with timing-key geometry rebuilds. */
  readonly minTimeMs: number;
  /** Whether minimap layouts should be attached to base layouts. */
  readonly shouldPrepareOverviewData: boolean;
  /** Stable key representing initial viewport-fit graph extents. */
  readonly initialViewportFitKey: string;
};

/** Inputs used to derive the render-facing trace view state build inputs. */
export type BuildTraceViewRenderInputsParams = {
  /** Primary filtered graph used to resolve dependency endpoints for focused selection. */
  readonly traceGraph: TraceGraph;
  /** Filtered trace graphs currently displayed by the trace view. */
  readonly traceGraphs: readonly TraceGraph[];
  /** Full visualization settings used by layout and prepared scene builders. */
  readonly settings: TraceVisSettings;
  /** Ref-native collapse state aligned to traceGraphs. */
  readonly collapseStateForLayout: TraceLayoutCollapseState;
  /** Vertical inset applied to the first visible process row. */
  readonly layoutTopPadding: number;
  /** Optional timing key used to rebuild block geometry. */
  readonly layoutTimingKey?: string | null;
  /** Canonical minimum time paired with timing-key geometry rebuilds. */
  readonly minTimeMs: number;
  /** Whether minimap layouts should be attached to base layouts. */
  readonly shouldPrepareOverviewData: boolean;
  /** Stable key representing initial viewport-fit graph extents. */
  readonly initialViewportFitKey: string;
  /** Exact selected span refs controlled by the current view. */
  readonly selectedSpanRefs: readonly SpanRef[];
  /** Extra selected span refs visible only in focused or extended selection. */
  readonly extendedSelectionSpanRefs: readonly SpanRef[];
  /** Selected local dependency refs whose endpoints should remain visible. */
  readonly selectedLocalDependencyRefs?: ReadonlySet<VisibleLocalDependencyRef>;
  /** Selected cross-process dependency refs whose endpoints should remain visible. */
  readonly selectedCrossDependencyRefs?: ReadonlySet<VisibleCrossDependencyRef>;
  /** Whether the latest selection gesture requested focused extended-selection behavior. */
  readonly isExtendedSelection: boolean;
};

/** Derived inputs consumed by TraceViewState construction. */
export type TraceViewRenderInputs = {
  /** Layout-affecting subset of the full visualization settings. */
  readonly traceLayoutSettings: TraceViewLayoutSettings;
  /** Span refs that should produce a compact focused layout. */
  readonly focusedSelectionSpanRefs: readonly SpanRef[];
  /** Stable key representing inputs that require full base-layout recomputation. */
  readonly traceViewBaseLayoutKey: string;
};

/** Pure JS trace view state shared by React and non-React renderers. */
export type TraceViewState = {
  /** Key representing the base layout inputs that produced baseLayouts. */
  readonly baseLayoutKey: string;
  /** Full trace layouts produced from graph, settings, collapse, lane, and timing inputs. */
  readonly baseLayouts: readonly TraceLayout[];
  /** Compact focused layouts produced from selected span refs, or null when focus is inactive. */
  readonly focusedLayouts: readonly TraceLayout[] | null;
  /** Layouts currently consumed by renderers. */
  readonly activeLayouts: readonly TraceLayout[];
  /** Span refs used to produce focusedLayouts. */
  readonly focusedSelectionSpanRefs: readonly SpanRef[];
  /** Prepared scene inputs consumed by deck and non-deck renderers. */
  readonly preparedScene: TracePreparedScene;
  /** Layout-derived thread collapse pruning request, or null when no thread overrides need pruning. */
  readonly threadCollapsePruneRequest: TraceViewThreadCollapsePruneRequest | null;
  /** Last build's phase timings, used only for performance attribution. */
  readonly buildPhaseTimings: TraceViewStateBuildPhaseTimings;
  /** Estimated kept bytes for TraceViewState-owned render data. */
  readonly traceViewStateSizeBytes: number;
  /** Estimated kept bytes for active layouts. */
  readonly traceLayoutSizeBytes: number;
  /** Estimated kept bytes for prepared scene inputs. */
  readonly traceDeckInputsSizeBytes: number;
};

/**
 * Builds the layout settings, focused-selection span refs, and base layout key for TraceViewState.
 */
export function buildTraceViewRenderInputs(
  params: BuildTraceViewRenderInputsParams
): TraceViewRenderInputs {
  const traceLayoutSettings = buildTraceViewLayoutSettings(params.settings);
  const focusedSelectionSpanRefs = buildFocusedSelectionSpanRefs(params);
  const traceViewBaseLayoutKey = buildTraceViewBaseLayoutKey({
    traceGraphs: params.traceGraphs,
    traceLayoutSettings,
    collapseStateForLayout: params.collapseStateForLayout,
    layoutTopPadding: params.layoutTopPadding,
    layoutTimingKey: params.layoutTimingKey,
    minTimeMs: params.minTimeMs,
    shouldPrepareOverviewData: params.shouldPrepareOverviewData,
    initialViewportFitKey: params.initialViewportFitKey
  });

  return {
    traceLayoutSettings,
    focusedSelectionSpanRefs,
    traceViewBaseLayoutKey
  };
}

/**
 * Builds a stable key for inputs that require full base layout recomputation.
 */
export function buildTraceViewBaseLayoutKey(params: BuildTraceViewBaseLayoutKeyParams): string {
  return JSON.stringify({
    graphRefs: params.traceGraphs.map(graph => ({
      name: graph.name,
      processCount: graph.processes.length,
      spanCount: graph.stats.spanCount,
      localDependencyCount: graph.stats.localDependencyCount,
      crossDependencyCount: graph.stats.crossDependencyCount,
      graphFilterStateRevision: graph.graphFilterStateRevision,
      sourceSpanFilterRevision: graph.getSourceSpanFilterRevision()
    })),
    settings: params.traceLayoutSettings,
    collapse: params.collapseStateForLayout.graphs.map(graphState => ({
      processes: [...graphState.collapsedProcessRefs].sort((left, right) => left - right),
      collapsedThreads: [...graphState.collapsedThreadRefs].sort((left, right) => left - right),
      expandedThreads: [...graphState.expandedThreadRefs].sort((left, right) => left - right)
    })),
    laneOverrides: Object.fromEntries(
      Object.entries(params.threadLaneLayoutOverrides ?? {}).map(([threadId, override]) => [
        threadId,
        [...(override.visibleLaneIndices ?? [])].sort((left, right) => left - right)
      ])
    ),
    layoutTopPadding: params.layoutTopPadding,
    layoutTimingKey: params.layoutTimingKey ?? '',
    minTimeMs: params.minTimeMs,
    shouldPrepareOverviewData: params.shouldPrepareOverviewData,
    initialViewportFitKey: params.initialViewportFitKey
  });
}

/**
 * Builds immutable TraceViewState while reusing previous base layouts when only focused selection changes.
 */
export function buildTraceViewState(params: BuildTraceViewStateParams): TraceViewState {
  const buildStartTime = performance.now();
  const canReuseBaseLayouts =
    params.previousState?.baseLayoutKey === params.baseLayoutKey &&
    params.previousState.baseLayouts.length > 0;
  traceLog.probe(0, 'buildTraceViewState start', {
    graphCount: params.traceGraphs.length,
    previousBaseLayoutCount: params.previousState?.baseLayouts.length ?? 0,
    baseLayoutKeyChanged: params.previousState?.baseLayoutKey !== params.baseLayoutKey,
    previousBaseLayoutKeyHash: params.previousState
      ? hashTraceViewStateKey(params.previousState.baseLayoutKey)
      : null,
    baseLayoutKeyHash: hashTraceViewStateKey(params.baseLayoutKey),
    canReuseBaseLayouts,
    previousFocusedSelectionSpanCount: params.previousState?.focusedSelectionSpanRefs.length ?? 0,
    focusedSelectionSpanCount: params.focusedSelectionSpanRefs.length,
    buildMinimapLayouts: params.buildMinimapLayouts,
    traceGraphSpanCount: params.traceGraphs.reduce((sum, graph) => sum + graph.stats.spanCount, 0),
    traceGraphLocalDependencyCount: params.traceGraphs.reduce(
      (sum, graph) => sum + graph.stats.localDependencyCount,
      0
    ),
    traceGraphCrossDependencyCount: params.traceGraphs.reduce(
      (sum, graph) => sum + graph.stats.crossDependencyCount,
      0
    ),
    ...getHeapUsageProbeFields()
  })();
  const baseLayoutStartTime = performance.now();
  const baseLayouts = canReuseBaseLayouts
    ? params.previousState!.baseLayouts
    : buildTraceLayouts({
        prebuiltTraceGraphs: params.traceGraphs,
        traceGraphs: params.traceGraphs,
        previousLayouts: params.previousState?.baseLayouts,
        topPadding: params.layoutTopPadding,
        settings: params.layoutSettings,
        collapseState: params.collapseState,
        threadLaneLayoutOverrides: params.threadLaneLayoutOverrides,
        timingKey: params.layoutTimingKey,
        minTimeMs: params.minTimeMs,
        buildMinimapLayouts: params.buildMinimapLayouts
      });
  const baseLayoutDurationMs = performance.now() - baseLayoutStartTime;
  const focusedLayoutStartTime = performance.now();
  const focusedLayouts =
    params.focusedSelectionSpanRefs.length > 0
      ? baseLayouts.map((layout, graphIndex) =>
          buildTraceLayoutForSpanRefs({
            traceGraph: layout.traceGraph,
            traceLayout: layout,
            spanRefs: params.focusedSelectionSpanRefs,
            settings: {
              localDependencyMode: params.layoutSettings.localDependencyMode,
              layoutDensity: params.layoutSettings.layoutDensity,
              sortThreads: params.layoutSettings.sortThreads,
              maxVisibleLanesPerThread: params.layoutSettings.maxVisibleLanesPerThread,
              maxVisibleLanesUnlimited: params.layoutSettings.maxVisibleLanesUnlimited,
              trackAggregationMode: params.layoutSettings.trackAggregationMode,
              showEmptyProcesses: params.layoutSettings.showEmptyProcesses
            },
            collapseState: {
              graphs: [cloneTraceGraphCollapseState(params.collapseState.graphs[graphIndex])]
            },
            timingKey: params.layoutTimingKey,
            minTimeMs: params.minTimeMs
          })
        )
      : null;
  const focusedLayoutDurationMs = performance.now() - focusedLayoutStartTime;
  const activeLayouts = focusedLayouts ?? baseLayouts;
  const threadCollapsePruneStartTime = performance.now();
  const threadCollapsePruneRequest = buildTraceViewThreadCollapsePruneRequest({
    traceLayouts: baseLayouts,
    traceGraphs: params.traceGraphs,
    collapseState: params.collapseState,
    previousRequest: params.previousState?.threadCollapsePruneRequest ?? null
  });
  const threadCollapsePruneDurationMs = performance.now() - threadCollapsePruneStartTime;
  const previousPreparedScene = params.previousState?.preparedScene ?? null;
  const preparedSceneStartTime = performance.now();
  const preparedScene = buildTracePreparedScene({
    primaryTraceGraph: params.primaryTraceGraph,
    sourceTraceGraphs: params.sourceTraceGraphs,
    traceGraphs: params.traceGraphs,
    traceLayouts: activeLayouts,
    paths: params.paths,
    settings: params.settings,
    colorScheme: params.colorScheme,
    previousPreparedScene,
    showCollapsedActivitySummary: params.showCollapsedActivitySummary,
    collapsedActivityAggregation: params.collapsedActivityAggregation,
    isOverviewEnabled: params.isOverviewEnabled,
    getTraceModelMatrixForGraph: params.getTraceModelMatrixForGraph
  });
  const preparedSceneDurationMs = performance.now() - preparedSceneStartTime;
  const sizeEstimateStartTime = performance.now();
  const traceLayoutSizeBytes = estimateTraceLayoutSize(activeLayouts).totalBytes;
  const traceDeckInputsSizeBytes = estimateTracePreparedSceneSize(preparedScene);
  const sizeEstimateDurationMs = performance.now() - sizeEstimateStartTime;
  const totalDurationMs = performance.now() - buildStartTime;
  const buildPhaseTimings: TraceViewStateBuildPhaseTimings = {
    totalDurationMs: roundTraceViewStateBuildDuration(totalDurationMs),
    baseLayoutDurationMs: roundTraceViewStateBuildDuration(baseLayoutDurationMs),
    focusedLayoutDurationMs: roundTraceViewStateBuildDuration(focusedLayoutDurationMs),
    threadCollapsePruneDurationMs: roundTraceViewStateBuildDuration(threadCollapsePruneDurationMs),
    preparedSceneDurationMs: roundTraceViewStateBuildDuration(preparedSceneDurationMs),
    sizeEstimateDurationMs: roundTraceViewStateBuildDuration(sizeEstimateDurationMs)
  };
  const slowestBuildPhase = getSlowestTraceViewStateBuildPhase(buildPhaseTimings);
  const nextState: TraceViewState = {
    baseLayoutKey: params.baseLayoutKey,
    baseLayouts,
    focusedLayouts,
    activeLayouts,
    focusedSelectionSpanRefs: params.focusedSelectionSpanRefs,
    preparedScene,
    threadCollapsePruneRequest,
    buildPhaseTimings,
    traceViewStateSizeBytes: traceLayoutSizeBytes + traceDeckInputsSizeBytes,
    traceLayoutSizeBytes,
    traceDeckInputsSizeBytes
  };
  if (totalDurationMs >= TRACE_VIEW_STATE_SLOW_BUILD_PROBE_THRESHOLD_MS) {
    traceLog.probe(
      0,
      `buildTraceViewState slow build: ${slowestBuildPhase.phaseName} ${slowestBuildPhase.durationMs}ms`,
      {
        graphCount: params.traceGraphs.length,
        reusedBaseLayouts: canReuseBaseLayouts,
        reusedPreparedSceneInputs: previousPreparedScene != null,
        baseLayoutKeyChanged: params.previousState?.baseLayoutKey !== params.baseLayoutKey,
        buildPhaseTimings,
        slowestBuildPhaseName: slowestBuildPhase.phaseName,
        slowestBuildPhaseDurationMs: slowestBuildPhase.durationMs,
        ...getHeapUsageProbeFields()
      }
    )();
  }
  traceLog.probe(0, 'buildTraceViewState done', {
    graphCount: params.traceGraphs.length,
    reusedBaseLayouts: canReuseBaseLayouts,
    reusedPreparedSceneInputs: previousPreparedScene != null,
    baseLayoutCount: baseLayouts.length,
    activeLayoutCount: activeLayouts.length,
    focusedSelectionSpanCount: params.focusedSelectionSpanRefs.length,
    hasThreadCollapsePruneRequest: threadCollapsePruneRequest != null,
    baseLayoutDurationMs: buildPhaseTimings.baseLayoutDurationMs,
    focusedLayoutDurationMs: buildPhaseTimings.focusedLayoutDurationMs,
    threadCollapsePruneDurationMs: buildPhaseTimings.threadCollapsePruneDurationMs,
    preparedSceneDurationMs: buildPhaseTimings.preparedSceneDurationMs,
    sizeEstimateDurationMs: buildPhaseTimings.sizeEstimateDurationMs,
    slowestBuildPhaseName: slowestBuildPhase.phaseName,
    slowestBuildPhaseDurationMs: slowestBuildPhase.durationMs,
    durationMs: buildPhaseTimings.totalDurationMs,
    ...getHeapUsageProbeFields()
  })();
  return nextState;
}

const EMPTY_TRACE_VIEW_SPAN_REFS: readonly SpanRef[] = [];
const TRACE_VIEW_STATE_SLOW_BUILD_PROBE_THRESHOLD_MS = 250;

/**
 * Extracts the layout-affecting settings consumed by TraceViewState builders.
 */
function buildTraceViewLayoutSettings(settings: TraceVisSettings): TraceViewLayoutSettings {
  return {
    showCrossProcessDependencies: settings.showCrossProcessDependencies,
    showGlobalEvents: settings.showGlobalEvents,
    threadDisplayMode: settings.threadDisplayMode,
    selectedThreadNames: settings.selectedThreadNames,
    sortThreads: settings.sortThreads,
    localDependencyMode: settings.localDependencyMode,
    trackAggregationMode: settings.trackAggregationMode,
    processLayoutMode: settings.processLayoutMode,
    showEmptyProcesses: settings.showEmptyProcesses,
    layoutDensity: settings.layoutDensity,
    maxVisibleLanesPerThread: settings.maxVisibleLanesPerThread,
    maxVisibleLanesUnlimited: settings.maxVisibleLanesUnlimited,
    spanFilter: settings.spanFilter
  };
}

/**
 * Resolves the span refs that should keep focused-selection layouts compact and connected.
 */
function buildFocusedSelectionSpanRefs(
  params: Pick<
    BuildTraceViewRenderInputsParams,
    | 'traceGraph'
    | 'selectedSpanRefs'
    | 'extendedSelectionSpanRefs'
    | 'selectedLocalDependencyRefs'
    | 'selectedCrossDependencyRefs'
    | 'isExtendedSelection'
  >
): readonly SpanRef[] {
  if (params.selectedSpanRefs.length === 0) {
    return EMPTY_TRACE_VIEW_SPAN_REFS;
  }
  if (!params.isExtendedSelection && params.extendedSelectionSpanRefs.length === 0) {
    return EMPTY_TRACE_VIEW_SPAN_REFS;
  }

  const dependencyEndpointSpanRefs = getVisibleDependencyEndpointSpanRefs(params.traceGraph, {
    localDependencyRefs: params.selectedLocalDependencyRefs
      ? [...params.selectedLocalDependencyRefs]
      : undefined,
    crossDependencyRefs: params.selectedCrossDependencyRefs
      ? [...params.selectedCrossDependencyRefs]
      : undefined
  });
  return [
    ...new Set([
      ...params.selectedSpanRefs,
      ...params.extendedSelectionSpanRefs,
      ...dependencyEndpointSpanRefs
    ])
  ];
}

/**
 * Builds a compact deterministic hash for logging large TraceViewState input keys.
 */
function hashTraceViewStateKey(key: string): string {
  let hash = 5381;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 33) ^ key.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Rounds TraceViewState timing fields so logs and state metadata remain compact.
 */
function roundTraceViewStateBuildDuration(durationMs: number): number {
  return Number(durationMs.toFixed(1));
}

/**
 * Returns the slowest attributed TraceViewState phase from one build.
 */
function getSlowestTraceViewStateBuildPhase(phaseTimings: TraceViewStateBuildPhaseTimings): {
  phaseName: keyof Omit<TraceViewStateBuildPhaseTimings, 'totalDurationMs'>;
  durationMs: number;
} {
  let phaseName: keyof Omit<TraceViewStateBuildPhaseTimings, 'totalDurationMs'> =
    'baseLayoutDurationMs';
  let durationMs = phaseTimings.baseLayoutDurationMs;
  for (const [candidatePhaseName, candidateDurationMs] of [
    ['focusedLayoutDurationMs', phaseTimings.focusedLayoutDurationMs],
    ['threadCollapsePruneDurationMs', phaseTimings.threadCollapsePruneDurationMs],
    ['preparedSceneDurationMs', phaseTimings.preparedSceneDurationMs],
    ['sizeEstimateDurationMs', phaseTimings.sizeEstimateDurationMs]
  ] as const) {
    if (candidateDurationMs > durationMs) {
      phaseName = candidatePhaseName;
      durationMs = candidateDurationMs;
    }
  }
  return {phaseName, durationMs};
}

function buildTraceViewThreadCollapsePruneRequest(params: {
  traceLayouts: readonly TraceLayout[];
  traceGraphs: readonly TraceGraph[];
  collapseState: TraceLayoutCollapseState;
  previousRequest: TraceViewThreadCollapsePruneRequest | null;
}): TraceViewThreadCollapsePruneRequest | null {
  if (!hasTraceViewThreadCollapseOverrides(params.collapseState)) {
    return null;
  }

  const nextRequest = buildTraceLayoutThreadPruneRequest({
    traceLayouts: params.traceLayouts,
    traceGraphs: params.traceGraphs
  });
  if (
    params.previousRequest &&
    areTraceLayoutThreadPruneRequestsEqual(params.previousRequest, nextRequest)
  ) {
    return params.previousRequest;
  }

  return {
    ...nextRequest,
    revision: (params.previousRequest?.revision ?? 0) + 1
  };
}

function hasTraceViewThreadCollapseOverrides(collapseState: TraceLayoutCollapseState): boolean {
  return collapseState.graphs.some(
    graphState => graphState.collapsedThreadRefs.size > 0 || graphState.expandedThreadRefs.size > 0
  );
}

function areTraceLayoutThreadPruneRequestsEqual(
  left: TraceLayoutThreadPruneRequest,
  right: TraceLayoutThreadPruneRequest
): boolean {
  if (left.validThreadRefsByGraph.length !== right.validThreadRefsByGraph.length) {
    return false;
  }
  return left.validThreadRefsByGraph.every((leftRefs, graphIndex) =>
    areThreadRefSetsEqual(leftRefs, right.validThreadRefsByGraph[graphIndex] ?? new Set())
  );
}

function areThreadRefSetsEqual(
  left: ReadonlySet<ThreadRef>,
  right: ReadonlySet<ThreadRef>
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}
