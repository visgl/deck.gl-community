import {getArrowTraceChunkSpanTableRowIndex} from '../ingestion/arrow-trace';
import {
  encodeChunkRef,
  encodeProcessThreadRef,
  getCounterRefChunkIndex,
  getCrossProcessDependencyRefChunkIndex,
  getEventRefChunkIndex,
  getInstantRefChunkIndex,
  getProcessRefIndex,
  getSameProcessDependencyRefProcessIndex,
  getSpanRefChunkIndex,
  getSpanRefRowIndex,
  getThreadRefProcessIndex,
  getTraceRefKind
} from './trace-id-encoder';

import type {
  ArrowTraceChunk,
  ArrowTraceSameProcessDependencyTable,
  ArrowTraceSpanSidecarTable,
  ArrowTraceSpanTable
} from '../ingestion/arrow-trace';
import type {TraceDataset} from '../trace-dataset';
import type {
  CounterRef,
  CrossProcessDependencyRef,
  EventRef,
  InstantRef,
  ProcessRef,
  SameProcessDependencyRef,
  ThreadRef,
  TraceRefKind
} from './trace-id-encoder';
import type {TraceRuntimeEntityRefs} from './trace-runtime-entity-refs';
import type {SpanRef, TraceProcessId, TraceThreadId} from './trace-types';

/**
 * Narrow Arrow table surface required by the runtime chunk registry.
 *
 * Canonical TraceDataset snapshots satisfy this shape directly. The registry reads only retained
 * chunks, dependency tables, sidecars, and canonical process ordering; it never needs a projected
 * graph snapshot.
 */
type TraceChunkRegistrySource = Pick<
  TraceDataset,
  'chunks' | 'sameProcessDependencyTableMap' | 'spanSidecarTableMap' | 'ownerRefSnapshot'
>;

/** Row-backed trace ref families that can be located through a chunk registry. */
export type TraceChunkBackedRefKind = Extract<
  TraceRefKind,
  'span' | 'sameProcessDependency' | 'event' | 'crossProcessDependency' | 'instant' | 'counter'
>;

/** Runtime refs that can be resolved to a loaded chunk. */
export type TraceChunkBackedRef =
  | SpanRef
  | SameProcessDependencyRef
  | CrossProcessDependencyRef
  | EventRef
  | InstantRef
  | CounterRef;

/** Runtime refs that can resolve to an owning process ref. */
export type TraceProcessOwnedRef = TraceChunkBackedRef | ThreadRef | ProcessRef;

/** Runtime refs that can resolve to an owning thread ref. */
export type TraceThreadOwnedRef = SpanRef | EventRef | InstantRef | CounterRef | ThreadRef;

/** Process and thread refs resolved from one loaded span row. */
export type TraceSpanOwnerRefs = {
  /** Owning process ref, when row owner data is available. */
  readonly processRef: ProcessRef | null;
  /** Owning thread ref, when row owner data is available. */
  readonly threadRef: ThreadRef | null;
};

/** Synthetic or streamed runtime chunk metadata used to resolve row-backed runtime refs. */
export type TraceRuntimeChunk = ArrowTraceChunk & {
  /** App-owned stable key for this loaded chunk. */
  readonly chunkKey: string;
  /** Canonical process-local Arrow span table for this chunk. */
  readonly spanTable: ArrowTraceSpanTable;
  /** Row-aligned owner columns extracted from {@link TraceRuntimeChunk.spanTable}. */
  readonly spanColumns: TraceRuntimeSpanColumns;
  /** Resolved same-process Arrow dependency table owned by this storage chunk. */
  readonly resolvedSameProcessDependencyTable: ArrowTraceSameProcessDependencyTable;
  /** Optional row-aligned Arrow sidecar table for this chunk. */
  readonly spanSidecarTable?: ArrowTraceSpanSidecarTable;
  /** Process refs represented by rows in this chunk. */
  readonly processRefs: readonly ProcessRef[];
  /** Process-local thread refs indexed by process-local thread row. */
  readonly threadRefs: readonly ThreadRef[];
  /** Process-local thread refs keyed by ingestion stream id. */
  readonly threadRefById: ReadonlyMap<TraceThreadId, ThreadRef>;
};

