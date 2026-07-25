import type {ArrowTraceSameProcessDependencyTable} from '../ingestion/arrow-trace';

/** Public Apache Arrow data fields needed to borrow one dense fixed-width value batch. */
type TraceDenseDependencyFixedWidthData = {
  /** Number of logical dependency rows represented by this Arrow data batch. */
  readonly length: number;
  /** Original Arrow row offset used only while checking validity bitmap bits. */
  readonly offset: number;
  /** Number of invalid rows in this batch after Arrow resolves any lazy null count. */
  readonly nullCount: number;
  /** Borrowed primitive value storage validated before direct reads. */
  readonly values: unknown;
  /** Borrowed Arrow validity bitmap when the batch contains null rows. */
  readonly nullBitmap?: unknown;
};

/** Narrow Arrow column shape whose public data batches can be borrowed without copies. */
type TraceDenseDependencyFixedWidthColumn = {
  /** Public Arrow data batches backing this dependency vector. */
  readonly data: ReadonlyArray<TraceDenseDependencyFixedWidthData>;
};

/** One borrowed dense dependency fixed-width batch plus its validity metadata. */
export type TraceDenseDependencyFixedWidthValueBatch<TValues extends Float64Array | Uint8Array> = {
  /** Borrowed primitive values already sliced to this batch's local row zero. */
  readonly values: TValues;
  /** Number of logical dependency rows represented by the borrowed values. */
  readonly length: number;
  /** Original Arrow row offset used only while checking validity bits. */
  readonly validityOffset: number;
  /** Borrowed validity bitmap, or null when every row is valid. */
  readonly nullBitmap: Uint8Array | null;
};

/** One aligned endpoint-only dependency batch borrowing canonical ref columns by identity. */
export type TraceDenseDependencyFixedWidthEndpointBatch = {
  /** Inclusive dependency-table row where this aligned batch starts. */
  readonly rowStart: number;
  /** Exclusive dependency-table row where this aligned batch ends. */
  readonly rowEnd: number;
  /** Borrowed canonical source span-ref values for this aligned batch. */
  readonly startSpanRef: TraceDenseDependencyFixedWidthValueBatch<Float64Array>;
  /** Borrowed canonical target span-ref values for this aligned batch. */
  readonly endSpanRef: TraceDenseDependencyFixedWidthValueBatch<Float64Array>;
};

/** One aligned dependency batch borrowing every hot scalar column by identity. */
export type TraceDenseDependencyFixedWidthBatch = TraceDenseDependencyFixedWidthEndpointBatch & {
  /** Borrowed compact wait-mode codes for this aligned batch. */
  readonly waitModeCode: TraceDenseDependencyFixedWidthValueBatch<Uint8Array>;
  /** Borrowed canonical wait-duration values for this aligned batch. */
  readonly waitTimeMs: TraceDenseDependencyFixedWidthValueBatch<Float64Array>;
  /** Borrowed compact parent/submit keyword flags for this aligned batch. */
  readonly keywordFlags: TraceDenseDependencyFixedWidthValueBatch<Uint8Array>;
};

/** One null-free offset-zero dependency batch trusted by finalized dataset-only scans. */
export type TraceTrustedDenseDependencyFixedWidthBatch = {
  /** Inclusive dependency-table row where this aligned batch starts. */
  readonly rowStart: number;
  /** Exclusive dependency-table row where this aligned batch ends. */
  readonly rowEnd: number;
  /** Borrowed canonical source span-ref values for this aligned batch. */
  readonly startSpanRef: Float64Array;
  /** Borrowed canonical target span-ref values for this aligned batch. */
  readonly endSpanRef: Float64Array;
  /** Borrowed compact wait-mode codes for this aligned batch. */
  readonly waitModeCode: Uint8Array;
  /** Borrowed canonical wait-duration values for this aligned batch. */
  readonly waitTimeMs: Float64Array;
  /** Borrowed compact parent/submit keyword flags for this aligned batch. */
  readonly keywordFlags: Uint8Array;
};

/**
 * Borrows aligned endpoint-only fixed-width dependency batches for one build-local scan.
 *
 * The returned descriptors only wrap existing Arrow buffers and are not retained by callers.
 * Unsupported Arrow vector shapes return null so callers can preserve their checked scalar path.
 */
export function buildTraceDenseDependencyFixedWidthEndpointBatchesForTable(
  table: Readonly<ArrowTraceSameProcessDependencyTable>
): readonly TraceDenseDependencyFixedWidthEndpointBatch[] | null {
  return buildTraceDenseDependencyFixedWidthEndpointBatches(
    table.numRows,
    getTraceDenseDependencyFixedWidthEndpointColumns(table)
  );
}

/**
 * Borrows aligned fixed-width dependency batches for one build-local table scan.
 *
 * Every hot numeric column must expose public Arrow Vector.data batches with matching row
 * boundaries. Rejecting the whole binding on one unsupported column keeps scalar fallback simple
 * and preserves Arrow buffer identity.
 */
