import {
  encodeCrossProcessDependencyRef,
  encodeLocalSpanRef,
  encodeSameProcessDependencyRef,
  encodeSpanRef,
  getSpanRefChunkIndex,
  getSpanRefRowIndex,
  isSpanRef,
  MAX_SAME_PROCESS_DEPENDENCY_REF_PROCESS_INDEX,
  MAX_SPAN_REF_ROW_INDEX
} from '../trace-graph/trace-id-encoder';
import {getTraceViewChunkFilterMask} from '../trace-view-snapshot';
import {buildTraceDenseDependencyFixedWidthEndpointBatchesForTable} from './trace-dense-dependency-fixed-width';

import type {ArrowTraceSameProcessDependencyTable} from '../ingestion/arrow-trace';
import type {TraceGraph} from '../trace-graph/trace-graph';
import type {
  CrossProcessDependencyRef,
  SameProcessDependencyRef
} from '../trace-graph/trace-id-encoder';
import type {SpanRef} from '../trace-graph/trace-types';
import type {TraceRefSource} from '../trace-ref-source';
import type {TraceViewSnapshot} from '../trace-view-snapshot';
import type {TraceDenseDependencyFixedWidthEndpointBatch} from './trace-dense-dependency-fixed-width';

/**
 * One contiguous canonical chunk-row range represented by a dense span-ref source.
 *
 * The range stores numeric bounds plus an optional borrowed snapshot mask. It deliberately does
 * not retain Arrow tables, pages, graph objects, or one JavaScript value per span.
 */
export type TraceDenseSpanRefRange = {
  /** Stable canonical chunk index encoded into every span ref in this range. */
  readonly chunkIndex: number;
  /** First canonical chunk row represented by this range. */
  readonly rowStart: number;
  /** Number of consecutive canonical chunk rows represented by this range. */
  readonly rowCount: number;
  /** First prepared-output row represented by this range. */
  readonly outputStart: number;
  /**
   * Number of visible prepared-output rows represented by this canonical range.
   *
   * Unmasked ranges omit this field because every canonical row is visible and rowCount already
   * carries the same value. Masked ranges retain one number per range, never one JavaScript
   * value per row.
   */
  readonly visibleRowCount?: number;
  /**
   * Optional borrowed visibility mask aligned by canonical chunk-local row.
   *
   * Zero keeps a row visible and any nonzero filter provenance mask hides it. The source borrows
   * this typed column by identity; it never clones the mask or expands it into a ref array.
   */
  readonly filterMaskByRow?: Readonly<Uint8Array>;
};

/**
 * Span-ref sequence consumed by prepared rows and deck-layer row sources.
 *
 * Array inputs structurally satisfy this narrow contract through length, at, and iteration,
 * while dense prepared rows can replace their per-span array with range descriptors and borrowed
 * snapshot masks.
 */
export type TraceSpanRefSource = TraceRefSource<SpanRef> & {
  /**
   * Optional dense canonical ranges available to direct Arrow writers.
   *
   * Ordinary fallback arrays omit this field. A range-backed source owns only these numeric
   * descriptors and synthesizes a packed ref when random access or iteration asks for one.
   */
  readonly denseRanges?: readonly TraceDenseSpanRefRange[];
};

/**
 * Same-process dependency-ref sequence consumed by prepared rows and deck-layer row sources.
 *
 * Array inputs preserve filtered and non-canonical fallback semantics. Dense sources retain one
 * process index, plus borrowed table/snapshot identity only for mask-compacted text/source rows,
 * and synthesize a canonical ref when picking or a checked fallback actually asks for one.
 */
export type TraceSameProcessDependencyRefSource = TraceRefSource<SameProcessDependencyRef> & {
  /**
   * Stable process index for a dense canonical table-order source.
   *
   * Undefined means the source is an ordinary fallback sequence. Unmasked dense sources retain no
   * Arrow table or row-index array; masked sources retain the borrowed table in denseVisibility.
   */
  readonly denseProcessIndex?: number;
  /**
   * Optional borrowed canonical table and text/source-only visibility snapshot.
   *
   * Masked dense sources retain these two existing columnar owners instead of one JavaScript
   * dependency ref or row index per visible edge. Direct binary writers can stream canonical
   * endpoint masks for ordinary and PARENT rows alike because filtered rendering never rewrites
   * dependency endpoints. Unmasked sources omit this field and preserve their original O(1)
   * numeric-only shape.
   */
  readonly denseVisibility?: TraceDenseSameProcessDependencyRefVisibility;
};

