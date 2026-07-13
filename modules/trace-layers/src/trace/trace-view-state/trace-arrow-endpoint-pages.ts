import {getArrowTraceChunkSpanTableRowIndex} from '../ingestion/arrow-trace';
import {decodeTraceSpanTimingStatusCode} from '../ingestion/trace-span-timing-status-code';
import {resolveTraceSpanTimingEndTimeFields} from '../trace-graph-accessors';
import {normalizeArrowRefNumber} from '../trace-graph/trace-graph-runtime-helpers';
import {
  getSpanRefChunkIndex,
  getSpanRefRowIndex,
  isProcessRef,
  isThreadRef
} from '../trace-graph/trace-id-encoder';

import type {ArrowTraceChunk} from '../ingestion/arrow-trace';
import type {ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
import type {SpanRef} from '../trace-graph/trace-types';
import type {TraceLayout} from '../trace-layout/trace-layout';

/** Existing synthetic duration used when a trusted primary row has not started. */
const TRACE_ARROW_NOT_STARTED_BLOCK_DURATION_MS = 1_000;
/** Existing fallback horizon used when a trusted unfinished row has no finite graph maximum. */
const TRACE_ARROW_NOT_FINISHED_BLOCK_END_TIME_DEFAULT = Number.MAX_SAFE_INTEGER;

/** Minimal borrowed Arrow scalar reader used by endpoint pages. */
export type TraceArrowEndpointColumn = {
  /** Reads one scalar value from a canonical Arrow row without materializing the row. */
  get(rowIndex: number): unknown;
};

/** Public Apache Arrow data fields needed to borrow one fixed-width value buffer. */
type TraceArrowFixedWidthData = {
  /** Number of logical rows represented by this Arrow data batch. */
  readonly length: number;
  /** Original Arrow row offset used by validity bitmaps and bit-packed columns. */
  readonly offset: number;
  /** Number of invalid rows in this batch after Arrow resolves any lazy null count. */
  readonly nullCount: number;
  /** Borrowed primitive value storage; direct readers validate its concrete typed-array class. */
  readonly values: unknown;
  /** Borrowed Arrow validity bitmap when the batch contains null rows. */
  readonly nullBitmap?: unknown;
};

/** Narrow Arrow column shape whose public data batches can be borrowed without copies. */
type TraceArrowFixedWidthColumn = TraceArrowEndpointColumn & {
  /** Public Arrow data batches backing this vector. */
  readonly data: ReadonlyArray<TraceArrowFixedWidthData>;
};

/** One borrowed fixed-width Arrow data batch plus its validity metadata. */
type TraceArrowFixedWidthBatch<TValues extends Float64Array | Uint8Array> = {
  /** Borrowed primitive values already sliced to this batch's local row zero. */
  readonly values: TValues;
  /** Number of logical rows represented by the borrowed values. */
  readonly length: number;
  /** Original Arrow row offset used only while checking validity bits. */
  readonly validityOffset: number;
  /** Borrowed validity bitmap, or null when every row is valid. */
  readonly nullBitmap: Uint8Array | null;
};

/** One aligned endpoint batch that borrows every hot fixed-width span column by identity. */
type TraceArrowPrimaryEndpointFixedWidthBatch = {
  /** Inclusive span-table row where this aligned batch starts. */
  readonly rowStart: number;
  /** Exclusive span-table row where this aligned batch ends. */
  readonly rowEnd: number;
  /** Borrowed canonical process-ref values for this aligned batch. */
  readonly processRef: TraceArrowFixedWidthBatch<Float64Array>;
  /** Borrowed canonical thread-ref values for this aligned batch. */
  readonly threadRef: TraceArrowFixedWidthBatch<Float64Array>;
  /** Borrowed compact primary timing-status values for this aligned batch. */
  readonly statusCode: TraceArrowFixedWidthBatch<Uint8Array>;
  /** Borrowed primary start-time values for this aligned batch. */
  readonly startTimeMs: TraceArrowFixedWidthBatch<Float64Array>;
  /** Borrowed primary source-end values for this aligned batch. */
  readonly endTimeMs: TraceArrowFixedWidthBatch<Float64Array>;
};

/**
 * One null-free endpoint batch trusted by dense dataset block and dependency writers.
 *
 * These borrowed values are deliberately separated from the general fixed-width batch shape:
 * once the table-level gate accepts them, the hot loop no longer carries validity metadata or
 * row-local null branches.
 */
export type TraceArrowTrustedPrimaryEndpointFixedWidthBatch = {
  /** Inclusive span-table row where this aligned batch starts. */
  readonly rowStart: number;
  /** Exclusive span-table row where this aligned batch ends. */
  readonly rowEnd: number;
  /** Borrowed canonical process-ref values for this aligned batch. */
  readonly processRef: Float64Array;
  /** Borrowed canonical thread-ref values for this aligned batch. */
  readonly threadRef: Float64Array;
  /** Borrowed compact primary timing-status values for this aligned batch. */
  readonly statusCode: Uint8Array;
  /** Borrowed primary start-time values for this aligned batch. */
  readonly startTimeMs: Float64Array;
  /** Borrowed primary source-end values for this aligned batch. */
  readonly endTimeMs: Float64Array;
};

/** One trusted endpoint page plus its null-free borrowed fixed-width batches. */
export type TraceArrowTrustedPrimaryEndpointPage = {
  /** Stable sparse chunk index encoded into endpoint span refs. */
  readonly chunkIndex: number;
  /** Existing layout-owned generated lane values aligned by chunk-local span-ref row. */
  readonly laneIndexBySpanRefRow: Int32Array;
  /** Null-free aligned endpoint batches borrowed from the canonical page. */
  readonly fixedWidthBatches: readonly TraceArrowTrustedPrimaryEndpointFixedWidthBatch[];
};

/**
 * Mutable batch-local cursor for trusted generated-primary endpoint reads.
 *
 * The cursor is intentionally ephemeral. It owns no Arrow table or copied values, and callers
 * discard it with the prepared binary write that created it.
 */
export type TraceArrowTrustedPrimaryEndpointCursor = {
  /** Trusted sparse endpoint pages keyed by canonical chunk index. */
  readonly pagesByChunkIndex: ReadonlyMap<number, TraceArrowTrustedPrimaryEndpointPage>;
  /** Timeline maximum used to resolve unfinished primary timing ends. */
  readonly maxTimeMs: number;
  /** Most recently bound sparse chunk index, or -1 before the first read. */
  currentChunkIndex: number;
  /** Most recently bound trusted endpoint page, or null before the first read. */
  currentPage: TraceArrowTrustedPrimaryEndpointPage | null;
  /** Most recently bound trusted endpoint batch, or null before the first read. */
  currentBatch: TraceArrowTrustedPrimaryEndpointFixedWidthBatch | null;
};

/**
 * One borrowed generated-primary endpoint page aligned to a canonical Arrow span chunk.
 *
 * The page owns no span data: every column is a borrowed Arrow vector and laneIndexBySpanRefRow
 * is the layout's existing generated-lane column. The page must remain batch-local to avoid
 * retaining Arrow tables or layout arrays after one render-data build.
 */
export type TraceArrowPrimaryEndpointPage = {
  /** Stable sparse chunk index encoded into endpoint span refs. */
  readonly chunkIndex: number;
  /** Borrowed canonical chunk used to resolve sparse span-ref slots into Arrow table rows. */
  readonly chunk: Readonly<ArrowTraceChunk>;
  /** Existing layout-owned generated lane values aligned by chunk-local span-ref row. */
  readonly laneIndexBySpanRefRow: Int32Array;
  /** Borrowed canonical process-ref Arrow column. */
  readonly processRefColumn: TraceArrowEndpointColumn;
  /** Borrowed canonical thread-ref Arrow column. */
  readonly threadRefColumn: TraceArrowEndpointColumn;
  /** Borrowed compact primary timing-status Arrow column. */
  readonly statusCodeColumn: TraceArrowEndpointColumn;
  /** Borrowed primary timing start Arrow column. */
  readonly startTimeMsColumn: TraceArrowEndpointColumn;
  /** Borrowed primary timing source-end Arrow column. */
  readonly endTimeMsColumn: TraceArrowEndpointColumn;
  /**
   * Optional aligned borrowed fixed-width batches for direct endpoint reads.
   *
   * Null preserves the existing scalar-vector fallback when Arrow vectors are unsupported or
   * their batch boundaries do not align. These batches borrow values only for this render build.
   */
  readonly fixedWidthBatches: readonly TraceArrowPrimaryEndpointFixedWidthBatch[] | null;
};

/**
 * Batch-local sparse directory of borrowed generated-primary endpoint pages.
 *
 * This is deliberately a per-chunk map rather than a per-span map: a SpanRef already encodes
 * the sparse chunk index and chunk-local row needed for direct lookup.
 */
export type TraceArrowPrimaryEndpointPages = {
  /** Borrowed endpoint pages keyed by stable sparse chunk index. */
  readonly pagesByChunkIndex: ReadonlyMap<number, TraceArrowPrimaryEndpointPage>;
  /** Timeline maximum used to resolve unfinished primary timing ends. */
  readonly maxTimeMs: number;
};

/** Caller-owned mutable raw endpoint fields filled without allocating one object per span ref. */
export type TraceArrowPrimaryEndpointFields = {
  /** Canonical process ref for the endpoint row, or null after a failed fill. */
  processRef: ProcessRef | null;
  /** Canonical thread ref for the endpoint row, or null after a failed fill. */
  threadRef: ThreadRef | null;
  /** Generated lane index for the endpoint row; -1 remains a valid unassigned sentinel. */
  laneIndex: number;
  /** Finite primary timing start in milliseconds. */
  startTimeMs: number;
  /** Finite resolved primary timing end in milliseconds. */
  endTimeMs: number;
  /** Finite canonical source-end timing before unfinished-span resolution. */
  sourceEndTimeMs: number;
};

/** Successfully resolved caller-owned raw endpoint fields. */
export type ResolvedTraceArrowPrimaryEndpointFields = {
  /** Canonical process ref for the endpoint row. */
  processRef: ProcessRef;
  /** Canonical thread ref for the endpoint row. */
  threadRef: ThreadRef;
  /** Generated lane index for the endpoint row; -1 remains a valid unassigned sentinel. */
  laneIndex: number;
  /** Finite primary timing start in milliseconds. */
  startTimeMs: number;
  /** Finite resolved primary timing end in milliseconds. */
  endTimeMs: number;
  /** Finite canonical source-end timing before unfinished-span resolution. */
  sourceEndTimeMs: number;
};

/**
 * Builds one ephemeral sparse directory of borrowed Arrow endpoint pages for a render batch.
 *
 * Unfiltered generated-primary auto layouts are supported by default. A direct row writer may
 * explicitly allow immutable text/source snapshot masks because those filters hide rows without
 * rewriting endpoints; topology filters still return null. Manual layouts need authored vertical
 * geometry, and requested non-primary timings need different columns, so those
 * cases preserve the complete accessor-based path. Primary reads intentionally ignore unrelated
 * sidecar timing projections.
 *
 * @param traceLayout Current trace layout whose graph chunks and generated lane columns are bound.
 * @param options Narrow opt-in for direct writers that skip row-local snapshot masks themselves.
 * @returns Borrowed sparse endpoint pages, or null when the layout needs the generic path.
 */
export function buildTraceArrowPrimaryEndpointPages(
  traceLayout: Readonly<TraceLayout>,
  options: {
    /**
     * Permit immutable snapshot filters whose mask rows are skipped by caller.
     */
    readonly allowRowLocalSnapshotFilters?: boolean;
  } = {}
): TraceArrowPrimaryEndpointPages | null {
  const traceGraph = traceLayout.traceGraph;
  const laneColumnsByChunkIndex = traceLayout.spanLaneColumnsByChunkIndex;
  const hasUnsupportedActiveSpanFilter =
    traceGraph.hasActiveSpanFilter() && !options.allowRowLocalSnapshotFilters;
  if (
    hasUnsupportedActiveSpanFilter ||
    traceGraph.spanLayout !== 'auto' ||
    traceLayout.layoutConfiguration?.timingKey != null ||
    laneColumnsByChunkIndex == null
  ) {
    return null;
  }

  const pagesByChunkIndex = new Map<number, TraceArrowPrimaryEndpointPage>();
  for (const chunk of traceGraph.chunks) {
    if (chunk.spanTable.numRows === 0) {
      continue;
    }

    const laneColumn = laneColumnsByChunkIndex.get(chunk.chunkIndex);
    if (!laneColumn || pagesByChunkIndex.has(chunk.chunkIndex)) {
      return null;
    }

    const processRefColumn = chunk.spanTable.getChild('process_ref');
    const threadRefColumn = chunk.spanTable.getChild('thread_ref');
    const statusCodeColumn = chunk.spanTable.getChild('status_code');
    const startTimeMsColumn = chunk.spanTable.getChild('start_time_ms');
    const endTimeMsColumn = chunk.spanTable.getChild('end_time_ms');
    if (
      !processRefColumn ||
      !threadRefColumn ||
      !statusCodeColumn ||
      !startTimeMsColumn ||
      !endTimeMsColumn
    ) {
      return null;
    }

    pagesByChunkIndex.set(chunk.chunkIndex, {
      chunkIndex: chunk.chunkIndex,
      chunk,
      laneIndexBySpanRefRow: laneColumn.values,
      processRefColumn,
      threadRefColumn,
      statusCodeColumn,
      startTimeMsColumn,
      endTimeMsColumn,
      fixedWidthBatches: buildTraceArrowPrimaryEndpointFixedWidthBatches({
        rowCount: chunk.spanTable.numRows,
        processRefColumn,
        threadRefColumn,
        statusCodeColumn,
        startTimeMsColumn,
        endTimeMsColumn
      })
    });
  }

  return {
    pagesByChunkIndex,
    maxTimeMs: traceGraph.maxTimeMs
  };
}

/**
 * Creates one null-free raw endpoint cursor for a trusted dense dataset traversal.
 *
 * The gate is deliberately page-wide: one nullable, sliced, or unsupported endpoint batch keeps
 * the complete dependency table on the existing checked reader. Accepted cursors retain only the
 * current render build's borrowed pages and never become a graph or scene cache.
 *
 * @param pages Batch-local borrowed endpoint pages created for the current generated layout.
 * @returns Ephemeral trusted cursor, or null when any page needs checked endpoint reads.
 */
export function createTraceArrowTrustedPrimaryEndpointCursor(
  pages: TraceArrowPrimaryEndpointPages
): TraceArrowTrustedPrimaryEndpointCursor | null {
  const pagesByChunkIndex = new Map<number, TraceArrowTrustedPrimaryEndpointPage>();
  for (const [chunkIndex, page] of pages.pagesByChunkIndex) {
    const fixedWidthBatches = buildTraceArrowTrustedPrimaryEndpointFixedWidthBatches(page);
    if (!fixedWidthBatches) {
      return null;
    }
    pagesByChunkIndex.set(chunkIndex, {
      chunkIndex,
      laneIndexBySpanRefRow: page.laneIndexBySpanRefRow,
      fixedWidthBatches
    });
  }

  return {
    pagesByChunkIndex,
    maxTimeMs: pages.maxTimeMs,
    currentChunkIndex: -1,
    currentPage: null,
    currentBatch: null
  };
}

/**
 * Binds one trusted cursor to a canonical chunk-local endpoint row.
 *
 * Callers read only the raw borrowed fields they need from currentPage and currentBatch after this
 * returns. Missing pages or batches indicate a violated finalized-dataset invariant and throw
 * instead of adding a row-local fallback branch to the dense loop.
 *
 * @param cursor Ephemeral cursor accepted by createTraceArrowTrustedPrimaryEndpointCursor.
 * @param chunkIndex Canonical sparse chunk index already decoded or owned by a dense range.
 * @param spanRefRowIndex Canonical chunk-local span row already decoded or owned by a dense range.
 * @returns Batch-local row index used to read the cursor's current borrowed arrays.
 */
export function bindTraceArrowTrustedPrimaryEndpointCursorRow(
  cursor: TraceArrowTrustedPrimaryEndpointCursor,
  chunkIndex: number,
  spanRefRowIndex: number
): number {
  let page = cursor.currentPage;
  if (cursor.currentChunkIndex !== chunkIndex || page == null) {
    page = cursor.pagesByChunkIndex.get(chunkIndex) ?? null;
    if (!page) {
      throw new Error('Trusted endpoint cursor received a span ref for an unbound chunk.');
    }
    cursor.currentChunkIndex = chunkIndex;
    cursor.currentPage = page;
    cursor.currentBatch = null;
  }

  let batch = cursor.currentBatch;
  if (!batch || spanRefRowIndex < batch.rowStart || spanRefRowIndex >= batch.rowEnd) {
    batch = findTraceArrowTrustedPrimaryEndpointFixedWidthBatch(
      page.fixedWidthBatches,
      spanRefRowIndex
    );
    if (!batch) {
      throw new Error('Trusted endpoint cursor received a span ref outside its bound batches.');
    }
    cursor.currentBatch = batch;
  }

  return spanRefRowIndex - batch.rowStart;
}

/**
 * Resolves one trusted primary timing end from canonical numeric status fields.
 *
 * The trusted dataset gate already proves finite start/source-end values and the closed status
 * domain. Keeping the numeric status code here avoids decoding one string status and constructing
 * broad endpoint fields in each binary row loop while preserving the checked resolver's timing
 * semantics.
 *
 * @param statusCode Canonical primary timing status code: 0, 1, or 2.
 * @param startTimeMs Finite canonical primary start time.
 * @param sourceEndTimeMs Finite canonical source-end time before unfinished resolution.
 * @param maxTimeMs Current graph maximum used by unfinished timing resolution.
 * @returns Resolved finite primary timing end.
 */
export function resolveTraceArrowTrustedPrimaryEndpointEndTime(
  statusCode: number,
  startTimeMs: number,
  sourceEndTimeMs: number,
  maxTimeMs: number
): number {
  if (sourceEndTimeMs > startTimeMs) {
    return sourceEndTimeMs;
  }
  if (statusCode === 1) {
    const unfinishedEnd = Number.isFinite(maxTimeMs)
      ? Math.max(maxTimeMs, startTimeMs)
      : TRACE_ARROW_NOT_FINISHED_BLOCK_END_TIME_DEFAULT;
    return Math.max(unfinishedEnd, startTimeMs + 1);
  }
  if (statusCode === 0) {
    return startTimeMs + TRACE_ARROW_NOT_STARTED_BLOCK_DURATION_MS;
  }
  if (statusCode === 2) {
    return startTimeMs;
  }
  throw new Error('Trusted endpoint cursor received an invalid canonical timing status.');
}

/**
 * Fills caller-owned raw generated-primary endpoint fields from one packed span ref.
 *
 * The returned fields are sufficient for same-process dependency geometry: callers can compare
 * processRef, resolve owner layouts from threadRef, select a lane Y from laneIndex, and choose
 * start/end timestamps by wait mode without materializing a span object. A false return clears
 * the target and tells the caller to use the generic path for unsupported or malformed endpoint
 * rows.
 *
 * @param pages Batch-local borrowed endpoint pages for the current layout.
 * @param spanRef Exact canonical endpoint span ref to decode.
 * @param target Caller-owned mutable endpoint fields to fill or clear.
 * @returns Whether the target contains validated generated-primary endpoint fields.
 */
export function fillTraceArrowPrimaryEndpointFields(
  pages: TraceArrowPrimaryEndpointPages,
  spanRef: SpanRef,
  target: TraceArrowPrimaryEndpointFields
): target is ResolvedTraceArrowPrimaryEndpointFields {
  const page = pages.pagesByChunkIndex.get(getSpanRefChunkIndex(spanRef));
  const spanRefRowIndex = getSpanRefRowIndex(spanRef);
  return page
    ? fillTraceArrowPrimaryEndpointFieldsFromPageRow(pages, page, spanRefRowIndex, target)
    : clearAndFailTraceArrowPrimaryEndpointFields(target);
}

/**
 * Fills caller-owned generated-primary fields from one already-bound chunk page and span-ref row.
 *
 * Sequential block writers bind the page once while traversing one chunk, so this seam avoids a
 * repeated sparse-page map lookup while preserving the same borrowed fixed-width reads and
 * row-local scalar fallback used by {@link fillTraceArrowPrimaryEndpointFields}.
 *
 * @param pages Batch-local borrowed endpoint pages owning the maximum timing bound.
 * @param page Already-bound borrowed page for the current sparse span-ref chunk.
 * @param spanRefRowIndex Chunk-local span-ref row encoded by the caller's span ref.
 * @param target Caller-owned mutable endpoint fields filled or cleared by this read.
 * @returns Whether the target contains validated generated-primary endpoint fields.
 */
export function fillTraceArrowPrimaryEndpointFieldsFromPageRow(
  pages: TraceArrowPrimaryEndpointPages,
  page: TraceArrowPrimaryEndpointPage,
  spanRefRowIndex: number,
  target: TraceArrowPrimaryEndpointFields
): target is ResolvedTraceArrowPrimaryEndpointFields {
  clearTraceArrowPrimaryEndpointFields(target);
  if (spanRefRowIndex < 0 || spanRefRowIndex >= page.laneIndexBySpanRefRow.length) {
    return false;
  }
  const rowIndex = getArrowTraceChunkSpanTableRowIndex(page.chunk, spanRefRowIndex);
  if (rowIndex == null) {
    return false;
  }

  const fixedWidthBatch = findTraceArrowPrimaryEndpointFixedWidthBatch(
    page.fixedWidthBatches,
    rowIndex
  );
  const fixedWidthRowIndex = fixedWidthBatch ? rowIndex - fixedWidthBatch.rowStart : -1;
  const processRefValue = normalizeArrowRefNumber(
    fixedWidthBatch
      ? readTraceArrowFixedWidthValue(fixedWidthBatch.processRef, fixedWidthRowIndex)
      : page.processRefColumn.get(rowIndex)
  );
  const threadRefValue = normalizeArrowRefNumber(
    fixedWidthBatch
      ? readTraceArrowFixedWidthValue(fixedWidthBatch.threadRef, fixedWidthRowIndex)
      : page.threadRefColumn.get(rowIndex)
  );
  const status = decodeTraceSpanTimingStatusCode(
    fixedWidthBatch
      ? readTraceArrowFixedWidthValue(fixedWidthBatch.statusCode, fixedWidthRowIndex)
      : page.statusCodeColumn.get(rowIndex)
  );
  const startTimeMs = normalizeArrowNumber(
    fixedWidthBatch
      ? readTraceArrowFixedWidthValue(fixedWidthBatch.startTimeMs, fixedWidthRowIndex)
      : page.startTimeMsColumn.get(rowIndex)
  );
  const sourceEndTimeMs = normalizeArrowNumber(
    fixedWidthBatch
      ? readTraceArrowFixedWidthValue(fixedWidthBatch.endTimeMs, fixedWidthRowIndex)
      : page.endTimeMsColumn.get(rowIndex)
  );
  const laneIndex = page.laneIndexBySpanRefRow[spanRefRowIndex];
  if (
    processRefValue == null ||
    threadRefValue == null ||
    !isProcessRef(processRefValue) ||
    !isThreadRef(threadRefValue) ||
    status == null ||
    startTimeMs == null ||
    sourceEndTimeMs == null ||
    laneIndex == null ||
    !Number.isInteger(laneIndex) ||
    laneIndex < -1
  ) {
    return false;
  }

  const endTimeMs = resolveTraceSpanTimingEndTimeFields(
    status,
    startTimeMs,
    sourceEndTimeMs,
    pages.maxTimeMs
  );
  if (!Number.isFinite(endTimeMs)) {
    return false;
  }

  target.processRef = processRefValue;
  target.threadRef = threadRefValue;
  target.laneIndex = laneIndex;
  target.startTimeMs = startTimeMs;
  target.endTimeMs = endTimeMs;
  target.sourceEndTimeMs = sourceEndTimeMs;
  return true;
}

/**
 * Binds aligned borrowed fixed-width endpoint batches without copying Arrow values.
 *
 * Every fixed-width column must expose the public Arrow `Vector.data` shape and share the same
 * batch row boundaries. If one column is unsupported or misaligned, callers keep the existing
 * scalar-vector path for the whole page instead of mixing row semantics inside the hot loop.
 */
function buildTraceArrowPrimaryEndpointFixedWidthBatches(params: {
  /** Number of canonical span-table rows represented by the candidate columns. */
  readonly rowCount: number;
  /** Borrowed canonical process-ref Arrow column. */
  readonly processRefColumn: TraceArrowEndpointColumn;
  /** Borrowed canonical thread-ref Arrow column. */
  readonly threadRefColumn: TraceArrowEndpointColumn;
  /** Borrowed compact primary timing-status Arrow column. */
  readonly statusCodeColumn: TraceArrowEndpointColumn;
  /** Borrowed primary timing start Arrow column. */
  readonly startTimeMsColumn: TraceArrowEndpointColumn;
  /** Borrowed primary timing source-end Arrow column. */
  readonly endTimeMsColumn: TraceArrowEndpointColumn;
}): readonly TraceArrowPrimaryEndpointFixedWidthBatch[] | null {
  const processRefData = getTraceArrowFixedWidthColumnData(params.processRefColumn);
  const threadRefData = getTraceArrowFixedWidthColumnData(params.threadRefColumn);
  const statusCodeData = getTraceArrowFixedWidthColumnData(params.statusCodeColumn);
  const startTimeMsData = getTraceArrowFixedWidthColumnData(params.startTimeMsColumn);
  const endTimeMsData = getTraceArrowFixedWidthColumnData(params.endTimeMsColumn);
  if (
    !processRefData ||
    !threadRefData ||
    !statusCodeData ||
    !startTimeMsData ||
    !endTimeMsData ||
    processRefData.length !== threadRefData.length ||
    processRefData.length !== statusCodeData.length ||
    processRefData.length !== startTimeMsData.length ||
    processRefData.length !== endTimeMsData.length
  ) {
    return null;
  }

  const batches: TraceArrowPrimaryEndpointFixedWidthBatch[] = [];
  let rowStart = 0;
  for (let batchIndex = 0; batchIndex < processRefData.length; batchIndex += 1) {
    const processRef = buildTraceArrowFloat64FixedWidthBatch(processRefData[batchIndex]);
    const threadRef = buildTraceArrowFloat64FixedWidthBatch(threadRefData[batchIndex]);
    const statusCode = buildTraceArrowUint8FixedWidthBatch(statusCodeData[batchIndex]);
    const startTimeMs = buildTraceArrowFloat64FixedWidthBatch(startTimeMsData[batchIndex]);
    const endTimeMs = buildTraceArrowFloat64FixedWidthBatch(endTimeMsData[batchIndex]);
    if (
      !processRef ||
      !threadRef ||
      !statusCode ||
      !startTimeMs ||
      !endTimeMs ||
      processRef.length !== threadRef.length ||
      processRef.length !== statusCode.length ||
      processRef.length !== startTimeMs.length ||
      processRef.length !== endTimeMs.length
    ) {
      return null;
    }
    const rowEnd = rowStart + processRef.length;
    batches.push({rowStart, rowEnd, processRef, threadRef, statusCode, startTimeMs, endTimeMs});
    rowStart = rowEnd;
  }

  return rowStart === params.rowCount ? batches : null;
}

/**
 * Narrows one checked endpoint page into null-free offset-zero batches for the trusted cursor.
 *
 * Sliced or nullable batches remain valid inputs for the checked reader, but rejecting them here
 * keeps the trusted cursor's inner read to direct typed-array indexing.
 */
function buildTraceArrowTrustedPrimaryEndpointFixedWidthBatches(
  page: TraceArrowPrimaryEndpointPage
): readonly TraceArrowTrustedPrimaryEndpointFixedWidthBatch[] | null {
  const fixedWidthBatches = page.fixedWidthBatches;
  if (
    !fixedWidthBatches ||
    fixedWidthBatches.length === 0 ||
    page.laneIndexBySpanRefRow.length !== page.chunk.spanTable.numRows
  ) {
    return null;
  }

  const trustedBatches: TraceArrowTrustedPrimaryEndpointFixedWidthBatch[] = [];
  for (const batch of fixedWidthBatches) {
    if (
      !isTraceArrowNullFreeOffsetZeroBatch(batch.processRef) ||
      !isTraceArrowNullFreeOffsetZeroBatch(batch.threadRef) ||
      !isTraceArrowNullFreeOffsetZeroBatch(batch.statusCode) ||
      !isTraceArrowNullFreeOffsetZeroBatch(batch.startTimeMs) ||
      !isTraceArrowNullFreeOffsetZeroBatch(batch.endTimeMs)
    ) {
      return null;
    }
    trustedBatches.push({
      rowStart: batch.rowStart,
      rowEnd: batch.rowEnd,
      processRef: batch.processRef.values,
      threadRef: batch.threadRef.values,
      statusCode: batch.statusCode.values,
      startTimeMs: batch.startTimeMs.values,
      endTimeMs: batch.endTimeMs.values
    });
  }
  return trustedBatches;
}

/** Returns whether one checked fixed-width batch can be read without validity metadata. */
function isTraceArrowNullFreeOffsetZeroBatch(
  batch: TraceArrowFixedWidthBatch<Float64Array | Uint8Array>
): boolean {
  return batch.nullBitmap == null && batch.validityOffset === 0;
}

/** Finds one trusted endpoint batch after the cursor crosses a record-batch boundary. */
function findTraceArrowTrustedPrimaryEndpointFixedWidthBatch(
  batches: readonly TraceArrowTrustedPrimaryEndpointFixedWidthBatch[],
  rowIndex: number
): TraceArrowTrustedPrimaryEndpointFixedWidthBatch | null {
  let lowerBound = 0;
  let upperBound = batches.length - 1;
  while (lowerBound <= upperBound) {
    const middleIndex = lowerBound + Math.floor((upperBound - lowerBound) / 2);
    const batch = batches[middleIndex];
    if (!batch) {
      return null;
    }
    if (rowIndex < batch.rowStart) {
      upperBound = middleIndex - 1;
      continue;
    }
    if (rowIndex >= batch.rowEnd) {
      lowerBound = middleIndex + 1;
      continue;
    }
    return batch;
  }
  return null;
}

/** Returns the public Arrow data batches from one vector-shaped endpoint column. */
function getTraceArrowFixedWidthColumnData(
  column: TraceArrowEndpointColumn
): readonly TraceArrowFixedWidthData[] | null {
  const data = (column as Partial<TraceArrowFixedWidthColumn>).data;
  return Array.isArray(data) && data.length > 0 ? data : null;
}

/** Binds one borrowed canonical Uint8 batch when its Arrow data shape is safe. */
function buildTraceArrowUint8FixedWidthBatch(
  data: TraceArrowFixedWidthData | undefined
): TraceArrowFixedWidthBatch<Uint8Array> | null {
  return buildTraceArrowFixedWidthBatch(data, isUint8Array);
}

/** Binds one borrowed canonical Float64 batch when its Arrow data shape is safe. */
function buildTraceArrowFloat64FixedWidthBatch(
  data: TraceArrowFixedWidthData | undefined
): TraceArrowFixedWidthBatch<Float64Array> | null {
  return buildTraceArrowFixedWidthBatch(data, isFloat64Array);
}

/** Validates one public Arrow data batch and borrows its fixed-width values by identity. */
function buildTraceArrowFixedWidthBatch<TValues extends Float64Array | Uint8Array>(
  data: TraceArrowFixedWidthData | undefined,
  isValues: (value: unknown) => value is TValues
): TraceArrowFixedWidthBatch<TValues> | null {
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
    data.values.length < data.length
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

  return {
    values: data.values,
    length: data.length,
    validityOffset: data.offset,
    nullBitmap
  };
}

/** Returns whether a borrowed Arrow value buffer is the expected Uint8 representation. */
function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

/** Returns whether a borrowed Arrow value buffer is the expected Float64 representation. */
function isFloat64Array(value: unknown): value is Float64Array {
  return value instanceof Float64Array;
}

/** Finds the aligned fixed-width batch containing one canonical span-table row. */
function findTraceArrowPrimaryEndpointFixedWidthBatch(
  batches: readonly TraceArrowPrimaryEndpointFixedWidthBatch[] | null,
  rowIndex: number
): TraceArrowPrimaryEndpointFixedWidthBatch | null {
  if (!batches || batches.length === 0 || rowIndex < 0) {
    return null;
  }
  const firstBatch = batches[0];
  if (firstBatch && rowIndex >= firstBatch.rowStart && rowIndex < firstBatch.rowEnd) {
    return firstBatch;
  }

  let lowerBound = 1;
  let upperBound = batches.length - 1;
  while (lowerBound <= upperBound) {
    const middleIndex = lowerBound + Math.floor((upperBound - lowerBound) / 2);
    const batch = batches[middleIndex];
    if (!batch) {
      return null;
    }
    if (rowIndex < batch.rowStart) {
      upperBound = middleIndex - 1;
      continue;
    }
    if (rowIndex >= batch.rowEnd) {
      lowerBound = middleIndex + 1;
      continue;
    }
    return batch;
  }
  return null;
}

/** Reads one fixed-width cell directly from borrowed Arrow values and validity metadata. */
function readTraceArrowFixedWidthValue<TValues extends Float64Array | Uint8Array>(
  batch: TraceArrowFixedWidthBatch<TValues>,
  rowIndex: number
): TValues[number] | null {
  if (rowIndex < 0 || rowIndex >= batch.length) {
    return null;
  }
  if (batch.nullBitmap) {
    const validityIndex = batch.validityOffset + rowIndex;
    if ((batch.nullBitmap[validityIndex >> 3]! & (1 << (validityIndex & 7))) === 0) {
      return null;
    }
  }
  return batch.values[rowIndex] ?? null;
}

/** Returns one Arrow numeric cell as a finite JavaScript number. */
function normalizeArrowNumber(value: unknown): number | null {
  const numberValue =
    typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : null;
  return numberValue != null && Number.isFinite(numberValue) ? numberValue : null;
}

/** Clears one failed caller-owned endpoint target so stale fields cannot leak to geometry. */
function clearTraceArrowPrimaryEndpointFields(target: TraceArrowPrimaryEndpointFields): void {
  target.processRef = null;
  target.threadRef = null;
  target.laneIndex = -1;
  target.startTimeMs = 0;
  target.endTimeMs = 0;
  target.sourceEndTimeMs = 0;
}

/** Clears one failed target and returns the false sentinel expected by endpoint readers. */
function clearAndFailTraceArrowPrimaryEndpointFields(
  target: TraceArrowPrimaryEndpointFields
): false {
  clearTraceArrowPrimaryEndpointFields(target);
  return false;
}
