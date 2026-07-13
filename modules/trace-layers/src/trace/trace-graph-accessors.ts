import {getArrowUtf8RowView} from '@deck.gl-community/infovis-layers';
import {
  findArrowTraceChunkByIndex,
  getArrowTraceChunkSpanRefRowIndex,
  getArrowTraceChunkSpanRowCount,
  getArrowTraceChunkSpanTableRowIndex,
  getArrowTraceChunkSpanTableRowIndexAt
} from './ingestion/arrow-trace';
import {deserializeArrowTraceJson} from './ingestion/arrow-trace-json';
import {decodeTraceSpanTimingStatusCode} from './ingestion/trace-span-timing-status-code';
import {
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef,
  getProcessRefIndex,
  getSpanRefChunkIndex,
  getSpanRefRowIndex,
  getThreadRefProcessIndex
} from './trace-graph/trace-id-encoder';
import {getPrimaryTiming} from './trace-graph/trace-types';
import {
  isTraceSpanTimingEligibleForTimeExtents,
  isTraceSpanTimingTimestampEligibleForTimeExtents
} from './trace-time-extents';
import {formatTimeMs} from './utils/time-format-utils';

import type {Utf8StringView} from '@deck.gl-community/infovis-layers';
import type {
  ArrowTraceChunk,
  ArrowTraceProcessMetadata,
  ArrowTraceSameProcessDependencyTable,
  ArrowTraceSpanSidecarTable,
  ArrowTraceSpanSidecarTableMap,
  ArrowTraceSpanTable,
  TraceCrossProcessEndpointsBySpanRef,
  TraceProcessSpanRefTable
} from './ingestion/arrow-trace';
import type {
  CounterRef,
  CrossProcessDependencyRef,
  EventRef,
  InstantRef,
  ProcessRef,
  SameProcessDependencyRef,
  ThreadRef,
  TraceDependencyRef
} from './trace-graph/trace-id-encoder';
import type {
  SpanRef,
  TraceCounter,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceEvent,
  TraceInstant,
  TraceProcessId,
  TraceSameProcessDependency,
  TraceSpan,
  TraceSpanAttributePath,
  TraceSpanId,
  TraceSpanTiming,
  TraceSpanTimingSource,
  TraceThreadId
} from './trace-graph/trace-types';
import type * as arrow from 'apache-arrow';

/** Inclusive timing envelope for a span-like entity after fallback timing normalization. */
export type SpanTimeExtents = {
  /** Earliest resolved start time across the span envelope. */
  startTimeMs: number;
  /** Latest resolved end time across the span envelope. */
  endTimeMs: number;
};

/** Minimal timing-bearing object accepted by trace timing helper functions. */
export type TimedEntity = Pick<TraceSpan, 'primaryTimingKey' | 'timings'> &
  Partial<Pick<TraceSpan, 'spanId'>>;

/**
 * Minimal Arrow-backed graph surface used by row-level span accessors.
 *
 * The accessor layer intentionally depends on canonical chunk/table ownership and low-cardinality
 * lookup metadata only. It does not require the wider ingestion-oriented graph projection.
 */
export type TraceGraphSpanAccessorSource = {
  /** Loaded row-backed Arrow chunks that own canonical span rows. */
  readonly chunks: readonly ArrowTraceChunk[];
  /** Optional active span refs for a row-selected graph view. */
  readonly spanRefs?: readonly SpanRef[];
  /** Canonical process ids indexed by packed process index. */
  readonly processIdsByIndex: ReadonlyArray<TraceProcessId>;
  /** Metadata-only process records used for process and thread owner fallback. */
  readonly processes: Readonly<ArrowTraceProcessMetadata[]>;
  /** Process-local SpanRef/layout index tables keyed by process id. */
  readonly processSpanTableMap: Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>>;
  /** Optional row-aligned Arrow detail sidecar tables keyed by process id. */
  readonly spanSidecarTableMap?: ArrowTraceSpanSidecarTableMap;
  /** Optional sparse unresolved cross-process endpoints keyed by owning span ref. */
  readonly crossProcessEndpointsBySpanRef?: TraceCrossProcessEndpointsBySpanRef;
};

/**
 * One selected span-row Arrow value prepared for display and diagnostics.
 */
export type TraceGraphSpanArrowColumnValue = {
  /** Row-aligned Arrow table that owns the column. */
  tableName: 'spanTable' | 'spanSidecarTable';
  /** Arrow column name inside the owning table. */
  columnName: string;
  /** Raw row value read from the Arrow column. */
  value: unknown;
};

/**
 * One canonical span ref paired with its row in a process-local span-ref table.
 */
export type TraceGraphProcessSpanRefRow = {
  /** Exact chunk-backed span ref represented by this process-local row. */
  readonly spanRef: SpanRef;
  /** Row index into the owning process-local span-ref table. */
  readonly processRowIndex: number;
};

/**
 * Chunk-backed store row that owns the full scalar/string data for one span ref.
 */
export type TraceGraphSpanStoreRow = {
  /** Loaded chunk that owns the span ref. */
  chunk: ArrowTraceChunk;
  /** Chunk-owned Arrow span table that stores the full span row. */
  spanTable: ArrowTraceSpanTable;
  /** Row index inside {@link TraceGraphSpanStoreRow.spanTable}. */
  rowIndex: number;
  /** Runtime process ref stored on the span row. */
  processRef: ProcessRef | null;
  /** Runtime thread ref stored on the span row. */
  threadRef: ThreadRef | null;
  /** Resolved process id for the span row. */
  processId: TraceProcessId | null;
};

/**
 * Arrow span row address resolved without row-level process/thread owner lookup.
 */
type TraceGraphSpanTableAddress = {
  /** Loaded chunk that owns the span ref. */
  chunk: ArrowTraceChunk;
  /** Chunk-owned Arrow span table that stores the full span row. */
  spanTable: ArrowTraceSpanTable;
  /** Row index inside {@link TraceGraphSpanTableAddress.spanTable}. */
  rowIndex: number;
  /** Resolved process id for the span row. */
  processId: TraceProcessId | null;
  /** Packed process ref stored on mixed-process chunk rows. */
  rowProcessRef: number | null;
  /** Packed thread ref stored on the span row when the Arrow table exposes one. */
  rowThreadRef: number | null;
  /** Canonical runtime process ref resolved without reading span display fields. */
  processRef: ProcessRef | null;
  /** Canonical runtime thread ref resolved without reading span display fields. */
  threadRef: ThreadRef | null;
};

/**
 * Lightweight Arrow-native span payload used for lane assignment.
 */
export type TraceSpanLaneSource = {
  /** Canonical runtime span ref used for selection, highlight, and geometry. */
  spanRef: SpanRef;
  /** Canonical owning process ref used by ref-native runtime layout and grouping. */
  processRef: ProcessRef;
  /** Canonical owning thread ref used by ref-native runtime layout and grouping. */
  threadRef: ThreadRef;
  /** Stable span identifier used for lane maps and selection state. */
  spanId: TraceSpanId;
  /** Owning thread identifier used for per-thread lane assignment. */
  threadId: TraceThreadId;
  /** Primary timing key selected for the span. */
  primaryTimingKey: string;
  /** Available timing projections keyed by source. */
  timings: Record<string, TraceSpanTiming>;
  /** Thread-relative top edge used when the owning trace opts into manual span layout. */
  layoutTopY?: number;
  /** Rendered height used when the owning trace opts into manual span layout. */
  layoutHeight?: number;
  /** Optional scalar trace id used for generated-lane affinity. */
  traceAffinityKey?: string | number | bigint;
  /** Optional span user data reserved for detail-only compatibility consumers. */
  userData?: Record<string, unknown>;
};

/**
 * Narrow Arrow-native span payload consumed by generated trace layout.
 *
 * Generated lane assignment needs ownership, timing envelopes, and optional affinity, but it does
 * not need display ids or authored manual geometry. This object path is reserved for filtered or
 * richer timing/affinity fallback cases.
 */
export type TraceSpanLayoutLaneSource = Pick<
  TraceSpanLaneSource,
  'spanRef' | 'processRef' | 'threadRef' | 'primaryTimingKey' | 'timings' | 'traceAffinityKey'
>;

/**
 * Lightweight Arrow-native span payload used for geometry rebuilds.
 */
export type TraceSpanGeometrySource = Pick<
  TraceSpanLaneSource,
  'spanRef' | 'primaryTimingKey' | 'timings' | 'layoutTopY' | 'layoutHeight'
> &
  Partial<Pick<TraceSpanLaneSource, 'processRef' | 'threadRef' | 'spanId' | 'threadId'>>;

/**
 * Arrow-native span payload used by render, selection, search, and card surfaces.
 */
export type TraceSpanDetailSource = TraceSpanLaneSource & {
  /** Human-readable process label attached to the span. */
  processName: string;
  /** Span display name. */
  name: string;
  /** Optional source label used by filters and span inspection surfaces. */
  source: string | null;
  /** Optional keyword labels shown in cards, search, and filters. */
  keywords: string[];
  /** Optional unresolved cross-rank endpoint id. */
  crossProcessEndpointId: TraceCrossProcessEndpointId | null;
  /** Structured unresolved cross-rank endpoints attached to the span. */
  crossProcessDependencyEndpoints: TraceCrossProcessEndpoint[];
};

/**
 * Span-ref keyed payload consumed by deck render layers.
 */
export type TraceRenderSpan = TraceSpanDetailSource &
  Partial<Pick<TraceSpan, 'sameProcessDependencyIds'>>;

