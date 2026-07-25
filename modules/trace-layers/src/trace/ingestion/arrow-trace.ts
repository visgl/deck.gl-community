import * as arrow from 'apache-arrow';

import {
  buildArrowTraceEventTableFromColumns as buildArrowTraceEventTableFromColumnsInternal,
  buildArrowTraceEventTableFromRows as buildArrowTraceEventTableFromRowsInternal,
  buildTraceEventMap
} from '../trace-graph/trace-event-table';
import {
  encodeChunkRef,
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef,
  getProcessRefIndex,
  TraceIdEncoder
} from '../trace-graph/trace-id-encoder';
import {getTraceSpanUserDataSource} from '../trace-graph/trace-span-user-data-fields';
import {
  isTraceSpanTimingEligibleForTimeExtents,
  isTraceSpanTimingTimestampEligibleForTimeExtents
} from '../trace-time-extents';
import {serializeArrowTraceJson} from './arrow-trace-json';
import {materializeJSONTrace} from './json-trace';
import {
  encodeTraceDependencyKeywordFlags,
  encodeTraceDependencyWaitModeCode
} from './trace-dependency-arrow-fields';
import {
  decodeTraceSpanTimingStatusCode,
  encodeTraceSpanTimingStatusCode
} from './trace-span-timing-status-code';

