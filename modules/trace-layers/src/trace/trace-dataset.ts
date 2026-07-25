import {
  findArrowTraceChunkByIndex,
  getArrowTraceChunkSpanTableRowIndex
} from './ingestion/arrow-trace';
import {
  encodeSpanRef,
  getSpanRefChunkIndex,
  getSpanRefRowIndex
} from './trace-graph/trace-id-encoder';

import type {
  ArrowTraceCrossProcessDependencyTable,
  ArrowTraceEventTable,
  ArrowTraceProcessMetadata,
  ArrowTraceSameProcessDependencyTable,
  ArrowTraceSpanSidecarTableMap,
  TraceCrossProcessEndpointsBySpanRef,
  TraceProcessSpanRefTable
} from './ingestion/arrow-trace';
import type {TraceChunk} from './trace-chunk';
import type {TraceGraphStats} from './trace-graph/trace-graph-stats';
import type {ProcessRef, SameProcessDependencyRef} from './trace-graph/trace-id-encoder';
import type {TraceOwnerRefSnapshot} from './trace-graph/trace-owner-ref-registry';
import type {SpanRef, TraceProcessId, TraceSpanLayoutMode} from './trace-graph/trace-types';
import type {TraceRefSource} from './trace-ref-source';

/**
 * Resolves the owning process id for one active dataset span ref without materializing graph data.
 *
 * Most store-finalized chunks retain one process owner, while generic physical-span chunks may
 * retain several owners and carry the exact owner ref in their canonical \`process_ref\` column.
 * The narrow fallback reads only that scalar column, never a row object or compatibility graph.
 */
export function getTraceDatasetSpanRefProcessId(
  traceDataset: Readonly<TraceDataset>,
  spanRef: SpanRef
): TraceProcessId | null {
  if (!isTraceDatasetSpanRefActive(traceDataset, spanRef)) {
    return null;
  }
  const chunk = findTraceDatasetChunkByIndex(traceDataset, getSpanRefChunkIndex(spanRef));
  if (!chunk) {
    return null;
  }
  const rowIndex = getArrowTraceChunkSpanTableRowIndex(chunk, getSpanRefRowIndex(spanRef));
  if (rowIndex == null) {
    return null;
  }
  const processRef =
    chunk.processRefs.length === 1
      ? chunk.processRefs[0]
      : getTraceDatasetSpanRowProcessRef(chunk, rowIndex);
  return (
    chunk.processId ??
    (processRef == null ? null : traceDataset.ownerRefSnapshot.processIdByRef.get(processRef)) ??
    null
  );
}

/** Reads one canonical row-local process ref for a multi-process retained chunk. */
function getTraceDatasetSpanRowProcessRef(
  chunk: Readonly<TraceChunk>,
  rowIndex: number
): ProcessRef | null {
  const processRef = chunk.spanTable.getChild('process_ref')?.get(rowIndex);
  return typeof processRef === 'number' && Number.isSafeInteger(processRef)
    ? (processRef as ProcessRef)
    : null;
}

/**
 * Visits every active dataset span row without projecting graph data or allocating row wrappers.
 *
 * The callback receives the canonical retained chunk, backing Arrow-table row index, and stable
 * packed span ref for each active row in dataset order. Row-selected datasets visit only their
 * explicit `spanRefs`; full datasets stream each retained chunk table once.
 */
export function forEachTraceDatasetActiveSpanRow(
  traceDataset: Readonly<TraceDataset>,
  visit: (chunk: TraceChunk, rowIndex: number, spanRef: SpanRef) => void
): void {
  if (traceDataset.spanRefs == null) {
    for (const chunk of traceDataset.chunks) {
      for (let rowIndex = 0; rowIndex < chunk.spanTable.numRows; rowIndex += 1) {
        visit(chunk, rowIndex, encodeSpanRef(chunk.chunkIndex, rowIndex));
      }
    }
    return;
  }

  let currentChunkIndex: number | null = null;
  let currentChunk: TraceChunk | null = null;
  for (const spanRef of traceDataset.spanRefs) {
    const chunkIndex = getSpanRefChunkIndex(spanRef);
    if (chunkIndex !== currentChunkIndex) {
      currentChunkIndex = chunkIndex;
      currentChunk = findTraceDatasetChunkByIndex(traceDataset, chunkIndex);
    }
    if (!currentChunk) {
      continue;
    }
    const rowIndex = getArrowTraceChunkSpanTableRowIndex(currentChunk, getSpanRefRowIndex(spanRef));
    if (rowIndex != null) {
      visit(currentChunk, rowIndex, spanRef);
    }
  }
}

/**
 * Canonical graph-wide time bounds retained by one immutable trace dataset.
 */
