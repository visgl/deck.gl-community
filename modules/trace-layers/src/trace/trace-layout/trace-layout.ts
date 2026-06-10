import * as arrow from 'apache-arrow';

import {
  encodeCrossDependencyRef,
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  getCrossDependencyRefChunkIndex,
  getCrossDependencyRefRowIndex,
  getLocalDependencyRefProcessIndex,
  getLocalDependencyRefRowIndex,
  getSpanRefChunkIndex,
  getSpanRefRowIndex,
  getTraceRefKind,
  getVisibleCrossDependencyRefIndex,
  getVisibleLocalDependencyRefIndex
} from '../trace-graph/trace-id-encoder';

import type {ArrowTraceProcessMetadata, TraceGraphData} from '../ingestion/arrow-trace';
import type {TraceCrossDependencySource} from '../trace-graph-accessors';
import type {TraceGraph} from '../trace-graph/trace-graph';
import type {
  CrossDependencyRef,
  LocalDependencyRef,
  ProcessRef,
  ThreadRef,
  TraceDependencyRef,
  VisibleCrossDependencyRef,
  VisibleLocalDependencyRef
} from '../trace-graph/trace-id-encoder';
import type {
  SpanRef,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';

export type TraceLayoutBounds = readonly [[number, number], [number, number]];

export type TraceLayoutSourceProcess = Pick<
  TraceProcess,
  'processId' | 'name' | 'rankNum' | 'threads' | 'threadMap' | 'localDependencies' | 'userData'
> & {
  /** Visible spans represented by this layout row source. */
  spans: TraceSpan[];
};

export type TraceLayoutVisibleProcessMetadata = Pick<
  ArrowTraceProcessMetadata,
  'processId' | 'name' | 'rankNum' | 'threads' | 'threadMap' | 'userData'
> & {
  /** Optional visual process order; falls back to rankNum when absent. */
  readonly processOrder?: number;
  /** Canonical runtime process ref for the visible process row. */
  readonly processRef?: ProcessRef;
  /** Canonical runtime thread refs aligned to `threads` when available. */
  readonly threadRefs?: readonly ThreadRef[];
};

export type TraceLayoutVisibleGraph = {
  /** Stores the visible graph label used by layout and diagnostics. */
  readonly name: string;
  /** Stores the canonical minimum time used for geometry normalization. */
  readonly minTimeMs: number;
  /** Stores the canonical maximum time used for geometry normalization. */
  readonly maxTimeMs: number;
  /** Keeps the filtered source graph used for visible block and dependency lookup. */
  readonly traceGraph: Readonly<TraceGraph>;
  /** Stores visible per-process rows used by layout and diagnostics. */
  readonly processes: readonly TraceLayoutVisibleProcessMetadata[];
  /** Stores visible cross-process dependencies for the current filtered view. */
  readonly crossDependencies: readonly TraceCrossDependencySource[];
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
  /** Canonical runtime process ref for the rendered row when available. */
  readonly processRef?: ProcessRef;
  /** Canonical runtime thread refs aligned to `threads` when available. */
  readonly threadRefs?: readonly ThreadRef[];
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
  /** Height reserved for the graph-global event row. */
  readonly height: number;
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

/** Resolves layout-specific visibility for one span ref from the layout sidecar. */
export function getTraceLayoutSpanVisibility(params: {
  /** Layout containing span visibility sidecars. */
  traceLayout: Readonly<TraceLayout>;
  /** Exact visible span ref whose layout visibility should be read. */
  spanRef: SpanRef;
}): TraceLayoutSpanVisibility | undefined {
  return params.traceLayout.spanVisibilityMapBySpanRef?.get(params.spanRef);
}

/** Resolves layout-specific visibility flags for one span ref from the layout sidecar. */
export function getTraceLayoutSpanVisibilityFlags(params: {
  /** Layout containing span visibility sidecars. */
  traceLayout: Readonly<TraceLayout>;
  /** Exact visible span ref whose layout visibility flags should be read. */
  spanRef: SpanRef;
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

/** Number of float coordinates stored for one layout geometry row. */
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

/** Arrow table containing one fixed-width geometry column. */
export type TraceLayoutGeometryTable = arrow.Table<{
  /** Row-aligned `[x1, y1, x2, y2]` geometry. */
  geometry: arrow.FixedSizeList<arrow.Float32>;
}>;

/** Mutable layout geometry column backed by one contiguous Float32 buffer. */
export type TraceLayoutGeometryColumn = {
  /** Mutable row-major geometry values, four floats per row. */
  readonly values: Float32Array;
  /** Fixed-size Arrow list view over `values`. */
  readonly table: TraceLayoutGeometryTable;
};

/** Span layout geometry chunk backed by one fixed-width Arrow geometry column. */
export type TraceLayoutSpanGeometryChunk = TraceLayoutGeometryColumn;

/** Dependency layout geometry chunk backed by one fixed-width Arrow geometry column. */
export type TraceLayoutDependencyGeometryChunk = TraceLayoutGeometryColumn;

/** Reusable geometry generated for one visible process in a TraceLayout. */
export type TraceLayoutProcessGeometryCacheEntry = {
  /** Process id that owns these process-local geometry columns. */
  readonly processId: string;
  /** Canonical runtime process ref that owns these process-local geometry columns when available. */
  readonly processRef?: ProcessRef;
  /** Absolute X offset used to translate otherwise unchanged process geometry. */
  readonly geometryXOffset?: number;
  /** Absolute process Y offset used to translate otherwise unchanged process geometry. */
  readonly geometryYOffset?: number;
  /** Cheap no-filter fingerprint for reusing process-local geometry before scanning spans. */
  readonly fastReuseKey?: string | null;
  /** Fingerprint for process-local geometry-affecting inputs. */
  readonly reuseKey: string;
  /** Span geometry chunks produced while building this process, keyed by encoded span chunk. */
  readonly spanGeometryChunks?: readonly TraceLayoutSpanGeometryChunk[];
  /** Local dependency geometry chunks produced while building this process, keyed by process index. */
  readonly localDependencyGeometryChunks?: readonly TraceLayoutDependencyGeometryChunk[];
};

/** Reusable TraceLayout geometry cache carried on immutable layout outputs. */
export type TraceLayoutGeometryCache = {
  /** Reusable process-local geometry artifacts keyed by process id. */
  readonly processesById: Readonly<Record<string, TraceLayoutProcessGeometryCacheEntry>>;
  /** Reusable span geometry chunks keyed by encoded span chunk. */
  readonly spanGeometryChunks: readonly TraceLayoutSpanGeometryChunk[];
  /** Reusable local dependency geometry chunks keyed by encoded local-dependency process index. */
  readonly localDependencyGeometryChunks: readonly TraceLayoutDependencyGeometryChunk[];
  /** Reusable cross dependency geometry chunks keyed by encoded cross-dependency chunk. */
  readonly crossDependencyGeometryChunks: readonly TraceLayoutDependencyGeometryChunk[];
  /** Fingerprints for canonical cross-dependency geometry keyed by visible dependency ref. */
  readonly crossDependencyReuseKeyByVisibleRef: ReadonlyMap<
    TraceDependencyRef | VisibleCrossDependencyRef,
    string
  >;
};

export type TraceLayout = {
  /** Filter state for this layout, derived from the immutable source graph. */
  readonly traceGraph: TraceGraph;
  /** Layout configuration snapshot kept for render-time derivations. */
  readonly layoutConfiguration?: TraceLayoutRenderConfiguration;

  /** List of layouts for all processes in the trace graph */
  readonly processLayouts: readonly ProcessLayout[];
  /** Canonical stable row model used by legend and deck layer builders. */
  readonly renderRows: readonly TraceLayoutRow[];
  /** Optional dedicated row reserved for graph-global events. */
  readonly globalEventRow?: TraceLayoutGlobalEventRow;
  /** Optional precomputed collapsed process overview layout for the minimap. */
  readonly minimapLayout?: TraceMinimapLayout;
  /** Layout for individual streams */
  readonly threadLayoutMap: Readonly<Record<TraceThreadId, ThreadLayout>>;
  /** Layout for individual streams keyed by canonical runtime thread ref. */
  readonly threadLayoutMapByRef?: ReadonlyMap<ThreadRef, ThreadLayout>;
  /** Span geometry chunks keyed by encoded span chunk. */
  readonly spanGeometryChunks?: readonly TraceLayoutSpanGeometryChunk[];
  /** Layout-specific span visibility keyed by exact span refs. */
  readonly spanVisibilityMapBySpanRef?: ReadonlyMap<SpanRef, TraceLayoutSpanVisibility>;
  /** Local dependency geometry chunks keyed by encoded local-dependency process index. */
  readonly localDependencyGeometryChunks?: readonly TraceLayoutDependencyGeometryChunk[];
  /** Cross dependency geometry chunks keyed by encoded cross-dependency chunk. */
  readonly crossDependencyGeometryChunks?: readonly TraceLayoutDependencyGeometryChunk[];
  /** Optional reusable geometry cache used by future layout rebuilds. */
  readonly geometryCache?: TraceLayoutGeometryCache;
  /** Precomputed overflow notices for legend/overlay rendering. */
  readonly overflowLabels: readonly ThreadOverflowLabel[];
  /** Bounds for the current layout state, including collapsed ranks/streams */
  readonly currentBounds: TraceLayoutBounds;
  /** Bounds assuming all ranks/streams are expanded */
  readonly expandedBounds: TraceLayoutBounds;
};

/** Builds a layout geometry column backed by one mutable row-major Float32 buffer. */
export function buildTraceLayoutGeometryColumn(values: Float32Array): TraceLayoutGeometryColumn {
  if (values.length % TRACE_LAYOUT_GEOMETRY_WIDTH !== 0) {
    throw new Error(`Geometry buffer length must be divisible by ${TRACE_LAYOUT_GEOMETRY_WIDTH}`);
  }
  const child = arrow.makeData({
    type: new arrow.Float32(),
    length: values.length,
    nullCount: 0,
    data: values
  });
  const vector = arrow.makeVector(
    arrow.makeData({
      type: new arrow.FixedSizeList(
        TRACE_LAYOUT_GEOMETRY_WIDTH,
        new arrow.Field('item', new arrow.Float32(), false)
      ),
      length: values.length / TRACE_LAYOUT_GEOMETRY_WIDTH,
      nullCount: 0,
      child
    })
  ) as arrow.Vector<arrow.FixedSizeList<arrow.Float32>>;

  return {
    values,
    table: new arrow.Table({geometry: vector}) as TraceLayoutGeometryTable
  };
}

/** Creates a zero-filled mutable geometry column for the requested row count. */
export function createTraceLayoutGeometryColumn(rowCount: number): TraceLayoutGeometryColumn {
  return buildTraceLayoutGeometryColumn(
    new Float32Array(Math.max(0, rowCount) * TRACE_LAYOUT_GEOMETRY_WIDTH)
  );
}

/** Copies one span geometry row into a caller-owned target object. */
export function fillTraceLayoutSpanGeometry(params: {
  /** Layout containing geometry chunks. */
  traceLayout: Readonly<TraceLayout>;
  /** Runtime span ref to resolve. */
  spanRef: SpanRef;
  /** Mutable target object that receives geometry coordinates. */
  target: TraceLayoutGeometryTuple;
}): boolean {
  const chunkIndex = getSpanRefChunkIndex(params.spanRef);
  const rowIndex = getSpanRefRowIndex(params.spanRef);
  const column = params.traceLayout.spanGeometryChunks?.[chunkIndex];
  return fillTraceLayoutGeometryTupleFromColumn(column, rowIndex, params.target);
}

/** Copies one local dependency geometry row into a caller-owned target object. */
export function fillTraceLayoutLocalDependencyGeometry(params: {
  /** Layout containing geometry chunks. */
  traceLayout: Readonly<TraceLayout>;
  /** Runtime local dependency ref to resolve. */
  dependencyRef: TraceDependencyRef | VisibleLocalDependencyRef;
  /** Mutable target object that receives geometry coordinates. */
  target: TraceLayoutGeometryTuple;
}): boolean {
  const ref =
    getTraceRefKind(params.dependencyRef) === 'localDependency'
      ? (params.dependencyRef as LocalDependencyRef)
      : getTraceLayoutCanonicalLocalDependencyRef(params.traceLayout, params.dependencyRef);
  if (
    ref != null &&
    fillTraceLayoutLocalDependencyGeometryByRef(params.traceLayout, ref, params.target)
  ) {
    return true;
  }
  const visibleRef =
    getTraceRefKind(params.dependencyRef) === 'visibleLocalDependency'
      ? (params.dependencyRef as VisibleLocalDependencyRef)
      : null;
  if (
    visibleRef != null &&
    fillTraceLayoutSyntheticLocalDependencyGeometryByRef(
      params.traceLayout,
      visibleRef,
      params.target
    )
  ) {
    return true;
  }
  return fillTraceLayoutGeometryTupleFromArray(undefined, params.target);
}

/** Copies one cross dependency geometry row into a caller-owned target object. */
export function fillTraceLayoutCrossDependencyGeometry(params: {
  /** Layout containing graph-level cross-dependency geometry. */
  traceLayout: Readonly<TraceLayout>;
  /** Runtime cross dependency ref to resolve. */
  dependencyRef: TraceDependencyRef | VisibleCrossDependencyRef;
  /** Mutable target object that receives geometry coordinates. */
  target: TraceLayoutGeometryTuple;
}): boolean {
  const ref =
    getTraceRefKind(params.dependencyRef) === 'crossDependency'
      ? (params.dependencyRef as CrossDependencyRef)
      : getTraceLayoutCanonicalCrossDependencyRef(params.traceLayout, params.dependencyRef);
  if (
    ref != null &&
    fillTraceLayoutCrossDependencyGeometryByRef(params.traceLayout, ref, params.target)
  ) {
    return true;
  }
  const visibleRef =
    getTraceRefKind(params.dependencyRef) === 'visibleCrossDependency'
      ? (params.dependencyRef as VisibleCrossDependencyRef)
      : null;
  if (
    visibleRef != null &&
    fillTraceLayoutSyntheticCrossDependencyGeometryByRef(
      params.traceLayout,
      visibleRef,
      params.target
    )
  ) {
    return true;
  }
  return fillTraceLayoutGeometryTupleFromArray(undefined, params.target);
}

type TraceLayoutFilteredSpanCountSource = {
  /** Returns whether the source graph currently has an active span filter. */
  hasActiveSpanFilter(): boolean;
  /** Returns filtered span counts keyed by canonical runtime thread refs when available. */
  getFilteredSpanCountByThreadRef?: () => ReadonlyMap<ThreadRef, number>;
  /** Returns filtered span counts keyed by ingestion thread ids for legacy test doubles. */
  getFilteredSpanCountByThreadId?: () => Readonly<Partial<Record<TraceThreadId, number>>>;
};

type TraceLayoutVisibleProcessRenderSpansSource = Pick<
  TraceGraph,
  'getSpanStreamId' | 'getVisibleProcessRenderSpans'
>;

/** Minimal TraceGraph surface needed to translate collapse refs at serialization boundaries. */
type TraceGraphCollapseStateSource = Pick<
  TraceGraph,
  'processes' | 'getProcessRefs' | 'getThreadRefs' | 'getThreadSourceByRef'
>;

/** Copies one fixed-width geometry row from a layout column into a mutable target. */
function fillTraceLayoutGeometryTupleFromColumn(
  column: TraceLayoutGeometryColumn | undefined,
  rowIndex: number,
  target: TraceLayoutGeometryTuple
): boolean {
  if (!column || rowIndex < 0 || rowIndex >= column.values.length / TRACE_LAYOUT_GEOMETRY_WIDTH) {
    return fillTraceLayoutGeometryTupleFromArray(undefined, target);
  }
  const offset = rowIndex * TRACE_LAYOUT_GEOMETRY_WIDTH;
  const x1 = column.values[offset] ?? 0;
  const y1 = column.values[offset + 1] ?? 0;
  const x2 = column.values[offset + 2] ?? 0;
  const y2 = column.values[offset + 3] ?? 0;
  if (x1 === 0 && y1 === 0 && x2 === 0 && y2 === 0) {
    return fillTraceLayoutGeometryTupleFromArray(undefined, target);
  }
  target.x1 = x1;
  target.y1 = y1;
  target.x2 = x2;
  target.y2 = y2;
  return true;
}

function fillTraceLayoutLocalDependencyGeometryByRef(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: LocalDependencyRef,
  target: TraceLayoutGeometryTuple
): boolean {
  const processIndex = getLocalDependencyRefProcessIndex(dependencyRef);
  const rowIndex = getLocalDependencyRefRowIndex(dependencyRef);
  const column = traceLayout.localDependencyGeometryChunks?.[processIndex];
  return fillTraceLayoutGeometryTupleFromColumn(column, rowIndex, target);
}

function fillTraceLayoutSyntheticLocalDependencyGeometryByRef(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: VisibleLocalDependencyRef,
  target: TraceLayoutGeometryTuple
): boolean {
  const syntheticRef = encodeLocalDependencyRef(
    encodeLocalSpanRef(0, getVisibleLocalDependencyRefIndex(dependencyRef))
  );
  const chunkIndex =
    getTraceLayoutSyntheticLocalDependencyChunkOffset(traceLayout) +
    getLocalDependencyRefProcessIndex(syntheticRef);
  return fillTraceLayoutGeometryTupleFromColumn(
    traceLayout.localDependencyGeometryChunks?.[chunkIndex],
    getLocalDependencyRefRowIndex(syntheticRef),
    target
  );
}

/** Returns the first chunk index reserved for visible-only local-dependency geometry. */
function getTraceLayoutSyntheticLocalDependencyChunkOffset(
  traceLayout: Readonly<TraceLayout>
): number {
  return traceLayout.traceGraph.getProcessRefs?.().length ?? 0;
}

function fillTraceLayoutCrossDependencyGeometryByRef(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: CrossDependencyRef,
  target: TraceLayoutGeometryTuple
): boolean {
  const chunkIndex = getCrossDependencyRefChunkIndex(dependencyRef);
  return fillTraceLayoutGeometryTupleFromColumn(
    traceLayout.crossDependencyGeometryChunks?.[chunkIndex],
    getCrossDependencyRefRowIndex(dependencyRef),
    target
  );
}

function fillTraceLayoutSyntheticCrossDependencyGeometryByRef(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: VisibleCrossDependencyRef,
  target: TraceLayoutGeometryTuple
): boolean {
  const syntheticRef = encodeCrossDependencyRef(getVisibleCrossDependencyRefIndex(dependencyRef));
  const chunkIndex =
    getTraceLayoutSyntheticCrossDependencyChunkOffset(traceLayout) +
    getCrossDependencyRefChunkIndex(syntheticRef);
  return fillTraceLayoutGeometryTupleFromColumn(
    traceLayout.crossDependencyGeometryChunks?.[chunkIndex],
    getCrossDependencyRefRowIndex(syntheticRef),
    target
  );
}

/** Returns the first chunk index reserved for override-only visible cross-dependency geometry. */
function getTraceLayoutSyntheticCrossDependencyChunkOffset(
  traceLayout: Readonly<TraceLayout>
): number {
  const sourceRowCount = traceLayout.traceGraph.crossDependencyTable?.numRows ?? 0;
  return sourceRowCount <= 0
    ? 0
    : getCrossDependencyRefChunkIndex(encodeCrossDependencyRef(sourceRowCount - 1)) + 1;
}

function getTraceLayoutCanonicalLocalDependencyRef(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: TraceDependencyRef | VisibleLocalDependencyRef
): LocalDependencyRef | null {
  const sourceRef = traceLayout.traceGraph?.getDependencySourceRefByRef?.(dependencyRef);
  return sourceRef != null && getTraceRefKind(sourceRef) === 'localDependency'
    ? (sourceRef as LocalDependencyRef)
    : null;
}

function getTraceLayoutCanonicalCrossDependencyRef(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: TraceDependencyRef | VisibleCrossDependencyRef
): CrossDependencyRef | null {
  const sourceRef = traceLayout.traceGraph?.getDependencySourceRefByRef?.(dependencyRef);
  return sourceRef != null && getTraceRefKind(sourceRef) === 'crossDependency'
    ? (sourceRef as CrossDependencyRef)
    : null;
}

/** Copies one array-like geometry tuple into a mutable target, zeroing missing geometry. */
function fillTraceLayoutGeometryTupleFromArray(
  geometry: ArrayLike<number> | undefined,
  target: TraceLayoutGeometryTuple
): boolean {
  target.x1 = geometry?.[0] ?? 0;
  target.y1 = geometry?.[1] ?? 0;
  target.x2 = geometry?.[2] ?? 0;
  target.y2 = geometry?.[3] ?? 0;
  return geometry != null && geometry.length >= TRACE_LAYOUT_GEOMETRY_WIDTH;
}

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
  /** Stable span id kept for compatibility block-list sources. */
  readonly spanId?: TraceSpanId;
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
  /** Z position used by deck layers to order the label above row geometry. */
  z: number;
};

export type TraceLayoutOverflowLabelDatum = {
  /** Overflow or filtered-span label text anchored in trace coordinates. */
  readonly text: string;
  /** Timeline X origin where the label is anchored. */
  readonly x: number;
  /** Timeline Y position for the label. */
  readonly y: number;
  /** Rightmost visible X bound available to the label within the timeline row. */
  readonly maxX: number;
  /** View that should render this label. */
  readonly view: 'main' | 'legend';
};

export type TraceLayoutRenderConfiguration = {
  /** Vertical distance between rendered lane baselines for this layout. */
  readonly laneSeparation: number;
};

/** Geometry and row metadata for one rendered process/rank band. */
export type ProcessLayout = {
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
  /** Background polygon for the rank band. */
  backgroundPolygon: Float32Array;
  /** Background polygon that spans an infinite width for the rank band. */
  backgroundPolygonInfinite: Float32Array;
  /** Horizontal separator line that spans an infinite width at `yOffset`. */
  separatorLineInfinite: Float32Array;
  /** Horizontal separator line that spans an infinite width below the rank band. */
  terminalSeparatorLineInfinite: Float32Array;

  /** Anchor position for the rank row. */
  startPosition: [number, number, number];
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
  /** Optional lane assignments keyed by canonical visible span refs from source metadata. */
  spanLaneMap?: ReadonlyMap<SpanRef, number>;
  /** Optional explicit lane indices to render while hiding all other lanes. */
  visibleLaneIndices?: number[];
  /** Whether this thread row should be rendered collapsed. */
  isCollapsed?: boolean;
};

/** Render geometry and lane metadata for one thread row. */
export type ThreadLayout = {
  /** Canonical runtime thread ref for this rendered thread row when available. */
  threadRef?: ThreadRef;
  /** Process-local stream id represented by this thread layout when it maps to one thread row. */
  threadId?: TraceThreadId;
  /** Whether the thread row should be rendered. */
  visible: boolean;
  /** Y position of the stream in the trace graph. */
  yPosition: number;
  /**
   * Thread-relative vertical extent reserved for author-provided manual span geometry.
   * Undefined for generated-lane layouts.
   */
  manualContentHeight?: number;
  /** Starting anchor position for animated transitions. */
  startPosition: [number, number, number];
  /** Target anchor position for animated transitions. */
  targetPosition: [number, number, number];
  /**
   * Optional combined-layout lane assignments keyed by canonical visible span refs.
   * Used when multiple logical threads are rendered on the same visual thread row.
   */
  spanLaneMap?: ReadonlyMap<SpanRef, number>;
  /** Optional lane layout details for span geometry within this thread row. */
  lanes?: ThreadLaneLayout;
  /** Count of hidden spans due to lane depth cap. */
  overflowSpanCount?: number;
  /** Optional overflow or filtered-span label for this thread row. */
  overflowLabel?: ThreadOverflowLabel;
};

/** Collects overflow labels from visible thread layouts in render order. */
export function buildTraceLayoutOverflowLabels(
  processLayouts: readonly ProcessLayout[]
): ThreadOverflowLabel[] {
  const overflowLabels: ThreadOverflowLabel[] = [];
  for (const rankLayout of processLayouts) {
    if (!rankLayout) {
      continue;
    }
    for (const threadLayout of rankLayout.threadLayouts) {
      if (threadLayout.visible && threadLayout.overflowLabel) {
        overflowLabels.push(threadLayout.overflowLabel);
      }
    }
  }
  return overflowLabels;
}

/**
 * Returns per-thread filtered span counts keyed by runtime thread refs when an active filter exists.
 */
export function getTraceLayoutFilteredSpanCountByThreadRef(params: {
  /** Layout whose source graph should be consulted first. */
  traceLayout: TraceLayout;
}): ReadonlyMap<ThreadRef, number> | undefined {
  const traceGraph = params.traceLayout.traceGraph;
  if (!hasTraceLayoutFilteredSpanCountSource(traceGraph) || !traceGraph.hasActiveSpanFilter()) {
    return undefined;
  }
  return traceGraph.getFilteredSpanCountByThreadRef?.();
}

/**
 * Returns per-thread filtered span counts keyed by ingestion thread ids for compatibility callers.
 */
export function getTraceLayoutFilteredSpanCountByThreadId(params: {
  /** Layout whose source graph should be consulted first. */
  traceLayout: TraceLayout;
}): Readonly<Partial<Record<TraceThreadId, number>>> | undefined {
  return getLegacyTraceLayoutFilteredSpanCountByThreadId(params);
}

/**
 * Returns per-thread filtered span counts keyed by ingestion thread ids when only legacy
 * compatibility data is available.
 */
function getLegacyTraceLayoutFilteredSpanCountByThreadId(params: {
  /** Layout whose source graph should be consulted first. */
  traceLayout: TraceLayout;
}): Readonly<Partial<Record<TraceThreadId, number>>> | undefined {
  const traceGraph = params.traceLayout.traceGraph as TraceLayoutFilteredSpanCountSource;
  if (!hasTraceLayoutFilteredSpanCountSource(traceGraph) || !traceGraph.hasActiveSpanFilter()) {
    return undefined;
  }
  return traceGraph.getFilteredSpanCountByThreadId?.();
}

/**
 * Returns the user-facing thread name used in overflow and filtered-span labels.
 */
export function getTraceLayoutOverflowLabelThreadName(threads: readonly TraceThread[]): string {
  if (threads.length === 1) {
    return threads[0]!.name?.trim() || String(threads[0]!.threadId);
  }
  return 'all threads';
}

/**
 * Returns the earliest visible X position for a collapsed activity overview.
 */
export function getTraceLayoutCollapsedActivityStartX(
  collapsedActivityIntervals: readonly TraceProcessActivityInterval[]
): number | undefined {
  return collapsedActivityIntervals.reduce<number | undefined>((minX, interval) => {
    if (!Number.isFinite(interval.startX)) {
      return minX;
    }
    return minX == null ? interval.startX : Math.min(minX, interval.startX);
  }, undefined);
}

/**
 * Returns the rightmost visible X position for a collapsed activity overview.
 */
export function getTraceLayoutCollapsedActivityEndX(
  collapsedActivityIntervals: readonly TraceProcessActivityInterval[]
): number | undefined {
  return collapsedActivityIntervals.reduce<number | undefined>((maxX, interval) => {
    if (!Number.isFinite(interval.endX)) {
      return maxX;
    }
    return maxX == null ? interval.endX : Math.max(maxX, interval.endX);
  }, undefined);
}

/**
 * Builds row-local overflow and filtered-span labels using the resolved trace layout state.
 */
export function buildTraceLayoutRowOverflowLabels(params: {
  /** Trace layout with resolved geometry and optional source graph. */
  traceLayout: TraceLayout;
  /** Stable rendered row metadata for which labels are being built. */
  row: TraceLayoutRow;
  /** Collapsed activity intervals associated with the row. */
  collapsedActivityIntervals: readonly TraceProcessActivityInterval[];
}): readonly TraceLayoutOverflowLabelDatum[] {
  const laneSeparation = params.traceLayout.layoutConfiguration?.laneSeparation ?? 0.7;
  const rankLayout = params.traceLayout.processLayouts[params.row.rankIndex];
  if (!rankLayout) {
    return [];
  }

  const effectiveIsCollapsed = Boolean(rankLayout.isCollapsed || params.row.isCollapsed);
  const timelineMaxX = params.traceLayout.currentBounds[1][0];
  const collapsedActivityY = Number.isFinite(rankLayout.collapsedActivityY)
    ? rankLayout.collapsedActivityY
    : rankLayout.yOffset;
  const filteredSpanCountByThreadRef = getTraceLayoutFilteredSpanCountByThreadRef({
    traceLayout: params.traceLayout
  });
  const legacyFilteredSpanCountByThreadId = getLegacyTraceLayoutFilteredSpanCountByThreadId({
    traceLayout: params.traceLayout
  });
  const collapsedFilteredSpanCount = effectiveIsCollapsed
    ? filteredSpanCountByThreadRef != null && (params.row.threadRefs?.length ?? 0) > 0
      ? (params.row.threadRefs ?? []).reduce(
          (count: number, threadRef) => count + (filteredSpanCountByThreadRef.get(threadRef) ?? 0),
          0
        )
      : legacyFilteredSpanCountByThreadId != null
        ? params.row.threads.reduce(
            (count: number, thread) =>
              count + (legacyFilteredSpanCountByThreadId[thread.threadId] ?? 0),
            0
          )
        : 0
    : 0;
  const expandedFilteredSpanCount = !effectiveIsCollapsed
    ? filteredSpanCountByThreadRef != null && (params.row.threadRefs?.length ?? 0) > 0
      ? (params.row.threadRefs ?? []).reduce(
          (count: number, threadRef) => count + (filteredSpanCountByThreadRef.get(threadRef) ?? 0),
          0
        )
      : legacyFilteredSpanCountByThreadId != null
        ? params.row.threads.reduce(
            (count: number, thread) =>
              count + (legacyFilteredSpanCountByThreadId[thread.threadId] ?? 0),
            0
          )
        : 0
    : 0;
  const overflowLabelData: TraceLayoutOverflowLabelDatum[] = [];
  if (!effectiveIsCollapsed) {
    let spans: readonly TraceLayoutRowBlockSource[] | null = null;
    let spansByThreadId: Record<string, TraceLayoutRowBlockSource[]> | null = null;
    for (let index = 0; index < rankLayout.threadLayouts.length; index += 1) {
      const threadLayout = rankLayout.threadLayouts[index]!;
      const overflowLabel = threadLayout.visible ? threadLayout.overflowLabel : undefined;
      if (!overflowLabel) {
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
        if (
          spanRef == null ||
          !fillTraceLayoutSpanGeometry({
            traceLayout: params.traceLayout,
            spanRef,
            target: geometry
          }) ||
          !Number.isFinite(geometry.x1)
        ) {
          continue;
        }

        fallbackAnchoredX =
          fallbackAnchoredX == null ? geometry.x1 : Math.min(fallbackAnchoredX, geometry.x1);
        const laneIndex = threadLayout.spanLaneMap?.get(spanRef) ?? 0;
        if (laneIndex === 0) {
          anchoredX = anchoredX == null ? geometry.x1 : Math.min(anchoredX, geometry.x1);
        }
      }
      const resolvedX = anchoredX ?? fallbackAnchoredX ?? overflowLabel.x;

      overflowLabelData.push({
        text: overflowLabel.text,
        x: threadLayout.overflowSpanCount && threadLayout.overflowSpanCount > 0 ? resolvedX : 0,
        y: overflowLabel.y,
        maxX: Math.max(
          resolvedX,
          threadLayout.targetPosition[0] ?? Number.NEGATIVE_INFINITY,
          timelineMaxX
        ),
        view:
          threadLayout.overflowSpanCount && threadLayout.overflowSpanCount > 0 ? 'main' : 'legend'
      });
    }
  }
  const collapsedActivityStartX =
    getTraceLayoutCollapsedActivityStartX(params.collapsedActivityIntervals) ?? 0;
  const collapsedActivityEndX = getTraceLayoutCollapsedActivityEndX(
    params.collapsedActivityIntervals
  );
  if (!effectiveIsCollapsed && overflowLabelData.length === 0 && expandedFilteredSpanCount > 0) {
    overflowLabelData.push({
      text: `All ${expandedFilteredSpanCount} span${expandedFilteredSpanCount === 1 ? '' : 's'} filtered out in thread ${getTraceLayoutOverflowLabelThreadName(params.row.threads)}`,
      x: 0,
      y: rankLayout.startPosition[1] + laneSeparation,
      maxX: Math.max(0, timelineMaxX),
      view: 'legend'
    });
  }
  if (effectiveIsCollapsed && collapsedFilteredSpanCount > 0) {
    overflowLabelData.push({
      text: `${collapsedFilteredSpanCount} span${collapsedFilteredSpanCount === 1 ? '' : 's'} filtered`,
      x: 0,
      y: collapsedActivityY + laneSeparation,
      maxX: Math.max(collapsedActivityStartX, collapsedActivityEndX ?? 0, timelineMaxX),
      view: 'legend'
    });
  }

  return overflowLabelData;
}

/**
 * Returns whether the provided value supports filtered-span-count lookups.
 */
function hasTraceLayoutFilteredSpanCountSource(
  traceGraph: unknown
): traceGraph is Readonly<TraceLayoutFilteredSpanCountSource> {
  return (
    traceGraph != null &&
    typeof traceGraph === 'object' &&
    'hasActiveSpanFilter' in traceGraph &&
    typeof traceGraph.hasActiveSpanFilter === 'function' &&
    (('getFilteredSpanCountByThreadRef' in traceGraph &&
      typeof traceGraph.getFilteredSpanCountByThreadRef === 'function') ||
      ('getFilteredSpanCountByThreadId' in traceGraph &&
        typeof traceGraph.getFilteredSpanCountByThreadId === 'function'))
  );
}

/**
 * Returns whether the provided value can resolve lightweight visible render spans for a row.
 */
function hasTraceLayoutVisibleProcessRenderSpansSource(
  traceGraph: unknown
): traceGraph is Readonly<TraceLayoutVisibleProcessRenderSpansSource> {
  return (
    traceGraph != null &&
    typeof traceGraph === 'object' &&
    'getVisibleProcessRenderSpans' in traceGraph &&
    typeof traceGraph.getVisibleProcessRenderSpans === 'function' &&
    'getSpanStreamId' in traceGraph &&
    typeof traceGraph.getSpanStreamId === 'function'
  );
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
 * Returns the visible span/block geometry sources associated with a rendered trace-layout row.
 */
function getTraceLayoutRowBlocks(
  traceLayout: TraceLayout,
  row: TraceLayoutRow
): readonly TraceLayoutRowBlockSource[] {
  const traceGraph = traceLayout.traceGraph as unknown;
  if (hasTraceLayoutVisibleProcessRenderSpansSource(traceGraph)) {
    if (row?.processRef == null) {
      return [];
    }
    const result: TraceLayoutRowBlockSource[] = [];
    for (const span of traceGraph.getVisibleProcessRenderSpans(row.processRef)) {
      const threadId = traceGraph.getSpanStreamId(span.spanRef);
      if (threadId != null) {
        result.push({spanRef: span.spanRef, threadId});
      }
    }
    return result;
  }
  if (hasTraceLayoutProcessBlocksListSource(traceGraph)) {
    return traceGraph.processes.find(process => process.processId === row.processId)?.spans ?? [];
  }
  return [];
}

/**
 * Groups row-local visible blocks by thread id only when overflow-label anchoring needs it.
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

  for (const threadLayout of Object.values(traceLayout.threadLayoutMap)) {
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

type TraceLayoutRowSourceGraph = TraceGraphData | TraceLayoutVisibleGraph;

/** Builds the canonical lightweight row model used by layout-aware UI consumers. */
export function buildTraceLayoutRows(params: {
  /** Source graph whose process metadata is aligned to the supplied rank layouts. */
  traceGraph: Readonly<TraceLayoutRowSourceGraph>;
  /** Process/rank layouts that define render row order. */
  processLayouts: readonly ProcessLayout[];
}): readonly TraceLayoutRow[] {
  const {traceGraph, processLayouts} = params;
  if (processLayouts.length === 0) {
    return [];
  }

  const rows: TraceLayoutRow[] = [];
  for (let rankIndex = 0; rankIndex < processLayouts.length; rankIndex += 1) {
    const processLayout = processLayouts[rankIndex];
    if (!processLayout) {
      continue;
    }
    const sourceProcess = traceGraph.processes[rankIndex];
    const primaryProcess = sourceProcess;
    const threads = primaryProcess?.threads ?? [];
    const fallbackRankId = primaryProcess?.processId ?? `rank-${rankIndex}`;

    rows.push({
      processId: fallbackRankId,
      processRef:
        primaryProcess && 'processRef' in primaryProcess ? primaryProcess.processRef : undefined,
      threadRefs:
        primaryProcess && 'threadRefs' in primaryProcess ? primaryProcess.threadRefs : undefined,
      rankIndex,
      name: processLayout.label ?? primaryProcess?.name ?? fallbackRankId,
      rankNum: primaryProcess?.rankNum ?? rankIndex,
      threads,
      isCollapsed: processLayout.isCollapsed ?? false
    });
  }
  return rows;
}