/** Shared runtime metadata kept on any lightweight visible dependency render source. */
export type TraceDependencyRenderSourceCommon = {
  /** Exact visible source span ref used for geometry and selection when available. */
  startSpanRef: SpanRef | null;
  /** Exact visible destination span ref used for geometry and selection when available. */
  endSpanRef: SpanRef | null;
  /** Dependency timing mode needed by deck rendering and lightweight tooltip shells. */
  waitMode: TraceSameProcessDependency['waitMode'];
  /** Whether the dependency should render bidirectional arrows. */
  bidirectional: boolean;
  /** Wait duration needed by deck rendering and lightweight tooltip shells. */
  waitTimeMs: number;
  /** Whether the dependency should route as a parent-child edge. */
  isParent: boolean;
};

/** Lightweight visible same-process dependency payload used by render, pick, and selection paths. */
export type TraceSameProcessDependencyRenderSource = TraceDependencyRenderSourceCommon & {
  /** Same-process dependency discriminator kept for runtime branching. */
  type: 'trace-same-process-dependency';
  /** Canonical same-process dependency ref used by cards to resolve descriptive data later. */
  dependencyRef: SameProcessDependencyRef;
  /** Owning process ref used to route same-process dependency overlays to one rank layer. */
  processRef: ProcessRef;
};

/** Lightweight visible cross-process dependency payload used by render, pick, and selection paths. */
export type TraceCrossProcessDependencyRenderSource = TraceDependencyRenderSourceCommon & {
  /** Cross-process dependency discriminator kept for runtime branching. */
  type: 'trace-cross-process-dependency';
  /** Canonical cross-process dependency ref used by cards to resolve descriptive data later. */
  dependencyRef: CrossProcessDependencyRef;
  /** Visible source rank number needed by cross-rank rendering. */
  startRankNum: number;
  /** Visible destination rank number needed by cross-rank rendering. */
  endRankNum: number;
};

/** Union describing any lightweight visible dependency payload returned by render APIs. */
export type TraceDependencyRenderSource =
  | TraceSameProcessDependencyRenderSource
  | TraceCrossProcessDependencyRenderSource;

/**
 * Row-aligned sidecar payload resolved for one concrete span-table row.
 */
type TraceGraphSpanSidecarSource = {
  /** Arrow sidecar table aligned to the concrete chunk span table. */
  table: ArrowTraceSpanSidecarTable | null;
};

/** Shared runtime metadata kept on any ref-native visible dependency source. */
export type TraceDependencySourceCommon = {
  /** Canonical owning process ref for the visible dependency when available. */
  processRef?: ProcessRef | undefined;
  /** Stable source dependency identifier. */
  dependencyId: TraceSameProcessDependency['dependencyId'];
  /** Stable source start block identifier kept for legacy routing/debug metadata. */
  startSpanId: TraceSpanId;
  /** Stable source end block identifier kept for legacy routing/debug metadata. */
  endSpanId: TraceSpanId;
  /** Canonical owning start-thread ref when available. */
  startThreadRef?: ThreadRef | undefined;
  /** Canonical owning end-thread ref when available. */
  endThreadRef?: ThreadRef | undefined;
  /** Exact visible start span ref used for geometry and traversal when available. */
  startSpanRef?: SpanRef | undefined;
  /** Exact visible end span ref used for geometry and traversal when available. */
  endSpanRef?: SpanRef | undefined;
  /** Dependency timing mode kept for cards and tooltips. */
  waitMode: TraceSameProcessDependency['waitMode'];
  /** Whether the dependency should render bidirectional arrows. */
  bidirectional: boolean;
  /** Wait duration kept for coloring and inspection. */
  waitTimeMs: number;
  /** Dependency keywords kept for filtering and tooltips. */
  keywords: ReadonlySet<string>;
  /** Optional dependency user data kept for app-specific tooltips. */
  userData?: Record<string, unknown>;
};

/** Ref-native visible same-process dependency payload used by runtime layout and rendering surfaces. */
export type TraceSameProcessDependencySource = TraceDependencySourceCommon & {
  /** Same-process dependency discriminator kept for runtime branching. */
  type: 'trace-same-process-dependency';
  /** Canonical runtime dependency ref for geometry and selection when available. */
  dependencyRef?: TraceDependencyRef | undefined;
};

/** Union describing any ref-native visible dependency payload returned by TraceGraph runtime APIs. */
export type TraceDependencySource =
  | TraceSameProcessDependencySource
  | TraceCrossProcessDependencyRenderSource;

/** Ref-native process payload used by TraceGraph runtime lookup APIs. */
export type TraceProcessSource = {
  /** Canonical runtime process ref. */
  processRef: ProcessRef;
  /** Human-readable process label. */
  name: string;
  /** Stable source process index used by runtime refs and compatibility APIs. */
  rankNum: number;
  /** Optional visual row order for trace layout; falls back to rankNum when omitted. */
  processOrder?: number;
  /** Optional process user data preserved from ingestion. */
  userData?: Record<string, unknown>;
};

/** Ref-native thread payload used by TraceGraph runtime lookup APIs. */
export type TraceThreadSource = {
  /** Canonical runtime thread ref. */
  threadRef: ThreadRef;
  /** Canonical owning process ref. */
  processRef: ProcessRef;
  /** Stable ingestion thread id used to align layout rows with runtime refs. */
  threadId: TraceThreadId;
  /** Human-readable thread label. */
  name: string;
  /** Optional thread user data preserved from ingestion. */
  userData?: Record<string, unknown>;
};

/** Ref-native graph-global event payload used by prepared scene and deck layers. */
export type TraceEventSource = {
  /** Discriminator that lets generic trace-object tooltip paths render this event source. */
  type: 'trace-event';
  /** Canonical runtime event ref. */
  eventRef: EventRef;
  /** Stable ingestion event id kept for debug and bridge consumers. */
  eventId: TraceEvent['eventId'];
  /** Human-readable event label. */
  name: string;
  /** Event timestamp in milliseconds. */
  atTimeMs: number;
  /** Optional event user data preserved from ingestion. */
  userData?: Record<string, unknown>;
};

/** Ref-native instant payload used by prepared scene and deck layers. */
export type TraceInstantSource = {
  /** Canonical runtime instant ref. */
  instantRef: InstantRef;
  /** Canonical owning process ref. */
  processRef: ProcessRef;
  /** Canonical owning thread ref. */
  threadRef: ThreadRef;
  /** Stable ingestion instant id kept for debug and bridge consumers. */
  instantId: TraceInstant['instantId'];
  /** Stable ingestion thread id kept as compatibility metadata. */
  threadId: TraceThreadId;
  /** Human-readable instant label. */
  name: string;
  /** Instant timestamp in milliseconds. */
  atTimeMs: number;
  /** Instant scope preserved from ingestion. */
  scope: TraceInstant['scope'];
  /** Optional instant user data preserved from ingestion. */
  userData?: Record<string, unknown>;
};

/** Ref-native counter payload used by prepared scene and deck layers. */
export type TraceCounterSource = {
  /** Canonical runtime counter ref. */
  counterRef: CounterRef;
  /** Canonical owning process ref. */
  processRef: ProcessRef;
  /** Canonical owning thread ref. */
  threadRef: ThreadRef;
  /** Stable ingestion counter id kept for debug and bridge consumers. */
  counterId: TraceCounter['counterId'];
  /** Stable ingestion thread id kept as compatibility metadata. */
  threadId: TraceThreadId;
  /** Human-readable counter label. */
  name: string;
  /** Counter timestamp in milliseconds. */
  atTimeMs: number;
  /** Total counter value at the sample. */
  totalValue: number;
  /** Multi-series counter sample values preserved from ingestion. */
  series: Record<string, number>;
  /** Optional counter user data preserved from ingestion. */
  userData?: Record<string, unknown>;
};

/**
 * Supported cheap Arrow span field reads that avoid full block materialization.
 */
export type ArrowTraceSpanFieldName =
  | 'spanId'
  | 'threadId'
  | 'name'
  | 'source'
  | 'processName'
  | 'primaryTimingKey'
  | 'status'
  | 'startTimeMs'
  | 'endTimeMs'
  | 'durationMs'
  | 'durationMsAsString'
  | 'layoutTopY'
  | 'layoutHeight'
  | 'keywords';

const NOT_STARTED_BLOCK_DURATION_MS = 1_000;
const NOT_FINISHED_BLOCK_END_TIME_DEFAULT = Number.MAX_SAFE_INTEGER;

/** Resolves a span ref by legacy block id only when that id is unique in the graph. */
export function getUniqueTraceGraphSpanRef(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanId: TraceSpanId
): SpanRef | null {
  const spanRefBySpanId = getUniqueSpanRefBySpanId(traceGraph);
  return spanRefBySpanId.has(spanId) ? spanRefBySpanId.get(spanId)! : null;
}

/** Resolves the owning process id for one chunk-local span row. */
export function getTraceGraphSpanRefProcessId(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef
): TraceProcessId | null {
  return getTraceGraphSpanStoreRow(traceGraph, spanRef)?.processId ?? null;
}

/** Returns whether one span ref belongs to the active graph selection. */
export function isTraceGraphSpanRefActive(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef
): boolean {
  if (traceGraph.spanRefs == null) {
    return true;
  }
  if (findSortedSpanRefIndex(traceGraph.spanRefs, spanRef) !== -1) {
    return true;
  }
  return traceGraph.spanRefs.includes(spanRef);
}

/** Resolves the compact Arrow span-table row that backs one stable kept span ref. */
export function getTraceGraphSpanTableRowIndex(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef
): number | null {
  if (!isTraceGraphSpanRefActive(traceGraph, spanRef)) {
    return null;
  }
  const chunk = resolveChunkBySpanRef(traceGraph, spanRef);
  return chunk ? getArrowTraceChunkSpanTableRowIndex(chunk, getSpanRefRowIndex(spanRef)) : null;
}

/**
 * Fills a reusable UTF-8 byte view for one span display name without decoding it to a string.
 */