/** Minimal Arrow vector surface used by runtime chunk owner accessors. */
type ColumnVector<Value> = {
  /** Returns the value stored at one Arrow row index. */
  get(index: number): Value | null | undefined;
};

/** Span owner vectors reused by runtime chunk owner accessors. */
type TraceRuntimeSpanColumns = {
  /** Runtime process ref column. */
  readonly processRef: ColumnVector<unknown> | null;
  /** Runtime thread ref column. */
  readonly threadRef: ColumnVector<unknown> | null;
  /** Runtime thread id column. */
  readonly threadId: ColumnVector<TraceThreadId> | null;
};

/** Loaded span chunk and canonical Arrow row resolved from one span ref. */
type TraceSpanChunkRow = {
  /** Loaded runtime chunk containing the span row. */
  readonly chunk: TraceRuntimeChunk;
  /** Canonical Arrow span-table row index inside the loaded chunk. */
  readonly rowIndex: number;
};

/** Registry that resolves tagged numeric refs to chunks and owner refs. */
export type TraceChunkRegistry = {
  /** Loaded chunks indexed by encoded chunk index. */
  readonly chunks: readonly TraceRuntimeChunk[];
  /** Resolve the decoded chunk for a row-backed ref. */
  readonly getChunkByRef: (ref: number) => TraceRuntimeChunk | null;
  /** Resolve the loaded chunk for a span ref without generic ref-kind dispatch. */
  readonly getSpanChunkByRef: (spanRef: SpanRef) => TraceRuntimeChunk | null;
  /** Resolve the owning process ref for a supported runtime ref. */
  readonly getProcessRefByRef: (ref: number) => ProcessRef | null;
  /** Resolve the owning thread ref for a supported runtime ref. */
  readonly getThreadRefByRef: (ref: number) => ThreadRef | null;
  /** Resolve both owner refs for one loaded span row with one row lookup. */
  readonly getSpanOwnerRefs: (spanRef: SpanRef) => TraceSpanOwnerRefs | null;
};

/** Builds the chunk registry from canonical dataset tables. */
export function buildTraceChunkRegistry(
  traceGraphTables: Readonly<TraceChunkRegistrySource>,
  runtimeEntityRefs: Readonly<TraceRuntimeEntityRefs>
): TraceChunkRegistry {
  const chunks = traceGraphTables.chunks.map(chunk => buildTraceChunk(chunk, runtimeEntityRefs));
  const spanChunkByIndex = new Map(chunks.map(chunk => [chunk.chunkIndex, chunk] as const));
  const compatibilityProcessChunks = buildCompatibilityProcessChunks(
    traceGraphTables,
    runtimeEntityRefs
  );
  const compatibilityProcessChunkByIndex = new Map(
    compatibilityProcessChunks.map(chunk => [chunk.chunkIndex, chunk] as const)
  );

  return {
    chunks,
    getChunkByRef: ref => getChunkByRef(spanChunkByIndex, compatibilityProcessChunkByIndex, ref),
    getSpanChunkByRef: spanRef => spanChunkByIndex.get(getSpanRefChunkIndex(spanRef)) ?? null,
    getProcessRefByRef: ref =>
      getProcessRefByRef(
        runtimeEntityRefs,
        spanChunkByIndex,
        compatibilityProcessChunkByIndex,
        ref
      ),
    getThreadRefByRef: ref =>
      getThreadRefByRef(runtimeEntityRefs, spanChunkByIndex, compatibilityProcessChunkByIndex, ref),
    getSpanOwnerRefs: spanRef => getSpanOwnerRefs(spanChunkByIndex, spanRef)
  };
}

/**
 * Attach owner lookup helpers to one row-backed storage chunk.
 */
