import * as arrow from 'apache-arrow';

import {log} from '../log';
import {getGlobalDependencyMap} from '../trace-graph/trace-dependency-utils';
import {
  buildArrowTraceEventTableFromColumns as buildArrowTraceEventTableFromColumnsInternal,
  buildArrowTraceEventTableFromRows as buildArrowTraceEventTableFromRowsInternal,
  buildTraceEventMap,
  EMPTY_ARROW_TRACE_EVENT_TABLE
} from '../trace-graph/trace-event-table';
import {
  encodeChunkRef,
  encodeCrossDependencyRef,
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef,
  getProcessRefIndex,
  getSpanRefProcessId,
  getSpanRefRowIndex,
  TraceIdEncoder
} from '../trace-graph/trace-id-encoder';
import {getTraceSpanUserDataSource} from '../trace-graph/trace-span-user-data-fields';
import {
  isTraceSpanTimingEligibleForTimeExtents,
  isTraceSpanTimingTimestampEligibleForTimeExtents
} from '../trace-time-extents';
import {materializeJSONTrace} from './json-trace';

import type {TraceChunkData} from '../trace-chunk-data';
import type {
  ArrowTraceEventTable,
  TraceEventArrowColumns,
  TraceEventArrowRow
} from '../trace-graph/trace-event-table';
import type {TraceGraphStats} from '../trace-graph/trace-graph-stats';
import type {
  ChunkRef,
  CrossDependencyRef,
  ProcessRef,
  ThreadRef
} from '../trace-graph/trace-id-encoder';
import type {TraceOwnerRefSnapshot} from '../trace-graph/trace-owner-ref-registry';
import type {
  SpanRef,
  TraceCounter,
  TraceCounterId,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceDependency,
  TraceDependencyId,
  TraceEvent,
  TraceEventId,
  TraceInstant,
  TraceInstantId,
  TraceLocalDependency,
  TraceProcess,
  TraceProcessId,
  TraceSpan,
  TraceSpanId,
  TraceSpanLayoutMode,
  TraceSpanTiming,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {JSONTrace, MaterializedJSONTrace} from './json-trace';

export type {
  ArrowTraceEventTable,
  TraceEventArrowColumns,
  TraceEventArrowRow
} from '../trace-graph/trace-event-table';

/**
 * Metadata-only Arrow process record.
 *
 * Canonical span storage for Arrow graphs lives in `TraceGraphData.chunks[].spanTable`;
 * block-id lookup is a compatibility boundary.
 */
export type ArrowTraceProcessMetadata = Pick<
  TraceProcess,
  | 'type'
  | 'processId'
  | 'name'
  | 'tags'
  | 'rankNum'
  | 'processOrder'
  | 'stepNum'
  | 'threads'
  | 'threadMap'
  | 'instants'
  | 'instantMap'
  | 'threadInstantMap'
  | 'counters'
  | 'counterMap'
  | 'threadCounterMap'
  | 'remoteDependencies'
  | 'userData'
> & {
  /**
   * Legacy compatibility local dependencies. Arrow-backed runtime code should read
   * `localDependencyTableMap` instead of requiring this object array.
   */
  localDependencies?: TraceLocalDependency[];
};

/**
 * Apache Arrow schema describing one hot-path process-local span table stored within a
 * {@link TraceGraphData}.
 *
 * This table intentionally keeps only the scalar fields needed by filtering, visible-index
 * construction, and layout. Richer compatibility/display payloads live in the optional
 * row-aligned sidecar map.
 */
export type ArrowTraceSpanTable = arrow.Table<{
  /** Canonical runtime process ref owning this span row. */
  process_ref: arrow.Uint64;
  /** Canonical runtime thread ref owning this span row. */
  thread_ref: arrow.Uint64;
  /** Stable legacy block identifier for this span. */
  span_id: arrow.Utf8;
  /** Optional stable external span identifier for URL/deeplink identity. */
  external_span_id: arrow.Utf8;
  /** Owning thread identifier. */
  thread_id: arrow.Utf8;
  /** Span display name. */
  name: arrow.Utf8;
  /** Optional span source label used by filters and span inspection surfaces. */
  source: arrow.Utf8;
  /** Primary timing key selected for the span. */
  primary_timing_key: arrow.Utf8;
  /** Completion status for the primary timing projection. */
  status: arrow.Utf8;
  /** Primary timing start in milliseconds. */
  start_time_ms: arrow.Float64;
  /** Primary timing end in milliseconds. */
  end_time_ms: arrow.Float64;
  /** Primary timing duration in milliseconds. */
  duration_ms: arrow.Float64;
  /** Optional thread-relative top edge used by manual span layout. */
  layout_top_y: arrow.Float64;
  /** Optional rendered height used by manual span layout. */
  layout_height: arrow.Float64;
}>;

/**
 * Apache Arrow schema for a lightweight process-local span index.
 *
 * Full span scalar/string data is owned by {@link ArrowTraceChunk.spanTable}. This table only keeps
 * process-local row order plus the layout/filter columns that need geometry-row alignment. Rows
 * are sorted by ascending `span_ref`; accessors depend on that invariant for binary-search lookup
 * from a chunk-local `SpanRef` back to this process-local row.
 */
export type TraceProcessSpanRefTable = arrow.Table<{
  /** Stable encoded span ref for the process-local row, sorted ascending within the table. */
  span_ref: arrow.Float64;
  /** Optional thread-relative top edge used by manual span layout. */
  layout_top_y: arrow.Float64;
  /** Optional rendered height used by manual span layout. */
  layout_height: arrow.Float64;
  /** Graph-local filter provenance mask aligned with the process-local `span_ref` row. */
  filter_mask: arrow.Uint8;
}> & {
  /** Content generation for this process-local SpanRef/layout index table. */
  readonly generation: number;
};

/**
 * Options for building process-local SpanRef index tables from chunk-backed span storage.
 */
export type BuildTraceProcessSpanRefTablesOptions = {
  /** Canonical process ids indexed by packed process/chunk slot. */
  processIdsByIndex?: readonly TraceProcessId[];
  /** Optional active span refs into chunks; when omitted, every published chunk row is indexed. */
  spanRefs?: readonly SpanRef[];
};

/**
 * Apache Arrow schema describing one row-aligned process-local span sidecar table stored within an
 * {@link TraceGraphData}.
 *
 * This table is reserved for generic trace-graph-compatible scalar/list metadata. It intentionally
 * avoids nested endpoint payloads such as `List<Struct<...>>`; structured endpoint payloads remain
 * in compatibility JS sidecars until a normalized endpoint table model is designed.
 */
export type ArrowTraceSpanSidecarTable = arrow.Table<{
  /** Compact local dependency refs where this span is the dependency destination. */
  incomingLocalDependencyRefs: arrow.List<arrow.Uint64>;
  /** Compact local dependency refs where this span is the dependency source. */
  outgoingLocalDependencyRefs: arrow.List<arrow.Uint64>;
  /** Compact local dependency refs touching this span in either direction. */
  localDependencyRefs: arrow.List<arrow.Uint64>;
  /** Compact cross-process dependency refs where this span is the dependency destination. */
  incomingCrossDependencyRefs: arrow.List<arrow.Uint64>;
  /** Compact cross-process dependency refs where this span is the dependency source. */
  outgoingCrossDependencyRefs: arrow.List<arrow.Uint64>;
  /** Compact cross-process dependency refs touching this span in either direction. */
  crossDependencyRefs: arrow.List<arrow.Uint64>;
  /** Keyword labels shown in cards, search, and filters. */
  keywords: arrow.List<arrow.Utf8>;
  /** Optional unresolved cross-rank endpoint id. */
  crossProcessEndpointId: arrow.Utf8;
  /** Optional JSON-serialized user-data payload. */
  userDataJson: arrow.Utf8;
}>;

/**
 * Apache Arrow schema describing one hot-path process-local dependency table stored within an
 * {@link TraceGraphData}.
 */
export type ArrowTraceLocalDependencyTable = arrow.Table<{
  /** Canonical runtime dependency ref for this process-local dependency row. */
  dependencyRef: arrow.Float64;
  /** Stable dependency identifier. */
  dependencyId: arrow.Utf8;
  /** Canonical runtime source span ref for the dependency edge. */
  startSpanRef: arrow.Float64;
  /** Visible source span block id for the dependency edge. */
  startSpanId: arrow.Utf8;
  /** Canonical runtime destination span ref for the dependency edge. */
  endSpanRef: arrow.Float64;
  /** Visible destination span block id for the dependency edge. */
  endSpanId: arrow.Utf8;
  /** Wait-mode discriminator used by geometry and cards. */
  waitMode: arrow.Utf8;
  /** Whether the dependency is bidirectional. */
  bidirectional: arrow.Bool;
  /** Wait duration in milliseconds. */
  waitTimeMs: arrow.Float64;
  /** Keyword labels attached to the dependency source block. */
  keywords: arrow.List<arrow.Utf8>;
  /** Whether the dependency carries the parent keyword. */
  hasParentKeyword: arrow.Bool;
}>;

/**
 * Graph-local storage chunk for row-backed trace tables.
 */
export type ArrowTraceChunk = {
  /** Stable graph-local chunk index encoded into row-backed refs. */
  readonly chunkIndex: number;
  /** Typed runtime reference for this loaded storage chunk. */
  readonly chunkRef: ChunkRef;
  /** App-owned stable key for this storage chunk. */
  readonly chunkKey: string;
  /** Owning process refs represented by rows in this chunk. */
  readonly processRefs: readonly ProcessRef[];
  /** Compatibility owning process id when this chunk is process-scoped. */
  readonly processId?: TraceProcessId | null;
  /** Canonical process-local Arrow span table for this chunk. */
  readonly spanTable: ArrowTraceSpanTable;
  /** Canonical process-local Arrow dependency table for this chunk. */
  readonly localDependencyTable: ArrowTraceLocalDependencyTable;
  /** Optional row-aligned compatibility payloads for this chunk. */
  readonly spanSidecarRows?: readonly TraceSpanArrowSidecarRow[];
  /** Optional row-aligned Arrow sidecar table for this chunk. */
  readonly spanSidecarTable?: ArrowTraceSpanSidecarTable;
};

/**
 * Returns the number of published span rows represented by one TraceGraphData chunk.
 */
export function getArrowTraceChunkSpanRowCount(chunk: Readonly<ArrowTraceChunk>): number {
  return chunk.spanTable.numRows;
}

/**
 * Returns the stable span-ref row index for one published chunk-row ordinal.
 */
export function getArrowTraceChunkSpanRefRowIndex(
  chunk: Readonly<ArrowTraceChunk>,
  chunkRowOrdinal: number
): number | null {
  if (chunkRowOrdinal < 0 || chunkRowOrdinal >= chunk.spanTable.numRows) {
    return null;
  }
  return chunkRowOrdinal;
}

/**
 * Returns the Arrow span-table row index for one published chunk-row ordinal.
 */
export function getArrowTraceChunkSpanTableRowIndexAt(
  chunk: Readonly<ArrowTraceChunk>,
  chunkRowOrdinal: number
): number | null {
  if (chunkRowOrdinal < 0 || chunkRowOrdinal >= chunk.spanTable.numRows) {
    return null;
  }
  return chunkRowOrdinal;
}

/**
 * Resolves one stable span-ref row index into the backing Arrow span-table row index.
 */
export function getArrowTraceChunkSpanTableRowIndex(
  chunk: Readonly<ArrowTraceChunk>,
  spanRefRowIndex: number
): number | null {
  return spanRefRowIndex >= 0 && spanRefRowIndex < chunk.spanTable.numRows ? spanRefRowIndex : null;
}

/**
 * Resolve one chunk by its stable chunk index without assuming dense array slots.
 */
export function findArrowTraceChunkByIndex(
  chunks: readonly ArrowTraceChunk[],
  chunkIndex: number
): ArrowTraceChunk | null {
  let lowerBound = 0;
  let upperBound = chunks.length - 1;

  while (lowerBound <= upperBound) {
    const middleIndex = lowerBound + Math.floor((upperBound - lowerBound) / 2);
    const middleChunk = chunks[middleIndex];
    if (!middleChunk) {
      return null;
    }
    if (middleChunk.chunkIndex === chunkIndex) {
      return middleChunk;
    }
    if (middleChunk.chunkIndex < chunkIndex) {
      lowerBound = middleIndex + 1;
      continue;
    }
    upperBound = middleIndex - 1;
  }

  return null;
}

/**
 * Apache Arrow schema describing the graph-global cross-process dependency table stored within an
 * {@link TraceGraphData}.
 */
export type ArrowTraceCrossDependencyTable = arrow.Table<{
  /** Stable dependency identifier. */
  dependencyId: arrow.Utf8;
  /** Stable unresolved endpoint identifier. */
  endpointId: arrow.Utf8;
  /** Rank number where the dependency begins. */
  startRankNum: arrow.Int32;
  /** Rank number where the dependency ends. */
  endRankNum: arrow.Int32;
  /** Canonical runtime source span ref for the dependency edge. */
  startSpanRef: arrow.Float64;
  /** Visible source span block id for the dependency edge. */
  startSpanId: arrow.Utf8;
  /** Canonical runtime destination span ref for the dependency edge. */
  endSpanRef: arrow.Float64;
  /** Visible destination span block id for the dependency edge. */
  endSpanId: arrow.Utf8;
  /** Wait-mode discriminator used by geometry and cards. */
  waitMode: arrow.Utf8;
  /** Whether the dependency is bidirectional. */
  bidirectional: arrow.Bool;
  /** Cross-rank topology label. */
  topology: arrow.Utf8;
  /** Wait duration in milliseconds. */
  waitTimeMs: arrow.Float64;
  /** Whether the dependency is currently waiting. */
  waiting: arrow.Bool;
  /** Whether the wait is still unfinished. */
  waitNotFinished: arrow.Bool;
  /** Keyword labels attached to the dependency. */
  keywords: arrow.List<arrow.Utf8>;
  /** Whether the dependency carries the parent keyword. */
  hasParentKeyword: arrow.Bool;
}>;

/**
 * Row-aligned compatibility endpoint payload kept outside the hot Arrow table.
 */
export type TraceSpanArrowSidecarEndpoint = {
  /** Stable unresolved endpoint identifier. */
  endpointId: TraceCrossProcessEndpointId;
  /** Span block id currently associated with the unresolved endpoint. */
  spanId: TraceSpanId;
  /** Rank number where the dependency begins. */
  startRankNum: number;
  /** Rank number where the dependency ends. */
  endRankNum: number;
  /** Island/group number for the dependency edge. */
  islandNum: number;
  /** Wait duration in milliseconds. */
  waitTimeMs: number;
  /** Whether the endpoint is currently waiting. */
  waiting: boolean;
  /** Whether the wait is still unfinished. */
  waitNotFinished: boolean;
  /** Deserialized endpoint user data payload. */
  userData?: Record<string, unknown>;
};

/**
 * Row-aligned compatibility/display payload kept outside the hot Arrow table.
 */
export type TraceSpanArrowSidecarRow = {
  /** Full timing projections keyed by timing source. */
  timings?: Record<string, TraceSpanTiming>;
  /** Compatibility user data payload. */
  userData?: Record<string, unknown>;
  /** Keyword labels shown in cards, search, and filters. */
  keywords: string[];
  /** Local dependency identifiers touching the span. */
  localDependencyIds: string[];
  /** Process-local dependency row indexes where this span is the dependency destination. */
  incomingLocalDependencyRowIndexes: number[];
  /** Process-local dependency row indexes where this span is the dependency source. */
  outgoingLocalDependencyRowIndexes: number[];
  /** Compact local dependency refs where this span is the dependency destination. */
  incomingLocalDependencyRefs?: number[];
  /** Compact local dependency refs where this span is the dependency source. */
  outgoingLocalDependencyRefs?: number[];
  /** Compact cross-process dependency refs where this span is the dependency destination. */
  incomingCrossDependencyRefs?: number[];
  /** Compact cross-process dependency refs where this span is the dependency source. */
  outgoingCrossDependencyRefs?: number[];
  /** Optional unresolved cross-rank endpoint id. */
  crossProcessEndpointId: TraceCrossProcessEndpointId | null;
  /** Structured unresolved cross-rank endpoints attached to the span. */
  crossProcessDependencyEndpoints: TraceSpanArrowSidecarEndpoint[];
};

/**
 * Row-aligned compatibility/display payloads keyed by process id.
 */
export type TraceSpanArrowSidecarMap = Readonly<
  Record<TraceProcessId, readonly TraceSpanArrowSidecarRow[]>
>;

/**
 * Row-aligned Arrow sidecar tables keyed by process id.
 */
export type ArrowTraceSpanSidecarTableMap = Readonly<
  Record<TraceProcessId, ArrowTraceSpanSidecarTable>
>;

/**
 * Sparse unresolved cross-rank endpoints keyed by exact owning span ref.
 */
export type TraceCrossProcessEndpointsBySpanRef = ReadonlyMap<
  SpanRef,
  readonly TraceCrossProcessEndpoint[]
>;

/**
 * Sparse directional cross-dependency refs keyed by exact span ref.
 */
export type TraceSpanCrossDependencyRefMap = {
  /** Cross-dependency refs where the span is the dependency destination. */
  readonly incomingCrossDependencyRefsBySpanRef: ReadonlyMap<
    SpanRef,
    readonly CrossDependencyRef[]
  >;
  /** Cross-dependency refs where the span is the dependency source. */
  readonly outgoingCrossDependencyRefsBySpanRef: ReadonlyMap<
    SpanRef,
    readonly CrossDependencyRef[]
  >;
};

/**
 * Serialized Arrow row used to populate a {@link ArrowTraceSpanTable}.
 */
export type TraceSpanArrowRow = {
  /** Canonical runtime process ref owning this span row. */
  process_ref?: number | null;
  /** Canonical runtime thread ref owning this span row. */
  thread_ref?: number | null;
  /** Stable legacy block identifier for this span. */
  span_id: string;
  /** Optional stable external span identifier for URL/deeplink identity. */
  external_span_id?: string | null;
  /** Owning thread identifier. */
  thread_id: string;
  /** Span display name. */
  name: string;
  /** Optional span source label used by filters and span inspection surfaces. */
  source?: string | null;
  /** Primary timing key selected for the span. */
  primary_timing_key: string;
  /** Completion status for the primary timing projection. */
  status: string;
  /** Primary timing start in milliseconds. */
  start_time_ms: number;
  /** Primary timing end in milliseconds. */
  end_time_ms: number;
  /** Primary timing duration in milliseconds. */
  duration_ms: number;
  /** Optional thread-relative top edge used by manual span layout. */
  layout_top_y?: number | null;
  /** Optional rendered height used by manual span layout. */
  layout_height?: number | null;
};

/**
 * Column-oriented Arrow span payload used to build one {@link ArrowTraceSpanTable}.
 */
export type TraceSpanArrowColumns = {
  /** Canonical runtime process refs owning span rows. */
  process_ref?: Array<number | null>;
  /** Canonical runtime thread refs owning span rows. */
  thread_ref?: Array<number | null>;
  /** Stable legacy block identifiers in process-local row order. */
  span_id: string[];
  /** Optional stable external span identifiers in process-local row order. */
  external_span_id?: Array<string | null>;
  /** Owning thread identifiers in process-local row order. */
  thread_id: string[];
  /** Span display names. */
  name: string[];
  /** Optional span source labels in process-local row order. */
  source?: Array<string | null>;
  /** Primary timing key selected for each span. */
  primary_timing_key: string[];
  /** Completion status for the primary timing projection. */
  status: string[];
  /** Primary timing start in milliseconds. */
  start_time_ms: number[];
  /** Primary timing end in milliseconds. */
  end_time_ms: number[];
  /** Primary timing duration in milliseconds. */
  duration_ms: number[];
  /** Optional thread-relative top edges used by manual span layout. */
  layout_top_y?: Array<number | null>;
  /** Optional rendered heights used by manual span layout. */
  layout_height?: Array<number | null>;
};

/**
 * Column-oriented Arrow span sidecar payload used to build one {@link ArrowTraceSpanSidecarTable}.
 */
export type TraceSpanArrowSidecarColumns = {
  /** Compact local dependency refs where each span is the dependency destination. */
  incomingLocalDependencyRefs: Array<readonly number[]>;
  /** Compact local dependency refs where each span is the dependency source. */
  outgoingLocalDependencyRefs: Array<readonly number[]>;
  /** Compact local dependency refs touching each span in either direction. */
  localDependencyRefs?: Array<readonly number[]>;
  /** Compact cross-process dependency refs where each span is the dependency destination. */
  incomingCrossDependencyRefs?: Array<readonly number[]>;
  /** Compact cross-process dependency refs where each span is the dependency source. */
  outgoingCrossDependencyRefs?: Array<readonly number[]>;
  /** Compact cross-process dependency refs touching each span in either direction. */
  crossDependencyRefs?: Array<readonly number[]>;
  /** Keyword labels for each span. */
  keywords?: Array<readonly string[]>;
  /** Optional unresolved cross-rank endpoint ids for each span. */
  crossProcessEndpointId?: Array<TraceCrossProcessEndpointId | string | null>;
  /** Optional JSON-serialized user-data payloads for each span. */
  userDataJson?: Array<string | null>;
};

/**
 * Column-oriented local dependency payload used to build one {@link ArrowTraceLocalDependencyTable}.
 */
export type TraceLocalDependencyArrowColumns = {
  /** Canonical runtime dependency refs in process-local dependency row order. */
  dependencyRef?: number[];
  /** Stable dependency identifiers in process-local dependency row order. */
  dependencyId: string[];
  /** Dependency source span refs. */
  startSpanRef?: Array<number | null>;
  /** Dependency source block ids. */
  startSpanId: string[];
  /** Dependency destination span refs. */
  endSpanRef?: Array<number | null>;
  /** Dependency destination block ids. */
  endSpanId: string[];
  /** Wait-mode discriminator used by geometry and cards. */
  waitMode: string[];
  /** Whether each dependency is bidirectional. */
  bidirectional: boolean[];
  /** Wait durations in milliseconds. */
  waitTimeMs: number[];
  /** Keyword labels attached to each dependency. */
  keywords?: Array<readonly string[]>;
  /** Whether each dependency has the parent keyword. */
  hasParentKeyword: boolean[];
};

type TraceSpanArrowVectorOverrides = {
  /** Optional prebuilt display-name vector to reuse when it already matches span row order. */
  name?: arrow.Vector<arrow.Utf8>;
};

/**
 * Options for constructing an ingestion-oriented TraceGraphData from normalized graph metadata.
 */
export type BuildTraceGraphDataOptions = {
  /** Human-friendly name for the ingestion trace. */
  name: string;
  /** Whether spans use generated lanes or authored thread-relative vertical geometry. */
  spanLayout?: TraceSpanLayoutMode;
  /**
   * Metadata-only process records in render order.
   */
  processes: Readonly<ArrowTraceProcessMetadata[]>;
  /** Cross-process dependencies shared across the graph. */
  crossDependencies: Readonly<TraceCrossProcessDependency[]>;
  /** Canonical process-local span tables keyed by process id. */
  spanTableMap: Readonly<Record<TraceProcessId, ArrowTraceSpanTable>>;
  /** Optional canonical process-local dependency tables keyed by process id. */
  localDependencyTableMap?: Readonly<Record<TraceProcessId, ArrowTraceLocalDependencyTable>>;
  /** Optional canonical graph-global cross-process dependency table. */
  crossDependencyTable?: Readonly<ArrowTraceCrossDependencyTable>;
  /** Optional precomputed graph-global dependency map. */
  dependencyMap?: Readonly<Record<TraceDependencyId, TraceDependency>>;
  /** Optional row-aligned compatibility payloads keyed by process id. */
  spanSidecarMap?: TraceSpanArrowSidecarMap;
  /** Optional row-aligned Arrow sidecar tables keyed by process id. */
  spanSidecarTableMap?: ArrowTraceSpanSidecarTableMap;
  /** Optional sparse unresolved cross-rank endpoints keyed by exact owning span ref. */
  crossProcessEndpointsBySpanRef?: TraceCrossProcessEndpointsBySpanRef;
  /** Optional sparse directional cross-dependency refs keyed by exact span ref. */
  spanCrossDependencyRefMap?: TraceSpanCrossDependencyRefMap;
  /** Optional explicit row-backed storage chunks. */
  chunks?: readonly ArrowTraceChunk[];
  /** Optional active span refs into {@link chunks}; when omitted, every chunk row is active. */
  spanRefs?: readonly SpanRef[];
  /** Optional stable map from cross-dependency ids to deterministic packed dependency indexes. */
  crossDependencyIdToIndexMap?: Readonly<Record<TraceDependencyId, number>>;
  /** Optional trace-global owner-ref lookup tables allocated outside this materialized graph. */
  ownerRefSnapshot?: TraceOwnerRefSnapshot;
  /** Canonical graph-global event table. */
  events?: Readonly<ArrowTraceEventTable>;
  /** Optional canonical graph-wide time bounds to preserve from an existing graph. */
  timeExtents?: {
    /** Earliest canonical timestamp in the graph. */
    minTimeMs: number;
    /** Latest canonical timestamp in the graph. */
    maxTimeMs: number;
  };
  /** Optional stat overrides preserved from upstream loaders or active span selections. */
  stats?: Partial<TraceGraphStats>;
};

/**
 * Shared Arrow-backed graph tables used by runtime consumers after ingestion.
 *
 * `TraceGraph` owns a graph-local copy of this shape and may share the underlying Arrow columns
 * from an {@link TraceGraphData}, but it must not retain the ingestion object itself.
 */
export type TraceGraphData = {
  /** Human friendly name for this TraceGraphData (e.g. "Step 1"). */
  name: string;
  /** Whether spans use generated lanes or authored thread-relative vertical geometry. */
  spanLayout?: TraceSpanLayoutMode;

  /**
   * Metadata-only process records in render order.
   */
  processes: Readonly<ArrowTraceProcessMetadata[]>;
  /** List of cross dependencies across processes. */
  crossDependencies: Readonly<TraceCrossProcessDependency[]>;

  /** Minimum canonical timestamp in the trace. */
  minTimeMs: number;
  /** Maximum canonical timestamp in the trace. */
  maxTimeMs: number;

  /** Map of all threads for all processes. */
  threadMap: Record<TraceThreadId, TraceThread>;

  /** Map of all instants across the trace, keyed by thread. */
  threadInstantMap: Record<TraceThreadId, TraceInstant[]>;
  /** Map of all counters across the trace, keyed by thread. */
  threadCounterMap: Record<TraceThreadId, TraceCounter[]>;

  /** Map for fast lookups of instants across all processes. */
  instantMap: Readonly<Record<TraceInstantId, TraceInstant>>;
  /** Map for fast lookups of counters across all processes. */
  counterMap: Readonly<Record<TraceCounterId, TraceCounter>>;

  /** Extents for counter totals per thread. */
  counterExtents: Readonly<Record<TraceThreadId, {min: number; max: number}>>;
  /** Canonical graph-global Arrow event table. */
  events: Readonly<ArrowTraceEventTable>;
  /** Event metadata keyed by event id. */
  eventMap: Readonly<Record<TraceEventId, TraceEvent>>;

  /** Process-local SpanRef/layout index tables keyed by process id. */
  processSpanTableMap: Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>>;
  /** Canonical process-local Arrow dependency tables keyed by process id. */
  localDependencyTableMap: Readonly<Record<TraceProcessId, ArrowTraceLocalDependencyTable>>;
  /** Canonical graph-global Arrow cross-process dependency table. */
  crossDependencyTable: Readonly<ArrowTraceCrossDependencyTable>;
  /** Optional row-aligned compatibility payloads keyed by process id. */
  spanSidecarMap?: TraceSpanArrowSidecarMap;
  /** Optional row-aligned Arrow sidecar tables keyed by process id. */
  spanSidecarTableMap?: ArrowTraceSpanSidecarTableMap;
  /** Optional sparse unresolved cross-rank endpoints keyed by exact owning span ref. */
  crossProcessEndpointsBySpanRef?: TraceCrossProcessEndpointsBySpanRef;
  /** Optional sparse directional cross-dependency refs keyed by exact span ref. */
  spanCrossDependencyRefMap?: TraceSpanCrossDependencyRefMap;
  /** Row-backed storage chunks indexed by encoded chunk index. */
  chunks: readonly ArrowTraceChunk[];
  /** Optional active span refs into {@link chunks}; when omitted, every chunk row is active. */
  spanRefs?: readonly SpanRef[];
  /** Stable map from cross-dependency ids to deterministic packed dependency indexes. */
  crossDependencyIdToIndexMap?: Readonly<Record<TraceDependencyId, number>>;
  /** Optional trace-global owner-ref lookup tables allocated outside this materialized graph. */
  ownerRefSnapshot?: TraceOwnerRefSnapshot;
  /** Canonical process ids indexed by packed process index. */
  processIdsByIndex: ReadonlyArray<TraceProcessId>;
  /** Map for fast lookups of dependencies across the entire trace. */
  dependencyMap: Readonly<Record<TraceDependencyId, TraceDependency>>;

  /** Aggregated counts about the trace. */
  stats: TraceGraphStats;
};

/**
 * Build a {@link TraceGraphData} from canonical per-process block tables plus graph metadata.
 */
export function buildTraceGraphData(options: BuildTraceGraphDataOptions): TraceGraphData {
  const buildStartTime = performance.now();
  log.probe(0, 'buildTraceGraphData start', {
    name: options.name,
    processCount: options.processes.length,
    spanTableCount: Object.keys(options.spanTableMap).length
  })();
  const processes = options.processes.map(toArrowTraceProcessMetadata);
  const events = options.events ?? EMPTY_ARROW_TRACE_EVENT_TABLE;
  const sourceSpanTableMap = options.spanTableMap;
  const timeExtentsStartTime = performance.now();
  const normalizedTimeExtents = normalizeArrowTraceTimeExtents(options.timeExtents);
  const computedTimeExtents =
    normalizedTimeExtents ?? computeArrowTraceTimeExtents(processes, sourceSpanTableMap, events);
  const timeExtentsDurationMs = performance.now() - timeExtentsStartTime;
  const localDependencyTableStartTime = performance.now();
  const localDependencyTableMap =
    options.localDependencyTableMap ?? buildLocalDependencyTablesByProcessId(processes);
  const localDependencyTableDurationMs = performance.now() - localDependencyTableStartTime;
  const crossDependencyTableStartTime = performance.now();
  const crossDependencyTable =
    options.crossDependencyTable ?? buildArrowTraceCrossDependencyTable(options.crossDependencies);
  const crossDependencyTableDurationMs = performance.now() - crossDependencyTableStartTime;
  const crossDependencyIndexStartTime = performance.now();
  const crossDependencyIdToIndexMap =
    options.crossDependencyIdToIndexMap ??
    buildCrossDependencyIdToIndexMap(options.crossDependencies);
  const crossDependencyIndexDurationMs = performance.now() - crossDependencyIndexStartTime;
  const dependencyMapStartTime = performance.now();
  const dependencyMap =
    options.dependencyMap ??
    (getGlobalDependencyMap(processes, options.crossDependencies) as Readonly<
      Record<TraceDependencyId, TraceDependency>
    >);
  const dependencyMapDurationMs = performance.now() - dependencyMapStartTime;
  const metadataMapStartTime = performance.now();
  const threadMap = buildThreadMap(processes);
  const threadInstantMap = buildThreadInstantMap(processes);
  const threadCounterMap = buildThreadCounterMap(processes);
  const instantMap = buildInstantMap(processes);
  const counterMap = buildCounterMap(processes);
  const counterExtents = buildCounterExtents(threadCounterMap);
  const eventMap = buildTraceEventMap(events);
  const metadataMapDurationMs = performance.now() - metadataMapStartTime;
  const traceIdEncoder = new TraceIdEncoder(
    options.ownerRefSnapshot?.processIdsByIndex ??
      processes.map(process => process.processId as TraceProcessId)
  );
  const spanSidecarStartTime = performance.now();
  const spanSidecarMap = options.spanSidecarMap
    ? attachDependencyRefsToSpanSidecars({
        crossDependencies: options.crossDependencies,
        crossDependencyIdToIndexMap,
        processes,
        processIdsByIndex: traceIdEncoder.getProcessIdsByIndex(),
        spanSidecarMap: options.spanSidecarMap,
        spanTableMap: sourceSpanTableMap
      })
    : undefined;
  const spanSidecarDurationMs = performance.now() - spanSidecarStartTime;
  const chunks = buildArrowTraceChunks({
    chunks: options.chunks,
    localDependencyTableMap,
    processes,
    processIdsByIndex: traceIdEncoder.getProcessIdsByIndex(),
    spanSidecarMap,
    spanSidecarTableMap: options.spanSidecarTableMap,
    spanTableMap: sourceSpanTableMap
  });
  const processSpanRefTableStartTime = performance.now();
  const processSpanTableMap = buildTraceProcessSpanRefTables(chunks, processes, {
    processIdsByIndex: traceIdEncoder.getProcessIdsByIndex(),
    spanRefs: options.spanRefs
  });
  const processSpanRefTableDurationMs = performance.now() - processSpanRefTableStartTime;
  const spanCrossDependencyRefMapStartTime = performance.now();
  const spanCrossDependencyRefMap =
    options.spanCrossDependencyRefMap ??
    buildSpanCrossDependencyRefMap({
      crossDependencies: options.crossDependencies,
      crossDependencyIdToIndexMap
    });
  const spanCrossDependencyRefMapDurationMs =
    performance.now() - spanCrossDependencyRefMapStartTime;
  const statsStartTime = performance.now();
  const stats = buildArrowTraceStats(
    processes,
    options.crossDependencies,
    sourceSpanTableMap,
    localDependencyTableMap,
    options.stats
  );
  const statsDurationMs = performance.now() - statsStartTime;

  const traceGraphData = {
    name: options.name,
    spanLayout: normalizeArrowTraceSpanLayoutMode(options.spanLayout),
    processes,
    crossDependencies: options.crossDependencies,
    minTimeMs: computedTimeExtents.minTimeMs,
    maxTimeMs: computedTimeExtents.maxTimeMs,
    threadMap,
    threadInstantMap,
    threadCounterMap,
    instantMap,
    counterMap,
    counterExtents,
    events,
    eventMap,
    processSpanTableMap,
    localDependencyTableMap,
    crossDependencyTable,
    spanSidecarMap,
    spanSidecarTableMap: options.spanSidecarTableMap,
    crossProcessEndpointsBySpanRef: options.crossProcessEndpointsBySpanRef,
    spanCrossDependencyRefMap,
    chunks,
    spanRefs: options.spanRefs,
    crossDependencyIdToIndexMap,
    ownerRefSnapshot: options.ownerRefSnapshot,
    processIdsByIndex: traceIdEncoder.getProcessIdsByIndex(),
    dependencyMap,
    stats
  } satisfies TraceGraphData;
  log.probe(0, 'buildTraceGraphData detail', {
    name: traceGraphData.name,
    processCount: traceGraphData.processes.length,
    spanCount: traceGraphData.stats.spanCount,
    crossDependencyCount: traceGraphData.stats.crossDependencyCount,
    timeExtentsDurationMs,
    localDependencyTableDurationMs,
    crossDependencyTableDurationMs,
    crossDependencyIndexDurationMs,
    dependencyMapDurationMs,
    metadataMapDurationMs,
    spanSidecarDurationMs,
    processSpanRefTableDurationMs,
    spanCrossDependencyRefMapDurationMs,
    statsDurationMs
  })();
  log.probe(0, 'buildTraceGraphData done', {
    name: traceGraphData.name,
    processCount: traceGraphData.processes.length,
    spanCount: traceGraphData.stats.spanCount,
    dependencyCount: traceGraphData.stats.dependencyCount,
    crossDependencyCount: traceGraphData.stats.crossDependencyCount,
    durationMs: performance.now() - buildStartTime
  })();
  return traceGraphData;
}

/**
 * Returns the lazy combined span table view for a {@link TraceGraphData}.
 *
 * Combined row numbers are derived from the current process ordering and must be treated as
 * ephemeral. The canonical row identity is always `spanId -> { processId, rowIndex }`.
 */
export function getCombinedBlockTable(traceGraph: TraceGraphData): ArrowTraceSpanTable {
  const cachedTable = combinedBlockTableCache.get(traceGraph);
  if (cachedTable) {
    return cachedTable;
  }

  const combinedTable = new arrow.Table(
    getTraceSpanArrowSchema(),
    traceGraph.chunks.flatMap(chunk => chunk.spanTable.batches ?? [])
  ) as ArrowTraceSpanTable;
  combinedBlockTableCache.set(traceGraph, combinedTable);
  return combinedTable;
}

/**
 * Convert a plain {@link JSONTrace} into the Arrow-backed graph representation.
 */
export function buildTraceGraphDataFromJSONTrace(traceGraph: JSONTrace): TraceGraphData {
  const materializedTraceGraph = materializeJSONTrace(traceGraph);
  const traceIdEncoder = new TraceIdEncoder(
    materializedTraceGraph.processes.map(process => process.processId as TraceProcessId)
  );
  const crossDependencyIdToIndexMap = buildCrossDependencyIdToIndexMap(
    materializedTraceGraph.crossDependencies
  );

  return buildTraceGraphData({
    name: materializedTraceGraph.name,
    spanLayout: materializedTraceGraph.spanLayout,
    processes: materializedTraceGraph.processes.map(toArrowTraceProcessMetadata),
    crossDependencies: materializedTraceGraph.crossDependencies,
    crossDependencyIdToIndexMap,
    events: materializedTraceGraph.events,
    spanTableMap: buildTraceSpanTablesByProcessId(materializedTraceGraph.processes),
    spanSidecarMap: buildTraceSpanSidecarsByProcessId(
      materializedTraceGraph.processes,
      traceIdEncoder
    ),
    timeExtents: {
      minTimeMs: materializedTraceGraph.minTimeMs,
      maxTimeMs: materializedTraceGraph.maxTimeMs
    },
    stats: {
      droppedSpanCount: materializedTraceGraph.stats.droppedSpanCount,
      droppedDependencyCount: materializedTraceGraph.stats.droppedDependencyCount,
      droppedCrossDependencyCount: materializedTraceGraph.stats.droppedCrossDependencyCount
    }
  });
}

/**
 * Convert a plain or materialized {@link JSONTrace} into parser-local chunk payloads.
 */
export function buildTraceChunkDataFromJSONTrace(
  traceGraph: Readonly<JSONTrace> | Readonly<MaterializedJSONTrace>
): TraceChunkData[] {
  const materializedTraceGraph = materializeJSONTrace(traceGraph);
  const traceIdEncoder = new TraceIdEncoder(
    materializedTraceGraph.processes.map(process => process.processId as TraceProcessId)
  );
  const processes = materializedTraceGraph.processes.map(toArrowTraceProcessMetadata);
  const spanTableMap = buildTraceSpanTablesByProcessId(materializedTraceGraph.processes);
  const localDependencyTableMap = buildLocalDependencyTablesByProcessId(processes);
  const spanSidecarMap = buildTraceSpanSidecarsByProcessId(
    materializedTraceGraph.processes,
    traceIdEncoder
  );

  return materializedTraceGraph.processes.map(process => {
    const processId = process.processId as TraceProcessId;
    const spanTable = spanTableMap[processId];
    const localDependencyTable = localDependencyTableMap[processId];
    if (!spanTable || !localDependencyTable) {
      throw new Error(`Missing JSON trace chunk tables for process ${processId}`);
    }
    return {
      type: 'trace-chunk-data',
      chunkKey: processId,
      processes,
      spanTable,
      localDependencyTable,
      spanSidecarRows: spanSidecarMap[processId],
      diagnostics: buildTraceChunkDataDiagnostics(spanTable),
      refState: 'parser-local'
    } satisfies TraceChunkData;
  });
}

/**
 * Build parser-local diagnostics for one normalized span table.
 */
function buildTraceChunkDataDiagnostics(
  spanTable: ArrowTraceSpanTable
): TraceChunkData['diagnostics'] {
  const timeExtents = computeArrowTraceSpanTableTimeExtents(spanTable);
  return {
    rowCount: spanTable.numRows,
    invalidRecordCount: 0,
    minTimeMs: timeExtents?.minTimeMs ?? null,
    maxTimeMs: timeExtents?.maxTimeMs ?? null,
    warningCounters: {}
  };
}

/**
 * Compute finite timing bounds for one chunk-local span table.
 */
function computeArrowTraceSpanTableTimeExtents(
  spanTable: ArrowTraceSpanTable
): {minTimeMs: number; maxTimeMs: number} | null {
  const startTimeColumn = getColumn<number>(spanTable, 'start_time_ms');
  const endTimeColumn = getColumn<number>(spanTable, 'end_time_ms');
  const statusColumn = getColumn<string>(spanTable, 'status');
  let minTimeMs = Number.POSITIVE_INFINITY;
  let maxTimeMs = Number.NEGATIVE_INFINITY;

  for (let rowIndex = 0; rowIndex < spanTable.numRows; rowIndex += 1) {
    const startTimeMs = startTimeColumn?.get(rowIndex) ?? null;
    const endTimeMs = endTimeColumn?.get(rowIndex) ?? null;
    const status = statusColumn?.get(rowIndex) ?? null;
    if (!isTraceSpanTimingEligibleForTimeExtents({status, startTimeMs})) {
      continue;
    }
    const finiteStartTimeMs = startTimeMs as number;
    minTimeMs = Math.min(minTimeMs, finiteStartTimeMs);
    maxTimeMs = Math.max(maxTimeMs, finiteStartTimeMs);
    if (isTraceSpanTimingTimestampEligibleForTimeExtents(endTimeMs)) {
      minTimeMs = Math.min(minTimeMs, endTimeMs);
      maxTimeMs = Math.max(maxTimeMs, endTimeMs);
    }
  }

  return Number.isFinite(minTimeMs) && Number.isFinite(maxTimeMs) ? {minTimeMs, maxTimeMs} : null;
}

/**
 * Drops compatibility span containers from a plain process when normalizing Arrow graph metadata.
 */
export function toArrowTraceProcessMetadata(
  process: Readonly<ArrowTraceProcessMetadata | TraceProcess>
): ArrowTraceProcessMetadata {
  return {
    type: process.type,
    processId: process.processId,
    name: process.name,
    tags: process.tags,
    rankNum: process.rankNum,
    processOrder: process.processOrder,
    stepNum: process.stepNum,
    threads: process.threads,
    threadMap: process.threadMap,
    instants: process.instants,
    instantMap: process.instantMap,
    threadInstantMap: process.threadInstantMap,
    counters: process.counters,
    counterMap: process.counterMap,
    threadCounterMap: process.threadCounterMap,
    localDependencies: process.localDependencies,
    remoteDependencies: process.remoteDependencies,
    userData: process.userData
  };
}

/**
 * Builds process-local SpanRef index tables from chunk-backed span storage.
 *
 * Rows are emitted in ascending `SpanRef` order by scanning chunks by `chunkIndex` and then their
 * chunk-local row order. The sorted `span_ref` column is the lookup invariant used by
 * `getTraceGraphProcessSpanOrdinal(...)`; all other process-local columns, including
 * `filter_mask`, must stay row-aligned with it.
 */
export function buildTraceProcessSpanRefTables(
  chunks: readonly ArrowTraceChunk[],
  processes: readonly Pick<ArrowTraceProcessMetadata, 'processId'>[],
  options?: BuildTraceProcessSpanRefTablesOptions
): Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>> {
  const processIdsByIndex =
    options?.processIdsByIndex ?? processes.map(process => process.processId as TraceProcessId);
  const rowsByProcessId = new Map<TraceProcessId, TraceProcessSpanRefTableColumns>();
  for (const process of processes) {
    rowsByProcessId.set(process.processId as TraceProcessId, createTraceProcessSpanRefColumns());
  }

  const activeSpanRefs = options?.spanRefs ? new Set(options.spanRefs) : null;
  for (const chunk of [...chunks].sort(compareArrowTraceChunksByIndex)) {
    const spanColumns = readTraceProcessSpanRefSourceColumns(chunk.spanTable);
    const spanRowCount = getArrowTraceChunkSpanRowCount(chunk);
    for (let chunkRowOrdinal = 0; chunkRowOrdinal < spanRowCount; chunkRowOrdinal += 1) {
      const tableRowIndex = getArrowTraceChunkSpanTableRowIndexAt(chunk, chunkRowOrdinal);
      const spanRefRowIndex = getArrowTraceChunkSpanRefRowIndex(chunk, chunkRowOrdinal);
      if (tableRowIndex == null || spanRefRowIndex == null) {
        continue;
      }
      const spanRef = encodeSpanRef(chunk.chunkIndex, spanRefRowIndex);
      if (activeSpanRefs && !activeSpanRefs.has(spanRef)) {
        continue;
      }
      appendTraceProcessSpanRefTableRow({
        chunk,
        processIdsByIndex,
        rowIndex: tableRowIndex,
        rowsByProcessId,
        spanColumns,
        spanRef
      });
    }
  }

  return Object.fromEntries(
    [...rowsByProcessId].map(([processId, columns]) => [
      processId,
      buildTraceProcessSpanRefTableFromColumns(columns)
    ])
  ) as Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>>;
}

/**
 * Returns a process span-ref table with graph filter masks aligned to process-local rows.
 *
 * The input table's sorted `span_ref` column is preserved exactly; the returned table only replaces
 * the row-aligned `filter_mask` column. `filterMask` must have one entry per process-local row and
 * must already be aligned with `table.span_ref`; callers are responsible for deriving it from that
 * same process table row order.
 *
 * @throws When the filter-mask buffer is not row-aligned with the source table.
 */
export function buildTraceProcessSpanRefTableWithFilterMaskColumn(
  table: TraceProcessSpanRefTable,
  filterMask: Uint8Array
): TraceProcessSpanRefTable {
  if (filterMask.length !== table.numRows) {
    throw new Error(
      `TraceProcessSpanRefTable filter_mask length ${filterMask.length} does not match row count ${table.numRows}`
    );
  }
  if (table.numRows === 0) {
    return table;
  }

  const spanRefColumn = table.getChild('span_ref');
  if (!spanRefColumn) {
    throw new Error('TraceProcessSpanRefTable is missing the required span_ref column');
  }

  return buildTraceProcessSpanRefTableFromVectors({
    span_ref: spanRefColumn,
    layout_top_y:
      table.getChild('layout_top_y') ?? buildArrowNullableFloat64Vector(undefined, table.numRows),
    layout_height:
      table.getChild('layout_height') ?? buildArrowNullableFloat64Vector(undefined, table.numRows),
    filter_mask: buildArrowUint8Vector(filterMask, table.numRows),
    rowCount: table.numRows
  });
}

const NOT_STARTED_BLOCK_DURATION_MS = 1_000;
const PARENT_DEPENDENCY_KEYWORD = 'PARENT';
const combinedBlockTableCache = new WeakMap<TraceGraphData, ArrowTraceSpanTable>();
const traceProcessSpanRefTableGenerationFloat64Scratch = new Float64Array(1);
const traceProcessSpanRefTableGenerationUint32Scratch = new Uint32Array(
  traceProcessSpanRefTableGenerationFloat64Scratch.buffer
);

type TraceProcessSpanRefTableColumns = {
  /** Stable encoded span refs in process-local scan order. */
  span_ref: SpanRef[];
  /** Optional layout top values aligned with span refs. */
  layout_top_y: Array<number | null>;
  /** Optional layout heights aligned with span refs. */
  layout_height: Array<number | null>;
  /** Filter masks aligned with span refs. */
  filter_mask: number[];
};

/** Minimal Arrow vector surface used while building process-local span-ref tables. */
type ColumnVector<Value> = {
  /** Returns the value stored at one Arrow row index. */
  get(index: number): Value | null | undefined;
};

/** Source span-table vectors reused while building process-local span-ref tables. */
type TraceProcessSpanRefSourceColumns = {
  /** Runtime process ref column. */
  readonly processRef: ColumnVector<unknown> | null;
  /** Optional layout top column. */
  readonly layoutTopY: ColumnVector<unknown> | null;
  /** Optional layout height column. */
  readonly layoutHeight: ColumnVector<unknown> | null;
};

/**
 * Builds or normalizes process-scoped chunks for a TraceGraphData.
 */
function buildArrowTraceChunks(params: {
  /** Optional caller-provided chunks to normalize against canonical table maps. */
  chunks?: readonly ArrowTraceChunk[];
  /** Metadata-only process rows in graph order. */
  processes: Readonly<ArrowTraceProcessMetadata[]>;
  /** Canonical process ids indexed by packed process/chunk slot. */
  processIdsByIndex: readonly TraceProcessId[];
  /** Canonical span tables keyed by process id. */
  spanTableMap: Readonly<Record<TraceProcessId, ArrowTraceSpanTable>>;
  /** Canonical dependency tables keyed by process id. */
  localDependencyTableMap: Readonly<Record<TraceProcessId, ArrowTraceLocalDependencyTable>>;
  /** Optional sidecar rows keyed by process id. */
  spanSidecarMap?: TraceSpanArrowSidecarMap;
  /** Optional sidecar tables keyed by process id. */
  spanSidecarTableMap?: ArrowTraceSpanSidecarTableMap;
}): readonly ArrowTraceChunk[] {
  const inputChunks =
    params.chunks ??
    params.processIdsByIndex.map(
      (processId, chunkIndex) =>
        ({
          chunkIndex,
          chunkRef: encodeChunkRef(chunkIndex),
          chunkKey: processId,
          processRefs: [encodeProcessRef(chunkIndex)],
          processId
        }) as Pick<
          ArrowTraceChunk,
          'chunkIndex' | 'chunkRef' | 'chunkKey' | 'processRefs' | 'processId'
        >
    );
  const chunks = [...inputChunks].sort(compareArrowTraceChunksByIndex);
  const processRefByProcessId = new Map(
    params.processIdsByIndex.map(
      (processId, processIndex) => [processId, encodeProcessRef(processIndex)] as const
    )
  );

  return chunks.map(chunk => {
    const processId = chunk.processId;
    if (processId == null) {
      return chunk as ArrowTraceChunk;
    }
    const spanTable = params.spanTableMap[processId];
    const localDependencyTable = params.localDependencyTableMap[processId];
    if (!spanTable || !localDependencyTable) {
      throw new Error(`Missing TraceGraphData tables for chunk ${processId}`);
    }
    const spanSidecarRows = params.spanSidecarMap?.[processId];
    const spanSidecarTable = params.spanSidecarTableMap?.[processId];
    const chunkSidecarRows = 'spanSidecarRows' in chunk ? chunk.spanSidecarRows : undefined;
    const hasCompatibleSidecarRows =
      chunkSidecarRows === spanSidecarRows ||
      (chunkSidecarRows !== undefined && chunkSidecarRows.length === spanTable.numRows);
    if (
      'spanTable' in chunk &&
      chunk.spanTable === spanTable &&
      chunk.localDependencyTable === localDependencyTable &&
      hasCompatibleSidecarRows &&
      chunk.spanSidecarTable === spanSidecarTable
    ) {
      return chunk;
    }
    return {
      ...chunk,
      processRefs:
        chunk.processRefs.length > 0
          ? chunk.processRefs
          : [processRefByProcessId.get(processId)].filter(
              (processRef): processRef is ProcessRef => processRef != null
            ),
      spanTable,
      localDependencyTable,
      spanSidecarRows,
      spanSidecarTable
    } satisfies ArrowTraceChunk;
  });
}

/** Orders row-backed chunks by the encoded chunk index expected by ref lookups. */
function compareArrowTraceChunksByIndex(
  left: Pick<ArrowTraceChunk, 'chunkIndex'>,
  right: Pick<ArrowTraceChunk, 'chunkIndex'>
): number {
  return left.chunkIndex - right.chunkIndex;
}

/** Creates mutable column buffers for one process SpanRef/layout index table. */
function createTraceProcessSpanRefColumns(): TraceProcessSpanRefTableColumns {
  return {
    span_ref: [],
    layout_top_y: [],
    layout_height: [],
    filter_mask: []
  };
}

/** Appends one chunk-backed global SpanRef to the matching process-local index columns. */
function appendTraceProcessSpanRefTableRow(params: {
  chunk: ArrowTraceChunk;
  processIdsByIndex: readonly TraceProcessId[];
  rowIndex: number;
  rowsByProcessId: Map<TraceProcessId, TraceProcessSpanRefTableColumns>;
  spanColumns: TraceProcessSpanRefSourceColumns;
  spanRef: SpanRef;
}): void {
  const processId = getTraceProcessSpanRefRowProcessId(
    params.chunk,
    params.rowIndex,
    params.processIdsByIndex,
    params.spanColumns.processRef
  );
  if (!processId) {
    return;
  }
  let columns = params.rowsByProcessId.get(processId);
  if (!columns) {
    columns = createTraceProcessSpanRefColumns();
    params.rowsByProcessId.set(processId, columns);
  }

  columns.span_ref.push(params.spanRef);
  columns.layout_top_y.push(
    normalizeArrowNumber(params.spanColumns.layoutTopY?.get(params.rowIndex))
  );
  columns.layout_height.push(
    normalizeArrowNumber(params.spanColumns.layoutHeight?.get(params.rowIndex))
  );
  columns.filter_mask.push(0);
}

/** Builds one Arrow process SpanRef/layout index table without copying span-name fields. */
function buildTraceProcessSpanRefTableFromColumns(
  columns: TraceProcessSpanRefTableColumns
): TraceProcessSpanRefTable {
  return buildTraceProcessSpanRefTableFromVectors({
    span_ref: buildArrowFloat64Vector(columns.span_ref),
    layout_top_y: buildArrowNullableFloat64Vector(columns.layout_top_y, columns.span_ref.length),
    layout_height: buildArrowNullableFloat64Vector(columns.layout_height, columns.span_ref.length),
    filter_mask: buildArrowUint8Vector(columns.filter_mask, columns.span_ref.length),
    rowCount: columns.span_ref.length
  });
}

/** Builds one process span-ref table from prebuilt Arrow vectors. */
function buildTraceProcessSpanRefTableFromVectors(params: {
  /** Stable encoded span refs in process-local scan order. */
  span_ref?: arrow.Vector<arrow.Float64> | null;
  /** Optional layout top values aligned with span refs. */
  layout_top_y?: arrow.Vector<arrow.Float64> | null;
  /** Optional layout heights aligned with span refs. */
  layout_height?: arrow.Vector<arrow.Float64> | null;
  /** Filter masks aligned with span refs. */
  filter_mask?: arrow.Vector<arrow.Uint8> | null;
  /** Number of process-local rows. */
  rowCount: number;
}): TraceProcessSpanRefTable {
  const table = new arrow.Table({
    span_ref: params.span_ref ?? buildArrowFloat64Vector(new Float64Array(params.rowCount)),
    layout_top_y:
      params.layout_top_y ?? buildArrowNullableFloat64Vector(undefined, params.rowCount),
    layout_height:
      params.layout_height ?? buildArrowNullableFloat64Vector(undefined, params.rowCount),
    filter_mask: params.filter_mask ?? buildArrowUint8Vector(undefined, params.rowCount)
  }) as unknown as TraceProcessSpanRefTable;
  Object.defineProperty(table, 'generation', {
    enumerable: true,
    value: computeTraceProcessSpanRefTableGeneration(table)
  });
  return table;
}

/** Computes a bounded numeric generation for process SpanRef/layout index reuse checks. */
function computeTraceProcessSpanRefTableGeneration(table: TraceProcessSpanRefTable): number {
  const spanRefColumn = table.getChild('span_ref');
  const layoutTopYColumn = table.getChild('layout_top_y');
  const layoutHeightColumn = table.getChild('layout_height');
  const filterMaskColumn = table.getChild('filter_mask');
  let hash = 2166136261;
  hash = updateTraceProcessSpanRefTableGenerationHash(hash, table.numRows);
  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    hash = updateTraceProcessSpanRefTableGenerationHash(
      hash,
      normalizeArrowNumber(spanRefColumn?.get(rowIndex)) ?? 0
    );
    hash = updateTraceProcessSpanRefTableNullableNumberGenerationHash(
      hash,
      normalizeArrowNumber(layoutTopYColumn?.get(rowIndex))
    );
    hash = updateTraceProcessSpanRefTableNullableNumberGenerationHash(
      hash,
      normalizeArrowNumber(layoutHeightColumn?.get(rowIndex))
    );
    hash = updateTraceProcessSpanRefTableGenerationHash(
      hash,
      normalizeArrowNumber(filterMaskColumn?.get(rowIndex)) ?? 0
    );
  }
  return hash >>> 0;
}