export function getTraceGraphSpanNameUtf8(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef,
  out: Utf8StringView
): boolean {
  const spanRow = getTraceGraphSpanStoreRow(traceGraph, spanRef);
  const nameColumn = spanRow
    ? (getArrowColumn<string>(spanRow.spanTable, 'name') as unknown as arrow.Vector<arrow.Utf8>)
    : null;
  return spanRow && nameColumn ? getArrowUtf8RowView(nameColumn, spanRow.rowIndex, out) : false;
}

/** Iterates every canonical span ref in graph order without materializing `TraceSpan`s. */
export function* iterateTraceGraphSpanRefs(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>
): IterableIterator<SpanRef> {
  if (traceGraph.spanRefs) {
    yield* traceGraph.spanRefs;
    return;
  }

  for (const chunk of traceGraph.chunks) {
    const spanRowCount = getArrowTraceChunkSpanRowCount(chunk);
    for (let chunkRowOrdinal = 0; chunkRowOrdinal < spanRowCount; chunkRowOrdinal += 1) {
      const spanRefRowIndex = getArrowTraceChunkSpanRefRowIndex(chunk, chunkRowOrdinal);
      if (spanRefRowIndex != null) {
        yield encodeSpanRef(chunk.chunkIndex, spanRefRowIndex);
      }
    }
  }
}

/**
 * Iterates canonical span refs with their process-local table rows.
 *
 * Modern Arrow-backed graphs already scan the process-local span-ref table to enumerate refs, so
 * callers that need both values should use this iterator instead of resolving each yielded ref
 * back to the same row with a binary search. Legacy graphs without a process-local table retain
 * their existing enumeration order and receive a matching process-local row index.
 */
export function* iterateTraceGraphProcessSpanRefRows(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId | string
): IterableIterator<TraceGraphProcessSpanRefRow> {
  const typedProcessId = processId as TraceProcessId;
  const spanRefTable = traceGraph.processSpanTableMap[typedProcessId];
  const spanRefColumn = spanRefTable ? getArrowColumn<unknown>(spanRefTable, 'span_ref') : null;
  if (spanRefTable && spanRefColumn) {
    for (let processRowIndex = 0; processRowIndex < spanRefTable.numRows; processRowIndex += 1) {
      const spanRef = normalizeArrowRefNumber(spanRefColumn.get(processRowIndex));
      if (spanRef != null) {
        yield {
          spanRef: spanRef as SpanRef,
          processRowIndex
        };
      }
    }
    return;
  }

  const processIndex = getTraceGraphProcessIndex(traceGraph, typedProcessId);
  if (processIndex == null) {
    return;
  }

  const processRef = traceGraph.processes[processIndex] ? traceGraphProcessRef(processIndex) : null;
  if (processRef == null) {
    return;
  }
  if (traceGraph.spanRefs) {
    let processRowIndex = 0;
    for (const spanRef of traceGraph.spanRefs) {
      const spanRow = getTraceGraphSpanTableRow(traceGraph, spanRef);
      if (spanRow?.processRef === processRef) {
        yield {spanRef, processRowIndex};
        processRowIndex += 1;
      }
    }
    return;
  }

  let processRowIndex = 0;
  for (const chunk of traceGraph.chunks) {
    const spanRowCount = getArrowTraceChunkSpanRowCount(chunk);
    for (let chunkRowOrdinal = 0; chunkRowOrdinal < spanRowCount; chunkRowOrdinal += 1) {
      const tableRowIndex = getArrowTraceChunkSpanTableRowIndexAt(chunk, chunkRowOrdinal);
      const spanRefRowIndex = getArrowTraceChunkSpanRefRowIndex(chunk, chunkRowOrdinal);
      if (
        tableRowIndex != null &&
        spanRefRowIndex != null &&
        readArrowRefColumn(chunk.spanTable, 'process_ref', tableRowIndex) === processRef
      ) {
        yield {
          spanRef: encodeSpanRef(chunk.chunkIndex, spanRefRowIndex),
          processRowIndex
        };
        processRowIndex += 1;
      }
    }
  }
}

/** Iterates canonical span refs for one process in process-local row order. */
export function* iterateTraceGraphProcessSpanRefs(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId | string
): IterableIterator<SpanRef> {
  for (const {spanRef} of iterateTraceGraphProcessSpanRefRows(traceGraph, processId)) {
    yield spanRef;
  }
}

/**
 * Resolves the process-local `processSpanTableMap` row index for a source span ref.
 *
 * `TraceProcessSpanRefTable.span_ref` is built in ascending `SpanRef` order and row-aligns
 * optional process-local layout columns with that sorted span-ref column. This accessor relies on
 * that invariant to binary-search the process table instead of scanning all process rows for every
 * arbitrary chunk-local `SpanRef` lookup.
 */
export function getTraceGraphProcessSpanRowIndex(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId | string,
  spanRef: SpanRef
): number | null {
  const spanRefTable = traceGraph.processSpanTableMap[processId as TraceProcessId];
  const spanRefColumn = spanRefTable ? getArrowColumn<unknown>(spanRefTable, 'span_ref') : null;
  if (!spanRefTable || !spanRefColumn) {
    return null;
  }

  let low = 0;
  let high = spanRefTable.numRows - 1;
  while (low <= high) {
    const rowIndex = Math.floor((low + high) / 2);
    const rowSpanRef = normalizeArrowRefNumber(spanRefColumn.get(rowIndex));
    if (rowSpanRef == null) {
      return null;
    }
    if (rowSpanRef === spanRef) {
      return rowIndex;
    }
    if (rowSpanRef < spanRef) {
      low = rowIndex + 1;
    } else {
      high = rowIndex - 1;
    }
  }
  return null;
}

/**
 * Reads one cheap Arrow span field without materializing a full `TraceSpan`.
 */
export function getArrowTraceSpanField(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  span: TraceSpanId | SpanRef,
  fieldName: ArrowTraceSpanFieldName
): string | number | readonly string[] | null {
  const spanIndex = resolveSpanIndex(traceGraph, span);
  if (spanIndex == null) {
    return null;
  }

  const chunk = resolveChunkBySpanRef(traceGraph, spanIndex);
  const rowIndex = chunk
    ? getArrowTraceChunkSpanTableRowIndex(chunk, getSpanRefRowIndex(spanIndex))
    : null;
  if (!chunk || rowIndex == null) {
    return null;
  }

  const blockTable = chunk.spanTable;
  if (fieldName === 'durationMsAsString') {
    return formatPrimaryDurationLabel(
      readTraceSpanPrimaryTimingStatus(blockTable, rowIndex) ?? 'finished',
      readColumnValue<number>(blockTable, 'duration_ms', rowIndex) ?? 0
    );
  }
  if (fieldName === 'status') {
    return readTraceSpanPrimaryTimingStatus(blockTable, rowIndex);
  }

  if (fieldName !== 'processName' && fieldName !== 'keywords') {
    return (
      readColumnValue<string | number>(
        blockTable,
        getArrowTraceSpanFieldColumnName(fieldName),
        rowIndex
      ) ?? null
    );
  }

  const processRef = readArrowRefColumn(blockTable, 'process_ref', rowIndex);
  const processId =
    chunk.processId ??
    (processRef == null
      ? null
      : (traceGraph.processIdsByIndex[getProcessRefIndex(processRef as ProcessRef)] ?? null));
  if (!processId) {
    return null;
  }

  if (fieldName === 'processName') {
    return getTraceGraphProcessName(traceGraph, processId, processRef);
  }
  if (fieldName === 'keywords') {
    return getTraceGraphSpanKeywords(
      traceGraph,
      processId,
      blockTable,
      rowIndex,
      getTraceGraphSpanSidecarSource(traceGraph, processId, chunk, rowIndex)
    );
  }

  return null;
}

/**
 * Resolves one Arrow-native span source used by lane-assignment helpers.
 */
export function getTraceGraphSpanLaneSource(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef
): TraceSpanLaneSource | null {
  return getTraceGraphSpanLaneSourceByRef(traceGraph, spanRef, true);
}

/**
 * Resolves the narrow Arrow-native source used by generated auto-layout.
 *
 * This preserves active-row and canonical owner-ref validation plus the complete multi-timing
 * envelope. Dataset-owned refs are authoritative here, so generated layout intentionally skips
 * reading display ids, thread ids, and manual geometry fields that it does not consume.
 */
export function getTraceGraphSpanLayoutLaneSource(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef
): TraceSpanLayoutLaneSource | null {
  return getTraceGraphSpanLayoutLaneSourceByRef(traceGraph, spanRef, true);
}

/**
 * Resolves one Arrow-native lane source when the caller already owns an active span ref.
 */
export function getActiveTraceGraphSpanLaneSource(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef
): TraceSpanLaneSource | null {
  return getTraceGraphSpanLaneSourceByRef(traceGraph, spanRef, false);
}

/**
 * Resolves one Arrow-native span source when the caller already owns an active span ref.
 */
export function getActiveTraceGraphSpanGeometrySource(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef
): TraceSpanGeometrySource | null {
  return getTraceGraphSpanGeometrySourceByRef(traceGraph, spanRef, false);
}

function getTraceGraphSpanLaneSourceByRef(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanIndex: SpanRef,
  validateActive: boolean
): TraceSpanLaneSource | null {
  const spanRow = getTraceGraphSpanTableRow(traceGraph, spanIndex, validateActive);
  const processId = spanRow?.processId ?? null;
  if (!processId) {
    return null;
  }
  const blockTable = spanRow?.spanTable;
  if (!blockTable) {
    return null;
  }

  return buildTraceSpanLaneSource(
    traceGraph,
    processId,
    blockTable,
    spanRow.rowIndex,
    spanIndex,
    getTraceGraphSpanSidecarSource(traceGraph, processId, spanRow.chunk, spanRow.rowIndex),
    {
      processRef: spanRow.processRef,
      threadRef: spanRow.threadRef
    }
  );
}

