import {getHeapUsageProbeFields, log} from '../log';
import {getTraceGraphProcessLaneAssignmentMode} from '../trace-graph/trace-graph-runtime-helpers';
import {assert} from '../utils/assert';
import {compareNumericSortStrings} from '../utils/numeric-sort';
import {getSpanExtremalTiming, MAX_LANES_PER_STREAM, visitKahnLaneAssignments} from './lane-layout';
import {
  buildTraceLayoutProcessLayoutMapByRef,
  createTraceLayoutSpanLaneColumns,
  getTraceLayoutSpanLaneIndexFromColumns,
  getTraceLayoutSpanVisibilityMask,
  isTraceLayoutSpanVisible,
  setTraceLayoutSpanLaneIndex,
  traceLayoutSpanVisibilityFlags
} from './trace-layout';

import type {
  TraceSpanGeometrySource as TraceGraphSpanGeometrySource,
  TraceSameProcessDependencySource,
  TraceSpanLaneSource,
  TraceSpanLayoutLaneSource
} from '../trace-graph-accessors';
import type {TraceGraph} from '../trace-graph/trace-graph';
import type {ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceDependencyId,
  TraceThread,
  TraceThreadId,
  TrackAggregationMode
} from '../trace-graph/trace-types';
import type {
  ProcessLayout,
  ThreadLaneMetadata,
  ThreadLayout,
  ThreadOverflowLabel,
  TraceLayout,
  TraceLayoutGeometryTuple,
  TraceLayoutSourceProcess,
  TraceLayoutSpanLaneAssignment,
  TraceLayoutSpanLaneColumns,
  TraceLayoutSpanVisibility,
  TraceLayoutSpanVisibilityFlag,
  TraceLayoutVisibleProcessMetadata
} from './trace-layout';

export type TraceLayoutMode = 'step1' | 'sequential' | 'interleaved';

/** Enables expiring trace lane-affinity placements; set false to preserve raw-key ownership. */
export const COMPACT_TRACE_LANE_AFFINITY = true;

const DEFAULT_MINIMAL_THREAD_HIDDEN_NAMES = [
  'h2d',
  'd2h',
  'cpu_work_queue',
  'pipe_next',
  'pipe_prev'
];

function buildRankIdToLayoutIndexMap(params: {
  /** Visible processes keyed by id/ref for rank layout lookup. */
  processes: Readonly<Array<Pick<TraceLayoutVisibleProcessMetadata, 'processId' | 'processRef'>>>;
  layout: TraceLayout;
}): Map<string, number> {
  const result = new Map<string, number>();
  const processByRef = new Map(
    params.processes.map(process => [process.processRef, process] as const)
  );

  params.layout.processLayouts.forEach((processLayout, layoutIndex) => {
    const processId = processByRef.get(processLayout.processRef)?.processId;
    if (processId && !result.has(processId)) {
      result.set(processId, layoutIndex);
    }
  });

  return result;
}

/** Geometry-ready span source consumed by layout builders. */
export type TraceSpanGeometrySource = TraceGraphSpanGeometrySource;

/**
 * Ref-native layout lookup used by geometry builders when stream ids are only process-local.
 */
export type TraceGeometryLayoutLookup = {
  /** TraceGraph that resolves a visible span ref to its owning process/thread refs. */
  readonly traceGraph: Pick<TraceGraph, 'getProcessRefBySpanRef' | 'getThreadRefBySpanRef'> &
    Partial<Pick<TraceGraph, 'getSpanOwnerRefs'>>;
  /** Generated lane columns aligned with canonical Arrow span-table rows. */
  readonly spanLaneColumnsByChunkIndex?: TraceLayoutSpanLaneColumns;
  /** Thread layouts keyed by canonical thread ref for the current TraceGraph namespace. */
  readonly threadLayoutsByRef: ReadonlyMap<ThreadRef, ThreadLayout>;
  /** Process layouts keyed by canonical process ref for collapsed-process routing. */
  readonly processLayoutsByRef: ReadonlyMap<ProcessRef, ProcessLayout>;
};

/** Ref-native process and thread layouts owned by one geometry span. */
type TraceSpanGeometryOwnerLayouts = {
  /** Owning thread layout for the current TraceGraph namespace. */
  readonly threadLayout?: ThreadLayout;
  /** Owning process layout for the current TraceGraph namespace. */
  readonly processLayout?: ProcessLayout;
};

/** Lightweight span payload used by Arrow-native layout calculations. */
export type TraceLayoutLaneSpanSource = (TraceSpanGeometrySource | TraceSpanLayoutLaneSource) &
  Pick<TraceSpanLaneSource, 'traceAffinityKey' | 'userData'>;

/** Lightweight same-process dependency payload used by Arrow-native layout calculations. */
export type TraceLayoutLaneDependencySource = Pick<
  TraceSameProcessDependencySource,
  'dependencyId' | 'startSpanRef' | 'endSpanRef'
> & {
  /** Whether the dependency is an explicit parent-child edge. */
  readonly hasParentKeyword?: boolean;
};

type LayoutComputation<
  ProcessT extends Pick<TraceLayoutVisibleProcessMetadata, 'processId' | 'processRef'>
> = {
  processes: readonly ProcessT[];
  layout: TraceLayout;
  rankSpacings: number[];
};

/** Preserves one combine-thread lane assignment for a focused rank relayout. */
export type CombinedRankLaneAssignmentOverride = {
  /** Total lane count implied by the preserved source lane indices. */
  laneCount: number;
  /** Highest preserved source lane index for the combined rank. */
  maxLane: number;
  /** Original combined lane assignments copied into layout-owned lane columns. */
  spanLaneAssignments: readonly TraceLayoutSpanLaneAssignment[];
  /** Overflow count computed from the preserved combined lane assignment. */
  overflowSpanCount: number;
};

export type TraceLayoutConfiguration = {
  /** Stream label font size */
  streamLabelFontSize: number;
  /** Space between processes */
  processSeparation: number;
  /** space between lanes */
  laneSeparation: number;
  /** space between threads */
  threadSeparation: number;
  /** span height */
  spanHeight: number;
  /** span label position, inside span or above it */
  spanLabelPosition: 'inside' | 'above';
  /** Span label font size */
  spanLabelFontSize: number;
  /** Top inset for collapsed process activity overviews within the process row. */
  overviewTopGap: number;
  /** Extra top inset before the first visible thread in each process row. */
  firstThreadTopGap: number;
  labelPadding: number;
  labelMinGap: number;
};

type LaneUserData = {lane?: number};

type TraceLayoutLaneSourceProcess = {
  /** Identifies the process whose threads are being laid out. */
  readonly processId: string;
  /** Canonical runtime process ref that owns this visible process row. */
  readonly processRef: ProcessRef;
  /** Carries the source threads used to determine visible stream rows. */
  readonly threads: readonly TraceThread[];
  /** Canonical runtime thread refs aligned to `threads`. */
  readonly threadRefs: readonly ThreadRef[];
  /** Carries process-level metadata used for lane-assignment settings. */
  readonly userData?: TraceLayoutSourceProcess['userData'];
  /** Provides lightweight lane sources for ref-native calculators. */
  readonly laneSpans?: readonly TraceLayoutLaneSpanSource[];
  /** Provides lightweight same-process dependency sources for ref-native calculators. */
  readonly laneSameProcessDependencies?: readonly TraceLayoutLaneDependencySource[];
};

const DEFAULT_BACKGROUND_PADDING = 0.35;
const MAX_BACKGROUND_PADDING = 2;
const INFINITE_HORIZONTAL_EXTENT = 1e6;
const COLLAPSED_ACTIVITY_OFFSET = 0.2;
const INVALID_LANE_INDEX = -1;
const NON_FLAMEGRAPH_FIRST_THREAD_TOP_GAP = 0.5;
const RESERVED_OVERFLOW_LANE_COUNT = 1;

type NormalizedLaneCounts = {
  laneCount: number;
  renderedLaneCount: number;
  hasOverflow: boolean;
};

/** Clamps one configured per-thread lane limit to the supported overflow-aware range. */
function getNormalizedMaxVisibleLanesPerThread(maxVisibleLanesPerThread?: number): number {
  const candidate = Number.isFinite(maxVisibleLanesPerThread)
    ? Math.floor(maxVisibleLanesPerThread as number)
    : MAX_LANES_PER_STREAM;
  return Math.max(candidate, RESERVED_OVERFLOW_LANE_COUNT + 1);
}

/** Returns how many non-overflow lanes remain visible after reserving one overflow lane. */
function getMinimumVisibleLaneCount(maxVisibleLanesPerThread?: number): number {
  return Math.max(
    getNormalizedMaxVisibleLanesPerThread(maxVisibleLanesPerThread) - RESERVED_OVERFLOW_LANE_COUNT,
    0
  );
}

export function normalizeLaneCounts(
  rawLaneCount: number,
  maxVisibleLanesPerThread?: number,
  maxVisibleLanesUnlimited = true
): NormalizedLaneCounts {
  const safeLaneCount = Math.max(rawLaneCount, 0);
  if (maxVisibleLanesUnlimited || maxVisibleLanesPerThread === 0) {
    return {
      laneCount: safeLaneCount,
      renderedLaneCount: safeLaneCount,
      hasOverflow: false
    };
  }

  const laneLimit = getNormalizedMaxVisibleLanesPerThread(maxVisibleLanesPerThread);
  if (safeLaneCount <= laneLimit) {
    return {
      laneCount: safeLaneCount,
      renderedLaneCount: safeLaneCount,
      hasOverflow: false
    };
  }

  return {
    laneCount: laneLimit,
    renderedLaneCount: getMinimumVisibleLaneCount(maxVisibleLanesPerThread),
    hasOverflow: true
  };
}

/** Counts preserved generated lane assignments hidden by the rendered lane limit. */
export function countOverflowSpans(
  spanLaneAssignments: readonly TraceLayoutSpanLaneAssignment[] | undefined,
  renderedLaneCount: number,
  hasOverflow: boolean
): number {
  if (!hasOverflow || !spanLaneAssignments || renderedLaneCount < 0) {
    return 0;
  }

  let overflowSpanCount = 0;
  for (const assignment of spanLaneAssignments) {
    if (Math.floor(assignment.laneIndex) >= renderedLaneCount) {
      overflowSpanCount += 1;
    }
  }
  return overflowSpanCount;
}

/** Counts spans assigned beyond rendered lanes from compact per-lane assignment counts. */
export function countOverflowSpanLaneCounts(
  laneAssignmentCounts: readonly number[],
  renderedLaneCount: number,
  hasOverflow: boolean
): number {
  if (!hasOverflow || renderedLaneCount < 0) {
    return 0;
  }

  let overflowSpanCount = 0;
  for (let laneIndex = renderedLaneCount; laneIndex < laneAssignmentCounts.length; laneIndex += 1) {
    overflowSpanCount += laneAssignmentCounts[laneIndex] ?? 0;
  }
  return overflowSpanCount;
}

/** Formats the lane-cap notice rendered below one overflowing thread row. */
function formatThreadOverflowMessage(overflowSpanCount: number): string | null {
  return overflowSpanCount > 0
    ? `${overflowSpanCount} deeper span${overflowSpanCount === 1 ? '' : 's'} hidden`
    : null;
}

/** Builds one label for spans hidden by the rendered-lane cap. */
export function buildThreadOverflowLabel(
  threadLayout: ThreadLayout,
  overflowSpanCount: number
): ThreadOverflowLabel | undefined {
  if (!threadLayout.visible) {
    return undefined;
  }

  if (
    threadLayout.lanes == null ||
    threadLayout.lanes.isCollapsed ||
    threadLayout.lanes.laneYPositions.length === 0
  ) {
    return undefined;
  }

  const renderedLaneCount = threadLayout.lanes.renderedLaneCount ?? threadLayout.lanes.laneCount;
  const hasOverflow = renderedLaneCount < threadLayout.lanes.laneCount;
  if (!hasOverflow || overflowSpanCount <= 0) {
    return undefined;
  }

  const overflowY = getLaneYPosition(
    threadLayout,
    Math.min(Math.max(0, renderedLaneCount), threadLayout.lanes.laneYPositions.length - 1)
  );
  if (!Number.isFinite(overflowY)) {
    return undefined;
  }

  const text = formatThreadOverflowMessage(overflowSpanCount);
  if (!text) {
    return undefined;
  }

  return {
    text,
    x: 0,
    y: overflowY
  };
}

const LAYOUT_DENSITY_PRESETS = {
  comfortable: {
    processSeparation: 0.75,
    laneSeparation: 0.58,
    threadSeparation: 0.75,
    streamLabelFontSize: 12,
    spanHeight: 0.4,
    spanLabelPosition: 'above',
    spanLabelFontSize: 12,
    overviewTopGap: 0.1,
    firstThreadTopGap: NON_FLAMEGRAPH_FIRST_THREAD_TOP_GAP,
    labelPadding: 0.35,
    labelMinGap: 0.2
  },
  compact: {
    processSeparation: 0.45,
    laneSeparation: 0.36,
    threadSeparation: 0.36,
    streamLabelFontSize: 10,
    spanHeight: 0.22,
    spanLabelPosition: 'above',
    spanLabelFontSize: 9,
    overviewTopGap: 0.1,
    firstThreadTopGap: NON_FLAMEGRAPH_FIRST_THREAD_TOP_GAP,
    labelPadding: 0.18,
    labelMinGap: 0.12
  },
  'compact-spacious-processes': {
    processSeparation: 0.7,
    laneSeparation: 0.36,
    threadSeparation: 0.5,
    streamLabelFontSize: 10,
    spanHeight: 0.22,
    spanLabelPosition: 'above',
    spanLabelFontSize: 9,
    overviewTopGap: 0.1,
    firstThreadTopGap: NON_FLAMEGRAPH_FIRST_THREAD_TOP_GAP,
    labelPadding: 0.18,
    labelMinGap: 0.12
  },
  'ultra-compact': {
    processSeparation: 0.45,
    laneSeparation: 0.36,
    threadSeparation: 0.36,
    streamLabelFontSize: 10,
    spanHeight: 0.32,
    spanLabelPosition: 'inside',
    spanLabelFontSize: 9,
    overviewTopGap: 0.1,
    firstThreadTopGap: NON_FLAMEGRAPH_FIRST_THREAD_TOP_GAP,
    labelPadding: 0.18,
    labelMinGap: 0.12
  },
  flamegraph: {
    processSeparation: 0.12,
    laneSeparation: 0.36,
    threadSeparation: 0.36,
    streamLabelFontSize: 10,
    spanHeight: 0.4,
    spanLabelPosition: 'inside',
    spanLabelFontSize: 11.5,
    overviewTopGap: 0.1,
    firstThreadTopGap: 0,
    labelPadding: 0.12,
    labelMinGap: 0.08
  }
} as const satisfies Record<TraceVisSettings['layoutDensity'], TraceLayoutConfiguration>;