/** Updates one process-span table generation hash with a nullable 64-bit number. */
function updateTraceProcessSpanRefTableNullableNumberGenerationHash(
  hash: number,
  value: number | null
): number {
  if (value == null) {
    return updateTraceProcessSpanRefTableGenerationHash(hash, 0);
  }
  hash = updateTraceProcessSpanRefTableGenerationHash(hash, 1);
  traceProcessSpanRefTableGenerationFloat64Scratch[0] = value;
  hash = updateTraceProcessSpanRefTableGenerationHash(
    hash,
    traceProcessSpanRefTableGenerationUint32Scratch[0] ?? 0
  );
  return updateTraceProcessSpanRefTableGenerationHash(
    hash,
    traceProcessSpanRefTableGenerationUint32Scratch[1] ?? 0
  );
}

/** Updates one process-span table generation hash with one safe numeric value. */
function updateTraceProcessSpanRefTableGenerationHash(hash: number, value: number): number {
  hash ^= value & 0xffffffff;
  hash = Math.imul(hash, 16777619) >>> 0;
  hash ^= Math.floor(value / 0x100000000);
  return Math.imul(hash, 16777619) >>> 0;
}

/** Resolves the owning process id for one chunk span-table row. */
function getTraceProcessSpanRefRowProcessId(
  chunk: ArrowTraceChunk,
  rowIndex: number,
  processIdsByIndex: readonly TraceProcessId[],
  processRefColumn: ColumnVector<unknown> | null
): TraceProcessId | null {
  if (chunk.processId != null) {
    return chunk.processId;
  }
  const processRef = normalizeArrowNumber(processRefColumn?.get(rowIndex));
  if (processRef != null) {
    return processIdsByIndex[getProcessRefIndex(processRef as ProcessRef)] ?? null;
  }
  return null;
}