/**
 * Cross-process dependency-ref sequence consumed by prepared scenes and deck layers.
 *
 * Canonical unfiltered sources are O(1) numeric descriptors. Filtered sources borrow the owning
 * graph/view snapshot and stream its canonical visibility iterator, retaining no JavaScript ref
 * array or row-index cache.
 */
export type TraceCrossProcessDependencyRefSource = TraceRefSource<CrossProcessDependencyRef>;

/**
 * Builds an immutable visible cross-process dependency-ref source for one graph snapshot.
 *
 * Unfiltered graphs synthesize canonical table-order refs by index. Filtered graphs count once at
 * construction and then rescan the graph's existing visibility iterator only when a consumer asks
 * to iterate or randomly access the sparse source; prepared binary writers consume the iterator
 * directly, so the normal render path never performs random-access rescans.
 */
export function buildTraceVisibleCrossProcessDependencyRefSource(
  traceGraph: Pick<
    TraceGraph,
    | 'crossProcessDependencyTable'
    | 'hasActiveSpanFilter'
    | 'iterateVisibleCrossProcessDependencyRefs'
  >
): TraceCrossProcessDependencyRefSource {
  if (!traceGraph.hasActiveSpanFilter()) {
    const rowCount = traceGraph.crossProcessDependencyTable.numRows;
    return Object.freeze({
      length: rowCount,
      at(index: number): CrossProcessDependencyRef | undefined {
        return Number.isSafeInteger(index) && index >= 0 && index < rowCount
          ? encodeCrossProcessDependencyRef(index)
          : undefined;
      },
      *[Symbol.iterator](): Iterator<CrossProcessDependencyRef> {
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          yield encodeCrossProcessDependencyRef(rowIndex);
        }
      }
    } satisfies TraceCrossProcessDependencyRefSource);
  }

  let length = 0;
  for (const _dependencyRef of traceGraph.iterateVisibleCrossProcessDependencyRefs()) {
    length += 1;
  }
  return Object.freeze({
    length,
    at(index: number): CrossProcessDependencyRef | undefined {
      if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
        return undefined;
      }
      let visibleIndex = 0;
      for (const dependencyRef of traceGraph.iterateVisibleCrossProcessDependencyRefs()) {
        if (visibleIndex === index) {
          return dependencyRef;
        }
        visibleIndex += 1;
      }
      return undefined;
    },
    *[Symbol.iterator](): Iterator<CrossProcessDependencyRef> {
      yield* traceGraph.iterateVisibleCrossProcessDependencyRefs();
    }
  } satisfies TraceCrossProcessDependencyRefSource);
}

/**
 * Borrowed inputs needed to compact one canonical dependency table by visible endpoint masks.
 *
 * Topology snapshots are rejected because they can stitch or rewrite dependency endpoints; this
 * descriptor is deliberately limited to text/source-only row drops.
 */
export type TraceDenseSameProcessDependencyRefVisibility = {
  /** Borrowed canonical same-process dependency table in dense process-local row order. */
  readonly dependencyTable: Readonly<ArrowTraceSameProcessDependencyTable>;
  /** Borrowed immutable text/source-only snapshot used to test both endpoint span refs. */
  readonly traceViewSnapshot: Readonly<TraceViewSnapshot>;
};

/**
 * Builds an immutable O(ranges) source for contiguous canonical chunk rows.
 *
 * The caller must supply ranges in ascending canonical chunk order. Invalid or duplicate
 * descriptors are rejected so binary writers can trust the source without row-local checks.
 */