/** Resolves one narrow generated-layout lane source with optional active-ref validation. */
function getTraceGraphSpanLayoutLaneSourceByRef(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanIndex: SpanRef,
  validateActive: boolean
): TraceSpanLayoutLaneSource | null {
  const spanRow = getTraceGraphSpanTableAddress(traceGraph, spanIndex, validateActive);
  const processId = spanRow?.processId ?? null;
  const blockTable = spanRow?.spanTable;
  if (!processId || !blockTable || spanRow.processRef == null || spanRow.threadRef == null) {
    return null;
  }

  return buildTraceSpanLayoutLaneSource(
    traceGraph,
    processId,
    blockTable,
    spanRow.rowIndex,
    spanIndex,
    getTraceGraphSpanSidecarSource(traceGraph, processId, spanRow.chunk, spanRow.rowIndex),
    {
      processRef: spanRow.processRef,
      threadRef: spanRow.threadRef
    }
  );
}

/** Resolves one geometry source from a canonical span ref with optional active-ref validation. */
function getTraceGraphSpanGeometrySourceByRef(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanIndex: SpanRef,
  validateActive: boolean,
  timingKey?: string | null
): TraceSpanGeometrySource | null {
  const spanRow = getTraceGraphSpanTableAddress(traceGraph, spanIndex, validateActive);
  const processId = spanRow?.processId ?? null;
  if (!processId) {
    return null;
  }
  const blockTable = spanRow?.spanTable;
  if (!blockTable) {
    return null;
  }

  return buildTraceSpanGeometrySource(
    traceGraph,
    processId,
    blockTable,
    spanRow.rowIndex,
    spanIndex,
    getTraceGraphSpanSidecarSource(traceGraph, processId, spanRow.chunk, spanRow.rowIndex),
    {
      processRef: spanRow.processRef,
      threadRef: spanRow.threadRef
    },
    timingKey
  );
}

/**
 * Resolves one Arrow-native span source used by geometry rebuilds.
 * Pass `null` or the primary timing key to avoid decoding full timing sidecars.
 */
export function getTraceGraphSpanGeometrySource(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef,
  timingKey?: string | null
): TraceSpanGeometrySource | null {
  return getTraceGraphSpanGeometrySourceByRef(traceGraph, spanRef, true, timingKey);
}

/**
 * Resolves one span user-data payload using chunk-aware Arrow sidecar lookup.
 */
export function getTraceGraphSpanUserData(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  span: TraceSpanId | SpanRef
): Record<string, unknown> | undefined {
  const spanIndex = resolveSpanIndex(traceGraph, span);
  if (spanIndex == null) {
    return undefined;
  }

  const spanRow = getTraceGraphSpanTableRow(traceGraph, spanIndex);
  const processId = spanRow?.processId ?? null;
  if (!processId || !spanRow) {
    return undefined;
  }

  const sidecarSource = getTraceGraphSpanSidecarSource(
    traceGraph,
    processId,
    spanRow.chunk,
    spanRow.rowIndex
  );
  return readTraceGraphSpanUserData(
    traceGraph,
    processId,
    spanRow.spanTable,
    spanRow.rowIndex,
    sidecarSource
  );
}

/** Returns whether every loaded span-table schema declares one attribute path. */
export function hasTraceGraphSpanAttribute(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  path: TraceSpanAttributePath
): boolean {
  if (path.length === 0) {
    return false;
  }
  const populatedChunks = traceGraph.chunks.filter(chunk => chunk.spanTable.numRows > 0);
  return (
    populatedChunks.length > 0 &&
    populatedChunks.every(chunk => hasArrowTableAttributePath(chunk.spanTable, path))
  );
}

/**
 * Resolves one declared span attribute directly from optional Arrow span-table columns.
 */
export function getTraceGraphSpanAttribute(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  span: TraceSpanId | SpanRef,
  path: TraceSpanAttributePath
): unknown {
  if (path.length === 0) {
    return undefined;
  }
  const spanIndex = resolveSpanIndex(traceGraph, span);
  if (spanIndex == null) {
    return undefined;
  }
  const spanRow = getTraceGraphSpanTableRow(traceGraph, spanIndex);
  if (!spanRow) {
    return undefined;
  }
  return readArrowTableAttributeValue(spanRow.spanTable, spanRow.rowIndex, path);
}

/**
 * Resolves the external source id stored on one span row, when present.
 */
export function getTraceGraphSpanExternalSpanId(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  span: TraceSpanId | SpanRef
): string | null {
  const spanIndex = resolveSpanIndex(traceGraph, span);
  if (spanIndex == null) {
    return null;
  }

  const spanRow = getTraceGraphSpanTableRow(traceGraph, spanIndex);
  if (!spanRow) {
    return null;
  }

  const externalSpanId = readColumnValue<string>(
    spanRow.spanTable,
    'external_span_id',
    spanRow.rowIndex
  );
  return externalSpanId && externalSpanId.length > 0 ? externalSpanId : null;
}

/**
 * Resolves one Arrow-native source without expanding same-process dependency ids.
 */
export function getTraceGraphSpanDetailSource(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef
): TraceSpanDetailSource | null {
  return getTraceGraphSpanSourceByRef(traceGraph, spanRef, true);
}

/**
 * Resolves one Arrow-native source when the caller already owns an active span ref.
 */
export function getActiveTraceGraphSpanDetailSource(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef
): TraceSpanDetailSource | null {
  return getTraceGraphSpanSourceByRef(traceGraph, spanRef, false);
}

function getTraceGraphSpanSourceByRef(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanIndex: SpanRef,
  validateActive: boolean
): TraceSpanDetailSource | null {
  const spanRow = getTraceGraphSpanTableRow(traceGraph, spanIndex, validateActive);
  const processId = spanRow?.processId ?? null;
  if (!processId) {
    return null;
  }
  const rowIndex = spanRow?.rowIndex ?? null;
  const blockTable = spanRow?.spanTable;
  if (!blockTable || rowIndex == null) {
    return null;
  }

  const sidecarSource = getTraceGraphSpanSidecarSource(
    traceGraph,
    processId,
    spanRow.chunk,
    rowIndex
  );
  const laneSource = buildTraceSpanLaneSource(
    traceGraph,
    processId,
    blockTable,
    rowIndex,
    spanIndex,
    sidecarSource,
    {
      processRef: spanRow.processRef,
      threadRef: spanRow.threadRef
    }
  );
  if (!laneSource) {
    return null;
  }

  const processName = getTraceGraphProcessName(traceGraph, processId);
  const name = readColumnValue<string>(blockTable, 'name', rowIndex);
  if (!processName || !name) {
    return null;
  }

  const spanSource = {
    ...laneSource,
    processName,
    name,
    source: readColumnValue<string>(blockTable, 'source', rowIndex) ?? null,
    userData: readTraceGraphSpanUserData(
      traceGraph,
      processId,
      blockTable,
      rowIndex,
      sidecarSource
    ),
    keywords: getTraceGraphSpanKeywords(traceGraph, processId, blockTable, rowIndex, sidecarSource),
    crossProcessEndpointId: getTraceGraphCrossProcessEndpointId(
      traceGraph,
      processId,
      blockTable,
      rowIndex,
      sidecarSource
    ),
    crossProcessDependencyEndpoints: getTraceGraphCrossProcessEndpoints(
      traceGraph,
      processId,
      blockTable,
      rowIndex,
      spanIndex,
      sidecarSource
    )
  } satisfies TraceSpanDetailSource;

  return spanSource;
}

/**
 * Reads all row-aligned Arrow span-table values for one selected span.
 *
 * The canonical span table is always included when the span ref is valid. The optional span sidecar
 * table is included when present for the same storage chunk.
 */
export function getTraceGraphSpanArrowColumnValues(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  span: TraceSpanId | SpanRef
): TraceGraphSpanArrowColumnValue[] {
  const spanIndex = resolveSpanIndex(traceGraph, span);
  if (spanIndex == null) {
    return [];
  }

  const chunk = resolveChunkBySpanRef(traceGraph, spanIndex);
  const rowIndex = chunk
    ? getArrowTraceChunkSpanTableRowIndex(chunk, getSpanRefRowIndex(spanIndex))
    : null;
  if (!chunk || rowIndex == null) {
    return [];
  }

  return [
    ...getArrowTableRowColumnValues(chunk.spanTable, rowIndex, 'spanTable'),
    ...getArrowTableRowColumnValues(chunk.spanSidecarTable ?? null, rowIndex, 'spanSidecarTable')
  ];
}

/**
 * Returns the full timing envelope for a span across all available timing projections.
 */
export function getSpanExtremalTiming(
  span: TimedEntity,
  maxTimeMs = NOT_FINISHED_BLOCK_END_TIME_DEFAULT
): SpanTimeExtents {
  let startTimeMs = Number.POSITIVE_INFINITY;
  let endTimeMs = Number.NEGATIVE_INFINITY;

  for (const timingKey in span.timings) {
    const timing = span.timings[timingKey];
    if (!timing || !Number.isFinite(timing.startTimeMs)) {
      continue;
    }

    const resolvedEndTimeMs = resolveSpanTimingEndTime(timing, maxTimeMs);
    if (timing.startTimeMs < startTimeMs) {
      startTimeMs = timing.startTimeMs;
    }
    if (resolvedEndTimeMs > endTimeMs) {
      endTimeMs = resolvedEndTimeMs;
    }
  }

  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)) {
    const primaryTiming = getPrimaryTiming(resolveSpanTimingSource(span));
    if (!Number.isFinite(primaryTiming.startTimeMs)) {
      return {startTimeMs: 0, endTimeMs: 0};
    }
    return {
      startTimeMs: primaryTiming.startTimeMs,
      endTimeMs: resolveSpanTimingEndTime(primaryTiming, maxTimeMs)
    };
  }

  if (endTimeMs < startTimeMs) {
    const primaryTiming = getPrimaryTiming(resolveSpanTimingSource(span));
    if (!Number.isFinite(primaryTiming.startTimeMs)) {
      return {startTimeMs: 0, endTimeMs: 0};
    }
    return {
      startTimeMs: primaryTiming.startTimeMs,
      endTimeMs: resolveSpanTimingEndTime(primaryTiming, maxTimeMs)
    };
  }

  return {startTimeMs, endTimeMs};
}