/** Extracts source span-table vectors used by process-local span-ref table construction. */
function readTraceProcessSpanRefSourceColumns(
  spanTable: ArrowTraceSpanTable
): TraceProcessSpanRefSourceColumns {
  return {
    processRef: getTraceProcessSpanRefSourceColumn(spanTable, 'process_ref'),
    layoutTopY: getTraceProcessSpanRefSourceColumn(spanTable, 'layout_top_y'),
    layoutHeight: getTraceProcessSpanRefSourceColumn(spanTable, 'layout_height')
  };
}

/** Resolves one source span-table vector by column name. */
function getTraceProcessSpanRefSourceColumn<Value>(
  table: ArrowTraceSpanTable,
  columnName: string
): ColumnVector<Value> | null {
  return (
    (
      table as unknown as {
        getChild(name: string): ColumnVector<Value> | null | undefined;
      }
    ).getChild(columnName) ?? null
  );
}

/**
 * Builds canonical process-local Arrow span tables from the span arrays embedded in compatibility
 * {@link TraceProcess} records.
 */
export function buildTraceSpanTablesByProcessId(
  processes: Readonly<TraceProcess[]>
): Readonly<Record<TraceProcessId, ArrowTraceSpanTable>> {
  return Object.fromEntries(
    processes.map((process, processIndex) => {
      const processRef = encodeProcessRef(processIndex);
      const threadRefByStreamId = new Map(
        process.threads.map(
          (thread, threadIndex) =>
            [thread.threadId, encodeProcessThreadRef(processIndex, threadIndex)] as const
        )
      );
      return [
        process.processId as TraceProcessId,
        buildArrowTraceSpanTableFromRows(
          process.spans.map(block =>
            toTraceSpanArrowRow(block, processRef, threadRefByStreamId.get(block.threadId) ?? null)
          )
        )
      ] as const;
    })
  ) as Readonly<Record<TraceProcessId, ArrowTraceSpanTable>>;
}

