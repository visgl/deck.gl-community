import {getArrowUtf8RowView} from '@deck.gl-community/infovis-layers';
import {
  findArrowTraceChunkByIndex,
  getArrowTraceChunkSpanRefRowIndex,
  getArrowTraceChunkSpanRowCount,
  getArrowTraceChunkSpanTableRowIndex,
  getArrowTraceChunkSpanTableRowIndexAt
} from './ingestion/arrow-trace';
import {deserializeArrowTraceJson} from './ingestion/arrow-trace-json';
import {
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef,
  getLocalDependencyRefRowIndex,
  getProcessRefIndex,
  getSpanRefChunkIndex,
  getSpanRefRowIndex,
  isLocalDependencyRef
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
  ArrowTraceLocalDependencyTable,
  ArrowTraceProcessMetadata,
  ArrowTraceSpanSidecarTable,
  ArrowTraceSpanTable,
  TraceGraphData,
  TraceProcessSpanRefTable,
  TraceSpanArrowSidecarRow
} from './ingestion/arrow-trace';
import type {
  CounterRef,
  EventRef,
  InstantRef,
  ProcessRef,
  ThreadRef,
  TraceDependencyRef,
  VisibleCrossDependencyRef,
  VisibleLocalDependencyRef
} from './trace-graph/trace-id-encoder';
import type {
  SpanRef,
  TraceCounter,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceEvent,
  TraceInstant,
  TraceLocalDependency,
  TraceProcessId,
  TraceSpan,
  TraceSpanId,
  TraceSpanTiming,
  TraceSpanTimingSource,
  TraceThread,
  TraceThreadId
} from './trace-graph/trace-types';
import type * as arrow from 'apache-arrow';

/** Inclusive timing envelope for a block-like entity after fallback timing normalization. */
export type BlockTimeExtents = {
  /** Earliest resolved start time across the block envelope. */
  startTimeMs: number;
  /** Latest resolved end time across the block envelope. */
  endTimeMs: number;
};

/** Minimal timing-bearing object accepted by trace timing helper functions. */
export type TimedEntity = Pick<TraceSpan, 'spanId' | 'primaryTimingKey' | 'timings'>;

/**
 * Reusable Arrow-backed span row carrier for hot runtime loops.
 */