/**
 * Returns the time-axis timing envelope for a span across all eligible timing projections.
 */
export function getSpanExtremalTimingForTimeExtents(
  span: TimedEntity,
  maxTimeMs = NOT_FINISHED_BLOCK_END_TIME_DEFAULT
): SpanTimeExtents | null {
  let startTimeMs = Number.POSITIVE_INFINITY;
  let endTimeMs = Number.NEGATIVE_INFINITY;

  for (const timingKey in span.timings) {
    const timing = span.timings[timingKey];
    if (!timing || !isTraceSpanTimingEligibleForTimeExtents(timing)) {
      continue;
    }

    const resolvedEndTimeMs = resolveSpanTimingEndTime(timing, maxTimeMs);
    startTimeMs = Math.min(startTimeMs, timing.startTimeMs);
    endTimeMs = Math.max(endTimeMs, resolvedEndTimeMs);
  }

  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs) || endTimeMs < startTimeMs) {
    const primaryTiming = getPrimaryTiming(resolveSpanTimingSource(span));
    if (!isTraceSpanTimingEligibleForTimeExtents(primaryTiming)) {
      return null;
    }
    return {
      startTimeMs: primaryTiming.startTimeMs,
      endTimeMs: resolveSpanTimingEndTime(primaryTiming, maxTimeMs)
    };
  }

  return {startTimeMs, endTimeMs};
}

function resolveSpanTimingEndTime(
  timing: TraceSpanTiming,
  maxTimeMs = NOT_FINISHED_BLOCK_END_TIME_DEFAULT
): number {
  return resolveTraceSpanTimingEndTimeFields(
    timing.status,
    timing.startTimeMs,
    timing.endTimeMs,
    maxTimeMs
  );
}

/**
 * Resolves one timing end directly from bound scalar fields without allocating a timing object.
 *
 * Arrow-bound generated geometry callers can use this before passing primary timing scalars to
 * columnar layout writers, preserving unfinished and not-started timing semantics without
 * constructing a `TraceSpanTiming` object.
 */
export function resolveTraceSpanTimingEndTimeFields(
  status: TraceSpanTiming['status'],
  startTimeMs: number,
  sourceEndTimeMs: number,
  maxTimeMs = NOT_FINISHED_BLOCK_END_TIME_DEFAULT
): number {
  let endTimeMs = sourceEndTimeMs;
  if (!Number.isFinite(endTimeMs) || endTimeMs <= startTimeMs) {
    if (status === 'not-finished') {
      const unfinishedEnd = Number.isFinite(maxTimeMs)
        ? Math.max(maxTimeMs, startTimeMs)
        : NOT_FINISHED_BLOCK_END_TIME_DEFAULT;
      endTimeMs = Math.max(unfinishedEnd, startTimeMs + 1);
    } else if (status === 'not-started') {
      endTimeMs = startTimeMs + NOT_STARTED_BLOCK_DURATION_MS;
    } else {
      endTimeMs = startTimeMs;
    }
  }
  return endTimeMs;
}

/**
 * Returns the finite timing envelope for a span across all available timing projections.
 *
 * Unlike `getSpanExtremalTiming(...)`, this does not expand unfinished spans to a synthetic
 * maximum horizon. It is intended for canonical graph-wide bounds where the envelope should stay
 * anchored to finite timestamps present in the source data.
 */
export function getSpanFiniteTimingEnvelope(span: TimedEntity): SpanTimeExtents {
  let startTimeMs = Number.POSITIVE_INFINITY;
  let endTimeMs = Number.NEGATIVE_INFINITY;

  for (const timing of Object.values(span.timings)) {
    if (Number.isFinite(timing.startTimeMs)) {
      startTimeMs = Math.min(startTimeMs, timing.startTimeMs);
      endTimeMs = Math.max(endTimeMs, timing.startTimeMs);
    }

    if (Number.isFinite(timing.endTimeMs)) {
      startTimeMs = Math.min(startTimeMs, timing.endTimeMs);
      endTimeMs = Math.max(endTimeMs, timing.endTimeMs);
    }
  }

  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)) {
    const primary = getPrimaryTiming(resolveSpanTimingSource(span));
    const primaryPoints = [primary.startTimeMs, primary.endTimeMs].filter(Number.isFinite);
    if (primaryPoints.length === 0) {
      return {startTimeMs: 0, endTimeMs: 0};
    }
    const primaryStartTimeMs = primaryPoints[0] ?? 0;
    const primaryEndTimeMs = primaryPoints[1] ?? primaryStartTimeMs;

    return {
      startTimeMs: Math.min(primaryStartTimeMs, primaryEndTimeMs),
      endTimeMs: Math.max(primaryStartTimeMs, primaryEndTimeMs)
    };
  }

  return {startTimeMs, endTimeMs};
}

/**
 * Returns the finite timing envelope used by graph-wide time-axis bounds.
 */
export function getSpanFiniteTimingEnvelopeForTimeExtents(
  span: TimedEntity
): SpanTimeExtents | null {
  let startTimeMs = Number.POSITIVE_INFINITY;
  let endTimeMs = Number.NEGATIVE_INFINITY;

  for (const timing of Object.values(span.timings)) {
    if (!isTraceSpanTimingEligibleForTimeExtents(timing)) {
      continue;
    }

    startTimeMs = Math.min(startTimeMs, timing.startTimeMs);
    endTimeMs = Math.max(endTimeMs, timing.startTimeMs);

    if (isTraceSpanTimingTimestampEligibleForTimeExtents(timing.endTimeMs)) {
      startTimeMs = Math.min(startTimeMs, timing.endTimeMs);
      endTimeMs = Math.max(endTimeMs, timing.endTimeMs);
    }
  }

  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)) {
    const primary = getPrimaryTiming(resolveSpanTimingSource(span));
    if (!isTraceSpanTimingEligibleForTimeExtents(primary)) {
      return null;
    }

    return {
      startTimeMs: primary.startTimeMs,
      endTimeMs: isTraceSpanTimingTimestampEligibleForTimeExtents(primary.endTimeMs)
        ? primary.endTimeMs
        : primary.startTimeMs
    };
  }

  return {startTimeMs, endTimeMs};
}

/**
 * Sorts spans by their earliest visible start, breaking ties by widest envelope first.
 */
export function sortSpansByTime<
  SpanT extends TimedEntity & {
    /** Stable external span id used as the final timing sort tie-breaker. */
    spanId: TraceSpanId;
  }
>(
  spans: readonly SpanT[],
  options: {
    /** Optional finite end time substituted for open spans during sorting. */
    maxTimeMs?: number;
  } = {}
): SpanT[] {
  return [...spans].sort((a, b) => {
    const aTiming = getSpanExtremalTiming(a, options.maxTimeMs);
    const bTiming = getSpanExtremalTiming(b, options.maxTimeMs);
    if (aTiming.startTimeMs !== bTiming.startTimeMs) {
      return aTiming.startTimeMs - bTiming.startTimeMs;
    }
    return bTiming.endTimeMs - aTiming.endTimeMs;
  });
}

/** Maps public camelCase span field names to canonical Arrow span table columns. */
function getArrowTraceSpanFieldColumnName(fieldName: ArrowTraceSpanFieldName): string {
  switch (fieldName) {
    case 'spanId':
      return 'span_id';
    case 'threadId':
      return 'thread_id';
    case 'primaryTimingKey':
      return 'primary_timing_key';
    case 'startTimeMs':
      return 'start_time_ms';
    case 'endTimeMs':
      return 'end_time_ms';
    case 'durationMs':
      return 'duration_ms';
    case 'status':
      return 'status_code';
    case 'layoutTopY':
      return 'layout_top_y';
    case 'layoutHeight':
      return 'layout_height';
    default:
      return fieldName;
  }
}

/**
 * Resolves the process name used as the display rank label.
 */
function getTraceGraphProcessName(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  processRef?: number | null
): string | null {
  const processIndex =
    processRef == null
      ? traceGraph.processIdsByIndex.indexOf(processId)
      : getProcessRefIndex(processRef as ProcessRef);
  const process = processIndex < 0 ? null : (traceGraph.processes[processIndex] ?? null);
  return process?.processId === processId
    ? process.name
    : (traceGraph.processes.find(candidate => candidate.processId === processId)?.name ?? null);
}

/**
 * Resolves one row-aligned sidecar payload when available.
 */
/** Resolves one Arrow-backed row-aligned span sidecar field when available. */
function getTraceGraphSpanSidecarTableValue<Value>(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  rowIndex: number,
  fieldName: string,
  sidecarSource: TraceGraphSpanSidecarSource
): Value | null {
  const table = sidecarSource.table ?? traceGraph.spanSidecarTableMap?.[processId] ?? null;
  return table ? (readColumnValue<Value>(table, fieldName, rowIndex) ?? null) : null;
}

/**
 * Resolves one Arrow-native non-primary timing projection without materializing sibling timings.
 */