/**
 * Builds canonical process-local sidecar rows from the span arrays embedded in compatibility
 * {@link TraceProcess} records.
 */
export function buildTraceSpanSidecarsByProcessId(
  processes: Readonly<TraceProcess[]>,
  traceIdEncoder?: TraceIdEncoder,
  crossDependencies: ReadonlyArray<TraceCrossProcessDependency> = [],
  crossDependencyIdToIndexMap: Readonly<Record<TraceDependencyId, number>> = {}
): TraceSpanArrowSidecarMap {
  const resolvedTraceIdEncoder =
    traceIdEncoder ??
    new TraceIdEncoder(processes.map(process => process.processId as TraceProcessId));
  const sidecarMap = Object.fromEntries(
    processes.map(process => [
      process.processId as TraceProcessId,
      buildTraceSpanSidecarRows(
        process,
        resolvedTraceIdEncoder.getProcessIndex(process.processId as TraceProcessId)
      )
    ])
  ) as TraceSpanArrowSidecarMap;
  if (crossDependencies.length === 0) {
    return sidecarMap;
  }
  return attachCrossDependencyRefsToSpanSidecars({
    blockRowIndexByProcessId: buildSpanRowIndexesByProcessIdFromProcesses(processes),
    crossDependencies,
    crossDependencyIdToIndexMap,
    processes,
    processIdsByIndex: resolvedTraceIdEncoder.getProcessIdsByIndex(),
    spanSidecarMap: sidecarMap
  });
}