export type TraceDatasetTimeExtents = {
  /** Earliest canonical timestamp in the dataset. */
  readonly minTimeMs: number;
  /** Latest canonical timestamp in the dataset. */
  readonly maxTimeMs: number;
};

/**
 * Immutable Arrow-backed storage snapshot consumed by dataset-native runtime stages.
 *
 * The dataset owns finalized chunk/table references plus the low-cardinality dependency and
 * sidecar lookup maps needed by ref-native consumers, but it does not restate canonical span
 * tables already owned by chunks or materialize per-span compatibility objects/render geometry.
 * Only snapshots produced by the shared ready-chunk or chunk-window assemblers carry the
 * store-finalized invariant contract consumed by trusted dense readers; manually fabricated
 * structural lookalikes are outside that contract. Callers may append by sharing every prior Arrow
 * buffer and replacing only the changed top-level snapshot fields.
 */
export type TraceDataset = {
  /** Stable discriminator for immutable dataset snapshots. */
  readonly type: 'trace-dataset';
  /** Monotonic structural revision; initial snapshots start at zero. */
  readonly revision: number;
  /** Human-friendly trace name retained for graph materialization. */
  readonly name: string;
  /** Whether spans use generated lanes or authored thread-relative vertical geometry. */
  readonly spanLayout?: TraceSpanLayoutMode;
  /** Metadata-only process records in trace-global owner-ref order. */
  readonly processes: readonly ArrowTraceProcessMetadata[];
  /** Store-finalized row-backed chunks retained by identity. */
  readonly chunks: readonly TraceChunk[];
  /**
   * Optional ascending active span refs for a row-selected dataset view.
   *
   * Omit this field when every row in every retained chunk is active. Chunk-window datasets use
   * it to retain canonical chunk buffers by identity while exposing only rows that overlap the
   * requested time window.
   */
  readonly spanRefs?: readonly SpanRef[];
  /** Canonical process-local Arrow dependency tables keyed by process id. */
  readonly sameProcessDependencyTableMap: Readonly<
    Record<TraceProcessId, ArrowTraceSameProcessDependencyTable>
  >;
  /** Optional row-aligned Arrow detail sidecar tables keyed by process id. */
  readonly spanSidecarTableMap?: ArrowTraceSpanSidecarTableMap;
  /** Canonical graph-global Arrow cross-process dependency table. */
  readonly crossProcessDependencyTable: Readonly<ArrowTraceCrossProcessDependencyTable>;
  /** Canonical graph-global Arrow event table. */
  readonly events: Readonly<ArrowTraceEventTable>;
  /** Sparse unresolved cross-process endpoints keyed by exact owning span ref. */
  readonly crossProcessEndpointsBySpanRef?: TraceCrossProcessEndpointsBySpanRef;
  /** Canonical graph-wide time bounds. */
  readonly timeExtents: TraceDatasetTimeExtents;
  /** Aggregated graph counts carried without rereading prior chunk rows on append. */
  readonly stats: TraceGraphStats;
  /** Trace-global owner-ref lookup tables captured for this dataset revision. */
  readonly ownerRefSnapshot: TraceOwnerRefSnapshot;
  /** Process-local active SpanRef/layout index tables retained for ref-native runtime consumers. */
  readonly processSpanTableMap: Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>>;
  /** Zero-copy process-local span-ref sources aligned with owner-ref process indexes. */
  readonly spanRefSourcesByProcessIndex: readonly TraceRefSource<SpanRef>[];
  /** Numeric canonical dependency sources aligned with owner-ref process indexes. */
  readonly sameProcessDependencyRefSourcesByProcessIndex: readonly TraceRefSource<SameProcessDependencyRef>[];
};

/** Returns whether one ref belongs to the dataset's explicit active row selection. */
function isTraceDatasetSpanRefActive(
  traceDataset: Readonly<TraceDataset>,
  spanRef: SpanRef
): boolean {
  const spanRefs = traceDataset.spanRefs;
  if (spanRefs == null) {
    return true;
  }
  let lowerBound = 0;
  let upperBound = spanRefs.length - 1;
  while (lowerBound <= upperBound) {
    const middleIndex = (lowerBound + upperBound) >> 1;
    const middleSpanRef = spanRefs[middleIndex]!;
    if (middleSpanRef === spanRef) {
      return true;
    }
    if (middleSpanRef < spanRef) {
      lowerBound = middleIndex + 1;
    } else {
      upperBound = middleIndex - 1;
    }
  }
  return false;
}

/** Resolves one sparse stable chunk slot from a canonical dataset chunk list. */
function findTraceDatasetChunkByIndex(
  traceDataset: Readonly<TraceDataset>,
  chunkIndex: number
): TraceChunk | null {
  return findArrowTraceChunkByIndex(traceDataset.chunks, chunkIndex) as TraceChunk | null;
}
