import {findArrowTraceChunkByIndex} from '../ingestion/arrow-trace';
import {iterateTraceGraphProcessSpanRefs} from '../trace-graph-accessors';
import {TRACE_SPAN_FILTER_MASK_NONE} from '../trace-graph/trace-graph-types';
import {getSpanRefChunkIndex, getSpanRefRowIndex} from '../trace-graph/trace-id-encoder';
import {getTraceViewSpanFilterMask} from '../trace-view-snapshot';
import {
  buildTraceLayoutGeometryDerivationContext,
  fillTraceLayoutSpanGeometry,
  getTraceLayoutSpanVisibility as resolveTraceLayoutSpanVisibility
} from './trace-derived-geometry';

import type {ArrowTraceProcessMetadata} from '../ingestion/arrow-trace';
import type {TraceGraph} from '../trace-graph/trace-graph';
import type {ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
import type {
  SpanRef,
  TraceProcess,
  TraceSpan,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {TraceLayoutGeometryDerivationContext} from './trace-derived-geometry';

export {
  fillTraceLayoutCrossProcessDependencyGeometry,
  fillTraceLayoutSameProcessDependencyGeometry,
  fillTraceLayoutSpanGeometry
} from './trace-derived-geometry';

export type TraceLayoutBounds = readonly [[number, number], [number, number]];

/** Sentinel stored in generated lane columns when one span has no lane in the current layout. */
export const INVALID_TRACE_LAYOUT_SPAN_LANE_INDEX = -1;

/** One generated lane column aligned with canonical Arrow span-table rows. */
export type TraceLayoutSpanLaneColumn = {
  /** Generated lane values aligned by canonical Arrow span-table row. */
  readonly values: Int32Array;
};

/** Generated lane columns keyed by canonical Arrow span-table chunk index. */
export type TraceLayoutSpanLaneColumns = ReadonlyMap<number, TraceLayoutSpanLaneColumn>;

/** One preserved generated-lane assignment used while rebuilding a focused layout. */
export type TraceLayoutSpanLaneAssignment = {
  /** Exact runtime span ref whose source lane should be preserved. */
  readonly spanRef: SpanRef;
  /** Zero-based generated lane index preserved for that span. */
  readonly laneIndex: number;
};

/** Creates empty generated lane-column storage for one auto-layout trace. */
export function createTraceLayoutSpanLaneColumns(): Map<number, TraceLayoutSpanLaneColumn> {
  return new Map();
}

/** Copies one generated lane column for isolated layout/test mutation. */
export function cloneTraceLayoutSpanLaneColumn(
  laneColumn: TraceLayoutSpanLaneColumn
): TraceLayoutSpanLaneColumn {
  return {
    values: laneColumn.values.slice()
  };
}

/**
 * Stores one generated lane in the layout-owned column aligned with the span's source table row.
 *
 * The first span assigned in a chunk allocates one `Int32Array` for that chunk, so steady-state
 * per-span writes use the packed `SpanRef` chunk/row pair without a per-span `Map`.
 */
export function setTraceLayoutSpanLaneIndex(params: {
  /** Trace graph whose canonical chunk row count sizes a lazily allocated lane column. */
  readonly traceGraph: Pick<TraceGraph, 'chunks'>;
  /** Mutable generated lane columns owned by the layout currently being built. */
  readonly spanLaneColumnsByChunkIndex: Map<number, TraceLayoutSpanLaneColumn>;
  /** Exact runtime span ref whose generated lane should be written. */
  readonly spanRef: SpanRef;
  /** Zero-based generated lane index assigned to the span. */
  readonly laneIndex: number;
}): void {
  const laneIndex = Math.floor(params.laneIndex);
  if (!Number.isFinite(laneIndex) || laneIndex < 0) {
    throw new Error(`TraceLayout lane index must be a finite non-negative integer: ${laneIndex}`);
  }

  const chunkIndex = getSpanRefChunkIndex(params.spanRef);
  const rowIndex = getSpanRefRowIndex(params.spanRef);
  let laneColumn = params.spanLaneColumnsByChunkIndex.get(chunkIndex);
  if (!laneColumn) {
    const chunk = findArrowTraceChunkByIndex(params.traceGraph.chunks, chunkIndex);
    if (!chunk) {
      throw new Error(`TraceLayout span lane assignment references missing chunk ${chunkIndex}`);
    }
    const values = new Int32Array(chunk.spanTable.numRows);
    values.fill(INVALID_TRACE_LAYOUT_SPAN_LANE_INDEX);
    laneColumn = {
      values
    };
    params.spanLaneColumnsByChunkIndex.set(chunkIndex, laneColumn);
  }
  if (rowIndex < 0 || rowIndex >= laneColumn.values.length) {
    throw new Error(`TraceLayout span lane assignment references missing row ${rowIndex}`);
  }
  laneColumn.values[rowIndex] = laneIndex;
}

/** Returns one generated lane from layout-owned span-table-aligned columns. */
export function getTraceLayoutSpanLaneIndexFromColumns(
  spanLaneColumnsByChunkIndex: TraceLayoutSpanLaneColumns | undefined,
  spanRef: SpanRef
): number | undefined {
  const laneColumn = spanLaneColumnsByChunkIndex?.get(getSpanRefChunkIndex(spanRef));
  const rowIndex = getSpanRefRowIndex(spanRef);
  const laneIndex = laneColumn?.values[rowIndex];
  return laneIndex != null && laneIndex >= 0 ? laneIndex : undefined;
}

/** Returns one generated lane for a span in the current layout. */
export function getTraceLayoutSpanLaneIndex(
  traceLayout: Pick<TraceLayout, 'spanLaneColumnsByChunkIndex'>,
  spanRef: SpanRef
): number | undefined {
  return getTraceLayoutSpanLaneIndexFromColumns(traceLayout.spanLaneColumnsByChunkIndex, spanRef);
}

/** Returns whether one span has a generated lane in the current layout. */
export function hasTraceLayoutSpanLaneIndex(
  traceLayout: Pick<TraceLayout, 'spanLaneColumnsByChunkIndex'>,
  spanRef: SpanRef
): boolean {
  return getTraceLayoutSpanLaneIndex(traceLayout, spanRef) != null;
}

export type TraceLayoutSourceProcess = Pick<
  TraceProcess,
  | 'processId'
  | 'name'
  | 'rankNum'
  | 'threads'
  | 'threadMap'
  | 'sameProcessDependencies'
  | 'userData'
> & {
  /** Visible spans represented by this layout row source. */
  spans: TraceSpan[];
};

export type TraceLayoutVisibleProcessMetadata = Pick<
  ArrowTraceProcessMetadata,
  'processId' | 'name' | 'rankNum' | 'threads' | 'userData'
> & {
  /** Optional visual process order; falls back to rankNum when absent. */
  readonly processOrder?: number;
  /** Canonical runtime process ref for the visible process row. */
  readonly processRef: ProcessRef;
  /** Canonical runtime thread refs aligned to `threads`. */
  readonly threadRefs: readonly ThreadRef[];
};

export type TraceProcessActivityInterval = {
  /** Left X edge of the visible activity interval in trace-local milliseconds. */
  readonly startX: number;
  /** Right X edge of the visible activity interval in trace-local milliseconds. */
  readonly endX: number;
  /** Activity magnitude used by density summaries and as a fallback weight. */
  readonly activity: number;
  /** Optional RGB fill color sampled from the representative span. */
  readonly color?: Readonly<[number, number, number]>;
  /** Optional vertical offset from the collapsed activity baseline for icicle summaries. */
  readonly yOffset?: number;
  /** Optional explicit rectangle height for icicle summaries. */
  readonly height?: number;
};

/** Process collapse state keyed by graph-local runtime process refs. */
export type TraceProcessCollapseState = {
  /** Graph-local process refs whose rows should be collapsed. */
  readonly collapsedProcessRefs: ReadonlySet<ProcessRef>;
};

/** Thread collapse state keyed by graph-local runtime thread refs. */
export type TraceThreadCollapseState = {
  /** Graph-local thread refs whose rows should be collapsed unless explicitly expanded. */
  readonly collapsedThreadRefs: ReadonlySet<ThreadRef>;
  /** Graph-local thread refs whose rows should be expanded over default lane collapse state. */
  readonly expandedThreadRefs: ReadonlySet<ThreadRef>;
};

/** Collapse state for one trace graph layout input. */
export type TraceGraphCollapseState = TraceProcessCollapseState & TraceThreadCollapseState;

/** Collapse state for one or more trace graphs, aligned to layout graph index. */
export type TraceLayoutCollapseState = {
  /** Per-graph collapse states aligned with `buildTraceLayouts` graph inputs. */
  readonly graphs: readonly TraceGraphCollapseState[];
};

/** Serialized process collapse state keyed by ingestion process ids. */
export type SerializedTraceProcessCollapseState = {
  /** Ingestion process ids whose rows should be collapsed. */
  readonly collapsedProcessIds: readonly string[];
};

/** Serialized thread collapse state keyed by ingestion thread ids. */
export type SerializedTraceThreadCollapseState = {
  /** Ingestion thread ids whose rows should be collapsed unless explicitly expanded. */
  readonly collapsedThreadIds: readonly TraceThreadId[];
  /** Ingestion thread ids whose rows should be expanded over default lane collapse state. */
  readonly expandedThreadIds: readonly TraceThreadId[];
};

/** Serialized collapse state for one trace graph. */
export type SerializedTraceGraphCollapseState = SerializedTraceProcessCollapseState &
  SerializedTraceThreadCollapseState;

/** Serializes graph-local runtime collapse refs into ingestion ids for storage edges. */
export function serializeTraceGraphCollapseState(
  traceGraph: TraceGraphCollapseStateSource,
  state: TraceGraphCollapseState
): SerializedTraceGraphCollapseState {
  const collapsedProcessIds: string[] = [];
  for (const processRef of state.collapsedProcessRefs) {
    const processId = getTraceGraphCollapseProcessId(traceGraph, processRef);
    if (processId) {
      collapsedProcessIds.push(processId);
    }
  }
  const collapsedThreadIds: TraceThreadId[] = [];
  for (const threadRef of state.collapsedThreadRefs) {
    const threadId = traceGraph.getThreadSourceByRef(threadRef)?.threadId;
    if (threadId) {
      collapsedThreadIds.push(threadId);
    }
  }
  const expandedThreadIds: TraceThreadId[] = [];
  for (const threadRef of state.expandedThreadRefs) {
    const threadId = traceGraph.getThreadSourceByRef(threadRef)?.threadId;
    if (threadId) {
      expandedThreadIds.push(threadId);
    }
  }

  return {
    collapsedProcessIds,
    collapsedThreadIds,
    expandedThreadIds
  };
}

/** Deserializes ingestion ids into graph-local runtime collapse refs, pruning stale ids. */
export function deserializeTraceGraphCollapseState(
  traceGraph: TraceGraphCollapseStateSource,
  serialized: SerializedTraceGraphCollapseState
): TraceGraphCollapseState {
  const collapsedProcessIdSet = new Set(serialized.collapsedProcessIds);
  const collapsedThreadIdSet = new Set(serialized.collapsedThreadIds);
  const expandedThreadIdSet = new Set(serialized.expandedThreadIds);
  const collapsedProcessRefs = new Set<ProcessRef>();
  const collapsedThreadRefs = new Set<ThreadRef>();
  const expandedThreadRefs = new Set<ThreadRef>();

  for (const processRef of traceGraph.getProcessRefs()) {
    const processId = getTraceGraphCollapseProcessId(traceGraph, processRef);
    if (processId && collapsedProcessIdSet.has(processId)) {
      collapsedProcessRefs.add(processRef);
    }
  }

  for (const threadRef of traceGraph.getThreadRefs()) {
    const threadId = traceGraph.getThreadSourceByRef(threadRef)?.threadId;
    if (!threadId) {
      continue;
    }
    if (collapsedThreadIdSet.has(threadId)) {
      collapsedThreadRefs.add(threadRef);
    }
    if (expandedThreadIdSet.has(threadId)) {
      expandedThreadRefs.add(threadRef);
    }
  }

  return {
    collapsedProcessRefs,
    collapsedThreadRefs,
    expandedThreadRefs
  };
}

export type TraceLayoutRow = {
  /** Identifies the primary rank represented by this rendered row. */
  readonly processId: string;
  /** Canonical runtime process ref for the rendered row. */
  readonly processRef: ProcessRef;
  /** Canonical runtime thread refs aligned to `threads`. */
  readonly threadRefs: readonly ThreadRef[];
  /** Stores the stable row index within the current rendered layout. */
  readonly rankIndex: number;
  /** Stores the label rendered for this row. */
  readonly name: string;
  /** Stores the primary rank number represented by this row. */
  readonly rankNum: number;
  /** Carries the visible threads rendered within this row. */
  readonly threads: readonly TraceThread[];
  /** Indicates whether the rendered row is currently collapsed. */
  readonly isCollapsed: boolean;
};

export type TraceLayoutGlobalEventRow = {
  /** Stable Y position used to render graph-global events. */
  readonly yPosition: number;
};

export type TraceMinimapLayout = {
  /** Collapsed process overview layout used for the minimap trace activity layer. */
  readonly traceLayout: TraceLayout;
  /** Bounds used to fit the minimap viewport without recomputing layout in React. */
  readonly bounds: TraceLayoutBounds;
};

/** Bit constants used by layout span visibility sidecars. */
export const traceLayoutSpanVisibilityFlags = {
  /** Span is visible in the current layout. */
  none: 0,
  /** Span belongs to a lane excluded by focused lane visibility. */
  laneHidden: 1 << 0,
  /** Span belongs to an overflow lane hidden by max visible lane limits. */
  laneOverflow: 1 << 1,
  /** Span belongs to a collapsed thread row and is not rendered by that collapse mode. */
  threadCollapsed: 1 << 2,
  /** Span belongs to a thread row hidden by display settings or missing layout metadata. */
  threadHidden: 1 << 3,
  /** Span belongs to a collapsed process row. */
  processCollapsed: 1 << 4
} as const;

/** Non-zero flag value from `traceLayoutSpanVisibilityFlags`. */
export type TraceLayoutSpanVisibilityFlag = Exclude<
  (typeof traceLayoutSpanVisibilityFlags)[keyof typeof traceLayoutSpanVisibilityFlags],
  typeof traceLayoutSpanVisibilityFlags.none
>;

declare const traceLayoutSpanVisibilityMaskBrand: unique symbol;

/** Bitmask composed from `traceLayoutSpanVisibilityFlags` values. */
export type TraceLayoutSpanVisibilityMask = number & {
  /** Prevents accidental use of arbitrary numbers as visibility masks. */
  readonly [traceLayoutSpanVisibilityMaskBrand]: true;
};

/** Layout-specific visibility state for one span. */
export type TraceLayoutSpanVisibility = {
  /** Whether this span has renderable geometry in the current layout. */
  readonly visible: boolean;
  /** Bitmask explaining which layout state hides the span. */
  readonly visibilityFlags: TraceLayoutSpanVisibilityMask;
};

/** Returns a branded layout span visibility mask from one or more flags. */
export function getTraceLayoutSpanVisibilityMask(
  flags: readonly TraceLayoutSpanVisibilityFlag[]
): TraceLayoutSpanVisibilityMask {
  return flags.reduce((mask, flag) => mask | flag, 0) as TraceLayoutSpanVisibilityMask;
}

/** Resolves layout-specific visibility for one span ref from current lane state. */
export function getTraceLayoutSpanVisibility(params: {
  /** Layout whose lane state should resolve span visibility. */
  traceLayout: Readonly<TraceLayout>;
  /** Exact visible span ref whose layout visibility should be resolved. */
  spanRef: SpanRef;
  /** Optional batch-scoped lane lookup reused across visibility reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): TraceLayoutSpanVisibility | undefined {
  return resolveTraceLayoutSpanVisibility(params);
}

/** Resolves layout-specific visibility flags for one span ref from current lane state. */
export function getTraceLayoutSpanVisibilityFlags(params: {
  /** Layout containing current lane visibility state. */
  traceLayout: Readonly<TraceLayout>;
  /** Exact visible span ref whose layout visibility flags should be read. */
  spanRef: SpanRef;
  /** Optional batch-scoped lane lookup reused across visibility reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): TraceLayoutSpanVisibilityMask | undefined {
  return getTraceLayoutSpanVisibility(params)?.visibilityFlags;
}

/** Returns whether a visibility mask contains a specific layout visibility flag. */
export function hasTraceLayoutSpanVisibilityFlag(
  mask: TraceLayoutSpanVisibilityMask,
  flag: TraceLayoutSpanVisibilityFlag
): boolean {
  return (mask & flag) !== 0;
}

/** Returns whether a layout span visibility mask represents visible geometry. */
export function isTraceLayoutSpanVisible(mask: TraceLayoutSpanVisibilityMask): boolean {
  return mask === traceLayoutSpanVisibilityFlags.none;
}

/** Number of float coordinates in one derived layout geometry tuple. */
export const TRACE_LAYOUT_GEOMETRY_WIDTH = 4;

/** Mutable geometry scratch object used by allocation-free layout geometry accessors. */
export type TraceLayoutGeometryTuple = {
  /** First X coordinate, usually the left edge or dependency source X. */
  x1: number;
  /** First Y coordinate, usually the top edge or dependency source Y. */
  y1: number;
  /** Second X coordinate, usually the right edge or dependency target X. */
  x2: number;
  /** Second Y coordinate, usually the bottom edge or dependency target Y. */
  y2: number;
};

export type TraceLayout = {
  /** Filter state for this layout, derived from the immutable source graph. */
  readonly traceGraph: TraceGraph;
  /** Layout configuration snapshot kept for render-time derivations. */
  readonly layoutConfiguration?: TraceLayoutRenderConfiguration;
  /**
   * Generated lane columns aligned with canonical span-table rows by packed `SpanRef` chunk/row.
   * Undefined for manual span layouts, whose authored Y coordinates already define row structure.
   */
  readonly spanLaneColumnsByChunkIndex?: TraceLayoutSpanLaneColumns;

  /** List of layouts for all processes in the trace graph */
  readonly processLayouts: readonly ProcessLayout[];
  /** Process layouts keyed by exact graph-local process refs. */
  readonly processLayoutMapByRef: ReadonlyMap<ProcessRef, ProcessLayout>;
  /** Canonical stable row model used by legend and deck layer builders. */
  readonly renderRows: readonly TraceLayoutRow[];
  /** Optional dedicated row reserved for graph-global events. */
  readonly globalEventRow?: TraceLayoutGlobalEventRow;
  /** Optional precomputed collapsed process overview layout for the minimap. */
  readonly minimapLayout?: TraceMinimapLayout;
  /** Layout for individual streams keyed by canonical runtime thread ref. */
  readonly threadLayoutMapByRef: ReadonlyMap<ThreadRef, ThreadLayout>;
  /** Bounds for the current layout state, including collapsed ranks/streams */
  readonly currentBounds: TraceLayoutBounds;
};

/** Minimal TraceGraph surface needed to translate collapse refs at serialization boundaries. */
type TraceGraphCollapseStateSource = Pick<
  TraceGraph,
  'processes' | 'getProcessRefs' | 'getThreadRefs' | 'getThreadSourceByRef'
>;

/** Resolves one graph-local process ref to its ingestion process id. */
function getTraceGraphCollapseProcessId(
  traceGraph: TraceGraphCollapseStateSource,
  processRef: ProcessRef
): string | null {
  const processIndex = traceGraph.getProcessRefs().indexOf(processRef);
  return traceGraph.processes[processIndex]?.processId ?? null;
}

type TraceLayoutRowBlockSource = {
  /** Exact runtime span ref used for geometry lookup. */
  readonly spanRef?: SpanRef;
  /** Ingestion thread id used to anchor overflow labels to the first visible lane. */
  readonly threadId: TraceThreadId;
};

type TraceLayoutProcessBlocksListSource = {
  /** Process rows that may already carry concrete block arrays. */
  readonly processes: readonly Pick<TraceProcess, 'processId' | 'spans'>[];
};

/** Label metadata for collapsed or overflowed thread rows. */
export type ThreadOverflowLabel = {
  /** Display text rendered for the overflow or filtered-span notice. */
  text: string;
  /** Timeline X position where the label should begin. */
  x: number;
  /** Timeline Y position for the label baseline. */
  y: number;
};

export type TraceLayoutOverflowLabelDatum = {
  /** Overflow label text anchored in trace coordinates. */
  readonly text: string;
  /** Timeline X origin where the label is anchored. */
  readonly x: number;
  /** Timeline Y position for the label. */
  readonly y: number;
  /** Rightmost visible X bound available to the label within the timeline row. */
  readonly maxX: number;
};

export type TraceLayoutRenderConfiguration = {
  /** Vertical distance between rendered lane baselines for this layout. */
  readonly laneSeparation: number;
  /** Rectangle height derived from the active layout density. */
  readonly spanHeight?: number;
  /** Timeline origin subtracted from inherent span timing for rendered X coordinates. */
  readonly minTimeMs?: number;
  /** Optional timing projection selected for inherent span timing. */
  readonly timingKey?: string | null;
};

/** Geometry and row metadata for one rendered process/rank band. */
export type ProcessLayout = {
  /** Exact graph-local process ref owning this rendered process/rank band. */
  readonly processRef: ProcessRef;
  /** Top Y coordinate of the process/rank band in the trace graph. */
  yOffset: number;
  /** Height from `yOffset` to the bottom of the process/rank band. */
  yHeight: number;
  /** Precomputed Y position for the rank label inside the process/rank band. */
  labelY: number;
  /** Y position used to render collapsed activity intervals. */
  collapsedActivityY: number;
  /** Whether this rank is currently collapsed. */
  isCollapsed?: boolean;
  /** Background polygon that spans an infinite width for the rank band. */
  backgroundPolygonInfinite: Float32Array;
  /** First content-row Y anchor preserved for filtered-label placement. */
  contentStartY: number;
  /** Optional label override for the rendered rank row. */
  label?: string;
  /** List of streams in this rank. */
  threadLayouts: ThreadLayout[];
};

/** Lane layout metadata for one rendered thread row. */
export type ThreadLaneLayout = {
  /** Total number of lanes assigned before overflow hiding or explicit compaction. */
  laneCount: number;
  /** Number of lanes used for rendering spans. Hidden-overflow lanes are not rendered. */
  renderedLaneCount?: number;
  /** Optional explicit lane indices to render while hiding all other lanes. */
  visibleLaneIndices?: number[];
  /** Whether this thread row is currently collapsed. */
  isCollapsed: boolean;
  /** Y positions for rendered lane baselines. */
  laneYPositions: number[];
  /** Collapse rendering strategy used by the lane renderer. */
  collapseMode?: 'top-only' | 'stack-all';
};

/** Persistable lane assignment metadata for one thread row. */
export type ThreadLaneMetadata = {
  /** Total number of lanes assigned to the thread row. */
  laneCount: number;
  /** Optional preserved lane assignments copied into layout-owned lane columns during rebuild. */
  spanLaneAssignments?: readonly TraceLayoutSpanLaneAssignment[];
  /** Optional explicit lane indices to render while hiding all other lanes. */
  visibleLaneIndices?: number[];
  /** Whether this thread row should be rendered collapsed. */
  isCollapsed?: boolean;
};

/** Render geometry and lane metadata for one thread row. */
export type ThreadLayout = {
  /** Canonical runtime thread ref for this rendered thread row when available. */
  threadRef?: ThreadRef;
  /** Whether the thread row should be rendered. */
  visible: boolean;
  /** Y position of the stream in the trace graph. */
  yPosition: number;
  /**
   * Thread-relative vertical extent reserved for author-provided manual span geometry.
   * Undefined for generated-lane layouts.
   */
  manualContentHeight?: number;
  /** Whether this generated thread row owns at least one span lane assignment. */
  hasSpanLaneAssignments?: boolean;
  /** Optional lane layout details for span geometry within this thread row. */
  lanes?: ThreadLaneLayout;
  /** Count of hidden spans due to lane depth cap. */
  overflowSpanCount?: number;
  /**
   * Optional precomputed main-view X anchor for this row's overflow label.
   *
   * Generated primary-lane layouts derive this while they already stream canonical timing and
   * lane columns. Keeping the low-cardinality anchor on the thread row avoids a second all-span
   * geometry scan when prepared rows only need to place one label.
   */
  overflowLabelAnchorX?: number;
  /** Optional overflow or filtered-span label for this thread row. */
  overflowLabel?: ThreadOverflowLabel;
};

/** Builds row-local lane-overflow labels using the resolved trace layout state. */
export function buildTraceLayoutRowOverflowLabels(params: {
  /** Trace layout with resolved lane state and optional source graph. */
  traceLayout: TraceLayout;
  /** Stable rendered row metadata for which labels are being built. */
  row: TraceLayoutRow;
  /** Optional batch-scoped direct geometry lookup state for repeated span resolution. */
  geometryContext?: TraceLayoutGeometryDerivationContext;
}): readonly TraceLayoutOverflowLabelDatum[] {
  const rankLayout = getTraceLayoutProcessLayoutByRef(params.traceLayout, params.row.processRef);
  if (!rankLayout || rankLayout.isCollapsed === true) {
    return [];
  }

  const timelineMaxX = params.traceLayout.currentBounds[1][0];
  const overflowLabelData: TraceLayoutOverflowLabelDatum[] = [];
  let geometryContext = params.geometryContext;
  let spans: readonly TraceLayoutRowBlockSource[] | null = null;
  let spansByThreadId: Record<string, TraceLayoutRowBlockSource[]> | null = null;
  for (let index = 0; index < rankLayout.threadLayouts.length; index += 1) {
    const threadLayout = rankLayout.threadLayouts[index]!;
    const overflowLabel = threadLayout.visible ? threadLayout.overflowLabel : undefined;
    if (!overflowLabel || !(threadLayout.overflowSpanCount && threadLayout.overflowSpanCount > 0)) {
      continue;
    }

    if (
      params.traceLayout.layoutConfiguration?.timingKey == null &&
      Number.isFinite(threadLayout.overflowLabelAnchorX)
    ) {
      const resolvedX = threadLayout.overflowLabelAnchorX!;
      overflowLabelData.push({
        text: overflowLabel.text,
        x: resolvedX,
        y: overflowLabel.y,
        maxX: Math.max(resolvedX, timelineMaxX)
      });
      continue;
    }

    if (spans == null) {
      spans = getTraceLayoutRowBlocks(params.traceLayout, params.row);
    }
    const thread = params.row.threads[index];
    let candidateBlocks: readonly TraceLayoutRowBlockSource[];
    if (rankLayout.threadLayouts.length === 1 && params.row.threads.length > 1) {
      candidateBlocks = spans;
    } else if (thread) {
      if (spansByThreadId == null) {
        spansByThreadId = buildTraceLayoutRowBlocksByThreadId(spans);
      }
      candidateBlocks = spansByThreadId[thread.threadId] ?? [];
    } else {
      candidateBlocks = [];
    }
    const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    let anchoredX: number | undefined;
    let fallbackAnchoredX: number | undefined;
    for (const block of candidateBlocks) {
      const spanRef = block.spanRef;
      if (spanRef != null && geometryContext == null) {
        geometryContext = buildTraceLayoutGeometryDerivationContext(params.traceLayout);
      }
      if (
        spanRef == null ||
        !fillTraceLayoutSpanGeometry({
          traceLayout: params.traceLayout,
          spanRef,
          target: geometry,
          context: geometryContext
        }) ||
        !Number.isFinite(geometry.x1)
      ) {
        continue;
      }

      fallbackAnchoredX =
        fallbackAnchoredX == null ? geometry.x1 : Math.min(fallbackAnchoredX, geometry.x1);
      const laneIndex = getTraceLayoutSpanLaneIndex(params.traceLayout, spanRef) ?? 0;
      if (laneIndex === 0) {
        anchoredX = anchoredX == null ? geometry.x1 : Math.min(anchoredX, geometry.x1);
      }
    }
    const resolvedX = anchoredX ?? fallbackAnchoredX ?? overflowLabel.x;

    overflowLabelData.push({
      text: overflowLabel.text,
      x: resolvedX,
      y: overflowLabel.y,
      maxX: Math.max(resolvedX, timelineMaxX)
    });
  }

  return overflowLabelData;
}

/**
 * Returns whether the provided value exposes process rows that already carry concrete block arrays.
 */
function hasTraceLayoutProcessBlocksListSource(
  traceGraph: unknown
): traceGraph is Readonly<TraceLayoutProcessBlocksListSource> {
  return traceGraph != null && typeof traceGraph === 'object' && 'processes' in traceGraph;
}

/**
 * Returns the visible span geometry sources associated with a rendered trace-layout row.
 */
function getTraceLayoutRowBlocks(
  traceLayout: TraceLayout,
  row: TraceLayoutRow
): readonly TraceLayoutRowBlockSource[] {
  const traceGraph = traceLayout.traceGraph as unknown;
  const maskNativeBlocks = getTraceLayoutMaskNativeRowBlocks(traceGraph, row);
  if (maskNativeBlocks) {
    return maskNativeBlocks;
  }
  if (hasTraceLayoutProcessBlocksListSource(traceGraph)) {
    return traceGraph.processes.find(process => process.processId === row.processId)?.spans ?? [];
  }
  return [];
}

/**
 * Reads runtime row blocks from canonical process refs and snapshot masks.
 *
 * Overflow-label anchoring only needs span refs and thread ids. Snapshot filters are row-local, so
 * this path avoids asking the compatibility visible index to restate every visible span. Unfiltered
 * runtime graphs have null masks and take the same canonical iteration path.
 */
function getTraceLayoutMaskNativeRowBlocks(
  traceGraph: unknown,
  row: TraceLayoutRow
): readonly TraceLayoutRowBlockSource[] | null {
  if (!hasTraceLayoutMaskNativeRowBlockSource(traceGraph)) {
    return null;
  }

  const blocks: TraceLayoutRowBlockSource[] = [];
  for (const spanRef of iterateTraceGraphProcessSpanRefs(traceGraph, row.processId)) {
    if (
      getTraceViewSpanFilterMask(traceGraph.traceViewSnapshot, spanRef) !==
      TRACE_SPAN_FILTER_MASK_NONE
    ) {
      continue;
    }
    const threadId = traceGraph.getSpanStreamId(spanRef);
    if (threadId != null) {
      blocks.push({spanRef, threadId});
    }
  }
  return blocks;
}

/**
 * Returns whether one layout graph exposes the canonical fields needed by row-local mask scans.
 */
function hasTraceLayoutMaskNativeRowBlockSource(traceGraph: unknown): traceGraph is TraceGraph {
  return (
    traceGraph != null &&
    typeof traceGraph === 'object' &&
    'traceViewSnapshot' in traceGraph &&
    'chunks' in traceGraph &&
    Array.isArray(traceGraph.chunks) &&
    'processSpanTableMap' in traceGraph &&
    'processes' in traceGraph &&
    Array.isArray(traceGraph.processes) &&
    'getSpanStreamId' in traceGraph &&
    typeof traceGraph.getSpanStreamId === 'function'
  );
}

/**
 * Groups row-local visible spans by thread id only when overflow-label anchoring needs it.
 */
function buildTraceLayoutRowBlocksByThreadId(
  blocks: readonly TraceLayoutRowBlockSource[]
): Record<string, TraceLayoutRowBlockSource[]> {
  const blocksByThreadId: Record<string, TraceLayoutRowBlockSource[]> = {};
  for (const block of blocks) {
    const existingBlocks = blocksByThreadId[block.threadId];
    if (existingBlocks) {
      existingBlocks.push(block);
    } else {
      blocksByThreadId[block.threadId] = [block];
    }
  }
  return blocksByThreadId;
}

/**
 * Derives the vertical extent of a trace layout from its visible structural bands.
 */
export function getTraceLayoutVerticalBounds(traceLayout: TraceLayout): [number, number] {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const rankLayout of traceLayout.processLayouts) {
    if (!rankLayout) {
      continue;
    }
    if (!Number.isFinite(rankLayout.yOffset) || !Number.isFinite(rankLayout.yHeight)) {
      continue;
    }
    minY = Math.min(minY, rankLayout.yOffset);
    maxY = Math.max(maxY, rankLayout.yOffset + rankLayout.yHeight);
  }

  if (Number.isFinite(minY) && Number.isFinite(maxY)) {
    return [minY, maxY];
  }

  minY = Number.POSITIVE_INFINITY;
  maxY = Number.NEGATIVE_INFINITY;

  for (const threadLayout of new Set(traceLayout.threadLayoutMapByRef.values())) {
    if (!threadLayout.visible) {
      continue;
    }

    const laneYPositions = threadLayout.lanes?.laneYPositions;
    if (laneYPositions?.length) {
      for (const laneY of laneYPositions) {
        minY = Math.min(minY, laneY);
        maxY = Math.max(maxY, laneY);
      }
      continue;
    }

    if (Number.isFinite(threadLayout.yPosition)) {
      minY = Math.min(minY, threadLayout.yPosition);
      maxY = Math.max(
        maxY,
        threadLayout.yPosition + Math.max(0, threadLayout.manualContentHeight ?? 0)
      );
    }
  }

  if (Number.isFinite(minY) && Number.isFinite(maxY)) {
    return [minY, maxY];
  }

  return [0, 0];
}

/**
 * Computes trace-layout bounds from structural Y layout plus a canonical graph-wide time span.
 */
export function getTraceLayoutBoundsFromStructure(params: {
  /** Trace layout with resolved structural Y positions. */
  traceLayout: TraceLayout;
  /** Canonical graph minimum time used as the X origin. */
  minTimeMs: number;
  /** Canonical graph maximum time used to size the X span. */
  maxTimeMs: number;
}): TraceLayoutBounds {
  const [minY, maxY] = getTraceLayoutVerticalBounds(params.traceLayout);
  return [
    [0, minY],
    [Math.max(0, params.maxTimeMs - params.minTimeMs), maxY]
  ];
}

/** Builds the canonical lightweight row model used by layout-aware UI consumers. */
export function buildTraceLayoutRows(params: {
  /** Process metadata aligned to the supplied rank layouts. */
  processes: readonly TraceLayoutVisibleProcessMetadata[];
  /** Process/rank layouts that define render row order. */
  processLayouts: readonly ProcessLayout[];
}): readonly TraceLayoutRow[] {
  const {processes, processLayouts} = params;
  if (processLayouts.length === 0) {
    return [];
  }

  const rows: TraceLayoutRow[] = [];
  const processByRef = new Map(processes.map(process => [process.processRef, process] as const));
  for (let rankIndex = 0; rankIndex < processLayouts.length; rankIndex += 1) {
    const processLayout = processLayouts[rankIndex];
    if (!processLayout) {
      continue;
    }
    const primaryProcess = processByRef.get(processLayout.processRef);
    if (!primaryProcess) {
      continue;
    }
    const threads = primaryProcess.threads;
    const fallbackRankId = primaryProcess.processId;

    rows.push({
      processId: fallbackRankId,
      processRef: processLayout.processRef,
      threadRefs: primaryProcess.threadRefs,
      rankIndex,
      name: processLayout.label ?? primaryProcess.name ?? fallbackRankId,
      rankNum: primaryProcess.rankNum,
      threads,
      isCollapsed: processLayout.isCollapsed ?? false
    });
  }
  return rows;
}

/** Builds exact process-ref ownership lookup for one rendered process layout list. */
export function buildTraceLayoutProcessLayoutMapByRef(
  processLayouts: readonly ProcessLayout[]
): ReadonlyMap<ProcessRef, ProcessLayout> {
  const processLayoutMapByRef = new Map<ProcessRef, ProcessLayout>();
  for (const processLayout of processLayouts) {
    if (!processLayout) {
      continue;
    }
    processLayoutMapByRef.set(processLayout.processRef, processLayout);
  }
  return processLayoutMapByRef;
}

/** Resolves one rendered process layout by exact ref from the canonical layout row list. */
export function getTraceLayoutProcessLayoutByRef(
  traceLayout: Pick<TraceLayout, 'processLayouts'>,
  processRef: ProcessRef
): ProcessLayout | undefined {
  return traceLayout.processLayouts.find(processLayout => processLayout?.processRef === processRef);
}