/**
 * Converts a compatibility {@link TraceSpan} span object into one serialized Arrow row.
 */
export function toTraceSpanArrowRow(
  block: TraceSpan,
  processRef: ProcessRef | null = null,
  threadRef: ThreadRef | null = null
): TraceSpanArrowRow {
  return {
    process_ref: processRef,
    thread_ref: threadRef,
    span_id: block.spanId,
    thread_id: block.threadId,
    name: block.name,
    source: getTraceSpanUserDataSource(block.userData),
    primary_timing_key: block.primaryTimingKey,
    status: block.timings[block.primaryTimingKey]?.status ?? 'finished',
    start_time_ms: block.timings[block.primaryTimingKey]?.startTimeMs ?? 0,
    end_time_ms: block.timings[block.primaryTimingKey]?.endTimeMs ?? 0,
    duration_ms: block.timings[block.primaryTimingKey]?.durationMs ?? 0,
    layout_top_y:
      typeof block.layoutTopY === 'number' && Number.isFinite(block.layoutTopY)
        ? block.layoutTopY
        : null,
    layout_height:
      typeof block.layoutHeight === 'number' && Number.isFinite(block.layoutHeight)
        ? block.layoutHeight
        : null
  };
}

/**
 * Converts a compatibility {@link TraceSpan} span object into one row-aligned sidecar payload.
 */
export function toTraceSpanArrowSidecarRow(block: TraceSpan): TraceSpanArrowSidecarRow {
  const incomingLocalDependencyRowIndexes: number[] = [];
  const outgoingLocalDependencyRowIndexes: number[] = [];
  const incomingCrossDependencyRefs: number[] = [];
  const outgoingCrossDependencyRefs: number[] = [];

  return {
    timings: block.timings,
    userData: block.userData,
    keywords: block.keywords ?? [],
    localDependencyIds: block.localDependencyIds,
    incomingLocalDependencyRowIndexes,
    outgoingLocalDependencyRowIndexes,
    incomingLocalDependencyRefs: [],
    outgoingLocalDependencyRefs: [],
    incomingCrossDependencyRefs,
    outgoingCrossDependencyRefs,
    crossProcessEndpointId: block.crossProcessEndpointId ?? null,
    crossProcessDependencyEndpoints: block.crossProcessDependencyEndpoints.map(endpoint => ({
      endpointId: endpoint.endpointId,
      spanId: endpoint.spanId,
      startRankNum: endpoint.startRankNum,
      endRankNum: endpoint.endRankNum,
      islandNum: endpoint.islandNum,
      waitTimeMs: endpoint.waitTimeMs,
      waiting: endpoint.waiting,
      waitNotFinished: endpoint.waitNotFinished,
      userData: endpoint.userData
    }))
  };
}

/**
 * Builds row-aligned sidecar payloads for one process and annotates each block with directional
 * process-local dependency row indexes.
 */
function buildTraceSpanSidecarRows(
  process: Readonly<TraceProcess>,
  processIndex: number
): readonly TraceSpanArrowSidecarRow[] {
  const sidecarRows = process.spans.map(block => toTraceSpanArrowSidecarRow(block));
  attachLocalDependencyRefsToSidecars({
    spans: process.spans,
    localDependencies: process.localDependencies,
    processIndex,
    sidecarRows
  });
  return sidecarRows;
}

/**
 * Annotates sidecar rows with directional process-local dependency row indexes and refs.
 */
function attachLocalDependencyRefsToSidecars(params: {
  spans: ReadonlyArray<Pick<TraceSpan, 'spanId'>>;
  localDependencies: ReadonlyArray<TraceLocalDependency>;
  sidecarRows: TraceSpanArrowSidecarRow[];
  processIndex: number;
}): void {
  const blockRowIndexById = new Map(
    params.spans.map((block, rowIndex) => [block.spanId, rowIndex] as const)
  );

  params.localDependencies.forEach((dependency, dependencyRowIndex) => {
    const dependencyRef = encodeLocalDependencyRef(
      encodeLocalSpanRef(params.processIndex, dependencyRowIndex)
    );
    const startRowIndex = blockRowIndexById.get(dependency.startSpanId);
    if (startRowIndex != null) {
      params.sidecarRows[startRowIndex]?.outgoingLocalDependencyRowIndexes.push(dependencyRowIndex);
      params.sidecarRows[startRowIndex]?.outgoingLocalDependencyRefs?.push(dependencyRef);
    }

    const endRowIndex = blockRowIndexById.get(dependency.endSpanId);
    if (endRowIndex != null) {
      params.sidecarRows[endRowIndex]?.incomingLocalDependencyRowIndexes.push(dependencyRowIndex);
      params.sidecarRows[endRowIndex]?.incomingLocalDependencyRefs?.push(dependencyRef);
    }
  });
}

/**
 * Ensures every provided sidecar row includes directional local and cross dependency refs.
 */
function attachDependencyRefsToSpanSidecars(params: {
  /** Cross-process dependencies to attach to source and destination span sidecars. */
  crossDependencies: ReadonlyArray<TraceCrossProcessDependency>;
  /** Stable cross-dependency indexes keyed by dependency id. */
  crossDependencyIdToIndexMap: Readonly<Record<TraceDependencyId, number>>;
  /** Metadata-only process rows used to resolve rank numbers. */
  processes: ReadonlyArray<Pick<ArrowTraceProcessMetadata, 'processId' | 'rankNum'>>;
  /** Process ids in runtime ref order. */
  processIdsByIndex: readonly TraceProcessId[];
  /** Row-aligned sidecar rows keyed by process id. */
  spanSidecarMap: TraceSpanArrowSidecarMap;
  /** Canonical span tables keyed by process id. */
  spanTableMap: Readonly<Record<TraceProcessId, ArrowTraceSpanTable>>;
}): TraceSpanArrowSidecarMap {
  const sidecarMapWithLocalRefs = attachLocalDependencyRefsToSpanSidecars({
    processIdsByIndex: params.processIdsByIndex,
    spanSidecarMap: params.spanSidecarMap
  });
  if (params.crossDependencies.length === 0) {
    return sidecarMapWithLocalRefs;
  }
  return attachCrossDependencyRefsToSpanSidecars({
    crossDependencies: params.crossDependencies,
    crossDependencyIdToIndexMap: params.crossDependencyIdToIndexMap,
    processes: params.processes,
    processIdsByIndex: params.processIdsByIndex,
    spanSidecarMap: sidecarMapWithLocalRefs,
    spanTableMap: params.spanTableMap
  });
}

/**
 * Ensures every provided sidecar row includes the directional dependency ref array when not already
 * populated.
 */
function attachLocalDependencyRefsToSpanSidecars(params: {
  processIdsByIndex: readonly TraceProcessId[];
  spanSidecarMap: TraceSpanArrowSidecarMap;
}): TraceSpanArrowSidecarMap {
  const processIndexById = new Map<TraceProcessId, number>();
  params.processIdsByIndex.forEach((processId, processIndex) => {
    processIndexById.set(processId, processIndex);
  });
  const sidecarMap = {...params.spanSidecarMap} as Record<
    TraceProcessId,
    readonly TraceSpanArrowSidecarRow[]
  >;

  for (const [processId, sidecarRows] of Object.entries(sidecarMap)) {
    const typedProcessId = processId as TraceProcessId;
    const processIndex = processIndexById.get(typedProcessId);
    if (processIndex == null) {
      continue;
    }
    sidecarMap[typedProcessId] = sidecarRows.map(sidecarRow => {
      const shouldBuildIncomingLocalDependencyRefs =
        sidecarRow.incomingLocalDependencyRefs == null ||
        (sidecarRow.incomingLocalDependencyRefs.length === 0 &&
          sidecarRow.incomingLocalDependencyRowIndexes.length > 0);
      const incomingLocalDependencyRefs = shouldBuildIncomingLocalDependencyRefs
        ? sidecarRow.incomingLocalDependencyRowIndexes.map(dependencyRowIndex =>
            encodeLocalDependencyRef(encodeLocalSpanRef(processIndex, dependencyRowIndex))
          )
        : sidecarRow.incomingLocalDependencyRefs;
      const shouldBuildOutgoingLocalDependencyRefs =
        sidecarRow.outgoingLocalDependencyRefs == null ||
        (sidecarRow.outgoingLocalDependencyRefs.length === 0 &&
          sidecarRow.outgoingLocalDependencyRowIndexes.length > 0);
      const outgoingLocalDependencyRefs = shouldBuildOutgoingLocalDependencyRefs
        ? sidecarRow.outgoingLocalDependencyRowIndexes.map(dependencyRowIndex =>
            encodeLocalDependencyRef(encodeLocalSpanRef(processIndex, dependencyRowIndex))
          )
        : sidecarRow.outgoingLocalDependencyRefs;

      if (
        sidecarRow.incomingLocalDependencyRefs === incomingLocalDependencyRefs &&
        sidecarRow.outgoingLocalDependencyRefs === outgoingLocalDependencyRefs
      ) {
        return sidecarRow;
      }

      return {
        ...sidecarRow,
        incomingLocalDependencyRefs,
        outgoingLocalDependencyRefs
      };
    });
  }

  return sidecarMap;
}

/**
 * Ensures every provided sidecar row includes directional cross-dependency refs.
 */
