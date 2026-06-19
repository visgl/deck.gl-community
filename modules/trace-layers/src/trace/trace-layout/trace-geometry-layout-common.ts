import {getHeapUsageProbeFields, log} from '../log';
import {assert} from '../utils/assert';
import {compareNumericSortStrings} from '../utils/numeric-sort';
import {getSpanExtremalTiming, MAX_LANES_PER_STREAM, visitKahnLaneAssignments} from './lane-layout';
import {
  buildTraceLayoutOverflowLabels,
  getTraceLayoutSpanVisibilityMask,
  isTraceLayoutSpanVisible,
  traceLayoutSpanVisibilityFlags
} from './trace-layout';

import type {
  TraceCrossDependencySource,
  TraceLocalDependencySource,
  TraceSpanLaneSource
} from '../trace-graph-accessors';
import type {TraceGraph} from '../trace-graph/trace-graph';
import type {ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceDependencyId,
  TraceSpan,
  TraceSpanId,
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
  TraceLayoutSourceProcess,
  TraceLayoutSpanVisibility,
  TraceLayoutSpanVisibilityFlag
} from './trace-layout';

export type TraceLayoutMode = 'step1' | 'sequential' | 'interleaved';

const DEFAULT_MINIMAL_THREAD_HIDDEN_NAMES = [
  'h2d',
  'd2h',
  'cpu_work_queue',
  'pipe_next',
  'pipe_prev'
];

function buildRankIdToLayoutIndexMap<
  TraceGraphT extends {processes: Readonly<Pick<TraceLayoutSourceProcess, 'processId'>[]>}
>(params: {traceGraph: TraceGraphT; layout: TraceLayout}): Map<string, number> {
  const result = new Map<string, number>();

  params.layout.processLayouts.forEach((_, layoutIndex) => {
    const processId = params.traceGraph.processes[layoutIndex]?.processId;
    if (processId && !result.has(processId)) {
      result.set(processId, layoutIndex);
    }
  });

  return result;
}

export type TraceSpanGeometrySource = Pick<
  TraceSpan,
  | 'spanId'
  | 'threadId'
  | 'primaryTimingKey'
  | 'timings'
  | 'layoutTopY'
  | 'layoutHeight'
  | 'userData'
> & {
  /** Canonical visible span ref when this geometry source comes from ref-native layout inputs. */
  spanRef?: SpanRef;
  /** Canonical process ref for the owning process when available from ref-native layout inputs. */
  processRef?: ProcessRef;
  /** Canonical thread ref for the owning thread when available from ref-native layout inputs. */
  threadRef?: ThreadRef;
};

/**
 * Ref-native layout lookup used by geometry builders when stream ids are only process-local.
 */
export type TraceGeometryLayoutLookup = {
  /** TraceGraph that resolves a visible span ref to its owning process/thread refs. */
  readonly traceGraph: Pick<TraceGraph, 'getProcessRefBySpanRef' | 'getThreadRefBySpanRef'>;
  /** Thread layouts keyed by exact visible span ref. */
  readonly threadLayoutsBySpanRef: ReadonlyMap<SpanRef, ThreadLayout>;
  /** Process layouts keyed by exact visible span ref. */
  readonly processLayoutsBySpanRef: ReadonlyMap<SpanRef, ProcessLayout>;
  /** Thread layouts keyed by canonical thread ref for the current TraceGraph namespace. */
  readonly threadLayoutsByRef: ReadonlyMap<ThreadRef, ThreadLayout>;
  /** Process layouts keyed by canonical process ref for collapsed-process routing. */
  readonly processLayoutsByRef: ReadonlyMap<ProcessRef, ProcessLayout>;
  /** Compatibility thread layouts keyed by process-local stream id. */
  readonly fallbackThreadLayoutMap?: Readonly<Record<TraceThreadId, ThreadLayout>>;
  /** Compatibility process layouts keyed by process-local stream id. */
  readonly fallbackStreamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
};

/** Lightweight span payload used by Arrow-native layout calculations. */
export type TraceLayoutLaneBlockSource = Pick<
  TraceSpanLaneSource,
  | 'spanRef'
  | 'spanId'
  | 'threadId'
  | 'primaryTimingKey'
  | 'timings'
  | 'layoutTopY'
  | 'layoutHeight'
  | 'userData'
>;

/** Lightweight local dependency payload used by Arrow-native layout calculations. */
export type TraceLayoutLaneDependencySource = Pick<
  TraceLocalDependencySource,
  'dependencyId' | 'startSpanId' | 'endSpanId'
> & {
  /** Whether the dependency is an explicit parent-child edge. */
  readonly hasParentKeyword?: boolean;
};

type LayoutComputation<
  TraceGraphT extends {processes: Readonly<Pick<TraceLayoutSourceProcess, 'processId'>[]>}
> = {
  traceGraph: TraceGraphT;
  layout: TraceLayout;
  rankSpacings: number[];
};

/** Preserves one combine-thread lane assignment for a focused rank relayout. */
export type CombinedRankLaneAssignmentOverride = {
  /** Total lane count implied by the preserved source lane indices. */
  laneCount: number;
  /** Highest preserved source lane index for the combined rank. */
  maxLane: number;
  /** Original combined lane assignments keyed by canonical visible span refs. */
  spanLaneMap: ReadonlyMap<SpanRef, number>;
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
  /** block/span height */
  blockHeight: number;
  /** block label position, inside block or above it */
  spanLabelPosition: 'inside' | 'above';
  /** Block label font size */
  spanLabelFontSize: number;
  /** Top inset for collapsed process activity overviews within the process row. */
  overviewTopGap: number;
  /** Extra top inset before the first visible thread in each process row. */
  firstThreadTopGap: number;
  labelPadding: number;
  labelMinGap: number;
};

type LaneUserData = {lane?: number};
type LaneAssignmentModeUserData = {laneAssignmentMode?: string};

