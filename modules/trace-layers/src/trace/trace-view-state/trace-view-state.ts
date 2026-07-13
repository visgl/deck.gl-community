import {getHeapUsageProbeFields, log as traceLog} from '../log';
import {cloneTraceGraphCollapseState} from '../trace-layout/trace-collapse-state';
import {
  buildTraceLayoutForSpanRefs,
  buildTraceLayouts
} from '../trace-layout/trace-geometry-layout';
import {estimateTraceLayoutSize} from '../trace-layout/trace-layout-size';
import {
  buildDerivedTraceData,
  buildTracePreparedGraphScenes,
  buildTracePreparedOverviewGraphScenes,
  estimateTracePreparedRenderDataSize
} from './trace-prepared-scene';
import {buildTracePreparedPathData} from './trace-prepared-scene-paths';
import {estimateDerivedTraceDataSize} from './trace-prepared-scene-size';
import {getVisibleDependencyEndpointSpanRefs} from './trace-view-selection';

import type {TraceProcessActivityAggregation} from '../trace-graph/collapsed-activity';
import type {TraceGraph} from '../trace-graph/trace-graph';
import type {
  CrossProcessDependencyRef,
  SameProcessDependencyRef
} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef, TracePath, TraceThreadId} from '../trace-graph/trace-types';
import type {
  ThreadLaneMetadata,
  TraceLayout,
  TraceLayoutCollapseState
} from '../trace-layout/trace-layout';
import type {TraceColorScheme} from '../trace-style/trace-color-scheme';
import type {
  DerivedTraceData,
  TracePreparedGraphScene,
  TracePreparedPathData
} from './trace-prepared-scene';
import type {Matrix4} from '@math.gl/core';

/** Inputs used to build one TraceViewState snapshot. */
export type BuildTraceViewStateParams = {
  /**
   * Exact base layouts already owned by the caller for the supplied graph and layout inputs.
   * When omitted, TraceViewState builds a fresh base layout set.
   */
  readonly baseLayouts?: readonly TraceLayout[];
  /** Filtered trace graphs currently displayed by the trace view. */
  readonly traceGraphs: readonly TraceGraph[];
  /** Source trace graphs represented by the view before comparison/layout slicing. */
  readonly sourceTraceGraphs: readonly TraceGraph[];
  /** Primary filtered trace graph used for path highlighting. */
  readonly primaryTraceGraph: TraceGraph;
  /** Trace paths that should be highlighted in render inputs. */
  readonly paths: readonly TracePath[];
  /** Full visualization settings used by layout and render-data builders. */
  readonly settings: TraceVisSettings;
  /** Active trace color scheme used by render-data builders. */
  readonly colorScheme: TraceColorScheme;
  /** Ref-native collapse state aligned to traceGraphs. */
  readonly collapseState: TraceLayoutCollapseState;
  /** Optional per-thread lane visibility overrides used by interactive lane focus. */
  readonly threadLaneLayoutOverrides?: Readonly<
    Record<TraceThreadId, Pick<ThreadLaneMetadata, 'visibleLaneIndices'>>
  >;
  /** Vertical inset applied to the first visible process row. */
  readonly layoutTopPadding?: number;
  /** Optional timing key recorded for prepared binary geometry derivation. */
  readonly layoutTimingKey?: string | null;
  /** Canonical minimum time paired with timing-key prepared geometry derivation. */
  readonly minTimeMs?: number;
  /** Whether minimap layouts should be attached to base layouts. */
  readonly buildMinimapLayouts: boolean;
  /** Span refs that should produce a compact focused layout. */
  readonly focusedSelectionSpanRefs: readonly SpanRef[];
  /** Whether collapsed process activity summaries should be projected for foreground rows. */
  readonly showCollapsedActivitySummary: boolean;
  /** Collapsed process activity aggregation algorithm. */
  readonly collapsedActivityAggregation?: TraceProcessActivityAggregation;
  /** Whether overview/minimap render inputs should be generated. */
  readonly isOverviewEnabled: boolean;
  /** Optional fixed trace-space Y position for graph-global event markers. */
  readonly globalEventYPosition?: number;
  /** Returns the model matrix for a graph index in comparison mode. */
  readonly getTraceModelMatrixForGraph: (graphIndex: number) => Matrix4 | undefined;
};

/** Phase timings captured while building one TraceViewState. */
export type TraceViewStateBuildPhaseTimings = {
  /** Total elapsed TraceViewState build time. */
  readonly totalDurationMs: number;
  /** Time spent building or accepting caller-owned base layouts. */
  readonly baseLayoutDurationMs: number;
  /** Time spent building focused-selection layouts. */
  readonly focusedLayoutDurationMs: number;
  /** Time spent building foreground, overview, path, and marker render inputs. */
  readonly preparedRenderDataDurationMs: number;
};