function attachCrossDependencyRefsToSpanSidecars(params: {
  /** Optional span row indexes keyed by process id and block id for unresolved span refs. */
  blockRowIndexByProcessId?: Readonly<Record<TraceProcessId, ReadonlyMap<TraceSpanId, number>>>;
  /** Cross-process dependencies to attach to source and destination span sidecars. */
  crossDependencies: ReadonlyArray<TraceCrossProcessDependency>;
  /** Stable cross-dependency indexes keyed by dependency id. */
  crossDependencyIdToIndexMap: Readonly<Record<TraceDependencyId, number>>;
  /** Metadata-only process rows used to resolve rank numbers. */
  processes: ReadonlyArray<Pick<ArrowTraceProcessMetadata, 'processId' | 'rankNum'>>;
  /** Process ids in packed span-ref order. */
  processIdsByIndex?: readonly TraceProcessId[];
  /** Row-aligned sidecar rows keyed by process id. */
  spanSidecarMap: TraceSpanArrowSidecarMap;
  /** Canonical span tables keyed by process id, used only when a dependency has no span ref. */
  spanTableMap?: Readonly<Record<TraceProcessId, ArrowTraceSpanTable>>;
}): TraceSpanArrowSidecarMap {
  if (params.crossDependencies.length === 0) {
    return params.spanSidecarMap;
  }

  const processIdByRankNum = new Map(
    params.processes.map(process => [process.rankNum, process.processId as TraceProcessId] as const)
  );
  const sidecarMap = {...params.spanSidecarMap} as Record<
    TraceProcessId,
    readonly TraceSpanArrowSidecarRow[]
  >;
  const copiedProcessIds = new Set<TraceProcessId>();
  let blockRowIndexByProcessId = params.blockRowIndexByProcessId;

  const getBlockRowIndexByProcessId = () => {
    blockRowIndexByProcessId ??= params.spanTableMap
      ? buildSpanRowIndexesByProcessIdFromTables(params.spanTableMap)
      : {};
    return blockRowIndexByProcessId;
  };

  const appendCrossDependencyRef = (params: {
    processId: TraceProcessId | null;
    rowIndex: number | null;
    fieldName: 'incomingCrossDependencyRefs' | 'outgoingCrossDependencyRefs';
    dependencyRef: number;
  }) => {
    const {processId, rowIndex, fieldName, dependencyRef} = params;
    if (processId == null || rowIndex == null) {
      return;
    }

    const currentRows = sidecarMap[processId];
    const currentRow = currentRows?.[rowIndex];
    if (!currentRows || !currentRow) {
      return;
    }

    const currentRefs = currentRow[fieldName] ?? [];
    if (currentRefs.includes(dependencyRef)) {
      return;
    }

    const nextRows = copiedProcessIds.has(processId)
      ? (sidecarMap[processId] as TraceSpanArrowSidecarRow[])
      : currentRows.slice();
    copiedProcessIds.add(processId);
    const nextRow = {
      ...currentRow,
      [fieldName]: [...currentRefs, dependencyRef]
    } satisfies TraceSpanArrowSidecarRow;
    nextRows[rowIndex] = nextRow;
    sidecarMap[processId] = nextRows;
  };

  params.crossDependencies.forEach((dependency, dependencyIndex) => {
    const dependencyRef = encodeCrossDependencyRef(
      params.crossDependencyIdToIndexMap[dependency.dependencyId] ?? dependencyIndex
    );
    const startLocation = getCrossDependencySpanSidecarLocation({
      spanId: dependency.startSpanId,
      blockRowIndexByProcessId: getBlockRowIndexByProcessId,
      processIdByRankNum,
      processIdsByIndex: params.processIdsByIndex,
      rankNum: dependency.startRankNum,
      spanRef: dependency.startSpanRef
    });
    const endLocation = getCrossDependencySpanSidecarLocation({
      spanId: dependency.endSpanId,
      blockRowIndexByProcessId: getBlockRowIndexByProcessId,
      processIdByRankNum,
      processIdsByIndex: params.processIdsByIndex,
      rankNum: dependency.endRankNum,
      spanRef: dependency.endSpanRef
    });

    appendCrossDependencyRef({
      processId: startLocation?.processId ?? null,
      rowIndex: startLocation?.rowIndex ?? null,
      fieldName: 'outgoingCrossDependencyRefs',
      dependencyRef
    });
    appendCrossDependencyRef({
      processId: endLocation?.processId ?? null,
      rowIndex: endLocation?.rowIndex ?? null,
      fieldName: 'incomingCrossDependencyRefs',
      dependencyRef
    });
  });

  return sidecarMap;
}

/**
 * Resolves the row-aligned sidecar location for one cross-dependency endpoint.
 */
function getCrossDependencySpanSidecarLocation(params: {
  /** Endpoint block id used when the packed span ref is unavailable. */
  spanId: TraceSpanId;
  /** Lazy block-id index getter for the fallback path. */
  blockRowIndexByProcessId: () => Readonly<
    Record<TraceProcessId, ReadonlyMap<TraceSpanId, number>>
  >;
  /** Process id lookup keyed by source rank number. */
  processIdByRankNum: ReadonlyMap<number, TraceProcessId>;
  /** Process ids in packed span-ref order. */
  processIdsByIndex?: readonly TraceProcessId[];
  /** Endpoint rank number. */
  rankNum: number;
  /** Packed span ref for the endpoint when already rebased into graph process order. */
  spanRef?: SpanRef;
}): {processId: TraceProcessId; rowIndex: number} | null {
  const processId = params.processIdByRankNum.get(params.rankNum);
  if (processId != null) {
    const rowIndex = params.blockRowIndexByProcessId()[processId]?.get(params.spanId);
    if (rowIndex != null) {
      return {processId, rowIndex};
    }
  }

  if (params.spanRef != null && params.processIdsByIndex) {
    const spanProcessId = getSpanRefProcessId(params.processIdsByIndex, params.spanRef);
    if (spanProcessId != null) {
      return {
        processId: spanProcessId,
        rowIndex: getSpanRefRowIndex(params.spanRef)
      };
    }
  }

  return null;
}

/**
 * Builds sparse directional cross-dependency refs keyed by exact span ref.
 */
function buildSpanCrossDependencyRefMap(params: {
  /** Cross-process dependencies to attach to endpoint span refs. */
  crossDependencies: ReadonlyArray<TraceCrossProcessDependency>;
  /** Stable cross-dependency indexes keyed by dependency id. */
  crossDependencyIdToIndexMap: Readonly<Record<TraceDependencyId, number>>;
}): TraceSpanCrossDependencyRefMap | undefined {
  if (params.crossDependencies.length === 0) {
    return undefined;
  }

  const incomingCrossDependencyRefsBySpanRef = new Map<SpanRef, CrossDependencyRef[]>();
  const outgoingCrossDependencyRefsBySpanRef = new Map<SpanRef, CrossDependencyRef[]>();
  params.crossDependencies.forEach((dependency, dependencyIndex) => {
    const dependencyRef = encodeCrossDependencyRef(
      params.crossDependencyIdToIndexMap[dependency.dependencyId] ?? dependencyIndex
    );
    const startSpanRef = dependency.startSpanRef ?? null;
    const endSpanRef = dependency.endSpanRef ?? null;
    if (startSpanRef != null) {
      appendMapArray(outgoingCrossDependencyRefsBySpanRef, startSpanRef, dependencyRef);
    }
    if (endSpanRef != null) {
      appendMapArray(incomingCrossDependencyRefsBySpanRef, endSpanRef, dependencyRef);
    }
  });

  return {
    incomingCrossDependencyRefsBySpanRef,
    outgoingCrossDependencyRefsBySpanRef
  };
}

/**
 * Appends a value to a mutable array-valued map.
 */
function appendMapArray<KeyT, ValueT>(map: Map<KeyT, ValueT[]>, key: KeyT, value: ValueT): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

/**
 * Builds span row indexes keyed by process id and block id from compatibility process spans.
 */
function buildSpanRowIndexesByProcessIdFromProcesses(
  processes: ReadonlyArray<Pick<TraceProcess, 'processId' | 'spans'>>
): Readonly<Record<TraceProcessId, ReadonlyMap<TraceSpanId, number>>> {
  return Object.fromEntries(
    processes.map(process => [
      process.processId as TraceProcessId,
      new Map(process.spans.map((block, rowIndex) => [block.spanId, rowIndex] as const))
    ])
  ) as Readonly<Record<TraceProcessId, ReadonlyMap<TraceSpanId, number>>>;
}

/**
 * Builds span row indexes keyed by process id and block id from canonical span tables.
 */
function buildSpanRowIndexesByProcessIdFromTables(
  spanTableMap: Readonly<Record<TraceProcessId, ArrowTraceSpanTable>>
): Readonly<Record<TraceProcessId, ReadonlyMap<TraceSpanId, number>>> {
  return Object.fromEntries(
    Object.entries(spanTableMap).map(([processId, spanTable]) => [
      processId,
      buildSpanRowIndexByBlockId(spanTable)
    ])
  ) as Readonly<Record<TraceProcessId, ReadonlyMap<TraceSpanId, number>>>;
}

/**
 * Builds span row indexes keyed by block id for one process-local span table.
 */
function buildSpanRowIndexByBlockId(
  spanTable: Readonly<ArrowTraceSpanTable>
): ReadonlyMap<TraceSpanId, number> {
  const spanIdColumn = spanTable.getChild('span_id');
  const rowIndexByBlockId = new Map<TraceSpanId, number>();
  for (let rowIndex = 0; rowIndex < spanTable.numRows; rowIndex += 1) {
    const spanId = spanIdColumn?.get(rowIndex) as TraceSpanId | null | undefined;
    if (spanId) {
      rowIndexByBlockId.set(spanId, rowIndex);
    }
  }
  return rowIndexByBlockId;
}

/**
 * Build one process-local Arrow span table from pre-serialized row objects.
 */
export function buildArrowTraceSpanTableFromRows(
  rows: ReadonlyArray<TraceSpanArrowRow>
): ArrowTraceSpanTable {
  return buildArrowTraceSpanTableFromColumns(rowsToTraceSpanArrowColumns(rows));
}

/**
 * Build one process-local Arrow span table from column-oriented span payloads.
 */
export function buildArrowTraceSpanTableFromColumns(
  columns: TraceSpanArrowColumns,
  vectorOverrides?: TraceSpanArrowVectorOverrides
): ArrowTraceSpanTable {
  const rowCount = columns.span_id.length;
  return new arrow.Table({
    process_ref: buildArrowUint64Vector(
      normalizeNullableNumberColumn(columns.process_ref, rowCount)
    ),
    thread_ref: buildArrowUint64Vector(normalizeNullableNumberColumn(columns.thread_ref, rowCount)),
    span_id: buildArrowUtf8Vector(columns.span_id),
    external_span_id: arrow.vectorFromArray(
      normalizeNullableStringColumn(columns.external_span_id, rowCount),
      new arrow.Utf8()
    ),
    thread_id: buildArrowUtf8Vector(columns.thread_id),
    name: vectorOverrides?.name ?? arrow.vectorFromArray(columns.name, new arrow.Utf8()),
    source: arrow.vectorFromArray(
      normalizeNullableStringColumn(columns.source, rowCount),
      new arrow.Utf8()
    ),
    primary_timing_key: buildArrowUtf8Vector(columns.primary_timing_key),
    status: buildArrowUtf8Vector(columns.status),
    start_time_ms: buildArrowFloat64Vector(columns.start_time_ms),
    end_time_ms: buildArrowFloat64Vector(columns.end_time_ms),
    duration_ms: buildArrowFloat64Vector(columns.duration_ms),
    layout_top_y: buildArrowNullableFloat64Vector(columns.layout_top_y, rowCount),
    layout_height: buildArrowNullableFloat64Vector(columns.layout_height, rowCount)
  }) as unknown as ArrowTraceSpanTable;
}

/**
 * Build one process-local Arrow span sidecar table from column-oriented sidecar payloads.
 */
export function buildArrowTraceSpanSidecarTableFromColumns(
  columns: TraceSpanArrowSidecarColumns
): ArrowTraceSpanSidecarTable {
  const rowCount = columns.incomingLocalDependencyRefs.length;
  const outgoingLocalDependencyRefs = normalizeSidecarListColumn(
    columns.outgoingLocalDependencyRefs,
    rowCount
  );
  const incomingLocalDependencyRefs = normalizeSidecarListColumn(
    columns.incomingLocalDependencyRefs,
    rowCount
  );
  const localDependencyRefs = columns.localDependencyRefs ?? undefined;
  const tableColumns = {
    incomingLocalDependencyRefs: buildArrowUint64ListVector(incomingLocalDependencyRefs),
    outgoingLocalDependencyRefs: buildArrowUint64ListVector(outgoingLocalDependencyRefs),
    keywords: buildArrowUtf8ListVector(normalizeSidecarListColumn(columns.keywords, rowCount)),
    crossProcessEndpointId: arrow.vectorFromArray(
      normalizeNullableStringColumn(columns.crossProcessEndpointId, rowCount),
      new arrow.Utf8()
    ),
    userDataJson: arrow.vectorFromArray(
      normalizeNullableStringColumn(columns.userDataJson, rowCount),
      new arrow.Utf8()
    )
  };
  if (localDependencyRefs) {
    Object.assign(tableColumns, {
      localDependencyRefs: buildArrowUint64ListVector(
        normalizeSidecarListColumn(localDependencyRefs, rowCount)
      )
    });
  }
  if (columns.incomingCrossDependencyRefs) {
    Object.assign(tableColumns, {
      incomingCrossDependencyRefs: buildArrowUint64ListVector(
        normalizeSidecarListColumn(columns.incomingCrossDependencyRefs, rowCount)
      )
    });
  }
  if (columns.outgoingCrossDependencyRefs) {
    Object.assign(tableColumns, {
      outgoingCrossDependencyRefs: buildArrowUint64ListVector(
        normalizeSidecarListColumn(columns.outgoingCrossDependencyRefs, rowCount)
      )
    });
  }
  if (columns.crossDependencyRefs) {
    Object.assign(tableColumns, {
      crossDependencyRefs: buildArrowUint64ListVector(
        normalizeSidecarListColumn(columns.crossDependencyRefs, rowCount)
      )
    });
  }

  return new arrow.Table(tableColumns) as unknown as ArrowTraceSpanSidecarTable;
}

/**
 * Builds an Arrow `List<Uint64>` vector for row-aligned compact dependency ref columns.
 */
export function buildArrowUint64ListVector(
  rows: ReadonlyArray<readonly number[]>
): arrow.Vector<arrow.List<arrow.Uint64>> {
  const offsets = new Int32Array(rows.length + 1);
  let valueCount = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    valueCount += rows[rowIndex]?.length ?? 0;
    offsets[rowIndex + 1] = valueCount;
  }

  const values = new BigUint64Array(valueCount);
  let valueIndex = 0;
  for (const row of rows) {
    for (const value of row) {
      values[valueIndex] = BigInt(value);
      valueIndex += 1;
    }
  }

  const type = new arrow.List(new arrow.Field('item', new arrow.Uint64(), false));
  const child = arrow.makeData({
    type: new arrow.Uint64(),
    length: values.length,
    nullCount: 0,
    data: values
  });
  return arrow.makeVector(
    arrow.makeData({
      type,
      length: rows.length,
      nullCount: 0,
      valueOffsets: offsets,
      child
    })
  ) as arrow.Vector<arrow.List<arrow.Uint64>>;
}

/**
 * Builds an Arrow `Uint64` vector for compact runtime refs.
 */
export function buildArrowUint64Vector(
  values: ReadonlyArray<number | null> | BigUint64Array
): arrow.Vector<arrow.Uint64> {
  if (values instanceof BigUint64Array) {
    return arrow.makeVector({
      type: new arrow.Uint64(),
      length: values.length,
      nullCount: 0,
      data: values
    }) as arrow.Vector<arrow.Uint64>;
  }

  return arrow.vectorFromArray(
    values.map(value => (value == null ? null : BigInt(value))),
    new arrow.Uint64()
  );
}

