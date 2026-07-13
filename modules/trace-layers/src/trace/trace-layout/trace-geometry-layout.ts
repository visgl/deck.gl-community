import {traceDependencyKeywordFlagsHasParent} from '../ingestion/trace-dependency-arrow-fields';
import {decodeTraceSpanTimingStatusCode} from '../ingestion/trace-span-timing-status-code';
import {getHeapUsageProbeFields, log} from '../log';
import {resolveTraceSpanTimingEndTimeFields} from '../trace-graph-accessors';
import {getTraceGraphProcessLaneAssignmentMode} from '../trace-graph/trace-graph-runtime-helpers';
import {
  getProcessRefIndex,
  getThreadRefProcessIndex,
  getThreadRefThreadIndex
} from '../trace-graph/trace-id-encoder';
import {getTraceViewChunkFilterMask} from '../trace-view-snapshot';
import {compareNumericSortStrings} from '../utils/numeric-sort';
import {buildHierarchicalTrackLayout} from './hierarchical-track-layout';
import {visitKahnLaneAssignments} from './lane-layout';
import {
  applyRankDeltas,
  buildExplicitParentSpanMap,
  buildThreadOverflowLabel,
  calculateTraceLayout,
  COMPACT_TRACE_LANE_AFFINITY,
  computeInterleavedRankDeltas,
  computeRankBackgroundPolygonInfinite,
  computeSequentialRankDeltas,
  countOverflowSpanLaneCounts,
  countOverflowSpans,
  getCollapsedProcessMinimumRankSpacing,
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
  buildTraceLayoutProcesses,
  computeTraceLayoutBounds,
  getVisibleGeometrySpansForProcess,
  getVisibleLaneSameProcessDependenciesForProcess,
  getVisibleLaneSpansForProcess
} from './trace-geometry-layout-helpers';
import {
  buildTraceLayoutProcessLayoutMapByRef,
  buildTraceLayoutRows,
  createTraceLayoutSpanLaneColumns,
  getTraceLayoutProcessLayoutByRef,
  INVALID_TRACE_LAYOUT_SPAN_LANE_INDEX,
  setTraceLayoutSpanLaneIndex
} from './trace-layout';

import type {ArrowTraceChunk} from '../ingestion/arrow-trace';
import type {TraceGraph} from '../trace-graph/trace-graph';
import type {ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceProcessId,
  TraceThread,
  TraceThreadId,
  TrackAggregationMode
} from '../trace-graph/trace-types';
import type {
  HierarchicalTrackDescriptor,
  HierarchicalTrackLayoutResult
} from './hierarchical-track-layout';
import type {
  TraceLayoutLaneSpanSource,
  TraceLayoutMode,
  TraceSpanGeometrySource
} from './trace-geometry-layout-common';
import type {
  ProcessLayout,
  ThreadLaneMetadata,
  ThreadLayout,
  TraceGraphCollapseState,
  TraceLayout,
  TraceLayoutBounds,
  TraceLayoutCollapseState,
  TraceLayoutSpanLaneColumn,
  TraceLayoutSpanLaneColumns,
  TraceLayoutVisibleProcessMetadata
} from './trace-layout';

export type {TraceLayoutMode, SpanBoundingBox} from './trace-geometry-layout-common';
export {
  buildTraceCrossRankDependencyGeometries,
  buildTraceSameProcessDependencyGeometries,
  getSpanBoundingBox,
  getSameProcessDependencyPathFlat
} from './trace-geometry-layout-common';

/** Ref-native process and thread collapse overrides resolved for one layout build. */
type ResolvedTraceGraphCollapseState = {
  /** Optional process ids rendered as collapsed rows. */
  readonly collapsedProcessIds?: ReadonlySet<string>;
  /** Optional thread refs forced open in the rendered layout. */
  readonly expandedThreadRefs?: ReadonlySet<ThreadRef>;
  /** Optional thread refs forced closed in the rendered layout. */
  readonly collapsedThreadRefs?: ReadonlySet<ThreadRef>;
};

const DEFAULT_MINIMAP_SUMMARY_PADDING_FRACTION = 0.04;

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

