import type {
  ArrowTraceLocalDependencyTable,
  ArrowTraceProcessMetadata,
  ArrowTraceSpanSidecarTable,
  ArrowTraceSpanTable,
  TraceSpanArrowSidecarRow
} from './ingestion/arrow-trace';
import type {
  TraceChunkData,
  TraceChunkDiagnostics,
  TraceChunkRowWindowTable,
  TraceChunkSourceDependencyTable
} from './trace-chunk-data';
import type {ChunkRef, ProcessRef} from './trace-graph/trace-id-encoder';

/** Store-owned indexes derived when `TraceChunkData` is added to a chunk store. */
export type TraceChunkIndexes = {
  /** External span ids aligned by chunk-local span-ref row index. */
  readonly externalSpanIdByRowIndex: readonly (string | null)[];
  /** Chunk-local span-ref row index keyed by stable external span id. */
  readonly rowIndexByExternalSpanId: ReadonlyMap<string, number>;
  /** Parent external span ids aligned by chunk-local span-ref row index. */
  readonly parentExternalSpanIdByRowIndex: readonly (string | null)[];
  /** Source dependency row indexes keyed by destination external span id. */
  readonly sourceDependencyRowsByEndExternalSpanId: ReadonlyMap<string, readonly number[]>;
};

/** Store-owned metadata derived when `TraceChunkData` is added to a chunk store. */
export type TraceChunkMetadata = {
  /** Number of chunk-local span-ref rows represented by this chunk. */
  readonly rowCount: number;
  /** Whether any row in the chunk has a finite window-overlap envelope. */
  readonly hasWindowRows: boolean;
};

/** Store-owned trace chunk with finalized chunk refs and derived indexes. */
export type TraceChunk = {
  /** Payload discriminator for store-owned chunks. */
  readonly type: 'trace-chunk';
  /** Store-local chunk key that owns this normalized payload. */
  readonly chunkKey: string;
  /** Metadata for every process represented by rows in this chunk. */
  readonly processes: readonly ArrowTraceProcessMetadata[];
  /** Canonical Arrow span table for this chunk. */
  readonly spanTable: ArrowTraceSpanTable;
  /** Canonical Arrow local dependency table for chunk-local dependencies. */
  readonly localDependencyTable: ArrowTraceLocalDependencyTable;
  /** Optional row-aligned compatibility payloads kept during migration. */
  readonly spanSidecarRows?: readonly TraceSpanArrowSidecarRow[];
  /** Optional row-aligned Arrow sidecar table for this chunk. */
  readonly spanSidecarTable?: ArrowTraceSpanSidecarTable;
  /** Source-level dependency rows that may resolve across chunk boundaries. */
  readonly sourceDependencyTable?: TraceChunkSourceDependencyTable;
  /** Row-level time-window overlap metadata. */
  readonly rowWindowTable?: TraceChunkRowWindowTable;
  /** Parser-local diagnostics for this chunk. */
  readonly diagnostics: TraceChunkDiagnostics;
  /** Ref lifecycle marker for store-finalized chunks. */
  readonly refState: 'store-finalized';
  /** Stable store chunk slot encoded into runtime span refs. */
  readonly chunkIndex: number;
  /** Typed store chunk reference matching `chunkIndex`. */
  readonly chunkRef: ChunkRef;
  /** Store-finalized process refs represented by rows in this chunk. */
  readonly processRefs: readonly ProcessRef[];
  /** Store-owned indexes derived from chunk data. */
  readonly indexes: TraceChunkIndexes;
  /** Store-owned metadata derived from chunk data. */
  readonly metadata: TraceChunkMetadata;
  /** Source-column filename filter masks aligned by chunk-local span-ref row index. */
  readonly sourceFilterMaskByRow?: Readonly<Uint8Array>;
};

/** Promotes parser-local chunk data into a store-owned finalized chunk. */
export function finalizeTraceChunkData(params: {
  /** Parser/ingester output consumed by the store. */
  readonly data: TraceChunkData;
  /** Stable store chunk index assigned by the store. */
  readonly chunkIndex: number;
  /** Typed store chunk ref matching `chunkIndex`. */
  readonly chunkRef: ChunkRef;
  /** Store-finalized process refs represented by the chunk rows. */
  readonly processRefs: readonly ProcessRef[];
}): TraceChunk {
  const indexes = buildTraceChunkIndexes(params.data);
  return {
    type: 'trace-chunk',
    chunkKey: params.data.chunkKey,
    processes: params.data.processes,
    spanTable: params.data.spanTable,
    localDependencyTable: params.data.localDependencyTable,
    spanSidecarRows: params.data.spanSidecarRows,
    spanSidecarTable: params.data.spanSidecarTable,
    sourceDependencyTable: params.data.sourceDependencyTable,
    rowWindowTable: params.data.rowWindowTable,
    diagnostics: params.data.diagnostics,
    refState: 'store-finalized',
    chunkIndex: params.chunkIndex,
    chunkRef: params.chunkRef,
    processRefs: params.processRefs,
    indexes,
    metadata: buildTraceChunkMetadata(params.data, indexes)
  };
}