import type {TraceChunkData} from '../trace-chunk-data';
import type {
  ArrowTraceEventTable,
  TraceEventArrowColumns,
  TraceEventArrowRow
} from '../trace-graph/trace-event-table';
import type {ChunkRef, ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
import type {
  SpanRef,
  TraceCounter,
  TraceCounterId,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceEvent,
  TraceEventId,
  TraceInstant,
  TraceInstantId,
  TraceProcess,
  TraceProcessId,
  TraceSameProcessDependency,
  TraceSpan,
  TraceSpanAttributePath,
  TraceSpanId,
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
 * Canonical span storage lives in dataset chunks;
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
   * Legacy compatibility same-process dependencies. Arrow-backed runtime code should read
   * `sameProcessDependencyTableMap` instead of requiring this object array.
   */
  sameProcessDependencies?: TraceSameProcessDependency[];
};

/**
 * Apache Arrow schema describing one hot-path process-local span table stored within a
 * canonical dataset chunks.
 *
 * This table intentionally keeps only the scalar fields needed by filtering, visible-index
 * construction, and layout. Richer compatibility/display payloads live in the optional
 * row-aligned sidecar map.
 */
export type ArrowTraceSpanTable = arrow.Table<{
  /**
   * Canonical runtime process ref owning this span row.
   *
   * Runtime refs are safe JavaScript integers, so Float64 preserves every value exactly while
   * exposing a number-native Arrow buffer to layout and render hot paths.
   */
  process_ref: arrow.Float64;
  /**
   * Canonical runtime thread ref owning this span row.
   *
   * Runtime refs are safe JavaScript integers, so Float64 preserves every value exactly while
   * exposing a number-native Arrow buffer to layout and render hot paths.
   */
  thread_ref: arrow.Float64;
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
  /** Compact completion status for the primary timing projection. */
  status_code: arrow.Uint8;
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
 * process-local row order plus layout columns that need geometry-row alignment. Rows are sorted by
 * ascending `span_ref`; accessors depend on that invariant for binary-search lookup from a
 * chunk-local `SpanRef` back to this process-local row.
 */
export type TraceProcessSpanRefTable = arrow.Table<{
  /** Stable encoded span ref for the process-local row, sorted ascending within the table. */
  span_ref: arrow.Float64;
  /** Optional thread-relative top edge used by manual span layout. */
  layout_top_y: arrow.Float64;
  /** Optional rendered height used by manual span layout. */
  layout_height: arrow.Float64;
}>;

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
 * canonical dataset chunks.
 *
 * This table is reserved for generic trace-graph-compatible scalar/list metadata. It intentionally
 * avoids nested endpoint payloads such as `List<Struct<...>>`; structured endpoint payloads remain
 * in compatibility JS sidecars until a normalized endpoint table model is designed.
 */
type ArrowTraceSpanSidecarTableTypeMap = arrow.TypeMap & {
  /** Keyword labels shown in cards, search, and filters. */
  keywords: arrow.List<arrow.Utf8>;
  /** Optional unresolved cross-process endpoint id. */
  crossProcessEndpointId: arrow.Utf8;
  /** Optional JSON-serialized user-data payload. */
  userDataJson: arrow.Utf8;
  /** Arrow-native non-primary timing projections keyed by timing name. */
  timings?: arrow.Struct<arrow.TypeMap>;
  /** Compatibility-only legacy JSON timing maps read from older Arrow payloads. */
  timingsJson?: arrow.Utf8;
};

/** Row-aligned Arrow sidecar storage for compatibility/detail span fields. */
export type ArrowTraceSpanSidecarTable = arrow.Table<ArrowTraceSpanSidecarTableTypeMap>;

type ArrowTraceSameProcessDependencyTableTypeMap = arrow.TypeMap & {
  /** Canonical runtime source span ref for the dependency edge. */
  startSpanRef: arrow.Float64;
  /** Canonical runtime destination span ref for the dependency edge. */
  endSpanRef: arrow.Float64;
  /** Compact closed-domain wait-mode discriminator used by hot geometry. */
  waitModeCode: arrow.Uint8;
  /** Whether the dependency is bidirectional. */
  bidirectional: arrow.Bool;
  /** Wait duration in milliseconds. */
  waitTimeMs: arrow.Float64;
  /** Keyword labels attached to the dependency source block. */
  keywords: arrow.List<arrow.Utf8>;
  /** Compact hot predicates for parent and submit keyword reads. */
  keywordFlags: arrow.Uint8;
  /** Optional JSON-serialized app-owned dependency payload. */
  userDataJson?: arrow.Utf8;
};

/**
 * Apache Arrow schema describing one hot-path same-process dependency table stored within an
 * canonical dataset chunks.
 *
 * Ref-native tables may omit compatibility `dependencyId`, `startSpanId`, and `endSpanId` Utf8
 * columns; accessors derive those strings lazily from refs when callers still need them.
 */
export type ArrowTraceSameProcessDependencyTable =
  arrow.Table<ArrowTraceSameProcessDependencyTableTypeMap>;

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
  /** Resolved same-process Arrow dependency table owned by this storage chunk. */
  readonly resolvedSameProcessDependencyTable: ArrowTraceSameProcessDependencyTable;
  /** Optional row-aligned Arrow sidecar table for this chunk. */
  readonly spanSidecarTable?: ArrowTraceSpanSidecarTable;
};

/**
 * Returns the number of published span rows represented by one canonical chunk.
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
 * canonical datasets.
 */
export type ArrowTraceCrossProcessDependencyTable = arrow.Table<{
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
  /** Optional JSON-serialized app-owned dependency payload. */
  userDataJson?: arrow.Utf8;
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
  /** Primary timing key already stored in the hot span table. */
  primaryTimingKey?: string;
  /** Full timing projections keyed by timing source. */
  timings?: Record<string, TraceSpanTiming>;
  /** Compatibility user data payload. */
  userData?: Record<string, unknown>;
  /** Keyword labels shown in cards, search, and filters. */
  keywords: string[];
  /** Ingestion-only dependency identifiers touching the span before Arrow adjacency is built. */
  sameProcessDependencyIds: string[];
  /** Ingestion-only dependency row indexes where this span is the dependency destination. */
  incomingSameProcessDependencyRowIndexes: number[];
  /** Ingestion-only dependency row indexes where this span is the dependency source. */
  outgoingSameProcessDependencyRowIndexes: number[];
  /** Ingestion-only compact same-process refs where this span is the dependency destination. */
  incomingSameProcessDependencyRefs?: number[];
  /** Ingestion-only compact same-process refs where this span is the dependency source. */
  outgoingSameProcessDependencyRefs?: number[];
  /** Ingestion-only compact cross-process refs where this span is the dependency destination. */
  incomingCrossProcessDependencyRefs?: number[];
  /** Ingestion-only compact cross-process refs where this span is the dependency source. */
  outgoingCrossProcessDependencyRefs?: number[];
  /** Optional unresolved cross-rank endpoint id. */
  crossProcessEndpointId: TraceCrossProcessEndpointId | null;
  /** Structured unresolved cross-rank endpoints attached to the span. */
  crossProcessDependencyEndpoints: TraceSpanArrowSidecarEndpoint[];
};

/** Row-aligned ingestion staging payloads keyed by process id. */
type TraceSpanArrowSidecarRowMap = Readonly<
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
  status: TraceSpanTiming['status'];
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
  /** Canonical runtime process refs owning span rows, optionally already in borrowed Float64 form. */
  process_ref?: Array<number | null> | Float64Array;
  /** Canonical runtime thread refs owning span rows, optionally already in borrowed Float64 form. */
  thread_ref?: Array<number | null> | Float64Array;
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
  status: Array<TraceSpanTiming['status']>;
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

/** Mutable row-builder span columns whose owner refs have not yet become Arrow buffers. */
type MutableTraceSpanArrowColumns = Omit<TraceSpanArrowColumns, 'process_ref' | 'thread_ref'> & {
  /** Mutable canonical runtime process refs appended while lowering row payloads. */
  process_ref: Array<number | null>;
  /** Mutable canonical runtime thread refs appended while lowering row payloads. */
  thread_ref: Array<number | null>;
};

/** Options for adding declared primitive attribute columns to one span table. */
export type BuildArrowTraceSpanTableOptions = {
  /** Declared tuple paths to project from source rows into optional Arrow columns. */
  declaredSpanAttributePaths?: readonly TraceSpanAttributePath[];
  /** Row-aligned attribute sources used only for declared path projection. */
  spanAttributeRows?: readonly (Record<string, unknown> | undefined)[];
};

/**
 * Column-oriented Arrow span sidecar payload used to build one {@link ArrowTraceSpanSidecarTable}.
 */
export type TraceSpanArrowSidecarColumns = {
  /** Number of row-aligned span sidecar rows represented by these columns. */
  rowCount: number;
  /** Keyword labels for each span. */
  keywords?: Array<readonly string[]>;
  /** Optional unresolved cross-rank endpoint ids for each span. */
  crossProcessEndpointId?: Array<TraceCrossProcessEndpointId | string | null>;
  /** Optional JSON-serialized user-data payloads for each span. */
  userDataJson?: Array<string | null>;
  /** Optional Arrow-native non-primary timing projections keyed by timing name. */
  timings?: Readonly<Record<string, TraceSpanArrowTimingProjectionColumns>>;
  /** Compatibility-only legacy JSON timing maps read from older Arrow payloads. */
  timingsJson?: Array<string | null>;
};

/** Columnar values for one Arrow-native secondary timing projection. */
export type TraceSpanArrowTimingProjectionColumns = {
  /** Compact completion-status codes aligned with sidecar rows. */
  statusCode: Array<number | null>;
  /** Timing start values in milliseconds aligned with sidecar rows. */
  startTimeMs: Array<number | null>;
  /** Timing end values in milliseconds aligned with sidecar rows. */
  endTimeMs: Array<number | null>;
  /** Timing duration values in milliseconds aligned with sidecar rows. */
  durationMs: Array<number | null>;
};

/**
 * Column-oriented same-process dependency payload used to build one
 * {@link ArrowTraceSameProcessDependencyTable}.
 */
export type TraceSameProcessDependencyArrowColumns = {
  /** Optional stable dependency identifiers in same-process dependency row order. */
  dependencyId?: string[];
  /** Dependency source span refs. */
  startSpanRef?: Array<number | null>;
  /** Optional dependency source block ids. */
  startSpanId?: string[];
  /** Dependency destination span refs. */
  endSpanRef?: Array<number | null>;
  /** Optional dependency destination block ids. */
  endSpanId?: string[];
  /** Wait-mode discriminator used by geometry and cards. */
  waitMode: TraceSameProcessDependency['waitMode'][];
  /** Whether each dependency is bidirectional. */
  bidirectional: boolean[];
  /** Wait durations in milliseconds. */
  waitTimeMs: number[];
  /** Keyword labels attached to each dependency. */
  keywords?: Array<readonly string[]>;
  /** Whether each dependency has the parent keyword. */
  hasParentKeyword: boolean[];
  /** Optional JSON-serialized app-owned payloads. */
  userDataJson?: Array<string | null>;
};

type TraceSpanArrowVectorOverrides = {
  /** Optional prebuilt display-name vector to reuse when it already matches span row order. */
  name?: arrow.Vector<arrow.Utf8>;
};

/** Options for projecting declared primitive attributes into parser-local span chunks. */
export type BuildTraceChunkDataOptions = {
  /** Declared primitive span attribute paths carried by the emitted span tables. */
  readonly declaredSpanAttributePaths?: readonly TraceSpanAttributePath[];
};

/** Low-cardinality metadata maps derived from canonical process and event metadata. */
export type TraceGraphMetadataMaps = {
  /** Threads keyed by source thread id. */
  readonly threadMap: Record<TraceThreadId, TraceThread>;
  /** Instant events grouped by owning thread id. */
  readonly threadInstantMap: Record<TraceThreadId, TraceInstant[]>;
  /** Counter samples grouped by owning thread id. */
  readonly threadCounterMap: Record<TraceThreadId, TraceCounter[]>;
  /** Instant events keyed by event id. */
  readonly instantMap: Readonly<Record<TraceInstantId, TraceInstant>>;
  /** Counter samples keyed by counter id. */
  readonly counterMap: Readonly<Record<TraceCounterId, TraceCounter>>;
  /** Counter min/max extents keyed by thread id. */
  readonly counterExtents: Readonly<Record<TraceThreadId, {min: number; max: number}>>;
  /** Global events keyed by event id. */
  readonly eventMap: Readonly<Record<TraceEventId, TraceEvent>>;
};

/**
 * Builds low-cardinality runtime metadata maps from canonical process and event metadata.
 *
 * This helper intentionally does not inspect span or dependency tables. Dataset-backed runtime
 * projections use it after the dataset boundary has already finalized row-heavy Arrow storage.
 */
export function buildTraceGraphMetadataMaps(
  processes: Readonly<ArrowTraceProcessMetadata[]>,
  events: Readonly<ArrowTraceEventTable>
): TraceGraphMetadataMaps {
  const threadMap = buildThreadMap(processes);
  const threadInstantMap = buildThreadInstantMap(processes);
  const threadCounterMap = buildThreadCounterMap(processes);
  const instantMap = buildInstantMap(processes);
  const counterMap = buildCounterMap(processes);
  const counterExtents = buildCounterExtents(threadCounterMap);
  const eventMap = buildTraceEventMap(events);
  return {
    threadMap,
    threadInstantMap,
    threadCounterMap,
    instantMap,
    counterMap,
    counterExtents,
    eventMap
  };
}

/**
 * Convert a plain or materialized {@link JSONTrace} into parser-local chunk payloads.
 */
export function buildTraceChunkDataFromJSONTrace(
  traceGraph: Readonly<JSONTrace> | Readonly<MaterializedJSONTrace>,
  options: BuildTraceChunkDataOptions = {}
): TraceChunkData[] {
  const materializedTraceGraph = materializeJSONTrace(traceGraph);
  return buildTraceChunkDataFromTraceProcesses(materializedTraceGraph.processes, options);
}

/**
 * Convert normalized compatibility processes into parser-local chunk payloads.
 *
 * This is the narrow static-ingestion boundary for callers that already own materialized
 * processes. It preserves process-local Arrow table identity inside each returned chunk and does
 * not first construct a legacy graph snapshot merely to reverse it back into chunk input.
 */
export function buildTraceChunkDataFromTraceProcesses(
  traceProcesses: ReadonlyArray<TraceProcess>,
  options: BuildTraceChunkDataOptions = {}
): TraceChunkData[] {
  const processes = traceProcesses.map(toArrowTraceProcessMetadata);
  const traceIdEncoder = new TraceIdEncoder(
    traceProcesses.map(process => process.processId as TraceProcessId)
  );
  const spanTableMap = buildTraceSpanTablesByProcessId(traceProcesses, options);
  const sourceSameProcessDependencyTableMap =
    buildSameProcessDependencyTablesByProcessId(processes);
  const spanSidecarTableMap = buildTraceSpanSidecarTablesByProcessId(traceProcesses);
  const sourceChunks = buildArrowTraceChunks({
    processes,
    processIdsByIndex: traceIdEncoder.getProcessIdsByIndex(),
    spanTableMap,
    sameProcessDependencyTableMap: sourceSameProcessDependencyTableMap,
    spanSidecarTableMap
  });
  const dependencyEndpointSpanRefLookup = buildArrowTraceDependencyEndpointSpanRefLookup({
    chunks: sourceChunks,
    processIdsByIndex: traceIdEncoder.getProcessIdsByIndex(),
    processes
  });
  const sameProcessDependencyTableMap = canonicalizeArrowTraceSameProcessDependencyTableMap({
    dependencyEndpointSpanRefLookup,
    processIdsByIndex: traceIdEncoder.getProcessIdsByIndex(),
    sameProcessDependencyTableMap: sourceSameProcessDependencyTableMap
  });

  return traceProcesses.map((process, processIndex) => {
    const processId = process.processId as TraceProcessId;
    const processMetadata = processes[processIndex];
    const spanTable = spanTableMap[processId];
    const resolvedSameProcessDependencyTable = sameProcessDependencyTableMap[processId];
    if (!processMetadata || !spanTable || !resolvedSameProcessDependencyTable) {
      throw new Error(`Missing trace chunk tables for process ${processId}`);
    }
    return {
      type: 'trace-chunk-data',
      chunkKey: processId,
      processes: [stripArrowTraceProcessDependencyMetadata(processMetadata)],
      processId,
      spanTable,
      resolvedSameProcessDependencyTable,
      spanSidecarTable: spanSidecarTableMap[processId],
      crossProcessEndpointsByEndpointId: buildTraceChunkCrossProcessEndpointsByEndpointId(
        process,
        traceIdEncoder
      ),
      diagnostics: buildTraceChunkDataDiagnostics(spanTable),
      refState: 'parser-local'
    } satisfies TraceChunkData;
  });
}

/**
 * Build parser-local unresolved endpoint groups for one process-scoped chunk.
 *
 * Endpoint objects are sparse compatibility sidecars, so assigning the owning parser-local
 * `SpanRef` here keeps later store finalization and dataset assembly ref-native without opening
 * span rows again.
 */
function buildTraceChunkCrossProcessEndpointsByEndpointId(
  process: Pick<TraceProcess, 'processId' | 'spans'>,
  traceIdEncoder: TraceIdEncoder
): Readonly<Record<TraceCrossProcessEndpointId, readonly TraceCrossProcessEndpoint[]>> | undefined {
  const endpointGroups = {} as Record<TraceCrossProcessEndpointId, TraceCrossProcessEndpoint[]>;
  const processId = process.processId as TraceProcessId;
  for (const [rowIndex, span] of process.spans.entries()) {
    if (span.crossProcessDependencyEndpoints.length === 0) {
      continue;
    }
    const spanRef = traceIdEncoder.getSpanRef(processId, rowIndex);
    for (const endpoint of span.crossProcessDependencyEndpoints) {
      const endpoints = endpointGroups[endpoint.endpointId] ?? [];
      endpoints.push(endpoint.spanRef === spanRef ? endpoint : {...endpoint, spanRef});
      endpointGroups[endpoint.endpointId] = endpoints;
    }
  }
  return Object.keys(endpointGroups).length === 0 ? undefined : endpointGroups;
}

/**
 * Build parser-local diagnostics for one normalized span table.
 */
function buildTraceChunkDataDiagnostics(
  spanTable: ArrowTraceSpanTable
): TraceChunkData['diagnostics'] {
  const summary = computeArrowTraceSpanTableDiagnostics(spanTable);
  return {
    rowCount: spanTable.numRows,
    notStartedSpanCount: summary.notStartedSpanCount,
    unfinishedSpanCount: summary.unfinishedSpanCount,
    invalidRecordCount: 0,
    minTimeMs: summary.minTimeMs,
    maxTimeMs: summary.maxTimeMs,
    warningCounters: {}
  };
}

/**
 * Compute exact status counts and finite timing bounds for one chunk-local span table.
 *
 * The max bound mirrors graph-wide extent semantics: unfinished rows without a later finite end
 * contribute at least one millisecond past their start, while not-started rows stay excluded from
 * timing bounds. Aggregating these chunk summaries with event/process timestamps therefore yields
 * the same extrema as rereading every span row at dataset assembly time.
 */
function computeArrowTraceSpanTableDiagnostics(spanTable: ArrowTraceSpanTable): {
  /** Number of canonical not-started rows. */
  readonly notStartedSpanCount: number;
  /** Number of canonical unfinished rows. */
  readonly unfinishedSpanCount: number;
  /** Earliest finite canonical timing bound, when one exists. */
  readonly minTimeMs: number | null;
  /** Latest finite canonical timing bound, when one exists. */
  readonly maxTimeMs: number | null;
} {
  const startTimeColumn = getColumn<number>(spanTable, 'start_time_ms');
  const endTimeColumn = getColumn<number>(spanTable, 'end_time_ms');
  const statusCodeColumn = getColumn<number>(spanTable, 'status_code');
  let minTimeMs = Number.POSITIVE_INFINITY;
  let finiteMaxTimeMs = Number.NEGATIVE_INFINITY;
  let unfinishedMaxTimeMs = Number.NEGATIVE_INFINITY;
  let notStartedSpanCount = 0;
  let unfinishedSpanCount = 0;

  for (let rowIndex = 0; rowIndex < spanTable.numRows; rowIndex += 1) {
    const startTimeMs = startTimeColumn?.get(rowIndex) ?? null;
    const endTimeMs = endTimeColumn?.get(rowIndex) ?? null;
    const status = decodeTraceSpanTimingStatusCode(statusCodeColumn?.get(rowIndex));
    if (status === 'not-started') {
      notStartedSpanCount += 1;
    } else if (status === 'not-finished') {
      unfinishedSpanCount += 1;
    }
    if (!isTraceSpanTimingEligibleForTimeExtents({status, startTimeMs})) {
      continue;
    }
    const finiteStartTimeMs = startTimeMs as number;
    minTimeMs = Math.min(minTimeMs, finiteStartTimeMs);
    finiteMaxTimeMs = Math.max(finiteMaxTimeMs, finiteStartTimeMs);
    if (isTraceSpanTimingTimestampEligibleForTimeExtents(endTimeMs)) {
      minTimeMs = Math.min(minTimeMs, endTimeMs);
      finiteMaxTimeMs = Math.max(finiteMaxTimeMs, endTimeMs);
    }
    if (
      status === 'not-finished' &&
      (!isTraceSpanTimingTimestampEligibleForTimeExtents(endTimeMs) ||
        endTimeMs <= finiteStartTimeMs)
    ) {
      unfinishedMaxTimeMs = Math.max(unfinishedMaxTimeMs, finiteStartTimeMs + 1);
    }
  }

  const maxTimeMs = Math.max(finiteMaxTimeMs, unfinishedMaxTimeMs);
  return {
    notStartedSpanCount,
    unfinishedSpanCount,
    minTimeMs: Number.isFinite(minTimeMs) ? minTimeMs : null,
    maxTimeMs: Number.isFinite(maxTimeMs) ? maxTimeMs : null
  };
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
    sameProcessDependencies: process.sameProcessDependencies,
    remoteDependencies: process.remoteDependencies,
    userData: process.userData
  };
}