export function getLayoutDensityPreset(
  density: TraceVisSettings['layoutDensity'] | undefined
): TraceLayoutConfiguration {
  if (density && density in LAYOUT_DENSITY_PRESETS) {
    return LAYOUT_DENSITY_PRESETS[density];
  }
  return LAYOUT_DENSITY_PRESETS.comfortable;
}

type CollapsedCombinedThreadProcessMetrics = {
  rankHeight: number;
  rankSpacing: number;
  labelY: number;
  collapsedActivityY: number;
};

/** Returns the process label Y position inside one process band. */
export function getProcessLabelY(params: {
  yOffset: number;
  layoutConfiguration: TraceLayoutConfiguration;
}): number {
  return Number.isFinite(params.yOffset)
    ? params.yOffset +
        params.layoutConfiguration.labelPadding +
        params.layoutConfiguration.labelMinGap +
        params.layoutConfiguration.labelMinGap
    : 0;
}

/** Returns the first span lane Y position inside one process band. */
export function getProcessContentStartY(params: {
  yOffset: number;
  layoutConfiguration: TraceLayoutConfiguration;
}): number {
  if (!Number.isFinite(params.yOffset)) {
    return 0;
  }
  const {spanHeight, firstThreadTopGap, labelMinGap, labelPadding, overviewTopGap} =
    params.layoutConfiguration;
  const labelClearance = labelPadding + labelMinGap * 2;
  const spanTopClearance = overviewTopGap + spanHeight / 2 + labelMinGap * 2;
  return params.yOffset + Math.max(labelClearance, spanTopClearance) + firstThreadTopGap;
}

/** Returns the collapsed activity overview Y position inside one process band. */
export function getProcessCollapsedActivityY(params: {yOffset: number; yHeight: number}): number {
  return Number.isFinite(params.yOffset)
    ? params.yOffset + Math.max(0.25, Math.min(0.6, params.yHeight * 0.5))
    : 0;
}

/**
 * Returns the minimum structural spacing budget used by a collapsed process row.
 */
export function getCollapsedProcessMinimumRankSpacing(
  layoutConfiguration: TraceLayoutConfiguration
): number {
  const {laneSeparation, labelPadding, labelMinGap} = layoutConfiguration;
  return 2 * laneSeparation + (labelPadding + labelMinGap) + labelPadding;
}

/**
 * Returns whether any visible thread layout in a rank still has visible span content.
 */
export function hasVisibleRankSpanContent(threadLayouts: readonly ThreadLayout[]): boolean {
  return threadLayouts.some(
    threadLayout =>
      threadLayout.visible &&
      (threadLayout.manualContentHeight != null || threadLayout.hasSpanLaneAssignments === true)
  );
}

/**
 * Returns the structural metrics for a collapsed process row in `combine-threads` mode.
 */
function getCollapsedCombinedThreadProcessMetrics(params: {
  yOffset: number;
  layoutConfiguration: TraceLayoutConfiguration;
}): CollapsedCombinedThreadProcessMetrics {
  const {yOffset, layoutConfiguration} = params;
  const rankSpacing = getCollapsedProcessMinimumRankSpacing(layoutConfiguration);
  const rankHeight = rankSpacing;

  return {
    rankHeight,
    rankSpacing,
    labelY: getProcessLabelY({yOffset, layoutConfiguration}),
    collapsedActivityY: getProcessCollapsedActivityY({yOffset, yHeight: rankHeight})
  };
}

function getStreamLayoutYExtents(layout: ThreadLayout): {
  count: number;
  maxY: number;
  minY: number;
} {
  if (
    layout.manualContentHeight != null &&
    Number.isFinite(layout.manualContentHeight) &&
    layout.manualContentHeight > 0
  ) {
    return {
      count: 2,
      minY: layout.yPosition,
      maxY: layout.yPosition + layout.manualContentHeight
    };
  }

  const laneYPositions = layout.lanes?.laneYPositions;
  if (!laneYPositions?.length) {
    return {count: 1, maxY: layout.yPosition, minY: layout.yPosition};
  }

  let minY = laneYPositions[0] ?? layout.yPosition;
  let maxY = minY;
  for (let index = 1; index < laneYPositions.length; index++) {
    const laneYPosition = laneYPositions[index]!;
    if (laneYPosition < minY) {
      minY = laneYPosition;
    }
    if (laneYPosition > maxY) {
      maxY = laneYPosition;
    }
  }

  return {count: laneYPositions.length, maxY, minY};
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

/** Builds one infinite-width background polygon from visible process-row Y extents. */
export function computeRankBackgroundPolygonInfinite(params: {
  rankLayout: ProcessLayout;
  threadLayouts: ThreadLayout[];
}): Float32Array {
  const {rankLayout, threadLayouts} = params;
  let lanePositionCount = 0;
  let maxY = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let visibleStreamCount = 0;

  for (const layout of threadLayouts) {
    if (!layout.visible) {
      continue;
    }
    visibleStreamCount += 1;
    const yExtents = getStreamLayoutYExtents(layout);
    lanePositionCount += yExtents.count;
    minY = Math.min(minY, yExtents.minY);
    maxY = Math.max(maxY, yExtents.maxY);
  }

  if (visibleStreamCount === 0 || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return new Float32Array();
  }

  let padding = DEFAULT_BACKGROUND_PADDING;
  if (lanePositionCount > 1) {
    const averageSeparation = (maxY - minY) / (lanePositionCount - 1);
    if (Number.isFinite(averageSeparation) && averageSeparation > 0) {
      padding = Math.max(DEFAULT_BACKGROUND_PADDING, averageSeparation / 2);
    }
  } else if (Number.isFinite(rankLayout.yHeight) && rankLayout.yHeight > 0) {
    const estimatedSpacing = rankLayout.yHeight / Math.max(visibleStreamCount, 1);
    if (Number.isFinite(estimatedSpacing) && estimatedSpacing > 0) {
      padding = Math.max(
        DEFAULT_BACKGROUND_PADDING,
        Math.min(estimatedSpacing / 2, MAX_BACKGROUND_PADDING)
      );
    }
  }

  let top = minY - padding;
  let bottom = maxY + padding;

  const headerTop = rankLayout.yOffset;
  if (Number.isFinite(headerTop)) {
    top = Math.min(top, headerTop);
  }

  const headerBottom = rankLayout.yOffset + rankLayout.yHeight;
  if (Number.isFinite(headerBottom)) {
    bottom = Math.max(bottom, headerBottom);
  }

  if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
    return new Float32Array();
  }

  if (!(bottom > top)) {
    const adjustment = padding || DEFAULT_BACKGROUND_PADDING;
    const centerY = (top + bottom) / 2;
    const polygon = new Float32Array(8);
    let index = 0;
    polygon[index++] = -INFINITE_HORIZONTAL_EXTENT;
    polygon[index++] = centerY - adjustment;
    polygon[index++] = INFINITE_HORIZONTAL_EXTENT;
    polygon[index++] = centerY - adjustment;
    polygon[index++] = INFINITE_HORIZONTAL_EXTENT;
    polygon[index++] = centerY + adjustment;
    polygon[index++] = -INFINITE_HORIZONTAL_EXTENT;
    polygon[index++] = centerY + adjustment;
    assert(index === polygon.length);
    return polygon;
  }

  const polygon = new Float32Array(8);
  let index = 0;
  polygon[index++] = -INFINITE_HORIZONTAL_EXTENT;
  polygon[index++] = top;
  polygon[index++] = INFINITE_HORIZONTAL_EXTENT;
  polygon[index++] = top;
  polygon[index++] = INFINITE_HORIZONTAL_EXTENT;
  polygon[index++] = bottom;
  polygon[index++] = -INFINITE_HORIZONTAL_EXTENT;
  polygon[index++] = bottom;
  assert(index === polygon.length);
  return polygon;
}

export function computeSequentialRankDeltas<
  ProcessT extends Pick<TraceLayoutVisibleProcessMetadata, 'processId' | 'processRef'>
>(computations: LayoutComputation<ProcessT>[]): number[][] {
  const result: number[][] = [];
  let currentOffset = 0;

  for (const computation of computations) {
    const minYOffset = computation.layout.processLayouts.reduce((min, layout) => {
      if (!layout) {
        return min;
      }
      return Math.min(min, layout.yOffset ?? min);
    }, Number.POSITIVE_INFINITY);
    const baseYOffset = Number.isFinite(minYOffset) ? minYOffset : 0;
    const translation = currentOffset - baseYOffset;
    const deltas = computation.layout.processLayouts.map(() => translation);
    result.push(deltas);

    const totalSpacing = computation.rankSpacings.reduce((sum, spacing) => sum + spacing, 0);
    currentOffset += totalSpacing;
  }

  return result;
}

export function computeInterleavedRankDeltas<
  ProcessT extends Pick<TraceLayoutVisibleProcessMetadata, 'processId' | 'processRef'>
>(computations: LayoutComputation<ProcessT>[]): number[][] {
  if (computations.length <= 1) {
    return computeSequentialRankDeltas(computations);
  }

  const result = computations.map(computation =>
    new Array(computation.layout.processLayouts.length).fill(0)
  );
  const placedRanks = computations.map(() => new Set<number>());
  const rankIndexMaps = computations.map(computation =>
    buildRankIdToLayoutIndexMap({
      processes: computation.processes,
      layout: computation.layout
    })
  );
  const baseProcessIds = new Set(computations[0]?.processes.map(rank => rank.processId) ?? []);

  let cursor = 0;

  const baseComputation = computations[0]!;
  baseComputation.processes.forEach(rank => {
    const baseIndex = rankIndexMaps[0]!.get(rank.processId);
    if (baseIndex === undefined || placedRanks[0]!.has(baseIndex)) {
      return;
    }

    const baseLayout = baseComputation.layout.processLayouts[baseIndex];
    const translation = cursor - (baseLayout?.yOffset ?? 0);
    if (baseLayout) {
      result[0]![baseIndex] = translation;
    }
    placedRanks[0]!.add(baseIndex);
    cursor += baseComputation.rankSpacings[baseIndex] ?? 0;

    for (let computationIndex = 1; computationIndex < computations.length; computationIndex++) {
      const matchIndex =
        rankIndexMaps[computationIndex]!.get(rank.processId) ??
        getUnmatchedRankIndexForInterleaving({
          computation: computations[computationIndex]!,
          preferredIndex: baseIndex,
          placedRanks: placedRanks[computationIndex]!,
          baseProcessIds
        });
      if (matchIndex === undefined || placedRanks[computationIndex]!.has(matchIndex)) {
        continue;
      }

      const otherComputation = computations[computationIndex]!;
      const otherLayout = otherComputation.layout.processLayouts[matchIndex];
      const otherTranslation = cursor - (otherLayout?.yOffset ?? 0);
      if (otherLayout) {
        result[computationIndex]![matchIndex] = otherTranslation;
      }
      placedRanks[computationIndex]!.add(matchIndex);
      cursor += otherComputation.rankSpacings[matchIndex] ?? 0;
    }
  });

  for (let computationIndex = 0; computationIndex < computations.length; computationIndex++) {
    const computation = computations[computationIndex]!;
    computation.layout.processLayouts.forEach((layout, rankIndex) => {
      if (placedRanks[computationIndex]!.has(rankIndex)) {
        return;
      }

      const translation = cursor - (layout?.yOffset ?? 0);
      if (layout) {
        result[computationIndex]![rankIndex] = translation;
      }
      placedRanks[computationIndex]!.add(rankIndex);
      cursor += computation.rankSpacings[rankIndex] ?? 0;
    });
  }

  return result;
}

/**
 * Returns a same-position fallback rank for interleaving graphs with disjoint process ids.
 */
function getUnmatchedRankIndexForInterleaving<
  ProcessT extends Pick<TraceLayoutVisibleProcessMetadata, 'processId' | 'processRef'>
>(params: {
  computation: LayoutComputation<ProcessT>;
  preferredIndex: number;
  placedRanks: ReadonlySet<number>;
  baseProcessIds: ReadonlySet<string>;
}): number | undefined {
  if (params.placedRanks.has(params.preferredIndex)) {
    return undefined;
  }
  const rank = params.computation.processes[params.preferredIndex];
  if (!rank || params.baseProcessIds.has(rank.processId)) {
    return undefined;
  }
  return params.preferredIndex;
}