function getTraceGraphSpanNativeTiming(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  rowIndex: number,
  timingKey: string,
  sidecarSource: TraceGraphSpanSidecarSource
): TraceSpanTiming | null {
  const table = sidecarSource.table ?? traceGraph.spanSidecarTableMap?.[processId] ?? null;
  const timingsColumn = table?.getChild('timings') as
    | arrow.Vector<arrow.Struct<arrow.TypeMap>>
    | null
    | undefined;
  const timingFieldIndex =
    timingsColumn?.type.children.findIndex(field => field.name === timingKey) ?? -1;
  const timingColumn =
    timingFieldIndex >= 0
      ? (timingsColumn?.getChildAt(timingFieldIndex) as
          | arrow.Vector<arrow.Struct<arrow.TypeMap>>
          | null
          | undefined)
      : null;
  if (!timingColumn) {
    return null;
  }

  const status = decodeTraceSpanTimingStatusCode(
    readTraceSpanNativeTimingField<number>(timingColumn, 'status_code', rowIndex)
  );
  const startTimeMs = readTraceSpanNativeTimingField<number>(
    timingColumn,
    'start_time_ms',
    rowIndex
  );
  const endTimeMs = readTraceSpanNativeTimingField<number>(timingColumn, 'end_time_ms', rowIndex);
  const durationMs = readTraceSpanNativeTimingField<number>(timingColumn, 'duration_ms', rowIndex);
  if (
    !status ||
    typeof startTimeMs !== 'number' ||
    typeof endTimeMs !== 'number' ||
    typeof durationMs !== 'number'
  ) {
    return null;
  }

  return {
    status,
    startTimeMs,
    endTimeMs,
    durationMs,
    durationMsAsString: formatPrimaryDurationLabel(status, durationMs)
  };
}

/**
 * Resolves all Arrow-native non-primary timing projections for detail-only materialization.
 */
function getTraceGraphSpanNativeTimings(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  rowIndex: number,
  sidecarSource: TraceGraphSpanSidecarSource
): Record<string, TraceSpanTiming> | null {
  const table = sidecarSource.table ?? traceGraph.spanSidecarTableMap?.[processId] ?? null;
  const timingsColumn = table?.getChild('timings') as
    | arrow.Vector<arrow.Struct<arrow.TypeMap>>
    | null
    | undefined;
  if (!timingsColumn) {
    return null;
  }

  const timings = Object.fromEntries(
    timingsColumn.type.children.flatMap(field => {
      const timing = getTraceGraphSpanNativeTiming(
        traceGraph,
        processId,
        rowIndex,
        field.name,
        sidecarSource
      );
      return timing ? [[field.name, timing] as const] : [];
    })
  );
  return Object.keys(timings).length > 0 ? timings : null;
}

/**
 * Resolves one span timing map from Arrow-native sidecars or legacy JSON payloads.
 */
function getTraceGraphSpanTimings(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  sidecarSource: TraceGraphSpanSidecarSource
): Record<string, TraceSpanTiming> | null {
  const nativeTimings = getTraceGraphSpanNativeTimings(
    traceGraph,
    processId,
    rowIndex,
    sidecarSource
  );
  const legacyTimings =
    deserializeArrowTraceJson<Record<string, TraceSpanTiming>>(
      getTraceGraphSpanSidecarTableValue<string>(
        traceGraph,
        processId,
        rowIndex,
        'timingsJson',
        sidecarSource
      )
    ) ??
    deserializeArrowTraceJson<Record<string, TraceSpanTiming>>(
      readColumnValue<string>(blockTable, 'timingsJson', rowIndex)
    ) ??
    null;
  if (!nativeTimings) {
    return legacyTimings;
  }
  return legacyTimings ? {...legacyTimings, ...nativeTimings} : nativeTimings;
}

/** Resolves one requested timing while preserving the scalar primary fallback. */
function getTraceGraphSpanTimingWithFallback(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  primaryTimingKey: string,
  fallbackTiming: TraceSpanTiming,
  sidecarSource: TraceGraphSpanSidecarSource,
  timingKey: string
): Record<string, TraceSpanTiming> {
  const requestedTiming =
    getTraceGraphSpanNativeTiming(traceGraph, processId, rowIndex, timingKey, sidecarSource) ??
    getTraceGraphSpanTimings(traceGraph, processId, blockTable, rowIndex, sidecarSource)?.[
      timingKey
    ];
  return requestedTiming
    ? {[primaryTimingKey]: fallbackTiming, [timingKey]: requestedTiming}
    : {[primaryTimingKey]: fallbackTiming};
}

/** Restores the scalar primary timing into a detail-only complete timing map. */
function getTraceGraphSpanTimingsWithFallback(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  primaryTimingKey: string,
  fallbackTiming: TraceSpanTiming,
  sidecarSource: TraceGraphSpanSidecarSource
): Record<string, TraceSpanTiming> {
  const timings = getTraceGraphSpanTimings(
    traceGraph,
    processId,
    blockTable,
    rowIndex,
    sidecarSource
  );
  return timings
    ? {...timings, [primaryTimingKey]: fallbackTiming}
    : {[primaryTimingKey]: fallbackTiming};
}

/** Reads one scalar child vector from a row-aligned native timing projection. */
function readTraceSpanNativeTimingField<Value>(
  timingColumn: arrow.Vector<arrow.Struct<arrow.TypeMap>>,
  fieldName: string,
  rowIndex: number
): Value | null {
  const fieldIndex = timingColumn.type.children.findIndex(field => field.name === fieldName);
  if (fieldIndex < 0) {
    return null;
  }
  return (timingColumn.getChildAt(fieldIndex)?.get(rowIndex) as Value | null | undefined) ?? null;
}

/**
 * Resolves one span user-data payload from the sidecar or legacy Arrow payload.
 */
function readTraceGraphSpanUserData(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  _blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  sidecarSource: TraceGraphSpanSidecarSource
): Record<string, unknown> | undefined {
  return (
    deserializeArrowTraceJson<Record<string, unknown>>(
      getTraceGraphSpanSidecarTableValue<string>(
        traceGraph,
        processId,
        rowIndex,
        'userDataJson',
        sidecarSource
      )
    ) ?? undefined
  );
}

/** Returns whether an Arrow table schema exposes one declared tuple path. */
function hasArrowTableAttributePath(
  table: Readonly<ArrowTraceSpanTable>,
  path: TraceSpanAttributePath
): boolean {
  const field = table.schema.fields.find(candidate => candidate.name === path[0]);
  if (!field) {
    return false;
  }
  let currentField = field as {
    type?: {children?: readonly {name: string; type?: {children?: readonly unknown[]}}[]};
  };
  for (let pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
    const child = currentField.type?.children?.find(
      candidate => candidate.name === path[pathIndex]
    );
    if (!child) {
      return false;
    }
    currentField = child as typeof currentField;
  }
  return true;
}