function buildTraceChunk(
  chunk: ArrowTraceChunk,
  runtimeEntityRefs: Readonly<TraceRuntimeEntityRefs>
): TraceRuntimeChunk {
  const processId = chunk.processId;
  const compatibilityProcessRef = processId
    ? (runtimeEntityRefs.processRefById.get(processId) ?? null)
    : null;
  const processRefs =
    chunk.processRefs.length > 0
      ? chunk.processRefs
      : compatibilityProcessRef != null
        ? [compatibilityProcessRef]
        : [];
  const threadRefs = processRefs.flatMap(
    processRef => runtimeEntityRefs.threadRefsByProcessRef.get(processRef) ?? []
  );
  return {
    ...chunk,
    spanColumns: readTraceRuntimeSpanColumns(chunk.spanTable),
    processRefs,
    threadRefs,
    threadRefById: new Map(
      threadRefs.flatMap(threadRef => {
        const threadId = runtimeEntityRefs.threadIdByRef.get(threadRef);
        return threadId ? [[threadId, threadRef] as const] : [];
      })
    )
  } satisfies TraceRuntimeChunk;
}

/**
 * Build process-scoped synthetic chunks for non-span row-backed ref families.
 */
function buildCompatibilityProcessChunks(
  traceGraphTables: Readonly<TraceChunkRegistrySource>,
  runtimeEntityRefs: Readonly<TraceRuntimeEntityRefs>
): readonly TraceRuntimeChunk[] {
  return traceGraphTables.ownerRefSnapshot.processIdsByIndex.flatMap((processId, processIndex) => {
    const sourceChunk = traceGraphTables.chunks.find(chunk => chunk.processId === processId);
    const spanTable = sourceChunk?.spanTable;
    const sameProcessDependencyTable = traceGraphTables.sameProcessDependencyTableMap[processId];
    if (!spanTable || !sameProcessDependencyTable) {
      return [];
    }
    const processRef = runtimeEntityRefs.processRefById.get(processId as TraceProcessId);
    return [
      buildTraceChunk(
        {
          chunkIndex: processIndex,
          chunkRef: encodeChunkRef(processIndex),
          chunkKey: processId,
          processRefs: processRef == null ? [] : [processRef],
          processId: processId as TraceProcessId,
          spanTable,
          resolvedSameProcessDependencyTable: sameProcessDependencyTable,
          spanSidecarTable:
            sourceChunk?.spanSidecarTable ?? traceGraphTables.spanSidecarTableMap?.[processId]
        },
        runtimeEntityRefs
      )
    ];
  });
}

/**
 * Resolves any tagged chunk-backed ref to its loaded runtime chunk.
 */
function getChunkByRef(
  spanChunkByIndex: ReadonlyMap<number, TraceRuntimeChunk>,
  compatibilityProcessChunkByIndex: ReadonlyMap<number, TraceRuntimeChunk>,
  ref: number
): TraceRuntimeChunk | null {
  const kind = getTraceRefKind(ref);
  switch (kind) {
    case 'span':
      return spanChunkByIndex.get(getSpanRefChunkIndex(ref as SpanRef)) ?? null;
    case 'sameProcessDependency':
      return (
        compatibilityProcessChunkByIndex.get(
          getSameProcessDependencyRefProcessIndex(ref as SameProcessDependencyRef)
        ) ?? null
      );
    case 'event':
      return compatibilityProcessChunkByIndex.get(getEventRefChunkIndex(ref as EventRef)) ?? null;
    case 'crossProcessDependency':
      return (
        compatibilityProcessChunkByIndex.get(
          getCrossProcessDependencyRefChunkIndex(ref as CrossProcessDependencyRef)
        ) ?? null
      );
    case 'instant':
      return (
        compatibilityProcessChunkByIndex.get(getInstantRefChunkIndex(ref as InstantRef)) ?? null
      );
    case 'counter':
      return (
        compatibilityProcessChunkByIndex.get(getCounterRefChunkIndex(ref as CounterRef)) ?? null
      );
    default:
      return null;
  }
}

/**
 * Resolves a runtime ref to an owning process ref when ownership is unambiguous.
 */