export function buildTraceDenseDependencyFixedWidthBatchesForTable(
  table: Readonly<ArrowTraceSameProcessDependencyTable>
): readonly TraceDenseDependencyFixedWidthBatch[] | null {
  return buildTraceDenseDependencyFixedWidthBatches(
    table.numRows,
    getTraceDenseDependencyFixedWidthColumns(table)
  );
}

/**
 * Narrows checked full dependency batches into null-free offset-zero finalized-table batches.
 *
 * One nullable or sliced batch rejects the complete table so accepted hot loops never mix checked
 * and unchecked row semantics.
 */
export function buildTraceTrustedDenseDependencyFixedWidthBatches(
  batches: readonly TraceDenseDependencyFixedWidthBatch[] | null
): readonly TraceTrustedDenseDependencyFixedWidthBatch[] | null {
  if (!batches || batches.length === 0) {
    return null;
  }

  const trustedBatches: TraceTrustedDenseDependencyFixedWidthBatch[] = [];
  for (const batch of batches) {
    if (
      !isTraceNullFreeOffsetZeroDependencyBatch(batch.startSpanRef) ||
      !isTraceNullFreeOffsetZeroDependencyBatch(batch.endSpanRef) ||
      !isTraceNullFreeOffsetZeroDependencyBatch(batch.waitModeCode) ||
      !isTraceNullFreeOffsetZeroDependencyBatch(batch.waitTimeMs) ||
      !isTraceNullFreeOffsetZeroDependencyBatch(batch.keywordFlags)
    ) {
      return null;
    }
    trustedBatches.push({
      rowStart: batch.rowStart,
      rowEnd: batch.rowEnd,
      startSpanRef: batch.startSpanRef.values,
      endSpanRef: batch.endSpanRef.values,
      waitModeCode: batch.waitModeCode.values,
      waitTimeMs: batch.waitTimeMs.values,
      keywordFlags: batch.keywordFlags.values
    });
  }
  return trustedBatches;
}

/** Borrowed canonical dependency columns needed by endpoint-only and full fixed-width binders. */
type TraceDenseDependencyFixedWidthColumns = {
  /** Borrowed source span-ref column. */
  readonly startSpanRef: {get(rowIndex: number): unknown} | null;
  /** Borrowed target span-ref column. */
  readonly endSpanRef: {get(rowIndex: number): unknown} | null;
  /** Borrowed compact wait-mode discriminator column. */
  readonly waitModeCode: {get(rowIndex: number): unknown} | null;
  /** Borrowed wait-duration column used only while writing colors. */
  readonly waitTimeMs: {get(rowIndex: number): unknown} | null;
  /** Borrowed compact parent/submit keyword predicate flags. */
  readonly keywordFlags: {get(rowIndex: number): unknown} | null;
};

/** Returns only the canonical endpoint columns needed by exact visible-row counts. */
function getTraceDenseDependencyFixedWidthEndpointColumns(
  table: Readonly<ArrowTraceSameProcessDependencyTable>
): Pick<TraceDenseDependencyFixedWidthColumns, 'startSpanRef' | 'endSpanRef'> {
  return {
    startSpanRef: table.getChild('startSpanRef') ?? null,
    endSpanRef: table.getChild('endSpanRef') ?? null
  };
}

/** Returns every canonical dependency column needed by direct binary row writers. */
function getTraceDenseDependencyFixedWidthColumns(
  table: Readonly<ArrowTraceSameProcessDependencyTable>
): TraceDenseDependencyFixedWidthColumns {
  return {
    ...getTraceDenseDependencyFixedWidthEndpointColumns(table),
    waitModeCode: table.getChild('waitModeCode') ?? null,
    waitTimeMs: table.getChild('waitTimeMs') ?? null,
    keywordFlags: table.getChild('keywordFlags') ?? null
  };
}

/** Binds aligned borrowed Float64 endpoint batches without copying. */
function buildTraceDenseDependencyFixedWidthEndpointBatches(
  rowCount: number,
  columns: Pick<TraceDenseDependencyFixedWidthColumns, 'startSpanRef' | 'endSpanRef'>
): readonly TraceDenseDependencyFixedWidthEndpointBatch[] | null {
  const startSpanRefData = getTraceDenseDependencyFixedWidthColumnData(columns.startSpanRef);
  const endSpanRefData = getTraceDenseDependencyFixedWidthColumnData(columns.endSpanRef);
  if (!startSpanRefData || !endSpanRefData || startSpanRefData.length !== endSpanRefData.length) {
    return null;
  }

  const batches: TraceDenseDependencyFixedWidthEndpointBatch[] = [];
  let rowStart = 0;
  for (let batchIndex = 0; batchIndex < startSpanRefData.length; batchIndex += 1) {
    const startSpanRef = buildTraceDenseDependencyFixedWidthValueBatch(
      startSpanRefData[batchIndex],
      isFloat64Array
    );
    const endSpanRef = buildTraceDenseDependencyFixedWidthValueBatch(
      endSpanRefData[batchIndex],
      isFloat64Array
    );
    if (!startSpanRef || !endSpanRef || startSpanRef.length !== endSpanRef.length) {
      return null;
    }

    const rowEnd = rowStart + startSpanRef.length;
    batches.push({rowStart, rowEnd, startSpanRef, endSpanRef});
    rowStart = rowEnd;
  }

  return rowStart === rowCount ? batches : null;
}