/** Resolves one ref-native graph collapse state into the ids and refs used by layout internals. */
function resolveTraceGraphCollapseState(params: {
  traceGraph: TraceGraph;
  collapseState?: TraceGraphCollapseState;
}): ResolvedTraceGraphCollapseState {
  if (!params.collapseState) {
    return {};
  }

  let collapsedProcessIds: Set<string> | undefined;
  if (params.collapseState.collapsedProcessRefs.size > 0) {
    collapsedProcessIds = new Set<string>();
    for (const processRef of params.collapseState.collapsedProcessRefs) {
      const processIndex = getProcessRefIndex(processRef);
      const processId = params.traceGraph.processes[processIndex]?.processId;
      if (processId) {
        collapsedProcessIds.add(processId);
      }
    }
  }
  return {
    collapsedProcessIds: collapsedProcessIds?.size ? collapsedProcessIds : undefined,
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

    return {
      ...layout,
      minimapLayout: {
        traceLayout: minimapTraceLayout,
        bounds: addTraceLayoutBottomPadding(
          minimapTraceLayout.currentBounds,
          params.summaryPaddingFraction
        )
      }
    } satisfies TraceLayout;
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
      spanLaneColumnsByChunkIndex: layout.spanLaneColumnsByChunkIndex,
      processLayouts,
      processLayoutMapByRef: buildTraceLayoutProcessLayoutMapByRef(processLayouts),
      renderRows: layout.renderRows.map(row => ({
        ...row,
        isCollapsed: true
      })),
      globalEventRow: layout.globalEventRow,
      threadLayoutMapByRef: layout.threadLayoutMapByRef,
      currentBounds: [
        [0, 0],
        [0, 0]
      ]
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
  /**
   * Optional main-view X anchor already derived while primary timing/lane columns were streamed.
   *
   * This is retained once per rendered thread, not once per span, so overflow-label preparation
   * does not need to rescan canonical rows merely to recover the first visible lane's X origin.
   */
  overflowLabelAnchorX?: number;
  /** Whether generated lane columns contain at least one span owned by this thread row. */
  hasSpanLaneAssignments: boolean;
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
const TRACE_LAYOUT_DEPENDENCY_KEYWORD_FLAG_PARENT = 1 << 0;

/** Public Arrow data fields needed to borrow one Uint8 keyword-flags batch. */
type TraceLayoutKeywordFlagsFixedWidthData = {
  /** Number of logical dependency rows represented by this Arrow data batch. */
  readonly length: number;
  /** Original Arrow value offset; direct layout scans accept only offset-zero batches. */
  readonly offset: number;
  /** Number of null dependency rows in this Arrow data batch. */
  readonly nullCount: number;
  /** Borrowed primitive value storage for the canonical keyword-flags column. */
  readonly values: unknown;
};

/** Narrow Arrow column shape whose public keyword-flags batches can be borrowed. */
type TraceLayoutKeywordFlagsFixedWidthColumn = {
  /** Public Arrow data batches backing this keyword-flags vector. */
  readonly data?: readonly TraceLayoutKeywordFlagsFixedWidthData[];
};

/** Public Arrow data fields needed to borrow one primary-lane scalar batch. */
type TraceLayoutDensePrimaryLaneFixedWidthData = {
  /** Number of logical span rows represented by this Arrow data batch. */
  readonly length: number;
  /** Original Arrow value offset; trusted layout scans accept only offset-zero batches. */
  readonly offset: number;
  /** Number of null span rows in this Arrow data batch. */
  readonly nullCount: number;
  /** Borrowed primitive value storage for one canonical primary-lane column. */
  readonly values: unknown;
};

/** Narrow Arrow column shape whose public primary-lane batches can be borrowed. */
type TraceLayoutDensePrimaryLaneFixedWidthColumn = {
  /** Public Arrow data batches backing this primary-lane vector. */
  readonly data?: readonly TraceLayoutDensePrimaryLaneFixedWidthData[];
};

/** One aligned null-free primary-lane batch borrowed from a canonical span table. */
type TraceLayoutDensePrimaryLaneBatch = {
  /** Number of logical span rows represented by this aligned batch. */
  readonly length: number;
  /** Borrowed canonical thread-ref values for this aligned batch. */
  readonly threadRef: Float64Array;
  /** Borrowed compact primary timing-status values for this aligned batch. */
  readonly statusCode: Uint8Array;
  /** Borrowed primary timing start values for this aligned batch. */
  readonly startTimeMs: Float64Array;
  /** Borrowed primary source-end values for this aligned batch. */
  readonly endTimeMs: Float64Array;
};

/** Mutable per-thread interval-partition state owned by one trusted process build. */
type TraceLayoutDensePrimaryLaneThreadState = {
  /** Number of rows assigned to this thread during the trusted stream. */
  spanCount: number;
  /** Largest generated lane assigned to this thread, or -1 before any row. */
  maxLaneIndex: number;
  /** Counts of assigned spans keyed by generated lane index. */
  readonly laneAssignmentCounts: number[];
  /** Earliest finite primary start assigned to lane zero, if any. */
  minimumLaneZeroStartTimeMs?: number;
  /** Earliest finite primary start assigned to any generated lane, if any. */
  minimumStartTimeMs?: number;
  /** Previous start time used to verify per-thread canonical order. */
  previousStartTimeMs: number;
  /** Previous resolved end time used to verify per-thread canonical order. */
  previousEndTimeMs: number;
  /** Active generated lane indexes stored as a min-heap parallel to active end times. */
  readonly activeLaneIndexes: number[];
  /** Active lane end times stored as a min-heap parallel to active lane indexes. */
  readonly activeLaneEndTimeMs: number[];
  /** Reusable generated lane indexes stored as a numeric min-heap. */
  readonly availableLaneIndexes: number[];
  /** Next generated lane index when no released lane can be reused. */
  nextLaneIndex: number;
};

/** Complete trusted primary-lane result for one process or no result on coarse fallback. */
type TraceLayoutDensePrimaryLaneProcessState = {
  /** Number of canonical process rows streamed into final lane columns. */
  readonly rowCount: number;
  /** Final chunk-aligned lane columns, retained only after the full process gate succeeds. */
  readonly laneColumnsByChunkIndex: ReadonlyMap<number, TraceLayoutSpanLaneColumn>;
  /** Per-thread lane summaries aligned with process-local thread ordinals. */
  readonly threadStatesByThreadIndex: readonly TraceLayoutDensePrimaryLaneThreadState[];
};

/**
 * Build-local mask-native layout plan for a fully trusted filtered graph.
 *
 * The plan retains only canonical process metadata and final typed lane columns. It deliberately
 * does not retain a visible ref index, per-row JavaScript refs/maps, or a cache across builds.
 */
type TraceLayoutMaskNativeDensePlan = {
  /** Canonical process projection used while layout rows are materialized. */
  readonly processes: readonly TraceLayoutVisibleProcessMetadata[];
  /** Trusted final lane state keyed by canonical process ref for this one layout build. */
  readonly densePrimaryLaneStatesByProcessRef: ReadonlyMap<
    ProcessRef,
    TraceLayoutDensePrimaryLaneProcessState
  >;
};

type SeparateThreadTrackBuildResult = {
  descriptors: SeparateThreadTrackDescriptor[];
  rootTrackIds: string[];
  rankStates: SeparateThreadRankState[];
  /** Generated lane columns aligned with canonical Arrow span-table rows. */
  spanLaneColumnsByChunkIndex?: TraceLayoutSpanLaneColumns;
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

/**
 * Returns whether a canonical dependency row declares an explicit parent hint.
 *
 * The borrowed overlap visitor intentionally has no parent graph. Only source-declared parent
 * semantics force the richer object fallback; interval containment is not parenthood.
 */
function hasPrimaryLaneExplicitParentHintFromArrow(
  traceGraph: Readonly<TraceGraph>,
  processId: string
): boolean {
  const table = traceGraph.sameProcessDependencyTableMap[processId as TraceProcessId] ?? null;
  if (!table) {
    return false;
  }
  const keywordFlagsColumn = table.getChild('keywordFlags');
  if (!keywordFlagsColumn) {
    return false;
  }

  const borrowedParentHint = hasPrimaryLaneExplicitParentHintFromBorrowedKeywordFlags(
    keywordFlagsColumn,
    table.numRows
  );
  if (borrowedParentHint != null) {
    return borrowedParentHint;
  }

  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    if (traceDependencyKeywordFlagsHasParent(keywordFlagsColumn.get(rowIndex))) {
      return true;
    }
  }
  return false;
}

/**
 * Scans a complete canonical keyword-flags column through borrowed null-free Uint8 batches.
 *
 * The gate validates every batch before reading any values. One nullable, sliced, malformed, or
 * incomplete batch returns `null`, keeping the whole table on the checked Arrow scalar path
 * instead of mixing trusted and checked rows inside one dependency scan.
 *
 * @param keywordFlagsColumn Canonical dependency keyword-flags Arrow column.
 * @param rowCount Number of dependency rows that the borrowed batches must cover exactly.
 * @returns Parent-hint presence for a safe direct scan, or `null` for whole-table fallback.
 */
function hasPrimaryLaneExplicitParentHintFromBorrowedKeywordFlags(
  keywordFlagsColumn: {get(rowIndex: number): unknown},
  rowCount: number
): boolean | null {
  if (rowCount === 0) {
    return false;
  }

  const data = (keywordFlagsColumn as TraceLayoutKeywordFlagsFixedWidthColumn).data;
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  let scannedRowCount = 0;
  for (const batch of data) {
    if (
      !batch ||
      !Number.isSafeInteger(batch.length) ||
      batch.length < 0 ||
      batch.offset !== 0 ||
      batch.nullCount !== 0 ||
      !(batch.values instanceof Uint8Array) ||
      batch.values.length < batch.length
    ) {
      return null;
    }
    scannedRowCount += batch.length;
    if (!Number.isSafeInteger(scannedRowCount) || scannedRowCount > rowCount) {
      return null;
    }
  }
  if (scannedRowCount !== rowCount) {
    return null;
  }

  for (const batch of data) {
    const values = batch.values as Uint8Array;
    for (let rowIndex = 0; rowIndex < batch.length; rowIndex += 1) {
      if ((values[rowIndex]! & TRACE_LAYOUT_DEPENDENCY_KEYWORD_FLAG_PARENT) !== 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Streams one dataset-backed process directly from canonical Arrow bytes into final lane columns.
 *
 * The function owns a coarse process gate: one unsupported chunk, column, row, timing order, or
 * richer timing/affinity source discards every local write and returns `null` so the caller can
 * rebuild that complete process through the existing semantic path. Successful results retain only
 * final Int32 lane columns and tiny per-thread lane summaries; no per-row index or SpanRef survives.
 *
 * @param traceGraph Current runtime graph whose dataset chunks and snapshot masks are borrowed.
 * @param process Visible process metadata whose canonical chunk rows are streamed.
 * @param maxTimeMs Timeline maximum used to resolve unfinished primary timing ends.
 * @returns Final direct lane state for this process, or `null` for whole-process fallback.
 */
function tryBuildTrustedDensePrimaryLaneProcessState(params: {
  traceGraph: Readonly<TraceGraph>;
  process: Readonly<TraceLayoutVisibleProcessMetadata>;
  maxTimeMs: number;
  /** Optional process-local canonical chunks already validated by a graph-wide preflight. */
  chunks?: readonly ArrowTraceChunk[];
}): TraceLayoutDensePrimaryLaneProcessState | null {
  const traceGraph = params.traceGraph;
  if (traceGraph.spanRefs != null || traceGraph.spanLayout !== 'auto') {
    return null;
  }

  const processId = params.process.processId as TraceProcessId;
  const processIndex = getProcessRefIndex(params.process.processRef);
  const disablesLaneAssignment =
    getTraceGraphProcessLaneAssignmentMode(params.process.userData) === 'none';
  const threadStatesByThreadIndex = Array.from({length: params.process.threads.length}, () =>
    createTraceLayoutDensePrimaryLaneThreadState()
  );
  const laneColumnsByChunkIndex = new Map<number, TraceLayoutSpanLaneColumn>();
  let rowCount = 0;

  for (const chunk of params.chunks ?? traceGraph.chunks) {
    if (
      chunk.processId !== processId &&
      chunk.processRefs.some(processRef => processRef === params.process.processRef)
    ) {
      return null;
    }
    if (chunk.processId !== processId) {
      continue;
    }
    if (
      chunk.processRefs.length !== 1 ||
      chunk.processRefs[0] !== params.process.processRef ||
      laneColumnsByChunkIndex.has(chunk.chunkIndex) ||
      hasTraceLayoutDensePrimaryLaneRicherSource(traceGraph, processId, chunk)
    ) {
      return null;
    }
    if (chunk.spanTable.numRows === 0) {
      continue;
    }

    const batches = buildTraceLayoutDensePrimaryLaneBatches(chunk);
    if (!batches) {
      return null;
    }
    const filterMaskByRow = getTraceViewChunkFilterMask(
      traceGraph.traceViewSnapshot,
      chunk.chunkIndex
    );
    if (filterMaskByRow != null && filterMaskByRow.length !== chunk.spanTable.numRows) {
      return null;
    }
    const laneValues = new Int32Array(chunk.spanTable.numRows);
    if (filterMaskByRow != null) {
      laneValues.fill(INVALID_TRACE_LAYOUT_SPAN_LANE_INDEX);
    }
    let chunkRowIndex = 0;
    for (const batch of batches) {
      for (let batchRowIndex = 0; batchRowIndex < batch.length; batchRowIndex += 1) {
        if (chunkRowIndex >= laneValues.length) {
          return null;
        }
        if (filterMaskByRow != null && filterMaskByRow[chunkRowIndex] !== 0) {
          chunkRowIndex += 1;
          continue;
        }
        const threadRefValue = batch.threadRef[batchRowIndex]!;
        if (
          !Number.isSafeInteger(threadRefValue) ||
          getThreadRefProcessIndex(threadRefValue as ThreadRef) !== processIndex
        ) {
          return null;
        }
        const threadRef = threadRefValue as ThreadRef;
        const threadIndex = getThreadRefThreadIndex(threadRef);
        const threadState = threadStatesByThreadIndex[threadIndex];
        if (!threadState || params.process.threadRefs[threadIndex] !== threadRef) {
          return null;
        }

        if (disablesLaneAssignment) {
          laneValues[chunkRowIndex] = 0;
          recordTraceLayoutDensePrimaryLaneOverflowAnchor(
            threadState,
            batch.startTimeMs[batchRowIndex]!,
            0
          );
          threadState.maxLaneIndex = 0;
          threadState.laneAssignmentCounts[0] = (threadState.laneAssignmentCounts[0] ?? 0) + 1;
          threadState.spanCount += 1;
          chunkRowIndex += 1;
          rowCount += 1;
          continue;
        }

        const status = decodeTraceSpanTimingStatusCode(batch.statusCode[batchRowIndex]);
        const startTimeMs = batch.startTimeMs[batchRowIndex]!;
        const sourceEndTimeMs = batch.endTimeMs[batchRowIndex]!;
        if (status == null || !Number.isFinite(startTimeMs) || !Number.isFinite(sourceEndTimeMs)) {
          return null;
        }
        const endTimeMs =
          status === 'finished' && sourceEndTimeMs > startTimeMs
            ? sourceEndTimeMs
            : resolveTraceSpanTimingEndTimeFields(
                status,
                startTimeMs,
                sourceEndTimeMs,
                params.maxTimeMs
              );
        if (
          !Number.isFinite(endTimeMs) ||
          (threadState.spanCount > 0 &&
            (startTimeMs < threadState.previousStartTimeMs ||
              (startTimeMs === threadState.previousStartTimeMs &&
                endTimeMs > threadState.previousEndTimeMs)))
        ) {
          return null;
        }

        const laneIndex = assignTraceLayoutDensePrimaryLane(threadState, startTimeMs, endTimeMs);
        recordTraceLayoutDensePrimaryLaneOverflowAnchor(threadState, startTimeMs, laneIndex);
        laneValues[chunkRowIndex] = laneIndex;
        threadState.previousStartTimeMs = startTimeMs;
        threadState.previousEndTimeMs = endTimeMs;
        threadState.spanCount += 1;
        chunkRowIndex += 1;
        rowCount += 1;
      }
    }
    if (chunkRowIndex !== laneValues.length) {
      return null;
    }
    laneColumnsByChunkIndex.set(chunk.chunkIndex, {values: laneValues});
  }

  return {
    rowCount,
    laneColumnsByChunkIndex,
    threadStatesByThreadIndex
  };
}

/**
 * Builds a filtered layout plan that never asks the runtime graph for a visible ref index.
 *
 * A snapshot mask is safe here only when every process can use the trusted primary-lane
 * streamer and no dependency row carries parent semantics. Parent rows can require endpoint
 * contraction after a hidden span, so one such row keeps the whole graph on the semantic path.
 */
function tryBuildTraceLayoutMaskNativeDensePlan(params: {
  /** Runtime graph whose snapshot masks may be borrowed by the direct stream. */
  readonly traceGraph: TraceGraph;
  /** Effective aggregation mode for this graph build. */
  readonly aggregationMode: TrackAggregationMode;
  /** Optional interactive lane overrides, which require the semantic lane metadata path. */
  readonly threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
}): TraceLayoutMaskNativeDensePlan | null {
  const {traceGraph} = params;
  if (
    !traceGraph.hasActiveSpanFilter() ||
    traceGraph.spanRefs != null ||
    traceGraph.spanLayout !== 'auto' ||
    params.aggregationMode !== 'separate-threads' ||
    (params.threadLaneLayoutOverrides != null &&
      Object.keys(params.threadLaneLayoutOverrides).length > 0)
  ) {
    return null;
  }

  const processes = buildTraceLayoutProcesses(traceGraph);
  if (
    hasTraceLayoutPotentialSpanLaneMetadata(traceGraph) &&
    processes.some(process => getTraceGraphProcessLaneAssignmentMode(process.userData) !== 'none')
  ) {
    return null;
  }
  const chunksByProcessRef = buildTraceLayoutDenseChunksByProcessRef(traceGraph);
  if (!chunksByProcessRef) {
    return null;
  }
  const densePrimaryLaneStatesByProcessRef = new Map<
    ProcessRef,
    TraceLayoutDensePrimaryLaneProcessState
  >();
  for (const process of processes) {
    const disablesLaneAssignment =
      getTraceGraphProcessLaneAssignmentMode(process.userData) === 'none';
    if (
      !disablesLaneAssignment &&
      hasPrimaryLaneExplicitParentHintFromArrow(traceGraph, process.processId)
    ) {
      return null;
    }
    const densePrimaryLaneState = tryBuildTrustedDensePrimaryLaneProcessState({
      traceGraph,
      process,
      maxTimeMs: traceGraph.maxTimeMs,
      chunks: chunksByProcessRef.get(process.processRef) ?? []
    });
    if (!densePrimaryLaneState) {
      return null;
    }
    densePrimaryLaneStatesByProcessRef.set(process.processRef, densePrimaryLaneState);
  }

  return {
    processes,
    densePrimaryLaneStatesByProcessRef
  };
}

/**
 * Groups process-scoped canonical chunks once for one graph-wide trusted layout preflight.
 *
 * Shared, mixed, or owner-mismatched chunks return null so the semantic layout path remains the
 * only owner of those cases.
 */
function buildTraceLayoutDenseChunksByProcessRef(
  traceGraph: TraceGraph
): ReadonlyMap<ProcessRef, readonly ArrowTraceChunk[]> | null {
  const chunksByProcessRef = new Map<ProcessRef, ArrowTraceChunk[]>();
  for (const chunk of traceGraph.chunks) {
    if (chunk.spanTable.numRows === 0) {
      continue;
    }
    if (chunk.processRefs.length !== 1) {
      return null;
    }
    const processRef = chunk.processRefs[0];
    if (processRef == null) {
      return null;
    }
    const processId = traceGraph.processes[getProcessRefIndex(processRef)]?.processId;
    if (processId == null || chunk.processId !== processId) {
      return null;
    }
    const processChunks = chunksByProcessRef.get(processRef);
    if (processChunks) {
      processChunks.push(chunk);
    } else {
      chunksByProcessRef.set(processRef, [chunk]);
    }
  }
  return chunksByProcessRef;
}

/**
 * Returns whether canonical span sidecars may carry explicit lane metadata.
 *
 * The trusted streamer reads only primary timing/thread columns. A possible user-data lane column
 * keeps the graph on the existing semantic path rather than silently ignoring an explicit lane.
 */
function hasTraceLayoutPotentialSpanLaneMetadata(traceGraph: TraceGraph): boolean {
  return (
    traceGraph.chunks.some(chunk => {
      const spanTable = chunk.spanTable as unknown as {
        getChild(columnName: string): unknown;
      };
      return (
        spanTable.getChild('userDataJson') != null ||
        chunk.spanSidecarTable?.getChild('userDataJson') != null
      );
    }) ||
    Object.values(traceGraph.spanSidecarTableMap ?? {}).some(
      sidecarTable => sidecarTable.getChild('userDataJson') != null
    )
  );
}

/**
 * Returns whether one process chunk carries timing or affinity data outside the primary columns.
 *
 * Direct primary-lane streaming deliberately leaves richer timing envelopes and affinity semantics
 * on the complete source-object path rather than trying to mix row-local branches into its loop.
 *
 * @param traceGraph Runtime graph whose process sidecar fallback may carry richer columns.
 * @param processId Canonical process id owning the candidate chunk.
 * @param chunk Candidate process-scoped canonical chunk.
 * @returns Whether the process needs the complete semantic lane source path.
 */
function hasTraceLayoutDensePrimaryLaneRicherSource(
  traceGraph: Readonly<TraceGraph>,
  processId: TraceProcessId,
  chunk: Readonly<ArrowTraceChunk>
): boolean {
  const spanTable = chunk.spanTable as unknown as {
    getChild(columnName: string): unknown;
  };
  if (
    spanTable.getChild('traceId') != null ||
    spanTable.getChild('trace_id') != null ||
    spanTable.getChild('timingsJson') != null
  ) {
    return true;
  }
  const sidecarTable =
    traceGraph.spanSidecarTableMap?.[processId] ?? chunk.spanSidecarTable ?? null;
  return sidecarTable?.getChild('timings') != null || sidecarTable?.getChild('timingsJson') != null;
}

/**
 * Returns whether one process has explicit span-lane writes that must bypass direct streaming.
 *
 * Lane counts and visible-lane masks do not alter generated assignments and remain safe to apply
 * after the stream. Exact span-lane overrides do alter row values, so the whole process keeps the
 * existing assignment path instead of mixing override writes into the trusted loop.
 *
 * @param threadLaneLayoutMapByRef Optional lane metadata keyed by canonical thread ref.
 * @param process Visible process whose thread metadata is being checked.
 * @returns Whether any process thread carries explicit span-lane assignments.
 */
function hasTraceLayoutDensePrimaryLaneAssignmentOverrides(
  threadLaneLayoutMapByRef: ReadonlyMap<ThreadRef, ThreadLaneMetadata> | undefined,
  process: Readonly<TraceLayoutVisibleProcessMetadata>
): boolean {
  if (!threadLaneLayoutMapByRef) {
    return false;
  }
  for (const threadRef of process.threadRefs) {
    if ((threadLaneLayoutMapByRef.get(threadRef)?.spanLaneAssignments?.length ?? 0) > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Binds aligned null-free primary-lane batches without copying canonical Arrow values.
 *
 * Every hot column must expose matching public data batches with offset-zero Float64/Uint8
 * buffers. Rejecting the complete chunk on one unsupported batch keeps the direct stream free of
 * validity checks and scalar-vector fallbacks.
 *
 * @param chunk Candidate process-scoped canonical span chunk.
 * @returns Borrowed aligned batches, or `null` when the whole chunk needs checked accessors.
 */
function buildTraceLayoutDensePrimaryLaneBatches(
  chunk: Readonly<ArrowTraceChunk>
): readonly TraceLayoutDensePrimaryLaneBatch[] | null {
  const threadRefColumn = chunk.spanTable.getChild('thread_ref');
  const statusCodeColumn = chunk.spanTable.getChild('status_code');
  const startTimeMsColumn = chunk.spanTable.getChild('start_time_ms');
  const endTimeMsColumn = chunk.spanTable.getChild('end_time_ms');
  if (!threadRefColumn || !statusCodeColumn || !startTimeMsColumn || !endTimeMsColumn) {
    return null;
  }

  const threadRefData = getTraceLayoutDensePrimaryLaneColumnData(threadRefColumn);
  const statusCodeData = getTraceLayoutDensePrimaryLaneColumnData(statusCodeColumn);
  const startTimeMsData = getTraceLayoutDensePrimaryLaneColumnData(startTimeMsColumn);
  const endTimeMsData = getTraceLayoutDensePrimaryLaneColumnData(endTimeMsColumn);
  if (
    !threadRefData ||
    !statusCodeData ||
    !startTimeMsData ||
    !endTimeMsData ||
    threadRefData.length !== statusCodeData.length ||
    threadRefData.length !== startTimeMsData.length ||
    threadRefData.length !== endTimeMsData.length
  ) {
    return null;
  }

  const batches: TraceLayoutDensePrimaryLaneBatch[] = [];
  let rowCount = 0;
  for (let batchIndex = 0; batchIndex < threadRefData.length; batchIndex += 1) {
    const threadRef = borrowTraceLayoutDensePrimaryLaneBatchValues(
      threadRefData[batchIndex],
      isTraceLayoutFloat64Array
    );
    const statusCode = borrowTraceLayoutDensePrimaryLaneBatchValues(
      statusCodeData[batchIndex],
      isTraceLayoutUint8Array
    );
    const startTimeMs = borrowTraceLayoutDensePrimaryLaneBatchValues(
      startTimeMsData[batchIndex],
      isTraceLayoutFloat64Array
    );
    const endTimeMs = borrowTraceLayoutDensePrimaryLaneBatchValues(
      endTimeMsData[batchIndex],
      isTraceLayoutFloat64Array
    );
    if (
      !threadRef ||
      !statusCode ||
      !startTimeMs ||
      !endTimeMs ||
      threadRef.length !== statusCode.length ||
      threadRef.length !== startTimeMs.length ||
      threadRef.length !== endTimeMs.length
    ) {
      return null;
    }
    rowCount += threadRef.length;
    if (!Number.isSafeInteger(rowCount) || rowCount > chunk.spanTable.numRows) {
      return null;
    }
    batches.push({
      length: threadRef.length,
      threadRef: threadRef.values,
      statusCode: statusCode.values,
      startTimeMs: startTimeMs.values,
      endTimeMs: endTimeMs.values
    });
  }
  return rowCount === chunk.spanTable.numRows ? batches : null;
}

/**
 * Returns public Arrow data batches from one vector-shaped primary-lane column.
 *
 * @param column Candidate Arrow vector whose primitive data may be borrowed.
 * @returns Public data batches, or `null` when the vector shape is unsupported.
 */
function getTraceLayoutDensePrimaryLaneColumnData(column: {
  get(rowIndex: number): unknown;
}): readonly TraceLayoutDensePrimaryLaneFixedWidthData[] | null {
  const data = (column as TraceLayoutDensePrimaryLaneFixedWidthColumn).data;
  return Array.isArray(data) && data.length > 0 ? data : null;
}

/**
 * Validates and borrows one null-free offset-zero fixed-width primary-lane batch.
 *
 * @param data Public Arrow data record for one candidate primitive batch.
 * @param isValues Predicate for the concrete typed-array class required by this column.
 * @returns Borrowed values and logical length, or `null` for whole-chunk fallback.
 */
function borrowTraceLayoutDensePrimaryLaneBatchValues<Values extends Float64Array | Uint8Array>(
  data: TraceLayoutDensePrimaryLaneFixedWidthData | undefined,
  isValues: (value: unknown) => value is Values
): {readonly length: number; readonly values: Values} | null {
  if (
    !data ||
    !Number.isSafeInteger(data.length) ||
    data.length < 0 ||
    data.offset !== 0 ||
    data.nullCount !== 0 ||
    !isValues(data.values) ||
    data.values.length < data.length
  ) {
    return null;
  }
  return {length: data.length, values: data.values};
}

/**
 * Creates empty interval-partition state for one process-local thread.
 *
 * @returns Mutable build-local lane state discarded after one layout build.
 */
function createTraceLayoutDensePrimaryLaneThreadState(): TraceLayoutDensePrimaryLaneThreadState {
  return {
    spanCount: 0,
    maxLaneIndex: -1,
    laneAssignmentCounts: [],
    previousStartTimeMs: Number.NaN,
    previousEndTimeMs: Number.NaN,
    activeLaneIndexes: [],
    activeLaneEndTimeMs: [],
    availableLaneIndexes: [],
    nextLaneIndex: 0
  };
}

/**
 * Records the earliest primary start needed to anchor one overflow label.
 *
 * The historical label path prefers the earliest lane-zero span and falls back to the earliest
 * visible span only when lane zero is absent. The trusted lane streamer already has both scalars
 * in hand, so retaining two numbers per thread avoids replaying every span during scene prep.
 *
 * @param state Build-local thread lane state receiving the low-cardinality anchor summary.
 * @param startTimeMs Primary timing start read from the current canonical span row.
 * @param laneIndex Generated lane assigned to the current canonical span row.
 */
function recordTraceLayoutDensePrimaryLaneOverflowAnchor(
  state: TraceLayoutDensePrimaryLaneThreadState,
  startTimeMs: number,
  laneIndex: number
): void {
  if (!Number.isFinite(startTimeMs)) {
    return;
  }
  state.minimumStartTimeMs =
    state.minimumStartTimeMs == null
      ? startTimeMs
      : Math.min(state.minimumStartTimeMs, startTimeMs);
  if (laneIndex === 0) {
    state.minimumLaneZeroStartTimeMs =
      state.minimumLaneZeroStartTimeMs == null
        ? startTimeMs
        : Math.min(state.minimumLaneZeroStartTimeMs, startTimeMs);
  }
}

/**
 * Assigns one already-time-sorted finite primary interval to a thread's lowest legal lane.
 *
 * @param state Build-local interval-partition state for one thread.
 * @param startTimeMs Finite canonical primary start time for this row.
 * @param endTimeMs Finite resolved canonical primary end time for this row.
 * @returns Zero-based generated lane index assigned to this row.
 */
function assignTraceLayoutDensePrimaryLane(
  state: TraceLayoutDensePrimaryLaneThreadState,
  startTimeMs: number,
  endTimeMs: number
): number {
  const normalizedEndTimeMs = endTimeMs <= startTimeMs ? startTimeMs + 1 : endTimeMs;
  while (state.activeLaneEndTimeMs.length > 0 && state.activeLaneEndTimeMs[0]! <= startTimeMs) {
    const releasedLane = popTraceLayoutDensePrimaryActiveLane(state);
    if (releasedLane != null) {
      pushTraceLayoutDensePrimaryNumberHeap(state.availableLaneIndexes, releasedLane);
    }
  }

  const availableLane = popTraceLayoutDensePrimaryNumberHeap(state.availableLaneIndexes);
  const laneIndex = availableLane ?? state.nextLaneIndex;
  if (availableLane == null) {
    state.nextLaneIndex += 1;
  }
  pushTraceLayoutDensePrimaryActiveLane(state, laneIndex, normalizedEndTimeMs);
  state.maxLaneIndex = Math.max(state.maxLaneIndex, laneIndex);
  state.laneAssignmentCounts[laneIndex] = (state.laneAssignmentCounts[laneIndex] ?? 0) + 1;
  return laneIndex;
}

/**
 * Pushes one numeric lane index into a min-heap.
 *
 * @param heap Mutable numeric min-heap owned by one thread lane state.
 * @param value Released lane index that can be reused.
 */
function pushTraceLayoutDensePrimaryNumberHeap(heap: number[], value: number): void {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    const parentValue = heap[parentIndex]!;
    if (parentValue <= value) {
      break;
    }
    heap[index] = parentValue;
    index = parentIndex;
  }
  heap[index] = value;
}

/**
 * Pops the lowest numeric lane index from a min-heap.
 *
 * @param heap Mutable numeric min-heap owned by one thread lane state.
 * @returns Lowest released lane index, or `undefined` when none are available.
 */
function popTraceLayoutDensePrimaryNumberHeap(heap: number[]): number | undefined {
  if (heap.length === 0) {
    return undefined;
  }
  const first = heap[0]!;
  const last = heap.pop()!;
  if (heap.length === 0) {
    return first;
  }

  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    if (leftIndex >= heap.length) {
      break;
    }
    const childIndex =
      rightIndex < heap.length && heap[rightIndex]! < heap[leftIndex]! ? rightIndex : leftIndex;
    if (heap[childIndex]! >= last) {
      break;
    }
    heap[index] = heap[childIndex]!;
    index = childIndex;
  }
  heap[index] = last;
  return first;
}

/**
 * Pushes one active lane into parallel end-time/lane min-heaps.
 *
 * @param state Build-local interval-partition state for one thread.
 * @param laneIndex Active generated lane index.
 * @param endTimeMs Normalized finite end time that releases the lane.
 */
function pushTraceLayoutDensePrimaryActiveLane(
  state: TraceLayoutDensePrimaryLaneThreadState,
  laneIndex: number,
  endTimeMs: number
): void {
  state.activeLaneIndexes.push(laneIndex);
  state.activeLaneEndTimeMs.push(endTimeMs);
  let index = state.activeLaneEndTimeMs.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    const parentEndTimeMs = state.activeLaneEndTimeMs[parentIndex]!;
    const parentLaneIndex = state.activeLaneIndexes[parentIndex]!;
    if (
      isTraceLayoutDensePrimaryActiveLaneBefore(
        parentEndTimeMs,
        parentLaneIndex,
        endTimeMs,
        laneIndex
      )
    ) {
      break;
    }
    state.activeLaneEndTimeMs[index] = parentEndTimeMs;
    state.activeLaneIndexes[index] = parentLaneIndex;
    index = parentIndex;
  }
  state.activeLaneEndTimeMs[index] = endTimeMs;
  state.activeLaneIndexes[index] = laneIndex;
}

/**
 * Pops the earliest-ending active lane from parallel end-time/lane min-heaps.
 *
 * @param state Build-local interval-partition state for one thread.
 * @returns Released generated lane index, or `undefined` when no lane is active.
 */
function popTraceLayoutDensePrimaryActiveLane(
  state: TraceLayoutDensePrimaryLaneThreadState
): number | undefined {
  if (state.activeLaneEndTimeMs.length === 0) {
    return undefined;
  }
  const firstLaneIndex = state.activeLaneIndexes[0]!;
  const lastEndTimeMs = state.activeLaneEndTimeMs.pop()!;
  const lastLaneIndex = state.activeLaneIndexes.pop()!;
  if (state.activeLaneEndTimeMs.length === 0) {
    return firstLaneIndex;
  }

  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    if (leftIndex >= state.activeLaneEndTimeMs.length) {
      break;
    }
    const childIndex =
      rightIndex < state.activeLaneEndTimeMs.length &&
      isTraceLayoutDensePrimaryActiveLaneBefore(
        state.activeLaneEndTimeMs[rightIndex]!,
        state.activeLaneIndexes[rightIndex]!,
        state.activeLaneEndTimeMs[leftIndex]!,
        state.activeLaneIndexes[leftIndex]!
      )
        ? rightIndex
        : leftIndex;
    if (
      !isTraceLayoutDensePrimaryActiveLaneBefore(
        state.activeLaneEndTimeMs[childIndex]!,
        state.activeLaneIndexes[childIndex]!,
        lastEndTimeMs,
        lastLaneIndex
      )
    ) {
      break;
    }
    state.activeLaneEndTimeMs[index] = state.activeLaneEndTimeMs[childIndex]!;
    state.activeLaneIndexes[index] = state.activeLaneIndexes[childIndex]!;
    index = childIndex;
  }
  state.activeLaneEndTimeMs[index] = lastEndTimeMs;
  state.activeLaneIndexes[index] = lastLaneIndex;
  return firstLaneIndex;
}

/**
 * Returns whether one active lane sorts before another by end time then lane index.
 *
 * @param leftEndTimeMs Left active lane's normalized release time.
 * @param leftLaneIndex Left active lane's generated lane index.
 * @param rightEndTimeMs Right active lane's normalized release time.
 * @param rightLaneIndex Right active lane's generated lane index.
 * @returns Whether the left active lane belongs earlier in the min-heap.
 */
function isTraceLayoutDensePrimaryActiveLaneBefore(
  leftEndTimeMs: number,
  leftLaneIndex: number,
  rightEndTimeMs: number,
  rightLaneIndex: number
): boolean {
  return (
    leftEndTimeMs < rightEndTimeMs ||
    (leftEndTimeMs === rightEndTimeMs && leftLaneIndex < rightLaneIndex)
  );
}

/** Returns whether one borrowed Arrow value buffer is a Float64Array. */
function isTraceLayoutFloat64Array(value: unknown): value is Float64Array {
  return value instanceof Float64Array;
}

/** Returns whether one borrowed Arrow value buffer is a Uint8Array. */
function isTraceLayoutUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function buildSeparateThreadDescriptorsFromSourceGraph(params: {
  traceGraph: TraceGraph;
  processes: readonly TraceLayoutVisibleProcessMetadata[];
  maxTimeMs: number;
  /** Timeline origin used to turn canonical primary starts into final overflow-label X anchors. */
  minTimeMs: number;
  settings: TrackAggregationSettings;
  layoutConfiguration: ReturnType<typeof getLayoutDensityPreset>;
  /** Optional lane metadata keyed by canonical runtime thread ref. */
  threadLaneLayoutMapByRef?: ReadonlyMap<ThreadRef, ThreadLaneMetadata>;
  /**
   * Optional graph-wide trusted states that keep snapshot-only filtering off visible ref indexes.
   */
  densePrimaryLaneStatesByProcessRef?: ReadonlyMap<
    ProcessRef,
    TraceLayoutDensePrimaryLaneProcessState
  >;
}): SeparateThreadTrackBuildResult {
  const {traceGraph, processes, maxTimeMs, settings} = params;
  const usesManualSpanLayout = traceGraph.spanLayout === 'manual';
  const startTime = performance.now();
  const descriptors: SeparateThreadTrackDescriptor[] = [];
  const rootTrackIds: string[] = [];
  const rankStates: SeparateThreadRankState[] = [];
  const streamStatesByRef = new Map<ThreadRef, SeparateThreadStreamState>();
  const spanLaneColumnsByChunkIndex = usesManualSpanLayout
    ? undefined
    : createTraceLayoutSpanLaneColumns();
  const setSpanLaneIndex = (spanRef: SpanRef, laneIndex: number): void => {
    if (!spanLaneColumnsByChunkIndex) {
      return;
    }
    setTraceLayoutSpanLaneIndex({
      traceGraph,
      spanLaneColumnsByChunkIndex,
      spanRef,
      laneIndex
    });
  };
  let visibleSpanSourceDurationMs = 0;
  let spanBucketingDurationMs = 0;
  let laneAssignmentDurationMs = 0;
  let densePrimaryLaneStreamDurationMs = 0;
  let densePrimaryLaneStreamSpanCount = 0;
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

  for (const [rankIndex, rank] of processes.entries()) {
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

    const visibleSpanSourceStartTime = performance.now();
    const rankSpans = usesManualSpanLayout
      ? getVisibleGeometrySpansForProcess(traceGraph, rank.processRef)
      : [];
    const processDisablesLaneAssignment =
      getTraceGraphProcessLaneAssignmentMode(rank.userData) === 'none';
    const hasDensePrimaryLaneAssignmentOverrides =
      hasTraceLayoutDensePrimaryLaneAssignmentOverrides(params.threadLaneLayoutMapByRef, rank);
    const hasPrimaryLaneExplicitParentHint =
      !usesManualSpanLayout &&
      !processDisablesLaneAssignment &&
      !hasDensePrimaryLaneAssignmentOverrides &&
      params.densePrimaryLaneStatesByProcessRef == null &&
      hasPrimaryLaneExplicitParentHintFromArrow(traceGraph, rank.processId);
    const densePrimaryLaneStreamStartTime = performance.now();
    const densePrimaryLaneState =
      params.densePrimaryLaneStatesByProcessRef?.get(rank.processRef) ??
      (usesManualSpanLayout ||
      processDisablesLaneAssignment ||
      hasDensePrimaryLaneAssignmentOverrides ||
      hasPrimaryLaneExplicitParentHint
        ? null
        : tryBuildTrustedDensePrimaryLaneProcessState({
            traceGraph,
            process: rank,
            maxTimeMs
          }));
    densePrimaryLaneStreamDurationMs += performance.now() - densePrimaryLaneStreamStartTime;
    if (densePrimaryLaneState && spanLaneColumnsByChunkIndex) {
      for (const [chunkIndex, laneColumn] of densePrimaryLaneState.laneColumnsByChunkIndex) {
        spanLaneColumnsByChunkIndex.set(chunkIndex, laneColumn);
      }
      densePrimaryLaneStreamSpanCount += densePrimaryLaneState.rowCount;
    }
    const rankLaneSameProcessDependencies =
      usesManualSpanLayout || densePrimaryLaneState
        ? []
        : getVisibleLaneSameProcessDependenciesForProcess(traceGraph, rank.processRef);
    const rankLaneSpans =
      usesManualSpanLayout || densePrimaryLaneState
        ? []
        : getVisibleLaneSpansForProcess(traceGraph, rank);
    const explicitParentByChild =
      usesManualSpanLayout || densePrimaryLaneState
        ? new Map<SpanRef, SpanRef>()
        : buildExplicitParentSpanMap({
            spans: rankLaneSpans,
            sameProcessDependencies: rankLaneSameProcessDependencies
          });
    visibleSpanSourceDurationMs += performance.now() - visibleSpanSourceStartTime;
    const spanBucketingStartTime = performance.now();
    const threadSpans = densePrimaryLaneState
      ? null
      : new Map<ThreadRef, TraceLayoutLaneSpanSource[]>();
    const threadLayoutSpans = usesManualSpanLayout ? rankSpans : rankLaneSpans;
    const processVisibleSpanCount = densePrimaryLaneState
      ? densePrimaryLaneState.rowCount
      : threadLayoutSpans.length;
    visibleSpanCount += processVisibleSpanCount;
    if (!densePrimaryLaneState) {
      for (const span of threadLayoutSpans) {
        const threadRef =
          !usesManualSpanLayout && span.threadRef != null
            ? span.threadRef
            : traceGraph.getThreadRefBySpanRef(span.spanRef);
        if (threadRef == null) {
          continue;
        }
        const spansForThread = threadSpans?.get(threadRef);
        if (spansForThread) {
          spansForThread.push(span);
        } else {
          threadSpans?.set(threadRef, [span]);
        }
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
      const spansForThread = threadSpans?.get(threadRef) ?? [];
      const densePrimaryLaneThreadState =
        densePrimaryLaneState?.threadStatesByThreadIndex[getThreadRefThreadIndex(threadRef)] ??
        null;
      const densePrimaryOverflowAnchorStartTimeMs =
        densePrimaryLaneThreadState?.minimumLaneZeroStartTimeMs ??
        densePrimaryLaneThreadState?.minimumStartTimeMs;
      const overflowLabelAnchorX =
        densePrimaryOverflowAnchorStartTimeMs == null
          ? undefined
          : Math.fround(densePrimaryOverflowAnchorStartTimeMs - params.minTimeMs);
      const visibleInExpandedLayout = streamIsVisible(thread, settings);
      if (usesManualSpanLayout) {
        const manualContentHeight = getManualThreadContentHeight(
          spansForThread as readonly TraceSpanGeometrySource[],
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
          hasSpanLaneAssignments: false,
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

      const disableLaneAssignment = processDisablesLaneAssignment;
      const laneSpansForThread = spansForThread as readonly TraceLayoutLaneSpanSource[];
      let inferredLaneAssignmentCounts: number[];
      let inferredMaxLane: number;
      if (densePrimaryLaneThreadState) {
        inferredLaneAssignmentCounts = densePrimaryLaneThreadState.laneAssignmentCounts;
        inferredMaxLane = densePrimaryLaneThreadState.maxLaneIndex;
        laneLayoutSpanCount += densePrimaryLaneThreadState.spanCount;
      } else {
        const laneAssignmentStartTime = performance.now();
        inferredLaneAssignmentCounts = [];
        inferredMaxLane = -1;
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
          laneLayoutSpanCount += laneSpansForThread.length;
          const hasSeparateParentHints = hasParentHintsForSpans(
            laneSpansForThread,
            explicitParentByChild
          );
          const hasSeparateLaneAffinity = hasTraceLaneAffinity(laneSpansForThread);
          inferredMaxLane = visitKahnLaneAssignments<TraceLayoutLaneSpanSource>(
            laneSpansForThread,
            {
              ...(hasSeparateParentHints
                ? {
                    getParentSpanRef: (span: TraceLayoutLaneSpanSource) =>
                      explicitParentByChild.get(span.spanRef)
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
        laneAssignmentDurationMs += performance.now() - laneAssignmentStartTime;
      }
      const inferredLaneCount = inferredMaxLane >= 0 ? inferredMaxLane + 1 : 0;
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
      const spanLaneAssignments = laneMetadata?.spanLaneAssignments;
      if (spanLaneAssignments) {
        for (const assignment of spanLaneAssignments) {
          setSpanLaneIndex(assignment.spanRef, assignment.laneIndex);
        }
      }
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
        overflowLabelAnchorX,
        hasSpanLaneAssignments:
          densePrimaryLaneThreadState != null
            ? densePrimaryLaneThreadState.spanCount > 0
            : spansForThread.length > 0,
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
      slowestProcessVisibleSpanCount = processVisibleSpanCount;
      slowestProcessLaneAssignmentDurationMs = processLaneAssignmentDurationMs;
    }
    if (processDurationMs >= TRACE_LAYOUT_SLOW_PROCESS_PROBE_THRESHOLD_MS) {
      log.probe(0, 'buildSeparateThreadDescriptorsFromSourceGraph slow process', {
        graphName: traceGraph.name,
        processId: rank.processId,
        processName: rank.name,
        threadCount: rank.threads.length,
        visibleSpanCount: processVisibleSpanCount,
        descriptorCount: descriptors.length - descriptorCountBeforeProcess,
        laneAssignmentDurationMs: processLaneAssignmentDurationMs,
        durationMs: processDurationMs
      })();
    }
  }

  log.probe(0, 'buildSeparateThreadDescriptorsFromSourceGraph done', {
    graphName: traceGraph.name,
    processCount: processes.length,
    visibleSpanCount,
    descriptorCount: descriptors.length,
    streamCount: streamStatesByRef.size,
    laneLayoutCallCount,
    laneLayoutSpanCount,
    visibleSpanSourceDurationMs,
    spanBucketingDurationMs,
    laneAssignmentDurationMs,
    densePrimaryLaneStreamDurationMs,
    densePrimaryLaneStreamSpanCount,
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
    spanLaneColumnsByChunkIndex,
    streamStatesByRef
  };
}

function buildSeparateThreadDescriptorsFromExpandedLayout(params: {
  traceGraph: TraceGraph;
  processes: readonly TraceLayoutVisibleProcessMetadata[];
  expandedLayout: TraceLayout;
}): SeparateThreadTrackBuildResult {
  const descriptors: SeparateThreadTrackDescriptor[] = [];
  const rootTrackIds: string[] = [];
  const rankStates: SeparateThreadRankState[] = [];
  const streamStatesByRef = new Map<ThreadRef, SeparateThreadStreamState>();

  for (const [rankIndex, rank] of params.processes.entries()) {
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
      const threadSource = params.traceGraph.getThreadSourceByRef(threadRef);
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
        overflowLabelAnchorX: sourceThreadLayout.overflowLabelAnchorX,
        hasSpanLaneAssignments: sourceThreadLayout.hasSpanLaneAssignments === true,
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
    spanLaneColumnsByChunkIndex: params.expandedLayout.spanLaneColumnsByChunkIndex,
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
  streamState: SeparateThreadStreamState;
}): ThreadLayout {
  return {
    threadRef: params.streamState.threadRef,
    visible: false,
    yPosition: HIDDEN_LAYOUT_Y,
    hasSpanLaneAssignments: params.streamState.hasSpanLaneAssignments,
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
  processes: readonly TraceLayoutVisibleProcessMetadata[];
  layoutConfiguration: ReturnType<typeof getLayoutDensityPreset>;
  trackLayout: HierarchicalTrackLayoutResult<SeparateThreadTrackObject>;
  rankStates: readonly SeparateThreadRankState[];
  /** Generated lane columns aligned with canonical Arrow span-table rows. */
  spanLaneColumnsByChunkIndex?: TraceLayoutSpanLaneColumns;
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
        (streamState.usesManualSpanLayout === true || streamState.hasSpanLaneAssignments)
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
          streamState
        });
        threadLayoutMapByRef.set(threadRef, hiddenLayout);
        return hiddenLayout;
      }

      const streamEntry = params.trackLayout.trackLayoutsById[getStreamTrackId(threadRef)];
      const baseStreamY = getTrackEntryYOffset(streamEntry, params.useExpandedOffsets);
      if (!streamEntry || baseStreamY == null) {
        const hiddenLayout = buildHiddenSeparateThreadLayout({
          streamState
        });
        threadLayoutMapByRef.set(threadRef, hiddenLayout);
        return hiddenLayout;
      }

      if (streamState.usesManualSpanLayout) {
        const manualLayout = {
          threadRef: streamState.threadRef,
          visible: true,
          yPosition: baseStreamY + rankDelta,
          manualContentHeight:
            streamState.manualContentHeight ?? params.layoutConfiguration.laneSeparation,
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
        visible: true,
        yPosition: baseStreamY + rankDelta,
        hasSpanLaneAssignments: streamState.hasSpanLaneAssignments,
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
        overflowLabelAnchorX: streamState.overflowLabelAnchorX,
        overflowLabel: undefined
      } satisfies ThreadLayout;

      const overflowLabelStartTime = performance.now();
      const withOverflow = {
        ...visibleLayout,
        overflowLabel: isCollapsed
          ? undefined
          : buildThreadOverflowLabel(visibleLayout, streamState.overflowSpanCount)
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
      contentStartY: visibleThreadLayouts[0]?.yPosition ?? rankStartY,
      label: params.processes[rankState.rankIndex]?.name ?? rankState.processId,
      threadLayouts: threadLayouts.filter((threadLayout): threadLayout is ThreadLayout =>
        Boolean(threadLayout)
      ),
      backgroundPolygonInfinite: new Float32Array() as Float32Array<ArrayBuffer>
    } satisfies ProcessLayout;

    const backgroundGeometryStartTime = performance.now();
    rankLayout.backgroundPolygonInfinite = computeRankBackgroundPolygonInfinite({
      rankLayout,
      threadLayouts: rankLayout.threadLayouts
    }) as Float32Array<ArrayBuffer>;
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
        graphName: params.traceGraph.name,
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
    graphName: params.traceGraph.name,
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
      spanLaneColumnsByChunkIndex: params.spanLaneColumnsByChunkIndex,
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
  processes: readonly TraceLayoutVisibleProcessMetadata[];
  /** Timeline origin used by prepared overflow-label anchors for this graph. */
  minTimeMs: number;
  settings: TrackAggregationSettings;
  layoutConfiguration: ReturnType<typeof getLayoutDensityPreset>;
  /** Optional lane metadata keyed by canonical runtime thread ref. */
  threadLaneLayoutMapByRef?: ReadonlyMap<ThreadRef, ThreadLaneMetadata>;
  /** Optional graph-wide trusted filtered lane states for this build only. */
  densePrimaryLaneStatesByProcessRef?: ReadonlyMap<
    ProcessRef,
    TraceLayoutDensePrimaryLaneProcessState
  >;
  traceGraph: TraceGraph;
}): {traceLayout: TraceLayout; rankSpacings: number[]} {
  const startTime = performance.now();
  const buildState = buildSeparateThreadDescriptorsFromSourceGraph({
    traceGraph: params.traceGraph,
    processes: params.processes,
    maxTimeMs: params.traceGraph.maxTimeMs,
    minTimeMs: params.minTimeMs,
    settings: params.settings,
    layoutConfiguration: params.layoutConfiguration,
    threadLaneLayoutMapByRef: params.threadLaneLayoutMapByRef,
    densePrimaryLaneStatesByProcessRef: params.densePrimaryLaneStatesByProcessRef
  });
  const descriptorDurationMs = performance.now() - startTime;
  const trackLayoutStartTime = performance.now();
  const trackLayout = buildSeparateThreadTrackLayout({
    descriptors: buildState.descriptors,
    rootTrackIds: buildState.rootTrackIds,
    layoutConfiguration: params.layoutConfiguration,
    maxTimeMs: params.traceGraph.maxTimeMs
  });
  const trackLayoutDurationMs = performance.now() - trackLayoutStartTime;
  const materializeStartTime = performance.now();
  const materializedLayout = materializeSeparateThreadLayout({
    processes: params.processes,
    layoutConfiguration: params.layoutConfiguration,
    trackLayout,
    rankStates: buildState.rankStates,
    spanLaneColumnsByChunkIndex: buildState.spanLaneColumnsByChunkIndex,
    streamStatesByRef: buildState.streamStatesByRef,
    traceGraph: params.traceGraph,
    useExpandedOffsets: true,
    showEmptyProcesses: params.settings.showEmptyProcesses
  });
  const layout = materializedLayout.layout;
  const materializeDurationMs = performance.now() - materializeStartTime;
  log.probe(0, 'buildSeparateThreadExpandedLayout done', {
    graphName: params.traceGraph.name,
    processCount: params.processes.length,
    descriptorCount: buildState.descriptors.length,
    descriptorDurationMs,
    trackLayoutDurationMs,
    materializeDurationMs,
    durationMs: performance.now() - startTime,
    ...getHeapUsageProbeFields()
  })();
  return {
    traceLayout: layout,
    rankSpacings: materializedLayout.rankSpacings
  };
}

function applySeparateThreadTrackLayoutCollapseState(params: {
  traceGraph: TraceGraph;
  processes: readonly TraceLayoutVisibleProcessMetadata[];
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
    traceGraph: params.traceGraph,
    processes: params.processes,
    expandedLayout: params.expandedLayout
  });
  const descriptorDurationMs = performance.now() - descriptorStartTime;
  const collapsedTrackIdStartTime = performance.now();
  const collapsedTrackIds = new Set<string>();
  for (const rankId of params.collapsedProcessIds ?? []) {
    collapsedTrackIds.add(getRankTrackId(rankId));
  }
  for (const threadRef of params.collapsedThreadRefs ?? []) {
    if (params.traceGraph.spanLayout === 'manual') {
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
    maxTimeMs: params.traceGraph.maxTimeMs,
    collapsedTrackIds
  });
  const trackLayoutDurationMs = performance.now() - trackLayoutStartTime;
  const materializeStartTime = performance.now();
  const {layout, rankSpacings} = materializeSeparateThreadLayout({
    processes: params.processes,
    layoutConfiguration: getLayoutDensityPreset(params.layoutDensity),
    trackLayout,
    rankStates: buildState.rankStates,
    spanLaneColumnsByChunkIndex: buildState.spanLaneColumnsByChunkIndex,
    streamStatesByRef: buildState.streamStatesByRef,
    traceGraph: params.expandedLayout.traceGraph,
    useExpandedOffsets: false
  });
  const materializeDurationMs = performance.now() - materializeStartTime;
  log.probe(0, 'applySeparateThreadTrackLayoutCollapseState done', {
    graphName: params.traceGraph.name,
    processCount: params.processes.length,
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
  processes: readonly TraceLayoutVisibleProcessMetadata[];
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
  for (const process of params.processes) {
    process.threads.forEach((_thread, threadIndex) => {
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
            visible: false,
            yPosition: HIDDEN_LAYOUT_Y,
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
  traceGraph: TraceGraph;
  processes: readonly TraceLayoutVisibleProcessMetadata[];
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
            processes: params.processes,
            expandedThreadRefs: params.expandedThreadRefs,
            collapsedThreadRefs: params.collapsedThreadRefs
          })
        : params.expandedLayout,
      rankSpacings: [...params.expandedRankSpacings]
    };
  }

  const layoutConfiguration = getLayoutDensityPreset(params.settings.layoutDensity);
  const threadLaneLayoutMapByRef = buildThreadLaneLayoutMapByRef(
    params.traceGraph,
    params.processes,
    params.threadLaneLayoutOverrides
  );
  const collapsedLayoutComputation = calculateTraceLayout({
    processes: params.processes,
    maxTimeMs: params.traceGraph.maxTimeMs,
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
    getLaneSpansForProcess: processId => {
      const process = findTraceLayoutProcessById(params.processes, processId);
      return process ? getVisibleLaneSpansForProcess(params.traceGraph, process) : [];
    },
    getLaneSameProcessDependenciesForProcess: processId => {
      const process = findTraceLayoutProcessById(params.processes, processId);
      return process
        ? getVisibleLaneSameProcessDependenciesForProcess(params.traceGraph, process.processRef)
        : [];
    }
  });
  const collapsedLayout = collapsedLayoutComputation.layout;

  return {
    traceLayout: hasStreamVisibilityOverrides
      ? applyMaskOnlyCombinedThreadStreamCollapseState({
          traceLayout: collapsedLayout,
          processes: params.processes,
          expandedThreadRefs: params.expandedThreadRefs,
          collapsedThreadRefs: params.collapsedThreadRefs
        })
      : collapsedLayout,
    rankSpacings: collapsedLayoutComputation.rankSpacings
  };
}

function applyTraceLayoutCollapseState(params: {
  traceGraph: TraceGraph;
  processes: readonly TraceLayoutVisibleProcessMetadata[];
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
      traceGraph: params.traceGraph,
      processes: params.processes,
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
      traceGraph: params.traceGraph,
      processes: params.processes,
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
  traceGraph: TraceGraph,
  processes: readonly TraceLayoutVisibleProcessMetadata[],
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides
): ReadonlyMap<ThreadRef, ThreadLaneMetadata> | undefined {
  const threadLaneLayoutMapByRef = traceGraph.getVisibleLaneLayoutInfo().threadLaneLayoutMapByRef;
  if (!threadLaneLayoutOverrides) {
    return threadLaneLayoutMapByRef;
  }
  const nextThreadLaneLayoutMapByRef = new Map(threadLaneLayoutMapByRef);
  for (const process of processes) {
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

/** Finds one build-local process metadata row by canonical process id. */
function findTraceLayoutProcessById(
  processes: readonly TraceLayoutVisibleProcessMetadata[],
  processId: string
): TraceLayoutVisibleProcessMetadata | undefined {
  return processes.find(process => process.processId === processId);
}

/** Builds one graph-wide expanded layout without retaining process-local reuse artifacts. */
function buildExpandedTraceLayout(params: {
  /** Visible process metadata laid out together. */
  processes: readonly TraceLayoutVisibleProcessMetadata[];
  /** Layout settings that affect lanes, rows, and process placement. */
  settings: TrackAggregationSettings & Pick<TraceVisSettings, 'layoutDensity'>;
  /** Canonical runtime graph that owns Arrow rows and refs. */
  traceGraph: TraceGraph;
  /** Timeline origin used by prepared overflow-label anchors for this graph. */
  minTimeMs: number;
  /** Optional per-stream lane focus overrides used by interactive lane hiding. */
  threadLaneLayoutOverrides?: ThreadLaneLayoutOverrides;
  /** Optional graph-wide trusted filtered lane states for this build only. */
  densePrimaryLaneStatesByProcessRef?: ReadonlyMap<
    ProcessRef,
    TraceLayoutDensePrimaryLaneProcessState
  >;
}): {traceLayout: TraceLayout; rankSpacings: number[]} {
  const layoutConfiguration = getLayoutDensityPreset(params.settings.layoutDensity);
  const threadLaneLayoutMapByRef =
    params.densePrimaryLaneStatesByProcessRef == null
      ? buildThreadLaneLayoutMapByRef(
          params.traceGraph,
          params.processes,
          params.threadLaneLayoutOverrides
        )
      : undefined;

  if (params.settings.trackAggregationMode === 'combine-threads') {
    const result = calculateTraceLayout({
      processes: params.processes,
      maxTimeMs: params.traceGraph.maxTimeMs,
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
      traceGraph: params.traceGraph,
      getLaneSpansForProcess: processId => {
        const process = findTraceLayoutProcessById(params.processes, processId);
        return process ? getVisibleLaneSpansForProcess(params.traceGraph, process) : [];
      },
      getLaneSameProcessDependenciesForProcess: processId => {
        const process = findTraceLayoutProcessById(params.processes, processId);
        return process
          ? getVisibleLaneSameProcessDependenciesForProcess(params.traceGraph, process.processRef)
          : [];
      }
    });
    return {
      traceLayout: result.layout,
      rankSpacings: result.rankSpacings
    };
  }

  return buildSeparateThreadExpandedLayout({
    processes: params.processes,
    minTimeMs: params.minTimeMs,
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
    densePrimaryLaneStatesByProcessRef: params.densePrimaryLaneStatesByProcessRef,
    traceGraph: params.traceGraph
  });
}

export function buildTraceLayouts(params: {
  /** Canonical runtime graphs whose current filter state is used for layout. */
  traceGraphs: Readonly<TraceGraph[]>;
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
    | 'sameProcessDependencyMode'
    | 'layoutDensity'
    | 'processLayoutMode'
    | 'trackAggregationMode'
    | 'showEmptyProcesses'
  > & {showGlobalEvents?: boolean};
  layoutMode?: TraceLayoutMode;
  /** Ref-native collapse state aligned to the input graph list. */
  collapseState?: TraceLayoutCollapseState;
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
  const sourceGraphsToLayout =
    layoutMode === 'step1' ? params.traceGraphs.slice(0, 1) : params.traceGraphs;
  if (sourceGraphsToLayout.length === 0) {
    return [];
  }
  log.probe(1, 'buildTraceLayouts start', {
    graphCount: sourceGraphsToLayout.length,
    layoutMode,
    buildMinimapLayouts: params.buildMinimapLayouts === true,
    totalSpanCount: sourceGraphsToLayout.reduce(
      (count, traceGraph) => count + (traceGraph.stats?.spanCount ?? 0),
      0
    )
  })();
  const collapsedComputationStartTime = performance.now();
  let maskNativeDensePlanDurationMs = 0;
  let processProjectionDurationMs = 0;
  let expandedLayoutDurationMs = 0;
  let collapseLayoutDurationMs = 0;
  const collapsedComputation = sourceGraphsToLayout.map((traceGraph, index) => {
    const geometryMinTimeMs =
      getTraceLayoutGeometryMinTimeMs({
        graphCount: sourceGraphsToLayout.length,
        traceGraph,
        minTimeMs: params.minTimeMs
      }) ?? traceGraph.minTimeMs;
    const aggregationMode = getEffectiveTrackAggregationMode(
      traceGraph,
      params.settings.trackAggregationMode
    );
    const maskNativeDensePlanStartTime = performance.now();
    const maskNativeDensePlan = tryBuildTraceLayoutMaskNativeDensePlan({
      traceGraph,
      aggregationMode,
      threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
    });
    maskNativeDensePlanDurationMs += performance.now() - maskNativeDensePlanStartTime;
    const processProjectionStartTime = performance.now();
    const processes = maskNativeDensePlan?.processes ?? buildTraceLayoutProcesses(traceGraph);
    processProjectionDurationMs += performance.now() - processProjectionStartTime;
    const resolvedCollapseState = resolveTraceGraphCollapseState({
      traceGraph,
      collapseState: params.collapseState?.graphs[index]
    });
    const layoutSettings = {
      threadDisplayMode: params.settings.threadDisplayMode,
      selectedThreadNames: params.settings.selectedThreadNames,
      sortThreads: params.settings.sortThreads,
      layoutDensity: params.settings.layoutDensity,
      maxVisibleLanesPerThread: params.settings.maxVisibleLanesPerThread,
      maxVisibleLanesUnlimited: params.settings.maxVisibleLanesUnlimited,
      trackAggregationMode: aggregationMode,
      showEmptyProcesses: params.settings.showEmptyProcesses
    };
    const expandedLayoutStartTime = performance.now();
    const expandedState = buildExpandedTraceLayout({
      processes,
      settings: layoutSettings,
      traceGraph,
      minTimeMs: geometryMinTimeMs,
      threadLaneLayoutOverrides: params.threadLaneLayoutOverrides,
      densePrimaryLaneStatesByProcessRef: maskNativeDensePlan?.densePrimaryLaneStatesByProcessRef
    });
    const graphExpandedLayoutDurationMs = performance.now() - expandedLayoutStartTime;
    expandedLayoutDurationMs += graphExpandedLayoutDurationMs;
    const hasCollapseOverrides =
      (resolvedCollapseState.collapsedProcessIds?.size ?? 0) > 0 ||
      (resolvedCollapseState.expandedThreadRefs?.size ?? 0) > 0 ||
      (resolvedCollapseState.collapsedThreadRefs?.size ?? 0) > 0;
    const collapseLayoutStartTime = performance.now();
    const collapsedState = hasCollapseOverrides
      ? applyTraceLayoutCollapseState({
          traceGraph,
          processes,
          expandedLayout: expandedState.traceLayout,
          expandedRankSpacings: expandedState.rankSpacings,
          aggregationMode,
          settings: layoutSettings,
          collapsedProcessIds: resolvedCollapseState.collapsedProcessIds,
          expandedThreadRefs: resolvedCollapseState.expandedThreadRefs,
          collapsedThreadRefs: resolvedCollapseState.collapsedThreadRefs,
          threadLaneLayoutOverrides: params.threadLaneLayoutOverrides
        })
      : expandedState;
    const graphCollapseLayoutDurationMs = performance.now() - collapseLayoutStartTime;
    collapseLayoutDurationMs += graphCollapseLayoutDurationMs;
    log.probe(1, 'buildTraceLayouts graph layout done', {
      graphIndex: index,
      graphName: traceGraph.name,
      processCount: processes.length,
      spanCount: traceGraph.stats.spanCount,
      hasCollapseOverrides,
      expandedLayoutDurationMs: graphExpandedLayoutDurationMs,
      collapseLayoutDurationMs: graphCollapseLayoutDurationMs
    })();

    return {
      traceGraph,
      traceLayout: collapsedState.traceLayout,
      rankSpacings: collapsedState.rankSpacings,
      processes,
      expandedLayout: expandedState.traceLayout,
      aggregationMode,
      geometryMinTimeMs
    };
  });
  const collapsedComputationDurationMs = performance.now() - collapsedComputationStartTime;

  const interGraphRankDeltaStartTime = performance.now();
  const effectiveLayoutMode = layoutMode === 'interleaved' ? 'interleaved' : 'sequential';
  const rankDeltas =
    effectiveLayoutMode === 'interleaved'
      ? computeInterleavedRankDeltas(
          collapsedComputation.map(computation => ({
            processes: computation.processes,
            layout: computation.traceLayout,
            rankSpacings: computation.rankSpacings
          }))
        )
      : computeSequentialRankDeltas(
          collapsedComputation.map(computation => ({
            processes: computation.processes,
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
      processes: computation.processes,
      rankDeltas: rankDeltasForGraph,
      trackAggregationMode: computation.aggregationMode
    });
    finalRankDeltaDurationMs += performance.now() - finalRankDeltaStartTime;
    const resolvedLayout = {
      ...adjustedLayout,
      layoutConfiguration: {
        laneSeparation:
          adjustedLayout.layoutConfiguration?.laneSeparation ??
          getLayoutDensityPreset(params.settings.layoutDensity).laneSeparation,
        spanHeight: getLayoutDensityPreset(params.settings.layoutDensity).spanHeight,
        minTimeMs: computation.geometryMinTimeMs,
        timingKey: params.timingKey
      },
      currentBounds: computeTraceLayoutBounds({
        traceLayout: adjustedLayout,
        minTimeMs: computation.traceGraph.minTimeMs,
        maxTimeMs: computation.traceGraph.maxTimeMs
      })
    } satisfies TraceLayout;
    const buildRowsStartTime = performance.now();
    const renderRows = buildTraceLayoutRows({
      processes: computation.processes,
      processLayouts: resolvedLayout.processLayouts
    });
    const buildRowsDurationMs = performance.now() - buildRowsStartTime;
    const refIndexStartTime = performance.now();
    const updatedLayout = withTraceLayoutRefIndexes({
      traceGraph: computation.traceGraph,
      traceLayout: {
        ...resolvedLayout,
        renderRows,
        globalEventRow:
          globalEventRowHeight > 0
            ? {
                yPosition: topPadding - globalEventRowHeight * 0.5
              }
            : undefined
      } satisfies TraceLayout
    });
    const refIndexDurationMs = performance.now() - refIndexStartTime;

    updatedLayouts.push(updatedLayout);
    layoutFinalizeDurationMs += performance.now() - layoutFinalizeStartTime;
    log.probe(1, 'buildTraceLayouts finalize layout done', {
      graphIndex: index,
      graphName: computation.traceGraph.name,
      processCount: resolvedLayout.processLayouts.length,
      renderRowCount: renderRows.length,
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
    log.probe(1, 'buildTraceLayouts minimap attach done', {
      graphCount: layoutsWithMinimap.length,
      durationMs: minimapDurationMs,
      ...getHeapUsageProbeFields()
    })();
  }

  log.probe(0, 'buildTraceLayouts done', {
    graphCount: layoutsWithMinimap.length,
    layoutMode,
    maskNativeDensePlanDurationMs,
    processProjectionDurationMs,
    expandedLayoutDurationMs,
    collapseLayoutDurationMs,
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
  /** Canonical runtime graph whose current filter state is used for layout. */
  traceGraph: TraceGraph;
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
    | 'sameProcessDependencyMode'
    | 'layoutDensity'
    | 'processLayoutMode'
    | 'trackAggregationMode'
    | 'showEmptyProcesses'
  > & {showGlobalEvents?: boolean};
  /** Ref-native collapse state for this single graph layout. */
  collapseState?: TraceLayoutCollapseState;
  layoutMode?: TraceLayoutMode;
}): TraceLayout {
  const layouts = buildTraceLayouts({
    traceGraphs: [params.traceGraph],
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
  /** Ref-native collapse state to preserve during relayout. */
  collapseState?: TraceLayoutCollapseState;
  /** Optional timing projection recorded for later prepared geometry derivation. */
  timingKey?: string | null;
  /** Optional minimum time override recorded for later prepared geometry derivation. */
  minTimeMs?: number;
}): TraceLayout {
  const resolvedCollapseState = resolveTraceGraphCollapseState({
    traceGraph: params.traceGraph,
    collapseState: params.collapseState?.graphs[0]
  });
  return buildTraceLayoutForSpanRefsImpl({
    ...params,
    collapseState: resolvedCollapseState,
    refreshGeometryInputs: rebuildTraceLayoutGeometry,
    withRefIndexes: traceLayout =>
      withTraceLayoutRefIndexes({traceGraph: params.traceGraph, traceLayout})
  });
}

export function rebuildTraceLayoutGeometry(params: {
  /** Canonical runtime graph that owns the layout's source rows and time extents. */
  traceGraph: TraceGraph;
  traceLayout: TraceLayout;
  settings: Pick<TraceVisSettings, 'sameProcessDependencyMode' | 'layoutDensity'>;
  timingKey?: string | null;
  minTimeMs?: number;
}): TraceLayout {
  const resolvedTraceGraph = params.traceGraph;
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
  return withTraceLayoutRefIndexes({
    traceGraph: resolvedTraceGraph,
    traceLayout: {
      ...rebuiltLayout,
      minimapLayout: params.traceLayout.minimapLayout
    } satisfies TraceLayout
  });
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