function getProcessRefByRef(
  runtimeEntityRefs: Readonly<TraceRuntimeEntityRefs>,
  spanChunkByIndex: ReadonlyMap<number, TraceRuntimeChunk>,
  compatibilityProcessChunkByIndex: ReadonlyMap<number, TraceRuntimeChunk>,
  ref: number
): ProcessRef | null {
  const kind = getTraceRefKind(ref);
  switch (kind) {
    case 'process':
      return ref as ProcessRef;
    case 'thread':
      return runtimeEntityRefs.processRefByThreadRef.get(ref as ThreadRef) ?? null;
    case 'instant':
      return runtimeEntityRefs.processRefByInstantRef.get(ref as InstantRef) ?? null;
    case 'counter':
      return runtimeEntityRefs.processRefByCounterRef.get(ref as CounterRef) ?? null;
    case 'span':
      return getProcessRefBySpanRef(spanChunkByIndex, ref as SpanRef);
    case 'sameProcessDependency': {
      const processIndex = getSameProcessDependencyRefProcessIndex(ref as SameProcessDependencyRef);
      return runtimeEntityRefs.processRefs[processIndex] ?? null;
    }
    case 'event':
    case 'crossProcessDependency': {
      const chunk = getChunkByRef(spanChunkByIndex, compatibilityProcessChunkByIndex, ref);
      return chunk?.processRefs.length === 1 ? (chunk.processRefs[0] ?? null) : null;
    }
    default:
      return null;
  }
}

/**
 * Resolves a runtime ref to an owning thread ref when ownership is unambiguous.
 */
function getThreadRefByRef(
  runtimeEntityRefs: Readonly<TraceRuntimeEntityRefs>,
  spanChunkByIndex: ReadonlyMap<number, TraceRuntimeChunk>,
  compatibilityProcessChunkByIndex: ReadonlyMap<number, TraceRuntimeChunk>,
  ref: number
): ThreadRef | null {
  const kind = getTraceRefKind(ref);
  switch (kind) {
    case 'thread':
      return ref as ThreadRef;
    case 'span':
      return getThreadRefBySpanRef(spanChunkByIndex, ref as SpanRef);
    case 'event':
      return getThreadRefByEventRef(compatibilityProcessChunkByIndex, ref as EventRef);
    case 'instant':
      return runtimeEntityRefs.threadRefByInstantRef.get(ref as InstantRef) ?? null;
    case 'counter':
      return runtimeEntityRefs.threadRefByCounterRef.get(ref as CounterRef) ?? null;
    default:
      return null;
  }
}

/**
 * Resolves a span's owning thread from row-level owner data.
 */
function getThreadRefBySpanRef(
  spanChunkByIndex: ReadonlyMap<number, TraceRuntimeChunk>,
  spanRef: SpanRef
): ThreadRef | null {
  const spanChunkRow = getSpanChunkRow(spanChunkByIndex, spanRef);
  return spanChunkRow ? getThreadRefBySpanRow(spanChunkRow.chunk, spanChunkRow.rowIndex) : null;
}

/** Resolves a span row to its owning thread ref from row-level owner data. */
function getThreadRefBySpanRow(chunk: TraceRuntimeChunk, rowIndex: number): ThreadRef | null {
  const threadRef = readArrowRefColumn(chunk.spanColumns.threadRef, rowIndex);
  const chunkProcessRef = chunk.processRefs.length === 1 ? (chunk.processRefs[0] ?? null) : null;
  if (
    threadRef != null &&
    (chunkProcessRef == null ||
      getThreadRefProcessIndex(threadRef as ThreadRef) === getProcessRefIndex(chunkProcessRef))
  ) {
    return threadRef as ThreadRef;
  }
  const threadId = readColumnValue(chunk.spanColumns.threadId, rowIndex);
  if (chunk.processId != null && threadId && chunk.processRefs.length === 1) {
    const threadRef = chunk.threadRefById.get(threadId);
    if (threadRef != null) {
      return threadRef;
    }
    const threadIndex = [...chunk.threadRefById.keys()].indexOf(threadId);
    if (threadIndex >= 0) {
      return encodeProcessThreadRef(getProcessRefIndex(chunk.processRefs[0]!), threadIndex);
    }
  }
  return threadId ? (chunk.threadRefById.get(threadId) ?? null) : null;
}

