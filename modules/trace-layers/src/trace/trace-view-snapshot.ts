import {getArrowTraceChunkSpanTableRowIndex} from './ingestion/arrow-trace';
import {
  buildCompiledTraceSpanFilterPlan,
  getTraceSpanNameFilterMatchMask,
  getTraceSpanSourceFilterMatchMask,
  normalizeTraceSpanFilters
} from './trace-graph/trace-graph-span-filters';
import {
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_SOURCE
} from './trace-graph/trace-graph-types';
import {getSpanRefChunkIndex, getSpanRefRowIndex} from './trace-graph/trace-id-encoder';

import type {ArrowTraceSpanTable} from './ingestion/arrow-trace';
import type {TraceChunk} from './trace-chunk';
import type {TraceDataset} from './trace-dataset';
import type {CompiledTraceSpanFilterPlan} from './trace-graph/trace-graph-span-filters';
import type {TraceSpanFilterMask} from './trace-graph/trace-graph-types';
import type {SpanRef} from './trace-graph/trace-types';

/**
 * Immutable row projection for one canonical dataset chunk.
 *
 * Canonical datasets own every row in every selected chunk. Null typed columns mean this view
 * adds no row-level projection for the chunk.
 */
export type TraceViewChunkSnapshot = {
  /** Stable store chunk slot encoded by the chunk's span refs. */
  readonly chunkIndex: number;
  /** Number of canonical Arrow rows owned by the chunk. */
  readonly rowCount: number;
  /** Number of canonical rows hidden by this visibility view. */
  readonly filteredSpanCount: number;
  /**
   * Text/source provenance mask aligned by chunk-local row, or null when no active canonical row
   * in the chunk matched.
   */
  readonly filterMaskByRow: Readonly<Uint8Array> | null;
};

/**
 * Immutable, cache-free visibility projection over one canonical TraceDataset.
 *
 * The view retains the dataset identity and stores only chunk-local typed columns for chunks that
 * actually lose rows. It does not create compatibility span objects, per-span maps, reuse keys, or
 * hidden retained state.
 */
export type TraceViewSnapshot = {
  /** Canonical dataset retained by identity for downstream columnar consumers. */
  readonly dataset: TraceDataset;
  /** Normalized literal-prefix and explicit-regex filters represented by this view. */
  readonly spanFilters: readonly string[];
  /** Chunk projections sorted by stable chunk slot for deterministic columnar traversal. */
  readonly chunks: readonly TraceViewChunkSnapshot[];
  /** Number of active canonical rows hidden by this visibility view. */
  readonly filteredSpanCount: number;
};

/**
 * Visibility-filter inputs for building one immutable TraceViewSnapshot.
 */
export type TraceViewSnapshotOptions = {
  /** Comma/newline/semicolon-separated literal prefixes or explicit /regex/flags filters. */
  readonly spanFilters?: readonly string[];
};

/**
 * Build one cache-free visibility projection directly from canonical dataset Arrow columns.
 *
 * Only name and source columns are read. Literal-prefix filters compare borrowed Arrow
 * Utf8 bytes without decoding row strings; explicit regex filters keep the checked string path.
 * Unfiltered chunks retain no per-span arrays and matching chunks receive one combined provenance
 * mask.
 */
export function buildTraceViewSnapshot(
  dataset: TraceDataset,
  options: TraceViewSnapshotOptions = {}
): TraceViewSnapshot {
  const spanFilters = normalizeTraceSpanFilters(options.spanFilters);
  const filterPlan = buildCompiledTraceSpanFilterPlan(spanFilters);
  const hasTextFilters = hasCompiledTraceSpanFilters(filterPlan);
  const literalPrefixBytes =
    hasTextFilters && filterPlan.regexMatchers.length === 0
      ? buildTraceViewLiteralPrefixBytes(filterPlan.literalPrefixes)
      : null;
  const mutableChunks = [...dataset.chunks]
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .map(chunk =>
      createMutableTraceViewChunkSnapshot({
        chunk,
        hasTextFilters,
        literalPrefixBytes
      })
    );
  assertUniqueTraceViewChunkIndexes(mutableChunks);
  const mutableChunkByIndex = buildMutableTraceViewChunkIndex(mutableChunks);
  markMutableTraceViewActiveRows(dataset, mutableChunkByIndex);

  if (hasTextFilters) {
    for (const mutableChunk of mutableChunks) {
      if (mutableChunk.literalUtf8Columns && literalPrefixBytes) {
        scanTraceViewLiteralUtf8Chunk({
          mutableChunk,
          literalPrefixBytes
        });
      } else {
        scanTraceViewCheckedTextChunk({
          mutableChunk,
          filterPlan
        });
      }
    }
  }

  const chunks = mutableChunks.map(finalizeTraceViewChunkSnapshot);
  const filteredSpanCount = chunks.reduce(
    (filteredCount, chunk) => filteredCount + chunk.filteredSpanCount,
    0
  );

  return {
    dataset,
    spanFilters,
    chunks,
    filteredSpanCount
  };
}