/**
 * Builds process-local SpanRef index tables from chunk-backed span storage.
 *
 * Rows are emitted in ascending `SpanRef` order by scanning chunks by `chunkIndex` and then their
 * chunk-local row order. The sorted `span_ref` column is the lookup invariant used by
 * `getTraceGraphProcessSpanRowIndex(...)`; optional process-local layout columns stay row-aligned
 * with it.
 */
export function buildTraceProcessSpanRefTables(
  chunks: readonly ArrowTraceChunk[],
  processes: readonly Pick<ArrowTraceProcessMetadata, 'processId'>[],
  options?: BuildTraceProcessSpanRefTablesOptions
): Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>> {
  const processIdsByIndex =
    options?.processIdsByIndex ?? processes.map(process => process.processId as TraceProcessId);
  const sortedChunks = [...chunks].sort(compareArrowTraceChunksByIndex);
  const directProcessSpanTableMap =
    options?.spanRefs == null ? buildDirectTraceProcessSpanRefTables(sortedChunks) : {};
  const rowsByProcessId = new Map<TraceProcessId, TraceProcessSpanRefTableColumns>();
  for (const process of processes) {
    const processId = process.processId as TraceProcessId;
    if (!directProcessSpanTableMap[processId]) {
      rowsByProcessId.set(processId, createTraceProcessSpanRefColumns());
    }
  }

  const activeSpanRefs = options?.spanRefs ? new Set(options.spanRefs) : null;
  for (const chunk of sortedChunks) {
    if (chunk.processId != null && directProcessSpanTableMap[chunk.processId]) {
      continue;
    }
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
    processes.map(({processId}) => {
      const typedProcessId = processId as TraceProcessId;
      return [
        typedProcessId,
        directProcessSpanTableMap[typedProcessId] ??
          buildTraceProcessSpanRefTableFromColumns(
            rowsByProcessId.get(typedProcessId) ?? createTraceProcessSpanRefColumns()
          )
      ];
    })
  ) as Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>>;
}

/** Temporary span-id resolver used while canonicalizing Arrow dependency endpoint refs. */
type ArrowTraceDependencyEndpointSpanRefLookup = {
  /** Resolves one same-process endpoint span id within its owning process. */
  readonly getForProcessId: (
    processId: TraceProcessId,
    spanId: TraceSpanId | string
  ) => SpanRef | null;
  /** Resolves one cross-process endpoint span id within its owning rank number. */
  readonly getForRankNum: (rankNum: number, spanId: TraceSpanId | string) => SpanRef | null;
};

/**
 * Canonicalize cross-process dependency endpoint refs against finalized chunk rows.
 *
 * Dataset assembly uses this after the store has assigned canonical chunk refs. The helper keeps
 * unchanged Arrow vectors by identity and is intentionally not re-exported from the public trace
 * barrel: it is an assembly seam, not a second graph materialization API.
 */