export function applyRankDeltas(params: {
  layout: TraceLayout;
  /** Visible processes keyed by id/ref/thread refs for delta application. */
  processes: Readonly<
    Array<Pick<TraceLayoutVisibleProcessMetadata, 'processId' | 'processRef' | 'threadRefs'>>
  >;
  rankDeltas: number[];
  trackAggregationMode: TrackAggregationMode;
  /** Minimum y-offset allowed for the first visible rank after additive translation. */
  minimumVisibleRankYOffset?: number;
}): TraceLayout {
  // Read rank thread layouts from the input snapshot while this pass rewrites output refs.
  const sourceThreadLayoutMapByRef = params.layout.threadLayoutMapByRef;
  const threadLayoutMapByRef = new Map(sourceThreadLayoutMapByRef);
  const threadRefsByLayout = new Map<ThreadLayout, Set<ThreadRef>>();
  for (const [threadRef, threadLayout] of sourceThreadLayoutMapByRef) {
    const threadRefs = threadRefsByLayout.get(threadLayout) ?? new Set<ThreadRef>();
    threadRefs.add(threadRef);
    threadRefsByLayout.set(threadLayout, threadRefs);
  }

  const translatedLaneYPositionsByDelta = new Map<number, WeakMap<readonly number[], number[]>>();
  /*
   * This per-call cache is intentionally not kept across layouts. Combined-thread mode can
   * still produce many distinct per-thread layout objects that share one lane-position array, so a
   * rank-delta pass should clone that shared lane array once per delta rather than once per logical
   * thread.
   */
  const translateLaneYPositions = (laneYPositions: readonly number[], delta: number): number[] => {
    let translatedLaneYPositionsBySource = translatedLaneYPositionsByDelta.get(delta);
    if (!translatedLaneYPositionsBySource) {
      translatedLaneYPositionsBySource = new WeakMap<readonly number[], number[]>();
      translatedLaneYPositionsByDelta.set(delta, translatedLaneYPositionsBySource);
    }

    const existingTranslatedPositions = translatedLaneYPositionsBySource.get(laneYPositions);
    if (existingTranslatedPositions) {
      return existingTranslatedPositions;
    }

    const translatedPositions = laneYPositions.map(position => position + delta);
    translatedLaneYPositionsBySource.set(laneYPositions, translatedPositions);
    return translatedPositions;
  };

  const translateThreadLayout = (threadLayout: ThreadLayout, delta: number): ThreadLayout => {
    return {
      ...threadLayout,
      yPosition: threadLayout.yPosition + delta,
      overflowLabel: threadLayout.overflowLabel
        ? {
            ...threadLayout.overflowLabel,
            y: threadLayout.overflowLabel.y + delta
          }
        : undefined,
      lanes: threadLayout.lanes
        ? {
            ...threadLayout.lanes,
            laneYPositions: translateLaneYPositions(threadLayout.lanes.laneYPositions, delta)
          }
        : undefined
    } satisfies ThreadLayout;
  };
  const translatedThreadLayoutByDelta = new Map<number, Map<ThreadLayout, ThreadLayout>>();
  const translateSharedThreadLayout = (threadLayout: ThreadLayout, delta: number): ThreadLayout => {
    if (delta === 0) {
      return threadLayout;
    }

    // Combined-thread layouts intentionally share one layout across many thread ids.
    let translatedThreadLayoutBySource = translatedThreadLayoutByDelta.get(delta);
    if (!translatedThreadLayoutBySource) {
      translatedThreadLayoutBySource = new Map<ThreadLayout, ThreadLayout>();
      translatedThreadLayoutByDelta.set(delta, translatedThreadLayoutBySource);
    }

    const existingTranslatedLayout = translatedThreadLayoutBySource.get(threadLayout);
    if (existingTranslatedLayout) {
      return existingTranslatedLayout;
    }

    const translatedThreadLayout = translateThreadLayout(threadLayout, delta);
    translatedThreadLayoutBySource.set(threadLayout, translatedThreadLayout);
    return translatedThreadLayout;
  };
  const setTranslatedThreadLayout = (
    threadLayout: ThreadLayout,
    delta: number,
    threadRefOverride?: ThreadRef
  ): ThreadLayout => {
    const translatedThreadLayout = translateSharedThreadLayout(threadLayout, delta);
    let translatedThreadRefs = threadRefsByLayout.get(translatedThreadLayout);
    if (!translatedThreadRefs) {
      translatedThreadRefs = new Set(threadRefsByLayout.get(threadLayout) ?? []);
      threadRefsByLayout.set(translatedThreadLayout, translatedThreadRefs);
      for (const threadRef of translatedThreadRefs) {
        threadLayoutMapByRef.set(threadRef, translatedThreadLayout);
      }
    }
    if (threadRefOverride != null && !translatedThreadRefs.has(threadRefOverride)) {
      translatedThreadRefs.add(threadRefOverride);
      threadLayoutMapByRef.set(threadRefOverride, translatedThreadLayout);
    }
    return translatedThreadLayout;
  };

  /**
   * Translates one rank and its already-resolved thread layouts by a shared vertical delta.
   */
  const translateProcessLayout = (
    rankLayout: ProcessLayout,
    translatedThreadLayouts: readonly ThreadLayout[],
    delta: number
  ): ProcessLayout => {
    const updatedProcessLayout = {
      ...rankLayout,
      yOffset: rankLayout.yOffset + delta,
      labelY: rankLayout.labelY + delta,
      contentStartY: rankLayout.contentStartY + delta,
      threadLayouts: [...translatedThreadLayouts]
    } satisfies ProcessLayout;

    updatedProcessLayout.collapsedActivityY = getProcessCollapsedActivityY({
      yOffset: updatedProcessLayout.yOffset,
      yHeight: updatedProcessLayout.yHeight
    });

    const translatedProcessLayout = {
      ...updatedProcessLayout,
      backgroundPolygonInfinite: computeRankBackgroundPolygonInfinite({
        rankLayout: updatedProcessLayout,
        threadLayouts: updatedProcessLayout.threadLayouts
      })
    } satisfies ProcessLayout;
    return translatedProcessLayout;
  };

  /**
   * Returns the additive normalization delta needed to keep visible rank offsets above a floor.
   */
  const getMinimumVisibleRankDelta = (
    rankLayouts: readonly ProcessLayout[],
    minimumVisibleRankYOffset: number
  ): number => {
    const minYOffset = rankLayouts.reduce((min, rankLayout) => {
      if (!Number.isFinite(rankLayout.yOffset)) {
        return min;
      }
      return Math.min(min, rankLayout.yOffset);
    }, Number.POSITIVE_INFINITY);

    return Number.isFinite(minYOffset) && minYOffset < minimumVisibleRankYOffset
      ? minimumVisibleRankYOffset - minYOffset
      : 0;
  };

  const processByRef = new Map(
    params.processes.map(process => [process.processRef, process] as const)
  );

  const processLayouts = params.layout.processLayouts.map((rankLayout, rankIndex) => {
    const delta = params.rankDeltas[rankIndex] ?? 0;
    const processLayout = params.layout.processLayouts[rankIndex];
    const isCombinedMode = params.trackAggregationMode === 'combine-threads';

    if (delta !== 0) {
      const rankProcess = processByRef.get(rankLayout.processRef);
      if (rankProcess) {
        for (const threadRef of rankProcess.threadRefs) {
          const streamLayout = sourceThreadLayoutMapByRef.get(threadRef);
          if (!streamLayout) {
            continue;
          }
          setTranslatedThreadLayout(streamLayout, delta, threadRef);
        }
      }
    }

    const threadLayouts = (processLayout?.threadLayouts ?? [])
      .map(streamLayout => setTranslatedThreadLayout(streamLayout, delta))
      .filter((layout): layout is ThreadLayout => Boolean(layout));

    const translatedThreadLayouts = isCombinedMode ? threadLayouts.slice(0, 1) : threadLayouts;
    if (
      delta === 0 &&
      translatedThreadLayouts.length === rankLayout.threadLayouts.length &&
      translatedThreadLayouts.every(
        (threadLayout, threadIndex) => threadLayout === rankLayout.threadLayouts[threadIndex]
      )
    ) {
      return rankLayout;
    }

    return translateProcessLayout(rankLayout, translatedThreadLayouts, delta);
  });

  const normalizationDelta = getMinimumVisibleRankDelta(
    processLayouts,
    params.minimumVisibleRankYOffset ?? 0
  );
  if (normalizationDelta > 0) {
    for (const [threadRef, threadLayout] of [...threadLayoutMapByRef]) {
      setTranslatedThreadLayout(threadLayout, normalizationDelta, threadRef);
    }

    processLayouts.forEach((rankLayout, rankIndex) => {
      processLayouts[rankIndex] = translateProcessLayout(
        rankLayout,
        rankLayout.threadLayouts.map(threadLayout =>
          setTranslatedThreadLayout(threadLayout, normalizationDelta)
        ),
        normalizationDelta
      );
    });
  }

  return {
    ...params.layout,
    processLayouts,
    processLayoutMapByRef: buildTraceLayoutProcessLayoutMapByRef(processLayouts),
    threadLayoutMapByRef
  };
}

export function streamIsVisible(
  stream: TraceThread,
  settings: Pick<TraceVisSettings, 'threadDisplayMode' | 'selectedThreadNames'>
): boolean {
  const streamName = stream.name;
  switch (settings.threadDisplayMode) {
    case 'selected': {
      const selectedNames = (settings.selectedThreadNames ?? []).filter(
        (name): name is string =>
          typeof name === 'string' && name.length > 0 && name !== 'all_threads'
      );
      if (selectedNames.length === 0) {
        return true;
      }
      return selectedNames.includes(streamName);
    }
    case 'minimal':
      return !DEFAULT_MINIMAL_THREAD_HIDDEN_NAMES.includes(streamName);
    case 'active':
    case 'all':
    default:
      return true;
  }
}

export function getCombinedRankLaneAssignments(params: {
  rank: Pick<TraceLayoutLaneSourceProcess, 'processId'>;
  /** Visible spans eligible for combined-lane assignment. */
  spans: readonly TraceLayoutLaneSpanSource[];
  sameProcessDependencies: readonly TraceLayoutLaneDependencySource[];
  /** Visible thread refs eligible for combined-lane assignment. */
  visibleThreadRefs: ReadonlySet<ThreadRef>;
  maxTimeMs: number;
  maxVisibleLanesPerThread?: number;
  maxVisibleLanesUnlimited?: boolean;
  /** Writes each generated lane into layout-owned span-table-aligned lane columns. */
  onSpanLaneAssigned?: (spanRef: SpanRef, laneIndex: number) => void;
}): {
  laneCount: number;
  maxLane: number;
  overflowSpanCount: number;
} {
  const {spans, sameProcessDependencies, visibleThreadRefs, maxTimeMs} = params;

  const visibleSpans = spans.filter(
    span => span.threadRef != null && visibleThreadRefs.has(span.threadRef)
  );
  if (visibleSpans.length === 0) {
    return {
      laneCount: 0,
      maxLane: -1,
      overflowSpanCount: 0
    };
  }

  const explicitParentByChild = buildExplicitParentSpanMap({
    spans: visibleSpans,
    sameProcessDependencies
  });
  const hasCombinedParentHints = explicitParentByChild.size > 0;
  const hasCombinedLaneAffinity = hasTraceLaneAffinity(visibleSpans);

  const laneAssignmentCounts: number[] = [];
  const maxLane = visitKahnLaneAssignments<TraceLayoutLaneSpanSource>(
    visibleSpans,
    {
      ...(hasCombinedParentHints
        ? {
            getParentSpanRef: (span: TraceLayoutLaneSpanSource) =>
              explicitParentByChild.get(span.spanRef)
          }
        : {}),
      ...(hasCombinedLaneAffinity
        ? {
            compactLaneAffinity: COMPACT_TRACE_LANE_AFFINITY,
            getLaneAffinityKey: getTraceLaneAffinityKey
          }
        : {}),
      maxTimeMs
    },
    (span, lane) => {
      params.onSpanLaneAssigned?.(span.spanRef, lane);
      laneAssignmentCounts[lane] = (laneAssignmentCounts[lane] ?? 0) + 1;
    }
  );
  const laneCount = Math.max(maxLane + 1, 0);
  const normalizedLaneCount = normalizeLaneCounts(
    laneCount,
    params.maxVisibleLanesPerThread,
    params.maxVisibleLanesUnlimited
  );
  const overflowSpanCount = countOverflowSpanLaneCounts(
    laneAssignmentCounts,
    normalizedLaneCount.renderedLaneCount,
    normalizedLaneCount.hasOverflow
  );

  return {
    laneCount,
    maxLane,
    overflowSpanCount
  };
}