/** Return whether a view hides any active canonical span rows. */
export function hasTraceViewSnapshotFilters(snapshot: Readonly<TraceViewSnapshot>): boolean {
  return snapshot.filteredSpanCount > 0;
}

/**
 * Borrow one chunk-local combined filter mask for dense columnar consumers.
 *
 * The returned typed array remains owned by the immutable snapshot. A null result means every
 * active canonical row in the chunk is visible to the snapshot.
 */
export function getTraceViewChunkFilterMask(
  snapshot: Readonly<TraceViewSnapshot>,
  chunkIndex: number
): Readonly<Uint8Array> | null {
  return findTraceViewChunkSnapshot(snapshot.chunks, chunkIndex)?.filterMaskByRow ?? null;
}

/**
 * Read one combined view-filter provenance mask from a canonical packed span ref.
 *
 * The lookup binary-searches the tiny chunk projection list and reads the packed canonical
 * chunk-local row directly; it does not rediscover the dataset chunk, create a span-ref map, or
 * retain a second visibility index.
 */
export function getTraceViewSpanFilterMask(
  snapshot: Readonly<TraceViewSnapshot>,
  spanRef: SpanRef
): TraceSpanFilterMask {
  const chunkIndex = getSpanRefChunkIndex(spanRef);
  const chunkSnapshot = findTraceViewChunkSnapshot(snapshot.chunks, chunkIndex);
  if (!chunkSnapshot?.filterMaskByRow) {
    return TRACE_SPAN_FILTER_MASK_NONE;
  }
  const rowIndex = getSpanRefRowIndex(spanRef);
  return rowIndex < 0 || rowIndex >= chunkSnapshot.rowCount
    ? TRACE_SPAN_FILTER_MASK_NONE
    : (chunkSnapshot.filterMaskByRow[rowIndex] ?? TRACE_SPAN_FILTER_MASK_NONE);
}

type ArrowReadableColumn<T> = {
  /** Read one nullable Arrow column value by row index. */
  get(index: number): T | null | undefined;
  /** Public Arrow data pages exposed by Utf8 vectors when direct-buffer reads are available. */
  readonly data?: readonly TraceViewArrowUtf8DataPage[];
};

type TraceViewFilterColumns = {
  /** Narrow Arrow name column used by text filters. */
  readonly name: ArrowReadableColumn<string> | null;
  /** Narrow optional Arrow source column used when source filtering is enabled. */
  readonly source: ArrowReadableColumn<string> | null;
};

type TraceViewArrowUtf8DataPage = {
  /** Number of logical rows represented by this public Arrow data page. */
  readonly length: number;
  /** Arrow row offset; direct literal scans accept only offset-zero pages. */
  readonly offset: number;
  /** Number of null rows represented by the page. */
  readonly nullCount: number;
  /** Borrowed Utf8 value offsets. */
  readonly valueOffsets?: unknown;
  /** Borrowed contiguous Utf8 value bytes. */
  readonly values?: unknown;
  /** Borrowed Arrow validity bitmap when the page contains nulls. */
  readonly nullBitmap?: unknown;
};

type TraceViewUtf8Page = {
  /** Inclusive chunk-local row represented by this borrowed Utf8 page. */
  readonly rowStart: number;
  /** Exclusive chunk-local row represented by this borrowed Utf8 page. */
  readonly rowEnd: number;
  /** Borrowed Utf8 value offsets aligned to page-local row zero. */
  readonly valueOffsets: Int32Array | Uint32Array;
  /** Borrowed contiguous Utf8 value bytes. */
  readonly values: Uint8Array;
  /** Borrowed validity bitmap, or null when every page row is valid. */
  readonly nullBitmap: Uint8Array | null;
};

type TraceViewUtf8Pages = {
  /** Borrowed offset-zero Utf8 pages in chunk-local row order. */
  readonly pages: readonly TraceViewUtf8Page[];
  /** Whether every row in every borrowed page is null. */
  readonly allRowsNull: boolean;
};