/** Resolves a chunk-backed event to its only thread owner when that owner is unambiguous. */
function getThreadRefByEventRef(
  compatibilityProcessChunkByIndex: ReadonlyMap<number, TraceRuntimeChunk>,
  eventRef: EventRef
): ThreadRef | null {
  const chunk = compatibilityProcessChunkByIndex.get(getEventRefChunkIndex(eventRef));
  if (!chunk) {
    return null;
  }
  return chunk.threadRefs.length === 1 ? chunk.threadRefs[0] : null;
}

/** Resolves a span row to its owning process ref from row-level owner data. */
function getProcessRefBySpanRef(
  spanChunkByIndex: ReadonlyMap<number, TraceRuntimeChunk>,
  spanRef: SpanRef
): ProcessRef | null {
  const spanChunkRow = getSpanChunkRow(spanChunkByIndex, spanRef);
  return spanChunkRow ? getProcessRefBySpanRow(spanChunkRow.chunk, spanChunkRow.rowIndex) : null;
}

/** Resolves a span row to its owning process ref from row-level owner data. */
function getProcessRefBySpanRow(chunk: TraceRuntimeChunk, rowIndex: number): ProcessRef | null {
  if (chunk.processId != null && chunk.processRefs.length === 1) {
    return chunk.processRefs[0] ?? null;
  }
  const processRef = readArrowRefColumn(chunk.spanColumns.processRef, rowIndex);
  if (processRef != null) {
    return processRef as ProcessRef;
  }
  return chunk.processRefs.length === 1 ? (chunk.processRefs[0] ?? null) : null;
}

/** Resolves both row-backed owner refs for one loaded span. */
function getSpanOwnerRefs(
  spanChunkByIndex: ReadonlyMap<number, TraceRuntimeChunk>,
  spanRef: SpanRef
): TraceSpanOwnerRefs | null {
  const spanChunkRow = getSpanChunkRow(spanChunkByIndex, spanRef);
  if (!spanChunkRow) {
    return null;
  }
  return {
    processRef: getProcessRefBySpanRow(spanChunkRow.chunk, spanChunkRow.rowIndex),
    threadRef: getThreadRefBySpanRow(spanChunkRow.chunk, spanChunkRow.rowIndex)
  };
}

/** Resolves one loaded span ref to its chunk and canonical Arrow row. */
function getSpanChunkRow(
  spanChunkByIndex: ReadonlyMap<number, TraceRuntimeChunk>,
  spanRef: SpanRef
): TraceSpanChunkRow | null {
  const chunk = spanChunkByIndex.get(getSpanRefChunkIndex(spanRef));
  if (!chunk) {
    return null;
  }
  const rowIndex = getArrowTraceChunkSpanTableRowIndex(chunk, getSpanRefRowIndex(spanRef));
  return rowIndex == null ? null : {chunk, rowIndex};
}

/**
 * Converts Arrow numeric ref values back to safe JavaScript numbers.
 */
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

/** Extracts runtime owner vectors from one span table. */
function readTraceRuntimeSpanColumns(spanTable: ArrowTraceSpanTable): TraceRuntimeSpanColumns {
  return {
    processRef: getTraceRuntimeSpanColumn(spanTable, 'process_ref'),
    threadRef: getTraceRuntimeSpanColumn(spanTable, 'thread_ref'),
    threadId: getTraceRuntimeSpanColumn(spanTable, 'thread_id')
  };
}

/** Resolves one Arrow span-table vector by column name. */
function getTraceRuntimeSpanColumn<Value>(
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

/** Reads one typed value from an extracted Arrow column if the column exists. */
function readColumnValue<Value>(
  column: ColumnVector<Value> | null,
  rowIndex: number
): Value | null {
  return column ? (column.get(rowIndex) ?? null) : null;
}

/** Reads one extracted Arrow ref column and normalizes numeric/bigint Arrow scalar values. */
function readArrowRefColumn(column: ColumnVector<unknown> | null, rowIndex: number): number | null {
  return normalizeArrowRefNumber(readColumnValue(column, rowIndex));
}