export function buildTraceDenseSpanRefSource(
  ranges: readonly Omit<TraceDenseSpanRefRange, 'outputStart' | 'visibleRowCount'>[]
): TraceSpanRefSource {
  let length = 0;
  let previousChunkIndex = -1;
  const denseRanges: TraceDenseSpanRefRange[] = [];

  for (const range of ranges) {
    const rowEnd = range.rowStart + range.rowCount;
    const filterMaskByRow = range.filterMaskByRow;
    if (
      !Number.isSafeInteger(range.chunkIndex) ||
      range.chunkIndex < 0 ||
      !Number.isSafeInteger(range.rowStart) ||
      range.rowStart < 0 ||
      !Number.isSafeInteger(range.rowCount) ||
      range.rowCount <= 0 ||
      !Number.isSafeInteger(rowEnd) ||
      range.chunkIndex <= previousChunkIndex
    ) {
      throw new Error('Dense span-ref ranges must be positive, canonical, and chunk-sorted.');
    }
    if (
      filterMaskByRow != null &&
      (!(filterMaskByRow instanceof Uint8Array) || filterMaskByRow.length < rowEnd)
    ) {
      throw new Error('Dense span-ref filter masks must cover their canonical chunk range.');
    }

    const visibleRowCount =
      filterMaskByRow == null
        ? range.rowCount
        : countTraceDenseSpanRefVisibleRows(range, filterMaskByRow);
    if (!Number.isSafeInteger(length + visibleRowCount)) {
      throw new Error('Dense span-ref ranges must be positive, canonical, and chunk-sorted.');
    }
    if (visibleRowCount > 0) {
      denseRanges.push(
        filterMaskByRow == null
          ? Object.freeze({
              chunkIndex: range.chunkIndex,
              rowStart: range.rowStart,
              rowCount: range.rowCount,
              outputStart: length
            })
          : Object.freeze({
              chunkIndex: range.chunkIndex,
              rowStart: range.rowStart,
              rowCount: range.rowCount,
              outputStart: length,
              visibleRowCount,
              filterMaskByRow
            })
      );
      length += visibleRowCount;
    }
    previousChunkIndex = range.chunkIndex;
  }

  const frozenRanges = Object.freeze(denseRanges);
  return Object.freeze({
    length,
    denseRanges: frozenRanges,
    at(index: number): SpanRef | undefined {
      if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
        return undefined;
      }
      const range = findTraceDenseSpanRefRange(frozenRanges, index);
      if (!range) {
        return undefined;
      }
      const rowIndex = getTraceDenseSpanRefRangeVisibleRowIndex(range, index - range.outputStart);
      return rowIndex == null ? undefined : encodeSpanRef(range.chunkIndex, rowIndex);
    },
    *[Symbol.iterator](): Iterator<SpanRef> {
      for (const range of frozenRanges) {
        const filterMaskByRow = range.filterMaskByRow;
        const rowEnd = range.rowStart + range.rowCount;
        for (let rowIndex = range.rowStart; rowIndex < rowEnd; rowIndex += 1) {
          if (filterMaskByRow == null || filterMaskByRow[rowIndex] === 0) {
            yield encodeSpanRef(range.chunkIndex, rowIndex);
          }
        }
      }
    }
  } satisfies TraceSpanRefSource);
}

/**
 * Builds an immutable source for one canonical same-process dependency table.
 *
 * Without visibility inputs, the returned source preserves the original O(1) numeric-only shape.
 * With text/source-only visibility inputs, it borrows the canonical Arrow endpoint columns and
 * immutable snapshot, scans them without retaining row indexes, and synthesizes refs only for rows
 * whose start and end span endpoints remain visible.
 */
export function buildTraceDenseSameProcessDependencyRefSource(
  processIndex: number,
  rowCount: number,
  visibility?: TraceDenseSameProcessDependencyRefVisibility
): TraceSameProcessDependencyRefSource {
  validateTraceDenseSameProcessDependencyRefSourceAddress(processIndex, rowCount);

  if (visibility != null) {
    return buildTraceMaskedDenseSameProcessDependencyRefSource(processIndex, rowCount, visibility);
  }

  return Object.freeze({
    length: rowCount,
    denseProcessIndex: processIndex,
    at(index: number): SameProcessDependencyRef | undefined {
      return Number.isSafeInteger(index) && index >= 0 && index < rowCount
        ? encodeSameProcessDependencyRef(encodeLocalSpanRef(processIndex, index))
        : undefined;
    },
    *[Symbol.iterator](): Iterator<SameProcessDependencyRef> {
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        yield encodeSameProcessDependencyRef(encodeLocalSpanRef(processIndex, rowIndex));
      }
    }
  } satisfies TraceSameProcessDependencyRefSource);
}