export function calculateTraceLayout(props: {
  processes: Readonly<TraceLayoutLaneSourceProcess[]>;
  maxTimeMs: number;
  settings: {
    threadDisplayMode: 'all' | 'active' | 'selected' | 'minimal';
    selectedThreadNames?: string[];
    sortThreads?: boolean;
    maxVisibleLanesPerThread?: number;
    maxVisibleLanesUnlimited?: boolean;
    trackAggregationMode: TrackAggregationMode;
    showEmptyProcesses?: boolean;
  };
  layoutConfiguration: TraceLayoutConfiguration;
  collapsedProcessIds?: ReadonlySet<string>;
  /** Optional lane metadata keyed by process-local thread id for legacy callers. */
  streamLaneLayoutMap?: Readonly<Record<TraceThreadId, ThreadLaneMetadata>>;
  /** Optional lane metadata keyed by canonical runtime thread ref for ref-native callers. */
  threadLaneLayoutMapByRef?: ReadonlyMap<ThreadRef, ThreadLaneMetadata>;
  /** Optional explicit thread refs forced open in this layout. */
  expandedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Optional explicit thread refs forced closed in this layout. */
  collapsedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Whether streams without explicit lane metadata should be hidden from this layout. */
  hideStreamsWithoutLaneMetadata?: boolean;
  /** Optional preserved combined lane assignments keyed by rank id. */
  combinedLaneAssignmentsByRankId?: Readonly<Record<string, CombinedRankLaneAssignmentOverride>>;
  traceGraph: TraceGraph;
  /** Resolves lightweight lane spans for one process without materializing `TraceSpan`. */
  getLaneSpansForProcess?: (processId: string) => readonly TraceLayoutLaneSpanSource[];
  /** Resolves lightweight lane dependencies for one process without materializing `TraceSameProcessDependency`. */
  getLaneSameProcessDependenciesForProcess?: (
    processId: string
  ) => readonly TraceLayoutLaneDependencySource[];
}): {layout: TraceLayout; rankSpacings: number[]} {
  const aggregationMode = props.settings.trackAggregationMode;
  const layoutStartTime = performance.now();
  const {laneSeparation, processSeparation, threadSeparation, labelPadding, labelMinGap} =
    props.layoutConfiguration;
  const {processes, maxTimeMs} = props;
  const hideStreamsWithoutLaneMetadata = props.hideStreamsWithoutLaneMetadata ?? false;
  const processContentTopInset =
    getProcessContentStartY({
      yOffset: 0,
      layoutConfiguration: props.layoutConfiguration
    }) || labelPadding + labelMinGap;
  let yOffset = 0;
  const shouldCombineThreads = aggregationMode === 'combine-threads';
  let totalVisibleThreadCount = 0;
  let laneLayoutCallCount = 0;
  let laneLayoutSpanCount = 0;
  let spanBucketingDurationMs = 0;
  let combinedLaneAssignmentDurationMs = 0;
  let separateLaneAssignmentDurationMs = 0;
  let rankAssemblyDurationMs = 0;
  const spanLaneColumnsByChunkIndex =
    props.traceGraph.spanLayout === 'manual' ? undefined : createTraceLayoutSpanLaneColumns();
  const setSpanLaneIndex = (spanRef: SpanRef, laneIndex: number): void => {
    if (!spanLaneColumnsByChunkIndex) {
      return;
    }
    setTraceLayoutSpanLaneIndex({
      traceGraph: props.traceGraph,
      spanLaneColumnsByChunkIndex,
      spanRef,
      laneIndex
    });
  };

  const threadLayoutMapByRef = new Map<ThreadRef, ThreadLayout>();
  const rankSpacings: number[] = new Array(processes.length).fill(0);

  const processLayouts: ProcessLayout[] = new Array(processes.length);
  const ranksInLayoutOrder = processes.map((rank, rankIndex) => ({rank, rankIndex}));
  const showEmptyProcesses = props.settings.showEmptyProcesses ?? false;
  const rankHasDisplayableSpanContent = ranksInLayoutOrder.map(({rank}) => {
    if (showEmptyProcesses) {
      return true;
    }

    const rankLaneSpans = props.getLaneSpansForProcess?.(rank.processId) ?? rank.laneSpans ?? [];
    const displayableThreadRefs = new Set(
      rank.threads.flatMap((thread, threadIndex) => {
        const threadRef = rank.threadRefs[threadIndex];
        const laneMetadata = getTraceLayoutThreadLaneMetadata({
          streamLaneLayoutMap: props.streamLaneLayoutMap,
          threadLaneLayoutMapByRef: props.threadLaneLayoutMapByRef,
          threadId: thread.threadId,
          threadRef
        });
        return threadRef != null &&
          (!hideStreamsWithoutLaneMetadata || laneMetadata !== undefined) &&
          streamIsVisible(thread, props.settings)
          ? [threadRef]
          : [];
      })
    );

    return rankLaneSpans.some(span => {
      const threadRef = getSpanOwnerThreadRef(props.traceGraph, span.spanRef);
      return threadRef != null && displayableThreadRefs.has(threadRef);
    });
  });

  ranksInLayoutOrder.forEach(({rank, rankIndex}) => {
    if (!rankHasDisplayableSpanContent[rankIndex]) {
      return;
    }

    const rankLaneSpans = props.getLaneSpansForProcess?.(rank.processId) ?? rank.laneSpans ?? [];
    const rankLaneSameProcessDependencies =
      props.getLaneSameProcessDependenciesForProcess?.(rank.processId) ??
      rank.laneSameProcessDependencies ??
      [];
    const explicitParentByChild = shouldCombineThreads
      ? undefined
      : buildExplicitParentSpanMap({
          spans: rankLaneSpans,
          sameProcessDependencies: rankLaneSameProcessDependencies
        });
    const rankIsCollapsed = props.collapsedProcessIds?.has(rank.processId) ?? false;
    const threadRefByThread = new Map<TraceThread, ThreadRef>();
    rank.threads.forEach((thread, threadIndex) => {
      const threadRef = rank.threadRefs[threadIndex];
      if (threadRef != null) {
        threadRefByThread.set(thread, threadRef);
      }
    });
    const threadLayouts: ThreadLayout[] = [];
    const rankContentStartY = yOffset + processContentTopInset;
    let contentStartY = rankContentStartY;
    const threadsInLayoutOrder = [...rank.threads];
    const threadSpans = shouldCombineThreads
      ? null
      : (() => {
          const rankLaneSpans = (props.getLaneSpansForProcess?.(rank.processId) ??
            rank.laneSpans ??
            []) as readonly TraceSpanLaneSource[];
          const nextThreadSpans = new Map<ThreadRef, TraceSpanLaneSource[]>();
          const spanBucketingStartTime = performance.now();
          for (const span of rankLaneSpans) {
            const threadRef = getSpanOwnerThreadRef(props.traceGraph, span.spanRef);
            if (threadRef == null) {
              continue;
            }
            const spansForThread = nextThreadSpans.get(threadRef);
            if (spansForThread) {
              spansForThread.push(span);
            } else {
              nextThreadSpans.set(threadRef, [span]);
            }
          }
          spanBucketingDurationMs += performance.now() - spanBucketingStartTime;
          return nextThreadSpans;
        })();

    if (props.settings.sortThreads) {
      threadsInLayoutOrder.sort((a, b) => {
        const aName = a.name?.trim() || String(a.threadId);
        const bName = b.name?.trim() || String(b.threadId);
        return compareNumericSortStrings(aName, bName);
      });
    }

    const displayableThreads = threadsInLayoutOrder.filter(thread => {
      const laneMetadata = getTraceLayoutThreadLaneMetadata({
        streamLaneLayoutMap: props.streamLaneLayoutMap,
        threadLaneLayoutMapByRef: props.threadLaneLayoutMapByRef,
        threadId: thread.threadId,
        threadRef: threadRefByThread.get(thread)
      });
      return (
        (!hideStreamsWithoutLaneMetadata || laneMetadata !== undefined) &&
        streamIsVisible(thread, props.settings)
      );
    });
    const visibleThreads = rankIsCollapsed ? [] : displayableThreads;
    totalVisibleThreadCount += visibleThreads.length;
    const combinedLaneAssignments = shouldCombineThreads
      ? (() => {
          const combinedAssignmentOverride =
            props.combinedLaneAssignmentsByRankId?.[rank.processId];
          if (combinedAssignmentOverride) {
            for (const assignment of combinedAssignmentOverride.spanLaneAssignments) {
              setSpanLaneIndex(assignment.spanRef, assignment.laneIndex);
            }
            return combinedAssignmentOverride;
          }
          const combinedLaneAssignmentStartTime = performance.now();
          const visibleThreadRefs = new Set(
            visibleThreads.flatMap(thread => {
              const threadRef = threadRefByThread.get(thread);
              return threadRef != null ? [threadRef] : [];
            })
          );
          const visibleSpanCount = rankLaneSpans.filter(span => {
            const threadRef = getSpanOwnerThreadRef(props.traceGraph, span.spanRef);
            return threadRef != null && visibleThreadRefs.has(threadRef);
          }).length;
          if (visibleSpanCount > 0) {
            laneLayoutCallCount += 1;
            laneLayoutSpanCount += visibleSpanCount;
          }
          const combinedAssignments = getCombinedRankLaneAssignments({
            rank,
            spans: rankLaneSpans,
            sameProcessDependencies: rankLaneSameProcessDependencies,
            visibleThreadRefs,
            maxTimeMs,
            maxVisibleLanesPerThread: props.settings.maxVisibleLanesPerThread,
            maxVisibleLanesUnlimited: props.settings.maxVisibleLanesUnlimited,
            onSpanLaneAssigned: setSpanLaneIndex
          });
          combinedLaneAssignmentDurationMs += performance.now() - combinedLaneAssignmentStartTime;
          return combinedAssignments;
        })()
      : null;

    let visibleLaneCount = 0;
    let visibleThreadCount = 0;

    if (shouldCombineThreads) {
      const isRankVisible = visibleThreads.length > 0;
      const baseYPosition = isRankVisible ? rankContentStartY : -1000;
      const normalizedCombinedLanes = normalizeLaneCounts(
        Math.max(combinedLaneAssignments?.laneCount ?? 0, 0),
        props.settings.maxVisibleLanesPerThread,
        props.settings.maxVisibleLanesUnlimited
      );
      const combinedVisibleLaneIndices = Array.from(
        threadsInLayoutOrder.reduce((laneIndices, thread) => {
          const visibleLaneIndices = getTraceLayoutThreadLaneMetadata({
            streamLaneLayoutMap: props.streamLaneLayoutMap,
            threadLaneLayoutMapByRef: props.threadLaneLayoutMapByRef,
            threadId: thread.threadId,
            threadRef: threadRefByThread.get(thread)
          })?.visibleLaneIndices;
          visibleLaneIndices?.forEach(laneIndex => {
            if (
              Number.isInteger(laneIndex) &&
              laneIndex >= 0 &&
              laneIndex < normalizedCombinedLanes.laneCount
            ) {
              laneIndices.add(laneIndex);
            }
          });
          return laneIndices;
        }, new Set<number>())
      ).sort((left, right) => left - right);
      const effectiveCombinedVisibleLaneIndices =
        combinedVisibleLaneIndices.length > 0 ? combinedVisibleLaneIndices : undefined;
      const visibleLaneCountForRank =
        effectiveCombinedVisibleLaneIndices?.length ?? normalizedCombinedLanes.laneCount;
      const renderedLaneCountForRank =
        effectiveCombinedVisibleLaneIndices?.length ?? normalizedCombinedLanes.renderedLaneCount;
      const combinedLaneYPositions = buildLaneYPositions(
        rankContentStartY,
        visibleLaneCountForRank,
        laneSeparation
      );
      const overflowSpanCount = combinedLaneAssignments?.overflowSpanCount ?? 0;
      const usesCombinedLaneAssignmentOverride = Boolean(
        props.combinedLaneAssignmentsByRankId?.[rank.processId]
      );
      const canShareCombinedThreadLayout =
        isRankVisible && visibleThreads.length === threadsInLayoutOrder.length;
      const baseLanes =
        visibleLaneCountForRank > 0
          ? {
              laneCount: visibleLaneCountForRank,
              renderedLaneCount: renderedLaneCountForRank,
              visibleLaneIndices: effectiveCombinedVisibleLaneIndices,
              isCollapsed: false,
              laneYPositions: isRankVisible ? combinedLaneYPositions : [],
              collapseMode: undefined
            }
          : undefined;
      const combinedBaseStreamLayout = {
        visible: isRankVisible,
        yPosition: baseYPosition,
        overflowSpanCount,
        lanes: baseLanes,
        hasSpanLaneAssignments: isRankVisible && (combinedLaneAssignments?.laneCount ?? 0) > 0
      } satisfies ThreadLayout;

      const combinedStreamLayout = {
        ...combinedBaseStreamLayout,
        overflowLabel: buildThreadOverflowLabel(combinedBaseStreamLayout, overflowSpanCount)
      } satisfies ThreadLayout;

      for (const thread of threadsInLayoutOrder) {
        const laneMetadata = getTraceLayoutThreadLaneMetadata({
          streamLaneLayoutMap: props.streamLaneLayoutMap,
          threadLaneLayoutMapByRef: props.threadLaneLayoutMapByRef,
          threadId: thread.threadId,
          threadRef: threadRefByThread.get(thread)
        });
        const isVisible =
          !rankIsCollapsed &&
          (!hideStreamsWithoutLaneMetadata || laneMetadata !== undefined) &&
          streamIsVisible(thread, props.settings);
        const streamVisibleLaneIndices = usesCombinedLaneAssignmentOverride
          ? effectiveCombinedVisibleLaneIndices
          : (laneMetadata?.visibleLaneIndices ??
            (effectiveCombinedVisibleLaneIndices ? [] : undefined));
        const streamMatchesCombinedLayout =
          canShareCombinedThreadLayout &&
          isVisible &&
          streamVisibleLaneIndices === effectiveCombinedVisibleLaneIndices;
        if (streamMatchesCombinedLayout) {
          /*
           * In combine-threads mode most logical threads render the exact same rank row. Point
           * their exact thread refs at the canonical combined layout so downstream rank-delta
           * passes translate one object instead of cloning one layout per logical thread. Only do
           * this when the rank has no hidden per-thread rows; collapsed or filtered threads need
           * their own invisible layout so navigable geometry can remain zero-height for those refs.
           */
          const threadRef = threadRefByThread.get(thread);
          if (threadRef != null) {
            threadLayoutMapByRef.set(threadRef, combinedStreamLayout);
          }
          continue;
        }
        const laneCount = visibleLaneCountForRank || 1;
        const threadRef = threadRefByThread.get(thread);
        const streamLayout = {
          ...combinedStreamLayout,
          threadRef,
          visible: isVisible,
          yPosition: isVisible ? baseYPosition : -1000,
          overflowLabel: isVisible ? combinedStreamLayout.overflowLabel : undefined,
          lanes:
            visibleLaneCountForRank > 0
              ? {
                  laneCount,
                  renderedLaneCount: streamVisibleLaneIndices
                    ? streamVisibleLaneIndices.length
                    : renderedLaneCountForRank,
                  visibleLaneIndices: streamVisibleLaneIndices,
                  isCollapsed: false,
                  laneYPositions: combinedLaneYPositions,
                  collapseMode: undefined
                }
              : undefined,
          hasSpanLaneAssignments: isVisible && (combinedLaneAssignments?.laneCount ?? 0) > 0
        } satisfies ThreadLayout;
        if (threadRef != null) {
          threadLayoutMapByRef.set(threadRef, streamLayout);
        }
      }

      threadLayouts.push(combinedStreamLayout);
      visibleLaneCount = visibleLaneCountForRank;
      if (isRankVisible) {
        visibleThreadCount = 1;
        contentStartY = combinedStreamLayout.yPosition;
      }
    } else {
      let currentLaneY = rankContentStartY;
      threadsInLayoutOrder.forEach(thread => {
        const laneMetadata = getTraceLayoutThreadLaneMetadata({
          streamLaneLayoutMap: props.streamLaneLayoutMap,
          threadLaneLayoutMapByRef: props.threadLaneLayoutMapByRef,
          threadId: thread.threadId,
          threadRef: threadRefByThread.get(thread)
        });
        const isVisible =
          !rankIsCollapsed &&
          (!hideStreamsWithoutLaneMetadata || laneMetadata !== undefined) &&
          streamIsVisible(thread, props.settings);
        const threadRef = threadRefByThread.get(thread);
        const spansForThread = threadRef == null ? [] : (threadSpans?.get(threadRef) ?? []);
        const disableLaneAssignment =
          getTraceGraphProcessLaneAssignmentMode(rank.userData) === 'none';
        const separateLaneAssignmentStartTime = performance.now();
        const inferredLaneAssignmentCounts: number[] = [];
        let inferredMaxLane = -1;
        if (disableLaneAssignment) {
          for (const span of spansForThread) {
            if (span.spanRef != null) {
              setSpanLaneIndex(span.spanRef, 0);
              inferredLaneAssignmentCounts[0] = (inferredLaneAssignmentCounts[0] ?? 0) + 1;
            }
          }
          inferredMaxLane = spansForThread.length > 0 ? 0 : -1;
        } else {
          laneLayoutCallCount += 1;
          laneLayoutSpanCount += spansForThread.length;
          const hasSeparateParentHints = hasParentHintsForSpans(
            spansForThread,
            explicitParentByChild
          );
          const hasSeparateLaneAffinity = hasTraceLaneAffinity(spansForThread);
          inferredMaxLane = visitKahnLaneAssignments<TraceLayoutLaneSpanSource>(
            spansForThread,
            {
              ...(hasSeparateParentHints
                ? {
                    getParentSpanRef: (span: TraceSpanLaneSource) =>
                      explicitParentByChild?.get(span.spanRef)
                  }
                : {}),
              ...(hasSeparateLaneAffinity
                ? {
                    compactLaneAffinity: COMPACT_TRACE_LANE_AFFINITY,
                    getLaneAffinityKey: getTraceLaneAffinityKey
                  }
                : {}),
              maxTimeMs
            },
            (span, lane) => {
              if (span.spanRef != null) {
                setSpanLaneIndex(span.spanRef, lane);
                inferredLaneAssignmentCounts[lane] = (inferredLaneAssignmentCounts[lane] ?? 0) + 1;
              }
            }
          );
        }
        separateLaneAssignmentDurationMs += performance.now() - separateLaneAssignmentStartTime;
        const inferredLaneCount = inferredMaxLane >= 0 ? inferredMaxLane + 1 : 0;
        const totalLaneCount = Math.max(1, laneMetadata?.laneCount ?? 1, inferredLaneCount);
        const normalizedLaneCount = normalizeLaneCounts(
          totalLaneCount,
          props.settings.maxVisibleLanesPerThread,
          props.settings.maxVisibleLanesUnlimited
        );
        const defaultCollapsed = false;
        const isExplicitlyExpanded =
          threadRef != null && (props.expandedThreadRefs?.has(threadRef) ?? false);
        const isExplicitlyCollapsed =
          threadRef != null && (props.collapsedThreadRefs?.has(threadRef) ?? false);
        const isCollapsed = isExplicitlyCollapsed
          ? true
          : isExplicitlyExpanded
            ? false
            : (laneMetadata?.isCollapsed ?? defaultCollapsed);
        const laneCollapseMode = (thread.userData as {laneCollapseMode?: string} | undefined)
          ?.laneCollapseMode;
        const spanLaneAssignments = laneMetadata?.spanLaneAssignments;
        if (spanLaneAssignments) {
          for (const assignment of spanLaneAssignments) {
            setSpanLaneIndex(assignment.spanRef, assignment.laneIndex);
          }
        }
        const normalizedVisibleLaneIndices = laneMetadata?.visibleLaneIndices
          ? [...new Set(laneMetadata.visibleLaneIndices)]
              .map(laneIndex => Math.floor(laneIndex))
              .filter(
                laneIndex =>
                  Number.isFinite(laneIndex) &&
                  laneIndex >= 0 &&
                  laneIndex < normalizedLaneCount.laneCount
              )
              .sort((a, b) => a - b)
          : undefined;
        const effectiveVisibleLaneIndices =
          normalizedVisibleLaneIndices && normalizedVisibleLaneIndices.length > 0
            ? normalizedVisibleLaneIndices
            : undefined;
        const effectiveLaneCount =
          effectiveVisibleLaneIndices && effectiveVisibleLaneIndices.length > 0
            ? effectiveVisibleLaneIndices.length
            : normalizedLaneCount.laneCount;
        const effectiveRenderedLaneCount =
          effectiveVisibleLaneIndices && effectiveVisibleLaneIndices.length > 0
            ? effectiveVisibleLaneIndices.length
            : normalizedLaneCount.renderedLaneCount;
        const overflowSpanCount = spanLaneAssignments
          ? countOverflowSpans(
              spanLaneAssignments,
              normalizedLaneCount.renderedLaneCount,
              normalizedLaneCount.hasOverflow
            )
          : countOverflowSpanLaneCounts(
              inferredLaneAssignmentCounts,
              normalizedLaneCount.renderedLaneCount,
              normalizedLaneCount.hasOverflow
            );
        const effectiveIsVisible = isVisible;
        if (effectiveIsVisible && visibleThreadCount > 0) {
          currentLaneY += threadSeparation;
        }
        const y = currentLaneY;
        const yPosition = effectiveIsVisible ? y : -1000;
        const visibleLaneCountForStream = effectiveIsVisible
          ? isCollapsed
            ? 1
            : effectiveLaneCount
          : 0;
        const laneYPositions = effectiveIsVisible
          ? buildLaneYPositions(y, visibleLaneCountForStream, laneSeparation)
          : [];

        if (effectiveIsVisible) {
          visibleLaneCount += visibleLaneCountForStream;
          visibleThreadCount += 1;
          if (visibleLaneCountForStream > 0) {
            currentLaneY = y + (visibleLaneCountForStream - 1) * laneSeparation;
          }
        }

        const streamLayout = {
          threadRef,
          visible: effectiveIsVisible,
          yPosition,
          overflowLabel: effectiveIsVisible
            ? buildThreadOverflowLabel(
                {
                  visible: effectiveIsVisible,
                  yPosition,
                  hasSpanLaneAssignments: spansForThread.length > 0,
                  lanes: {
                    laneCount: effectiveLaneCount,
                    renderedLaneCount: effectiveRenderedLaneCount,
                    visibleLaneIndices: effectiveVisibleLaneIndices,
                    isCollapsed,
                    laneYPositions,
                    collapseMode: laneCollapseMode === 'top-only' ? 'top-only' : undefined
                  }
                } satisfies ThreadLayout,
                overflowSpanCount
              )
            : undefined,
          lanes: {
            laneCount: effectiveLaneCount,
            renderedLaneCount: effectiveRenderedLaneCount,
            visibleLaneIndices: effectiveVisibleLaneIndices,
            isCollapsed,
            laneYPositions,
            collapseMode: laneCollapseMode === 'top-only' ? 'top-only' : undefined
          },
          overflowSpanCount,
          hasSpanLaneAssignments: spansForThread.length > 0
        } satisfies ThreadLayout;
        if (threadRef != null) {
          threadLayoutMapByRef.set(threadRef, streamLayout);
        }
        threadLayouts.push(streamLayout);

        if (effectiveIsVisible) {
          contentStartY = streamLayout.yPosition;
        }
      });
    }

    const visibleStreamLayouts = threadLayouts.filter(layout => layout.visible);
    const rankAssemblyStartTime = performance.now();
    const labelY = getProcessLabelY({
      yOffset,
      layoutConfiguration: props.layoutConfiguration
    });

    const collapsedCombinedThreadMetrics =
      shouldCombineThreads && rankIsCollapsed
        ? getCollapsedCombinedThreadProcessMetrics({
            yOffset,
            layoutConfiguration: props.layoutConfiguration
          })
        : undefined;
    const visibleLaneCountForSpacing =
      collapsedCombinedThreadMetrics?.rankHeight ?? Math.max(visibleLaneCount, 1);
    const visibleThreadCountForSpacing = Math.max(visibleThreadCount, 1);
    const hasOverflowLabel = visibleStreamLayouts.some(layout => layout.overflowLabel != null);
    const baseRankYSpacing =
      collapsedCombinedThreadMetrics?.rankSpacing ??
      visibleLaneCountForSpacing * laneSeparation +
        (visibleThreadCountForSpacing - 1) * (threadSeparation - laneSeparation) +
        processContentTopInset +
        (hasOverflowLabel ? laneSeparation : 0);
    const rankHasVisibleSpanContent = hasVisibleRankSpanContent(visibleStreamLayouts);
    const rankContentSpacing =
      !rankIsCollapsed && !rankHasVisibleSpanContent
        ? Math.max(
            baseRankYSpacing,
            getCollapsedProcessMinimumRankSpacing(props.layoutConfiguration)
          )
        : baseRankYSpacing;
    const rankLayout = {
      processRef: rank.processRef,
      isCollapsed: rankIsCollapsed,
      yOffset: yOffset,
      yHeight: rankContentSpacing,
      labelY: collapsedCombinedThreadMetrics?.labelY ?? labelY,
      collapsedActivityY:
        collapsedCombinedThreadMetrics?.collapsedActivityY ??
        getProcessCollapsedActivityY({yOffset, yHeight: rankContentSpacing}),
      contentStartY,
      threadLayouts,
      backgroundPolygonInfinite: new Float32Array(0) as Float32Array
    } satisfies ProcessLayout;

    rankLayout.backgroundPolygonInfinite = computeRankBackgroundPolygonInfinite({
      rankLayout,
      threadLayouts
    });

    const hasFollowingDisplayableProcess = rankHasDisplayableSpanContent
      .slice(rankIndex + 1)
      .some(Boolean);
    const processGap = showEmptyProcesses || hasFollowingDisplayableProcess ? processSeparation : 0;
    const rankYSpacing = rankContentSpacing + processGap;
    rankSpacings[rankIndex] = rankYSpacing;
    yOffset += rankYSpacing;

    processLayouts[rankIndex] = rankLayout;
    rankAssemblyDurationMs += performance.now() - rankAssemblyStartTime;
  });

  log.probe(
    1,
    `lane-layout calculateTraceLayout done aggregationMode=${aggregationMode} processes=${processes.length} visibleThreads=${totalVisibleThreadCount} laneLayoutCalls=${laneLayoutCallCount} laneLayoutSpans=${laneLayoutSpanCount} spanBucketingMs=${spanBucketingDurationMs.toFixed(1)} combinedLaneMs=${combinedLaneAssignmentDurationMs.toFixed(1)} separateLaneMs=${separateLaneAssignmentDurationMs.toFixed(1)} rankAssemblyMs=${rankAssemblyDurationMs.toFixed(1)} totalMs=${(performance.now() - layoutStartTime).toFixed(1)}`,
    {
      spanBucketingDurationMs,
      combinedLaneAssignmentDurationMs,
      separateLaneAssignmentDurationMs,
      rankAssemblyDurationMs,
      durationMs: performance.now() - layoutStartTime,
      ...getHeapUsageProbeFields()
    }
  )();

  return {
    layout: {
      layoutConfiguration: {
        laneSeparation: props.layoutConfiguration.laneSeparation,
        spanHeight: props.layoutConfiguration.spanHeight,
        minTimeMs: props.traceGraph.minTimeMs
      },
      traceGraph: props.traceGraph,
      spanLaneColumnsByChunkIndex,
      processLayouts,
      processLayoutMapByRef: buildTraceLayoutProcessLayoutMapByRef(processLayouts),
      renderRows: [],
      threadLayoutMapByRef,
      currentBounds: [
        [0, 0],
        [0, 0]
      ]
    },
    rankSpacings
  } satisfies {layout: TraceLayout; rankSpacings: number[]};
}