/** Returns whether an unknown payload has the normalized trace chunk discriminator. */
export function isTraceChunk(payload: unknown): payload is TraceChunk {
  return (
    payload != null &&
    typeof payload === 'object' &&
    (payload as {readonly type?: unknown}).type === 'trace-chunk' &&
    (payload as {readonly refState?: unknown}).refState === 'store-finalized'
  );
}

/**
 * Returns whether a normalized trace chunk contains one stable chunk-local span-ref row.
 */
export function traceChunkHasSpanRefRow(payload: TraceChunk, spanRefRowIndex: number): boolean {
  return getTraceChunkSpanTableRowIndex(payload, spanRefRowIndex) != null;
}

/** Builds store-owned lookup indexes for parser-local chunk data. */
function buildTraceChunkIndexes(data: TraceChunkData): TraceChunkIndexes {
  const externalSpanIdByRowIndex: Array<string | null> = [];
  const rowIndexByExternalSpanId = new Map<string, number>();
  for (let rowIndex = 0; rowIndex < data.spanTable.numRows; rowIndex += 1) {
    const externalSpanId =
      normalizeExternalSpanId(
        readColumnValue<string>(data.spanTable, 'external_span_id', rowIndex)
      ) ?? null;
    externalSpanIdByRowIndex[rowIndex] = externalSpanId;
    if (externalSpanId) {
      rowIndexByExternalSpanId.set(externalSpanId, rowIndex);
    }
  }

  const sourceDependencyRowsByEndExternalSpanId = new Map<string, number[]>();
  const parentExternalSpanIdByRowIndex: Array<string | null> = [];
  data.sourceDependencyTable?.rows.forEach((row, rowIndex) => {
    const rowIndexesForEnd =
      sourceDependencyRowsByEndExternalSpanId.get(row.endExternalSpanId) ?? [];
    rowIndexesForEnd.push(rowIndex);
    sourceDependencyRowsByEndExternalSpanId.set(row.endExternalSpanId, rowIndexesForEnd);
    if (row.dependencyKind !== 'parent') {
      return;
    }
    const endRowIndex = rowIndexByExternalSpanId.get(row.endExternalSpanId);
    if (endRowIndex != null) {
      parentExternalSpanIdByRowIndex[endRowIndex] = row.startExternalSpanId;
    }
  });
  for (let rowIndex = 0; rowIndex < data.spanTable.numRows; rowIndex += 1) {
    parentExternalSpanIdByRowIndex[rowIndex] ??= null;
  }

  return {
    externalSpanIdByRowIndex,
    rowIndexByExternalSpanId,
    parentExternalSpanIdByRowIndex,
    sourceDependencyRowsByEndExternalSpanId
  };
}

/** Builds store-owned summary metadata for parser-local chunk data. */
function buildTraceChunkMetadata(
  data: TraceChunkData,
  indexes: TraceChunkIndexes
): TraceChunkMetadata {
  return {
    rowCount: indexes.externalSpanIdByRowIndex.length,
    hasWindowRows: Boolean(
      data.rowWindowTable?.overlapRangesByRow.some(ranges => ranges.length > 0)
    )
  };
}

/** Resolves a stable span-ref row index into the backing Arrow span-table row index. */
function getTraceChunkSpanTableRowIndex(
  payload: Pick<TraceChunkData, 'spanTable'>,
  spanRefRowIndex: number
): number | null {
  return spanRefRowIndex >= 0 && spanRefRowIndex < payload.spanTable.numRows
    ? spanRefRowIndex
    : null;
}

/** Reads one typed value from an Arrow column if the column exists. */
function readColumnValue<T>(
  table: ArrowTraceSpanTable,
  columnName: string,
  rowIndex: number
): T | null {
  const column = (
    table as unknown as {
      getChild(name: string): {get(index: number): T | null | undefined} | null | undefined;
    }
  ).getChild(columnName);
  return column ? (column.get(rowIndex) ?? null) : null;
}

/** Returns a normalized external span id from a nullable Arrow string value. */
function normalizeExternalSpanId(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}