/** Reads one declared tuple path from an Arrow span row without decoding JSON payloads. */
function readArrowTableAttributeValue(
  table: Readonly<ArrowTraceSpanTable>,
  rowIndex: number,
  path: TraceSpanAttributePath
): unknown {
  const column = (
    table as unknown as {getChild(name: string): {get(index: number): unknown} | null}
  ).getChild(path[0]!);
  if (!column) {
    return undefined;
  }
  let value: unknown = column.get(rowIndex);
  for (let pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
    const key = path[pathIndex]!;
    if (value == null || typeof value !== 'object' || Array.isArray(value) || !(key in value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value != null &&
    typeof value === 'object' &&
    (Symbol.iterator in value || 'toArray' in value)
    ? toArray(value)
    : (value ?? undefined);
}

/**
 * Resolves span keywords from the sidecar or legacy Arrow payload.
 */
function getTraceGraphSpanKeywords(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  sidecarSource: TraceGraphSpanSidecarSource
): string[] {
  const sidecarTableKeywords = getTraceGraphSpanSidecarTableValue<unknown>(
    traceGraph,
    processId,
    rowIndex,
    'keywords',
    sidecarSource
  );
  if (sidecarTableKeywords != null) {
    return normalizeStringArray(sidecarTableKeywords);
  }

  return normalizeStringArray(readColumnValue<unknown>(blockTable, 'keywords', rowIndex));
}

/**
 * Resolves one unresolved cross-rank endpoint id from the sidecar or legacy Arrow payload.
 */
function getTraceGraphCrossProcessEndpointId(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  sidecarSource: TraceGraphSpanSidecarSource
): TraceCrossProcessEndpointId | null {
  return (
    (getTraceGraphSpanSidecarTableValue<string>(
      traceGraph,
      processId,
      rowIndex,
      'crossProcessEndpointId',
      sidecarSource
    ) as TraceCrossProcessEndpointId | null) ??
    (readColumnValue<string>(
      blockTable,
      'crossProcessEndpointId',
      rowIndex
    ) as TraceCrossProcessEndpointId | null) ??
    null
  );
}

/**
 * Resolves unresolved cross-rank endpoints from SpanRef-keyed ownership or row-aligned sidecars.
 */
function getTraceGraphCrossProcessEndpoints(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  _processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  spanRef: SpanRef,
  _sidecarSource: TraceGraphSpanSidecarSource
): TraceCrossProcessEndpoint[] {
  const sparseEndpoints = traceGraph.crossProcessEndpointsBySpanRef?.get(spanRef);
  if (sparseEndpoints) {
    return [...sparseEndpoints];
  }

  return normalizeCrossProcessEndpoints(
    readColumnValue<unknown>(blockTable, 'crossProcessDependencyEndpoints', rowIndex)
  );
}

/**
 * Derives the primary timing label from status and duration.
 */
function formatPrimaryDurationLabel(status: TraceSpanTiming['status'], durationMs: number): string {
  if (status === 'not-started') {
    return 'not started';
  }
  if (status === 'not-finished') {
    return 'incomplete';
  }
  return formatTimeMs(durationMs, {roundDigits: 3});
}

/**
 * Normalizes Arrow-backed arrays and vectors into a plain string array.
 */
function normalizeStringArray(value: unknown): string[] {
  return toArray(value).filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Normalizes Arrow-backed endpoint collections into plain endpoint objects.
 */
function normalizeCrossProcessEndpoints(value: unknown): TraceCrossProcessEndpoint[] {
  return toArray(value)
    .map(entry => normalizeCrossProcessEndpoint(entry))
    .filter((entry): entry is TraceCrossProcessEndpoint => Boolean(entry));
}

/**
 * Normalizes one Arrow-backed cross-process endpoint row into a plain object.
 */
function normalizeCrossProcessEndpoint(value: unknown): TraceCrossProcessEndpoint | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const endpoint = value as Record<string, unknown>;
  const endpointId = typeof endpoint.endpointId === 'string' ? endpoint.endpointId : null;
  const spanId = typeof endpoint.spanId === 'string' ? endpoint.spanId : null;
  if (!endpointId || !spanId) {
    return null;
  }

  return {
    type: 'cross-process-dependency-endpoint',
    endpointId: endpointId as TraceCrossProcessEndpoint['endpointId'],
    spanId: spanId as TraceSpanId,
    startRankNum: Number(endpoint.startRankNum ?? 0),
    endRankNum: Number(endpoint.endRankNum ?? 0),
    islandNum: Number(endpoint.islandNum ?? 0),
    waitTimeMs: Number(endpoint.waitTimeMs ?? 0),
    waiting: Boolean(endpoint.waiting),
    waitNotFinished: Boolean(endpoint.waitNotFinished),
    userData:
      (typeof endpoint.userData === 'object' &&
      endpoint.userData !== null &&
      !Array.isArray(endpoint.userData)
        ? (endpoint.userData as Record<string, unknown>)
        : deserializeArrowTraceJson<Record<string, unknown>>(
            typeof endpoint.userDataJson === 'string' ? endpoint.userDataJson : null
          )) ?? undefined
  } satisfies TraceCrossProcessEndpoint;
}

/**
 * Converts Arrow list values, vectors, and iterables into a plain array.
 */
function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  if (typeof value === 'object' && Symbol.iterator in (value as object)) {
    return Array.from(value as Iterable<unknown>);
  }
  if (typeof value === 'object' && 'toArray' in (value as object)) {
    const toArrayFn = (value as {toArray?: () => unknown[]}).toArray;
    return typeof toArrayFn === 'function' ? toArrayFn.call(value) : [];
  }
  return [];
}

/**
 * Resolves a span id or span index into a canonical packed Arrow span index.
 */
function resolveSpanIndex(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  span: TraceSpanId | SpanRef
): SpanRef | null {
  if (typeof span === 'string') {
    return getUniqueTraceGraphSpanRef(traceGraph, span);
  }
  return span as SpanRef;
}

/**
 * Resolves the chunk/store-owned Arrow span row and row-level owners for one span ref.
 */
export function getTraceGraphSpanStoreRow(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef
): TraceGraphSpanStoreRow | null {
  if (!isTraceGraphSpanRefActive(traceGraph, spanRef)) {
    return null;
  }
  return getActiveTraceGraphSpanStoreRow(traceGraph, spanRef);
}

/**
 * Resolves the chunk/store-owned Arrow span row when the caller already owns an active span ref.
 */
export function getActiveTraceGraphSpanStoreRow(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef
): TraceGraphSpanStoreRow | null {
  const spanRow = getActiveTraceGraphSpanTableAddress(traceGraph, spanRef);
  if (!spanRow) {
    return null;
  }
  const processRef = spanRow.processRef;
  const threadRef =
    spanRow.threadRef ??
    getTraceGraphSpanStoreRowThreadRef(
      traceGraph,
      spanRow.chunk,
      spanRow.rowIndex,
      spanRow.processId,
      processRef,
      spanRow.rowThreadRef
    );
  return {
    chunk: spanRow.chunk,
    spanTable: spanRow.spanTable,
    rowIndex: spanRow.rowIndex,
    processRef,
    threadRef,
    processId: spanRow.processId
  };
}

/**
 * Resolves one span ref to a chunk-local Arrow row without resolving row owners.
 */
function getTraceGraphSpanTableAddress(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef,
  validateActive = true
): TraceGraphSpanTableAddress | null {
  if (validateActive && !isTraceGraphSpanRefActive(traceGraph, spanRef)) {
    return null;
  }
  return getActiveTraceGraphSpanTableAddress(traceGraph, spanRef);
}

/**
 * Resolves one active span ref to a chunk-local Arrow row without resolving row owners.
 */
function getActiveTraceGraphSpanTableAddress(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef
): TraceGraphSpanTableAddress | null {
  const chunk = resolveChunkBySpanRef(traceGraph, spanRef);
  const spanRefRowIndex = getSpanRefRowIndex(spanRef);
  const rowIndex = chunk ? getArrowTraceChunkSpanTableRowIndex(chunk, spanRefRowIndex) : null;
  if (!chunk || rowIndex == null) {
    return null;
  }
  const rowProcessRef =
    chunk.processId == null ? readArrowRefColumn(chunk.spanTable, 'process_ref', rowIndex) : null;
  const processId =
    chunk.processId ??
    (rowProcessRef == null
      ? null
      : (traceGraph.processIdsByIndex[getProcessRefIndex(rowProcessRef as ProcessRef)] ?? null));
  const processRef = getTraceGraphSpanStoreRowProcessRef(
    traceGraph,
    chunk,
    processId,
    rowProcessRef
  );
  const rowThreadRef = readArrowRefColumn(chunk.spanTable, 'thread_ref', rowIndex);
  const threadRef = getTraceGraphSpanStoreRowThreadRef(
    traceGraph,
    chunk,
    rowIndex,
    processId,
    processRef,
    rowThreadRef
  );
  return {
    chunk,
    spanTable: chunk.spanTable,
    rowIndex,
    processId,
    rowProcessRef,
    rowThreadRef,
    processRef,
    threadRef
  };
}

function getTraceGraphSpanStoreRowProcessRef(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  chunk: ArrowTraceChunk,
  processId: TraceProcessId | null,
  rowProcessRef: number | null
): ProcessRef | null {
  if (chunk.processId != null) {
    const chunkProcessRef = chunk.processRefs.length === 1 ? chunk.processRefs[0] : null;
    if (chunkProcessRef != null) {
      return chunkProcessRef;
    }
    const processIndex = processId == null ? -1 : traceGraph.processIdsByIndex.indexOf(processId);
    return processIndex >= 0 ? encodeProcessRef(processIndex) : null;
  }
  return rowProcessRef == null ? null : (rowProcessRef as ProcessRef);
}

function getTraceGraphSpanStoreRowThreadRef(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  chunk: ArrowTraceChunk,
  rowIndex: number,
  processId: TraceProcessId | null,
  processRef: ProcessRef | null,
  rowThreadRef: number | null
): ThreadRef | null {
  if (
    rowThreadRef != null &&
    (processRef == null ||
      getThreadRefProcessIndex(rowThreadRef as ThreadRef) === getProcessRefIndex(processRef))
  ) {
    return rowThreadRef as ThreadRef;
  }
  if (chunk.processId != null && processId != null && processRef != null) {
    const threadId = readColumnValue<TraceThreadId>(chunk.spanTable, 'thread_id', rowIndex);
    const process = traceGraph.processes.find(entry => entry.processId === processId);
    const threadIndex = process?.threads.findIndex(thread => thread.threadId === threadId) ?? -1;
    if (threadIndex >= 0) {
      return encodeProcessThreadRef(getProcessRefIndex(processRef), threadIndex);
    }
  }
  return null;
}

function getTraceGraphSpanTableRow(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef,
  validateActive = true
): TraceGraphSpanStoreRow | null {
  return validateActive
    ? getTraceGraphSpanStoreRow(traceGraph, spanRef)
    : getActiveTraceGraphSpanStoreRow(traceGraph, spanRef);
}

type TraceGraphChunkResolver = {
  /** Resolve a chunk-backed ref to its owning Arrow chunk without scanning the chunk list. */
  getChunkByRef?: (ref: SpanRef) => ArrowTraceChunk | null;
  /** Resolve a span ref to its owning Arrow chunk without generic ref-kind dispatch. */
  getSpanChunkByRef?: (ref: SpanRef) => ArrowTraceChunk | null;
};

/**
 * Resolves one span ref to its owning chunk, preferring the runtime `TraceGraph` registry.
 */
function resolveChunkBySpanRef(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  spanRef: SpanRef
): ArrowTraceChunk | null {
  const runtimeChunkResolver = traceGraph as TraceGraphChunkResolver;
  if (typeof runtimeChunkResolver.getSpanChunkByRef === 'function') {
    return runtimeChunkResolver.getSpanChunkByRef.call(traceGraph, spanRef);
  }
  if (typeof runtimeChunkResolver.getChunkByRef === 'function') {
    return runtimeChunkResolver.getChunkByRef.call(traceGraph, spanRef);
  }
  return findArrowTraceChunkByIndex(traceGraph.chunks, getSpanRefChunkIndex(spanRef));
}

/** Finds one numeric span ref in an ascending active-ref list. */
function findSortedSpanRefIndex(spanRefs: readonly SpanRef[], spanRef: SpanRef): number {
  let lowerBound = 0;
  let upperBound = spanRefs.length - 1;
  while (lowerBound <= upperBound) {
    const middleIndex = lowerBound + Math.floor((upperBound - lowerBound) / 2);
    const middleValue = spanRefs[middleIndex];
    if (middleValue === spanRef) {
      return middleIndex;
    }
    if (middleValue == null || middleValue < spanRef) {
      lowerBound = middleIndex + 1;
      continue;
    }
    upperBound = middleIndex - 1;
  }
  return -1;
}

/**
 * Resolves chunk-row sidecars and whether process-keyed sidecars can safely be used as fallback.
 */
function getTraceGraphSpanSidecarSource(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  chunk: ArrowTraceChunk,
  _rowIndex: number
): TraceGraphSpanSidecarSource {
  return {
    table:
      (chunk.processId === processId ? traceGraph.spanSidecarTableMap?.[processId] : null) ??
      chunk.spanSidecarTable ??
      null
  };
}

/** Builds one Arrow-native geometry span source from a process-local row. */
function buildTraceSpanGeometrySource(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  spanRef: SpanRef,
  sidecarSource: TraceGraphSpanSidecarSource,
  ownerRefs?: Readonly<{
    /** Canonical runtime process ref resolved from chunk ownership. */
    processRef: ProcessRef | null;
    /** Canonical runtime thread ref resolved from chunk ownership. */
    threadRef: ThreadRef | null;
  }>,
  timingKey?: string | null
): TraceSpanGeometrySource {
  const timingSource = buildTraceSpanTimingSource(
    traceGraph,
    processId,
    blockTable,
    rowIndex,
    sidecarSource,
    timingKey
  );

  return {
    spanRef,
    ...(ownerRefs?.processRef == null ? {} : {processRef: ownerRefs.processRef}),
    ...(ownerRefs?.threadRef == null ? {} : {threadRef: ownerRefs.threadRef}),
    ...timingSource,
    layoutTopY: readColumnValue<number>(blockTable, 'layout_top_y', rowIndex) ?? undefined,
    layoutHeight: readColumnValue<number>(blockTable, 'layout_height', rowIndex) ?? undefined
  } satisfies TraceSpanGeometrySource;
}

/** Builds the timing-only payload shared by geometry and generated-lane accessors. */
function buildTraceSpanTimingSource(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  sidecarSource: TraceGraphSpanSidecarSource,
  timingKey?: string | null
): Pick<TraceSpanLaneSource, 'primaryTimingKey' | 'timings'> {
  const primaryTimingKey =
    readColumnValue<string>(blockTable, 'primary_timing_key', rowIndex) ?? 'primary';
  const status = readTraceSpanPrimaryTimingStatus(blockTable, rowIndex) ?? 'finished';
  const fallbackTiming = {
    status,
    startTimeMs: readColumnValue<number>(blockTable, 'start_time_ms', rowIndex) ?? 0,
    endTimeMs: readColumnValue<number>(blockTable, 'end_time_ms', rowIndex) ?? 0,
    durationMs: readColumnValue<number>(blockTable, 'duration_ms', rowIndex) ?? 0,
    durationMsAsString: formatPrimaryDurationLabel(
      status,
      readColumnValue<number>(blockTable, 'duration_ms', rowIndex) ?? 0
    )
  } satisfies TraceSpanTiming;
  const timings =
    timingKey === null || timingKey === primaryTimingKey
      ? {[primaryTimingKey]: fallbackTiming}
      : timingKey === undefined
        ? getTraceGraphSpanTimingsWithFallback(
            traceGraph,
            processId,
            blockTable,
            rowIndex,
            primaryTimingKey,
            fallbackTiming,
            sidecarSource
          )
        : getTraceGraphSpanTimingWithFallback(
            traceGraph,
            processId,
            blockTable,
            rowIndex,
            primaryTimingKey,
            fallbackTiming,
            sidecarSource,
            timingKey
          );

  return {
    primaryTimingKey,
    timings
  } satisfies Pick<TraceSpanLaneSource, 'primaryTimingKey' | 'timings'>;
}

/** Builds one narrow generated-layout lane source from a validated Arrow row. */
function buildTraceSpanLayoutLaneSource(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  spanRef: SpanRef,
  sidecarSource: TraceGraphSpanSidecarSource,
  ownerRefs: Readonly<{
    /** Canonical runtime process ref resolved from chunk ownership. */
    processRef: ProcessRef;
    /** Canonical runtime thread ref resolved from chunk ownership. */
    threadRef: ThreadRef;
  }>
): TraceSpanLayoutLaneSource {
  return {
    spanRef,
    processRef: ownerRefs.processRef,
    threadRef: ownerRefs.threadRef,
    ...buildTraceSpanTimingSource(traceGraph, processId, blockTable, rowIndex, sidecarSource),
    traceAffinityKey: readTraceSpanAffinityKey(blockTable, rowIndex)
  } satisfies TraceSpanLayoutLaneSource;
}

/** Builds one Arrow-native lane span source from a process-local row. */
function buildTraceSpanLaneSource(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  spanRef: SpanRef,
  sidecarSource: TraceGraphSpanSidecarSource,
  ownerRefs?: Readonly<{
    /** Canonical runtime process ref resolved from chunk ownership. */
    processRef: ProcessRef | null;
    /** Canonical runtime thread ref resolved from chunk ownership. */
    threadRef: ThreadRef | null;
  }>
): TraceSpanLaneSource | null {
  const spanId = readColumnValue<TraceSpanId>(blockTable, 'span_id', rowIndex);
  const threadId = readColumnValue<TraceThreadId>(blockTable, 'thread_id', rowIndex);
  if (!spanId || !threadId) {
    return null;
  }
  const geometrySource = buildTraceSpanGeometrySource(
    traceGraph,
    processId,
    blockTable,
    rowIndex,
    spanRef,
    sidecarSource
  );
  const processRef =
    ownerRefs?.processRef ?? readArrowRefColumn(blockTable, 'process_ref', rowIndex);
  const threadRef = ownerRefs?.threadRef ?? readArrowRefColumn(blockTable, 'thread_ref', rowIndex);
  if (processRef == null || threadRef == null) {
    return null;
  }

  return {
    ...geometrySource,
    processRef: processRef as ProcessRef,
    threadRef: threadRef as ThreadRef,
    spanId,
    threadId,
    traceAffinityKey: readTraceSpanAffinityKey(blockTable, rowIndex)
  } satisfies TraceSpanLaneSource;
}

/** Reads the conventional declared trace-id attributes used by generated-lane affinity. */
function readTraceSpanAffinityKey(
  blockTable: ArrowTraceSpanTable,
  rowIndex: number
): string | number | bigint | undefined {
  const affinityKey =
    readArrowTableAttributeValue(blockTable, rowIndex, ['traceId']) ??
    readArrowTableAttributeValue(blockTable, rowIndex, ['trace_id']);
  return typeof affinityKey === 'string' ||
    typeof affinityKey === 'number' ||
    typeof affinityKey === 'bigint'
    ? affinityKey
    : undefined;
}

/**
 * Reads one typed value from an Arrow column if the column exists.
 */
function readColumnValue<T>(
  table: ArrowReadableTable | null,
  columnName: string,
  rowIndex: number
): T | null {
  const column = table ? getArrowColumn<T>(table, columnName) : null;
  return column ? ((column.get(rowIndex) as T | null | undefined) ?? null) : null;
}

/** Decodes one canonical primary timing status without reading a Utf8 span column. */
function readTraceSpanPrimaryTimingStatus(
  table: ArrowTraceSpanTable | null,
  rowIndex: number
): TraceSpanTiming['status'] | null {
  return decodeTraceSpanTimingStatusCode(readColumnValue<number>(table, 'status_code', rowIndex));
}

/** Reads one cached Arrow ref column and normalizes numeric/bigint Arrow scalar values. */
function readArrowRefColumn(
  table: ArrowTraceSpanTable | null,
  columnName: string,
  rowIndex: number
): number | null {
  return normalizeArrowRefNumber(readColumnValue<unknown>(table, columnName, rowIndex));
}

/**
 * Reads all schema-declared column values for one Arrow table row.
 */
function getArrowTableRowColumnValues(
  table: ArrowReadableTable | null,
  rowIndex: number,
  tableName: TraceGraphSpanArrowColumnValue['tableName']
): TraceGraphSpanArrowColumnValue[] {
  if (!table || rowIndex < 0 || rowIndex >= table.numRows) {
    return [];
  }

  return table.schema.fields.map(field => ({
    tableName,
    columnName: field.name,
    value: readColumnValue(table, field.name, rowIndex)
  }));
}

/**
 * Resolves the timing-only view consumed by timing-envelope helpers.
 */
function resolveSpanTimingSource(span: TimedEntity): TraceSpanTimingSource {
  return {
    spanId: span.spanId,
    primaryTimingKey: span.primaryTimingKey,
    timings: span.timings
  };
}

function getTraceGraphProcessIndex(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>,
  processId: TraceProcessId
): number | null {
  const processIndex = traceGraph.processIdsByIndex.indexOf(processId);
  return processIndex === -1 ? null : processIndex;
}

function traceGraphProcessRef(processIndex: number): ProcessRef {
  return encodeProcessRef(processIndex);
}

function normalizeArrowRefNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    const numberValue = Number(value);
    return Number.isSafeInteger(numberValue) ? numberValue : null;
  }
  return null;
}