type TraceViewLiteralUtf8Columns = {
  /** Borrowed name Utf8 pages used by literal-prefix matching. */
  readonly name: TraceViewUtf8Pages;
  /** Borrowed source Utf8 pages, or null when no source column exists. */
  readonly source: TraceViewUtf8Pages | null;
};

type MutableTraceViewUtf8Cursor = {
  /** Borrowed Utf8 pages traversed by this build-local cursor. */
  readonly pages: readonly TraceViewUtf8Page[];
  /** Current page ordinal advanced monotonically with row scans. */
  pageIndex: number;
  /** Current borrowed page, or null when the cursor exhausted its pages. */
  page: TraceViewUtf8Page | null;
};

type MutableTraceViewChunkSnapshot = {
  /** Canonical dataset chunk retained only while this snapshot is built. */
  readonly chunk: TraceChunk;
  /** Stable store chunk slot encoded by the chunk's span refs. */
  readonly chunkIndex: number;
  /** Number of canonical Arrow rows owned by the chunk. */
  readonly rowCount: number;
  /**
   * Build-local active-row mask for row-selected datasets, or null when every chunk row is active.
   */
  activeRowMaskByRow: Uint8Array | null;
  /** Narrow Arrow columns retained only during the build scan. */
  readonly filterColumns: TraceViewFilterColumns | null;
  /** Build-local borrowed Utf8 columns for literal-prefix scans, or null for checked fallback. */
  readonly literalUtf8Columns: TraceViewLiteralUtf8Columns | null;
  /** Number of canonical rows hidden by this text-filter view. */
  filteredSpanCount: number;
  /** Text/source provenance mask allocated only after the first matching canonical row. */
  filterMaskByRow: Uint8Array | null;
};

/** Return whether a compiled filter plan has any literal or regexp matcher. */
function hasCompiledTraceSpanFilters(filterPlan: Readonly<CompiledTraceSpanFilterPlan>): boolean {
  return filterPlan.literalPrefixes.length > 0 || filterPlan.regexMatchers.length > 0;
}

/** Create one mutable chunk accumulator without eagerly allocating any per-span typed columns. */
function createMutableTraceViewChunkSnapshot(params: {
  /** Canonical dataset chunk represented by the mutable projection. */
  readonly chunk: TraceChunk;
  /** Whether the current snapshot has any compiled text filters. */
  readonly hasTextFilters: boolean;
  /** Direct Utf8 literal prefixes, or null when the checked path is required. */
  readonly literalPrefixBytes: readonly Uint8Array[] | null;
}): MutableTraceViewChunkSnapshot {
  const filterColumns = params.hasTextFilters
    ? readArrowTraceSpanFilterColumns(params.chunk.spanTable)
    : null;
  return {
    chunk: params.chunk,
    chunkIndex: params.chunk.chunkIndex,
    rowCount: params.chunk.metadata.rowCount,
    activeRowMaskByRow: null,
    filterColumns,
    literalUtf8Columns:
      filterColumns && params.literalPrefixBytes
        ? buildTraceViewLiteralUtf8Columns({
            columns: filterColumns,
            rowCount: params.chunk.metadata.rowCount
          })
        : null,
    filteredSpanCount: 0,
    filterMaskByRow: null
  };
}

/** Reject duplicate canonical chunk slots before scanning dense chunk rows. */
function assertUniqueTraceViewChunkIndexes(
  mutableChunks: readonly MutableTraceViewChunkSnapshot[]
): void {
  const chunkIndexes = new Set<number>();
  for (const mutableChunk of mutableChunks) {
    if (chunkIndexes.has(mutableChunk.chunkIndex)) {
      throw new Error(
        'TraceViewSnapshot received duplicate dataset chunk ' + mutableChunk.chunkIndex + '.'
      );
    }
    chunkIndexes.add(mutableChunk.chunkIndex);
  }
}

/** Build one discarded chunk-slot lookup for mask writes during one snapshot build. */
function buildMutableTraceViewChunkIndex(
  mutableChunks: readonly MutableTraceViewChunkSnapshot[]
): ReadonlyMap<number, MutableTraceViewChunkSnapshot> {
  return new Map(mutableChunks.map(mutableChunk => [mutableChunk.chunkIndex, mutableChunk]));
}