type TraceLayoutLaneSourceProcess = {
  /** Identifies the process whose threads are being laid out. */
  readonly processId: string;
  /** Canonical runtime process ref when the source graph is ref-native. */
  readonly processRef?: ProcessRef;
  /** Carries the source threads used to determine visible stream rows. */
  readonly threads: readonly TraceThread[];
  /** Canonical runtime thread refs aligned to `threads` when the source graph is ref-native. */
  readonly threadRefs?: readonly ThreadRef[];
  /** Carries process-level metadata used for lane-assignment settings. */
  readonly userData?: TraceLayoutSourceProcess['userData'];
  /** Optionally provides eager block payloads for calculators that already have them. */
  readonly spans?: readonly TraceSpan[];
  /** Optionally provides lightweight lane sources for Arrow-native calculators. */
  readonly laneBlocks?: readonly TraceLayoutLaneBlockSource[];
  /** Optionally provides eager local dependencies for calculators that already have them. */
  readonly localDependencies?: readonly TraceLocalDependencySource[];
  /** Optionally provides lightweight local dependency sources for Arrow-native calculators. */
  readonly laneLocalDependencies?: readonly TraceLayoutLaneDependencySource[];
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

export function countOverflowSpans(
  spanLaneMap: ReadonlyMap<SpanRef, number> | undefined,
  renderedLaneCount: number,
  hasOverflow: boolean
): number {
  if (!hasOverflow || !spanLaneMap || renderedLaneCount < 0) {
    return 0;
  }

  let overflowSpanCount = 0;
  for (const lane of spanLaneMap.values()) {
    if (Math.floor(lane) >= renderedLaneCount) {
      overflowSpanCount += 1;
    }
  }
  return overflowSpanCount;
}

function formatThreadOverflowMessage(params: {
  overflowSpanCount: number;
  filteredSpanCount?: number;
  includeFilteredSpanCount?: boolean;
  threadName?: string;
}): string | null {
  const {
    overflowSpanCount,
    filteredSpanCount = 0,
    includeFilteredSpanCount = false,
    threadName
  } = params;
  const hasOverflow = overflowSpanCount > 0;
  const hasFilteredLabel = includeFilteredSpanCount && filteredSpanCount > 0;
  if (!hasOverflow && !hasFilteredLabel) {
    return null;
  }

  const hiddenLabel = `${overflowSpanCount} deeper span${overflowSpanCount === 1 ? '' : 's'} hidden`;
  if (hasOverflow && !hasFilteredLabel) {
    return hiddenLabel;
  }

  const filteredLabel = `${filteredSpanCount} span${filteredSpanCount === 1 ? '' : 's'} filtered`;
  if (!hasOverflow) {
    return threadName
      ? `${filteredLabel} in thread ${threadName}`
      : `${filteredLabel} in this thread`;
  }

  return threadName
    ? `${hiddenLabel}, ${filteredLabel} in thread ${threadName}`
    : `${hiddenLabel}, ${filteredLabel} in this thread`;
}

export function buildThreadOverflowLabel(
  threadLayout: ThreadLayout,
  overflowSpanCount: number,
  options?: {
    filteredSpanCount?: number;
    includeFilteredSpanCount?: boolean;
    threadName?: string;
    /** Vertical gap between the last visible lane and the overflow/filter label row. */
    labelLaneSeparation?: number;
  }
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
  const filteredSpanCount = options?.filteredSpanCount ?? 0;
  const includeFilteredSpanCount = options?.includeFilteredSpanCount ?? false;
  const hasFilteredLabel = includeFilteredSpanCount && filteredSpanCount > 0;
  if (!hasOverflow && !hasFilteredLabel) {
    return undefined;
  }

  const lastVisibleLaneIndex = Math.max(
    0,
    Math.min(renderedLaneCount - 1, threadLayout.lanes.laneYPositions.length - 1)
  );
  const lastVisibleLaneY = getLaneYPosition(threadLayout, lastVisibleLaneIndex);
  const overflowY = hasOverflow
    ? getLaneYPosition(
        threadLayout,
        Math.min(Math.max(0, renderedLaneCount), threadLayout.lanes.laneYPositions.length - 1)
      )
    : lastVisibleLaneY + (options?.labelLaneSeparation ?? 0);
  if (!Number.isFinite(overflowY)) {
    return undefined;
  }

  const text = formatThreadOverflowMessage({
    overflowSpanCount,
    filteredSpanCount,
    includeFilteredSpanCount,
    threadName: options?.threadName
  });
  if (!text) {
    return undefined;
  }

  return {
    text,
    x: threadLayout.startPosition[0],
    y: overflowY,
    z: threadLayout.startPosition[2]
  };
}

function getOverflowLabelThreadName(thread: Pick<TraceThread, 'name' | 'threadId'>): string {
  return thread.name?.trim() || String(thread.threadId);
}

function getThreadOverflowLabelName(
  threads: readonly Pick<TraceThread, 'name' | 'threadId'>[]
): string {
  return threads.length === 1 ? getOverflowLabelThreadName(threads[0]!) : 'all threads';
}

/**
 * Returns whether a thread layout can produce a visible overflow label.
 */
function canBuildThreadOverflowLabel(
  threadLayout: ThreadLayout,
  filteredSpanCount: number,
  includeFilteredSpanCount: boolean
): boolean {
  if (!threadLayout.visible) {
    return false;
  }

  if (
    threadLayout.lanes == null ||
    threadLayout.lanes.isCollapsed ||
    threadLayout.lanes.laneYPositions.length === 0
  ) {
    return false;
  }

  const renderedLaneCount = threadLayout.lanes.renderedLaneCount ?? threadLayout.lanes.laneCount;
  return (
    renderedLaneCount < threadLayout.lanes.laneCount ||
    (includeFilteredSpanCount && filteredSpanCount > 0)
  );
}

export function buildThreadOverflowLabelForThreads(params: {
  threadLayout: ThreadLayout;
  overflowSpanCount: number;
  threads: readonly Pick<TraceThread, 'name' | 'threadId'>[];
  /** Canonical runtime thread refs aligned to `threads` when the source graph is ref-native. */
  threadRefs?: readonly ThreadRef[];
  traceGraph: TraceGraph;
  labelLaneSeparation: number;
}): ThreadOverflowLabel | undefined {
  const includeFilteredSpanCount = params.traceGraph.hasActiveSpanFilter();
  const legacyFilteredSpanCountByThreadId = (
    params.traceGraph as unknown as {
      getFilteredSpanCountByThreadId?: () => Readonly<Partial<Record<TraceThreadId, number>>>;
    }
  )?.getFilteredSpanCountByThreadId?.();
  const filteredSpanCount = includeFilteredSpanCount
    ? params.threadRefs != null && params.threadRefs.length > 0
      ? params.threadRefs.reduce(
          (count, threadRef) =>
            count + (params.traceGraph.getFilteredSpanCountByThreadRef().get(threadRef) ?? 0),
          0
        )
      : legacyFilteredSpanCountByThreadId != null
        ? params.threads.reduce(
            (count, thread) => count + (legacyFilteredSpanCountByThreadId[thread.threadId] ?? 0),
            0
          )
        : 0
    : undefined;
  if (
    !canBuildThreadOverflowLabel(
      params.threadLayout,
      filteredSpanCount ?? 0,
      includeFilteredSpanCount
    )
  ) {
    return undefined;
  }

  return buildThreadOverflowLabel(params.threadLayout, params.overflowSpanCount, {
    filteredSpanCount,
    includeFilteredSpanCount,
    threadName: getThreadOverflowLabelName(params.threads),
    labelLaneSeparation: params.labelLaneSeparation
  });
}

const LAYOUT_DENSITY_PRESETS = {
  comfortable: {
    processSeparation: 0.75,
    laneSeparation: 0.58,
    threadSeparation: 0.75,
    streamLabelFontSize: 12,
    blockHeight: 0.4,
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
    blockHeight: 0.22,
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
    blockHeight: 0.22,
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
    blockHeight: 0.32,
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
    blockHeight: 0.4,
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
  const {blockHeight, firstThreadTopGap, labelMinGap, labelPadding, overviewTopGap} =
    params.layoutConfiguration;
  const labelClearance = labelPadding + labelMinGap * 2;
  const spanTopClearance = overviewTopGap + blockHeight / 2 + labelMinGap * 2;
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
      (threadLayout.manualContentHeight != null || (threadLayout.spanLaneMap?.size ?? 0) > 0)
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

export function getLaneAssignmentMode(userData?: Record<string, unknown>): 'auto' | 'none' {
  return (userData as LaneAssignmentModeUserData | undefined)?.laneAssignmentMode === 'none'
    ? 'none'
    : 'auto';
}

export function computeRankBackgroundPolygon(params: {
  rankLayout: ProcessLayout;
  threadLayouts: ThreadLayout[];
  infiniteWidth?: boolean;
}): Float32Array {
  const {rankLayout, threadLayouts, infiniteWidth} = params;
  let lanePositionCount = 0;
  let maxY = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let visibleStreamCount = 0;
  const xExtents = {
    max: Number.NEGATIVE_INFINITY,
    min: Number.POSITIVE_INFINITY
  };

  for (const layout of threadLayouts) {
    if (!layout.visible) {
      continue;
    }
    visibleStreamCount += 1;
    const yExtents = getStreamLayoutYExtents(layout);
    lanePositionCount += yExtents.count;
    minY = Math.min(minY, yExtents.minY);
    maxY = Math.max(maxY, yExtents.maxY);

    const startX = layout.startPosition[0];
    const endX = layout.targetPosition[0];
    xExtents.min = Math.min(xExtents.min, startX ?? Infinity, endX ?? Infinity);
    xExtents.max = Math.max(xExtents.max, startX ?? -Infinity, endX ?? -Infinity);
  }

  if (visibleStreamCount === 0 || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return new Float32Array();
  }

  if (infiniteWidth) {
    xExtents.min = -INFINITE_HORIZONTAL_EXTENT;
    xExtents.max = INFINITE_HORIZONTAL_EXTENT;
  }

  if (!Number.isFinite(xExtents.min) || !Number.isFinite(xExtents.max)) {
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
    polygon[index++] = xExtents.min;
    polygon[index++] = centerY - adjustment;
    polygon[index++] = xExtents.max;
    polygon[index++] = centerY - adjustment;
    polygon[index++] = xExtents.max;
    polygon[index++] = centerY + adjustment;
    polygon[index++] = xExtents.min;
    polygon[index++] = centerY + adjustment;
    assert(index === polygon.length);
    return polygon;
  }

  const polygon = new Float32Array(8);
  let index = 0;
  polygon[index++] = xExtents.min;
  polygon[index++] = top;
  polygon[index++] = xExtents.max;
  polygon[index++] = top;
  polygon[index++] = xExtents.max;
  polygon[index++] = bottom;
  polygon[index++] = xExtents.min;
  polygon[index++] = bottom;
  assert(index === polygon.length);
  return polygon;
}

/** Builds the infinite-width row separator line at the top of the rank band. */
export function computeRankSeparatorLineInfinite(rankLayout: ProcessLayout): Float32Array {
  const separatorY = rankLayout.yOffset;
  if (!Number.isFinite(separatorY)) {
    return new Float32Array();
  }

  return new Float32Array([
    -INFINITE_HORIZONTAL_EXTENT,
    separatorY,
    INFINITE_HORIZONTAL_EXTENT,
    separatorY
  ]);
}

/** Builds the infinite-width row separator line at the bottom of the rank band. */
export function computeRankTerminalSeparatorLineInfinite(rankLayout: ProcessLayout): Float32Array {
  const separatorY = getRankBackgroundPolygonMaxY(rankLayout.backgroundPolygonInfinite);
  if (!Number.isFinite(separatorY)) {
    return new Float32Array();
  }

  return new Float32Array([
    -INFINITE_HORIZONTAL_EXTENT,
    separatorY,
    INFINITE_HORIZONTAL_EXTENT,
    separatorY
  ]);
}

function getRankBackgroundPolygonMaxY(polygon: Float32Array): number {
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 1; index < polygon.length; index += 2) {
    maxY = Math.max(maxY, polygon[index]!);
  }
  return maxY;
}

export function computeSequentialRankDeltas<
  TraceGraphT extends {processes: Readonly<Pick<TraceLayoutSourceProcess, 'processId'>[]>}
>(computations: LayoutComputation<TraceGraphT>[]): number[][] {
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
  TraceGraphT extends {processes: Readonly<Pick<TraceLayoutSourceProcess, 'processId'>[]>}
>(computations: LayoutComputation<TraceGraphT>[]): number[][] {
  if (computations.length <= 1) {
    return computeSequentialRankDeltas(computations);
  }

  const result = computations.map(computation =>
    new Array(computation.layout.processLayouts.length).fill(0)
  );
  const placedRanks = computations.map(() => new Set<number>());
  const rankIndexMaps = computations.map(computation =>
    buildRankIdToLayoutIndexMap({
      traceGraph: computation.traceGraph,
      layout: computation.layout
    })
  );
  const baseProcessIds = new Set(
    computations[0]?.traceGraph.processes.map(rank => rank.processId) ?? []
  );

  let cursor = 0;

  const baseComputation = computations[0]!;
  baseComputation.traceGraph.processes.forEach(rank => {
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
  TraceGraphT extends {processes: Readonly<Pick<TraceLayoutSourceProcess, 'processId'>[]>}
>(params: {
  computation: LayoutComputation<TraceGraphT>;
  preferredIndex: number;
  placedRanks: ReadonlySet<number>;
  baseProcessIds: ReadonlySet<string>;
}): number | undefined {
  if (params.placedRanks.has(params.preferredIndex)) {
    return undefined;
  }
  const rank = params.computation.traceGraph.processes[params.preferredIndex];
  if (!rank || params.baseProcessIds.has(rank.processId)) {
    return undefined;
  }
  return params.preferredIndex;
}

export function applyRankDeltas<
  TraceGraphT extends {
    processes: Readonly<Pick<TraceLayoutSourceProcess, 'processId' | 'threads'>[]>;
  }
>(params: {
  layout: TraceLayout;
  traceGraph: TraceGraphT;
  rankDeltas: number[];
  trackAggregationMode: TrackAggregationMode;
  /** Minimum y-offset allowed for the first visible rank after additive translation. */
  minimumVisibleRankYOffset?: number;
}): TraceLayout {
  const threadLayoutMap: Record<TraceThreadId, ThreadLayout> = {};
  const threadIdByLayout = new Map<ThreadLayout, TraceThreadId>();
  for (const [threadId, streamLayout] of Object.entries(params.layout.threadLayoutMap) as [
    TraceThreadId,
    ThreadLayout
  ][]) {
    threadLayoutMap[threadId] = streamLayout;
    threadIdByLayout.set(streamLayout, threadId);
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
      startPosition: [
        threadLayout.startPosition[0],
        threadLayout.startPosition[1] + delta,
        threadLayout.startPosition[2]
      ] as [number, number, number],
      targetPosition: [
        threadLayout.targetPosition[0],
        threadLayout.targetPosition[1] + delta,
        threadLayout.targetPosition[2]
      ] as [number, number, number],
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
      startPosition: [
        rankLayout.startPosition[0],
        rankLayout.startPosition[1] + delta,
        rankLayout.startPosition[2]
      ],
      threadLayouts: [...translatedThreadLayouts]
    } satisfies ProcessLayout;

    updatedProcessLayout.collapsedActivityY = getProcessCollapsedActivityY({
      yOffset: updatedProcessLayout.yOffset,
      yHeight: updatedProcessLayout.yHeight
    });

    const translatedProcessLayout = {
      ...updatedProcessLayout,
      backgroundPolygon: computeRankBackgroundPolygon({
        rankLayout: updatedProcessLayout,
        threadLayouts: updatedProcessLayout.threadLayouts
      }),
      backgroundPolygonInfinite: computeRankBackgroundPolygon({
        rankLayout: updatedProcessLayout,
        threadLayouts: updatedProcessLayout.threadLayouts,
        infiniteWidth: true
      })
    } satisfies ProcessLayout;
    translatedProcessLayout.separatorLineInfinite =
      computeRankSeparatorLineInfinite(translatedProcessLayout);
    translatedProcessLayout.terminalSeparatorLineInfinite =
      computeRankTerminalSeparatorLineInfinite(translatedProcessLayout);
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

  const processByRankId = new Map(
    params.traceGraph.processes.map(process => [process.processId, process] as const)
  );

  const processLayouts = params.layout.processLayouts.map((rankLayout, rankIndex) => {
    const delta = params.rankDeltas[rankIndex] ?? 0;
    const processLayout = params.layout.processLayouts[rankIndex];
    const isCombinedMode = params.trackAggregationMode === 'combine-threads';

    if (delta !== 0) {
      const processId = params.traceGraph.processes[rankIndex]?.processId;
      const rankProcess = processId ? processByRankId.get(processId) : undefined;
      if (rankProcess) {
        for (const stream of rankProcess.threads) {
          const streamLayout = threadLayoutMap[stream.threadId];
          if (!streamLayout) {
            continue;
          }
          threadLayoutMap[stream.threadId] = translateSharedThreadLayout(streamLayout, delta);
        }
      }
    }

    const threadLayouts = (processLayout?.threadLayouts ?? [])
      .map(streamLayout => {
        const threadId = threadIdByLayout.get(streamLayout);
        if (threadId) {
          const translatedStreamLayout = threadLayoutMap[threadId];
          return translatedStreamLayout;
        }
        return translateSharedThreadLayout(streamLayout, delta);
      })
      .filter((layout): layout is ThreadLayout => Boolean(layout));

    return translateProcessLayout(
      rankLayout,
      isCombinedMode ? threadLayouts.slice(0, 1) : threadLayouts,
      delta
    );
  });

  const normalizationDelta = getMinimumVisibleRankDelta(
    processLayouts,
    params.minimumVisibleRankYOffset ?? 0
  );
  if (normalizationDelta > 0) {
    for (const [threadId, streamLayout] of Object.entries(threadLayoutMap) as [
      TraceThreadId,
      ThreadLayout
    ][]) {
      threadLayoutMap[threadId] = translateSharedThreadLayout(streamLayout, normalizationDelta);
    }

    processLayouts.forEach((rankLayout, rankIndex) => {
      processLayouts[rankIndex] = translateProcessLayout(
        rankLayout,
        rankLayout.threadLayouts.map(threadLayout =>
          translateSharedThreadLayout(threadLayout, normalizationDelta)
        ),
        normalizationDelta
      );
    });
  }

  return {
    ...params.layout,
    processLayouts,
    threadLayoutMap: {...threadLayoutMap},
    overflowLabels: buildTraceLayoutOverflowLabels(processLayouts)
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
  spans: readonly TraceLayoutLaneBlockSource[];
  localDependencies: readonly TraceLayoutLaneDependencySource[];
  visibleThreadIds: Set<TraceThreadId>;
  maxTimeMs: number;
  maxVisibleLanesPerThread?: number;
  maxVisibleLanesUnlimited?: boolean;
}): {
  laneCount: number;
  maxLane: number;
  spanLaneMap: ReadonlyMap<SpanRef, number>;
  overflowSpanCount: number;
} {
  const {spans, localDependencies, visibleThreadIds, maxTimeMs} = params;

  const visibleBlocks = spans.filter(block => visibleThreadIds.has(block.threadId));
  if (visibleBlocks.length === 0) {
    return {
      laneCount: 0,
      maxLane: -1,
      spanLaneMap: new Map(),
      overflowSpanCount: 0
    };
  }

  const explicitParentByChild = buildExplicitParentSpanMap({
    spans: visibleBlocks,
    localDependencies,
    maxTimeMs
  });
  const hasCombinedParentHints = explicitParentByChild.size > 0;
  const hasCombinedLaneAffinity = hasTraceLaneAffinity(visibleBlocks);

  const spanLaneMap = new Map<SpanRef, number>();
  const maxLane = visitKahnLaneAssignments<TraceLayoutLaneBlockSource>(
    visibleBlocks,
    {
      ...(hasCombinedParentHints
        ? {
            getParentSpanId: (block: TraceLayoutLaneBlockSource) =>
              explicitParentByChild.get(block.spanId)
          }
        : {}),
      ...(hasCombinedLaneAffinity ? {getLaneAffinityKey: getTraceLaneAffinityKey} : {}),
      maxTimeMs
    },
    (block, lane) => {
      spanLaneMap.set(block.spanRef, lane);
    }
  );
  const laneCount = Math.max(maxLane + 1, 0);
  const normalizedLaneCount = normalizeLaneCounts(
    laneCount,
    params.maxVisibleLanesPerThread,
    params.maxVisibleLanesUnlimited
  );
  const overflowSpanCount = countOverflowSpans(
    spanLaneMap,
    normalizedLaneCount.renderedLaneCount,
    normalizedLaneCount.hasOverflow
  );

  return {
    laneCount,
    maxLane,
    spanLaneMap,
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
  streamLaneLayoutMap?: Readonly<Record<TraceThreadId, ThreadLaneMetadata>>;
  expandedStreamIds?: ReadonlySet<TraceThreadId>;
  collapsedStreamIds?: ReadonlySet<TraceThreadId>;
  /** Whether streams without explicit lane metadata should be hidden from this layout. */
  hideStreamsWithoutLaneMetadata?: boolean;
  /** Optional preserved combined lane assignments keyed by rank id. */
  combinedLaneAssignmentsByRankId?: Readonly<Record<string, CombinedRankLaneAssignmentOverride>>;
  traceGraph: TraceGraph;
  /** Resolves visible spans for one process without requiring eager process-local copies. */
  getSpansForProcess?: (processId: string) => readonly TraceSpanGeometrySource[];
  /** Resolves visible local dependencies for one process without requiring eager process-local copies. */
  getLocalDependenciesForProcess?: (processId: string) => readonly TraceLocalDependencySource[];
  /** Resolves lightweight lane spans for one process without materializing `TraceSpan`. */
  getLaneBlocksForProcess?: (processId: string) => readonly TraceLayoutLaneBlockSource[];
  /** Resolves lightweight lane dependencies for one process without materializing `TraceLocalDependency`. */
  getLaneLocalDependenciesForProcess?: (
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
  let laneLayoutBlockCount = 0;
  let blockBucketingDurationMs = 0;
  let combinedLaneAssignmentDurationMs = 0;
  let separateLaneAssignmentDurationMs = 0;
  let rankAssemblyDurationMs = 0;

  const threadLayoutMap: Record<TraceThreadId, ThreadLayout> = {};
  const rankSpacings: number[] = new Array(processes.length).fill(0);

  const processLayouts: ProcessLayout[] = new Array(processes.length);
  const ranksInLayoutOrder = processes.map((rank, rankIndex) => ({rank, rankIndex}));
  const showEmptyProcesses = props.settings.showEmptyProcesses ?? false;
  const rankHasDisplayableSpanContent = ranksInLayoutOrder.map(({rank}) => {
    if (showEmptyProcesses) {
      return true;
    }

    const rankLaneBlocks = props.getLaneBlocksForProcess?.(rank.processId) ?? rank.laneBlocks ?? [];
    const displayableThreadIds = new Set(
      rank.threads
        .filter(thread => {
          const laneMetadata = props.streamLaneLayoutMap?.[thread.threadId];
          return (
            (!hideStreamsWithoutLaneMetadata || laneMetadata !== undefined) &&
            streamIsVisible(thread, props.settings)
          );
        })
        .map(thread => thread.threadId)
    );

    return rankLaneBlocks.some(block => displayableThreadIds.has(block.threadId));
  });

  ranksInLayoutOrder.forEach(({rank, rankIndex}) => {
    if (!rankHasDisplayableSpanContent[rankIndex]) {
      return;
    }

    const rankLaneBlocks = props.getLaneBlocksForProcess?.(rank.processId) ?? rank.laneBlocks ?? [];
    const rankLaneLocalDependencies =
      props.getLaneLocalDependenciesForProcess?.(rank.processId) ??
      rank.laneLocalDependencies ??
      [];
    const explicitParentByChild = shouldCombineThreads
      ? undefined
      : buildExplicitParentSpanMap({
          spans: rankLaneBlocks,
          localDependencies: rankLaneLocalDependencies,
          maxTimeMs
        });
    const rankIsCollapsed = props.collapsedProcessIds?.has(rank.processId) ?? false;
    const threadRefByStreamId = new Map<TraceThreadId, ThreadRef>();
    if (rank.processRef != null) {
      for (const threadSource of props.traceGraph.getThreadSourcesByProcessRef(rank.processRef)) {
        threadRefByStreamId.set(threadSource.threadId, threadSource.threadRef);
      }
    } else {
      rank.threads.forEach((thread, threadIndex) => {
        const threadRef = rank.threadRefs?.[threadIndex];
        if (threadRef != null) {
          threadRefByStreamId.set(thread.threadId, threadRef);
        }
      });
    }
    const threadLayouts: ThreadLayout[] = [];
    const rankContentStartY = yOffset + processContentTopInset;
    let rankStartPosition = [0, rankContentStartY, 0] as [number, number, number];
    const threadsInLayoutOrder = [...rank.threads];
    const threadBlocks = shouldCombineThreads
      ? null
      : (() => {
          const rankLaneBlocks = (props.getSpansForProcess?.(rank.processId) ??
            rank.spans ??
            []) as readonly TraceSpanLaneSource[];
          const nextThreadBlocks = new Map<TraceThreadId, TraceSpanLaneSource[]>();
          const blockBucketingStartTime = performance.now();
          for (const block of rankLaneBlocks) {
            const spansForThread = nextThreadBlocks.get(block.threadId);
            if (spansForThread) {
              spansForThread.push(block);
            } else {
              nextThreadBlocks.set(block.threadId, [block]);
            }
          }
          blockBucketingDurationMs += performance.now() - blockBucketingStartTime;
          return nextThreadBlocks;
        })();

    if (props.settings.sortThreads) {
      threadsInLayoutOrder.sort((a, b) => {
        const aName = a.name?.trim() || String(a.threadId);
        const bName = b.name?.trim() || String(b.threadId);
        return compareNumericSortStrings(aName, bName);
      });
    }

    const displayableThreads = threadsInLayoutOrder.filter(thread => {
      const laneMetadata = props.streamLaneLayoutMap?.[thread.threadId];
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
            return combinedAssignmentOverride;
          }
          const combinedLaneAssignmentStartTime = performance.now();
          const visibleThreadIds = new Set(visibleThreads.map(thread => thread.threadId));
          const visibleBlockCount = rankLaneBlocks.filter(block =>
            visibleThreadIds.has(block.threadId)
          ).length;
          if (visibleBlockCount > 0) {
            laneLayoutCallCount += 1;
            laneLayoutBlockCount += visibleBlockCount;
          }
          const combinedAssignments = getCombinedRankLaneAssignments({
            rank,
            spans: rankLaneBlocks,
            localDependencies: rankLaneLocalDependencies,
            visibleThreadIds,
            maxTimeMs,
            maxVisibleLanesPerThread: props.settings.maxVisibleLanesPerThread,
            maxVisibleLanesUnlimited: props.settings.maxVisibleLanesUnlimited
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
          const visibleLaneIndices =
            props.streamLaneLayoutMap?.[thread.threadId]?.visibleLaneIndices;
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
      const combinedSpanLaneMap = combinedLaneAssignments?.spanLaneMap ?? new Map();
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
        startPosition: [0, baseYPosition, 0] as [number, number, number],
        targetPosition: [maxTimeMs, baseYPosition, 0] as [number, number, number],
        overflowSpanCount,
        lanes: baseLanes,
        spanLaneMap: isRankVisible ? combinedSpanLaneMap : undefined
      } satisfies ThreadLayout;

      const combinedStreamLayout = {
        ...combinedBaseStreamLayout,
        overflowLabel: buildThreadOverflowLabelForThreads({
          threadLayout: combinedBaseStreamLayout,
          overflowSpanCount,
          threads: threadsInLayoutOrder,
          threadRefs: rank.threadRefs,
          traceGraph: props.traceGraph,
          labelLaneSeparation: laneSeparation
        })
      } satisfies ThreadLayout;

      for (const thread of threadsInLayoutOrder) {
        const laneMetadata = props.streamLaneLayoutMap?.[thread.threadId];
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
           * In combine-threads mode most logical threads render the exact same rank row. Keep the
           * per-thread map entries for lookup compatibility, but point them at the canonical
           * combined layout so downstream rank-delta passes translate one object instead of
           * cloning one layout per logical thread. Only do this when the rank has no hidden
           * per-thread rows; collapsed or filtered threads need their own invisible layout so
           * navigable geometry can remain zero-height for those thread refs.
           */
          threadLayoutMap[thread.threadId] = combinedStreamLayout;
          continue;
        }
        const laneCount = visibleLaneCountForRank || 1;
        const streamLayout = {
          ...combinedStreamLayout,
          threadRef: threadRefByStreamId.get(thread.threadId),
          threadId: thread.threadId,
          visible: isVisible,
          yPosition: isVisible ? baseYPosition : -1000,
          startPosition: [0, isVisible ? baseYPosition : -1000, 0] as [number, number, number],
          targetPosition: [maxTimeMs, isVisible ? baseYPosition : -1000, 0] as [
            number,
            number,
            number
          ],
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
          spanLaneMap: isVisible ? combinedSpanLaneMap : undefined
        } satisfies ThreadLayout;

        threadLayoutMap[thread.threadId] = streamLayout;
      }

      threadLayouts.push(combinedStreamLayout);
      visibleLaneCount = visibleLaneCountForRank;
      if (isRankVisible) {
        visibleThreadCount = 1;
        rankStartPosition = combinedStreamLayout.startPosition;
      }
    } else {
      let currentLaneY = rankContentStartY;
      threadsInLayoutOrder.forEach(thread => {
        const laneMetadata = props.streamLaneLayoutMap?.[thread.threadId];
        const isVisible =
          !rankIsCollapsed &&
          (!hideStreamsWithoutLaneMetadata || laneMetadata !== undefined) &&
          streamIsVisible(thread, props.settings);
        const spansForThread = threadBlocks?.get(thread.threadId) ?? [];
        const disableLaneAssignment = getLaneAssignmentMode(rank.userData) === 'none';
        const separateLaneAssignmentStartTime = performance.now();
        const inferredLaneMap = {
          map: new Map<SpanRef, number>(),
          maxLane: -1
        };
        if (disableLaneAssignment) {
          for (const block of spansForThread) {
            if (block.spanRef != null) {
              inferredLaneMap.map.set(block.spanRef, 0);
            }
          }
          inferredLaneMap.maxLane = spansForThread.length > 0 ? 0 : -1;
        } else {
          laneLayoutCallCount += 1;
          laneLayoutBlockCount += spansForThread.length;
          const hasSeparateParentHints = hasParentHintsForSpans(
            spansForThread,
            explicitParentByChild
          );
          const hasSeparateLaneAffinity = hasTraceLaneAffinity(spansForThread);
          inferredLaneMap.maxLane = visitKahnLaneAssignments<TraceSpanLaneSource>(
            spansForThread,
            {
              ...(hasSeparateParentHints
                ? {
                    getParentSpanId: (block: TraceSpanLaneSource) =>
                      explicitParentByChild?.get(block.spanId)
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
        separateLaneAssignmentDurationMs += performance.now() - separateLaneAssignmentStartTime;
        const inferredLaneCount =
          inferredLaneMap?.maxLane == null ? 0 : inferredLaneMap.maxLane + 1;
        const totalLaneCount = Math.max(1, laneMetadata?.laneCount ?? 1, inferredLaneCount);
        const normalizedLaneCount = normalizeLaneCounts(
          totalLaneCount,
          props.settings.maxVisibleLanesPerThread,
          props.settings.maxVisibleLanesUnlimited
        );
        const defaultCollapsed = false;
        const isExplicitlyExpanded = props.expandedStreamIds?.has(thread.threadId) ?? false;
        const isExplicitlyCollapsed = props.collapsedStreamIds?.has(thread.threadId) ?? false;
        const isCollapsed = isExplicitlyCollapsed
          ? true
          : isExplicitlyExpanded
            ? false
            : (laneMetadata?.isCollapsed ?? defaultCollapsed);
        const laneCollapseMode = (thread.userData as {laneCollapseMode?: string} | undefined)
          ?.laneCollapseMode;
        const spanLaneMap = laneMetadata?.spanLaneMap ?? inferredLaneMap?.map;
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
        const effectiveSpanLaneMap = spanLaneMap;
        const effectiveLaneCount =
          effectiveVisibleLaneIndices && effectiveVisibleLaneIndices.length > 0
            ? effectiveVisibleLaneIndices.length
            : normalizedLaneCount.laneCount;
        const effectiveRenderedLaneCount =
          effectiveVisibleLaneIndices && effectiveVisibleLaneIndices.length > 0
            ? effectiveVisibleLaneIndices.length
            : normalizedLaneCount.renderedLaneCount;
        const overflowSpanCount = countOverflowSpans(
          spanLaneMap,
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
          threadRef: threadRefByStreamId.get(thread.threadId),
          threadId: thread.threadId,
          visible: effectiveIsVisible,
          yPosition,
          startPosition: [0, yPosition, 0],
          targetPosition: [maxTimeMs, yPosition, 0],
          overflowLabel: effectiveIsVisible
            ? buildThreadOverflowLabelForThreads({
                threadLayout: {
                  visible: effectiveIsVisible,
                  yPosition,
                  startPosition: [0, yPosition, 0],
                  targetPosition: [maxTimeMs, yPosition, 0],
                  spanLaneMap: effectiveSpanLaneMap,
                  lanes: {
                    laneCount: effectiveLaneCount,
                    renderedLaneCount: effectiveRenderedLaneCount,
                    visibleLaneIndices: effectiveVisibleLaneIndices,
                    isCollapsed,
                    laneYPositions,
                    collapseMode: laneCollapseMode === 'top-only' ? 'top-only' : undefined
                  }
                } satisfies ThreadLayout,
                overflowSpanCount,
                threads: [thread],
                threadRefs:
                  threadRefByStreamId.get(thread.threadId) != null
                    ? [threadRefByStreamId.get(thread.threadId)!]
                    : undefined,
                traceGraph: props.traceGraph,
                labelLaneSeparation: laneSeparation
              })
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
          spanLaneMap: effectiveSpanLaneMap
        } satisfies ThreadLayout;

        threadLayoutMap[thread.threadId] = streamLayout;
        threadLayouts.push(streamLayout);

        if (effectiveIsVisible) {
          rankStartPosition = streamLayout.startPosition;
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
      isCollapsed: rankIsCollapsed,
      yOffset: yOffset,
      yHeight: rankContentSpacing,
      labelY: collapsedCombinedThreadMetrics?.labelY ?? labelY,
      collapsedActivityY:
        collapsedCombinedThreadMetrics?.collapsedActivityY ??
        getProcessCollapsedActivityY({yOffset, yHeight: rankContentSpacing}),
      startPosition: rankStartPosition,
      threadLayouts,
      backgroundPolygon: new Float32Array() as Float32Array,
      backgroundPolygonInfinite: new Float32Array(0) as Float32Array,
      separatorLineInfinite: new Float32Array(0) as Float32Array,
      terminalSeparatorLineInfinite: new Float32Array(0) as Float32Array
    } satisfies ProcessLayout;

    rankLayout.backgroundPolygon = computeRankBackgroundPolygon({
      rankLayout,
      threadLayouts
    });
    rankLayout.backgroundPolygonInfinite = computeRankBackgroundPolygon({
      rankLayout,
      threadLayouts,
      infiniteWidth: true
    });
    rankLayout.separatorLineInfinite = computeRankSeparatorLineInfinite(rankLayout);
    rankLayout.terminalSeparatorLineInfinite = computeRankTerminalSeparatorLineInfinite(rankLayout);

    const hasFollowingDisplayableProcess = rankHasDisplayableSpanContent
      .slice(rankIndex + 1)
      .some(Boolean);
    const processGap = showEmptyProcesses || hasFollowingDisplayableProcess ? processSeparation : 0;
    const rankYSpacing = rankContentSpacing + processGap;
    rankSpacings[rankIndex] = rankYSpacing;
    yOffset += rankYSpacing;

    rankStartPosition = [rankStartPosition[0], rankContentStartY, rankStartPosition[2]];

    processLayouts[rankIndex] = rankLayout;
    rankAssemblyDurationMs += performance.now() - rankAssemblyStartTime;
  });

  log.probe(
    1,
    `lane-layout calculateTraceLayout done aggregationMode=${aggregationMode} processes=${processes.length} visibleThreads=${totalVisibleThreadCount} laneLayoutCalls=${laneLayoutCallCount} laneLayoutBlocks=${laneLayoutBlockCount} blockBucketingMs=${blockBucketingDurationMs.toFixed(1)} combinedLaneMs=${combinedLaneAssignmentDurationMs.toFixed(1)} separateLaneMs=${separateLaneAssignmentDurationMs.toFixed(1)} rankAssemblyMs=${rankAssemblyDurationMs.toFixed(1)} totalMs=${(performance.now() - layoutStartTime).toFixed(1)}`,
    {
      blockBucketingDurationMs,
      combinedLaneAssignmentDurationMs,
      separateLaneAssignmentDurationMs,
      rankAssemblyDurationMs,
      durationMs: performance.now() - layoutStartTime,
      ...getHeapUsageProbeFields()
    }
  )();

  const overflowLabels = buildTraceLayoutOverflowLabels(processLayouts);
  return {
    layout: {
      layoutConfiguration: {laneSeparation: props.layoutConfiguration.laneSeparation},
      traceGraph: props.traceGraph,
      processLayouts,
      renderRows: [],
      threadLayoutMap,
      spanGeometryChunks: [],
      spanVisibilityMapBySpanRef: new Map(),
      localDependencyGeometryChunks: [],
      crossDependencyGeometryChunks: [],
      overflowLabels,
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
  } satisfies {layout: TraceLayout; rankSpacings: number[]};
}

/**
 * Builds preferred child-to-parent hints from visible local dependencies and timing extents.
 */
export function buildExplicitParentSpanMap(params: {
  spans: readonly TraceLayoutLaneBlockSource[];
  localDependencies: readonly TraceLayoutLaneDependencySource[];
  maxTimeMs: number;
}): Map<TraceSpanId, TraceSpanId> {
  const blockTimings = new Map<TraceSpanId, {startTimeMs: number; endTimeMs: number}>();
  for (const block of params.spans) {
    const timingExtent = getSpanExtremalTiming(block, params.maxTimeMs);
    blockTimings.set(block.spanId, timingExtent);
  }

  const parentCandidates = new Map<
    TraceSpanId,
    Array<{parentId: TraceSpanId; isExplicitParent: boolean}>
  >();
  for (const dependency of params.localDependencies) {
    const parentId = dependency.startSpanId;
    const childId = dependency.endSpanId;
    if (!blockTimings.has(parentId) || !blockTimings.has(childId)) {
      continue;
    }

    const existing = parentCandidates.get(childId);
    if (existing) {
      existing.push({
        parentId,
        isExplicitParent: dependency.hasParentKeyword === true
      });
    } else {
      parentCandidates.set(childId, [
        {
          parentId,
          isExplicitParent: dependency.hasParentKeyword === true
        }
      ]);
    }
  }

  const explicitParentByChild = new Map<TraceSpanId, TraceSpanId>();
  for (const [childId, candidates] of parentCandidates) {
    const childTiming = blockTimings.get(childId);
    if (!childTiming) {
      continue;
    }

    let bestParentId: TraceSpanId | null = null;
    let bestParentSpan = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const parentTiming = blockTimings.get(candidate.parentId);
      if (!parentTiming) {
        continue;
      }

      const isContaining =
        parentTiming.startTimeMs <= childTiming.startTimeMs &&
        parentTiming.endTimeMs >= childTiming.endTimeMs;
      if (!candidate.isExplicitParent && !isContaining) {
        continue;
      }

      const candidateSpan = parentTiming.endTimeMs - parentTiming.startTimeMs;
      if (candidateSpan < bestParentSpan) {
        bestParentSpan = candidateSpan;
        bestParentId = candidate.parentId;
      }
    }

    if (bestParentId != null) {
      explicitParentByChild.set(childId, bestParentId);
    }
  }
  return explicitParentByChild;
}

/** Returns the conventional span trace id used for soft lane affinity when available. */
export function getTraceLaneAffinityKey(
  block: Pick<TraceSpanLaneSource, 'userData'>
): string | number | bigint | null {
  const userData = block.userData;
  const affinityKey = userData?.traceId ?? userData?.trace_id;
  return typeof affinityKey === 'string' ||
    typeof affinityKey === 'number' ||
    typeof affinityKey === 'bigint'
    ? affinityKey
    : null;
}

/** Returns whether any lane block carries conventional trace-affinity metadata. */
export function hasTraceLaneAffinity(
  blocks: readonly Pick<TraceSpanLaneSource, 'userData'>[]
): boolean {
  return blocks.some(block => getTraceLaneAffinityKey(block) != null);
}

/** Returns whether the lane-assignment batch has at least one explicit parent hint. */
export function hasParentHintsForSpans(
  spans: readonly Pick<TraceSpanLaneSource, 'spanId'>[],
  explicitParentByChild: ReadonlyMap<TraceSpanId, TraceSpanId> | undefined
): boolean {
  if (!explicitParentByChild || explicitParentByChild.size === 0) {
    return false;
  }
  return spans.some(span => explicitParentByChild.has(span.spanId));
}

export function buildTraceLocalDependencyGeometries(params: {
  localDependencies: TraceLocalDependencySource[];
  spanMap: Record<string, TraceSpanGeometrySource>;
  maxTimeMs: number;
  threadLayoutMap: Record<string, ThreadLayout>;
  /** Ref-native layout lookup used before falling back to stream-id layout lookup. */
  layoutLookup?: TraceGeometryLayoutLookup;
  streamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
  minTimeMs: number;
  dependencyGeometryMap: Record<TraceDependencyId, Float32Array>;
  settings: {
    dependencyDisplayMode?: 'all' | 'exclude' | 'include';
    dependencyKeywords?: string[];
  };
}): void {
  const {localDependencies, spanMap, threadLayoutMap, minTimeMs, dependencyGeometryMap} = params;
  const resolvedMaxTimeMs =
    Number.isFinite(params.maxTimeMs) && params.maxTimeMs > 0
      ? params.maxTimeMs
      : Number.MAX_SAFE_INTEGER;
  const {dependencyDisplayMode, dependencyKeywords = []} = params.settings;
  let skippedStartBlockCount = 0;
  let skippedEndBlockCount = 0;

  for (const localDep of localDependencies) {
    if (dependencyDisplayMode === 'exclude') {
      if ([...localDep.keywords].some(keyword => dependencyKeywords.includes(keyword))) {
        continue;
      }
    }

    const startBlock = spanMap[localDep.startSpanId];
    if (!startBlock) {
      skippedStartBlockCount += 1;
      continue;
    }

    const endBlock = spanMap[localDep.endSpanId];
    if (!endBlock) {
      skippedEndBlockCount += 1;
      continue;
    }

    dependencyGeometryMap[localDep.dependencyId] = getLocalDependencyPathFlat({
      startBlock,
      endBlock,
      threadLayoutMap,
      layoutLookup: params.layoutLookup,
      streamToProcessLayoutMap: params.streamToProcessLayoutMap,
      maxTimeMs: resolvedMaxTimeMs,
      minTimeMs,
      waitMode: localDep.waitMode,
      bidirectional: localDep.bidirectional
    });
  }

  if (skippedStartBlockCount > 0 || skippedEndBlockCount > 0) {
    log.probe(1, 'Skipped local dependency geometries with missing endpoint spans', {
      skippedStartBlockCount,
      skippedEndBlockCount
    })();
  }
}

export function buildTraceCrossRankDependencyGeometries(params: {
  crossDependencies: Readonly<TraceCrossDependencySource[]>;
  maxTimeMs: number;
  minTimeMs: number;
  spanMap: Record<string, TraceSpanGeometrySource>;
  threadLayoutMap: Record<string, ThreadLayout>;
  /** Ref-native layout lookup used before falling back to stream-id layout lookup. */
  layoutLookup?: TraceGeometryLayoutLookup;
  streamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
  dependencyGeometryMap: Record<TraceDependencyId, Float32Array>;
}): void {
  const geometryStartTime = performance.now();
  const {crossDependencies, dependencyGeometryMap} = params;
  log.probe(1, `deck-trace-layers cross rank geometry start`)();
  let skippedStartBlockCount = 0;
  let skippedEndBlockCount = 0;

  for (const crossDep of crossDependencies) {
    const result = buildTraceCrossRankDependencyGeometry({...params, crossDependency: crossDep});
    if (result.skippedEndpoint === 'start') {
      skippedStartBlockCount += 1;
      log.log('Cross dependency start block not found', crossDep.startSpanId)();
      continue;
    }
    if (result.skippedEndpoint === 'end') {
      skippedEndBlockCount += 1;
      log.log('Cross dependency end block not found', crossDep.endSpanId)();
      continue;
    }
    if (result.geometry) {
      dependencyGeometryMap[crossDep.dependencyId] = result.geometry;
    }
  }

  log.probe(1, 'deck-trace-layers cross rank geometries complete', {
    totalCrossDependencyCount: crossDependencies.length,
    builtCrossGeometryCount: Object.keys(dependencyGeometryMap).length,
    skippedStartBlockCount,
    skippedEndBlockCount,
    durationMs: performance.now() - geometryStartTime
  })();
}

/**
 * Builds one cross-process dependency geometry from already-resolved layout/block maps.
 */
export function buildTraceCrossRankDependencyGeometry(params: {
  /** Cross-process dependency to render. */
  crossDependency: Readonly<TraceCrossDependencySource>;
  /** Canonical timeline maximum time. */
  maxTimeMs: number;
  /** Canonical timeline minimum time. */
  minTimeMs: number;
  /** Geometry-time block payloads keyed by block id. */
  spanMap: Record<string, TraceSpanGeometrySource>;
  /** Current thread layouts keyed by stream id. */
  threadLayoutMap: Record<string, ThreadLayout>;
  /** Ref-native layout lookup used before falling back to stream-id layout lookup. */
  layoutLookup?: TraceGeometryLayoutLookup;
  /** Current process layouts keyed by stream id. */
  streamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
}): {geometry: Float32Array | null; skippedEndpoint: 'start' | 'end' | null} {
  const {crossDependency, spanMap, threadLayoutMap, streamToProcessLayoutMap, minTimeMs} = params;
  const resolvedMaxTimeMs =
    Number.isFinite(params.maxTimeMs) && params.maxTimeMs > 0
      ? params.maxTimeMs
      : Number.MAX_SAFE_INTEGER;
  const startBlock = crossDependency.startSpanId && spanMap[crossDependency.startSpanId];
  if (!startBlock) {
    return {geometry: null, skippedEndpoint: 'start'};
  }

  const endBlock = crossDependency.endSpanId && spanMap[crossDependency.endSpanId];
  if (!endBlock) {
    return {geometry: null, skippedEndpoint: 'end'};
  }

  return {
    geometry: getCrossRankDependencyPathFlat({
      startBlock,
      endBlock,
      threadLayoutMap,
      layoutLookup: params.layoutLookup,
      streamToProcessLayoutMap,
      maxTimeMs: resolvedMaxTimeMs,
      minTimeMs,
      waitMode: crossDependency.waitMode,
      bidirectional: crossDependency.bidirectional
    }),
    skippedEndpoint: null
  };
}

const EMPTY_FLOAT_ARRAY = Object.freeze(new Float32Array(0));
export type SpanBoundingBox = Float32Array;

const EMPTY_BBOX: SpanBoundingBox = new Float32Array([0, 0, 0, 0]);

/**
 * Resolves the thread layout that owns a geometry block in the current TraceGraph ref namespace.
 */
function getThreadLayoutForGeometryBlock(
  block: TraceSpanGeometrySource,
  threadLayoutMap: Record<string, ThreadLayout>,
  layoutLookup?: TraceGeometryLayoutLookup
): ThreadLayout | undefined {
  const fallbackLayout =
    layoutLookup?.fallbackThreadLayoutMap?.[block.threadId] ?? threadLayoutMap[block.threadId];
  if (
    fallbackLayout &&
    !fallbackLayout.visible &&
    (block.threadRef == null || fallbackLayout.threadRef === block.threadRef)
  ) {
    return fallbackLayout;
  }

  if (layoutLookup && block.threadRef != null) {
    const refLayout = layoutLookup.threadLayoutsByRef.get(block.threadRef);
    if (refLayout) {
      return refLayout;
    }
  }
  if (layoutLookup && block.spanRef != null) {
    const spanLayout = layoutLookup.threadLayoutsBySpanRef.get(block.spanRef);
    if (spanLayout) {
      return spanLayout;
    }
    const threadRef = layoutLookup.traceGraph.getThreadRefBySpanRef(block.spanRef);
    if (threadRef != null) {
      const refLayout = layoutLookup.threadLayoutsByRef.get(threadRef);
      if (refLayout) {
        return refLayout;
      }
    }
  }

  return fallbackLayout;
}

/**
 * Resolves the process layout that owns a geometry block in the current TraceGraph ref namespace.
 */
function getProcessLayoutForGeometryBlock(
  block: TraceSpanGeometrySource,
  streamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>,
  layoutLookup?: TraceGeometryLayoutLookup
): ProcessLayout | undefined {
  if (layoutLookup && block.processRef != null) {
    const refLayout = layoutLookup.processLayoutsByRef.get(block.processRef);
    if (refLayout) {
      return refLayout;
    }
  }
  if (layoutLookup && block.spanRef != null) {
    const spanLayout = layoutLookup.processLayoutsBySpanRef.get(block.spanRef);
    if (spanLayout) {
      return spanLayout;
    }
    const processRef = layoutLookup.traceGraph.getProcessRefBySpanRef(block.spanRef);
    if (processRef != null) {
      const refLayout = layoutLookup.processLayoutsByRef.get(processRef);
      if (refLayout) {
        return refLayout;
      }
    }
  }

  return (
    layoutLookup?.fallbackStreamToProcessLayoutMap?.[block.threadId] ??
    streamToProcessLayoutMap?.[block.threadId]
  );
}

export function getSpanBoundingBox(
  block: TraceSpanGeometrySource,
  threadLayoutMap: Record<string, ThreadLayout>,
  maxTimeMs: number,
  minTimeMs: number,
  blockHeight = 0.3,
  layoutLookup?: TraceGeometryLayoutLookup
): SpanBoundingBox {
  const streamLayout = getThreadLayoutForGeometryBlock(block, threadLayoutMap, layoutLookup);
  if (!streamLayout) {
    log.log(1, 'Stream layout not found for block', block.threadId)();
    return EMPTY_BBOX;
  }
  const processLayout = getProcessLayoutForGeometryBlock(block, undefined, layoutLookup);
  const manualSpanLayout = getManualSpanLayoutGeometry(block);
  const isManualThreadLayout = streamLayout.manualContentHeight != null;
  if (isManualThreadLayout) {
    if (!manualSpanLayout) {
      return EMPTY_BBOX;
    }
    const timing = getSpanExtremalTiming(block, maxTimeMs);
    const xs = timing.startTimeMs - minTimeMs;
    const xe = timing.endTimeMs - minTimeMs;
    if (!processLayout?.isCollapsed && streamLayout.visible) {
      const ys = streamLayout.yPosition + manualSpanLayout.topY;
      return buildSpanBoundingBox(xs, ys, xe, ys + manualSpanLayout.height);
    }

    const hiddenYPosition = getHiddenBlockYPosition({
      laneIndex: 0,
      processLayout,
      streamLayout
    });
    return hiddenYPosition === undefined
      ? EMPTY_BBOX
      : buildSpanBoundingBox(xs, hiddenYPosition, xe, hiddenYPosition);
  }

  const laneIndex = getSpanLaneIndex(block, streamLayout);
  const timing = getSpanExtremalTiming(block, maxTimeMs);
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
    return buildSpanBoundingBox(xs, yPosition - blockHeight / 2, xe, yPosition + blockHeight / 2);
  }

  const hiddenYPosition = getHiddenBlockYPosition({
    laneIndex: Math.max(0, laneIndex),
    processLayout,
    streamLayout
  });
  if (hiddenYPosition === undefined) {
    return EMPTY_BBOX;
  }

  return buildSpanBoundingBox(xs, hiddenYPosition, xe, hiddenYPosition);
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
function getHiddenBlockYPosition(params: {
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

/** Returns layout-specific visibility for one block geometry source. */
export function getTraceLayoutSpanVisibilityForBlock(params: {
  /** Geometry block whose current layout visibility should be resolved. */
  block: TraceSpanGeometrySource;
  /** Thread layouts keyed by process-local stream id. */
  threadLayoutMap: Record<string, ThreadLayout>;
  /** Optional process layouts keyed by process-local stream id. */
  streamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
  /** Ref-native layout lookup used before falling back to stream-id layout lookup. */
  layoutLookup?: TraceGeometryLayoutLookup;
}): TraceLayoutSpanVisibility {
  const streamLayout = getThreadLayoutForGeometryBlock(
    params.block,
    params.threadLayoutMap,
    params.layoutLookup
  );
  const processLayout = getProcessLayoutForGeometryBlock(
    params.block,
    params.streamToProcessLayoutMap,
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
    if (!getManualSpanLayoutGeometry(params.block)) {
      flags.push(traceLayoutSpanVisibilityFlags.laneHidden);
    }
    const visibilityFlags = getTraceLayoutSpanVisibilityMask(flags);
    return {
      visible: isTraceLayoutSpanVisible(visibilityFlags),
      visibilityFlags
    };
  }

  const laneIndex = getSpanLaneIndex(params.block, streamLayout);
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

function getSpanLaneIndex(block: TraceSpanGeometrySource, streamLayout?: ThreadLayout): number {
  if (!streamLayout) {
    return INVALID_LANE_INDEX;
  }

  if (block.spanRef != null && streamLayout.spanLaneMap) {
    const mappedLane = streamLayout.spanLaneMap.get(block.spanRef);
    if (typeof mappedLane === 'number' && Number.isFinite(mappedLane)) {
      const mappedLaneIndex = Math.floor(mappedLane);
      if (Number.isFinite(mappedLaneIndex)) {
        return Math.max(0, mappedLaneIndex);
      }
    }

    return INVALID_LANE_INDEX;
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
  startBlock: TraceSpanGeometrySource,
  endBlock: TraceSpanGeometrySource,
  waitMode: 'end-to-start' | 'end-to-end' | 'start-to-start',
  maxTimeMs = Number.MAX_SAFE_INTEGER
): {startTimeMs: number; endTimeMs: number} {
  const startTiming = getSpanExtremalTiming(startBlock, maxTimeMs);
  const endTiming = getSpanExtremalTiming(endBlock, maxTimeMs);
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

export function getLocalDependencyPathFlat(params: {
  startBlock: TraceSpanGeometrySource;
  endBlock: TraceSpanGeometrySource;
  threadLayoutMap: Record<string, ThreadLayout>;
  /** Ref-native layout lookup used before falling back to stream-id layout lookup. */
  layoutLookup?: TraceGeometryLayoutLookup;
  streamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
  waitMode: 'end-to-start' | 'end-to-end' | 'start-to-start';
  bidirectional: boolean;
  maxTimeMs: number;
  minTimeMs: number;
}): Float32Array {
  const {
    startBlock,
    endBlock,
    threadLayoutMap,
    layoutLookup,
    streamToProcessLayoutMap,
    waitMode,
    maxTimeMs,
    minTimeMs
  } = params;

  const startStreamLayout = getThreadLayoutForGeometryBlock(
    startBlock,
    threadLayoutMap,
    layoutLookup
  );
  const endStreamLayout = getThreadLayoutForGeometryBlock(endBlock, threadLayoutMap, layoutLookup);
  if (!startStreamLayout || !endStreamLayout) {
    return EMPTY_FLOAT_ARRAY;
  }

  const startProcessLayout = getProcessLayoutForGeometryBlock(
    startBlock,
    streamToProcessLayoutMap,
    layoutLookup
  );
  const endProcessLayout = getProcessLayoutForGeometryBlock(
    endBlock,
    streamToProcessLayoutMap,
    layoutLookup
  );
  const startStreamCollapsed = Boolean(startProcessLayout?.isCollapsed);
  const endStreamCollapsed = Boolean(endProcessLayout?.isCollapsed);

  let startLaneIndex = getSpanLaneIndex(startBlock, startStreamLayout);
  let endLaneIndex = getSpanLaneIndex(endBlock, endStreamLayout);
  if (startLaneIndex < 0 && startStreamCollapsed) {
    startLaneIndex = 0;
  }
  if (endLaneIndex < 0 && endStreamCollapsed) {
    endLaneIndex = 0;
  }
  if (startLaneIndex < 0 || endLaneIndex < 0) {
    return EMPTY_FLOAT_ARRAY;
  }

  const {startTimeMs, endTimeMs} = getStartAndEndTimeMs(startBlock, endBlock, waitMode, maxTimeMs);

  const xs = startTimeMs - minTimeMs;
  const xe = endTimeMs - minTimeMs;
  const xmid = (xe + xs) / 2;
  const ys = resolveCrossRankDependencyEndpointY({
    block: startBlock,
    threadId: startBlock.threadId,
    threadLayoutMap,
    streamToProcessLayoutMap,
    streamLayout: startStreamLayout,
    processLayout: startProcessLayout,
    laneIndex: startLaneIndex,
    isCollapsedDependency: startStreamCollapsed
  });
  const ye = resolveCrossRankDependencyEndpointY({
    block: endBlock,
    threadId: endBlock.threadId,
    threadLayoutMap,
    streamToProcessLayoutMap,
    streamLayout: endStreamLayout,
    processLayout: endProcessLayout,
    laneIndex: endLaneIndex,
    isCollapsedDependency: endStreamCollapsed
  });
  if (ys === undefined || ye === undefined) {
    return EMPTY_FLOAT_ARRAY;
  }

  void xmid;
  void params.bidirectional;
  const path = new Float32Array(4);
  let index = 0;
  path[index++] = xs;
  path[index++] = ys;
  path[index++] = xe;
  path[index++] = ye;
  validateGeometry(path);
  return path;
}

function resolveCrossRankDependencyEndpointY(params: {
  block?: TraceSpanGeometrySource;
  threadId: TraceThreadId;
  threadLayoutMap: Record<string, ThreadLayout>;
  streamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
  streamLayout?: ThreadLayout;
  processLayout?: ProcessLayout;
  laneIndex: number;
  isCollapsedDependency?: boolean;
  peerY?: number;
}): number | undefined {
  const streamLayout = params.streamLayout ?? params.threadLayoutMap[params.threadId];
  if (streamLayout?.manualContentHeight != null) {
    const manualSpanLayout = params.block ? getManualSpanLayoutGeometry(params.block) : null;
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

  const fallbackY =
    params.processLayout?.collapsedActivityY ??
    params.streamToProcessLayoutMap?.[params.threadId]?.collapsedActivityY;
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
  startBlock: TraceSpanGeometrySource;
  endBlock: TraceSpanGeometrySource;
  threadLayoutMap: Record<string, ThreadLayout>;
  layoutLookup?: TraceGeometryLayoutLookup;
  streamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
  waitMode: 'end-to-start' | 'end-to-end' | 'start-to-start';
  bidirectional: boolean;
  maxTimeMs: number;
  minTimeMs: number;
}): Float32Array {
  const {
    startBlock,
    endBlock,
    threadLayoutMap,
    layoutLookup,
    streamToProcessLayoutMap,
    waitMode,
    maxTimeMs,
    minTimeMs
  } = params;

  const startStreamLayout = getThreadLayoutForGeometryBlock(
    startBlock,
    threadLayoutMap,
    layoutLookup
  );
  const endStreamLayout = getThreadLayoutForGeometryBlock(endBlock, threadLayoutMap, layoutLookup);
  if (!startStreamLayout || !endStreamLayout) {
    return EMPTY_FLOAT_ARRAY;
  }

  const startProcessLayout = getProcessLayoutForGeometryBlock(
    startBlock,
    streamToProcessLayoutMap,
    layoutLookup
  );
  const endProcessLayout = getProcessLayoutForGeometryBlock(
    endBlock,
    streamToProcessLayoutMap,
    layoutLookup
  );
  const startStreamCollapsed = Boolean(startProcessLayout?.isCollapsed);
  const endStreamCollapsed = Boolean(endProcessLayout?.isCollapsed);

  let startLaneIndex = getSpanLaneIndex(startBlock, startStreamLayout);
  let endLaneIndex = getSpanLaneIndex(endBlock, endStreamLayout);
  if (startLaneIndex < 0 && startStreamCollapsed) {
    startLaneIndex = 0;
  }
  if (endLaneIndex < 0 && endStreamCollapsed) {
    endLaneIndex = 0;
  }

  if (startLaneIndex < 0 || endLaneIndex < 0) {
    return EMPTY_FLOAT_ARRAY;
  }

  const startLaneY = resolveCrossRankDependencyEndpointY({
    block: startBlock,
    threadId: startBlock.threadId,
    threadLayoutMap,
    streamToProcessLayoutMap,
    streamLayout: startStreamLayout,
    processLayout: startProcessLayout,
    laneIndex: startLaneIndex,
    isCollapsedDependency: startProcessLayout?.isCollapsed
  });
  const endLaneY = resolveCrossRankDependencyEndpointY({
    block: endBlock,
    threadId: endBlock.threadId,
    threadLayoutMap,
    streamToProcessLayoutMap,
    streamLayout: endStreamLayout,
    processLayout: endProcessLayout,
    laneIndex: endLaneIndex,
    isCollapsedDependency: endProcessLayout?.isCollapsed
  });

  const ys = resolveCrossRankDependencyEndpointY({
    block: startBlock,
    threadId: startBlock.threadId,
    threadLayoutMap,
    streamToProcessLayoutMap,
    streamLayout: startStreamLayout,
    processLayout: startProcessLayout,
    laneIndex: startLaneIndex,
    isCollapsedDependency: startProcessLayout?.isCollapsed,
    peerY: endLaneY
  });
  const ye = resolveCrossRankDependencyEndpointY({
    block: endBlock,
    threadId: endBlock.threadId,
    threadLayoutMap,
    streamToProcessLayoutMap,
    streamLayout: endStreamLayout,
    processLayout: endProcessLayout,
    laneIndex: endLaneIndex,
    isCollapsedDependency: endProcessLayout?.isCollapsed,
    peerY: startLaneY
  });

  if (ys === undefined || ye === undefined) {
    return EMPTY_FLOAT_ARRAY;
  }

  const {startTimeMs, endTimeMs} = getStartAndEndTimeMs(startBlock, endBlock, waitMode, maxTimeMs);
  const xs = startTimeMs - minTimeMs;
  const xe = endTimeMs - minTimeMs;
  void params.bidirectional;
  const path = new Float32Array(4);
  let index = 0;
  path[index++] = xs;
  path[index++] = ys;
  path[index++] = xe;
  path[index++] = ye;
  validateGeometry(path);
  return path;
}

/**
 * Returns validated author-provided manual span geometry, or null when the span should be hidden.
 */
export function getManualSpanLayoutGeometry(
  block: Pick<TraceSpanGeometrySource, 'layoutTopY' | 'layoutHeight'>
): {readonly topY: number; readonly height: number} | null {
  if (
    typeof block.layoutTopY !== 'number' ||
    !Number.isFinite(block.layoutTopY) ||
    block.layoutTopY < 0 ||
    typeof block.layoutHeight !== 'number' ||
    !Number.isFinite(block.layoutHeight) ||
    block.layoutHeight <= 0
  ) {
    return null;
  }

  return {
    topY: block.layoutTopY,
    height: block.layoutHeight
  };
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