/**
 * Builds one mask-compacted dense dependency source without retaining visible row indexes.
 *
 * Random access scans the borrowed Arrow endpoint columns, while iteration streams them once in
 * canonical table order. This is intentionally cache-free; direct binary writers can consume the
 * same borrowed table and snapshot later without asking this source for every ref.
 */
function buildTraceMaskedDenseSameProcessDependencyRefSource(
  processIndex: number,
  rowCount: number,
  visibility: TraceDenseSameProcessDependencyRefVisibility
): TraceSameProcessDependencyRefSource {
  const denseVisibility = validateTraceDenseSameProcessDependencyRefVisibility(
    rowCount,
    visibility
  );
  const endpointColumns = getTraceDenseSameProcessDependencyEndpointColumns(
    denseVisibility.dependencyTable
  );
  const fixedWidthEndpointBatches = buildTraceDenseDependencyFixedWidthEndpointBatchesForTable(
    denseVisibility.dependencyTable
  );
  const length = countTraceVisibleDenseSameProcessDependencyRows(
    endpointColumns,
    denseVisibility.traceViewSnapshot,
    rowCount,
    fixedWidthEndpointBatches
  );

  return Object.freeze({
    length,
    denseProcessIndex: processIndex,
    denseVisibility,
    at(index: number): SameProcessDependencyRef | undefined {
      if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
        return undefined;
      }
      const rowIndex = findTraceVisibleDenseSameProcessDependencyRowIndex(
        endpointColumns,
        denseVisibility.traceViewSnapshot,
        rowCount,
        index
      );
      return rowIndex == null
        ? undefined
        : encodeSameProcessDependencyRef(encodeLocalSpanRef(processIndex, rowIndex));
    },
    *[Symbol.iterator](): Iterator<SameProcessDependencyRef> {
      const startMaskCursor = createTraceDenseSameProcessDependencyMaskCursor();
      const endMaskCursor = createTraceDenseSameProcessDependencyMaskCursor();
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        if (
          isTraceDenseSameProcessDependencyRowVisible(
            endpointColumns,
            denseVisibility.traceViewSnapshot,
            rowIndex,
            startMaskCursor,
            endMaskCursor
          )
        ) {
          yield encodeSameProcessDependencyRef(encodeLocalSpanRef(processIndex, rowIndex));
        }
      }
    }
  } satisfies TraceSameProcessDependencyRefSource);
}

/** Borrowed endpoint columns needed to test one canonical dependency row's visibility. */
type TraceDenseSameProcessDependencyEndpointColumns = {
  /** Borrowed canonical source span-ref column. */
  readonly startSpanRef: {get(rowIndex: number): unknown};
  /** Borrowed canonical destination span-ref column. */
  readonly endSpanRef: {get(rowIndex: number): unknown};
};

/**
 * Build-local chunk-mask cursor reused only while one dependency scan is active.
 *
 * It binds the immutable snapshot mask at chunk transitions and is discarded after the scan; it
 * is not retained by the prepared source or used as a cache.
 */
type TraceDenseSameProcessDependencyMaskCursor = {
  /** Last endpoint chunk slot bound by this scan cursor. */
  chunkIndex: number;
  /** Borrowed mask for the bound chunk, or null when every chunk row is visible. */
  filterMaskByRow: Readonly<Uint8Array> | null;
};