type ColumnVector<Value> = {
  get(index: number): Value | null | undefined;
};

type ArrowReadableTable =
  | ArrowTraceSameProcessDependencyTable
  | ArrowTraceSpanTable
  | ArrowTraceSpanSidecarTable
  | TraceProcessSpanRefTable;

/**
 * Builds the duplicate-aware span id lookup used by id boundaries.
 */
function getUniqueSpanRefBySpanId(
  traceGraph: Readonly<TraceGraphSpanAccessorSource>
): ReadonlyMap<TraceSpanId, SpanRef | null> {
  const spanRefBySpanId = new Map<TraceSpanId, SpanRef | null>();
  for (const spanRef of iterateTraceGraphSpanRefs(traceGraph)) {
    const spanRow = getTraceGraphSpanTableRow(traceGraph, spanRef);
    const spanId =
      spanRow == null
        ? null
        : getArrowColumn<TraceSpanId>(spanRow.spanTable, 'span_id')?.get(spanRow.rowIndex);
    if (typeof spanId !== 'string') {
      continue;
    }
    spanRefBySpanId.set(spanId, spanRefBySpanId.has(spanId) ? null : spanRef);
  }

  return spanRefBySpanId;
}

/**
 * Resolves one Arrow column vector by name without retaining table-local lookup state.
 */
function getArrowColumn<Value>(
  table: ArrowReadableTable,
  columnName: string
): ColumnVector<Value> | null {
  return (
    ((table as unknown as {getChild(name: string): unknown}).getChild(
      columnName
    ) as ColumnVector<Value> | null) ?? null
  );
}