/**
 * Builds an Arrow `Uint8` vector for compact mask columns.
 */
function buildArrowUint8Vector(
  values: ReadonlyArray<number | null | undefined> | Uint8Array | undefined,
  rowCount: number
): arrow.Vector<arrow.Uint8> {
  if (values instanceof Uint8Array && values.length === rowCount) {
    return arrow.makeVector({
      type: new arrow.Uint8(),
      length: values.length,
      nullCount: 0,
      data: values
    }) as arrow.Vector<arrow.Uint8>;
  }

  const data = new Uint8Array(rowCount);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    data[rowIndex] = values?.[rowIndex] ?? 0;
  }
  return arrow.makeVector({
    type: new arrow.Uint8(),
    length: data.length,
    nullCount: 0,
    data
  }) as arrow.Vector<arrow.Uint8>;
}

/**
 * Builds an Arrow `Utf8` vector, using a flat ASCII buffer for common trace identifier columns.
 */
export function buildArrowUtf8Vector(values: ReadonlyArray<string>): arrow.Vector<arrow.Utf8> {
  const asciiData = buildAsciiUtf8Data(values);
  if (!asciiData) {
    return arrow.vectorFromArray(values, new arrow.Utf8());
  }
  return arrow.makeVector(
    arrow.makeData({
      type: new arrow.Utf8(),
      length: values.length,
      nullCount: 0,
      valueOffsets: asciiData.offsets,
      data: asciiData.data
    })
  ) as arrow.Vector<arrow.Utf8>;
}

/**
 * Builds an Arrow `Float64` vector, reusing typed arrays when the caller already owns one.
 */
export function buildArrowFloat64Vector(
  values: ReadonlyArray<number> | Float64Array
): arrow.Vector<arrow.Float64> {
  if (values instanceof Float64Array) {
    return arrow.makeVector({
      type: new arrow.Float64(),
      length: values.length,
      nullCount: 0,
      data: values
    }) as arrow.Vector<arrow.Float64>;
  }
  return arrow.vectorFromArray(values, new arrow.Float64());
}

/** Builds one graph-global Arrow event table from pre-serialized row objects. */
export function buildArrowTraceEventTableFromRows(
  rows: ReadonlyArray<TraceEventArrowRow>
): ArrowTraceEventTable {
  return buildArrowTraceEventTableFromRowsInternal(rows);
}

/** Builds one graph-global Arrow event table from column-oriented event payloads. */
export function buildArrowTraceEventTableFromColumns(
  columns: TraceEventArrowColumns
): ArrowTraceEventTable {
  return buildArrowTraceEventTableFromColumnsInternal(columns);
}

function buildLocalDependencyTablesByProcessId(
  processes: Readonly<ArrowTraceProcessMetadata[]>
): Readonly<Record<TraceProcessId, ArrowTraceLocalDependencyTable>> {
  return Object.fromEntries(
    processes.map(process => [
      process.processId as TraceProcessId,
      buildArrowTraceLocalDependencyTable(process.localDependencies ?? [])
    ])
  ) as Readonly<Record<TraceProcessId, ArrowTraceLocalDependencyTable>>;
}

/**
 * Builds one process-local Arrow dependency table from normalized local dependency objects.
 */
export function buildArrowTraceLocalDependencyTable(
  dependencies: ReadonlyArray<TraceLocalDependency>
): ArrowTraceLocalDependencyTable {
  return buildArrowTraceLocalDependencyTableFromColumns({
    dependencyRef: dependencies.map((_, rowIndex) =>
      encodeLocalDependencyRef(encodeLocalSpanRef(0, rowIndex))
    ),
    dependencyId: dependencies.map(dependency => dependency.dependencyId),
    startSpanRef: dependencies.map(dependency => dependency.startSpanRef ?? null),
    startSpanId: dependencies.map(dependency => dependency.startSpanId),
    endSpanRef: dependencies.map(dependency => dependency.endSpanRef ?? null),
    endSpanId: dependencies.map(dependency => dependency.endSpanId),
    waitMode: dependencies.map(dependency => dependency.waitMode),
    bidirectional: dependencies.map(dependency => dependency.bidirectional),
    waitTimeMs: dependencies.map(dependency => dependency.waitTimeMs),
    keywords: dependencies.map(dependency => Array.from(dependency.keywords)),
    hasParentKeyword: dependencies.map(dependency =>
      hasParentDependencyKeyword(dependency.keywords)
    )
  });
}

/**
 * Builds one process-local Arrow dependency table from column-oriented dependency payloads.
 */
export function buildArrowTraceLocalDependencyTableFromColumns(
  columns: TraceLocalDependencyArrowColumns
): ArrowTraceLocalDependencyTable {
  const rowCount = columns.dependencyId.length;
  return new arrow.Table({
    dependencyRef: buildArrowFloat64Vector(
      columns.dependencyRef ??
        columns.dependencyId.map((_, rowIndex) =>
          encodeLocalDependencyRef(encodeLocalSpanRef(0, rowIndex))
        )
    ),
    dependencyId: buildArrowUtf8Vector(columns.dependencyId),
    startSpanRef: buildArrowNullableFloat64Vector(columns.startSpanRef, rowCount),
    startSpanId: buildArrowUtf8Vector(columns.startSpanId),
    endSpanRef: buildArrowNullableFloat64Vector(columns.endSpanRef, rowCount),
    endSpanId: buildArrowUtf8Vector(columns.endSpanId),
    waitMode: buildArrowUtf8Vector(columns.waitMode),
    bidirectional: arrow.vectorFromArray(columns.bidirectional, new arrow.Bool()),
    waitTimeMs: buildArrowFloat64Vector(columns.waitTimeMs),
    keywords: buildArrowUtf8ListVector(
      columns.keywords ?? columns.hasParentKeyword.map(hasParent => (hasParent ? ['PARENT'] : []))
    ),
    hasParentKeyword: arrow.vectorFromArray(columns.hasParentKeyword, new arrow.Bool())
  }) as unknown as ArrowTraceLocalDependencyTable;
}

/**
 * Builds one graph-global Arrow cross-process dependency table from normalized dependencies.
 */
export function buildArrowTraceCrossDependencyTable(
  dependencies: ReadonlyArray<TraceCrossProcessDependency>
): ArrowTraceCrossDependencyTable {
  const columns = {
    dependencyId: [] as string[],
    endpointId: [] as string[],
    startRankNum: [] as number[],
    endRankNum: [] as number[],
    startSpanRef: [] as Array<number | null>,
    startSpanId: [] as string[],
    endSpanRef: [] as Array<number | null>,
    endSpanId: [] as string[],
    waitMode: [] as string[],
    bidirectional: [] as boolean[],
    topology: [] as string[],
    waitTimeMs: [] as number[],
    waiting: [] as boolean[],
    waitNotFinished: [] as boolean[],
    keywords: [] as string[][],
    hasParentKeyword: [] as boolean[]
  };
  for (const dependency of dependencies) {
    columns.dependencyId.push(dependency.dependencyId);
    columns.endpointId.push(dependency.endpointId);
    columns.startRankNum.push(dependency.startRankNum);
    columns.endRankNum.push(dependency.endRankNum);
    columns.startSpanRef.push(dependency.startSpanRef ?? null);
    columns.startSpanId.push(dependency.startSpanId);
    columns.endSpanRef.push(dependency.endSpanRef ?? null);
    columns.endSpanId.push(dependency.endSpanId);
    columns.waitMode.push(dependency.waitMode);
    columns.bidirectional.push(dependency.bidirectional);
    columns.topology.push(dependency.topology);
    columns.waitTimeMs.push(dependency.waitTimeMs);
    columns.waiting.push(dependency.waiting);
    columns.waitNotFinished.push(dependency.waitNotFinished);
    columns.keywords.push(Array.from(dependency.keywords));
    columns.hasParentKeyword.push(hasParentDependencyKeyword(dependency.keywords));
  }

  return new arrow.Table({
    dependencyId: arrow.vectorFromArray(columns.dependencyId, new arrow.Utf8()),
    endpointId: arrow.vectorFromArray(columns.endpointId, new arrow.Utf8()),
    startRankNum: arrow.vectorFromArray(columns.startRankNum, new arrow.Int32()),
    endRankNum: arrow.vectorFromArray(columns.endRankNum, new arrow.Int32()),
    startSpanRef: buildArrowNullableFloat64Vector(
      columns.startSpanRef,
      columns.dependencyId.length
    ),
    startSpanId: arrow.vectorFromArray(columns.startSpanId, new arrow.Utf8()),
    endSpanRef: buildArrowNullableFloat64Vector(columns.endSpanRef, columns.dependencyId.length),
    endSpanId: arrow.vectorFromArray(columns.endSpanId, new arrow.Utf8()),
    waitMode: arrow.vectorFromArray(columns.waitMode, new arrow.Utf8()),
    bidirectional: arrow.vectorFromArray(columns.bidirectional, new arrow.Bool()),
    topology: arrow.vectorFromArray(columns.topology, new arrow.Utf8()),
    waitTimeMs: arrow.vectorFromArray(columns.waitTimeMs, new arrow.Float64()),
    waiting: arrow.vectorFromArray(columns.waiting, new arrow.Bool()),
    waitNotFinished: arrow.vectorFromArray(columns.waitNotFinished, new arrow.Bool()),
    keywords: arrow.vectorFromArray(
      columns.keywords,
      new arrow.List(new arrow.Field('item', new arrow.Utf8()))
    ),
    hasParentKeyword: arrow.vectorFromArray(columns.hasParentKeyword, new arrow.Bool())
  }) as unknown as ArrowTraceCrossDependencyTable;
}

/**
 * Builds a deterministic map from cross-dependency id to stable packed dependency index.
 */
export function buildCrossDependencyIdToIndexMap(
  crossDependencies: ReadonlyArray<TraceCrossProcessDependency>
): Readonly<Record<TraceDependencyId, number>> {
  const indexByDependencyId = Object.create(null) as Record<TraceDependencyId, number>;
  crossDependencies.forEach((dependency, index) => {
    if (dependency.dependencyId != null && indexByDependencyId[dependency.dependencyId] == null) {
      indexByDependencyId[dependency.dependencyId] = index;
    }
  });
  return indexByDependencyId;
}

function hasParentDependencyKeyword(keywords: ReadonlySet<string>): boolean {
  for (const keyword of keywords) {
    if (keyword.toUpperCase() === PARENT_DEPENDENCY_KEYWORD) {
      return true;
    }
  }
  return false;
}

function buildThreadMap(
  processes: Readonly<ArrowTraceProcessMetadata[]>
): Record<TraceThreadId, TraceThread> {
  return processes.reduce(
    (acc, process) => {
      process.threads.forEach(thread => {
        acc[thread.threadId] = thread;
      });
      return acc;
    },
    {} as Record<TraceThreadId, TraceThread>
  );
}

function buildThreadInstantMap(
  processes: Readonly<ArrowTraceProcessMetadata[]>
): Record<TraceThreadId, TraceInstant[]> {
  return processes.reduce(
    (acc, process) => {
      Object.entries(process.threadInstantMap).forEach(([threadId, instants]) => {
        const key = threadId as TraceThreadId;
        const list = acc[key] ?? [];
        list.push(...instants);
        acc[key] = list;
      });
      return acc;
    },
    {} as Record<TraceThreadId, TraceInstant[]>
  );
}

function buildThreadCounterMap(
  processes: Readonly<ArrowTraceProcessMetadata[]>
): Record<TraceThreadId, TraceCounter[]> {
  return processes.reduce(
    (acc, process) => {
      Object.entries(process.threadCounterMap).forEach(([threadId, counters]) => {
        const key = threadId as TraceThreadId;
        const list = acc[key] ?? [];
        list.push(...counters);
        acc[key] = list;
      });
      return acc;
    },
    {} as Record<TraceThreadId, TraceCounter[]>
  );
}

function buildInstantMap(
  processes: Readonly<ArrowTraceProcessMetadata[]>
): Record<TraceInstantId, TraceInstant> {
  return processes.reduce(
    (acc, process) => Object.assign(acc, process.instantMap),
    {} as Record<TraceInstantId, TraceInstant>
  );
}

function buildCounterMap(
  processes: Readonly<ArrowTraceProcessMetadata[]>
): Record<TraceCounterId, TraceCounter> {
  return processes.reduce(
    (acc, process) => Object.assign(acc, process.counterMap),
    {} as Record<TraceCounterId, TraceCounter>
  );
}

function buildCounterExtents(
  threadCounterMap: Readonly<Record<TraceThreadId, TraceCounter[]>>
): Readonly<Record<TraceThreadId, {min: number; max: number}>> {
  return Object.entries(threadCounterMap).reduce(
    (acc, [threadId, counters]) => {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      counters.forEach(counter => {
        if (Number.isFinite(counter.totalValue)) {
          min = Math.min(min, counter.totalValue);
          max = Math.max(max, counter.totalValue);
        }
      });
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = 0;
        max = 0;
      }
      acc[threadId as TraceThreadId] = {min, max};
      return acc;
    },
    {} as Record<TraceThreadId, {min: number; max: number}>
  );
}

/**
 * Computes graph-wide TraceGraphData time extents from span timings, instants, counters, and events.
 */