/** Binds aligned borrowed full dependency batches without copying. */
function buildTraceDenseDependencyFixedWidthBatches(
  rowCount: number,
  columns: TraceDenseDependencyFixedWidthColumns
): readonly TraceDenseDependencyFixedWidthBatch[] | null {
  const endpointBatches = buildTraceDenseDependencyFixedWidthEndpointBatches(rowCount, columns);
  const waitModeCodeData = getTraceDenseDependencyFixedWidthColumnData(columns.waitModeCode);
  const waitTimeMsData = getTraceDenseDependencyFixedWidthColumnData(columns.waitTimeMs);
  const keywordFlagsData = getTraceDenseDependencyFixedWidthColumnData(columns.keywordFlags);
  if (
    !endpointBatches ||
    !waitModeCodeData ||
    !waitTimeMsData ||
    !keywordFlagsData ||
    endpointBatches.length !== waitModeCodeData.length ||
    endpointBatches.length !== waitTimeMsData.length ||
    endpointBatches.length !== keywordFlagsData.length
  ) {
    return null;
  }

  const batches: TraceDenseDependencyFixedWidthBatch[] = [];
  for (let batchIndex = 0; batchIndex < endpointBatches.length; batchIndex += 1) {
    const endpointBatch = endpointBatches[batchIndex];
    if (!endpointBatch) {
      return null;
    }
    const waitModeCode = buildTraceDenseDependencyFixedWidthValueBatch(
      waitModeCodeData[batchIndex],
      isUint8Array
    );
    const waitTimeMs = buildTraceDenseDependencyFixedWidthValueBatch(
      waitTimeMsData[batchIndex],
      isFloat64Array
    );
    const keywordFlags = buildTraceDenseDependencyFixedWidthValueBatch(
      keywordFlagsData[batchIndex],
      isUint8Array
    );
    const rowCountInBatch = endpointBatch.rowEnd - endpointBatch.rowStart;
    if (
      !waitModeCode ||
      !waitTimeMs ||
      !keywordFlags ||
      waitModeCode.length !== rowCountInBatch ||
      waitTimeMs.length !== rowCountInBatch ||
      keywordFlags.length !== rowCountInBatch
    ) {
      return null;
    }
    batches.push({
      ...endpointBatch,
      waitModeCode,
      waitTimeMs,
      keywordFlags
    });
  }
  return batches;
}

/** Returns whether one checked dependency batch can be read without validity metadata. */
function isTraceNullFreeOffsetZeroDependencyBatch(
  batch: TraceDenseDependencyFixedWidthValueBatch<Float64Array | Uint8Array>
): boolean {
  return batch.nullBitmap == null && batch.validityOffset === 0;
}

/** Returns the public Arrow data batches from one vector-shaped dependency column. */
function getTraceDenseDependencyFixedWidthColumnData(
  column: {get(rowIndex: number): unknown} | null
): readonly TraceDenseDependencyFixedWidthData[] | null {
  const data = (column as Partial<TraceDenseDependencyFixedWidthColumn> | null)?.data;
  return Array.isArray(data) && data.length > 0 ? data : null;
}

/** Validates one public Arrow fixed-width data batch and borrows its values by identity. */
function buildTraceDenseDependencyFixedWidthValueBatch<TValues extends Float64Array | Uint8Array>(
  data: TraceDenseDependencyFixedWidthData | undefined,
  isValues: (value: unknown) => value is TValues
): TraceDenseDependencyFixedWidthValueBatch<TValues> | null {
  if (
    !data ||
    !Number.isSafeInteger(data.length) ||
    data.length < 0 ||
    !Number.isSafeInteger(data.offset) ||
    data.offset < 0 ||
    !Number.isSafeInteger(data.nullCount) ||
    data.nullCount < 0 ||
    data.nullCount > data.length ||
    !isValues(data.values) ||
    data.values.length < data.offset + data.length
  ) {
    return null;
  }

  let nullBitmap: Uint8Array | null = null;
  if (data.nullCount > 0) {
    if (!(data.nullBitmap instanceof Uint8Array)) {
      return null;
    }
    const requiredBitmapByteLength = Math.ceil((data.offset + data.length) / 8);
    if (data.nullBitmap.length < requiredBitmapByteLength) {
      return null;
    }
    nullBitmap = data.nullBitmap;
  }

  const values = (
    data.offset === 0 ? data.values : data.values.subarray(data.offset, data.offset + data.length)
  ) as TValues;

  return {
    values,
    length: data.length,
    validityOffset: data.offset,
    nullBitmap
  };
}

/** Returns whether a borrowed Arrow value buffer is the expected Float64 representation. */
function isFloat64Array(value: unknown): value is Float64Array {
  return value instanceof Float64Array;
}

/** Returns whether a borrowed Arrow value buffer is the expected Uint8 representation. */
function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}