/** On-demand retained-size estimate for one prepared TraceViewState. */
export type TraceViewStateRetainedSizeEstimate = {
  /** Estimated retained byte size of current TraceViewState-owned render data. */
  readonly traceViewStateSizeBytes: number;
  /** Estimated retained byte size of current TraceLayout outputs. */
  readonly traceLayoutSizeBytes: number;
  /** Estimated retained byte size of current prepared deck input outputs. */
  readonly traceDeckInputsSizeBytes: number;
};

/** Inputs used to derive the render-facing trace view state build inputs. */
export type BuildTraceViewRenderInputsParams = {
  /** Primary filtered graph used to resolve dependency endpoints for focused selection. */
  readonly traceGraph: TraceGraph;
  /** Exact selected span refs controlled by the current view. */
  readonly selectedSpanRefs: readonly SpanRef[];
  /** Extra selected span refs visible only in focused or extended selection. */
  readonly extendedSelectionSpanRefs: readonly SpanRef[];
  /** Selected same-process dependency refs whose endpoints should remain visible. */
  readonly selectedSameProcessDependencyRefs?: ReadonlySet<SameProcessDependencyRef>;
  /** Selected cross-process dependency refs whose endpoints should remain visible. */
  readonly selectedCrossProcessDependencyRefs?: ReadonlySet<CrossProcessDependencyRef>;
  /** Whether the latest selection gesture requested focused extended-selection behavior. */
  readonly isExtendedSelection: boolean;
};

/** Derived inputs consumed by TraceViewState construction. */
export type TraceViewRenderInputs = {
  /** Span refs that should produce a compact focused layout. */
  readonly focusedSelectionSpanRefs: readonly SpanRef[];
};

/**
 * Immutable render-facing output owned by one TraceViewState build.
 *
 * Every collection is aligned to the active layout order so renderers can consume one graph
 * index without rebuilding graph-wide event, instant, or counter projections.
 */
export type TraceRenderSnapshot = {
  /** Foreground graph render snapshots aligned to active layouts. */
  readonly foregroundScenes: readonly TracePreparedGraphScene[];
  /** Overview/minimap graph render snapshots aligned to active layouts. */
  readonly overviewScenes: readonly TracePreparedGraphScene[];
  /** Critical-path render sources derived from the primary graph. */
  readonly pathData: TracePreparedPathData;
  /** Event, instant, and counter render data aligned to active layouts. */
  readonly derivedDataByGraph: readonly DerivedTraceData[];
};

/** Pure JS trace view state shared by React and non-React renderers. */
export type TraceViewState = {
  /** Full trace layouts built here or supplied by the exact current mounted owner. */
  readonly baseLayouts: readonly TraceLayout[];
  /** Layouts currently consumed by renderers. */
  readonly activeLayouts: readonly TraceLayout[];
  /** Span refs used to produce active focused layouts. */
  readonly focusedSelectionSpanRefs: readonly SpanRef[];
  /** Exact render-facing output aligned to active layouts. */
  readonly renderSnapshot: TraceRenderSnapshot;
  /** Last build's phase timings, used only for performance attribution. */
  readonly buildPhaseTimings: TraceViewStateBuildPhaseTimings;
};

/** Builds focused-selection span refs for TraceViewState. */
export function buildTraceViewRenderInputs(
  params: BuildTraceViewRenderInputsParams
): TraceViewRenderInputs {
  const focusedSelectionSpanRefs = buildFocusedSelectionSpanRefs(params);

  return {
    focusedSelectionSpanRefs
  };
}

/**
 * Returns whether two settings bundles produce the same base-layout inputs.
 *
 * This deliberately compares direct fields instead of constructing a serialized reuse key.
 */
export function areTraceViewLayoutSettingsEqual(
  left: TraceVisSettings,
  right: TraceVisSettings
): boolean {
  return (
    left.threadDisplayMode === right.threadDisplayMode &&
    areScalarArraysEqual(left.selectedThreadNames ?? [], right.selectedThreadNames ?? []) &&
    left.sortThreads === right.sortThreads &&
    left.maxVisibleLanesPerThread === right.maxVisibleLanesPerThread &&
    left.maxVisibleLanesUnlimited === right.maxVisibleLanesUnlimited &&
    left.showCrossProcessDependencies === right.showCrossProcessDependencies &&
    left.sameProcessDependencyMode === right.sameProcessDependencyMode &&
    left.layoutDensity === right.layoutDensity &&
    left.processLayoutMode === right.processLayoutMode &&
    left.trackAggregationMode === right.trackAggregationMode &&
    left.spanFilter === right.spanFilter &&
    left.showEmptyProcesses === right.showEmptyProcesses &&
    left.showGlobalEvents === right.showGlobalEvents
  );
}