/** Returns lane metadata for one thread, preferring canonical runtime refs over local ids. */
function getTraceLayoutThreadLaneMetadata(params: {
  /** Optional lane metadata keyed by process-local thread id for legacy callers. */
  readonly streamLaneLayoutMap?: Readonly<Record<TraceThreadId, ThreadLaneMetadata>>;
  /** Optional lane metadata keyed by canonical runtime thread ref for ref-native callers. */
  readonly threadLaneLayoutMapByRef?: ReadonlyMap<ThreadRef, ThreadLaneMetadata>;
  /** Process-local thread id used by legacy lane metadata. */
  readonly threadId: TraceThreadId;
  /** Canonical runtime thread ref used by ref-native lane metadata. */
  readonly threadRef?: ThreadRef;
}): ThreadLaneMetadata | undefined {
  return (
    (params.threadRef != null ? params.threadLaneLayoutMapByRef?.get(params.threadRef) : null) ??
    params.streamLaneLayoutMap?.[params.threadId]
  );
}

/**
 * Builds child-to-parent hints from source-declared same-process parent dependencies.
 *
 * Interval containment is deliberately not parenthood. Generated lane hierarchy follows only the
 * explicit parent marker produced by ingestion, so unrelated enclosing work cannot silently force
 * a richer lane pass or alter vertical structure.
 */
export function buildExplicitParentSpanMap(params: {
  /** Visible spans whose refs may participate in explicit parent hierarchy. */
  spans: readonly Pick<TraceLayoutLaneSpanSource, 'spanRef'>[];
  /** Visible dependency rows eligible for explicit parent lookup. */
  sameProcessDependencies: readonly TraceLayoutLaneDependencySource[];
}): Map<SpanRef, SpanRef> {
  const visibleSpanRefs = new Set(params.spans.map(span => span.spanRef));
  const explicitParentByChild = new Map<SpanRef, SpanRef>();
  for (const dependency of params.sameProcessDependencies) {
    if (dependency.hasParentKeyword !== true) {
      continue;
    }
    const parentRef = dependency.startSpanRef;
    const childRef = dependency.endSpanRef;
    if (
      parentRef == null ||
      childRef == null ||
      !visibleSpanRefs.has(parentRef) ||
      !visibleSpanRefs.has(childRef) ||
      explicitParentByChild.has(childRef)
    ) {
      continue;
    }
    explicitParentByChild.set(childRef, parentRef);
  }
  return explicitParentByChild;
}

/**
 * Returns the conventional span trace id used for soft generated-lane affinity when available.
 *
 * @remarks
 * Lane layout treats this value as a soft raw key, not a permanent lane reservation. Only one
 * overlap-connected activity component of the key keeps nearby legal lanes warm; after that
 * component becomes idle, later same-trace spans may compact upward.
 */
export function getTraceLaneAffinityKey(
  span: Pick<TraceSpanLaneSource, 'traceAffinityKey' | 'userData'>
): string | number | bigint | null {
  if (span.traceAffinityKey != null) {
    return span.traceAffinityKey;
  }
  const userData = span.userData;
  const affinityKey = userData?.traceId ?? userData?.trace_id;
  return typeof affinityKey === 'string' ||
    typeof affinityKey === 'number' ||
    typeof affinityKey === 'bigint'
    ? affinityKey
    : null;
}

/** Returns whether any lane span carries conventional trace-affinity metadata. */
export function hasTraceLaneAffinity(
  spans: readonly Pick<TraceSpanLaneSource, 'traceAffinityKey' | 'userData'>[]
): boolean {
  return spans.some(span => getTraceLaneAffinityKey(span) != null);
}

/** Returns whether the lane-assignment batch has at least one explicit parent hint. */
export function hasParentHintsForSpans(
  spans: readonly Pick<TraceSpanLaneSource, 'spanRef'>[],
  explicitParentByChild: ReadonlyMap<SpanRef, SpanRef> | undefined
): boolean {
  if (!explicitParentByChild || explicitParentByChild.size === 0) {
    return false;
  }
  return spans.some(span => explicitParentByChild.has(span.spanRef));
}