/**
 * Mark active rows for row-selected datasets without retaining another per-span view index.
 *
 * Full datasets leave the build-local mask null so dense text scans keep their straight-line
 * zero-allocation loop. Window datasets allocate only one temporary byte mask per touched chunk.
 */
function markMutableTraceViewActiveRows(
  dataset: TraceDataset,
  mutableChunkByIndex: ReadonlyMap<number, MutableTraceViewChunkSnapshot>
): void {
  if (!dataset.spanRefs) {
    return;
  }

  for (const mutableChunk of mutableChunkByIndex.values()) {
    mutableChunk.activeRowMaskByRow = new Uint8Array(mutableChunk.rowCount);
  }
  for (const spanRef of dataset.spanRefs) {
    const mutableChunk = mutableChunkByIndex.get(getSpanRefChunkIndex(spanRef));
    if (!mutableChunk) {
      continue;
    }
    const rowIndex = getArrowTraceChunkSpanTableRowIndex(
      mutableChunk.chunk,
      getSpanRefRowIndex(spanRef)
    );
    if (rowIndex == null || rowIndex < 0 || rowIndex >= mutableChunk.rowCount) {
      continue;
    }
    mutableChunk.activeRowMaskByRow![rowIndex] = 1;
  }
}

/** Return whether one canonical chunk row participates in the active dataset view. */
function traceViewChunkRowIsActive(
  mutableChunk: Readonly<MutableTraceViewChunkSnapshot>,
  rowIndex: number
): boolean {
  return mutableChunk.activeRowMaskByRow == null || mutableChunk.activeRowMaskByRow[rowIndex] === 1;
}

/** Read the name and source columns allowed in dataset-native text filtering. */
function readArrowTraceSpanFilterColumns(table: ArrowTraceSpanTable): TraceViewFilterColumns {
  const readableTable = table as unknown as {
    /** Resolve one nullable Arrow child column by canonical field name. */
    getChild<T>(name: string): ArrowReadableColumn<T> | null | undefined;
  };
  return {
    name: readableTable.getChild<string>('name') ?? null,
    source: readableTable.getChild<string>('source') ?? null
  };
}

/** Encode normalized literal prefixes once for one build-local direct Utf8 scan. */
function buildTraceViewLiteralPrefixBytes(
  literalPrefixes: readonly string[]
): readonly Uint8Array[] {
  const textEncoder = new TextEncoder();
  return literalPrefixes.map(literalPrefix => textEncoder.encode(literalPrefix));
}

/**
 * Build borrowed Utf8 pages for one literal-only chunk scan.
 *
 * Unsupported or sliced Arrow vectors return null so the caller can preserve checked string
 * semantics without row-local fallback branches inside the direct loop.
 */
function buildTraceViewLiteralUtf8Columns(params: {
  /** Narrow text columns bound once for the current chunk. */
  readonly columns: TraceViewFilterColumns;
  /** Number of canonical chunk-local rows expected from every bound column. */
  readonly rowCount: number;
}): TraceViewLiteralUtf8Columns | null {
  const name = buildTraceViewUtf8Pages(params.columns.name, params.rowCount);
  if (!name) {
    return null;
  }

  if (!params.columns.source) {
    return {name, source: null};
  }
  const source = buildTraceViewUtf8Pages(params.columns.source, params.rowCount);
  return source ? {name, source} : null;
}

/**
 * Build offset-zero borrowed Utf8 pages from one Arrow vector without copying its byte buffers.
 */
function buildTraceViewUtf8Pages(
  column: ArrowReadableColumn<string> | null,
  rowCount: number
): TraceViewUtf8Pages | null {
  const dataPages = column?.data;
  if (!dataPages || (rowCount > 0 && dataPages.length === 0)) {
    return null;
  }

  const pages: TraceViewUtf8Page[] = [];
  let rowStart = 0;
  let allRowsNull = rowCount > 0;
  for (const dataPage of dataPages) {
    if (
      !Number.isInteger(dataPage.length) ||
      dataPage.length < 0 ||
      dataPage.offset !== 0 ||
      !Number.isInteger(dataPage.nullCount) ||
      dataPage.nullCount < 0 ||
      dataPage.nullCount > dataPage.length ||
      !(
        dataPage.valueOffsets instanceof Int32Array || dataPage.valueOffsets instanceof Uint32Array
      ) ||
      !(dataPage.values instanceof Uint8Array) ||
      dataPage.valueOffsets.length < dataPage.length + 1
    ) {
      return null;
    }

    const nullBitmap =
      dataPage.nullCount === 0
        ? null
        : dataPage.nullBitmap instanceof Uint8Array
          ? dataPage.nullBitmap
          : null;
    if (dataPage.nullCount > 0 && !nullBitmap) {
      return null;
    }

    const rowEnd = rowStart + dataPage.length;
    pages.push({
      rowStart,
      rowEnd,
      valueOffsets: dataPage.valueOffsets,
      values: dataPage.values,
      nullBitmap
    });
    rowStart = rowEnd;
    allRowsNull &&= dataPage.nullCount === dataPage.length;
  }

  return rowStart === rowCount ? {pages, allRowsNull} : null;
}