/** Validates the packed process/row address space shared by dense dependency sources. */
function validateTraceDenseSameProcessDependencyRefSourceAddress(
  processIndex: number,
  rowCount: number
): void {
  if (
    !Number.isSafeInteger(processIndex) ||
    processIndex < 0 ||
    processIndex > MAX_SAME_PROCESS_DEPENDENCY_REF_PROCESS_INDEX ||
    !Number.isSafeInteger(rowCount) ||
    rowCount < 0 ||
    rowCount > MAX_SPAN_REF_ROW_INDEX + 1
  ) {
    throw new Error('Dense dependency-ref sources require a valid process index and row count.');
  }
}

/**
 * Validates and freezes the tiny borrowed visibility descriptor.
 *
 * The wrapper is new only at source construction time; the Arrow table and snapshot identities are
 * preserved exactly and no row-local state is retained.
 */
function validateTraceDenseSameProcessDependencyRefVisibility(
  rowCount: number,
  visibility: TraceDenseSameProcessDependencyRefVisibility
): TraceDenseSameProcessDependencyRefVisibility {
  if (visibility.dependencyTable.numRows !== rowCount) {
    throw new Error('Dense masked dependency-ref sources require a matching table.');
  }
  return Object.freeze({
    dependencyTable: visibility.dependencyTable,
    traceViewSnapshot: visibility.traceViewSnapshot
  });
}

/** Borrows the two canonical endpoint columns required by masked dense dependency sources. */
function getTraceDenseSameProcessDependencyEndpointColumns(
  dependencyTable: Readonly<ArrowTraceSameProcessDependencyTable>
): TraceDenseSameProcessDependencyEndpointColumns {
  const startSpanRef = dependencyTable.getChild('startSpanRef');
  const endSpanRef = dependencyTable.getChild('endSpanRef');
  if (!startSpanRef || !endSpanRef) {
    throw new Error('Dense masked dependency-ref sources require canonical endpoint columns.');
  }
  return {startSpanRef, endSpanRef};
}

/** Counts canonical dependency rows whose two endpoint span refs remain visible. */
function countTraceVisibleDenseSameProcessDependencyRows(
  columns: TraceDenseSameProcessDependencyEndpointColumns,
  traceViewSnapshot: Readonly<TraceViewSnapshot>,
  rowCount: number,
  fixedWidthBatches: readonly TraceDenseDependencyFixedWidthEndpointBatch[] | null
): number {
  if (fixedWidthBatches) {
    return countTraceVisibleDenseSameProcessDependencyRowsFromFixedWidthBatches(
      fixedWidthBatches,
      traceViewSnapshot
    );
  }

  let visibleRowCount = 0;
  const startMaskCursor = createTraceDenseSameProcessDependencyMaskCursor();
  const endMaskCursor = createTraceDenseSameProcessDependencyMaskCursor();
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    if (
      isTraceDenseSameProcessDependencyRowVisible(
        columns,
        traceViewSnapshot,
        rowIndex,
        startMaskCursor,
        endMaskCursor
      )
    ) {
      visibleRowCount += 1;
    }
  }
  return visibleRowCount;
}

/**
 * Counts visible dependency rows through borrowed endpoint typed arrays.
 *
 * The binding is build-local and discarded after this exact allocation count. Unsupported Arrow
 * vectors return to the scalar checked path above instead of retaining a row index or copying a
 * buffer.
 */
function countTraceVisibleDenseSameProcessDependencyRowsFromFixedWidthBatches(
  batches: readonly TraceDenseDependencyFixedWidthEndpointBatch[],
  traceViewSnapshot: Readonly<TraceViewSnapshot>
): number {
  let visibleRowCount = 0;
  const startMaskCursor = createTraceDenseSameProcessDependencyMaskCursor();
  const endMaskCursor = createTraceDenseSameProcessDependencyMaskCursor();
  for (const batch of batches) {
    for (let localRowIndex = 0; localRowIndex < batch.startSpanRef.length; localRowIndex += 1) {
      const startSpanRef = getTraceDenseSameProcessDependencyFixedWidthEndpointSpanRef(
        batch.startSpanRef,
        localRowIndex
      );
      const endSpanRef = getTraceDenseSameProcessDependencyFixedWidthEndpointSpanRef(
        batch.endSpanRef,
        localRowIndex
      );
      if (
        startSpanRef != null &&
        endSpanRef != null &&
        isTraceDenseSameProcessDependencyEndpointPairVisible(
          traceViewSnapshot,
          startSpanRef,
          endSpanRef,
          startMaskCursor,
          endMaskCursor
        )
      ) {
        visibleRowCount += 1;
      }
    }
  }
  return visibleRowCount;
}