export function buildTraceSameProcessDependencyGeometries(params: {
  sameProcessDependencies: TraceSameProcessDependencySource[];
  /** Renderable spans keyed by canonical runtime span ref. */
  spanByRef: ReadonlyMap<SpanRef, TraceSpanGeometrySource>;
  maxTimeMs: number;
  /** Ref-native layout lookup used for geometry construction. */
  layoutLookup: TraceGeometryLayoutLookup;
  minTimeMs: number;
  dependencyGeometryMap: Record<TraceDependencyId, Float32Array>;
  settings: {
    dependencyDisplayMode?: 'all' | 'exclude' | 'include';
    dependencyKeywords?: string[];
  };
}): void {
  const {sameProcessDependencies, spanByRef, minTimeMs, dependencyGeometryMap} = params;
  const resolvedMaxTimeMs =
    Number.isFinite(params.maxTimeMs) && params.maxTimeMs > 0
      ? params.maxTimeMs
      : Number.MAX_SAFE_INTEGER;
  const {dependencyDisplayMode, dependencyKeywords = []} = params.settings;
  let skippedStartSpanCount = 0;
  let skippedEndSpanCount = 0;

  for (const localDep of sameProcessDependencies) {
    if (dependencyDisplayMode === 'exclude') {
      if ([...localDep.keywords].some(keyword => dependencyKeywords.includes(keyword))) {
        continue;
      }
    }

    const startSpan =
      localDep.startSpanRef == null ? undefined : spanByRef.get(localDep.startSpanRef);
    if (!startSpan) {
      skippedStartSpanCount += 1;
      continue;
    }

    const endSpan = localDep.endSpanRef == null ? undefined : spanByRef.get(localDep.endSpanRef);
    if (!endSpan) {
      skippedEndSpanCount += 1;
      continue;
    }

    dependencyGeometryMap[localDep.dependencyId] = getSameProcessDependencyPathFlat({
      startSpan,
      endSpan,
      layoutLookup: params.layoutLookup,
      maxTimeMs: resolvedMaxTimeMs,
      minTimeMs,
      waitMode: localDep.waitMode,
      bidirectional: localDep.bidirectional,
      isParentDependency: localDep.keywords.has('PARENT')
    });
  }

  if (skippedStartSpanCount > 0 || skippedEndSpanCount > 0) {
    log.probe(1, 'Skipped same-process dependency geometries with missing endpoint spans', {
      skippedStartSpanCount,
      skippedEndSpanCount
    })();
  }
}

export function buildTraceCrossRankDependencyGeometries(params: {
  crossProcessDependencies: Readonly<TraceCrossProcessDependency[]>;
  maxTimeMs: number;
  minTimeMs: number;
  /** Renderable spans keyed by canonical runtime span ref. */
  spanByRef: ReadonlyMap<SpanRef, TraceSpanGeometrySource>;
  /** Ref-native layout lookup used for geometry construction. */
  layoutLookup: TraceGeometryLayoutLookup;
  dependencyGeometryMap: Record<TraceDependencyId, Float32Array>;
}): void {
  const geometryStartTime = performance.now();
  const {crossProcessDependencies, dependencyGeometryMap} = params;
  log.probe(1, `deck-trace-layers cross rank geometry start`)();
  let skippedStartSpanCount = 0;
  let skippedEndSpanCount = 0;

  for (const crossDep of crossProcessDependencies) {
    const result = buildTraceCrossRankDependencyGeometry({
      ...params,
      crossProcessDependency: crossDep
    });
    if (result.skippedEndpoint === 'start') {
      skippedStartSpanCount += 1;
      log.log('Cross-process dependency start span not found', crossDep.startSpanId)();
      continue;
    }
    if (result.skippedEndpoint === 'end') {
      skippedEndSpanCount += 1;
      log.log('Cross-process dependency end span not found', crossDep.endSpanId)();
      continue;
    }
    if (result.geometry) {
      dependencyGeometryMap[crossDep.dependencyId] = result.geometry;
    }
  }

  log.probe(1, 'deck-trace-layers cross rank geometries complete', {
    totalCrossProcessDependencyCount: crossProcessDependencies.length,
    builtCrossGeometryCount: Object.keys(dependencyGeometryMap).length,
    skippedStartSpanCount,
    skippedEndSpanCount,
    durationMs: performance.now() - geometryStartTime
  })();
}

/**
 * Builds one cross-process dependency geometry from already-resolved layout/span maps.
 */
export function buildTraceCrossRankDependencyGeometry(params: {
  /** Cross-process dependency to render. */
  crossProcessDependency: Readonly<TraceCrossProcessDependency>;
  /** Canonical timeline maximum time. */
  maxTimeMs: number;
  /** Canonical timeline minimum time. */
  minTimeMs: number;
  /** Geometry-time span payloads keyed by exact span ref. */
  spanByRef: ReadonlyMap<SpanRef, TraceSpanGeometrySource>;
  /** Ref-native layout lookup used for geometry construction. */
  layoutLookup: TraceGeometryLayoutLookup;
}): {geometry: Float32Array | null; skippedEndpoint: 'start' | 'end' | null} {
  const {crossProcessDependency, spanByRef, minTimeMs} = params;
  const resolvedMaxTimeMs =
    Number.isFinite(params.maxTimeMs) && params.maxTimeMs > 0
      ? params.maxTimeMs
      : Number.MAX_SAFE_INTEGER;
  const startSpan =
    crossProcessDependency.startSpanRef == null
      ? undefined
      : spanByRef.get(crossProcessDependency.startSpanRef);
  if (!startSpan) {
    return {geometry: null, skippedEndpoint: 'start'};
  }

  const endSpan =
    crossProcessDependency.endSpanRef == null
      ? undefined
      : spanByRef.get(crossProcessDependency.endSpanRef);
  if (!endSpan) {
    return {geometry: null, skippedEndpoint: 'end'};
  }

  return {
    geometry: getCrossRankDependencyPathFlat({
      startSpan,
      endSpan,
      layoutLookup: params.layoutLookup,
      maxTimeMs: resolvedMaxTimeMs,
      minTimeMs,
      waitMode: crossProcessDependency.waitMode,
      bidirectional: crossProcessDependency.bidirectional,
      isParentDependency:
        crossProcessDependency.keywords.has('PARENT') ||
        crossProcessDependency.topology === 'parent'
    }),
    skippedEndpoint: null
  };
}

const EMPTY_FLOAT_ARRAY = Object.freeze(new Float32Array(0));
export type SpanBoundingBox = Float32Array;

const EMPTY_BBOX: SpanBoundingBox = new Float32Array([0, 0, 0, 0]);

/**
 * Resolves the thread layout that owns a geometry span in the current TraceGraph ref namespace.
 */
function getThreadLayoutForGeometrySpan(
  span: TraceSpanGeometrySource,
  layoutLookup: TraceGeometryLayoutLookup
): ThreadLayout | undefined {
  if (span.threadRef != null) {
    const refLayout = layoutLookup.threadLayoutsByRef.get(span.threadRef);
    if (refLayout) {
      return refLayout;
    }
  }
  const threadRef = getSpanOwnerThreadRef(layoutLookup.traceGraph, span.spanRef);
  if (threadRef != null) {
    const refLayout = layoutLookup.threadLayoutsByRef.get(threadRef);
    if (refLayout) {
      return refLayout;
    }
  }
  return undefined;
}

/**
 * Resolves the process layout that owns a geometry span in the current TraceGraph ref namespace.
 */
function getProcessLayoutForGeometrySpan(
  span: TraceSpanGeometrySource,
  layoutLookup: TraceGeometryLayoutLookup
): ProcessLayout | undefined {
  if (span.processRef != null) {
    const refLayout = layoutLookup.processLayoutsByRef.get(span.processRef);
    if (refLayout) {
      return refLayout;
    }
  }
  const processRef = layoutLookup.traceGraph.getProcessRefBySpanRef(span.spanRef);
  if (processRef != null) {
    const refLayout = layoutLookup.processLayoutsByRef.get(processRef);
    if (refLayout) {
      return refLayout;
    }
  }
  return undefined;
}

/** Resolves both owner layouts for one geometry span with one span-row owner lookup. */
function getSpanOwnerLayoutsForGeometrySpan(
  span: TraceSpanGeometrySource,
  layoutLookup: TraceGeometryLayoutLookup
): TraceSpanGeometryOwnerLayouts {
  const threadLayout =
    span.threadRef == null ? undefined : layoutLookup.threadLayoutsByRef.get(span.threadRef);
  const processLayout =
    span.processRef == null ? undefined : layoutLookup.processLayoutsByRef.get(span.processRef);
  if (threadLayout || processLayout) {
    return {threadLayout, processLayout};
  }

  const getSpanOwnerRefs = layoutLookup.traceGraph.getSpanOwnerRefs;
  if (!getSpanOwnerRefs) {
    return {
      threadLayout: getThreadLayoutForGeometrySpan(span, layoutLookup),
      processLayout: getProcessLayoutForGeometrySpan(span, layoutLookup)
    };
  }
  const ownerRefs = getSpanOwnerRefs.call(layoutLookup.traceGraph, span.spanRef);
  return {
    threadLayout:
      ownerRefs?.threadRef == null
        ? undefined
        : layoutLookup.threadLayoutsByRef.get(ownerRefs.threadRef),
    processLayout:
      ownerRefs?.processRef == null
        ? undefined
        : layoutLookup.processLayoutsByRef.get(ownerRefs.processRef)
  };
}

/** Resolves one span's exact owning thread ref from the current graph namespace. */
function getSpanOwnerThreadRef(
  traceGraph: Pick<TraceGraph, 'getThreadRefBySpanRef'>,
  spanRef: SpanRef
): ThreadRef | null {
  return traceGraph.getThreadRefBySpanRef(spanRef);
}

/**
 * Writes one currently visible span rectangle directly into caller-owned scalar geometry.
 *
 * This is the allocation-free render path for span geometry. It resolves owner layouts once,
 * applies the same process/thread/lane/manual visibility gates as
 * {@link getTraceLayoutSpanVisibilityForSpan}, and writes only visible rectangles. Hidden or
 * malformed spans clear the target and return false.
 *
 * @param span Geometry span whose current rectangle should be written.
 * @param layoutLookup Ref-native lane and owner-layout lookup for the current layout.
 * @param maxTimeMs Timeline maximum used for unfinished timing extents.
 * @param minTimeMs Timeline origin subtracted from rendered X coordinates.
 * @param target Caller-owned scalar geometry tuple to mutate.
 * @param spanHeight Rendered generated-lane span height.
 * @returns Whether the target contains one visible span rectangle.
 */
export function fillVisibleSpanBoundingBox(
  span: TraceSpanGeometrySource,
  layoutLookup: TraceGeometryLayoutLookup,
  maxTimeMs: number,
  minTimeMs: number,
  target: TraceLayoutGeometryTuple,
  spanHeight = 0.3
): boolean {
  const {threadLayout: streamLayout, processLayout} = getSpanOwnerLayoutsForGeometrySpan(
    span,
    layoutLookup
  );
  if (!streamLayout?.visible || processLayout?.isCollapsed) {
    return clearTraceLayoutGeometryTuple(target);
  }

  if (streamLayout.manualContentHeight != null) {
    if (!hasValidManualSpanLayoutGeometry(span)) {
      return clearTraceLayoutGeometryTuple(target);
    }
    const timing = getSpanExtremalTiming(span, maxTimeMs);
    const xs = timing.startTimeMs - minTimeMs;
    const xe = timing.endTimeMs - minTimeMs;
    const ys = streamLayout.yPosition + span.layoutTopY;
    return writeTraceLayoutGeometryTuple(target, xs, ys, xe, ys + span.layoutHeight);
  }

  const laneIndex = getSpanLaneIndex(span, streamLayout, layoutLookup);
  if (laneIndex < 0 || !isTraceLayoutSpanLaneVisible(streamLayout, laneIndex)) {
    return clearTraceLayoutGeometryTuple(target);
  }
  const timing = getSpanExtremalTiming(span, maxTimeMs);
  const xs = timing.startTimeMs - minTimeMs;
  const xe = timing.endTimeMs - minTimeMs;
  const yPosition = getLaneYPosition(streamLayout, laneIndex);
  return writeTraceLayoutGeometryTuple(
    target,
    xs,
    yPosition - spanHeight / 2,
    xe,
    yPosition + spanHeight / 2
  );
}

/**
 * Writes one visible generated-primary span rectangle from caller-bound scalar fields.
 *
 * This is the columnar companion to {@link fillVisibleSpanBoundingBox}: callers that already own
 * Arrow-bound owner refs, a generated lane index, and resolved primary timing fields can skip
 * materializing a geometry span object. Manual rows are intentionally unsupported and clear the
 * target so callers retain the full source fallback for authored geometry.
 *
 * @param processRef Canonical process ref already resolved from the bound span row.
 * @param threadRef Canonical thread ref already resolved from the bound span row.
 * @param laneIndex Generated lane index already resolved from layout-owned lane columns.
 * @param startTimeMs Resolved finite primary timing start.
 * @param endTimeMs Resolved finite primary timing end.
 * @param layoutLookup Ref-native owner-layout lookup for the current layout.
 * @param minTimeMs Timeline origin subtracted from rendered X coordinates.
 * @param target Caller-owned scalar geometry tuple to mutate.
 * @param spanHeight Rendered generated-lane span height.
 * @returns Whether the target contains one visible generated span rectangle.
 */
export function fillGeneratedPrimarySpanBoundingBoxFromFields(
  processRef: ProcessRef,
  threadRef: ThreadRef,
  laneIndex: number,
  startTimeMs: number,
  endTimeMs: number,
  layoutLookup: Pick<TraceGeometryLayoutLookup, 'threadLayoutsByRef' | 'processLayoutsByRef'>,
  minTimeMs: number,
  target: TraceLayoutGeometryTuple,
  spanHeight = 0.3
): boolean {
  const streamLayout = layoutLookup.threadLayoutsByRef.get(threadRef);
  const processLayout = layoutLookup.processLayoutsByRef.get(processRef);
  if (
    !streamLayout?.visible ||
    processLayout?.isCollapsed ||
    streamLayout.manualContentHeight != null ||
    laneIndex < 0 ||
    !isTraceLayoutSpanLaneVisible(streamLayout, laneIndex)
  ) {
    return clearTraceLayoutGeometryTuple(target);
  }
  const yPosition = getLaneYPosition(streamLayout, laneIndex);
  return writeTraceLayoutGeometryTuple(
    target,
    startTimeMs - minTimeMs,
    yPosition - spanHeight / 2,
    endTimeMs - minTimeMs,
    yPosition + spanHeight / 2
  );
}