/**
 * Scan one literal-only chunk through borrowed Utf8 pages and write lazy provenance masks.
 */
function scanTraceViewLiteralUtf8Chunk(params: {
  /** Mutable chunk projection receiving lazy filter masks. */
  readonly mutableChunk: MutableTraceViewChunkSnapshot;
  /** Build-local encoded literal prefixes tested without Utf8 decoding. */
  readonly literalPrefixBytes: readonly Uint8Array[];
}): number {
  const literalUtf8Columns = params.mutableChunk.literalUtf8Columns;
  if (!literalUtf8Columns) {
    return 0;
  }

  const nameCursor = createMutableTraceViewUtf8Cursor(literalUtf8Columns.name);
  const sourceCursor =
    literalUtf8Columns.source && !literalUtf8Columns.source.allRowsNull
      ? createMutableTraceViewUtf8Cursor(literalUtf8Columns.source)
      : null;
  let filteredSpanCount = 0;
  for (let rowIndex = 0; rowIndex < params.mutableChunk.rowCount; rowIndex += 1) {
    if (!traceViewChunkRowIsActive(params.mutableChunk, rowIndex)) {
      continue;
    }
    let filterMask = TRACE_SPAN_FILTER_MASK_NONE;
    if (traceViewUtf8RowStartsWithAnyPrefix(nameCursor, rowIndex, params.literalPrefixBytes)) {
      filterMask |= TRACE_SPAN_FILTER_MASK_REGEXP;
    }
    if (
      sourceCursor &&
      traceViewUtf8RowStartsWithAnyPrefix(sourceCursor, rowIndex, params.literalPrefixBytes)
    ) {
      filterMask |= TRACE_SPAN_FILTER_MASK_SOURCE;
    }
    if (filterMask === TRACE_SPAN_FILTER_MASK_NONE) {
      continue;
    }
    if (addTraceViewFilteredRow(params.mutableChunk, rowIndex, filterMask)) {
      filteredSpanCount += 1;
    }
  }
  return filteredSpanCount;
}

/** Scan one chunk through checked Arrow string reads for explicit regex or unsupported vectors. */
function scanTraceViewCheckedTextChunk(params: {
  /** Mutable chunk projection receiving lazy filter masks. */
  readonly mutableChunk: MutableTraceViewChunkSnapshot;
  /** Compiled matcher plan built once for this snapshot. */
  readonly filterPlan: Readonly<CompiledTraceSpanFilterPlan>;
}): number {
  const columns = params.mutableChunk.filterColumns;
  if (!columns) {
    return 0;
  }

  let filteredSpanCount = 0;
  for (let rowIndex = 0; rowIndex < params.mutableChunk.rowCount; rowIndex += 1) {
    if (!traceViewChunkRowIsActive(params.mutableChunk, rowIndex)) {
      continue;
    }
    const name = columns.name?.get(rowIndex) ?? null;
    const source = columns.source?.get(rowIndex) ?? null;
    const nameFilterMask =
      typeof name === 'string' && name.length > 0
        ? getTraceSpanNameFilterMatchMask({
            spanName: name,
            filterPlan: params.filterPlan
          })
        : TRACE_SPAN_FILTER_MASK_NONE;
    const sourceFilterMask = getTraceSpanSourceFilterMatchMask({
      source,
      filterPlan: params.filterPlan
    });
    const filterMask = nameFilterMask | sourceFilterMask;
    if (filterMask === TRACE_SPAN_FILTER_MASK_NONE) {
      continue;
    }
    if (addTraceViewFilteredRow(params.mutableChunk, rowIndex, filterMask)) {
      filteredSpanCount += 1;
    }
  }
  return filteredSpanCount;
}

/** Create one monotonic build-local cursor over borrowed Utf8 pages. */
function createMutableTraceViewUtf8Cursor(
  utf8Pages: TraceViewUtf8Pages
): MutableTraceViewUtf8Cursor {
  return {
    pages: utf8Pages.pages,
    pageIndex: 0,
    page: utf8Pages.pages[0] ?? null
  };
}