/** Builds immutable TraceViewState from fresh or explicitly caller-owned base layouts. */
export function buildTraceViewState(params: BuildTraceViewStateParams): TraceViewState {
  const buildStartTime = performance.now();
  const usesOwnedBaseLayouts = params.baseLayouts != null;
  traceLog.probe(1, 'buildTraceViewState start', {
    graphCount: params.traceGraphs.length,
    usesOwnedBaseLayouts,
    focusedSelectionSpanCount: params.focusedSelectionSpanRefs.length,
    buildMinimapLayouts: params.buildMinimapLayouts,
    traceGraphSpanCount: params.traceGraphs.reduce((sum, graph) => sum + graph.stats.spanCount, 0),
    traceGraphSameProcessDependencyCount: params.traceGraphs.reduce(
      (sum, graph) => sum + graph.stats.sameProcessDependencyCount,
      0
    ),
    traceGraphCrossProcessDependencyCount: params.traceGraphs.reduce(
      (sum, graph) => sum + graph.stats.crossProcessDependencyCount,
      0
    ),
    ...getHeapUsageProbeFields()
  })();
  const baseLayoutStartTime = performance.now();
  const baseLayouts =
    params.baseLayouts ??
    buildTraceLayouts({
      traceGraphs: params.traceGraphs,
      topPadding: params.layoutTopPadding,
      settings: params.settings,
      collapseState: params.collapseState,
      threadLaneLayoutOverrides: params.threadLaneLayoutOverrides,
      timingKey: params.layoutTimingKey,
      minTimeMs: params.minTimeMs,
      buildMinimapLayouts: params.buildMinimapLayouts
    });
  const baseLayoutDurationMs = performance.now() - baseLayoutStartTime;
  const focusedLayoutStartTime = performance.now();
  const activeLayouts =
    params.focusedSelectionSpanRefs.length > 0
      ? baseLayouts.map((layout, graphIndex) =>
          buildTraceLayoutForSpanRefs({
            traceGraph: layout.traceGraph,
            traceLayout: layout,
            spanRefs: params.focusedSelectionSpanRefs,
            settings: {
              sameProcessDependencyMode: params.settings.sameProcessDependencyMode,
              layoutDensity: params.settings.layoutDensity,
              sortThreads: params.settings.sortThreads,
              maxVisibleLanesPerThread: params.settings.maxVisibleLanesPerThread,
              maxVisibleLanesUnlimited: params.settings.maxVisibleLanesUnlimited,
              trackAggregationMode: params.settings.trackAggregationMode,
              showEmptyProcesses: params.settings.showEmptyProcesses
            },
            collapseState: {
              graphs: [cloneTraceGraphCollapseState(params.collapseState.graphs[graphIndex])]
            },
            timingKey: params.layoutTimingKey,
            minTimeMs: params.minTimeMs
          })
        )
      : baseLayouts;
  const focusedLayoutDurationMs = performance.now() - focusedLayoutStartTime;
  const preparedRenderDataStartTime = performance.now();
  const foregroundScenes = buildTracePreparedGraphScenes({
    sourceTraceGraphs: params.sourceTraceGraphs,
    traceLayouts: activeLayouts,
    settings: params.settings,
    colorScheme: params.colorScheme,
    showCollapsedActivitySummary: params.showCollapsedActivitySummary,
    collapsedActivityAggregation: params.collapsedActivityAggregation,
    getTraceModelMatrixForGraph: params.getTraceModelMatrixForGraph
  });
  const overviewScenes = buildTracePreparedOverviewGraphScenes({
    isOverviewEnabled: params.isOverviewEnabled,
    sourceTraceGraphs: params.sourceTraceGraphs,
    traceLayouts: activeLayouts,
    settings: params.settings,
    colorScheme: params.colorScheme,
    collapsedActivityAggregation: params.collapsedActivityAggregation,
    getTraceModelMatrixForGraph: params.getTraceModelMatrixForGraph
  });
  const pathData = buildTracePreparedPathData({
    primaryTraceGraph: params.primaryTraceGraph,
    paths: params.paths,
    settings: params.settings
  });
  const derivedDataByGraph = activeLayouts.map(traceLayout =>
    buildDerivedTraceData({
      traceGraph: traceLayout.traceGraph,
      traceLayout,
      colorScheme: params.colorScheme,
      buildGlobalEvents: params.settings.showGlobalEvents,
      buildInstants: params.settings.showInstants,
      buildCounters: params.settings.showCounters,
      globalEventYPosition: params.globalEventYPosition
    })
  );
  const renderSnapshot: TraceRenderSnapshot = {
    foregroundScenes,
    overviewScenes,
    pathData,
    derivedDataByGraph
  };
  const preparedRenderDataDurationMs = performance.now() - preparedRenderDataStartTime;
  const totalDurationMs = performance.now() - buildStartTime;
  const buildPhaseTimings: TraceViewStateBuildPhaseTimings = {
    totalDurationMs: roundTraceViewStateBuildDuration(totalDurationMs),
    baseLayoutDurationMs: roundTraceViewStateBuildDuration(baseLayoutDurationMs),
    focusedLayoutDurationMs: roundTraceViewStateBuildDuration(focusedLayoutDurationMs),
    preparedRenderDataDurationMs: roundTraceViewStateBuildDuration(preparedRenderDataDurationMs)
  };
  const slowestBuildPhase = getSlowestTraceViewStateBuildPhase(buildPhaseTimings);
  const nextState: TraceViewState = {
    baseLayouts,
    activeLayouts,
    focusedSelectionSpanRefs: params.focusedSelectionSpanRefs,
    renderSnapshot,
    buildPhaseTimings
  };
  if (totalDurationMs >= TRACE_VIEW_STATE_SLOW_BUILD_PROBE_THRESHOLD_MS) {
    traceLog.probe(
      0,
      `buildTraceViewState slow build: ${slowestBuildPhase.phaseName} ${slowestBuildPhase.durationMs}ms`,
      {
        graphCount: params.traceGraphs.length,
        usesOwnedBaseLayouts,
        buildPhaseTimings,
        slowestBuildPhaseName: slowestBuildPhase.phaseName,
        slowestBuildPhaseDurationMs: slowestBuildPhase.durationMs,
        ...getHeapUsageProbeFields()
      }
    )();
  }
  traceLog.probe(0, 'buildTraceViewState done', {
    graphCount: params.traceGraphs.length,
    usesOwnedBaseLayouts,
    baseLayoutCount: baseLayouts.length,
    activeLayoutCount: activeLayouts.length,
    focusedSelectionSpanCount: params.focusedSelectionSpanRefs.length,
    baseLayoutDurationMs: buildPhaseTimings.baseLayoutDurationMs,
    focusedLayoutDurationMs: buildPhaseTimings.focusedLayoutDurationMs,
    preparedRenderDataDurationMs: buildPhaseTimings.preparedRenderDataDurationMs,
    slowestBuildPhaseName: slowestBuildPhase.phaseName,
    slowestBuildPhaseDurationMs: slowestBuildPhase.durationMs,
    durationMs: buildPhaseTimings.totalDurationMs,
    ...getHeapUsageProbeFields()
  })();
  return nextState;
}