export function getSpanBoundingBox(
  span: TraceSpanGeometrySource,
  layoutLookup: TraceGeometryLayoutLookup,
  maxTimeMs: number,
  minTimeMs: number,
  spanHeight = 0.3
): SpanBoundingBox {
  const {threadLayout: streamLayout, processLayout} = getSpanOwnerLayoutsForGeometrySpan(
    span,
    layoutLookup
  );
  if (!streamLayout) {
    log.log(1, 'Stream layout not found for span', span.spanRef)();
    return EMPTY_BBOX;
  }
  const manualSpanLayout = getManualSpanLayoutGeometry(span);
  const isManualThreadLayout = streamLayout.manualContentHeight != null;
  if (isManualThreadLayout) {
    if (!manualSpanLayout) {
      return EMPTY_BBOX;
    }
    const timing = getSpanExtremalTiming(span, maxTimeMs);
    const xs = timing.startTimeMs - minTimeMs;
    const xe = timing.endTimeMs - minTimeMs;
    if (!processLayout?.isCollapsed && streamLayout.visible) {
      const ys = streamLayout.yPosition + manualSpanLayout.topY;
      return buildSpanBoundingBox(xs, ys, xe, ys + manualSpanLayout.height);
    }

    const hiddenYPosition = getHiddenSpanYPosition({
      laneIndex: 0,
      processLayout,
      streamLayout
    });
    return hiddenYPosition === undefined
      ? EMPTY_BBOX
      : buildSpanBoundingBox(xs, hiddenYPosition, xe, hiddenYPosition);
  }

  const laneIndex = getSpanLaneIndex(span, streamLayout, layoutLookup);
  const timing = getSpanExtremalTiming(span, maxTimeMs);
  const xs = timing.startTimeMs - minTimeMs;
  const resolvedEndTimeMs = timing.endTimeMs;
  const xe = resolvedEndTimeMs - minTimeMs;
  if (
    !processLayout?.isCollapsed &&
    streamLayout.visible &&
    laneIndex >= 0 &&
    isLaneVisible(streamLayout, laneIndex)
  ) {
    const yPosition = getLaneYPosition(streamLayout, laneIndex);
    return buildSpanBoundingBox(xs, yPosition - spanHeight / 2, xe, yPosition + spanHeight / 2);
  }

  const hiddenYPosition = getHiddenSpanYPosition({
    laneIndex: Math.max(0, laneIndex),
    processLayout,
    streamLayout
  });
  if (hiddenYPosition === undefined) {
    return EMPTY_BBOX;
  }

  return buildSpanBoundingBox(xs, hiddenYPosition, xe, hiddenYPosition);
}

/** Clears one caller-owned scalar geometry tuple for a hidden or malformed span. */
function clearTraceLayoutGeometryTuple(target: TraceLayoutGeometryTuple): false {
  target.x1 = 0;
  target.y1 = 0;
  target.x2 = 0;
  target.y2 = 0;
  return false;
}

/** Writes one visible rectangle into caller-owned scalar geometry without allocating an array. */
function writeTraceLayoutGeometryTuple(
  target: TraceLayoutGeometryTuple,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): true {
  // Preserve the historical Float32Array bounding-box boundary before callers derive width/height.
  target.x1 = Math.fround(x1);
  target.y1 = Math.fround(y1);
  target.x2 = Math.fround(x2);
  target.y2 = Math.fround(y2);
  return true;
}

/**
 * Returns exact render visibility for one generated span lane.
 *
 * Unlike the broader {@link isLaneVisible} geometry helper, this retains the visibility-mask
 * contract that collapsed non-stack-all threads hide every non-top lane even when a focused lane
 * list also contains that lane.
 */
function isTraceLayoutSpanLaneVisible(streamLayout: ThreadLayout, laneIndex: number): boolean {
  const lanes = streamLayout.lanes;
  if (!lanes) {
    return true;
  }
  const visibleLaneIndices = lanes.visibleLaneIndices;
  if (
    visibleLaneIndices &&
    (visibleLaneIndices.length === 0 || !visibleLaneIndices.includes(laneIndex))
  ) {
    return false;
  }
  if (
    !visibleLaneIndices &&
    lanes.renderedLaneCount != null &&
    Number.isFinite(lanes.renderedLaneCount) &&
    laneIndex >= lanes.renderedLaneCount
  ) {
    return false;
  }
  return !lanes.isCollapsed || lanes.collapseMode === 'stack-all' || laneIndex === 0;
}

/** Builds one mutable Float32 bounding box used by deck layer accessors. */
function buildSpanBoundingBox(xs: number, ys: number, xe: number, ye: number): SpanBoundingBox {
  const boundingBox = new Float32Array(4);
  boundingBox[0] = xs;
  boundingBox[1] = ys;
  boundingBox[2] = xe;
  boundingBox[3] = ye;
  return boundingBox;
}

/** Resolves the deterministic zero-height y anchor for one layout-hidden span. */
function getHiddenSpanYPosition(params: {
  laneIndex: number;
  processLayout?: ProcessLayout;
  streamLayout: ThreadLayout;
}): number | undefined {
  const {laneIndex, processLayout, streamLayout} = params;
  if (processLayout?.isCollapsed && Number.isFinite(processLayout.collapsedActivityY)) {
    return processLayout.collapsedActivityY;
  }

  const streamAnchor = getHiddenLaneYPosition(streamLayout, laneIndex);
  if (streamAnchor !== undefined) {
    return streamAnchor;
  }

  if (Number.isFinite(processLayout?.collapsedActivityY)) {
    return processLayout!.collapsedActivityY;
  }
  if (Number.isFinite(processLayout?.yOffset)) {
    return processLayout!.yOffset;
  }
  return undefined;
}

/** Clamps a hidden lane index to the nearest rendered lane anchor in the same thread row. */
function getHiddenLaneYPosition(streamLayout: ThreadLayout, laneIndex: number): number | undefined {
  if (!streamLayout.lanes || streamLayout.lanes.laneYPositions.length === 0) {
    return Number.isFinite(streamLayout.yPosition) ? streamLayout.yPosition : undefined;
  }

  if (streamLayout.lanes.isCollapsed) {
    return getLaneYPosition(streamLayout, 0);
  }

  const visibleLaneIndices = streamLayout.lanes.visibleLaneIndices;
  if (visibleLaneIndices && visibleLaneIndices.length > 0) {
    const nearestLaneIndex = visibleLaneIndices.reduce((nearest, candidate) =>
      Math.abs(candidate - laneIndex) < Math.abs(nearest - laneIndex) ? candidate : nearest
    );
    return getLaneYPosition(streamLayout, nearestLaneIndex);
  }

  const renderedLaneCount = Math.max(1, streamLayout.lanes.renderedLaneCount ?? 1);
  return getLaneYPosition(streamLayout, Math.min(laneIndex, renderedLaneCount - 1));
}

/** Returns layout-specific visibility for one span geometry source. */
export function getTraceLayoutSpanVisibilityForSpan(params: {
  /** Geometry span whose current layout visibility should be resolved. */
  span: TraceSpanGeometrySource;
  /** Ref-native layout lookup used for visibility resolution. */
  layoutLookup: TraceGeometryLayoutLookup;
}): TraceLayoutSpanVisibility {
  const {threadLayout: streamLayout, processLayout} = getSpanOwnerLayoutsForGeometrySpan(
    params.span,
    params.layoutLookup
  );
  const flags: TraceLayoutSpanVisibilityFlag[] = [];
  if (processLayout?.isCollapsed) {
    flags.push(traceLayoutSpanVisibilityFlags.processCollapsed);
  }
  if (!streamLayout?.visible) {
    flags.push(traceLayoutSpanVisibilityFlags.threadHidden);
  }

  if (streamLayout?.manualContentHeight != null) {
    if (!getManualSpanLayoutGeometry(params.span)) {
      flags.push(traceLayoutSpanVisibilityFlags.laneHidden);
    }
    const visibilityFlags = getTraceLayoutSpanVisibilityMask(flags);
    return {
      visible: isTraceLayoutSpanVisible(visibilityFlags),
      visibilityFlags
    };
  }

  const laneIndex = getSpanLaneIndex(params.span, streamLayout, params.layoutLookup);
  if (laneIndex < 0) {
    flags.push(traceLayoutSpanVisibilityFlags.laneHidden);
  } else if (streamLayout?.lanes) {
    const visibleLaneIndices = streamLayout.lanes.visibleLaneIndices;
    if (
      visibleLaneIndices &&
      (visibleLaneIndices.length === 0 || !visibleLaneIndices.includes(laneIndex))
    ) {
      flags.push(traceLayoutSpanVisibilityFlags.laneHidden);
    }
    if (
      !visibleLaneIndices &&
      streamLayout.lanes.renderedLaneCount != null &&
      Number.isFinite(streamLayout.lanes.renderedLaneCount) &&
      laneIndex >= streamLayout.lanes.renderedLaneCount
    ) {
      flags.push(traceLayoutSpanVisibilityFlags.laneOverflow);
    }
    if (
      streamLayout.lanes.isCollapsed &&
      streamLayout.lanes.collapseMode !== 'stack-all' &&
      laneIndex !== 0
    ) {
      flags.push(traceLayoutSpanVisibilityFlags.threadCollapsed);
    }
  }

  const visibilityFlags = getTraceLayoutSpanVisibilityMask(flags);
  return {
    visible: isTraceLayoutSpanVisible(visibilityFlags),
    visibilityFlags
  };
}

/** Returns the rendered lane index for one geometry span within its thread layout. */
function getSpanLaneIndex(
  span: TraceSpanGeometrySource,
  streamLayout: ThreadLayout | undefined,
  layoutLookup: TraceGeometryLayoutLookup
): number {
  if (!streamLayout) {
    return INVALID_LANE_INDEX;
  }

  if (span.spanRef != null && layoutLookup.spanLaneColumnsByChunkIndex) {
    return (
      getTraceLayoutSpanLaneIndexFromColumns(
        layoutLookup.spanLaneColumnsByChunkIndex,
        span.spanRef
      ) ?? INVALID_LANE_INDEX
    );
  }

  if (streamLayout.lanes?.laneYPositions.length) {
    return 0;
  }

  if (Number.isFinite(streamLayout.yPosition)) {
    return 0;
  }

  return INVALID_LANE_INDEX;
}

export function getLaneIndexFromUserData(userData?: LaneUserData): number {
  const laneValue = userData?.lane;
  if (typeof laneValue === 'number' && Number.isFinite(laneValue) && laneValue >= 0) {
    return Math.floor(laneValue);
  }
  return 0;
}

export function getStreamLaneYPositions(streamLayout?: ThreadLayout): number[] {
  if (!streamLayout?.visible) {
    return [];
  }

  if (streamLayout.lanes?.laneYPositions.length) {
    if (streamLayout.lanes.visibleLaneIndices) {
      return streamLayout.lanes.laneYPositions.slice(
        0,
        streamLayout.lanes.visibleLaneIndices.length
      );
    }
    return streamLayout.lanes.laneYPositions;
  }

  if (Number.isFinite(streamLayout.yPosition)) {
    return [streamLayout.yPosition];
  }

  return [];
}

export function getLaneYPosition(streamLayout: ThreadLayout, laneIndex: number): number {
  if (!streamLayout.lanes || streamLayout.lanes.laneYPositions.length === 0) {
    return streamLayout.yPosition;
  }

  if (streamLayout.lanes.isCollapsed) {
    return streamLayout.lanes.laneYPositions[0] ?? streamLayout.yPosition;
  }

  if (streamLayout.lanes.visibleLaneIndices) {
    const compactLaneIndex = streamLayout.lanes.visibleLaneIndices.indexOf(laneIndex);
    return (
      streamLayout.lanes.laneYPositions[compactLaneIndex] ??
      streamLayout.lanes.laneYPositions[0] ??
      streamLayout.yPosition
    );
  }

  return (
    streamLayout.lanes.laneYPositions[laneIndex] ??
    streamLayout.lanes.laneYPositions[0] ??
    streamLayout.yPosition
  );
}

export function isLaneVisible(streamLayout: ThreadLayout, laneIndex: number): boolean {
  if (!streamLayout.lanes) {
    return true;
  }

  if (
    streamLayout.lanes.visibleLaneIndices &&
    (streamLayout.lanes.visibleLaneIndices.length === 0 ||
      !streamLayout.lanes.visibleLaneIndices.includes(laneIndex))
  ) {
    return false;
  }

  if (streamLayout.lanes.visibleLaneIndices) {
    return true;
  }

  if (
    streamLayout.lanes.renderedLaneCount != null &&
    Number.isFinite(streamLayout.lanes.renderedLaneCount) &&
    laneIndex >= streamLayout.lanes.renderedLaneCount
  ) {
    return false;
  }

  if (!streamLayout.lanes.isCollapsed) {
    return true;
  }

  if (streamLayout.lanes.collapseMode === 'stack-all') {
    return true;
  }

  return laneIndex === 0;
}

function getStartAndEndTimeMs(
  startSpan: TraceSpanGeometrySource,
  endSpan: TraceSpanGeometrySource,
  waitMode: 'end-to-start' | 'end-to-end' | 'start-to-start',
  maxTimeMs = Number.MAX_SAFE_INTEGER
): {startTimeMs: number; endTimeMs: number} {
  const startTiming = getSpanExtremalTiming(startSpan, maxTimeMs);
  const endTiming = getSpanExtremalTiming(endSpan, maxTimeMs);
  switch (waitMode) {
    case 'end-to-start':
      return {startTimeMs: startTiming.endTimeMs, endTimeMs: endTiming.startTimeMs};
    case 'end-to-end':
      return {startTimeMs: startTiming.endTimeMs, endTimeMs: endTiming.endTimeMs};
    case 'start-to-start':
      return {startTimeMs: startTiming.startTimeMs, endTimeMs: endTiming.startTimeMs};
    default:
      return {startTimeMs: 0, endTimeMs: 0};
  }
}