export type ArrowTraceSpanRow = {
  /** Stable span id. */
  spanId: TraceSpanId;
  /** Owning stream id. */
  threadId: TraceThreadId;
  /** Display name used by search and labels. */
  name: string;
  /** Optional source label used by filters and span inspection surfaces. */
  source: string | null;
  /** Owning rank label. */
  processName: string;
  /** Primary timing key used by the span row. */
  primaryTimingKey: string;
  /** Primary timing status copied from Arrow scalar columns. */
  status: TraceSpanTiming['status'];
  /** Primary timing start copied from Arrow scalar columns. */
  startTimeMs: number;
  /** Primary timing end copied from Arrow scalar columns. */
  endTimeMs: number;
  /** Primary timing duration copied from Arrow scalar columns. */
  durationMs: number;
  /** Preformatted primary duration label copied from Arrow scalar columns. */
  durationMsAsString: string;
  /** Keywords stored on the span when present. */
  keywords: readonly string[];
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
 * Lightweight Arrow-native span payload used for lane assignment.
 */
export type TraceSpanLaneSource = {
  /** Canonical runtime span ref used for selection, highlight, and geometry. */
  spanRef: SpanRef;
  /** Canonical owning process ref used by ref-native runtime layout and grouping when available. */
  processRef?: ProcessRef | undefined;
  /** Canonical owning thread ref used by ref-native runtime layout and grouping when available. */
  threadRef?: ThreadRef | undefined;
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
  /** Optional span user data used by lane and display helpers. */
  userData?: Record<string, unknown>;
};

/**
 * Lightweight Arrow-native span payload used for geometry rebuilds.
 */
export type TraceSpanGeometrySource = TraceSpanLaneSource;

/**
 * Arrow-native span payload used by display-oriented runtime surfaces.
 */
export type TraceSpanDisplaySource = TraceSpanGeometrySource & {
  /** Human-readable process label attached to the span. */
  processName: string;
  /** Span display name. */
  name: string;
  /** Optional source label used by filters and span inspection surfaces. */
  source: string | null;
  /** Optional keyword labels shown in cards, search, and filters. */
  keywords: string[];
  /** Local dependency ids attached to the span. */
  localDependencyIds: TraceLocalDependency['dependencyId'][];
  /** Optional unresolved cross-rank endpoint id. */
  crossProcessEndpointId: TraceCrossProcessEndpointId | null;
  /** Structured unresolved cross-rank endpoints attached to the span. */
  crossProcessDependencyEndpoints: TraceCrossProcessEndpoint[];
};

/**
 * Span-ref keyed payload consumed by deck render layers.
 */
export type TraceRenderSpan = TraceSpanDisplaySource;

/**
 * Row-aligned sidecar payload resolved for one concrete span-table row.
 */
type TraceGraphSpanSidecarSource = {
  /** JS compatibility sidecar row aligned to the concrete chunk span-table row. */
  row: TraceSpanArrowSidecarRow | null;
  /** Arrow sidecar table aligned to the concrete chunk span table. */
  table: ArrowTraceSpanSidecarTable | null;
  /** Whether process-keyed sidecars are row-compatible with this chunk. */
  useProcessFallback: boolean;
};

/** Shared runtime metadata kept on any ref-native visible dependency source. */
export type TraceDependencySourceCommon = {
  /** Canonical owning process ref for the visible dependency when available. */
  processRef?: ProcessRef | undefined;
  /** Stable source dependency identifier. */
  dependencyId: TraceLocalDependency['dependencyId'];
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
  waitMode: TraceLocalDependency['waitMode'];
  /** Whether the dependency should render bidirectional arrows. */
  bidirectional: boolean;
  /** Wait duration kept for coloring and inspection. */
  waitTimeMs: number;
  /** Dependency keywords kept for filtering and tooltips. */
  keywords: ReadonlySet<string>;
  /** Optional dependency user data kept for app-specific tooltips. */
  userData?: Record<string, unknown>;
};

/** Ref-native visible local dependency payload used by runtime layout and rendering surfaces. */
export type TraceLocalDependencySource = TraceDependencySourceCommon & {
  /** Local dependency discriminator kept for runtime branching. */
  type: 'trace-local-dependency';
  /** Canonical runtime dependency ref for geometry and selection when available. */
  dependencyRef?: TraceDependencyRef | VisibleLocalDependencyRef | undefined;
};

/** Ref-native visible cross dependency payload used by runtime layout and rendering surfaces. */
export type TraceCrossDependencySource = TraceDependencySourceCommon & {
  /** Cross dependency discriminator kept for runtime branching. */
  type: 'trace-cross-process-dependency';
  /** Canonical runtime dependency ref for geometry and selection when available. */
  dependencyRef?: TraceDependencyRef | VisibleCrossDependencyRef | undefined;
  /** Endpoint id kept for unresolved-endpoint correlation. */
  endpointId: TraceCrossProcessDependency['endpointId'];
  /** Source rank number kept for cards and navigation. */
  startRankNum: number;
  /** Target rank number kept for cards and navigation. */
  endRankNum: number;
  /** Cross-rank topology label kept for cards and tooltips. */
  topology: string;
  /** Whether the cross dependency is still waiting on the remote endpoint. */
  waiting: boolean;
  /** Whether the cross dependency remains unfinished. */
  waitNotFinished: boolean;
};

/** Union describing any ref-native visible dependency payload returned by TraceGraph runtime APIs. */
export type TraceDependencySource = TraceLocalDependencySource | TraceCrossDependencySource;

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

/** Materializes and yields compatibility `TraceSpan` rows in canonical graph order. */
export function* iterateMaterializedTraceGraphSpans(
  traceGraph: Readonly<TraceGraphData>
): IterableIterator<TraceSpan> {
  for (const process of traceGraph.processes) {
    yield* iterateMaterializedTraceGraphProcessSpans(traceGraph, process.processId);
  }
}

/** Resolves a span ref by legacy block id without materializing a span-location map. */
export function getTraceGraphSpanRef(
  traceGraph: Readonly<TraceGraphData>,
  spanId: TraceSpanId
): SpanRef | null {
  return getUniqueTraceGraphSpanRef(traceGraph, spanId);
}

/** Resolves a span ref by legacy block id only when that id is unique in the graph. */
export function getUniqueTraceGraphSpanRef(
  traceGraph: Readonly<TraceGraphData>,
  spanId: TraceSpanId
): SpanRef | null {
  const spanRefBySpanId = getUniqueSpanRefBySpanId(traceGraph);
  return spanRefBySpanId.has(spanId) ? spanRefBySpanId.get(spanId)! : null;
}

/** Resolves the owning process ref stored on one chunk-local span row. */
export function getTraceGraphSpanRefProcessRef(
  traceGraph: Readonly<TraceGraphData>,
  spanRef: SpanRef
): ProcessRef | null {
  const spanRow = getTraceGraphSpanStoreRow(traceGraph, spanRef);
  return spanRow?.processRef ?? null;
}

/** Resolves the owning thread ref stored on one chunk-local span row. */
export function getTraceGraphSpanRefThreadRef(
  traceGraph: Readonly<TraceGraphData>,
  spanRef: SpanRef
): ThreadRef | null {
  const spanRow = getTraceGraphSpanStoreRow(traceGraph, spanRef);
  return spanRow?.threadRef ?? null;
}

/** Resolves the owning process id for one chunk-local span row. */
export function getTraceGraphSpanRefProcessId(
  traceGraph: Readonly<TraceGraphData>,
  spanRef: SpanRef
): TraceProcessId | null {
  return getTraceGraphSpanStoreRow(traceGraph, spanRef)?.processId ?? null;
}

/** Resolves the compact Arrow span-table row that backs one stable kept span ref. */
export function getTraceGraphSpanTableRowIndex(
  traceGraph: Readonly<TraceGraphData>,
  spanRef: SpanRef
): number | null {
  return getTraceGraphSpanStoreRow(traceGraph, spanRef)?.rowIndex ?? null;
}

/**
 * Fills a reusable UTF-8 byte view for one span display name without decoding it to a string.
 */
export function getTraceGraphSpanNameUtf8(
  traceGraph: Readonly<TraceGraphData>,
  spanRef: SpanRef,
  out: Utf8StringView
): boolean {
  const spanRow = getTraceGraphSpanStoreRow(traceGraph, spanRef);
  const nameColumn = spanRow
    ? (getCachedColumn<string>(spanRow.spanTable, 'name') as unknown as arrow.Vector<arrow.Utf8>)
    : null;
  return spanRow && nameColumn ? getArrowUtf8RowView(nameColumn, spanRow.rowIndex, out) : false;
}

/** Iterates every canonical span ref in graph order without materializing `TraceSpan`s. */
export function* iterateTraceGraphSpanRefs(
  traceGraph: Readonly<TraceGraphData>
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

/** Iterates canonical span refs for one process in process-local row order. */
export function* iterateTraceGraphProcessSpanRefs(
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId | string
): IterableIterator<SpanRef> {
  const typedProcessId = processId as TraceProcessId;
  const spanRefTable = traceGraph.processSpanTableMap[typedProcessId];
  const spanRefColumn = spanRefTable ? getCachedColumn<unknown>(spanRefTable, 'span_ref') : null;
  if (spanRefTable && spanRefColumn) {
    for (let rowIndex = 0; rowIndex < spanRefTable.numRows; rowIndex += 1) {
      const spanRef = normalizeArrowRefNumber(spanRefColumn.get(rowIndex));
      if (spanRef != null) {
        yield spanRef as SpanRef;
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
    for (const spanRef of traceGraph.spanRefs) {
      const spanRow = getTraceGraphSpanTableRow(traceGraph, spanRef);
      if (spanRow?.processRef === processRef) {
        yield spanRef;
      }
    }
    return;
  }

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
        yield encodeSpanRef(chunk.chunkIndex, spanRefRowIndex);
      }
    }
  }
}

/**
 * Resolves the process-local `processSpanTableMap` row ordinal for a source span ref.
 *
 * `TraceProcessSpanRefTable.span_ref` is built in ascending `SpanRef` order and row-aligns all
 * process-local columns, including `filter_mask`, with that sorted span-ref column. This accessor
 * relies on that invariant to binary-search the process table instead of scanning all process
 * rows for every arbitrary chunk-local `SpanRef` lookup.
 */
export function getTraceGraphProcessSpanOrdinal(
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId | string,
  spanRef: SpanRef
): number | null {
  const spanRefTable = traceGraph.processSpanTableMap[processId as TraceProcessId];
  const spanRefColumn = spanRefTable ? getCachedColumn<unknown>(spanRefTable, 'span_ref') : null;
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
 * Resolves one reusable Arrow-backed span row without materializing a full `TraceSpan`.
 */
export function getArrowTraceSpanRow(
  traceGraph: Readonly<TraceGraphData>,
  span: TraceSpanId | SpanRef,
  reusableRow?: ArrowTraceSpanRow
): ArrowTraceSpanRow | null {
  const spanIndex = resolveSpanIndex(traceGraph, span);
  if (spanIndex == null) {
    return null;
  }

  const spanRow = getTraceGraphSpanTableRow(traceGraph, spanIndex);
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

  const spanId = readColumnValue<TraceSpanId>(blockTable, 'span_id', rowIndex);
  const threadId = readColumnValue<TraceThreadId>(blockTable, 'thread_id', rowIndex);
  const name = readColumnValue<string>(blockTable, 'name', rowIndex);
  const source = readColumnValue<string>(blockTable, 'source', rowIndex) ?? null;
  const processName = getTraceGraphProcessName(traceGraph, processId);
  if (!spanId || !threadId || !name || !processName) {
    return null;
  }

  const row = reusableRow ?? {
    spanId,
    threadId,
    name,
    source,
    processName,
    primaryTimingKey: 'primary',
    status: 'finished',
    startTimeMs: 0,
    endTimeMs: 0,
    durationMs: 0,
    durationMsAsString: '0ms',
    keywords: []
  };
  row.spanId = spanId;
  row.threadId = threadId;
  row.name = name;
  row.source = source;
  row.processName = processName;
  row.primaryTimingKey =
    readColumnValue<string>(blockTable, 'primary_timing_key', rowIndex) ?? 'primary';
  row.status = (readColumnValue<TraceSpanTiming['status']>(blockTable, 'status', rowIndex) ??
    'finished') as TraceSpanTiming['status'];
  row.startTimeMs = readColumnValue<number>(blockTable, 'start_time_ms', rowIndex) ?? 0;
  row.endTimeMs = readColumnValue<number>(blockTable, 'end_time_ms', rowIndex) ?? 0;
  row.durationMs = readColumnValue<number>(blockTable, 'duration_ms', rowIndex) ?? 0;
  row.durationMsAsString = formatPrimaryDurationLabel(row.status, row.durationMs);
  row.keywords = getTraceGraphSpanKeywords(
    traceGraph,
    processId,
    blockTable,
    rowIndex,
    sidecarSource
  );
  return row;
}

/**
 * Reads one cheap Arrow span field without materializing a full `TraceSpan`.
 */
export function getArrowTraceSpanField(
  traceGraph: Readonly<TraceGraphData>,
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
      (readColumnValue<TraceSpanTiming['status']>(blockTable, 'status', rowIndex) ??
        'finished') as TraceSpanTiming['status'],
      readColumnValue<number>(blockTable, 'duration_ms', rowIndex) ?? 0
    );
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
    return getTraceGraphProcessName(traceGraph, processId);
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
  traceGraph: Readonly<TraceGraphData>,
  span: TraceSpanId | SpanRef
): TraceSpanLaneSource | null {
  const spanIndex = resolveSpanIndex(traceGraph, span);
  if (spanIndex == null) {
    return null;
  }

  return getTraceGraphSpanLaneSourceByRef(traceGraph, spanIndex, true);
}

/**
 * Resolves one Arrow-native span source when the caller already owns an active span ref.
 */
export function getActiveTraceGraphSpanGeometrySource(
  traceGraph: Readonly<TraceGraphData>,
  spanRef: SpanRef
): TraceSpanGeometrySource | null {
  return getTraceGraphSpanLaneSourceByRef(traceGraph, spanRef, false);
}

function getTraceGraphSpanLaneSourceByRef(
  traceGraph: Readonly<TraceGraphData>,
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

/**
 * Resolves one Arrow-native span source used by geometry rebuilds.
 */
export function getTraceGraphSpanGeometrySource(
  traceGraph: Readonly<TraceGraphData>,
  span: TraceSpanId | SpanRef
): TraceSpanGeometrySource | null {
  return getTraceGraphSpanLaneSource(traceGraph, span);
}

/**
 * Resolves one span user-data payload using chunk-aware Arrow sidecar lookup.
 */
export function getTraceGraphSpanUserData(
  traceGraph: Readonly<TraceGraphData>,
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

/**
 * Resolves the external source id stored on one span row, when present.
 */
export function getTraceGraphSpanExternalSpanId(
  traceGraph: Readonly<TraceGraphData>,
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
 * Resolves one Arrow-native span source used by cards, search, and tooltips.
 */
export function getTraceGraphSpanDisplaySource(
  traceGraph: Readonly<TraceGraphData>,
  span: TraceSpanId | SpanRef
): TraceSpanDisplaySource | null {
  const spanIndex = resolveSpanIndex(traceGraph, span);
  if (spanIndex == null) {
    return null;
  }

  return getTraceGraphSpanDisplaySourceByRef(traceGraph, spanIndex, true);
}

/**
 * Resolves one Arrow-native display source when the caller already owns an active span ref.
 */
export function getActiveTraceGraphSpanDisplaySource(
  traceGraph: Readonly<TraceGraphData>,
  spanRef: SpanRef
): TraceSpanDisplaySource | null {
  return getTraceGraphSpanDisplaySourceByRef(traceGraph, spanRef, false);
}

function getTraceGraphSpanDisplaySourceByRef(
  traceGraph: Readonly<TraceGraphData>,
  spanIndex: SpanRef,
  validateActive: boolean
): TraceSpanDisplaySource | null {
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

  return {
    ...laneSource,
    processName,
    name,
    source: readColumnValue<string>(blockTable, 'source', rowIndex) ?? null,
    keywords: getTraceGraphSpanKeywords(traceGraph, processId, blockTable, rowIndex, sidecarSource),
    localDependencyIds: getTraceGraphLocalDependencyIds(
      traceGraph,
      processId,
      blockTable,
      rowIndex,
      sidecarSource
    ),
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
  } satisfies TraceSpanDisplaySource;
}

/**
 * Reads all row-aligned Arrow span-table values for one selected span.
 *
 * The canonical span table is always included when the span ref is valid. The optional span sidecar
 * table is included when present for the same storage chunk.
 */
export function getTraceGraphSpanArrowColumnValues(
  traceGraph: Readonly<TraceGraphData>,
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

let traceGraphSpanMaterializationCount = 0;

/**
 * Returns the number of Arrow-to-TraceSpan compatibility materializations performed so far.
 */
export function getArrowTraceSpanMaterializationCount(): number {
  return traceGraphSpanMaterializationCount;
}

/**
 * Resets the Arrow-to-TraceSpan compatibility materialization counter.
 */
export function resetArrowTraceSpanMaterializationCount(): void {
  traceGraphSpanMaterializationCount = 0;
}

/** Materializes and yields compatibility `TraceSpan` rows for one process in row order. */
export function* iterateMaterializedTraceGraphProcessSpans(
  traceGraph: Readonly<TraceGraphData>,
  processId: string
): IterableIterator<TraceSpan> {
  for (const spanRef of iterateTraceGraphProcessSpanRefs(traceGraph, processId)) {
    const block = materializeTraceGraphSpanByRef(traceGraph, spanRef);
    if (block) {
      yield block;
    }
  }
}

/** Materializes one compatibility `TraceSpan` by legacy block id from Arrow-backed graph tables. */
export function materializeTraceGraphSpan(
  traceGraph: Readonly<TraceGraphData>,
  spanId: TraceSpanId
): TraceSpan | null {
  const spanIndex = getUniqueTraceGraphSpanRef(traceGraph, spanId);
  if (spanIndex == null) {
    return null;
  }
  return materializeTraceGraphSpanByRef(traceGraph, spanIndex);
}

/** Materializes one compatibility `TraceSpan` by canonical span ref. */
export function materializeTraceGraphSpanByRef(
  traceGraph: Readonly<TraceGraphData>,
  spanRef: SpanRef
): TraceSpan | null {
  const spanRow = getTraceGraphSpanTableRow(traceGraph, spanRef);
  if (!spanRow) {
    return null;
  }
  if (!spanRow.processId) {
    return null;
  }
  return materializeArrowBlock(
    traceGraph as TraceGraphData,
    spanRow.processId,
    spanRow.spanTable,
    spanRow.rowIndex,
    spanRef,
    getTraceGraphSpanSidecarSource(traceGraph, spanRow.processId, spanRow.chunk, spanRow.rowIndex)
  );
}

/** Returns the total number of spans in a graph without materializing `TraceSpan` objects. */
export function getTraceGraphSpanCount(traceGraph: Readonly<TraceGraphData>): number {
  if (traceGraph.spanRefs) {
    return traceGraph.spanRefs.length;
  }
  return traceGraph.chunks.reduce(
    (total, chunk) => total + getArrowTraceChunkSpanRowCount(chunk),
    0
  );
}

/** Returns the number of spans owned by one process without materializing `TraceSpan` objects. */
export function getTraceGraphProcessSpanCount(
  traceGraph: Readonly<TraceGraphData>,
  processId: string
): number {
  let spanCount = 0;
  for (const spanRef of iterateTraceGraphProcessSpanRefs(traceGraph, processId)) {
    void spanRef;
    spanCount += 1;
  }
  return spanCount;
}

/**
 * Resolves one process by id from Arrow-backed graph tables.
 */
export function getTraceGraphProcessById(
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId | string
): ArrowTraceProcessMetadata | null {
  return traceGraph.processes.find(process => process.processId === processId) ?? null;
}

/**
 * Resolves one thread by stream id from Arrow-backed graph tables.
 */
export function getTraceGraphThreadById(
  traceGraph: Readonly<TraceGraphData>,
  threadId: TraceThreadId
): TraceThread | null {
  return traceGraph.threadMap[threadId] ?? null;
}

/**
 * Returns the full timing envelope for a span across all available timing projections.
 */
export function getSpanExtremalTiming(
  block: TimedEntity,
  maxTimeMs = NOT_FINISHED_BLOCK_END_TIME_DEFAULT
): BlockTimeExtents {
  let startTimeMs = Number.POSITIVE_INFINITY;
  let endTimeMs = Number.NEGATIVE_INFINITY;

  for (const timingKey in block.timings) {
    const timing = block.timings[timingKey];
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
    const primaryTiming = getPrimaryTiming(resolveBlockTimingSource(block));
    if (!Number.isFinite(primaryTiming.startTimeMs)) {
      return {startTimeMs: 0, endTimeMs: 0};
    }
    return {
      startTimeMs: primaryTiming.startTimeMs,
      endTimeMs: resolveSpanTimingEndTime(primaryTiming, maxTimeMs)
    };
  }

  if (endTimeMs < startTimeMs) {
    const primaryTiming = getPrimaryTiming(resolveBlockTimingSource(block));
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
  block: TimedEntity,
  maxTimeMs = NOT_FINISHED_BLOCK_END_TIME_DEFAULT
): BlockTimeExtents | null {
  let startTimeMs = Number.POSITIVE_INFINITY;
  let endTimeMs = Number.NEGATIVE_INFINITY;

  for (const timingKey in block.timings) {
    const timing = block.timings[timingKey];
    if (!timing || !isTraceSpanTimingEligibleForTimeExtents(timing)) {
      continue;
    }

    const resolvedEndTimeMs = resolveSpanTimingEndTime(timing, maxTimeMs);
    startTimeMs = Math.min(startTimeMs, timing.startTimeMs);
    endTimeMs = Math.max(endTimeMs, resolvedEndTimeMs);
  }

  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs) || endTimeMs < startTimeMs) {
    const primaryTiming = getPrimaryTiming(resolveBlockTimingSource(block));
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
  let endTimeMs = timing.endTimeMs;
  if (!Number.isFinite(endTimeMs) || endTimeMs <= timing.startTimeMs) {
    if (timing.status === 'not-finished') {
      const unfinishedEnd = Number.isFinite(maxTimeMs)
        ? Math.max(maxTimeMs, timing.startTimeMs)
        : NOT_FINISHED_BLOCK_END_TIME_DEFAULT;
      endTimeMs = Math.max(unfinishedEnd, timing.startTimeMs + 1);
    } else if (timing.status === 'not-started') {
      endTimeMs = timing.startTimeMs + NOT_STARTED_BLOCK_DURATION_MS;
    } else {
      endTimeMs = timing.startTimeMs;
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
export function getSpanFiniteTimingEnvelope(block: TimedEntity): BlockTimeExtents {
  let startTimeMs = Number.POSITIVE_INFINITY;
  let endTimeMs = Number.NEGATIVE_INFINITY;

  for (const timing of Object.values(block.timings)) {
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
    const primary = getPrimaryTiming(resolveBlockTimingSource(block));
    const primaryPoints = [primary.startTimeMs, primary.endTimeMs].filter(Number.isFinite);
    if (primaryPoints.length === 0) {
      return {startTimeMs: 0, endTimeMs: 0};
    }

    return {
      startTimeMs: Math.min(...primaryPoints),
      endTimeMs: Math.max(...primaryPoints)
    };
  }

  return {startTimeMs, endTimeMs};
}

/**
 * Returns the finite timing envelope used by graph-wide time-axis bounds.
 */
export function getSpanFiniteTimingEnvelopeForTimeExtents(
  block: TimedEntity
): BlockTimeExtents | null {
  let startTimeMs = Number.POSITIVE_INFINITY;
  let endTimeMs = Number.NEGATIVE_INFINITY;

  for (const timing of Object.values(block.timings)) {
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
    const primary = getPrimaryTiming(resolveBlockTimingSource(block));
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
export function sortBlocksByTime<BlockT extends TimedEntity & {spanId: TraceSpanId}>(
  spans: readonly BlockT[],
  options: {maxTimeMs?: number} = {}
): BlockT[] {
  return [...spans].sort((a, b) => {
    const aTiming = getSpanExtremalTiming(a, options.maxTimeMs);
    const bTiming = getSpanExtremalTiming(b, options.maxTimeMs);
    if (aTiming.startTimeMs !== bTiming.startTimeMs) {
      return aTiming.startTimeMs - bTiming.startTimeMs;
    }
    return bTiming.endTimeMs - aTiming.endTimeMs;
  });
}

/**
 * Reconstructs a plain block object from a process-local Arrow table row.
 */
function materializeArrowBlock(
  traceGraph: TraceGraphData,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  spanRef: SpanRef,
  sidecarSource: TraceGraphSpanSidecarSource
): TraceSpan | null {
  traceGraphSpanMaterializationCount += 1;
  const spanId = readColumnValue<TraceSpanId>(blockTable, 'span_id', rowIndex);
  const threadId = readColumnValue<TraceThreadId>(blockTable, 'thread_id', rowIndex);
  const name = readColumnValue<string>(blockTable, 'name', rowIndex);
  const processName = getTraceGraphProcessName(traceGraph, processId);
  const primaryTimingKey =
    readColumnValue<string>(blockTable, 'primary_timing_key', rowIndex) ?? 'primary';
  if (!spanId || !threadId || !name || !processName) {
    return null;
  }
  const fallbackTiming = {
    status: (readColumnValue<TraceSpanTiming['status']>(blockTable, 'status', rowIndex) ??
      'finished') as TraceSpanTiming['status'],
    startTimeMs: readColumnValue<number>(blockTable, 'start_time_ms', rowIndex) ?? 0,
    endTimeMs: readColumnValue<number>(blockTable, 'end_time_ms', rowIndex) ?? 0,
    durationMs: readColumnValue<number>(blockTable, 'duration_ms', rowIndex) ?? 0,
    durationMsAsString: formatPrimaryDurationLabel(
      (readColumnValue<TraceSpanTiming['status']>(blockTable, 'status', rowIndex) ??
        'finished') as TraceSpanTiming['status'],
      readColumnValue<number>(blockTable, 'duration_ms', rowIndex) ?? 0
    )
  } satisfies TraceSpanTiming;
  const timings = getTraceGraphSpanTimingsWithFallback(
    traceGraph,
    processId,
    blockTable,
    rowIndex,
    primaryTimingKey,
    fallbackTiming,
    sidecarSource
  );
  const localDependencyIds = spanId
    ? getTraceGraphLocalDependencyIds(traceGraph, processId, blockTable, rowIndex, sidecarSource)
    : [];

  return {
    type: 'trace-span',
    spanRef,
    spanId,
    threadId,
    processName,
    name,
    keywords: getTraceGraphSpanKeywords(traceGraph, processId, blockTable, rowIndex, sidecarSource),
    primaryTimingKey,
    timings,
    localDependencyIds,
    localDependencies: localDependencyIds.flatMap(dependencyId => {
      const dependency = traceGraph.dependencyMap[dependencyId];
      return dependency?.type === 'trace-local-dependency' ? [dependency] : [];
    }),
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
      spanRef,
      sidecarSource
    ),
    userData: readTraceGraphSpanUserData(
      traceGraph,
      processId,
      blockTable,
      rowIndex,
      sidecarSource
    ),
    layoutTopY: readColumnValue<number>(blockTable, 'layout_top_y', rowIndex) ?? undefined,
    layoutHeight: readColumnValue<number>(blockTable, 'layout_height', rowIndex) ?? undefined
  } satisfies TraceSpan;
}

const processNameCache = new WeakMap<
  Readonly<TraceGraphData>,
  ReadonlyMap<TraceProcessId, string>
>();

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
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId
): string | null {
  let nameMap = processNameCache.get(traceGraph);
  if (!nameMap) {
    nameMap = new Map(
      traceGraph.processes.map(
        process => [process.processId as TraceProcessId, process.name] as const
      )
    );
    processNameCache.set(traceGraph, nameMap);
  }
  return nameMap.get(processId) ?? null;
}

/**
 * Resolves one row-aligned sidecar payload when available.
 */
function getTraceGraphSpanSidecarRow(
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId,
  rowIndex: number,
  sidecarSource: TraceGraphSpanSidecarSource
): TraceSpanArrowSidecarRow | null {
  return (
    sidecarSource.row ??
    (sidecarSource.useProcessFallback
      ? traceGraph.spanSidecarMap?.[processId]?.[rowIndex]
      : null) ??
    null
  );
}

/**
 * Resolves one Arrow-backed row-aligned span sidecar field when available.
 */
function getTraceGraphSpanSidecarTableValue<Value>(
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId,
  rowIndex: number,
  fieldName: string,
  sidecarSource: TraceGraphSpanSidecarSource
): Value | null {
  const table =
    sidecarSource.table ??
    (sidecarSource.useProcessFallback ? traceGraph.spanSidecarTableMap?.[processId] : null);
  return table ? (readColumnValue<Value>(table, fieldName, rowIndex) ?? null) : null;
}

/**
 * Resolves one span timing map from the sidecar or legacy Arrow payload.
 */
function getTraceGraphSpanTimings(
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  sidecarSource: TraceGraphSpanSidecarSource
): Record<string, TraceSpanTiming> | null {
  return (
    getTraceGraphSpanSidecarRow(traceGraph, processId, rowIndex, sidecarSource)?.timings ??
    deserializeArrowTraceJson<Record<string, TraceSpanTiming>>(
      readColumnValue<string>(blockTable, 'timingsJson', rowIndex)
    ) ??
    null
  );
}

/**
 * Resolves span timings with a primary fallback without mutating shared sidecar timing maps.
 */
function getTraceGraphSpanTimingsWithFallback(
  traceGraph: Readonly<TraceGraphData>,
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
  if (!timings) {
    return {[primaryTimingKey]: fallbackTiming};
  }
  if (timings[primaryTimingKey]) {
    return timings;
  }
  return {
    ...timings,
    [primaryTimingKey]: fallbackTiming
  };
}

/**
 * Resolves one span user-data payload from the sidecar or legacy Arrow payload.
 */
function readTraceGraphSpanUserData(
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
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
    ) ??
    getTraceGraphSpanSidecarRow(traceGraph, processId, rowIndex, sidecarSource)?.userData ??
    deserializeArrowTraceJson<Record<string, unknown>>(
      readColumnValue<string>(blockTable, 'userDataJson', rowIndex)
    ) ??
    undefined
  );
}

/**
 * Resolves span keywords from the sidecar or legacy Arrow payload.
 */
function getTraceGraphSpanKeywords(
  traceGraph: Readonly<TraceGraphData>,
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

  return (
    getTraceGraphSpanSidecarRow(traceGraph, processId, rowIndex, sidecarSource)?.keywords ??
    normalizeStringArray(readColumnValue<unknown>(blockTable, 'keywords', rowIndex))
  );
}

/**
 * Resolves span local dependency ids from the sidecar or legacy Arrow payload.
 */
function getTraceGraphLocalDependencyIds(
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  sidecarSource: TraceGraphSpanSidecarSource
): TraceLocalDependency['dependencyId'][] {
  const sidecarTableLocalDependencyRefs = getTraceGraphSpanSidecarLocalDependencyRefs(
    traceGraph,
    processId,
    rowIndex,
    sidecarSource
  );
  if (sidecarTableLocalDependencyRefs != null) {
    return getTraceGraphLocalDependencyIdsByRefs(
      traceGraph,
      processId,
      sidecarTableLocalDependencyRefs
    );
  }

  const sidecarRow = getTraceGraphSpanSidecarRow(traceGraph, processId, rowIndex, sidecarSource);
  const localDependencyIds = sidecarRow?.localDependencyIds;
  if (localDependencyIds?.length) {
    return localDependencyIds as TraceLocalDependency['dependencyId'][];
  }

  const dependencyRowIndexes = [
    ...(sidecarRow?.incomingLocalDependencyRefs ?? []),
    ...(sidecarRow?.outgoingLocalDependencyRefs ?? []),
    ...(sidecarRow?.incomingLocalDependencyRowIndexes ?? []),
    ...(sidecarRow?.outgoingLocalDependencyRowIndexes ?? [])
  ];
  const localDependencyIdsByRefs = getTraceGraphLocalDependencyIdsByRefs(
    traceGraph,
    processId,
    dependencyRowIndexes
  );
  if (localDependencyIdsByRefs.length > 0) {
    return localDependencyIdsByRefs;
  }

  return normalizeStringArray(
    readColumnValue<unknown>(blockTable, 'localDependencyIds', rowIndex)
  ).map(dependencyId => dependencyId as TraceLocalDependency['dependencyId']);
}

/**
 * Resolves compact local dependency refs from the row-aligned Arrow span sidecar table.
 */
function getTraceGraphSpanSidecarLocalDependencyRefs(
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId,
  rowIndex: number,
  sidecarSource: TraceGraphSpanSidecarSource
): number[] | null {
  const table =
    sidecarSource.table ??
    (sidecarSource.useProcessFallback ? traceGraph.spanSidecarTableMap?.[processId] : null);
  if (!table) {
    return null;
  }

  const combinedRefs = readColumnValue<unknown>(table, 'localDependencyRefs', rowIndex);
  const normalizedCombinedRefs = normalizeNumberArray(combinedRefs);
  if (normalizedCombinedRefs.length > 0) {
    return normalizedCombinedRefs;
  }

  return [
    ...normalizeNumberArray(
      readColumnValue<unknown>(table, 'incomingLocalDependencyRefs', rowIndex)
    ),
    ...normalizeNumberArray(
      readColumnValue<unknown>(table, 'outgoingLocalDependencyRefs', rowIndex)
    )
  ];
}

/**
 * Resolves local dependency ids from compact tagged local dependency refs.
 */
function getTraceGraphLocalDependencyIdsByRefs(
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId,
  dependencyRefs: readonly number[]
): TraceLocalDependency['dependencyId'][] {
  const localDependencyTable = traceGraph.localDependencyTableMap[
    processId
  ] as ArrowTraceLocalDependencyTable | null;
  if (!localDependencyTable || dependencyRefs.length === 0) {
    return [];
  }

  const dependencyCount = localDependencyTable.numRows;
  const dependencyIdColumn = getCachedColumn<TraceLocalDependency['dependencyId']>(
    localDependencyTable,
    'dependencyId'
  );
  if (!dependencyIdColumn) {
    return [];
  }

  const dependencyIds: TraceLocalDependency['dependencyId'][] = [];
  const seenIndexes = new Set<number>();
  for (const dependencyRef of dependencyRefs) {
    const dependencyRowIndex = isLocalDependencyRef(dependencyRef)
      ? getLocalDependencyRefRowIndex(dependencyRef)
      : dependencyRef;
    if (!Number.isSafeInteger(dependencyRowIndex) || dependencyRowIndex < 0) {
      continue;
    }
    if (dependencyRowIndex >= dependencyCount) {
      continue;
    }
    if (seenIndexes.has(dependencyRowIndex)) {
      continue;
    }
    seenIndexes.add(dependencyRowIndex);
    const dependencyId = dependencyIdColumn.get(dependencyRowIndex);
    if (typeof dependencyId === 'string') {
      dependencyIds.push(dependencyId as TraceLocalDependency['dependencyId']);
    }
  }

  return dependencyIds;
}

/**
 * Resolves one unresolved cross-rank endpoint id from the sidecar or legacy Arrow payload.
 */
function getTraceGraphCrossProcessEndpointId(
  traceGraph: Readonly<TraceGraphData>,
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
    getTraceGraphSpanSidecarRow(traceGraph, processId, rowIndex, sidecarSource)
      ?.crossProcessEndpointId ??
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
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId,
  blockTable: ArrowTraceSpanTable,
  rowIndex: number,
  spanRef: SpanRef,
  sidecarSource: TraceGraphSpanSidecarSource
): TraceCrossProcessEndpoint[] {
  const sparseEndpoints = traceGraph.crossProcessEndpointsBySpanRef?.get(spanRef);
  if (sparseEndpoints) {
    return [...sparseEndpoints];
  }

  const sidecarEndpoints = getTraceGraphSpanSidecarRow(
    traceGraph,
    processId,
    rowIndex,
    sidecarSource
  )?.crossProcessDependencyEndpoints;
  if (sidecarEndpoints) {
    return sidecarEndpoints.map(endpoint => ({
      type: 'cross-process-dependency-endpoint',
      endpointId: endpoint.endpointId,
      spanId: endpoint.spanId,
      startRankNum: endpoint.startRankNum,
      endRankNum: endpoint.endRankNum,
      islandNum: endpoint.islandNum,
      waitTimeMs: endpoint.waitTimeMs,
      waiting: endpoint.waiting,
      waitNotFinished: endpoint.waitNotFinished,
      userData: endpoint.userData
    }));
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
 * Normalizes Arrow-backed numeric arrays into plain JS numbers.
 */
function normalizeNumberArray(value: unknown): number[] {
  return toArray(value)
    .map(entry => (typeof entry === 'bigint' ? Number(entry) : entry))
    .filter((entry): entry is number => typeof entry === 'number' && Number.isSafeInteger(entry));
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
  traceGraph: Readonly<TraceGraphData>,
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
  traceGraph: Readonly<TraceGraphData>,
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
  traceGraph: Readonly<TraceGraphData>,
  spanRef: SpanRef
): TraceGraphSpanStoreRow | null {
  const chunk = resolveChunkBySpanRef(traceGraph, spanRef);
  const spanRefRowIndex = getSpanRefRowIndex(spanRef);
  const rowIndex = chunk ? getArrowTraceChunkSpanTableRowIndex(chunk, spanRefRowIndex) : null;
  if (!chunk || rowIndex == null) {
    return null;
  }
  const rowProcessRef = readArrowRefColumn(chunk.spanTable, 'process_ref', rowIndex);
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
  const threadRef = getTraceGraphSpanStoreRowThreadRef(
    traceGraph,
    chunk,
    rowIndex,
    processId,
    processRef,
    readArrowRefColumn(chunk.spanTable, 'thread_ref', rowIndex)
  );
  return {
    chunk,
    spanTable: chunk.spanTable,
    rowIndex,
    processRef,
    threadRef,
    processId
  };
}

function getTraceGraphSpanStoreRowProcessRef(
  traceGraph: Readonly<TraceGraphData>,
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
  traceGraph: Readonly<TraceGraphData>,
  chunk: ArrowTraceChunk,
  rowIndex: number,
  processId: TraceProcessId | null,
  processRef: ProcessRef | null,
  rowThreadRef: number | null
): ThreadRef | null {
  if (chunk.processId != null && processId != null && processRef != null) {
    const threadId = readColumnValue<TraceThreadId>(chunk.spanTable, 'thread_id', rowIndex);
    const process = traceGraph.processes.find(entry => entry.processId === processId);
    const threadIndex = process?.threads.findIndex(thread => thread.threadId === threadId) ?? -1;
    if (threadIndex >= 0) {
      return encodeProcessThreadRef(getProcessRefIndex(processRef), threadIndex);
    }
  }
  return rowThreadRef == null ? null : (rowThreadRef as ThreadRef);
}

function getTraceGraphSpanTableRow(
  traceGraph: Readonly<TraceGraphData>,
  spanRef: SpanRef,
  validateActive = true
): TraceGraphSpanStoreRow | null {
  return validateActive
    ? getTraceGraphSpanStoreRow(traceGraph, spanRef)
    : getActiveTraceGraphSpanStoreRow(traceGraph, spanRef);
}

type TraceGraphChunkResolver = {
  /** Resolve a span ref to its owning Arrow chunk without scanning the chunk list. */
  getChunkByRef?: (ref: SpanRef) => ArrowTraceChunk | null;
};

/**
 * Resolves one span ref to its owning chunk, preferring the runtime `TraceGraph` registry.
 */
function resolveChunkBySpanRef(
  traceGraph: Readonly<TraceGraphData>,
  spanRef: SpanRef
): ArrowTraceChunk | null {
  const runtimeChunkResolver = traceGraph as TraceGraphChunkResolver;
  if (typeof runtimeChunkResolver.getChunkByRef === 'function') {
    return runtimeChunkResolver.getChunkByRef.call(traceGraph, spanRef);
  }
  return findArrowTraceChunkByIndex(traceGraph.chunks, getSpanRefChunkIndex(spanRef));
}

/** Returns whether one span ref belongs to the active graph selection. */
function isTraceGraphSpanRefActive(
  traceGraph: Readonly<TraceGraphData>,
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
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId,
  chunk: ArrowTraceChunk,
  rowIndex: number
): TraceGraphSpanSidecarSource {
  const useProcessFallback = chunk.processId === processId;
  return {
    row:
      chunk.spanSidecarRows?.[rowIndex] ??
      (useProcessFallback ? traceGraph.spanSidecarMap?.[processId]?.[rowIndex] : null) ??
      null,
    table:
      chunk.spanSidecarTable ??
      (useProcessFallback ? traceGraph.spanSidecarTableMap?.[processId] : null) ??
      null,
    useProcessFallback
  };
}

/**
 * Builds one Arrow-native lane/geometry span source from a process-local row.
 */
function buildTraceSpanLaneSource(
  traceGraph: Readonly<TraceGraphData>,
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
  const primaryTimingKey =
    readColumnValue<string>(blockTable, 'primary_timing_key', rowIndex) ?? 'primary';
  if (!spanId || !threadId) {
    return null;
  }
  const fallbackTiming = {
    status: (readColumnValue<TraceSpanTiming['status']>(blockTable, 'status', rowIndex) ??
      'finished') as TraceSpanTiming['status'],
    startTimeMs: readColumnValue<number>(blockTable, 'start_time_ms', rowIndex) ?? 0,
    endTimeMs: readColumnValue<number>(blockTable, 'end_time_ms', rowIndex) ?? 0,
    durationMs: readColumnValue<number>(blockTable, 'duration_ms', rowIndex) ?? 0,
    durationMsAsString: formatPrimaryDurationLabel(
      (readColumnValue<TraceSpanTiming['status']>(blockTable, 'status', rowIndex) ??
        'finished') as TraceSpanTiming['status'],
      readColumnValue<number>(blockTable, 'duration_ms', rowIndex) ?? 0
    )
  } satisfies TraceSpanTiming;
  const timings = getTraceGraphSpanTimingsWithFallback(
    traceGraph,
    processId,
    blockTable,
    rowIndex,
    primaryTimingKey,
    fallbackTiming,
    sidecarSource
  );
  const processRef =
    ownerRefs?.processRef ?? readArrowRefColumn(blockTable, 'process_ref', rowIndex);
  const threadRef = ownerRefs?.threadRef ?? readArrowRefColumn(blockTable, 'thread_ref', rowIndex);

  return {
    spanRef,
    processRef: processRef == null ? undefined : (processRef as ProcessRef),
    threadRef: threadRef == null ? undefined : (threadRef as ThreadRef),
    spanId,
    threadId,
    primaryTimingKey,
    timings,
    layoutTopY: readColumnValue<number>(blockTable, 'layout_top_y', rowIndex) ?? undefined,
    layoutHeight: readColumnValue<number>(blockTable, 'layout_height', rowIndex) ?? undefined,
    userData: readTraceGraphSpanUserData(traceGraph, processId, blockTable, rowIndex, sidecarSource)
  } satisfies TraceSpanLaneSource;
}

/**
 * Reads one typed value from an Arrow column if the column exists.
 */
function readColumnValue<T>(
  table: ArrowReadableTable | null,
  columnName: string,
  rowIndex: number
): T | null {
  const column = table ? getCachedColumn<T>(table, columnName) : null;
  return column ? ((column.get(rowIndex) as T | null | undefined) ?? null) : null;
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
function resolveBlockTimingSource(block: TimedEntity): TraceSpanTimingSource {
  return {
    spanId: block.spanId,
    primaryTimingKey: block.primaryTimingKey,
    timings: block.timings
  };
}

function getTraceGraphProcessIndex(
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId
): number | null {
  let processIndexMap = traceGraphProcessIndexCache.get(traceGraph);
  if (!processIndexMap) {
    processIndexMap = new Map(
      traceGraph.processIdsByIndex.map((candidate, index) => [candidate, index] as const)
    );
    traceGraphProcessIndexCache.set(traceGraph, processIndexMap);
  }

  return processIndexMap.get(processId) ?? null;
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
  | ArrowTraceLocalDependencyTable
  | ArrowTraceSpanTable
  | ArrowTraceSpanSidecarTable
  | TraceProcessSpanRefTable;

const traceGraphProcessIndexCache = new WeakMap<
  Readonly<TraceGraphData>,
  ReadonlyMap<TraceProcessId, number>
>();
const uniqueSpanRefBySpanIdCache = new WeakMap<
  Readonly<TraceGraphData>,
  ReadonlyMap<TraceSpanId, SpanRef | null>
>();
const traceBlockArrowColumnCache = new WeakMap<
  ArrowReadableTable,
  Map<string, ColumnVector<unknown> | null>
>();

/**
 * Builds the duplicate-aware span id lookup used by id boundaries.
 */
function getUniqueSpanRefBySpanId(
  traceGraph: Readonly<TraceGraphData>
): ReadonlyMap<TraceSpanId, SpanRef | null> {
  let cachedLookup = uniqueSpanRefBySpanIdCache.get(traceGraph);
  if (cachedLookup) {
    return cachedLookup;
  }

  const spanRefBySpanId = new Map<TraceSpanId, SpanRef | null>();
  for (const spanRef of iterateTraceGraphSpanRefs(traceGraph)) {
    const spanRow = getTraceGraphSpanTableRow(traceGraph, spanRef);
    const spanId =
      spanRow == null
        ? null
        : getCachedColumn<TraceSpanId>(spanRow.spanTable, 'span_id')?.get(spanRow.rowIndex);
    if (typeof spanId !== 'string') {
      continue;
    }
    spanRefBySpanId.set(spanId, spanRefBySpanId.has(spanId) ? null : spanRef);
  }

  cachedLookup = spanRefBySpanId;
  uniqueSpanRefBySpanIdCache.set(traceGraph, cachedLookup);
  return cachedLookup;
}

/**
 * Resolves and caches one Arrow column vector by name.
 */
function getCachedColumn<Value>(
  table: ArrowReadableTable,
  columnName: string
): ColumnVector<Value> | null {
  let tableCache = traceBlockArrowColumnCache.get(table);
  if (!tableCache) {
    tableCache = new Map();
    traceBlockArrowColumnCache.set(table, tableCache);
  }

  if (!tableCache.has(columnName)) {
    const column = (table as unknown as {getChild(name: string): unknown}).getChild(
      columnName
    ) as ColumnVector<unknown> | null;
    tableCache.set(columnName, column ?? null);
  }

  return (tableCache.get(columnName) as ColumnVector<Value> | null | undefined) ?? null;
}