/** Resolves one compacted visible output index back to its canonical dependency table row. */
function findTraceVisibleDenseSameProcessDependencyRowIndex(
  columns: TraceDenseSameProcessDependencyEndpointColumns,
  traceViewSnapshot: Readonly<TraceViewSnapshot>,
  rowCount: number,
  outputIndex: number
): number | undefined {
  let visibleIndex = 0;
  const startMaskCursor = createTraceDenseSameProcessDependencyMaskCursor();
  const endMaskCursor = createTraceDenseSameProcessDependencyMaskCursor();
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    if (
      !isTraceDenseSameProcessDependencyRowVisible(
        columns,
        traceViewSnapshot,
        rowIndex,
        startMaskCursor,
        endMaskCursor
      )
    ) {
      continue;
    }
    if (visibleIndex === outputIndex) {
      return rowIndex;
    }
    visibleIndex += 1;
  }
  return undefined;
}

/** Returns whether both canonical dependency endpoints survive a text/source-only snapshot. */
function isTraceDenseSameProcessDependencyRowVisible(
  columns: TraceDenseSameProcessDependencyEndpointColumns,
  traceViewSnapshot: Readonly<TraceViewSnapshot>,
  rowIndex: number,
  startMaskCursor: TraceDenseSameProcessDependencyMaskCursor,
  endMaskCursor: TraceDenseSameProcessDependencyMaskCursor
): boolean {
  const startSpanRef = getTraceDenseSameProcessDependencyEndpointSpanRef(
    columns.startSpanRef,
    rowIndex
  );
  const endSpanRef = getTraceDenseSameProcessDependencyEndpointSpanRef(
    columns.endSpanRef,
    rowIndex
  );
  return (
    startSpanRef != null &&
    endSpanRef != null &&
    isTraceDenseSameProcessDependencyEndpointPairVisible(
      traceViewSnapshot,
      startSpanRef,
      endSpanRef,
      startMaskCursor,
      endMaskCursor
    )
  );
}

/** Returns whether both canonical endpoints survive one text/source-only snapshot. */
function isTraceDenseSameProcessDependencyEndpointPairVisible(
  traceViewSnapshot: Readonly<TraceViewSnapshot>,
  startSpanRef: SpanRef,
  endSpanRef: SpanRef,
  startMaskCursor: TraceDenseSameProcessDependencyMaskCursor,
  endMaskCursor: TraceDenseSameProcessDependencyMaskCursor
): boolean {
  return (
    isTraceDenseSameProcessDependencyEndpointVisible(
      traceViewSnapshot,
      startSpanRef,
      startMaskCursor
    ) &&
    isTraceDenseSameProcessDependencyEndpointVisible(traceViewSnapshot, endSpanRef, endMaskCursor)
  );
}

/** Creates one empty chunk-mask cursor for a single dependency endpoint scan. */
function createTraceDenseSameProcessDependencyMaskCursor(): TraceDenseSameProcessDependencyMaskCursor {
  return {
    chunkIndex: -1,
    filterMaskByRow: null
  };
}

/**
 * Tests one endpoint against a chunk-local snapshot mask bound at chunk transitions.
 *
 * Out-of-range refs preserve the existing accessor's fail-open behavior for malformed canonical
 * rows; prepared-scene eligibility validates canonical endpoints before using this fast path.
 */