export function getSameProcessDependencyPathFlat(params: {
  /** Rendered dependency start span. */
  startSpan: TraceSpanGeometrySource;
  /** Rendered dependency end span. */
  endSpan: TraceSpanGeometrySource;
  /** Ref-native layout lookup used for path construction. */
  layoutLookup: TraceGeometryLayoutLookup;
  waitMode: 'end-to-start' | 'end-to-end' | 'start-to-start';
  bidirectional: boolean;
  /** Whether this dependency represents a parent-to-child span relationship. */
  isParentDependency?: boolean;
  maxTimeMs: number;
  minTimeMs: number;
}): Float32Array {
  const path = new Float32Array(4);
  return fillSameProcessDependencyPathTarget(params, path) ? path : EMPTY_FLOAT_ARRAY;
}

/**
 * Copies one same-process dependency segment into caller-owned scalar storage.
 *
 * This is the allocation-free counterpart of {@link getSameProcessDependencyPathFlat} for
 * binary render builders that already own their output buffers.
 */
export function fillSameProcessDependencyPathFlat(
  params: Parameters<typeof getSameProcessDependencyPathFlat>[0],
  target: TraceLayoutGeometryTuple
): boolean {
  return fillSameProcessDependencyPathTarget(params, target);
}

/** Resolves one same-process dependency path into either packed or scalar caller-owned storage. */
function fillSameProcessDependencyPathTarget(
  params: Parameters<typeof getSameProcessDependencyPathFlat>[0],
  target: Float32Array | TraceLayoutGeometryTuple
): boolean {
  const {startSpan, endSpan, layoutLookup, waitMode, maxTimeMs, minTimeMs} = params;

  const startLayouts = getSpanOwnerLayoutsForGeometrySpan(startSpan, layoutLookup);
  const endLayouts = getSpanOwnerLayoutsForGeometrySpan(endSpan, layoutLookup);
  const startStreamLayout = startLayouts.threadLayout;
  const endStreamLayout = endLayouts.threadLayout;
  if (!startStreamLayout || !endStreamLayout) {
    clearTraceDependencyPathTarget(target);
    return false;
  }

  const startProcessLayout = startLayouts.processLayout;
  const endProcessLayout = endLayouts.processLayout;
  const startStreamCollapsed = Boolean(startProcessLayout?.isCollapsed);
  const endStreamCollapsed = Boolean(endProcessLayout?.isCollapsed);

  let startLaneIndex = getSpanLaneIndex(startSpan, startStreamLayout, layoutLookup);
  let endLaneIndex = getSpanLaneIndex(endSpan, endStreamLayout, layoutLookup);
  if (startLaneIndex < 0 && startStreamCollapsed) {
    startLaneIndex = 0;
  }
  if (endLaneIndex < 0 && endStreamCollapsed) {
    endLaneIndex = 0;
  }
  if (startLaneIndex < 0 || endLaneIndex < 0) {
    clearTraceDependencyPathTarget(target);
    return false;
  }

  const {startTimeMs, endTimeMs} =
    params.isParentDependency === true
      ? getParentDependencyStartAndEndTimeMs(startSpan, endSpan, maxTimeMs)
      : getStartAndEndTimeMs(startSpan, endSpan, waitMode, maxTimeMs);

  const xs = startTimeMs - minTimeMs;
  const xe = endTimeMs - minTimeMs;
  const ys = resolveCrossRankDependencyEndpointY({
    span: startSpan,
    streamLayout: startStreamLayout,
    processLayout: startProcessLayout,
    laneIndex: startLaneIndex,
    isCollapsedDependency: startStreamCollapsed
  });
  const ye = resolveCrossRankDependencyEndpointY({
    span: endSpan,
    streamLayout: endStreamLayout,
    processLayout: endProcessLayout,
    laneIndex: endLaneIndex,
    isCollapsedDependency: endStreamCollapsed
  });
  if (ys === undefined || ye === undefined) {
    clearTraceDependencyPathTarget(target);
    return false;
  }

  void params.bidirectional;
  writeTraceDependencyPathTarget(target, xs, ys, xe, ye);
  return true;
}

/** Resets a failed caller-owned dependency geometry target to the legacy zero tuple. */
function clearTraceDependencyPathTarget(target: Float32Array | TraceLayoutGeometryTuple): void {
  writeTraceDependencyPathTarget(target, 0, 0, 0, 0);
}

/** Writes and validates one dependency segment in caller-owned storage. */
function writeTraceDependencyPathTarget(
  target: Float32Array | TraceLayoutGeometryTuple,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  if (target instanceof Float32Array) {
    target[0] = x1;
    target[1] = y1;
    target[2] = x2;
    target[3] = y2;
    validateGeometry(target);
    return;
  }
  target.x1 = x1;
  target.y1 = y1;
  target.x2 = x2;
  target.y2 = y2;
  validateTraceLayoutGeometryTuple(target);
}

/** Rejects non-finite scalar dependency geometry before it reaches typed render buffers. */
function validateTraceLayoutGeometryTuple(target: TraceLayoutGeometryTuple): void {
  if (
    !Number.isFinite(target.x1) ||
    !Number.isFinite(target.y1) ||
    !Number.isFinite(target.x2) ||
    !Number.isFinite(target.y2)
  ) {
    throw new Error('Geometry contains invalid coordinates');
  }
}

function resolveCrossRankDependencyEndpointY(params: {
  /** Rendered dependency endpoint span, when materialized. */
  span?: TraceSpanGeometrySource;
  /** Thread layout owning the dependency endpoint. */
  streamLayout: ThreadLayout;
  processLayout?: ProcessLayout;
  laneIndex: number;
  isCollapsedDependency?: boolean;
  peerY?: number;
}): number | undefined {
  const streamLayout = params.streamLayout;
  if (streamLayout?.manualContentHeight != null) {
    const manualSpanLayout = params.span ? getManualSpanLayoutGeometry(params.span) : null;
    if (!manualSpanLayout) {
      return undefined;
    }
    if (streamLayout.visible) {
      return (
        streamLayout.yPosition + manualSpanLayout.topY + Math.max(0, manualSpanLayout.height) / 2
      );
    }
  }
  if (streamLayout?.visible) {
    const laneIndex =
      streamLayout.lanes?.laneYPositions.length && !streamLayout.lanes.visibleLaneIndices
        ? Math.min(params.laneIndex, streamLayout.lanes.laneYPositions.length - 1)
        : params.laneIndex;
    const fallbackLaneIndex = Math.max(0, laneIndex);
    return getLaneYPosition(streamLayout, fallbackLaneIndex);
  }

  if (!params.isCollapsedDependency) {
    return undefined;
  }

  const fallbackY = params.processLayout?.collapsedActivityY;
  if (typeof fallbackY === 'number' && Number.isFinite(fallbackY)) {
    if (typeof params.peerY === 'number') {
      if (params.peerY < fallbackY) {
        return fallbackY - COLLAPSED_ACTIVITY_OFFSET;
      } else if (params.peerY > fallbackY) {
        return fallbackY + COLLAPSED_ACTIVITY_OFFSET;
      }
    }
    return fallbackY;
  }
  return undefined;
}

function getCrossRankDependencyPathFlat(params: {
  /** Rendered dependency start span. */
  startSpan: TraceSpanGeometrySource;
  /** Rendered dependency end span. */
  endSpan: TraceSpanGeometrySource;
  /** Ref-native layout lookup used for path construction. */
  layoutLookup: TraceGeometryLayoutLookup;
  waitMode: 'end-to-start' | 'end-to-end' | 'start-to-start';
  bidirectional: boolean;
  /** Whether this dependency represents a parent-to-child span relationship. */
  isParentDependency?: boolean;
  maxTimeMs: number;
  minTimeMs: number;
}): Float32Array {
  const path = new Float32Array(4);
  return fillCrossProcessDependencyPathTarget(params, path) ? path : EMPTY_FLOAT_ARRAY;
}

/**
 * Copies one cross-process dependency segment into caller-owned scalar storage.
 *
 * This is the allocation-free counterpart of the compatibility cross-rank geometry helper. It
 * preserves parent timing, wait-mode timing, authored/manual endpoint placement, and the peer-Y
 * collapsed endpoint offset while letting binary render builders write directly into their own
 * typed output buffers.
 */
export function fillCrossProcessDependencyPathFlat(
  params: Parameters<typeof getCrossRankDependencyPathFlat>[0],
  target: TraceLayoutGeometryTuple
): boolean {
  return fillCrossProcessDependencyPathTarget(params, target);
}

/** Resolves one cross-process dependency path into packed or scalar caller-owned storage. */
function fillCrossProcessDependencyPathTarget(
  params: Parameters<typeof getCrossRankDependencyPathFlat>[0],
  target: Float32Array | TraceLayoutGeometryTuple
): boolean {
  const {startSpan, endSpan, layoutLookup, waitMode, maxTimeMs, minTimeMs} = params;

  const startLayouts = getSpanOwnerLayoutsForGeometrySpan(startSpan, layoutLookup);
  const endLayouts = getSpanOwnerLayoutsForGeometrySpan(endSpan, layoutLookup);
  const startStreamLayout = startLayouts.threadLayout;
  const endStreamLayout = endLayouts.threadLayout;
  if (!startStreamLayout || !endStreamLayout) {
    clearTraceDependencyPathTarget(target);
    return false;
  }

  const startProcessLayout = startLayouts.processLayout;
  const endProcessLayout = endLayouts.processLayout;
  const startStreamCollapsed = Boolean(startProcessLayout?.isCollapsed);
  const endStreamCollapsed = Boolean(endProcessLayout?.isCollapsed);

  let startLaneIndex = getSpanLaneIndex(startSpan, startStreamLayout, layoutLookup);
  let endLaneIndex = getSpanLaneIndex(endSpan, endStreamLayout, layoutLookup);
  if (startLaneIndex < 0 && startStreamCollapsed) {
    startLaneIndex = 0;
  }
  if (endLaneIndex < 0 && endStreamCollapsed) {
    endLaneIndex = 0;
  }

  if (startLaneIndex < 0 || endLaneIndex < 0) {
    clearTraceDependencyPathTarget(target);
    return false;
  }

  const startLaneY = resolveCrossRankDependencyEndpointY({
    span: startSpan,
    streamLayout: startStreamLayout,
    processLayout: startProcessLayout,
    laneIndex: startLaneIndex,
    isCollapsedDependency: startProcessLayout?.isCollapsed
  });
  const endLaneY = resolveCrossRankDependencyEndpointY({
    span: endSpan,
    streamLayout: endStreamLayout,
    processLayout: endProcessLayout,
    laneIndex: endLaneIndex,
    isCollapsedDependency: endProcessLayout?.isCollapsed
  });

  const ys = resolveCrossRankDependencyEndpointY({
    span: startSpan,
    streamLayout: startStreamLayout,
    processLayout: startProcessLayout,
    laneIndex: startLaneIndex,
    isCollapsedDependency: startProcessLayout?.isCollapsed,
    peerY: endLaneY
  });
  const ye = resolveCrossRankDependencyEndpointY({
    span: endSpan,
    streamLayout: endStreamLayout,
    processLayout: endProcessLayout,
    laneIndex: endLaneIndex,
    isCollapsedDependency: endProcessLayout?.isCollapsed,
    peerY: startLaneY
  });

  if (ys === undefined || ye === undefined) {
    clearTraceDependencyPathTarget(target);
    return false;
  }

  const {startTimeMs, endTimeMs} =
    params.isParentDependency === true
      ? getParentDependencyStartAndEndTimeMs(startSpan, endSpan, maxTimeMs)
      : getStartAndEndTimeMs(startSpan, endSpan, waitMode, maxTimeMs);
  const xs = startTimeMs - minTimeMs;
  const xe = endTimeMs - minTimeMs;
  void params.bidirectional;
  writeTraceDependencyPathTarget(target, xs, ys, xe, ye);
  return true;
}

/** Returns parent-child dependency endpoints from source start to child start. */
function getParentDependencyStartAndEndTimeMs(
  parentSpan: TraceSpanGeometrySource,
  childSpan: TraceSpanGeometrySource,
  maxTimeMs = Number.MAX_SAFE_INTEGER
): {
  /** Parent dependency start time. */
  startTimeMs: number;
  /** Parent dependency child-start time. */
  endTimeMs: number;
} {
  const parentTiming = getSpanExtremalTiming(parentSpan, maxTimeMs);
  const childTiming = getSpanExtremalTiming(childSpan, maxTimeMs);
  return {startTimeMs: parentTiming.startTimeMs, endTimeMs: childTiming.startTimeMs};
}

/**
 * Returns validated author-provided manual span geometry, or null when the span should be hidden.
 */
export function getManualSpanLayoutGeometry(
  span: Pick<TraceSpanGeometrySource, 'layoutTopY' | 'layoutHeight'>
): {readonly topY: number; readonly height: number} | null {
  if (!hasValidManualSpanLayoutGeometry(span)) {
    return null;
  }

  return {
    topY: span.layoutTopY,
    height: span.layoutHeight
  };
}

/**
 * Returns whether author-provided manual geometry is finite and renderable.
 *
 * The boolean form lets hot fused writers validate manual spans without allocating the public
 * geometry object returned by {@link getManualSpanLayoutGeometry}.
 */
function hasValidManualSpanLayoutGeometry(
  span: Pick<TraceSpanGeometrySource, 'layoutTopY' | 'layoutHeight'>
): span is Pick<TraceSpanGeometrySource, 'layoutTopY' | 'layoutHeight'> & {
  /** Valid finite thread-relative top edge. */
  readonly layoutTopY: number;
  /** Valid finite rendered manual height. */
  readonly layoutHeight: number;
} {
  return (
    typeof span.layoutTopY === 'number' &&
    Number.isFinite(span.layoutTopY) &&
    span.layoutTopY >= 0 &&
    typeof span.layoutHeight === 'number' &&
    Number.isFinite(span.layoutHeight) &&
    span.layoutHeight > 0
  );
}

function validateGeometry(pathOrPolygon: Float32Array): void {
  if (pathOrPolygon.length % 2 !== 0) {
    throw new Error('Geometry must have an even number of coordinates');
  }
  if (pathOrPolygon.length < 4) {
    throw new Error('Geometry must have at least 2 points');
  }
  const isValid = pathOrPolygon.every(value => !Number.isNaN(value) && Number.isFinite(value));
  if (!isValid) {
    throw new Error('Geometry contains invalid coordinates');
  }
}