export function canonicalizeArrowTraceCrossProcessDependencyTableFromChunks(params: {
  /** Source graph-global cross-process dependency table. */
  readonly crossProcessDependencyTable: Readonly<ArrowTraceCrossProcessDependencyTable>;
  /** Canonical finalized chunks whose span rows resolve dependency ids. */
  readonly chunks: readonly ArrowTraceChunk[];
  /** Canonical process ids indexed by packed process index. */
  readonly processIdsByIndex: readonly TraceProcessId[];
  /** Process metadata used to resolve source cross-process rank numbers. */
  readonly processes: Readonly<ArrowTraceProcessMetadata[]>;
}): ArrowTraceCrossProcessDependencyTable {
  if (params.crossProcessDependencyTable.numRows === 0) {
    return params.crossProcessDependencyTable as ArrowTraceCrossProcessDependencyTable;
  }
  const dependencyEndpointSpanRefLookup = buildArrowTraceDependencyEndpointSpanRefLookup({
    chunks: params.chunks,
    processIdsByIndex: params.processIdsByIndex,
    processes: params.processes
  });
  return canonicalizeArrowTraceCrossProcessDependencyTable({
    crossProcessDependencyTable: params.crossProcessDependencyTable,
    dependencyEndpointSpanRefLookup
  }) as ArrowTraceCrossProcessDependencyTable;
}

/**
 * Resolves dependency endpoint span ids against chunk-backed Arrow span rows during graph build.
 */
function buildArrowTraceDependencyEndpointSpanRefLookup(params: {
  /** Chunk-backed Arrow span rows whose encoded refs become canonical graph endpoint refs. */
  readonly chunks: readonly ArrowTraceChunk[];
  /** Canonical process ids indexed by packed process index. */
  readonly processIdsByIndex: readonly TraceProcessId[];
  /** Process metadata used to resolve cross-process rank numbers. */
  readonly processes: readonly Pick<ArrowTraceProcessMetadata, 'processId' | 'rankNum'>[];
}): ArrowTraceDependencyEndpointSpanRefLookup {
  const spanRefByProcessIdAndSpanId = new Map<TraceProcessId, Map<TraceSpanId, SpanRef>>();
  const processIdByRankNum = new Map(
    params.processes.map(process => [process.rankNum, process.processId as TraceProcessId])
  );
  for (const chunk of params.chunks) {
    const spanIdColumn = chunk.spanTable.getChild('span_id');
    const processRefColumn = getTraceProcessSpanRefSourceColumn(chunk.spanTable, 'process_ref');
    const spanRowCount = getArrowTraceChunkSpanRowCount(chunk);
    for (let chunkRowOrdinal = 0; chunkRowOrdinal < spanRowCount; chunkRowOrdinal += 1) {
      const spanTableRowIndex = getArrowTraceChunkSpanTableRowIndexAt(chunk, chunkRowOrdinal);
      const spanRefRowIndex = getArrowTraceChunkSpanRefRowIndex(chunk, chunkRowOrdinal);
      if (spanTableRowIndex == null || spanRefRowIndex == null) {
        continue;
      }
      const processId = getTraceProcessSpanRefRowProcessId(
        chunk,
        spanTableRowIndex,
        params.processIdsByIndex,
        processRefColumn
      );
      const spanId = spanIdColumn?.get(spanTableRowIndex);
      if (!processId || typeof spanId !== 'string') {
        continue;
      }
      const spanRefsBySpanId =
        spanRefByProcessIdAndSpanId.get(processId) ?? new Map<TraceSpanId, SpanRef>();
      if (!spanRefsBySpanId.has(spanId as TraceSpanId)) {
        spanRefsBySpanId.set(
          spanId as TraceSpanId,
          encodeSpanRef(chunk.chunkIndex, spanRefRowIndex)
        );
      }
      spanRefByProcessIdAndSpanId.set(processId, spanRefsBySpanId);
    }
  }

  return {
    getForProcessId: (processId, spanId) =>
      spanRefByProcessIdAndSpanId.get(processId)?.get(spanId as TraceSpanId) ?? null,
    getForRankNum: (rankNum, spanId) => {
      const processId = processIdByRankNum.get(rankNum);
      return processId
        ? (spanRefByProcessIdAndSpanId.get(processId)?.get(spanId as TraceSpanId) ?? null)
        : null;
    }
  };
}

/**
 * Canonicalizes same-process Arrow dependency refs and endpoint span refs for every process.
 */
function canonicalizeArrowTraceSameProcessDependencyTableMap(params: {
  /** Temporary span-id resolver used only while building canonical dependency tables. */
  readonly dependencyEndpointSpanRefLookup: ArrowTraceDependencyEndpointSpanRefLookup;
  /** Canonical process ids indexed by packed process index. */
  readonly processIdsByIndex: readonly TraceProcessId[];
  /** Source same-process Arrow dependency tables keyed by process id. */
  readonly sameProcessDependencyTableMap: Readonly<
    Record<TraceProcessId, ArrowTraceSameProcessDependencyTable>
  >;
}): Readonly<Record<TraceProcessId, ArrowTraceSameProcessDependencyTable>> {
  return Object.fromEntries(
    Object.entries(params.sameProcessDependencyTableMap).map(([processId, dependencyTable]) => {
      const processIndex = params.processIdsByIndex.indexOf(processId as TraceProcessId);
      return [
        processId,
        processIndex < 0
          ? dependencyTable
          : canonicalizeArrowTraceSameProcessDependencyTable({
              dependencyEndpointSpanRefLookup: params.dependencyEndpointSpanRefLookup,
              dependencyTable,
              processId: processId as TraceProcessId
            })
      ];
    })
  ) as Readonly<Record<TraceProcessId, ArrowTraceSameProcessDependencyTable>>;
}

/**
 * Canonicalizes one same-process Arrow dependency table without retaining JS dependency objects.
 */
function canonicalizeArrowTraceSameProcessDependencyTable(params: {
  /** Temporary span-id resolver used only while building canonical dependency tables. */
  readonly dependencyEndpointSpanRefLookup: ArrowTraceDependencyEndpointSpanRefLookup;
  /** Source same-process Arrow dependency table for one process. */
  readonly dependencyTable: ArrowTraceSameProcessDependencyTable;
  /** Stable process id owning the dependency rows. */
  readonly processId: TraceProcessId;
}): ArrowTraceSameProcessDependencyTable {
  const startSpanRefColumn = params.dependencyTable.getChild('startSpanRef');
  const startSpanIdColumn = params.dependencyTable.getChild('startSpanId');
  const endSpanRefColumn = params.dependencyTable.getChild('endSpanRef');
  const endSpanIdColumn = params.dependencyTable.getChild('endSpanId');
  const startSpanRef: Array<number | null> = new Array(params.dependencyTable.numRows);
  const endSpanRef: Array<number | null> = new Array(params.dependencyTable.numRows);
  let changed = false;
  for (let rowIndex = 0; rowIndex < params.dependencyTable.numRows; rowIndex += 1) {
    const sourceStartSpanRef = normalizeArrowSpanRef(startSpanRefColumn?.get(rowIndex));
    startSpanRef[rowIndex] = resolveArrowTraceDependencyEndpointSpanRef({
      sourceSpanRef: sourceStartSpanRef,
      spanId: readArrowTraceString(startSpanIdColumn?.get(rowIndex)),
      spanRefResolver: spanId =>
        params.dependencyEndpointSpanRefLookup.getForProcessId(params.processId, spanId)
    });
    changed ||= sourceStartSpanRef !== startSpanRef[rowIndex];
    const sourceEndSpanRef = normalizeArrowSpanRef(endSpanRefColumn?.get(rowIndex));
    endSpanRef[rowIndex] = resolveArrowTraceDependencyEndpointSpanRef({
      sourceSpanRef: sourceEndSpanRef,
      spanId: readArrowTraceString(endSpanIdColumn?.get(rowIndex)),
      spanRefResolver: spanId =>
        params.dependencyEndpointSpanRefLookup.getForProcessId(params.processId, spanId)
    });
    changed ||= sourceEndSpanRef !== endSpanRef[rowIndex];
  }
  return changed
    ? rebuildArrowTraceTableWithColumns(params.dependencyTable, {
        startSpanRef: buildArrowNullableFloat64Vector(startSpanRef, params.dependencyTable.numRows),
        endSpanRef: buildArrowNullableFloat64Vector(endSpanRef, params.dependencyTable.numRows)
      })
    : params.dependencyTable;
}

/**
 * Canonicalizes graph-global cross-process Arrow dependency endpoint span refs.
 */