export function computeArrowTraceTimeExtents(
  processes: Readonly<ArrowTraceProcessMetadata[]>,
  spanTableMap: Readonly<Record<TraceProcessId, ArrowTraceSpanTable>>,
  events: Readonly<ArrowTraceEventTable>
): {minTimeMs: number; maxTimeMs: number} {
  let minTimeMs = Number.MAX_SAFE_INTEGER;
  let finiteMaxTimeMs = Number.MIN_SAFE_INTEGER;

  for (const process of processes) {
    const table = spanTableMap[process.processId as TraceProcessId];
    if (!table) {
      continue;
    }
    const startTimeColumn = getColumn<number>(table, 'start_time_ms');
    const endTimeColumn = getColumn<number>(table, 'end_time_ms');
    const statusColumn = getColumn<string>(table, 'status');
    const rowCount = table?.numRows ?? 0;

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const startTimeMs = startTimeColumn?.get(rowIndex) ?? null;
      const endTimeMs = endTimeColumn?.get(rowIndex) ?? null;
      const status = statusColumn?.get(rowIndex) ?? null;
      if (!isTraceSpanTimingEligibleForTimeExtents({status, startTimeMs})) {
        continue;
      }
      const finiteStartTimeMs = startTimeMs as number;
      minTimeMs = Math.min(minTimeMs, finiteStartTimeMs);
      finiteMaxTimeMs = Math.max(finiteMaxTimeMs, finiteStartTimeMs);
      if (isTraceSpanTimingTimestampEligibleForTimeExtents(endTimeMs)) {
        const finiteEndTimeMs = endTimeMs as number;
        minTimeMs = Math.min(minTimeMs, finiteEndTimeMs);
        finiteMaxTimeMs = Math.max(finiteMaxTimeMs, finiteEndTimeMs);
      }
    }

    for (const instant of process.instants) {
      minTimeMs = Math.min(minTimeMs, instant.atTimeMs ?? Number.MAX_SAFE_INTEGER);
      finiteMaxTimeMs = Math.max(finiteMaxTimeMs, instant.atTimeMs ?? Number.MIN_SAFE_INTEGER);
    }
    for (const counter of process.counters) {
      minTimeMs = Math.min(minTimeMs, counter.atTimeMs ?? Number.MAX_SAFE_INTEGER);
      finiteMaxTimeMs = Math.max(finiteMaxTimeMs, counter.atTimeMs ?? Number.MIN_SAFE_INTEGER);
    }
  }
  const eventTimeColumn = events.getChild('atTimeMs');
  for (let rowIndex = 0; rowIndex < events.numRows; rowIndex += 1) {
    const atTimeMs = Number(eventTimeColumn?.get(rowIndex) ?? Number.NaN);
    if (!Number.isFinite(atTimeMs)) {
      continue;
    }
    minTimeMs = Math.min(minTimeMs, atTimeMs);
    finiteMaxTimeMs = Math.max(finiteMaxTimeMs, atTimeMs);
  }

  if (minTimeMs === Number.MAX_SAFE_INTEGER) {
    minTimeMs = 0;
  }
  if (finiteMaxTimeMs === Number.MIN_SAFE_INTEGER) {
    finiteMaxTimeMs = 0;
  }

  let maxTimeMs = finiteMaxTimeMs;
  for (const process of processes) {
    const table = spanTableMap[process.processId as TraceProcessId];
    if (!table) {
      continue;
    }
    const startTimeColumn = getColumn<number>(table, 'start_time_ms');
    const endTimeColumn = getColumn<number>(table, 'end_time_ms');
    const statusColumn = getColumn<string>(table, 'status');
    const rowCount = table?.numRows ?? 0;

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const startTimeMs = startTimeColumn?.get(rowIndex) ?? null;
      const status = statusColumn?.get(rowIndex) ?? null;
      if (!isTraceSpanTimingEligibleForTimeExtents({status, startTimeMs})) {
        continue;
      }
      const finiteStartTimeMs = startTimeMs as number;

      minTimeMs = Math.min(minTimeMs, finiteStartTimeMs);
      maxTimeMs = Math.max(
        maxTimeMs,
        resolveExtremalEndTime({
          startTimeMs: finiteStartTimeMs,
          endTimeMs: endTimeColumn?.get(rowIndex) ?? null,
          status,
          finiteMaxTimeMs
        })
      );
    }
  }

  return {minTimeMs, maxTimeMs};
}

function normalizeArrowTraceTimeExtents(
  timeExtents?: BuildTraceGraphDataOptions['timeExtents']
): BuildTraceGraphDataOptions['timeExtents'] | null {
  if (!timeExtents) {
    return null;
  }
  if (!Number.isFinite(timeExtents.minTimeMs) || !Number.isFinite(timeExtents.maxTimeMs)) {
    return null;
  }
  return {
    minTimeMs: Math.min(timeExtents.minTimeMs, timeExtents.maxTimeMs),
    maxTimeMs: Math.max(timeExtents.minTimeMs, timeExtents.maxTimeMs)
  };
}

function buildArrowTraceStats(
  processes: Readonly<ArrowTraceProcessMetadata[]>,
  crossDependencies: Readonly<TraceCrossProcessDependency[]>,
  spanTableMap: Readonly<Record<TraceProcessId, ArrowTraceSpanTable>>,
  localDependencyTableMap: Readonly<Record<TraceProcessId, ArrowTraceLocalDependencyTable>>,
  overrides?: BuildTraceGraphDataOptions['stats']
): TraceGraphStats {
  const processCount = processes.length;
  const threadCount = processes.reduce((total, process) => total + process.threads.length, 0);
  const laneCount = processes.reduce((total, process) => {
    return (
      total +
      process.threads.reduce((threadTotal, thread) => {
        const laneValue = (thread.userData as {laneCount?: number} | undefined)?.laneCount;
        if (typeof laneValue === 'number' && Number.isFinite(laneValue) && laneValue > 0) {
          return threadTotal + Math.floor(laneValue);
        }
        return threadTotal + 1;
      }, 0)
    );
  }, 0);

  let spanCount = 0;
  let notStartedSpanCount = 0;
  let unfinishedSpanCount = 0;

  for (const process of processes) {
    const table = spanTableMap[process.processId as TraceProcessId];
    if (!table) {
      continue;
    }
    const rowCount = table?.numRows ?? 0;
    const statusColumn = getColumn<string>(table, 'status');
    spanCount += rowCount;

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const status = statusColumn?.get(rowIndex) ?? null;
      if (status === 'not-started') {
        notStartedSpanCount += 1;
      } else if (status === 'not-finished') {
        unfinishedSpanCount += 1;
      }
    }
  }

  const localDependencyCount = processes.reduce((total, process) => {
    return total + (localDependencyTableMap[process.processId as TraceProcessId]?.numRows ?? 0);
  }, 0);
  const crossDependencyCount = crossDependencies.length;

  return {
    processCount: Math.max(0, overrides?.processCount ?? processCount),
    threadCount: Math.max(0, overrides?.threadCount ?? threadCount),
    laneCount: Math.max(0, overrides?.laneCount ?? laneCount),
    spanCount: Math.max(0, overrides?.spanCount ?? spanCount),
    localDependencyCount: Math.max(0, overrides?.localDependencyCount ?? localDependencyCount),
    notStartedSpanCount: Math.max(0, overrides?.notStartedSpanCount ?? notStartedSpanCount),
    unfinishedSpanCount: Math.max(0, overrides?.unfinishedSpanCount ?? unfinishedSpanCount),
    droppedSpanCount: Math.max(0, overrides?.droppedSpanCount ?? 0),
    dependencyCount: Math.max(
      0,
      overrides?.dependencyCount ?? localDependencyCount + crossDependencyCount
    ),
    droppedDependencyCount: Math.max(0, overrides?.droppedDependencyCount ?? 0),
    crossDependencyCount: Math.max(0, overrides?.crossDependencyCount ?? crossDependencyCount),
    droppedCrossDependencyCount: Math.max(0, overrides?.droppedCrossDependencyCount ?? 0)
  };
}

function resolveExtremalEndTime(params: {
  startTimeMs: number;
  endTimeMs: number | null;
  status: string | null;
  finiteMaxTimeMs: number;
}): number {
  if (
    Number.isFinite(params.endTimeMs) &&
    params.endTimeMs != null &&
    params.endTimeMs > params.startTimeMs
  ) {
    return params.endTimeMs;
  }
  if (params.status === 'not-finished') {
    return Math.max(params.finiteMaxTimeMs, params.startTimeMs + 1);
  }
  if (params.status === 'not-started') {
    return params.startTimeMs + NOT_STARTED_BLOCK_DURATION_MS;
  }
  return params.startTimeMs;
}

function getTraceSpanArrowSchema(): arrow.Schema {
  return new arrow.Schema([
    new arrow.Field('process_ref', new arrow.Uint64(), true),
    new arrow.Field('thread_ref', new arrow.Uint64(), true),
    new arrow.Field('span_id', new arrow.Utf8(), true),
    new arrow.Field('external_span_id', new arrow.Utf8(), true),
    new arrow.Field('thread_id', new arrow.Utf8(), true),
    new arrow.Field('name', new arrow.Utf8(), true),
    new arrow.Field('source', new arrow.Utf8(), true),
    new arrow.Field('primary_timing_key', new arrow.Utf8(), true),
    new arrow.Field('status', new arrow.Utf8(), true),
    new arrow.Field('start_time_ms', new arrow.Float64(), true),
    new arrow.Field('end_time_ms', new arrow.Float64(), true),
    new arrow.Field('duration_ms', new arrow.Float64(), true),
    new arrow.Field('layout_top_y', new arrow.Float64(), true),
    new arrow.Field('layout_height', new arrow.Float64(), true)
  ]);
}

/**
 * Normalizes an optional row-aligned list column to the requested sidecar row count.
 */
function normalizeSidecarListColumn<T>(
  column: ReadonlyArray<readonly T[]> | undefined,
  rowCount: number
): Array<readonly T[]> {
  return Array.from({length: rowCount}, (_, rowIndex) => column?.[rowIndex] ?? []);
}

/**
 * Normalizes an optional row-aligned nullable string column to the requested sidecar row count.
 */
function normalizeNullableStringColumn(
  column: ReadonlyArray<string | null | undefined> | undefined,
  rowCount: number
): Array<string | null> {
  return Array.from({length: rowCount}, (_, rowIndex) => column?.[rowIndex] ?? null);
}

/**
 * Normalizes an optional row-aligned nullable number column to the requested row count.
 */
function normalizeNullableNumberColumn(
  column: ReadonlyArray<number | null | undefined> | BigUint64Array | undefined,
  rowCount: number
): Array<number | null> | BigUint64Array {
  if (column instanceof BigUint64Array) {
    return column;
  }
  return Array.from({length: rowCount}, (_, rowIndex) => column?.[rowIndex] ?? null);
}

/**
 * Builds a nullable Float64 vector for optional span refs.
 */
function buildArrowNullableFloat64Vector(
  values: ReadonlyArray<number | null | undefined> | undefined,
  rowCount: number
): arrow.Vector<arrow.Float64> {
  return arrow.vectorFromArray(
    Array.from({length: rowCount}, (_, rowIndex) => values?.[rowIndex] ?? null),
    new arrow.Float64()
  );
}

/**
 * Builds an Arrow `List<Utf8>` vector for row-aligned keyword columns.
 */
function buildArrowUtf8ListVector(
  rows: ReadonlyArray<readonly string[]>
): arrow.Vector<arrow.List<arrow.Utf8>> {
  const listOffsets = new Int32Array(rows.length + 1);
  let childValueCount = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    childValueCount += rows[rowIndex]?.length ?? 0;
    listOffsets[rowIndex + 1] = childValueCount;
  }

  const flattenedValues = new Array<string>(childValueCount);
  let childValueIndex = 0;
  for (const row of rows) {
    for (const value of row) {
      flattenedValues[childValueIndex] = value;
      childValueIndex += 1;
    }
  }

  const asciiData = buildAsciiUtf8Data(flattenedValues);
  if (!asciiData) {
    return arrow.vectorFromArray(
      rows.map(row => [...row]),
      new arrow.List(new arrow.Field('item', new arrow.Utf8(), false))
    );
  }

  const child = arrow.makeData({
    type: new arrow.Utf8(),
    length: flattenedValues.length,
    nullCount: 0,
    valueOffsets: asciiData.offsets,
    data: asciiData.data
  });
  return arrow.makeVector(
    arrow.makeData({
      type: new arrow.List(new arrow.Field('item', new arrow.Utf8(), false)),
      length: rows.length,
      nullCount: 0,
      valueOffsets: listOffsets,
      child
    })
  ) as arrow.Vector<arrow.List<arrow.Utf8>>;
}

function buildAsciiUtf8Data(values: ReadonlyArray<string>): {
  offsets: Int32Array;
  data: Uint8Array;
} | null {
  const offsets = new Int32Array(values.length + 1);
  let byteLength = 0;
  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const value = values[rowIndex];
    if (typeof value !== 'string') {
      return null;
    }
    for (let charIndex = 0; charIndex < value.length; charIndex += 1) {
      if (value.charCodeAt(charIndex) > 0x7f) {
        return null;
      }
    }
    byteLength += value.length;
    offsets[rowIndex + 1] = byteLength;
  }

  const data = new Uint8Array(byteLength);
  let byteOffset = 0;
  for (const value of values) {
    for (let charIndex = 0; charIndex < value.length; charIndex += 1) {
      data[byteOffset] = value.charCodeAt(charIndex);
      byteOffset += 1;
    }
  }
  return {offsets, data};
}

/**
 * Convert row-oriented span payloads into column-oriented Arrow span payloads.
 */
function rowsToTraceSpanArrowColumns(
  rows: ReadonlyArray<TraceSpanArrowRow>
): TraceSpanArrowColumns {
  return rows.reduce<TraceSpanArrowColumns>((columns, row) => {
    columns.process_ref ??= [];
    columns.thread_ref ??= [];
    columns.process_ref.push(row.process_ref ?? null);
    columns.thread_ref.push(row.thread_ref ?? null);
    columns.span_id.push(row.span_id);
    columns.external_span_id ??= [];
    columns.external_span_id.push(row.external_span_id ?? null);
    columns.thread_id.push(row.thread_id);
    columns.name.push(row.name);
    columns.source ??= [];
    columns.source.push(row.source ?? null);
    columns.primary_timing_key.push(row.primary_timing_key);
    columns.status.push(row.status);
    columns.start_time_ms.push(row.start_time_ms);
    columns.end_time_ms.push(row.end_time_ms);
    columns.duration_ms.push(row.duration_ms);
    columns.layout_top_y ??= [];
    columns.layout_height ??= [];
    columns.layout_top_y.push(row.layout_top_y ?? null);
    columns.layout_height.push(row.layout_height ?? null);
    return columns;
  }, createTraceSpanArrowColumns());
}

/**
 * Create an empty column-oriented span payload container.
 */
function createTraceSpanArrowColumns(): TraceSpanArrowColumns {
  return {
    process_ref: [],
    thread_ref: [],
    span_id: [],
    external_span_id: [],
    thread_id: [],
    name: [],
    source: [],
    primary_timing_key: [],
    status: [],
    start_time_ms: [],
    end_time_ms: [],
    duration_ms: [],
    layout_top_y: [],
    layout_height: []
  };
}

/** Normalizes optional public layout mode metadata for Arrow-backed runtime consumers. */
function normalizeArrowTraceSpanLayoutMode(spanLayout?: TraceSpanLayoutMode): TraceSpanLayoutMode {
  return spanLayout === 'manual' ? 'manual' : 'auto';
}

function getColumn<T>(table: ArrowTraceSpanTable, columnName: string) {
  const column = (table as unknown as {getChild(name: string): unknown}).getChild(columnName);
  return (column ?? null) as {get(index: number): T | null | undefined} | null;
}

/** Normalizes one Arrow numeric cell into a finite JavaScript number. */
function normalizeArrowNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }
  return null;
}