function isTraceDenseSameProcessDependencyEndpointVisible(
  traceViewSnapshot: Readonly<TraceViewSnapshot>,
  spanRef: SpanRef,
  cursor: TraceDenseSameProcessDependencyMaskCursor
): boolean {
  const chunkIndex = getSpanRefChunkIndex(spanRef);
  if (cursor.chunkIndex !== chunkIndex) {
    cursor.chunkIndex = chunkIndex;
    cursor.filterMaskByRow = getTraceViewChunkFilterMask(traceViewSnapshot, chunkIndex);
  }
  const filterMaskByRow = cursor.filterMaskByRow;
  if (filterMaskByRow == null) {
    return true;
  }
  const rowIndex = getSpanRefRowIndex(spanRef);
  return rowIndex < 0 || rowIndex >= filterMaskByRow.length || filterMaskByRow[rowIndex] === 0;
}

/** Reads one valid canonical span ref from a nullable Arrow dependency endpoint column. */
function getTraceDenseSameProcessDependencyEndpointSpanRef(
  column: {get(rowIndex: number): unknown},
  rowIndex: number
): SpanRef | null {
  const value = column.get(rowIndex);
  return typeof value === 'number' && isSpanRef(value) ? value : null;
}

/** Reads one valid canonical span ref from a borrowed fixed-width endpoint batch. */
function getTraceDenseSameProcessDependencyFixedWidthEndpointSpanRef(
  batch: TraceDenseDependencyFixedWidthEndpointBatch['startSpanRef'],
  localRowIndex: number
): SpanRef | null {
  const validityIndex = batch.validityOffset + localRowIndex;
  if (
    batch.nullBitmap != null &&
    (batch.nullBitmap[validityIndex >> 3]! & (1 << (validityIndex & 7))) === 0
  ) {
    return null;
  }
  const value = batch.values[localRowIndex];
  return Number.isSafeInteger(value) && isSpanRef(value) ? value : null;
}

/** Finds the numeric range containing one prepared-output row. */
function findTraceDenseSpanRefRange(
  ranges: readonly TraceDenseSpanRefRange[],
  outputIndex: number
): TraceDenseSpanRefRange | undefined {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const range = ranges[middle];
    if (!range) {
      return undefined;
    }
    if (outputIndex < range.outputStart) {
      high = middle - 1;
      continue;
    }
    if (outputIndex >= range.outputStart + getTraceDenseSpanRefRangeVisibleRowCount(range)) {
      low = middle + 1;
      continue;
    }
    return range;
  }
  return undefined;
}

/** Returns the compacted visible-row count for one dense canonical range. */
function getTraceDenseSpanRefRangeVisibleRowCount(range: TraceDenseSpanRefRange): number {
  return range.visibleRowCount ?? range.rowCount;
}

/**
 * Counts zero-mask rows in one borrowed chunk-local visibility column.
 *
 * The scan happens once while constructing the source so length stays O(1) afterward without
 * retaining a compacted row-index array.
 */
function countTraceDenseSpanRefVisibleRows(
  range: Pick<TraceDenseSpanRefRange, 'rowStart' | 'rowCount'>,
  filterMaskByRow: Readonly<Uint8Array>
): number {
  let visibleRowCount = 0;
  const rowEnd = range.rowStart + range.rowCount;
  for (let rowIndex = range.rowStart; rowIndex < rowEnd; rowIndex += 1) {
    if (filterMaskByRow[rowIndex] === 0) {
      visibleRowCount += 1;
    }
  }
  return visibleRowCount;
}

/**
 * Resolves one compacted output offset to its canonical chunk-local row.
 *
 * Unmasked ranges keep the original O(1) arithmetic path. Masked random access scans the borrowed
 * typed column instead of retaining a row-index cache; sequential consumers should use iteration
 * or direct masked writers.
 */
function getTraceDenseSpanRefRangeVisibleRowIndex(
  range: TraceDenseSpanRefRange,
  visibleOffset: number
): number | undefined {
  if (range.filterMaskByRow == null) {
    return range.rowStart + visibleOffset;
  }

  let currentVisibleOffset = 0;
  const rowEnd = range.rowStart + range.rowCount;
  for (let rowIndex = range.rowStart; rowIndex < rowEnd; rowIndex += 1) {
    if (range.filterMaskByRow[rowIndex] !== 0) {
      continue;
    }
    if (currentVisibleOffset === visibleOffset) {
      return rowIndex;
    }
    currentVisibleOffset += 1;
  }
  return undefined;
}