function canonicalizeArrowTraceCrossProcessDependencyTable(params: {
  /** Source graph-global cross-process Arrow dependency table. */
  readonly crossProcessDependencyTable: Readonly<ArrowTraceCrossProcessDependencyTable>;
  /** Temporary span-id resolver used only while building canonical dependency tables. */
  readonly dependencyEndpointSpanRefLookup: ArrowTraceDependencyEndpointSpanRefLookup;
}): Readonly<ArrowTraceCrossProcessDependencyTable> {
  const startRankNumColumn = params.crossProcessDependencyTable.getChild('startRankNum');
  const startSpanRefColumn = params.crossProcessDependencyTable.getChild('startSpanRef');
  const startSpanIdColumn = params.crossProcessDependencyTable.getChild('startSpanId');
  const endRankNumColumn = params.crossProcessDependencyTable.getChild('endRankNum');
  const endSpanRefColumn = params.crossProcessDependencyTable.getChild('endSpanRef');
  const endSpanIdColumn = params.crossProcessDependencyTable.getChild('endSpanId');
  const startSpanRef: Array<number | null> = new Array(params.crossProcessDependencyTable.numRows);
  const endSpanRef: Array<number | null> = new Array(params.crossProcessDependencyTable.numRows);
  let changed = false;
  for (let rowIndex = 0; rowIndex < params.crossProcessDependencyTable.numRows; rowIndex += 1) {
    const sourceStartSpanRef = normalizeArrowSpanRef(startSpanRefColumn?.get(rowIndex));
    startSpanRef[rowIndex] = resolveArrowTraceDependencyEndpointSpanRef({
      sourceSpanRef: sourceStartSpanRef,
      spanId: readArrowTraceString(startSpanIdColumn?.get(rowIndex)),
      spanRefResolver: spanId =>
        params.dependencyEndpointSpanRefLookup.getForRankNum(
          normalizeArrowNumber(startRankNumColumn?.get(rowIndex)) ?? -1,
          spanId
        )
    });
    changed ||= sourceStartSpanRef !== startSpanRef[rowIndex];
    const sourceEndSpanRef = normalizeArrowSpanRef(endSpanRefColumn?.get(rowIndex));
    endSpanRef[rowIndex] = resolveArrowTraceDependencyEndpointSpanRef({
      sourceSpanRef: sourceEndSpanRef,
      spanId: readArrowTraceString(endSpanIdColumn?.get(rowIndex)),
      spanRefResolver: spanId =>
        params.dependencyEndpointSpanRefLookup.getForRankNum(
          normalizeArrowNumber(endRankNumColumn?.get(rowIndex)) ?? -1,
          spanId
        )
    });
    changed ||= sourceEndSpanRef !== endSpanRef[rowIndex];
  }
  return changed
    ? rebuildArrowTraceTableWithColumns(params.crossProcessDependencyTable, {
        startSpanRef: buildArrowNullableFloat64Vector(
          startSpanRef,
          params.crossProcessDependencyTable.numRows
        ),
        endSpanRef: buildArrowNullableFloat64Vector(
          endSpanRef,
          params.crossProcessDependencyTable.numRows
        )
      })
    : params.crossProcessDependencyTable;
}

/** Resolves one dependency endpoint span ref from a canonical span id when available. */
function resolveArrowTraceDependencyEndpointSpanRef(params: {
  /** Existing Arrow endpoint span ref retained when no canonical span id resolves. */
  readonly sourceSpanRef: SpanRef | null;
  /** Optional stable span id used to find the current graph endpoint ref. */
  readonly spanId: string | null;
  /** Process- or rank-scoped endpoint resolver for the dependency row. */
  readonly spanRefResolver: (spanId: TraceSpanId | string) => SpanRef | null;
}): SpanRef | null {
  return params.spanId == null
    ? params.sourceSpanRef
    : (params.spanRefResolver(params.spanId) ?? params.sourceSpanRef);
}

/** Rebuilds one Arrow table while retaining unchanged column vectors by identity. */
function rebuildArrowTraceTableWithColumns<TableT extends arrow.Table>(
  table: Readonly<TableT>,
  replacementColumns: Readonly<Record<string, arrow.Vector>>
): TableT {
  return new arrow.Table({
    ...copyArrowTraceTableColumns(table),
    ...replacementColumns
  }) as TableT;
}

/** Copies one Arrow table's existing column vectors without materializing row objects. */
function copyArrowTraceTableColumns(table: Readonly<arrow.Table>): Record<string, arrow.Vector> {
  const readableTable = table as unknown as {
    readonly schema: arrow.Schema;
    getChild: (columnName: string) => arrow.Vector | null | undefined;
  };
  return Object.fromEntries(
    readableTable.schema.fields.flatMap(field => {
      const column = readableTable.getChild(field.name);
      return column ? [[field.name, column]] : [];
    })
  ) as Record<string, arrow.Vector>;
}

/** Reads one Arrow Utf8 cell as a nullable JavaScript string. */
function readArrowTraceString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

const PARENT_DEPENDENCY_KEYWORD = 'PARENT';

type TraceProcessSpanRefTableColumns = {
  /** Stable encoded span refs in process-local scan order. */
  span_ref: SpanRef[];
  /** Optional layout top values aligned with span refs. */
  layout_top_y: Array<number | null>;
  /** Whether any row carries an explicit layout top value. */
  has_layout_top_y: boolean;
  /** Optional layout heights aligned with span refs. */
  layout_height: Array<number | null>;
  /** Whether any row carries an explicit layout height value. */
  has_layout_height: boolean;
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
 * Builds or normalizes process-scoped canonical chunks.
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
  sameProcessDependencyTableMap: Readonly<
    Record<TraceProcessId, ArrowTraceSameProcessDependencyTable>
  >;
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
    const resolvedSameProcessDependencyTable = params.sameProcessDependencyTableMap[processId];
    if (!spanTable || !resolvedSameProcessDependencyTable) {
      throw new Error(`Missing canonical span or dependency tables for chunk ${processId}`);
    }
    const spanSidecarTable = params.spanSidecarTableMap?.[processId];
    if (
      'spanTable' in chunk &&
      chunk.spanTable === spanTable &&
      chunk.resolvedSameProcessDependencyTable === resolvedSameProcessDependencyTable &&
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
      resolvedSameProcessDependencyTable,
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
    has_layout_top_y: false,
    layout_height: [],
    has_layout_height: false
  };
}

/**
 * Builds direct process-local span-ref tables for one-process chunks that need no row routing.
 */
function buildDirectTraceProcessSpanRefTables(
  chunks: readonly ArrowTraceChunk[]
): Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>> {
  if (chunks.some(chunk => chunk.processId == null || chunk.processRefs.length !== 1)) {
    return {};
  }

  const directChunkByProcessId = new Map<TraceProcessId, ArrowTraceChunk | null>();
  for (const chunk of chunks) {
    const processId = chunk.processId!;
    directChunkByProcessId.set(processId, directChunkByProcessId.has(processId) ? null : chunk);
  }

  return Object.fromEntries(
    [...directChunkByProcessId].flatMap(([processId, chunk]) =>
      chunk ? [[processId, buildDirectTraceProcessSpanRefTable(chunk)] as const] : []
    )
  ) as Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>>;
}

/**
 * Builds one process-local span-ref table from a one-process chunk without row materialization.
 */
function buildDirectTraceProcessSpanRefTable(chunk: ArrowTraceChunk): TraceProcessSpanRefTable {
  const rowCount = chunk.spanTable.numRows;
  const spanRefs = new Float64Array(rowCount);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const spanRef = encodeSpanRef(chunk.chunkIndex, rowIndex);
    spanRefs[rowIndex] = spanRef;
  }
  const spanRefColumn = buildArrowFloat64Vector(spanRefs);
  const layoutTopYColumn = chunk.spanTable.getChild('layout_top_y');
  const layoutHeightColumn = chunk.spanTable.getChild('layout_height');

  return buildTraceProcessSpanRefTableFromVectors({
    span_ref: spanRefColumn,
    layout_top_y: layoutTopYColumn,
    layout_height: layoutHeightColumn,
    rowCount
  });
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
  const layoutTopY = normalizeArrowNumber(params.spanColumns.layoutTopY?.get(params.rowIndex));
  const layoutHeight = normalizeArrowNumber(params.spanColumns.layoutHeight?.get(params.rowIndex));
  columns.layout_top_y.push(layoutTopY);
  columns.has_layout_top_y ||= layoutTopY != null;
  columns.layout_height.push(layoutHeight);
  columns.has_layout_height ||= layoutHeight != null;
}

/** Builds one Arrow process SpanRef/layout index table without copying span-name fields. */
function buildTraceProcessSpanRefTableFromColumns(
  columns: TraceProcessSpanRefTableColumns
): TraceProcessSpanRefTable {
  return buildTraceProcessSpanRefTableFromVectors({
    span_ref: buildArrowFloat64Vector(columns.span_ref),
    layout_top_y: buildArrowNullableFloat64Vector(columns.layout_top_y, columns.span_ref.length),
    layout_height: buildArrowNullableFloat64Vector(columns.layout_height, columns.span_ref.length),
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
  /** Number of process-local rows. */
  rowCount: number;
}): TraceProcessSpanRefTable {
  const spanRefColumn =
    params.span_ref ?? buildArrowFloat64Vector(new Float64Array(params.rowCount));
  const layoutTopYColumn =
    params.layout_top_y ?? buildArrowNullableFloat64Vector(undefined, params.rowCount);
  const layoutHeightColumn =
    params.layout_height ?? buildArrowNullableFloat64Vector(undefined, params.rowCount);
  return new arrow.Table({
    span_ref: spanRefColumn,
    layout_top_y: layoutTopYColumn,
    layout_height: layoutHeightColumn
  }) as unknown as TraceProcessSpanRefTable;
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
  processes: Readonly<TraceProcess[]>,
  options: BuildTraceChunkDataOptions = {}
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
        buildArrowTraceSpanTableFromColumns(
          rowsToTraceSpanArrowColumns(
            process.spans.map(block =>
              toTraceSpanArrowRow(
                block,
                processRef,
                threadRefByStreamId.get(block.threadId) ?? null
              )
            )
          ),
          undefined,
          {
            declaredSpanAttributePaths: options.declaredSpanAttributePaths,
            spanAttributeRows: process.spans.map(block => ({
              ...(block.userData ?? {}),
              processId: process.processId
            }))
          }
        )
      ] as const;
    })
  ) as Readonly<Record<TraceProcessId, ArrowTraceSpanTable>>;
}