/** Estimates retained render-state bytes only when diagnostics explicitly request them. */
export function estimateTraceViewStateRetainedSize(
  traceViewState: TraceViewState
): TraceViewStateRetainedSizeEstimate {
  const traceLayoutSizeBytes = estimateTraceLayoutSize(traceViewState.activeLayouts).totalBytes;
  const traceDeckInputsSizeBytes = estimateTracePreparedRenderDataSize(
    traceViewState.renderSnapshot.foregroundScenes,
    traceViewState.renderSnapshot.overviewScenes,
    traceViewState.renderSnapshot.pathData
  );
  const traceMarkerInputsSizeBytes = estimateDerivedTraceDataSize(
    traceViewState.renderSnapshot.derivedDataByGraph
  );
  return {
    traceViewStateSizeBytes:
      traceLayoutSizeBytes + traceDeckInputsSizeBytes + traceMarkerInputsSizeBytes,
    traceLayoutSizeBytes,
    traceDeckInputsSizeBytes: traceDeckInputsSizeBytes + traceMarkerInputsSizeBytes
  };
}

const EMPTY_TRACE_VIEW_SPAN_REFS: readonly SpanRef[] = [];
const TRACE_VIEW_STATE_SLOW_BUILD_PROBE_THRESHOLD_MS = 250;

/** Returns whether two scalar arrays contain the same values in source order. */
function areScalarArraysEqual<T extends string | number>(
  left: readonly T[],
  right: readonly T[]
): boolean {
  if (left === right) {
    return true;
  }
  return (
    left.length === right.length && left.every((value, valueIndex) => value === right[valueIndex])
  );
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
    | 'selectedSameProcessDependencyRefs'
    | 'selectedCrossProcessDependencyRefs'
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
    sameProcessDependencyRefs: params.selectedSameProcessDependencyRefs
      ? [...params.selectedSameProcessDependencyRefs]
      : undefined,
    crossProcessDependencyRefs: params.selectedCrossProcessDependencyRefs
      ? [...params.selectedCrossProcessDependencyRefs]
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
    ['preparedRenderDataDurationMs', phaseTimings.preparedRenderDataDurationMs]
  ] as const) {
    if (candidateDurationMs > durationMs) {
      phaseName = candidatePhaseName;
      durationMs = candidateDurationMs;
    }
  }
  return {phaseName, durationMs};
}