/** Return whether one borrowed Utf8 row begins with any encoded literal prefix. */
function traceViewUtf8RowStartsWithAnyPrefix(
  cursor: MutableTraceViewUtf8Cursor,
  rowIndex: number,
  literalPrefixBytes: readonly Uint8Array[]
): boolean {
  let page = cursor.page;
  while (page && rowIndex >= page.rowEnd) {
    cursor.pageIndex += 1;
    page = cursor.pages[cursor.pageIndex] ?? null;
    cursor.page = page;
  }
  if (!page || rowIndex < page.rowStart) {
    return false;
  }

  const pageRowIndex = rowIndex - page.rowStart;
  if (!isTraceViewUtf8PageRowValid(page, pageRowIndex)) {
    return false;
  }
  const start = page.valueOffsets[pageRowIndex];
  const end = page.valueOffsets[pageRowIndex + 1];
  if (start === undefined || end === undefined || start < 0 || end < start) {
    return false;
  }

  for (const literalPrefix of literalPrefixBytes) {
    if (traceViewUtf8BytesStartWith(page.values, start, end, literalPrefix)) {
      return true;
    }
  }
  return false;
}

/** Return whether one page-local row is valid according to a borrowed Arrow bitmap. */
function isTraceViewUtf8PageRowValid(page: TraceViewUtf8Page, pageRowIndex: number): boolean {
  if (!page.nullBitmap) {
    return true;
  }
  const byte = page.nullBitmap[pageRowIndex >> 3];
  return byte !== undefined && (byte & (1 << (pageRowIndex & 7))) !== 0;
}

/** Return whether one borrowed Utf8 byte range starts with an encoded prefix. */
function traceViewUtf8BytesStartWith(
  values: Uint8Array,
  start: number,
  end: number,
  literalPrefix: Uint8Array
): boolean {
  if (end - start < literalPrefix.length || end > values.length) {
    return false;
  }
  for (let byteIndex = 0; byteIndex < literalPrefix.length; byteIndex += 1) {
    if (values[start + byteIndex] !== literalPrefix[byteIndex]) {
      return false;
    }
  }
  return true;
}

/**
 * OR one nonzero filter mask into a lazily allocated chunk-local mask column.
 *
 * @returns Whether this row transitioned from visible to filtered in this stage.
 */
function addTraceViewFilteredRow(
  mutableChunk: MutableTraceViewChunkSnapshot,
  rowIndex: number,
  filterMask: TraceSpanFilterMask
): boolean {
  if (
    filterMask === TRACE_SPAN_FILTER_MASK_NONE ||
    rowIndex < 0 ||
    rowIndex >= mutableChunk.rowCount ||
    !traceViewChunkRowIsActive(mutableChunk, rowIndex)
  ) {
    return false;
  }
  mutableChunk.filterMaskByRow ??= new Uint8Array(mutableChunk.rowCount);
  const previousFilterMask = mutableChunk.filterMaskByRow[rowIndex] ?? TRACE_SPAN_FILTER_MASK_NONE;
  mutableChunk.filterMaskByRow[rowIndex] = previousFilterMask | filterMask;
  if (previousFilterMask === TRACE_SPAN_FILTER_MASK_NONE) {
    mutableChunk.filteredSpanCount += 1;
    return true;
  }
  return false;
}

/** Drop transient Arrow columns and mutable counters from one finalized chunk projection. */
function finalizeTraceViewChunkSnapshot(
  mutableChunk: MutableTraceViewChunkSnapshot
): TraceViewChunkSnapshot {
  return {
    chunkIndex: mutableChunk.chunkIndex,
    rowCount: mutableChunk.rowCount,
    filteredSpanCount: mutableChunk.filteredSpanCount,
    filterMaskByRow: mutableChunk.filterMaskByRow
  };
}

/** Find one sorted chunk projection by stable chunk slot without retaining a lookup map. */
function findTraceViewChunkSnapshot(
  chunks: readonly TraceViewChunkSnapshot[],
  chunkIndex: number
): TraceViewChunkSnapshot | null {
  let low = 0;
  let high = chunks.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const chunk = chunks[middle];
    if (!chunk) {
      return null;
    }
    if (chunk.chunkIndex === chunkIndex) {
      return chunk;
    }
    if (chunk.chunkIndex < chunkIndex) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return null;
}