/**
 * Builds canonical process-local sidecar rows from the span arrays embedded in compatibility
 * {@link TraceProcess} records.
 */
function buildTraceSpanSidecarRowsByProcessId(
  processes: Readonly<TraceProcess[]>
): TraceSpanArrowSidecarRowMap {
  return Object.fromEntries(
    processes.map(process => [
      process.processId as TraceProcessId,
      buildTraceSpanSidecarRows(process)
    ])
  ) as TraceSpanArrowSidecarRowMap;
}

/** Builds row-aligned Arrow sidecar tables from ingestion-only compatibility span objects. */
export function buildTraceSpanSidecarTablesByProcessId(
  processes: Readonly<TraceProcess[]>
): ArrowTraceSpanSidecarTableMap {
  const sidecarMap = buildTraceSpanSidecarRowsByProcessId(processes);
  return Object.fromEntries(
    Object.entries(sidecarMap).map(([processId, rows]) => [
      processId,
      buildArrowTraceSpanSidecarTableFromRows(rows)
    ])
  ) as ArrowTraceSpanSidecarTableMap;
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
  return {
    primaryTimingKey: block.primaryTimingKey,
    timings: block.timings,
    userData: block.userData,
    keywords: block.keywords ?? [],
    sameProcessDependencyIds: [...block.sameProcessDependencyIds],
    incomingSameProcessDependencyRowIndexes: [],
    outgoingSameProcessDependencyRowIndexes: [],
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
 * Builds row-aligned sidecar payloads for one process.
 */
function buildTraceSpanSidecarRows(
  process: Readonly<TraceProcess>
): readonly TraceSpanArrowSidecarRow[] {
  return process.spans.map(block => toTraceSpanArrowSidecarRow(block));
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
  vectorOverrides?: TraceSpanArrowVectorOverrides,
  options: BuildArrowTraceSpanTableOptions = {}
): ArrowTraceSpanTable {
  const rowCount = columns.span_id.length;
  const tableColumns = {
    process_ref: buildArrowNullableOwnerRefFloat64Vector(
      columns.process_ref,
      rowCount,
      'process_ref'
    ),
    thread_ref: buildArrowNullableOwnerRefFloat64Vector(columns.thread_ref, rowCount, 'thread_ref'),
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
    status_code: buildArrowUint8Vector(
      columns.status.map(status => encodeTraceSpanTimingStatusCode(status)),
      rowCount
    ),
    start_time_ms: buildArrowFloat64Vector(columns.start_time_ms),
    end_time_ms: buildArrowFloat64Vector(columns.end_time_ms),
    duration_ms: buildArrowFloat64Vector(columns.duration_ms),
    layout_top_y: buildArrowNullableFloat64Vector(columns.layout_top_y, rowCount),
    layout_height: buildArrowNullableFloat64Vector(columns.layout_height, rowCount)
  };
  Object.assign(
    tableColumns,
    buildDeclaredSpanAttributeColumns(
      options.declaredSpanAttributePaths,
      options.spanAttributeRows,
      rowCount
    )
  );
  return new arrow.Table(tableColumns) as unknown as ArrowTraceSpanTable;
}

/**
 * Mutates one span table with finalized owner ref values while preserving Arrow buffers.
 */
export function replaceArrowTraceSpanRefColumns(params: {
  /** Source span table whose ref value buffers should be updated in place. */
  sourceTable: Readonly<ArrowTraceSpanTable>;
  /** Canonical runtime process refs in span row order. */
  processRef: Array<number | null>;
  /** Canonical runtime thread refs in span row order. */
  threadRef: Array<number | null>;
}): ArrowTraceSpanTable {
  const rowCount = params.sourceTable.numRows;
  if (params.processRef.length !== rowCount || params.threadRef.length !== rowCount) {
    throw new Error('Expected replacement span ref columns to preserve row count.');
  }

  mutateArrowTableColumnValues({
    sourceTable: params.sourceTable,
    columnName: 'process_ref',
    values: params.processRef,
    writeValue: writeSafeIntegerFloat64Value
  });
  mutateArrowTableColumnValues({
    sourceTable: params.sourceTable,
    columnName: 'thread_ref',
    values: params.threadRef,
    writeValue: writeSafeIntegerFloat64Value
  });
  return params.sourceTable as ArrowTraceSpanTable;
}

/**
 * Build one process-local Arrow span sidecar table from column-oriented sidecar payloads.
 */
export function buildArrowTraceSpanSidecarTableFromRows(
  rows: readonly TraceSpanArrowSidecarRow[]
): ArrowTraceSpanSidecarTable {
  return buildArrowTraceSpanSidecarTableFromColumns({
    rowCount: rows.length,
    keywords: rows.map(row => row.keywords ?? []),
    crossProcessEndpointId: rows.map(row => row.crossProcessEndpointId ?? null),
    userDataJson: rows.map(row =>
      row.userData == null ? null : serializeArrowTraceJson(row.userData)
    ),
    timings: buildTraceSpanArrowTimingProjectionColumns(rows)
  });
}

/**
 * Build one process-local Arrow span sidecar table from column-oriented sidecar payloads.
 */
export function buildArrowTraceSpanSidecarTableFromColumns(
  columns: TraceSpanArrowSidecarColumns
): ArrowTraceSpanSidecarTable {
  const rowCount = columns.rowCount;
  const tableColumns: Record<string, arrow.Vector> = {
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
  const timingsColumn = buildTraceSpanArrowTimingsStructColumn(columns.timings, rowCount);
  if (timingsColumn) {
    tableColumns.timings = timingsColumn;
  }
  if (columns.timingsJson) {
    tableColumns.timingsJson = arrow.vectorFromArray(
      normalizeNullableStringColumn(columns.timingsJson, rowCount),
      new arrow.Utf8()
    );
  }

  return new arrow.Table(tableColumns) as unknown as ArrowTraceSpanSidecarTable;
}

/** Builds columnar non-primary timing projection values from row-aligned sidecar inputs. */
function buildTraceSpanArrowTimingProjectionColumns(
  rows: readonly TraceSpanArrowSidecarRow[]
): Readonly<Record<string, TraceSpanArrowTimingProjectionColumns>> {
  const timingKeys = new Set<string>();
  rows.forEach(row => {
    Object.keys(row.timings ?? {}).forEach(timingKey => {
      if (timingKey !== row.primaryTimingKey) {
        timingKeys.add(timingKey);
      }
    });
  });

  return Object.fromEntries(
    [...timingKeys].map(timingKey => {
      const timings = rows.map(row =>
        timingKey === row.primaryTimingKey ? undefined : row.timings?.[timingKey]
      );
      return [
        timingKey,
        {
          statusCode: timings.map(timing =>
            timing ? encodeTraceSpanTimingStatusCode(timing.status) : null
          ),
          startTimeMs: timings.map(timing => timing?.startTimeMs ?? null),
          endTimeMs: timings.map(timing => timing?.endTimeMs ?? null),
          durationMs: timings.map(timing => timing?.durationMs ?? null)
        } satisfies TraceSpanArrowTimingProjectionColumns
      ];
    })
  );
}

/** Builds one nested Arrow Struct column for non-primary timing projections. */
function buildTraceSpanArrowTimingsStructColumn(
  timingColumns: Readonly<Record<string, TraceSpanArrowTimingProjectionColumns>> | undefined,
  rowCount: number
): arrow.Vector | null {
  const timingEntries = Object.entries(timingColumns ?? {});
  if (timingEntries.length === 0) {
    return null;
  }

  const timingType = new arrow.Struct([
    new arrow.Field('status_code', new arrow.Uint8(), true),
    new arrow.Field('start_time_ms', new arrow.Float64(), true),
    new arrow.Field('end_time_ms', new arrow.Float64(), true),
    new arrow.Field('duration_ms', new arrow.Float64(), true)
  ]);
  const timingsType = new arrow.Struct(
    timingEntries.map(([timingKey]) => new arrow.Field(timingKey, timingType, true))
  );
  const values = Array.from({length: rowCount}, (_, rowIndex) =>
    Object.fromEntries(
      timingEntries.map(([timingKey, columns]) => {
        const statusCode = columns.statusCode[rowIndex] ?? null;
        const startTimeMs = columns.startTimeMs[rowIndex] ?? null;
        const endTimeMs = columns.endTimeMs[rowIndex] ?? null;
        const durationMs = columns.durationMs[rowIndex] ?? null;
        const timing =
          statusCode == null && startTimeMs == null && endTimeMs == null && durationMs == null
            ? null
            : {
                status_code: statusCode,
                start_time_ms: startTimeMs,
                end_time_ms: endTimeMs,
                duration_ms: durationMs
              };
        return [timingKey, timing];
      })
    )
  );
  return arrow.vectorFromArray(values, timingsType);
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

function buildSameProcessDependencyTablesByProcessId(
  processes: Readonly<ArrowTraceProcessMetadata[]>
): Readonly<Record<TraceProcessId, ArrowTraceSameProcessDependencyTable>> {
  return Object.fromEntries(
    processes.map(process => [
      process.processId as TraceProcessId,
      buildArrowTraceSameProcessDependencyTable(process.sameProcessDependencies ?? [])
    ])
  ) as Readonly<Record<TraceProcessId, ArrowTraceSameProcessDependencyTable>>;
}

/**
 * Builds one process-local Arrow dependency table from normalized same-process dependency objects.
 */
export function buildArrowTraceSameProcessDependencyTable(
  dependencies: ReadonlyArray<TraceSameProcessDependency>
): ArrowTraceSameProcessDependencyTable {
  return buildArrowTraceSameProcessDependencyTableFromColumns({
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
    ),
    userDataJson: dependencies.map(dependency =>
      dependency.userData == null ? null : serializeArrowTraceJson(dependency.userData)
    )
  });
}

/**
 * Builds one process-local Arrow dependency table from column-oriented dependency payloads.
 */
export function buildArrowTraceSameProcessDependencyTableFromColumns(
  columns: TraceSameProcessDependencyArrowColumns
): ArrowTraceSameProcessDependencyTable {
  const rowCount = columns.waitMode.length;
  const keywords =
    columns.keywords ??
    columns.hasParentKeyword.map(hasParentKeyword => (hasParentKeyword ? ['PARENT'] : []));
  return new arrow.Table({
    ...(columns.dependencyId ? {dependencyId: buildArrowUtf8Vector(columns.dependencyId)} : {}),
    startSpanRef: buildArrowNullableFloat64Vector(columns.startSpanRef, rowCount),
    ...(columns.startSpanId ? {startSpanId: buildArrowUtf8Vector(columns.startSpanId)} : {}),
    endSpanRef: buildArrowNullableFloat64Vector(columns.endSpanRef, rowCount),
    ...(columns.endSpanId ? {endSpanId: buildArrowUtf8Vector(columns.endSpanId)} : {}),
    waitModeCode: buildArrowUint8Vector(
      columns.waitMode.map(waitMode => encodeTraceDependencyWaitModeCode(waitMode)),
      rowCount
    ),
    bidirectional: arrow.vectorFromArray(columns.bidirectional, new arrow.Bool()),
    waitTimeMs: buildArrowFloat64Vector(columns.waitTimeMs),
    keywords: buildArrowUtf8ListVector(keywords),
    keywordFlags: buildArrowUint8Vector(
      keywords.map((dependencyKeywords, rowIndex) =>
        encodeTraceDependencyKeywordFlags(
          dependencyKeywords,
          columns.hasParentKeyword[rowIndex] === true
        )
      ),
      rowCount
    ),
    ...(columns.userDataJson
      ? {
          userDataJson: arrow.vectorFromArray(
            normalizeNullableStringColumn(columns.userDataJson, rowCount),
            new arrow.Utf8()
          )
        }
      : {})
  }) as unknown as ArrowTraceSameProcessDependencyTable;
}

/**
 * Mutates one same-process dependency table with finalized endpoint refs while preserving Arrow buffers.
 */
export function replaceArrowTraceSameProcessDependencyEndpointRefColumns(params: {
  /** Source dependency table whose endpoint-ref value buffers should be updated in place. */
  sourceTable: Readonly<ArrowTraceSameProcessDependencyTable>;
  /** Canonical runtime source span refs in same-process dependency row order. */
  startSpanRef: Array<number | null>;
  /** Canonical runtime destination span refs in same-process dependency row order. */
  endSpanRef: Array<number | null>;
}): ArrowTraceSameProcessDependencyTable {
  const rowCount = params.sourceTable.numRows;
  if (params.startSpanRef.length !== rowCount || params.endSpanRef.length !== rowCount) {
    throw new Error(
      'Expected replacement same-process dependency ref columns to preserve row count.'
    );
  }

  mutateArrowTableColumnValues({
    sourceTable: params.sourceTable,
    columnName: 'startSpanRef',
    values: params.startSpanRef,
    writeValue: writeSafeIntegerFloat64Value
  });
  mutateArrowTableColumnValues({
    sourceTable: params.sourceTable,
    columnName: 'endSpanRef',
    values: params.endSpanRef,
    writeValue: writeSafeIntegerFloat64Value
  });
  return params.sourceTable as ArrowTraceSameProcessDependencyTable;
}

/**
 * Mutates one fixed-width Arrow column in place while leaving table/data buffers stable.
 */
function mutateArrowTableColumnValues<TTable extends arrow.Table, TValue>(params: {
  /** Source table whose column value buffer should be updated in place. */
  readonly sourceTable: Readonly<TTable>;
  /** Existing column name to mutate. */
  readonly columnName: string;
  /** Row-aligned replacement values. */
  readonly values: ReadonlyArray<TValue | null>;
  /** Writes one value into the physical Arrow value buffer. */
  readonly writeValue: (values: unknown, rowIndex: number, value: TValue | null) => void;
}): void {
  const table = params.sourceTable as TTable;
  const columnIndex = table.schema.fields.findIndex(field => field.name === params.columnName);
  if (columnIndex < 0) {
    throw new Error(`Expected Arrow table column ${params.columnName}.`);
  }
  if (params.values.length !== table.numRows) {
    throw new Error(
      `Expected replacement Arrow column ${params.columnName} to preserve row count.`
    );
  }

  const column = table.getChildAt(columnIndex);
  if (!column) {
    throw new Error(`Expected Arrow table column ${params.columnName}.`);
  }

  let rowOffset = 0;
  for (const data of column.data) {
    const valueBuffer = data?.values;
    if (!data || !valueBuffer) {
      throw new Error(`Expected mutable Arrow values for ${params.columnName}.`);
    }
    for (let rowIndex = 0; rowIndex < data.length; rowIndex += 1) {
      const value = params.values[rowOffset + rowIndex] ?? null;
      data.setValid(rowIndex, value != null);
      params.writeValue(valueBuffer, data.offset + rowIndex, value);
    }
    rowOffset += data.length;
  }
}

/** Writes one optional Float64 value into an Arrow value buffer. */
function writeFloat64Value(values: unknown, rowIndex: number, value: number | null): void {
  (values as Float64Array)[rowIndex] = value ?? 0;
}

/** Writes one optional safe-integer runtime ref into an Arrow Float64 value buffer. */
function writeSafeIntegerFloat64Value(
  values: unknown,
  rowIndex: number,
  value: number | null
): void {
  assertNullableSafeIntegerRef(value, 'runtime ref', rowIndex);
  writeFloat64Value(values, rowIndex, value);
}

/**
 * Builds one graph-global Arrow cross-process dependency table from normalized dependencies.
 */
export function buildArrowTraceCrossProcessDependencyTable(
  dependencies: ReadonlyArray<TraceCrossProcessDependency>
): ArrowTraceCrossProcessDependencyTable {
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
    hasParentKeyword: [] as boolean[],
    userDataJson: [] as Array<string | null>
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
    columns.userDataJson.push(
      dependency.userData == null ? null : serializeArrowTraceJson(dependency.userData)
    );
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
    hasParentKeyword: arrow.vectorFromArray(columns.hasParentKeyword, new arrow.Bool()),
    userDataJson: arrow.vectorFromArray(columns.userDataJson, new arrow.Utf8())
  }) as unknown as ArrowTraceCrossProcessDependencyTable;
}

function hasParentDependencyKeyword(keywords: ReadonlySet<string>): boolean {
  for (const keyword of keywords) {
    if (keyword.toUpperCase() === PARENT_DEPENDENCY_KEYWORD) {
      return true;
    }
  }
  return false;
}

/** Removes ingestion-only dependency object arrays from persisted graph process metadata. */
function stripArrowTraceProcessDependencyMetadata(
  process: ArrowTraceProcessMetadata
): ArrowTraceProcessMetadata {
  const {sameProcessDependencies: _sameProcessDependencies, ...metadata} = process;
  return metadata;
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

type DeclaredSpanAttributePrimitive = string | number | bigint | boolean;
type DeclaredSpanAttributeValue =
  | DeclaredSpanAttributePrimitive
  | readonly DeclaredSpanAttributePrimitive[]
  | null;
type DeclaredSpanAttributeNode = {
  /** Child nodes keyed by one tuple-path segment. */
  readonly children: Map<string, DeclaredSpanAttributeNode>;
  /** Full tuple path for a declared leaf node. */
  path?: TraceSpanAttributePath;
};
type DeclaredSpanAttributeColumn = {
  /** Arrow field type for the projected column or struct child. */
  readonly type: arrow.DataType;
  /** Row-aligned normalized values accepted by the Arrow type. */
  readonly values: readonly unknown[];
};

/**
 * Builds optional Arrow span columns for declared primitive attribute paths.
 *
 * Nested paths become declared-only Arrow structs. Unsupported leaves remain null and do not
 * cause arbitrary nested source objects to enter the span table.
 */
function buildDeclaredSpanAttributeColumns(
  paths: readonly TraceSpanAttributePath[] | undefined,
  rows: readonly (Record<string, unknown> | undefined)[] | undefined,
  rowCount: number
): Record<string, arrow.Vector> {
  if (!paths?.length || !rows) {
    return {};
  }

  const root = createDeclaredSpanAttributeNode();
  for (const path of paths) {
    if (path.length === 0) {
      continue;
    }
    let node = root;
    for (const key of path) {
      let child = node.children.get(key);
      if (!child) {
        child = createDeclaredSpanAttributeNode();
        node.children.set(key, child);
      }
      node = child;
    }
    node.path = path;
  }

  const columns: Record<string, arrow.Vector> = {};
  for (const [key, node] of root.children) {
    const column = buildDeclaredSpanAttributeColumn(node, rows, rowCount);
    if (column) {
      columns[key] = arrow.vectorFromArray(column.values, column.type);
    }
  }
  return columns;
}

/** Creates one mutable declared-attribute path tree node. */
function createDeclaredSpanAttributeNode(): DeclaredSpanAttributeNode {
  return {children: new Map()};
}

/** Builds one declared leaf column or struct subtree from row-aligned source objects. */
function buildDeclaredSpanAttributeColumn(
  node: DeclaredSpanAttributeNode,
  rows: readonly (Record<string, unknown> | undefined)[],
  rowCount: number
): DeclaredSpanAttributeColumn | null {
  if (node.path) {
    return buildDeclaredSpanAttributeLeafColumn(node.path, rows, rowCount);
  }

  const children = [...node.children].flatMap(([key, child]) => {
    const column = buildDeclaredSpanAttributeColumn(child, rows, rowCount);
    return column ? [[key, column] as const] : [];
  });
  if (children.length === 0) {
    return null;
  }

  return {
    type: new arrow.Struct(
      children.map(([key, column]) => new arrow.Field(key, column.type, true))
    ),
    values: Array.from({length: rowCount}, (_, rowIndex) =>
      Object.fromEntries(children.map(([key, column]) => [key, column.values[rowIndex] ?? null]))
    )
  };
}

/** Builds one declared primitive leaf column and drops incompatible row values. */
function buildDeclaredSpanAttributeLeafColumn(
  path: TraceSpanAttributePath,
  rows: readonly (Record<string, unknown> | undefined)[],
  rowCount: number
): DeclaredSpanAttributeColumn | null {
  const sourceValues = Array.from({length: rowCount}, (_, rowIndex) =>
    normalizeDeclaredSpanAttributeValue(readDeclaredSpanAttributeValue(rows[rowIndex], path))
  );
  const firstValue = sourceValues.find(value => value != null);
  if (firstValue == null) {
    return null;
  }
  const type = getDeclaredSpanAttributeArrowType(firstValue);

  return {
    type,
    values: sourceValues.map(value =>
      value != null && isDeclaredSpanAttributeValueCompatible(value, firstValue) ? value : null
    )
  };
}

/** Reads one declared path from an ingestion-only source object. */
function readDeclaredSpanAttributeValue(
  source: Record<string, unknown> | undefined,
  path: TraceSpanAttributePath
): unknown {
  let value: unknown = source;
  for (const key of path) {
    if (value == null || typeof value !== 'object' || Array.isArray(value) || !(key in value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Accepts only primitive leaves and homogeneous primitive arrays of at most eight values. */
function normalizeDeclaredSpanAttributeValue(value: unknown): DeclaredSpanAttributeValue {
  if (typeof value === 'string' || typeof value === 'bigint' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    return null;
  }
  const normalized = value.map(entry => normalizeDeclaredSpanAttributePrimitive(entry));
  const first = normalized[0];
  if (
    normalized.some(entry => entry == null) ||
    (first != null && normalized.some(entry => typeof entry !== typeof first))
  ) {
    return null;
  }
  return normalized as readonly DeclaredSpanAttributePrimitive[];
}

/** Normalizes one supported primitive attribute leaf. */
function normalizeDeclaredSpanAttributePrimitive(
  value: unknown
): DeclaredSpanAttributePrimitive | null {
  if (typeof value === 'string' || typeof value === 'bigint' || typeof value === 'boolean') {
    return value;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Resolves the Arrow type for one normalized declared attribute value. */
function getDeclaredSpanAttributeArrowType(value: Exclude<DeclaredSpanAttributeValue, null>) {
  if (Array.isArray(value)) {
    const item = value[0];
    const itemType =
      typeof item === 'string'
        ? new arrow.Utf8()
        : typeof item === 'bigint'
          ? new arrow.Int64()
          : typeof item === 'boolean'
            ? new arrow.Bool()
            : new arrow.Float64();
    return new arrow.List(new arrow.Field('item', itemType, true));
  }
  if (typeof value === 'string') {
    return new arrow.Utf8();
  }
  if (typeof value === 'bigint') {
    return new arrow.Int64();
  }
  if (typeof value === 'boolean') {
    return new arrow.Bool();
  }
  return new arrow.Float64();
}

/** Returns whether one normalized row value matches the selected column type. */
function isDeclaredSpanAttributeValueCompatible(
  value: Exclude<DeclaredSpanAttributeValue, null>,
  firstValue: Exclude<DeclaredSpanAttributeValue, null>
): boolean {
  if (Array.isArray(firstValue)) {
    return (
      Array.isArray(value) &&
      (firstValue.length === 0 || value.length === 0 || typeof value[0] === typeof firstValue[0])
    );
  }
  return !Array.isArray(value) && typeof value === typeof firstValue;
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
 * Builds a nullable Float64 vector for optional span refs.
 */
function buildArrowNullableFloat64Vector(
  values: ReadonlyArray<number | null | undefined> | Float64Array | undefined,
  rowCount: number
): arrow.Vector<arrow.Float64> {
  if (values instanceof Float64Array) {
    if (values.length !== rowCount) {
      throw new Error('Expected Float64 span column to preserve row count.');
    }
    return buildArrowFloat64Vector(values);
  }
  return arrow.vectorFromArray(
    Array.from({length: rowCount}, (_, rowIndex) => values?.[rowIndex] ?? null),
    new arrow.Float64()
  );
}

/**
 * Builds one nullable Float64 owner-ref vector while preserving already-owned typed buffers.
 *
 * Array inputs are normalized and validated in the same row pass that prepares Arrow values.
 * Float64 inputs require one validation pass before their buffer is borrowed by identity.
 */
function buildArrowNullableOwnerRefFloat64Vector(
  values: ReadonlyArray<number | null | undefined> | Float64Array | undefined,
  rowCount: number,
  columnName: 'process_ref' | 'thread_ref'
): arrow.Vector<arrow.Float64> {
  if (values instanceof Float64Array) {
    if (values.length !== rowCount) {
      throw new Error(`Expected Float64 ${columnName} column to preserve row count.`);
    }
    for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
      assertNullableSafeIntegerRef(values[rowIndex] ?? null, columnName, rowIndex);
    }
    return buildArrowFloat64Vector(values);
  }

  return arrow.vectorFromArray(
    Array.from({length: rowCount}, (_, rowIndex) => {
      const value = values?.[rowIndex] ?? null;
      assertNullableSafeIntegerRef(value, columnName, rowIndex);
      return value;
    }),
    new arrow.Float64()
  );
}

/** Validates one nullable canonical runtime ref before storing it in Float64 Arrow data. */
function assertNullableSafeIntegerRef(
  value: number | null,
  columnName: string,
  rowIndex: number
): void {
  if (value != null && !Number.isSafeInteger(value)) {
    throw new Error(`Expected ${columnName}[${rowIndex}] to be null or a safe integer.`);
  }
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
  return rows.reduce<MutableTraceSpanArrowColumns>((columns, row) => {
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
function createTraceSpanArrowColumns(): MutableTraceSpanArrowColumns {
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

/** Normalizes one Arrow numeric cell into a safe packed span ref. */
function normalizeArrowSpanRef(value: unknown): SpanRef | null {
  const spanRef = normalizeArrowNumber(value);
  return spanRef != null && Number.isSafeInteger(spanRef) && spanRef >= 0
    ? (spanRef as SpanRef)
    : null;
}
