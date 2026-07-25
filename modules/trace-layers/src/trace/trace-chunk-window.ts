import {
  getArrowUtf8ColumnSource,
  getUtf8ColumnSourceRowView,
  makeUtf8StringView
} from '@deck.gl-community/infovis-layers';
import {
  buildArrowTraceCrossProcessDependencyTable,
  buildArrowTraceSameProcessDependencyTable,
  buildTraceChunkDataFromTraceProcesses,
  buildTraceProcessSpanRefTables
} from './ingestion/arrow-trace';
import {deserializeArrowTraceJson} from './ingestion/arrow-trace-json';
import {decodeTraceSpanTimingStatusCode} from './ingestion/trace-span-timing-status-code';
import {getHeapUsageProbeFields, log} from './log';
import {finalizeTraceChunkData, isTraceChunk, traceChunkHasSpanRefRow} from './trace-chunk';
import {readTraceChunkSourceDependencyRow} from './trace-chunk-data';
import {buildTraceDatasetFromReadyTraceChunks} from './trace-chunk-graph-assembler';
import {buildTraceDatasetRefSources} from './trace-dataset-ref-sources';
import {getTraceGraphSpanExternalSpanId, iterateTraceGraphSpanRefs} from './trace-graph-accessors';
import {EMPTY_ARROW_TRACE_EVENT_TABLE} from './trace-graph/trace-event-table';
import {TraceGraph} from './trace-graph/trace-graph';
import {hasTraceSpanNameFilter, hasTraceSpanSourceFilter} from './trace-graph/trace-graph-types';
import {
  encodeChunkRef,
  encodeCrossProcessDependencyRef,
  encodeLocalSpanRef,
  encodeProcessRef,
  encodeSameProcessDependencyRef,
  encodeSpanRef,
  getProcessRefIndex,
  getSpanRefChunkIndex,
  getSpanRefRowIndex
} from './trace-graph/trace-id-encoder';
import {TraceOwnerRefRegistry} from './trace-graph/trace-owner-ref-registry';
import {
  getTraceSpanExactExternalIdQuery,
  getTraceSpanPlainTextQuery
} from './trace-graph/trace-span-name-search';
import {
  isTraceSpanTimingEligibleForTimeExtents,
  isTraceSpanTimingTimestampEligibleForTimeExtents
} from './trace-time-extents';
import {buildTraceViewSnapshot} from './trace-view-snapshot';
import {formatTimeMs} from './utils/time-format-utils';

import type {Utf8ColumnSource, Utf8StringView} from '@deck.gl-community/infovis-layers';
import type {
  ArrowTraceProcessMetadata,
  ArrowTraceSameProcessDependencyTable,
  ArrowTraceSpanSidecarTable,
  ArrowTraceSpanTable
} from './ingestion/arrow-trace';
import type {TraceChunk} from './trace-chunk';
import type {TraceChunkSpanOverlapRange} from './trace-chunk-data';
import type {
  TraceChunkDescriptor,
  TraceChunkStore,
  TraceChunkStoreReadyChunk,
  TraceChunkStoreWindow
} from './trace-chunk-store';
import type {TraceDataset} from './trace-dataset';
import type {TraceSpanDetailSource} from './trace-graph-accessors';
import type {TraceGraphStats} from './trace-graph/trace-graph-stats';
import type {
  TraceGraphSpanFilterNavigation,
  TraceGraphSpanSearchContext,
  TraceGraphSpanSearchRecord,
  TraceSpanFilterMask
} from './trace-graph/trace-graph-types';
import type {ProcessRef, ThreadRef} from './trace-graph/trace-id-encoder';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceProcess,
  TraceProcessId,
  TraceSameProcessDependency,
  TraceSpan,
  TraceSpanId,
  TraceSpanTiming,
  TraceThread,
  TraceThreadId
} from './trace-graph/trace-types';
import type * as arrow from 'apache-arrow';

const EMPTY_TRACE_CHUNK_UTF8_DATA = new Uint8Array();
const EMPTY_TRACE_CHUNK_SEARCH_KEYWORDS: readonly string[] = [];

export {isTraceChunk, traceChunkHasSpanRefRow} from './trace-chunk';
export {
  buildJSONTraceChunkDataFromTraceChunkData,
  buildTraceChunkDataFromJSONTraceChunkData,
  buildTraceChunkRowWindowTable,
  buildTraceChunkSourceDependencyTable,
  isJSONTraceChunkData,
  isTraceChunkData
} from './trace-chunk-data';
export type {TraceChunk, TraceChunkIndexes, TraceChunkMetadata} from './trace-chunk';
export type {
  JSONTraceChunkData,
  JSONTraceChunkSameProcessDependency,
  JSONTraceChunkProcessMetadata,
  TraceChunkData,
  TraceChunkDiagnostics,
  TraceChunkRowWindowTable,
  TraceChunkSourceDependencyRow,
  TraceChunkSourceDependencyTable,
  TraceChunkSpanOverlapRange
} from './trace-chunk-data';

/** User-facing reason used for loaded chunk rows hidden by the active time window. */
export const TRACE_CHUNK_OUTSIDE_WINDOW_REASON_LABEL = 'Hidden by: time window';

/** Hidden trace-chunk search result backed by a loaded normalized chunk row. */
export type TraceChunkSpanSearchResult = {
  /** Stable search-result id for the current chunk store. */
  readonly id: string;
  /** Trace chunk key that owns this row. */
  readonly chunkKey: string;
  /** Stable chunk-local row index for this span. */
  readonly rowIndex: number;
  /** Stable source identity used for parent-pointer traversal. */
  readonly externalSpanId: string;
  /** Stable external id of this span's parent, when the source provided one. */
  readonly parentExternalSpanId: string | null;
  /** User-facing span label. */
  readonly name: string;
  /** Source filename/source label, when present. */
  readonly source: string | null;
  /** Bitmask describing which active span filters matched this chunk row. */
  readonly filterMask: TraceSpanFilterMask;
  /** User-facing hidden-state reason text for search results and inspector notices. */
  readonly reasonLabel: string;
  /** Primary timing key selected for display and duration search. */
  readonly primaryTimingKey: string;
  /** Timing projections for this span row. */
  readonly timings: Readonly<Record<string, TraceSpanTiming>>;
  /** Card keyword labels kept with the span. */
  readonly keywords: readonly string[];
  /** Compatibility user-data payload kept with the span. */
  readonly userData: Readonly<Record<string, unknown>>;
  /** Window-overlap envelopes kept with the span. */
  readonly overlapRanges: readonly TraceChunkSpanOverlapRange[];
};

/** Navigation targets lazily resolved for a hidden trace-chunk span. */
export type TraceChunkSpanNavigation = {
  /** Nearest visible ancestor in the active graph, when available. */
  readonly visibleAncestorSpanRef: SpanRef | null;
  /** First visible descendant in the active graph, when available. */
  readonly visibleDescendantSpanRef: SpanRef | null;
};

/**
 * Search every ready normalized trace-chunk row without triggering additional chunk loads.
 */
export function searchTraceChunkStoreSpans<
  TPayload,
  TDescriptor extends TraceChunkDescriptor
>(params: {
  /** Active trace chunk store. */
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor>;
  /** Active materialized graph used only for filter/window provenance. */
  readonly traceGraph: TraceGraphSpanSearchContext;
  /** Shared search predicate used to match normalized row text. */
  readonly matchesSearchText: (searchText: string) => boolean;
  /** Maximum number of span records to return. */
  readonly limit: number;
}): TraceGraphSpanSearchRecord[] {
  const visibleResults: TraceGraphSpanSearchRecord[] = [];
  const hiddenResults: TraceGraphSpanSearchRecord[] = [];
  const resultLimit = Math.max(0, params.limit);
  if (resultLimit === 0) {
    return [];
  }
  const searchStartTimeMs = performance.now();
  const exactExternalIdQuery = getTraceSpanExactExternalIdQuery(params.matchesSearchText);
  const exactResults = exactExternalIdQuery
    ? searchReadyTraceChunkExactExternalIdSpans({
        traceChunkStore: params.traceChunkStore,
        traceGraph: params.traceGraph,
        exactExternalIdQuery,
        limit: resultLimit
      })
    : [];
  const exactMatchedSpanRefs = new Set(exactResults.map(result => result.spanRef));
  const plainTextQuery = getSingleTokenTraceSpanPlainTextQuery(params.matchesSearchText);
  const plainTextSearchQuery = plainTextQuery
    ? buildTraceChunkPlainTextSearchQuery(plainTextQuery)
    : null;
  let activePlainTextSpanSearchMatcher: TraceChunkPlainTextSpanSearchMatcher | null = null;
  let activePlainTextSpanSearchChunkIndex = -1;
  let activeSpanSearchRecordColumns: TraceChunkSpanSearchRecordColumns | null = null;
  let activeSpanSearchRecordChunkIndex = -1;

  const visitedStats = visitReadyTraceChunkSpanRefs(
    params.traceChunkStore,
    (spanRefRowIndex, readyChunk, spanSearchColumns) => {
      if (exactResults.length >= resultLimit || visibleResults.length >= resultLimit) {
        return false;
      }
      const spanRef = encodeSpanRef(readyChunk.chunkIndex, spanRefRowIndex);
      if (exactMatchedSpanRefs.has(spanRef)) {
        return;
      }
      if (plainTextSearchQuery && activePlainTextSpanSearchChunkIndex !== readyChunk.chunkIndex) {
        activePlainTextSpanSearchMatcher = buildTraceChunkPlainTextSpanSearchMatcher(
          readyChunk.payload,
          spanSearchColumns,
          plainTextSearchQuery
        );
        activePlainTextSpanSearchChunkIndex = readyChunk.chunkIndex;
      }
      if (
        !matchesTraceChunkSpanSearchText({
          payload: readyChunk.payload,
          spanRefRowIndex,
          spanSearchColumns,
          matchesSearchText: params.matchesSearchText,
          plainTextSpanSearchMatcher: activePlainTextSpanSearchMatcher
        })
      ) {
        return;
      }
      const spanSearchRecordColumns =
        activeSpanSearchRecordChunkIndex === readyChunk.chunkIndex && activeSpanSearchRecordColumns
          ? activeSpanSearchRecordColumns
          : readTraceChunkSpanSearchRecordColumns(readyChunk.payload.spanTable);
      activeSpanSearchRecordColumns = spanSearchRecordColumns;
      activeSpanSearchRecordChunkIndex = readyChunk.chunkIndex;
      const record = buildTraceChunkSpanSearchRecord({
        spanRefRowIndex,
        spanSearchColumns,
        spanSearchRecordColumns,
        readyChunk,
        traceGraph: params.traceGraph
      });
      if (!record) {
        return;
      }
      if (record.filterReason.isFiltered) {
        if (hiddenResults.length < resultLimit) {
          hiddenResults.push(record);
        }
        return;
      }
      visibleResults.push(record);
    }
  );
  const textResults = visibleResults.concat(
    hiddenResults.slice(0, Math.max(0, resultLimit - visibleResults.length))
  );
  const results = exactResults.concat(
    textResults.slice(0, Math.max(0, resultLimit - exactResults.length))
  );
  log.probe(0, 'TraceChunkStore search spans done', {
    readyChunkCount: visitedStats.readyChunkCount,
    scannedRowCount: visitedStats.rowCount,
    matchCount: results.length,
    limit: resultLimit,
    searchMode: exactExternalIdQuery
      ? 'exact-external-id'
      : plainTextSearchQuery
        ? plainTextSearchQuery.utf8View
          ? 'plain-single-token-utf8'
          : 'plain-single-token'
        : 'generic',
    durationMs: performance.now() - searchStartTimeMs,
    ...getHeapUsageProbeFields()
  })();
  return results;
}

/**
 * Resolve render data for a ready normalized trace-chunk row by store-backed span ref.
 */
export function getTraceChunkStoreSpanDetailSource<
  TPayload,
  TDescriptor extends TraceChunkDescriptor
>(
  traceChunkStore: TraceChunkStore<TPayload, TDescriptor>,
  spanRef: SpanRef
): TraceSpanDetailSource | null {
  const matched = findReadyTraceChunkRowBySpanRef(traceChunkStore, spanRef);
  return matched ? buildTraceChunkSpanSource(matched.row, spanRef) : null;
}

/**
 * Resolve render data for one ready normalized trace-chunk row without scanning the store.
 */
export function getTraceChunkSpanDetailSource(
  payload: TraceChunk,
  spanRef: SpanRef
): TraceSpanDetailSource | null {
  if (payload.chunkIndex !== getSpanRefChunkIndex(spanRef)) {
    return null;
  }
  const row = readTraceChunkSpanRow(
    payload,
    getSpanRefRowIndex(spanRef),
    readTraceChunkSpanColumns(payload.spanTable)
  );
  return row ? buildTraceChunkSpanSource(row, spanRef) : null;
}

/**
 * Resolve visible navigation targets for a store-backed normalized trace-chunk row.
 */
export function getTraceChunkStoreSpanFilterNavigation<
  TPayload,
  TDescriptor extends TraceChunkDescriptor
>(params: {
  /** Active trace chunk store. */
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor>;
  /** Active visible TraceGraph used to resolve visible span refs. */
  readonly traceGraph: TraceGraph;
  /** Store-backed span ref whose visible relatives should be resolved. */
  readonly spanRef: SpanRef;
}): TraceGraphSpanFilterNavigation | null {
  const matched = findReadyTraceChunkRowBySpanRef(params.traceChunkStore, params.spanRef);
  if (!matched) {
    return null;
  }
  const filterReason = params.traceGraph.spanFilterReason(params.spanRef, {
    spanName: matched.row.name,
    source: matched.row.source
  });
  const result = buildTraceChunkSpanSearchResult({
    filterReason,
    readyChunk: matched.readyChunk,
    row: matched.row
  });
  const navigation = resolveHiddenTraceChunkSpanNavigation({
    result,
    traceChunkStore: params.traceChunkStore,
    traceGraph: params.traceGraph
  });
  return {
    filterMask: filterReason.filterMask,
    reasonLabel:
      filterReason.state === 'outside-window'
        ? buildHiddenTraceChunkSpanReasonLabel(filterReason.filterMask)
        : undefined,
    visibleAncestorSpanRef: navigation.visibleAncestorSpanRef,
    visibleDescendantSpanRef: navigation.visibleDescendantSpanRef
  };
}

/**
 * Search ready trace chunks for loaded spans hidden by the active visible time window.
 */
export function searchHiddenTraceChunkSpans<TDescriptor extends TraceChunkDescriptor>(params: {
  /** Active trace chunk store. */
  readonly traceChunkStore: TraceChunkStore<TraceChunk, TDescriptor>;
  /** Active visible TraceGraph used to determine loaded row availability. */
  readonly traceGraph: TraceGraph;
  /** Shared search predicate used to match span name and source text. */
  readonly matchesQuery: (searchText: string) => boolean;
  /** Maximum number of hidden results to return. */
  readonly limit: number;
}): TraceChunkSpanSearchResult[] {
  const results: TraceChunkSpanSearchResult[] = [];
  const plainTextQuery = getSingleTokenTraceSpanPlainTextQuery(params.matchesQuery);
  const plainTextSearchQuery = plainTextQuery
    ? buildTraceChunkPlainTextSearchQuery(plainTextQuery)
    : null;
  let activePlainTextSpanSearchMatcher: TraceChunkPlainTextSpanSearchMatcher | null = null;
  let activePlainTextSpanSearchChunkIndex = -1;
  visitReadyTraceChunkSpanRefs(
    params.traceChunkStore,
    (spanRefRowIndex, readyChunk, spanSearchColumns) => {
      if (results.length >= params.limit) {
        return false;
      }
      if (plainTextSearchQuery && activePlainTextSpanSearchChunkIndex !== readyChunk.chunkIndex) {
        activePlainTextSpanSearchMatcher = buildTraceChunkPlainTextSpanSearchMatcher(
          readyChunk.payload,
          spanSearchColumns,
          plainTextSearchQuery
        );
        activePlainTextSpanSearchChunkIndex = readyChunk.chunkIndex;
      }
      if (!readyChunk.payload.indexes.externalSpanIdByRowIndex[spanRefRowIndex]) {
        return;
      }

      const spanTableRowIndex = getTraceChunkSpanTableRowIndex(readyChunk.payload, spanRefRowIndex);
      if (spanTableRowIndex == null) {
        return;
      }
      const name = readColumnValue(spanSearchColumns.name, spanTableRowIndex);
      if (!name) {
        return;
      }
      const source = readColumnValue(spanSearchColumns.source, spanTableRowIndex) ?? null;
      const spanRef = encodeSpanRef(readyChunk.chunkIndex, spanRefRowIndex);
      const filterReason = params.traceGraph.spanFilterReason(spanRef, {
        spanName: name,
        source
      });
      if (filterReason.state !== 'outside-window') {
        return;
      }

      const searchSource = activePlainTextSpanSearchMatcher ? null : source;
      if (
        activePlainTextSpanSearchMatcher
          ? !traceChunkSpanSearchColumnMatchesPlainTextQuery({
              column: spanSearchColumns.name,
              utf8Source: activePlainTextSpanSearchMatcher.nameUtf8Source,
              utf8View: activePlainTextSpanSearchMatcher.nameUtf8View,
              rowIndex: spanTableRowIndex,
              query: activePlainTextSpanSearchMatcher.query
            }) &&
            !traceChunkSpanSearchColumnMatchesPlainTextQuery({
              column: spanSearchColumns.source,
              utf8Source: activePlainTextSpanSearchMatcher.sourceUtf8Source,
              utf8View: activePlainTextSpanSearchMatcher.sourceUtf8View,
              rowIndex: spanTableRowIndex,
              query: activePlainTextSpanSearchMatcher.query
            })
          : !params.matchesQuery(`${name} ${searchSource ?? ''}`.toLowerCase())
      ) {
        return;
      }

      const row = readReadyTraceChunkSpanRow(readyChunk, spanRefRowIndex);
      if (!row) {
        return;
      }
      results.push(buildTraceChunkSpanSearchResult({filterReason, readyChunk, row}));
    }
  );
  return results;
}

/**
 * Resolve visible ancestor and descendant targets for a hidden trace-chunk span.
 */
export function resolveHiddenTraceChunkSpanNavigation<
  TPayload,
  TDescriptor extends TraceChunkDescriptor
>(params: {
  /** Hidden span selected from trace-chunk search. */
  readonly result: TraceChunkSpanSearchResult;
  /** Active trace chunk store. */
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor>;
  /** Active visible TraceGraph used to resolve visible span refs. */
  readonly traceGraph: TraceGraph;
}): TraceChunkSpanNavigation {
  return {
    visibleAncestorSpanRef: resolveVisibleAncestorSpanRef(params),
    visibleDescendantSpanRef: resolveVisibleDescendantSpanRef(params)
  };
}

/**
 * Build a one-span TraceGraph for rendering details for a loaded span outside the window.
 */
export function buildHiddenTraceChunkSpanInspectorGraph(
  result: TraceChunkSpanSearchResult,
  options?: {
    /** Active span filters used to mark the synthetic inspector span as filtered. */
    readonly spanFilters?: readonly string[];
  }
): {traceGraph: TraceGraph; spanRef: SpanRef} {
  const processId = 'hidden-trace-chunk-process';
  const threadId = 'hidden-trace-chunk-thread' as TraceThreadId;
  const spanId = `hidden-trace-chunk:${result.externalSpanId}` as TraceSpanId;
  const thread: TraceThread = {
    type: 'trace-thread',
    threadId,
    name: 'Hidden loaded chunk spans',
    processId
  };
  const span: TraceSpan = {
    type: 'trace-span',
    spanId,
    threadId,
    processName: 'Hidden loaded chunk span',
    name: result.name,
    keywords: [...result.keywords],
    primaryTimingKey: result.primaryTimingKey,
    timings: result.timings as Record<string, TraceSpanTiming>,
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: [],
    userData: {
      ...result.userData,
      source: result.source
    }
  };
  const process: TraceProcess = {
    type: 'trace-process',
    processId,
    name: 'Hidden loaded chunk span',
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [span],
    spanMap: {[span.spanId]: span},
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    sameProcessDependencies: [],
    remoteDependencies: []
  };
  const traceDataset = buildHiddenTraceChunkSpanInspectorDataset(process);
  const traceGraph = new TraceGraph(
    {traceDataset},
    buildTraceViewSnapshot(traceDataset, {spanFilters: options?.spanFilters})
  );
  const spanRef = traceGraph.getSpanRefById(spanId);
  if (spanRef == null) {
    throw new Error('Hidden trace-chunk span inspector graph did not contain its span.');
  }
  return {traceGraph, spanRef};
}

/**
 * Build one canonical Arrow dataset for the synthetic hidden-span inspector graph.
 *
 * The inspector is intentionally tiny, but it still enters the runtime through the same
 * store-finalized chunk and immutable dataset seam as loaded traces. This avoids constructing a
 * JSON graph only to project it back into Arrow tables before TraceGraph can read the span.
 */
function buildHiddenTraceChunkSpanInspectorDataset(process: TraceProcess): TraceDataset {
  const ownerRefRegistry = new TraceOwnerRefRegistry();
  const processRef = ownerRefRegistry.upsertProcess(process);
  for (const thread of process.threads) {
    ownerRefRegistry.upsertThread(thread);
  }
  const [chunkData] = buildTraceChunkDataFromTraceProcesses([process]);
  if (!chunkData) {
    throw new Error('Hidden trace-chunk span inspector dataset did not contain a chunk.');
  }
  const chunk = finalizeTraceChunkData({
    data: chunkData,
    chunkIndex: 0,
    chunkRef: encodeChunkRef(0),
    processRefs: [processRef]
  });
  return buildTraceDatasetFromReadyTraceChunks({
    name: 'Hidden loaded chunk span',
    ownerRefRegistry,
    readyChunks: [{payload: chunk}]
  });
}

/**
 * Build a canonical row-selected dataset for one trace window from ready normalized chunks.
 *
 * The dataset keeps every store-finalized chunk object and Arrow table by identity. Row-level
 * window selection is represented only by ascending active span refs, while the dependency tables,
 * stats, and time extents preserve the established visible-window semantics.
 */
export function buildTraceChunkWindowDataset<TDescriptor extends TraceChunkDescriptor>(params: {
  /** Human-friendly name for the materialized TraceDataset. */
  readonly name: string;
  /** Trace-global process/thread owner-ref allocator kept for materializer compatibility. */
  readonly ownerRefRegistry: TraceOwnerRefRegistry;
  /** Registered trace window being materialized. */
  readonly window: TraceChunkStoreWindow;
  /** Ready normalized chunks that may contribute visible rows. */
  readonly readyChunks: readonly TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>[];
}): TraceDataset {
  const buildStartTime = performance.now();
  const rowSelectionStartTime = performance.now();
  const selectedRows = selectTraceChunkRowsForWindow(params.readyChunks, params.window);
  const rowSelectionDurationMs = performance.now() - rowSelectionStartTime;
  const dependencyBuildStartTime = performance.now();
  const dependencies = buildTraceChunkParentDependencies(selectedRows);
  const dependencyBuildDurationMs = performance.now() - dependencyBuildStartTime;
  const processBuildStartTime = performance.now();
  const ownerRefSnapshot = params.ownerRefRegistry.createSnapshot();
  const processes = buildArrowTraceProcesses({
    ownerRefRegistry: params.ownerRefRegistry,
    sameProcessDependenciesByProcessId: dependencies.sameProcessDependenciesByProcessId
  }).map(stripTraceChunkWindowProcessDependencyMetadata);
  const processBuildDurationMs = performance.now() - processBuildStartTime;
  const selectedSpanRefs = selectedRows.map(row => row.spanRef).sort((left, right) => left - right);
  const traceDatasetStartTime = performance.now();
  const chunks = params.readyChunks
    .map(readyChunk => readyChunk.payload)
    .sort((left, right) => left.chunkIndex - right.chunkIndex);
  const sameProcessDependencyTableMap = buildSameProcessDependencyTableMap(
    processes,
    dependencies.sameProcessDependenciesByProcessId
  );
  const processSpanTableMap = buildTraceProcessSpanRefTables(chunks, processes, {
    processIdsByIndex: ownerRefSnapshot.processIdsByIndex,
    spanRefs: selectedSpanRefs
  });
  const refSources = buildTraceDatasetRefSources({
    processIdsByIndex: ownerRefSnapshot.processIdsByIndex,
    processSpanTableMap,
    sameProcessDependencyTableMap
  });
  const traceDataset = {
    type: 'trace-dataset',
    revision: 0,
    name: params.name,
    processes,
    chunks,
    spanRefs: selectedSpanRefs,
    sameProcessDependencyTableMap,
    crossProcessDependencyTable: buildArrowTraceCrossProcessDependencyTable(
      dependencies.crossProcessDependencies
    ),
    events: EMPTY_ARROW_TRACE_EVENT_TABLE,
    ownerRefSnapshot,
    timeExtents: buildTraceChunkWindowTimeExtents(selectedRows),
    stats: buildTraceChunkWindowStats({
      dependencies,
      processes,
      selectedRows
    }),
    processSpanTableMap,
    ...refSources
  } satisfies TraceDataset;
  const traceDatasetDurationMs = performance.now() - traceDatasetStartTime;
  log.probe(0, 'TraceChunk window materialization done', {
    name: params.name,
    readyChunkCount: params.readyChunks.length,
    selectedSpanRefCount: selectedSpanRefs.length,
    selectedProcessRefCount: countSelectedProcessRefs(selectedRows),
    missingOwnerProcessRefCount: countSelectedRowsWithMissingOwnerProcessRef(
      selectedRows,
      ownerRefSnapshot.processIdByRef
    ),
    processCount: processes.length,
    displaySourceReadyRowCount: selectedRows.length,
    dependencyCount:
      dependencies.crossProcessDependencies.length +
      [...dependencies.sameProcessDependenciesByProcessId.values()].reduce(
        (total, processDependencies) => total + processDependencies.length,
        0
      ),
    rowSelectionDurationMs,
    dependencyBuildDurationMs,
    processBuildDurationMs,
    traceDatasetDurationMs,
    durationMs: performance.now() - buildStartTime,
    ...getHeapUsageProbeFields()
  })();
  return traceDataset;
}

/** Walks chunk parent pointers upward until a visible active-graph ancestor is found. */
function resolveVisibleAncestorSpanRef<TPayload, TDescriptor extends TraceChunkDescriptor>(params: {
  /** Hidden loaded span whose parent chain should be traversed. */
  readonly result: TraceChunkSpanSearchResult;
  /** Loaded chunk store used to follow normalized parent pointers. */
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor>;
  /** Active graph used to resolve visible ancestor span refs. */
  readonly traceGraph: TraceGraph;
}): SpanRef | null {
  let parentExternalSpanId = params.result.parentExternalSpanId;
  const visited = new Set<string>();
  for (let depth = 0; parentExternalSpanId && depth < 1000; depth += 1) {
    if (visited.has(parentExternalSpanId)) {
      return null;
    }
    visited.add(parentExternalSpanId);

    const visibleSpanRef = resolveVisibleSpanRefByExternalSpanId(
      params.traceGraph,
      parentExternalSpanId
    );
    if (visibleSpanRef != null) {
      return visibleSpanRef;
    }

    const parentRow = findReadyTraceChunkRow(params.traceChunkStore, parentExternalSpanId);
    parentExternalSpanId = parentRow?.parentExternalSpanId ?? null;
  }
  return null;
}

/** Scans chunk parent pointers downward until a visible active-graph descendant is found. */
function resolveVisibleDescendantSpanRef<
  TPayload,
  TDescriptor extends TraceChunkDescriptor
>(params: {
  /** Hidden loaded span whose child chain should be traversed. */
  readonly result: TraceChunkSpanSearchResult;
  /** Loaded chunk store used to follow normalized child pointers. */
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor>;
  /** Active graph used to resolve visible descendant span refs. */
  readonly traceGraph: TraceGraph;
}): SpanRef | null {
  const queue: string[] = [params.result.externalSpanId];
  const visited = new Set<string>();
  for (let visitCount = 0; queue.length > 0 && visitCount < 5000; visitCount += 1) {
    const currentExternalSpanId = queue.shift()!;
    if (visited.has(currentExternalSpanId)) {
      continue;
    }
    visited.add(currentExternalSpanId);

    let foundSpanRef: SpanRef | null = null;
    visitReadyTraceChunkSpanRefs(params.traceChunkStore, (spanRefRowIndex, readyChunk) => {
      const externalSpanId = readyChunk.payload.indexes.externalSpanIdByRowIndex[spanRefRowIndex];
      if (
        !externalSpanId ||
        readyChunk.payload.indexes.parentExternalSpanIdByRowIndex[spanRefRowIndex] !==
          currentExternalSpanId
      ) {
        return;
      }

      const visibleSpanRef = resolveVisibleSpanRefByExternalSpanId(
        params.traceGraph,
        externalSpanId
      );
      if (visibleSpanRef != null) {
        foundSpanRef = visibleSpanRef;
        return false;
      }
      queue.push(externalSpanId);
    });

    if (foundSpanRef != null) {
      return foundSpanRef;
    }
  }
  return null;
}

/** Finds an unfiltered active-graph span by its generic external span id. */
function resolveVisibleSpanRefByExternalSpanId(
  traceGraph: TraceGraph,
  externalSpanId: string
): SpanRef | null {
  for (const spanRef of iterateTraceGraphSpanRefs(traceGraph)) {
    if (traceGraph.spanIsFiltered(spanRef)) {
      continue;
    }
    const spanExternalSpanId = getTraceGraphSpanExternalSpanId(traceGraph, spanRef);
    if (
      spanExternalSpanId === externalSpanId ||
      (spanExternalSpanId == null && traceGraph.getSpanId(spanRef) === externalSpanId)
    ) {
      return spanRef;
    }
  }
  return null;
}

/** Finds one ready chunk row by its generic external span id. */
function findReadyTraceChunkRow<TPayload, TDescriptor extends TraceChunkDescriptor>(
  traceChunkStore: TraceChunkStore<TPayload, TDescriptor>,
  externalSpanId: string
): TraceChunkSpanRowView | null {
  for (const readyChunk of traceChunkStore.getReadyChunks(traceChunkStore.getDescriptors())) {
    if (!isTraceChunk(readyChunk.payload)) {
      continue;
    }
    const traceChunkReadyChunk = readyChunk as TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>;
    const spanRefRowIndex =
      traceChunkReadyChunk.payload.indexes.rowIndexByExternalSpanId.get(externalSpanId);
    if (spanRefRowIndex == null) {
      continue;
    }
    const row = readReadyTraceChunkSpanRow(traceChunkReadyChunk, spanRefRowIndex);
    if (row) {
      return row;
    }
  }
  return null;
}

/**
 * Finds exact external ids in ready chunks through existing chunk indexes without scanning rows.
 */
function searchReadyTraceChunkExactExternalIdSpans<
  TPayload,
  TDescriptor extends TraceChunkDescriptor
>(params: {
  /** Active trace chunk store. */
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor>;
  /** Active materialized graph used only for filter/window provenance. */
  readonly traceGraph: TraceGraphSpanSearchContext;
  /** Case-sensitive external span id supplied by Omnibox search. */
  readonly exactExternalIdQuery: string;
  /** Maximum number of exact results to return. */
  readonly limit: number;
}): TraceGraphSpanSearchRecord[] {
  const results: TraceGraphSpanSearchRecord[] = [];
  const readyChunks = params.traceChunkStore.getReadyChunks(
    params.traceChunkStore.getDescriptors()
  );
  for (const readyChunk of readyChunks) {
    if (!isTraceChunk(readyChunk.payload)) {
      continue;
    }
    const traceChunkReadyChunk = readyChunk as TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>;
    const spanRefRowIndex =
      traceChunkReadyChunk.payload.indexes.rowIndexByExternalSpanId.get(
        params.exactExternalIdQuery
      ) ?? null;
    if (spanRefRowIndex == null) {
      continue;
    }
    const record = buildTraceChunkSpanSearchRecord({
      spanRefRowIndex,
      spanSearchColumns: readTraceChunkSpanSearchColumns(traceChunkReadyChunk.payload.spanTable),
      spanSearchRecordColumns: readTraceChunkSpanSearchRecordColumns(
        traceChunkReadyChunk.payload.spanTable
      ),
      readyChunk: traceChunkReadyChunk,
      traceGraph: params.traceGraph
    });
    if (!record) {
      continue;
    }
    results.push(record);
    if (results.length >= params.limit) {
      return results;
    }
  }
  return results;
}

/** Finds one ready chunk row by its exact store-backed span ref. */
function findReadyTraceChunkRowBySpanRef<TPayload, TDescriptor extends TraceChunkDescriptor>(
  traceChunkStore: TraceChunkStore<TPayload, TDescriptor>,
  spanRef: SpanRef
): {
  readonly row: TraceChunkSpanRowView;
  readonly readyChunk: TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>;
} | null {
  const chunkIndex = getSpanRefChunkIndex(spanRef);
  const rowIndex = getSpanRefRowIndex(spanRef);
  const readyChunk = traceChunkStore.getReadyChunkByIndex(chunkIndex);
  if (!readyChunk || !isTraceChunk(readyChunk.payload)) {
    return null;
  }
  const traceChunkReadyChunk = readyChunk as TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>;
  if (!traceChunkHasSpanRefRow(traceChunkReadyChunk.payload, rowIndex)) {
    return null;
  }
  const row = readReadyTraceChunkSpanRow(traceChunkReadyChunk, rowIndex);
  return row ? {row, readyChunk: traceChunkReadyChunk} : null;
}

/** Iterates ready chunk span-ref rows with minimal search vectors and no row views. */
function visitReadyTraceChunkSpanRefs<TPayload, TDescriptor extends TraceChunkDescriptor>(
  traceChunkStore: TraceChunkStore<TPayload, TDescriptor>,
  visitSpanRef: (
    spanRefRowIndex: number,
    readyChunk: TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>,
    spanSearchColumns: TraceChunkSpanSearchColumns
  ) => boolean | void
): TraceChunkRowVisitStats {
  const readyChunks = traceChunkStore.getReadyChunks(traceChunkStore.getDescriptors());
  let readyChunkCount = 0;
  let rowCount = 0;
  for (const readyChunk of readyChunks) {
    if (!isTraceChunk(readyChunk.payload)) {
      continue;
    }
    readyChunkCount += 1;
    const traceChunkReadyChunk = readyChunk as TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>;
    const spanSearchColumns = readTraceChunkSpanSearchColumns(
      traceChunkReadyChunk.payload.spanTable
    );
    const spanRowCount = traceChunkReadyChunk.payload.spanTable.numRows;
    for (let rowIndex = 0; rowIndex < spanRowCount; rowIndex += 1) {
      rowCount += 1;
      if (visitSpanRef(rowIndex, traceChunkReadyChunk, spanSearchColumns) === false) {
        return {readyChunkCount, rowCount};
      }
    }
  }
  return {readyChunkCount, rowCount};
}

/** Materializes one rich normalized chunk row only after its span ref is selected. */
function readReadyTraceChunkSpanRow<TDescriptor extends TraceChunkDescriptor>(
  readyChunk: TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>,
  spanRefRowIndex: number
): TraceChunkSpanRowView | null {
  return readTraceChunkSpanRow(
    readyChunk.payload,
    spanRefRowIndex,
    readTraceChunkSpanColumns(readyChunk.payload.spanTable)
  );
}

/** Converts one matched chunk span ref into canonical search metadata. */
function buildTraceChunkSpanSearchRecord<TDescriptor extends TraceChunkDescriptor>(params: {
  /** Matched chunk-local span-ref row index. */
  readonly spanRefRowIndex: number;
  /** Minimal span-table vectors already read before matching. */
  readonly spanSearchColumns: TraceChunkSpanSearchColumns;
  /** Span-table vectors read only after the search row matches. */
  readonly spanSearchRecordColumns: TraceChunkSpanSearchRecordColumns;
  /** Ready store chunk containing the matched span ref. */
  readonly readyChunk: TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>;
  /** Active materialized graph used for filter provenance. */
  readonly traceGraph: TraceGraphSpanSearchContext;
}): TraceGraphSpanSearchRecord | null {
  const spanTableRowIndex = getTraceChunkSpanTableRowIndex(
    params.readyChunk.payload,
    params.spanRefRowIndex
  );
  if (spanTableRowIndex == null) {
    return null;
  }
  const processRef = readArrowRefColumn(params.spanSearchColumns.processRef, spanTableRowIndex);
  const process = resolveTraceChunkRowProcess(params.readyChunk.payload, processRef);
  const threadId = readColumnValue(params.spanSearchColumns.threadId, spanTableRowIndex);
  const name = readColumnValue(params.spanSearchColumns.name, spanTableRowIndex);
  const spanId = readColumnValue(params.spanSearchRecordColumns.spanId, spanTableRowIndex);
  if (!process || !threadId || !name || !spanId) {
    return null;
  }
  const spanRef = encodeSpanRef(params.readyChunk.chunkIndex, params.spanRefRowIndex);
  const primaryTiming = readPrimaryTiming(params.spanSearchRecordColumns, spanTableRowIndex);
  const keywords = readTraceChunkSidecarKeywords(params.readyChunk.payload, spanTableRowIndex);
  const source = readColumnValue(params.spanSearchColumns.source, spanTableRowIndex) ?? null;
  const filterReason = params.traceGraph.spanFilterReason(spanRef, {
    spanName: name,
    source
  });
  return {
    spanRef,
    spanId,
    blockName: name,
    processName: process.name,
    threadName: process.threadMap[threadId]?.name ?? threadId,
    primaryTiming,
    keywordsText: keywords.join(' '),
    searchText: name.toLowerCase(),
    filterMask: filterReason.filterMask,
    filterReason
  };
}

/** Converts one normalized chunk row into the legacy hidden-result shape. */
function buildTraceChunkSpanSearchResult<TDescriptor extends TraceChunkDescriptor>(params: {
  readonly row: TraceChunkSpanRowView;
  readonly readyChunk: TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>;
  readonly filterReason: {readonly filterMask: TraceSpanFilterMask};
}): TraceChunkSpanSearchResult {
  return {
    id: `${params.readyChunk.descriptor.chunkKey}:${params.row.rowIndex}:${params.row.externalSpanId}`,
    chunkKey: params.readyChunk.descriptor.chunkKey,
    rowIndex: params.row.rowIndex,
    externalSpanId: params.row.externalSpanId ?? params.row.spanId,
    parentExternalSpanId: params.row.parentExternalSpanId,
    name: params.row.name,
    source: params.row.source,
    filterMask: params.filterReason.filterMask,
    reasonLabel: buildHiddenTraceChunkSpanReasonLabel(params.filterReason.filterMask),
    primaryTimingKey: params.row.primaryTimingKey,
    timings: params.row.timings,
    keywords: params.row.keywords,
    userData: params.row.userData,
    overlapRanges: params.row.overlapRanges
  };
}

/** Converts one normalized chunk row into one lightweight span source. */
function buildTraceChunkSpanSource(
  row: TraceChunkSpanRowView,
  spanRef: SpanRef
): TraceSpanDetailSource | null {
  if (row.processRef == null || row.threadRef == null) {
    return null;
  }
  const spanSource = {
    spanRef,
    processRef: row.processRef,
    threadRef: row.threadRef,
    spanId: row.spanId,
    threadId: row.thread.threadId,
    primaryTimingKey: row.primaryTimingKey,
    timings: row.timings as Record<string, TraceSpanTiming>,
    userData: {...row.userData},
    processName: row.process.name,
    name: row.name,
    source: row.source,
    keywords: [...row.keywords],
    crossProcessEndpointId: row.crossProcessEndpointId,
    crossProcessDependencyEndpoints: row.crossProcessDependencyEndpoints.map(endpoint => ({
      ...endpoint,
      type: 'cross-process-dependency-endpoint'
    }))
  } satisfies TraceSpanDetailSource;

  return spanSource;
}

/** Builds normalized lowercase row text for store-backed span search. */
function buildTraceChunkSpanSearchText(
  name: string,
  source: string | null,
  keywords: readonly string[],
  processName: string,
  threadName: string
): string {
  return [name, source ?? '', keywords.join(' '), processName, threadName].join('\n').toLowerCase();
}

/** Builds the user-facing hidden reason from the active TraceGraph filter mask. */
function buildHiddenTraceChunkSpanReasonLabel(filterMask: TraceSpanFilterMask): string {
  const reasonParts = ['time window'];
  if (hasTraceSpanNameFilter(filterMask)) {
    reasonParts.push('span-name filter');
  }
  if (hasTraceSpanSourceFilter(filterMask)) {
    reasonParts.push('filename filter');
  }
  return `Hidden by: ${reasonParts.join(', ')}`;
}

/** Transient view over one row inside a normalized trace chunk. */
type TraceChunkSpanRowView = {
  /** Direct chunk-local span-table row index encoded into store-owned span refs. */
  readonly rowIndex: number;
  /** Backing Arrow span-table row index for this span row. */
  readonly spanTableRowIndex: number;
  /** Stable internal span id used by TraceGraph dependencies. */
  readonly spanId: TraceSpanId;
  /** Stable source identity used for URL lookup and parent pointers. */
  readonly externalSpanId: string | null;
  /** Stable external id of this span's parent, when the source provided one. */
  readonly parentExternalSpanId: string | null;
  /** Process metadata read from the normalized chunk. */
  readonly process: ArrowTraceProcessMetadata;
  /** Chunk-authored process ref for this row, when present. */
  readonly processRef: ProcessRef | null;
  /** Thread metadata read from the normalized chunk process. */
  readonly thread: TraceThread;
  /** Chunk-authored thread ref for this row, when present. */
  readonly threadRef: ThreadRef | null;
  /** User-facing span label. */
  readonly name: string;
  /** Optional source label used by filters and cards. */
  readonly source: string | null;
  /** Card keyword labels kept with the span. */
  readonly keywords: readonly string[];
  /** Primary timing key selected for display and duration search. */
  readonly primaryTimingKey: string;
  /** Timing projections kept with the span. */
  readonly timings: Readonly<Record<string, TraceSpanTiming>>;
  /** Compatibility user-data payload kept with the span. */
  readonly userData: Readonly<Record<string, unknown>>;
  /** Window-overlap envelopes kept with the span. */
  readonly overlapRanges: readonly TraceChunkSpanOverlapRange[];
  /** Optional unresolved cross-process endpoint id. */
  readonly crossProcessEndpointId: TraceCrossProcessEndpointId | null;
  /** Structured unresolved cross-process endpoints attached to the span. */
  readonly crossProcessDependencyEndpoints: readonly TraceCrossProcessEndpoint[];
};

/** Minimal Arrow vector surface needed by chunk-window row readers. */
type ColumnVector<Value> = {
  /** Returns the value stored at one Arrow row index. */
  get(index: number): Value | null | undefined;
};

/** Span-table vectors reused while scanning a normalized trace chunk. */
type TraceChunkSpanColumns = {
  /** Runtime process ref column. */
  readonly processRef: ColumnVector<unknown> | null;
  /** Runtime thread ref column. */
  readonly threadRef: ColumnVector<unknown> | null;
  /** Stable legacy span id column. */
  readonly spanId: ColumnVector<TraceSpanId> | null;
  /** Optional external span id column. */
  readonly externalSpanId: ColumnVector<string> | null;
  /** Owning thread id column. */
  readonly threadId: ColumnVector<TraceThreadId> | null;
  /** Span display name column. */
  readonly name: ColumnVector<string> | null;
  /** Optional source label column. */
  readonly source: ColumnVector<string> | null;
  /** Primary timing key column. */
  readonly primaryTimingKey: ColumnVector<string> | null;
  /** Compact primary timing-status column. */
  readonly statusCode: ColumnVector<number> | null;
  /** Primary timing start column. */
  readonly startTimeMs: ColumnVector<number> | null;
  /** Primary timing end column. */
  readonly endTimeMs: ColumnVector<number> | null;
  /** Primary timing duration column. */
  readonly durationMs: ColumnVector<number> | null;
};

/** Span-table vectors needed before a search row is known to match. */
type TraceChunkSpanSearchColumns = {
  /** Packed process refs needed only for metadata-backed plain-text matches. */
  readonly processRef: TraceChunkSpanColumns['processRef'];
  /** Thread ids needed only for metadata-backed or unknown-thread plain-text matches. */
  readonly threadId: TraceChunkSpanColumns['threadId'];
  /** Span names scanned before wider search fields. */
  readonly name: TraceChunkSpanColumns['name'];
  /** Optional span source labels scanned after names. */
  readonly source: TraceChunkSpanColumns['source'];
};

/** Primary timing vectors needed after a matched search row is selected. */
type TraceChunkSpanPrimaryTimingColumns = Pick<
  TraceChunkSpanColumns,
  'statusCode' | 'startTimeMs' | 'endTimeMs' | 'durationMs'
>;

/** Span-table vectors needed only after a search row matches. */
type TraceChunkSpanSearchRecordColumns = TraceChunkSpanPrimaryTimingColumns & {
  /** Stable legacy span id column emitted with matched search records. */
  readonly spanId: TraceChunkSpanColumns['spanId'];
};

/** One reusable lowercase plain-text query for one store-backed span search pass. */
type TraceChunkPlainTextSearchQuery = {
  /** Lowercase plain-text query matched against search fields. */
  readonly text: string;
  /** ASCII UTF-8 query bytes used when direct Arrow buffer matching is safe. */
  readonly utf8View: Utf8StringView | null;
};

/** One chunk-local field matcher reused across row scans for one plain-text search pass. */
type TraceChunkPlainTextSpanSearchMatcher = {
  /** Plain-text query shared by every field in this chunk. */
  readonly query: TraceChunkPlainTextSearchQuery;
  /** Direct UTF-8 name buffers, when Arrow exposes them. */
  readonly nameUtf8Source: Utf8ColumnSource | null;
  /** Reusable direct UTF-8 name row view. */
  readonly nameUtf8View: Utf8StringView;
  /** Direct UTF-8 source buffers, when Arrow exposes them. */
  readonly sourceUtf8Source: Utf8ColumnSource | null;
  /** Reusable direct UTF-8 source row view. */
  readonly sourceUtf8View: Utf8StringView;
  /** Direct UTF-8 thread-id buffers, when Arrow exposes them. */
  readonly threadIdUtf8Source: Utf8ColumnSource | null;
  /** Reusable direct UTF-8 thread-id row view. */
  readonly threadIdUtf8View: Utf8StringView;
  /** Whether any process or known-thread display name can match the query. */
  readonly mayMatchProcessOrKnownThreadName: boolean;
};

/** Row selected for one materialized visible trace window. */
type SelectedTraceChunkSpanRow = {
  /** Span ref encoded from the stored chunk slot and direct chunk row index. */
  readonly spanRef: SpanRef;
  /** Owner process ref stored on the original chunk row. */
  readonly processRef: ProcessRef | null;
  /** Stable legacy span id stored on the original chunk row. */
  readonly spanId: TraceSpanId;
  /** Optional external span id used for parent linking. */
  readonly externalSpanId: string | null;
  /** Optional parent external span id used for visible dependency stitching. */
  readonly parentExternalSpanId: string | null;
  /** Ordered parent external span ids used for visible dependency stitching. */
  readonly parentExternalSpanIds: readonly string[];
  /** Process metadata resolved from the chunk row owner ref. */
  readonly process: ArrowTraceProcessMetadata;
  /** Primary timing projection for active-window stats and parent wait estimates. */
  readonly primaryTiming: TraceSpanTiming | null;
};

/** Mutable scratch variant used while reading selected-row fields. */
type MutableSelectedTraceChunkSpanRow = {
  -readonly [Field in keyof SelectedTraceChunkSpanRow]: SelectedTraceChunkSpanRow[Field];
};

/** Row-visitor summary used by chunk-store diagnostics. */
type TraceChunkRowVisitStats = {
  /** Number of ready normalized chunks visited by the row scan. */
  readonly readyChunkCount: number;
  /** Number of row indexes scanned before completion or early termination. */
  readonly rowCount: number;
};

/** Selects ready chunk rows whose overlap envelopes intersect the requested window. */
function selectTraceChunkRowsForWindow<TDescriptor extends TraceChunkDescriptor>(
  readyChunks: readonly TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>[],
  window: TraceChunkStoreWindow
): SelectedTraceChunkSpanRow[] {
  const selectedRows: SelectedTraceChunkSpanRow[] = [];
  const scratchSelectedRow = {} as MutableSelectedTraceChunkSpanRow;
  for (const readyChunk of readyChunks) {
    const spanColumns = readTraceChunkSpanColumns(readyChunk.payload.spanTable);
    const spanRowCount = readyChunk.payload.spanTable.numRows;
    for (let rowIndex = 0; rowIndex < spanRowCount; rowIndex += 1) {
      const overlapRanges = getTraceChunkSpanOverlapRanges(readyChunk.payload, rowIndex);
      if (!doesTraceChunkSpanOverlapWindow(overlapRanges, window)) {
        continue;
      }
      if (readSelectedTraceChunkSpanRow(readyChunk, rowIndex, spanColumns, scratchSelectedRow)) {
        selectedRows.push(copySelectedTraceChunkSpanRow(scratchSelectedRow));
      }
    }
  }
  return selectedRows;
}

/** Returns row-window overlap ranges for one chunk-local span-ref row. */
function getTraceChunkSpanOverlapRanges(
  payload: Pick<TraceChunk, 'rowWindowTable'>,
  spanRefRowIndex: number
): readonly TraceChunkSpanOverlapRange[] {
  return payload.rowWindowTable?.overlapRangesByRow[spanRefRowIndex] ?? [];
}

/** Returns whether any chunk-row overlap envelope intersects a registered trace window. */
function doesTraceChunkSpanOverlapWindow(
  overlapRanges: readonly TraceChunkSpanOverlapRange[],
  window: TraceChunkStoreWindow
): boolean {
  return overlapRanges.some(
    range => range.endTimeMs >= window.minTimeMs && range.startTimeMs <= window.maxTimeMs
  );
}

/** Builds Arrow process metadata from the store's current owner-ref snapshot. */
function buildArrowTraceProcesses(params: {
  readonly ownerRefRegistry: TraceOwnerRefRegistry;
  readonly sameProcessDependenciesByProcessId: ReadonlyMap<
    TraceProcessId,
    TraceSameProcessDependency[]
  >;
}): ArrowTraceProcessMetadata[] {
  return params.ownerRefRegistry.getOwnerProcessSnapshots().map(process => {
    const threads = [...process.threads];
    return {
      ...process,
      threads,
      threadMap: Object.fromEntries(threads.map(thread => [thread.threadId, thread])),
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      sameProcessDependencies:
        params.sameProcessDependenciesByProcessId.get(process.processId as TraceProcessId) ?? [],
      remoteDependencies: []
    };
  });
}

/** Drops ingestion-only dependency object arrays from persisted window process metadata. */
function stripTraceChunkWindowProcessDependencyMetadata(
  process: ArrowTraceProcessMetadata
): ArrowTraceProcessMetadata {
  const {sameProcessDependencies: _sameProcessDependencies, ...metadata} = process;
  return metadata;
}

/** Builds active-window time extents from selected original chunk rows. */
function buildTraceChunkWindowTimeExtents(selectedRows: readonly SelectedTraceChunkSpanRow[]): {
  minTimeMs: number;
  maxTimeMs: number;
} {
  let minTimeMs = Number.MAX_SAFE_INTEGER;
  let finiteMaxTimeMs = Number.MIN_SAFE_INTEGER;
  for (const selectedRow of selectedRows) {
    const timing = selectedRow.primaryTiming;
    if (
      !timing ||
      !isTraceSpanTimingEligibleForTimeExtents({
        status: timing.status,
        startTimeMs: timing.startTimeMs
      })
    ) {
      continue;
    }
    minTimeMs = Math.min(minTimeMs, timing.startTimeMs);
    finiteMaxTimeMs = Math.max(finiteMaxTimeMs, timing.startTimeMs);
    if (isTraceSpanTimingTimestampEligibleForTimeExtents(timing.endTimeMs)) {
      minTimeMs = Math.min(minTimeMs, timing.endTimeMs);
      finiteMaxTimeMs = Math.max(finiteMaxTimeMs, timing.endTimeMs);
    }
  }
  if (minTimeMs === Number.MAX_SAFE_INTEGER || finiteMaxTimeMs === Number.MIN_SAFE_INTEGER) {
    return {minTimeMs: 0, maxTimeMs: 0};
  }
  return {minTimeMs, maxTimeMs: finiteMaxTimeMs};
}

/** Builds active-window graph stats without materializing copied span tables. */
function buildTraceChunkWindowStats(params: {
  readonly dependencies: ReturnType<typeof buildTraceChunkParentDependencies>;
  readonly processes: readonly ArrowTraceProcessMetadata[];
  readonly selectedRows: readonly SelectedTraceChunkSpanRow[];
}): TraceGraphStats {
  const selectedProcessRefs = new Set(params.selectedRows.map(row => row.processRef));
  const selectedProcesses = params.processes.filter(process =>
    selectedProcessRefs.has(encodeProcessRef(process.rankNum))
  );
  const processCount = selectedProcesses.length;
  const threadCount = selectedProcesses.reduce(
    (total, process) => total + process.threads.length,
    0
  );
  const laneCount = selectedProcesses.reduce((total, process) => {
    return (
      total +
      process.threads.reduce((threadTotal, thread) => {
        const laneValue = (thread.userData as {laneCount?: number} | undefined)?.laneCount;
        if (typeof laneValue === 'number' && Number.isFinite(laneValue) && laneValue > 0) {
          return threadTotal + Math.floor(laneValue);
        }
        return threadTotal + 1;
      }, 0)
    );
  }, 0);
  const sameProcessDependencyCount = [
    ...params.dependencies.sameProcessDependenciesByProcessId.values()
  ].reduce((total, dependencies) => total + dependencies.length, 0);
  const crossProcessDependencyCount = params.dependencies.crossProcessDependencies.length;
  let notStartedSpanCount = 0;
  let unfinishedSpanCount = 0;
  for (const selectedRow of params.selectedRows) {
    const status = selectedRow.primaryTiming?.status ?? 'not-started';
    if (status === 'not-started') {
      notStartedSpanCount += 1;
    } else if (status === 'not-finished') {
      unfinishedSpanCount += 1;
    }
  }
  return {
    processCount,
    threadCount,
    laneCount,
    spanCount: params.selectedRows.length,
    sameProcessDependencyCount,
    notStartedSpanCount,
    unfinishedSpanCount,
    droppedSpanCount: 0,
    dependencyCount: sameProcessDependencyCount + crossProcessDependencyCount,
    droppedDependencyCount: 0,
    crossProcessDependencyCount,
    droppedCrossProcessDependencyCount: 0
  };
}

/** Counts unique selected process refs in one materialized window selection. */
function countSelectedProcessRefs(selectedRows: readonly SelectedTraceChunkSpanRow[]): number {
  return new Set(selectedRows.flatMap(row => (row.processRef == null ? [] : [row.processRef])))
    .size;
}

/** Counts selected rows whose process ref is missing from the store owner snapshot. */
function countSelectedRowsWithMissingOwnerProcessRef(
  selectedRows: readonly SelectedTraceChunkSpanRow[],
  processIdByRef: ReadonlyMap<ProcessRef, TraceProcessId>
): number {
  return selectedRows.reduce(
    (count, row) =>
      row.processRef == null || processIdByRef.has(row.processRef) ? count : count + 1,
    0
  );
}

/** Builds visible dependency rows from parent source rows within the visible subset. */
function buildTraceChunkParentDependencies(selectedRows: readonly SelectedTraceChunkSpanRow[]): {
  readonly sameProcessDependenciesByProcessId: ReadonlyMap<
    TraceProcessId,
    TraceSameProcessDependency[]
  >;
  readonly crossProcessDependencies: readonly TraceCrossProcessDependency[];
} {
  const rowByExternalSpanId = new Map<string, SelectedTraceChunkSpanRow>();
  for (const selectedRow of selectedRows) {
    if (selectedRow.externalSpanId && !rowByExternalSpanId.has(selectedRow.externalSpanId)) {
      rowByExternalSpanId.set(selectedRow.externalSpanId, selectedRow);
    }
  }

  const sameProcessDependenciesByProcessId = new Map<
    TraceProcessId,
    TraceSameProcessDependency[]
  >();
  const crossProcessDependencies: TraceCrossProcessDependency[] = [];
  for (const endRow of selectedRows) {
    for (const parentExternalSpanId of endRow.parentExternalSpanIds) {
      const startRow = rowByExternalSpanId.get(parentExternalSpanId);
      if (!startRow) {
        continue;
      }
      appendTraceChunkParentDependency({
        startRow,
        endRow,
        sameProcessDependenciesByProcessId,
        crossProcessDependencies
      });
    }
  }

  return {sameProcessDependenciesByProcessId, crossProcessDependencies};
}

/** Appends one local or cross-process parent dependency for two visible chunk rows. */
function appendTraceChunkParentDependency(params: {
  readonly startRow: SelectedTraceChunkSpanRow;
  readonly endRow: SelectedTraceChunkSpanRow;
  readonly sameProcessDependenciesByProcessId: Map<TraceProcessId, TraceSameProcessDependency[]>;
  readonly crossProcessDependencies: TraceCrossProcessDependency[];
}): void {
  const waitTimeMs = computeWaitTimeMs(params.startRow.primaryTiming, params.endRow.primaryTiming);
  const dependencyId =
    `dep:parent:${params.startRow.externalSpanId ?? params.startRow.spanId}->${params.endRow.externalSpanId ?? params.endRow.spanId}` as TraceDependencyId;
  const startProcessId = params.startRow.process.processId as TraceProcessId;
  const endProcessId = params.endRow.process.processId as TraceProcessId;
  if (startProcessId === endProcessId) {
    const dependencies = params.sameProcessDependenciesByProcessId.get(startProcessId) ?? [];
    const processRef = params.startRow.processRef;
    dependencies.push({
      type: 'trace-same-process-dependency',
      ...(processRef == null
        ? {}
        : {
            dependencyRef: encodeSameProcessDependencyRef(
              encodeLocalSpanRef(getProcessRefIndex(processRef), dependencies.length)
            )
          }),
      startSpanRef: params.startRow.spanRef,
      endSpanRef: params.endRow.spanRef,
      dependencyId,
      startSpanId: params.startRow.spanId,
      endSpanId: params.endRow.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs,
      userData: {
        topology: 'parent',
        start_external_span_id: params.startRow.externalSpanId,
        end_external_span_id: params.endRow.externalSpanId
      }
    });
    params.sameProcessDependenciesByProcessId.set(startProcessId, dependencies);
    return;
  }

  const endpointId =
    `endpoint:parent:${params.startRow.externalSpanId ?? params.startRow.spanId}->${params.endRow.externalSpanId ?? params.endRow.spanId}` as TraceCrossProcessEndpointId;
  params.crossProcessDependencies.push({
    type: 'trace-cross-process-dependency',
    dependencyRef: encodeCrossProcessDependencyRef(params.crossProcessDependencies.length),
    startSpanRef: params.startRow.spanRef,
    endSpanRef: params.endRow.spanRef,
    dependencyId,
    endpointId,
    startRankNum:
      params.startRow.processRef == null ? 0 : getProcessRefIndex(params.startRow.processRef),
    endRankNum: params.endRow.processRef == null ? 0 : getProcessRefIndex(params.endRow.processRef),
    startSpanId: params.startRow.spanId,
    endSpanId: params.endRow.spanId,
    waitMode: 'start-to-start',
    bidirectional: false,
    topology: 'parent',
    waitTimeMs,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set(['PARENT']),
    userData: {
      topology: 'parent',
      start_external_span_id: params.startRow.externalSpanId,
      end_external_span_id: params.endRow.externalSpanId
    }
  });
}

/** Builds one process-local Arrow dependency table for each materialized process. */
function buildSameProcessDependencyTableMap(
  processes: readonly ArrowTraceProcessMetadata[],
  sameProcessDependenciesByProcessId: ReadonlyMap<TraceProcessId, TraceSameProcessDependency[]>
): Readonly<Record<TraceProcessId, ArrowTraceSameProcessDependencyTable>> {
  return Object.fromEntries(
    processes.map(process => [
      process.processId as TraceProcessId,
      buildArrowTraceSameProcessDependencyTable(
        sameProcessDependenciesByProcessId.get(process.processId as TraceProcessId) ?? []
      )
    ])
  ) as Readonly<
    Record<TraceProcessId, ReturnType<typeof buildArrowTraceSameProcessDependencyTable>>
  >;
}

/** Reads the minimal selected-row payload needed for active-window graph materialization. */
function readSelectedTraceChunkSpanRow<TDescriptor extends TraceChunkDescriptor>(
  readyChunk: TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>,
  spanRefRowIndex: number,
  spanColumns: TraceChunkSpanColumns,
  out: MutableSelectedTraceChunkSpanRow
): boolean {
  const payload = readyChunk.payload;
  const spanTableRowIndex = getTraceChunkSpanTableRowIndex(payload, spanRefRowIndex);
  if (spanTableRowIndex == null) {
    return false;
  }
  const processRef = readArrowRefColumn(spanColumns.processRef, spanTableRowIndex);
  const process = resolveTraceChunkRowProcess(payload, processRef);
  const spanId = readColumnValue(spanColumns.spanId, spanTableRowIndex);
  if (!process || !spanId) {
    return false;
  }
  out.spanRef = encodeSpanRef(readyChunk.chunkIndex, spanRefRowIndex);
  out.processRef =
    processRef == null ? encodeProcessRef(process.rankNum) : (processRef as ProcessRef);
  out.spanId = spanId;
  out.externalSpanId =
    normalizeExternalSpanId(readColumnValue(spanColumns.externalSpanId, spanTableRowIndex)) ?? null;
  out.parentExternalSpanId =
    payload.indexes.parentExternalSpanIdByRowIndex[spanRefRowIndex] ?? null;
  out.parentExternalSpanIds = getTraceChunkParentExternalSpanIds(
    payload,
    out.externalSpanId,
    spanRefRowIndex
  );
  out.process = process;
  // Window materialization only needs the canonical primary timing projection. Reading
  // `timingsJson` here deserializes one JSON object per selected span during large loads.
  out.primaryTiming = readPrimaryTiming(spanColumns, spanTableRowIndex);
  return true;
}

/** Copies a scratch selected-row into the retained active-window row list. */
function copySelectedTraceChunkSpanRow(
  row: Readonly<SelectedTraceChunkSpanRow>
): SelectedTraceChunkSpanRow {
  return {
    spanRef: row.spanRef,
    processRef: row.processRef,
    spanId: row.spanId,
    externalSpanId: row.externalSpanId,
    parentExternalSpanId: row.parentExternalSpanId,
    parentExternalSpanIds: row.parentExternalSpanIds,
    process: row.process,
    primaryTiming: row.primaryTiming
  };
}

/**
 * Resolves ordered parent source ids for one chunk row, preserving the legacy single-parent fallback.
 */
function getTraceChunkParentExternalSpanIds(
  payload: TraceChunk,
  externalSpanId: string | null,
  spanRefRowIndex: number
): readonly string[] {
  const parentExternalSpanIds: string[] = [];
  const seenParentExternalSpanIds = new Set<string>();
  const sourceDependencyRowIndexes = externalSpanId
    ? (payload.indexes.sourceDependencyRowsByEndExternalSpanId.get(externalSpanId) ?? [])
    : [];
  for (const sourceDependencyRowIndex of sourceDependencyRowIndexes) {
    const dependencyRow = payload.sourceDependencyTable
      ? readTraceChunkSourceDependencyRow(payload.sourceDependencyTable, sourceDependencyRowIndex)
      : null;
    if (
      dependencyRow?.dependencyKind !== 'parent' ||
      !dependencyRow.startExternalSpanId ||
      seenParentExternalSpanIds.has(dependencyRow.startExternalSpanId)
    ) {
      continue;
    }
    parentExternalSpanIds.push(dependencyRow.startExternalSpanId);
    seenParentExternalSpanIds.add(dependencyRow.startExternalSpanId);
  }
  if (parentExternalSpanIds.length > 0) {
    return parentExternalSpanIds;
  }

  const parentExternalSpanId = payload.indexes.parentExternalSpanIdByRowIndex[spanRefRowIndex];
  return parentExternalSpanId ? [parentExternalSpanId] : [];
}

/** Reads one transient row view from a normalized trace chunk. */
function readTraceChunkSpanRow(
  payload: TraceChunk,
  spanRefRowIndex: number,
  spanColumns: TraceChunkSpanColumns
): TraceChunkSpanRowView | null {
  const spanTableRowIndex = getTraceChunkSpanTableRowIndex(payload, spanRefRowIndex);
  if (spanTableRowIndex == null) {
    return null;
  }
  const processRef = readArrowRefColumn(spanColumns.processRef, spanTableRowIndex);
  const threadRef = readArrowRefColumn(spanColumns.threadRef, spanTableRowIndex);
  const process = resolveTraceChunkRowProcess(payload, processRef);
  if (!process) {
    return null;
  }
  const threadId = readColumnValue(spanColumns.threadId, spanTableRowIndex);
  const name = readColumnValue(spanColumns.name, spanTableRowIndex);
  const spanId = readColumnValue(spanColumns.spanId, spanTableRowIndex);
  if (!threadId || !name || !spanId) {
    return null;
  }
  const primaryTimingKey =
    readColumnValue(spanColumns.primaryTimingKey, spanTableRowIndex) ?? 'primary';
  const primaryTiming = readPrimaryTiming(spanColumns, spanTableRowIndex);
  const timings = {
    ...(readTraceChunkSpanTimings(payload, spanTableRowIndex) ?? {}),
    [primaryTimingKey]: primaryTiming
  };
  return {
    rowIndex: spanRefRowIndex,
    spanTableRowIndex,
    spanId,
    externalSpanId:
      normalizeExternalSpanId(readColumnValue(spanColumns.externalSpanId, spanTableRowIndex)) ??
      null,
    parentExternalSpanId: payload.indexes.parentExternalSpanIdByRowIndex[spanRefRowIndex] ?? null,
    process,
    processRef: processRef == null ? null : (processRef as ProcessRef),
    thread: process.threadMap[threadId] ?? {
      type: 'trace-thread',
      threadId,
      processId: process.processId,
      name: threadId
    },
    threadRef: threadRef == null ? null : (threadRef as ThreadRef),
    name,
    source: readColumnValue(spanColumns.source, spanTableRowIndex) ?? null,
    keywords: readTraceChunkSidecarKeywords(payload, spanTableRowIndex),
    primaryTimingKey,
    timings,
    userData: readTraceChunkSidecarUserData(payload, spanTableRowIndex) ?? {},
    overlapRanges: payload.rowWindowTable?.overlapRangesByRow[spanRefRowIndex] ?? [],
    crossProcessEndpointId: readTraceChunkSidecarEndpointId(payload, spanTableRowIndex),
    crossProcessDependencyEndpoints: readTraceChunkSpanCrossProcessEndpoints(
      payload,
      spanTableRowIndex
    )
  };
}

/** Reads normalized search text without materializing the full normalized chunk row. */
function readTraceChunkSpanSearchText(
  payload: TraceChunk,
  spanRefRowIndex: number,
  spanSearchColumns: TraceChunkSpanSearchColumns
): string | null {
  const spanTableRowIndex = getTraceChunkSpanTableRowIndex(payload, spanRefRowIndex);
  if (spanTableRowIndex == null) {
    return null;
  }
  const processRef = readArrowRefColumn(spanSearchColumns.processRef, spanTableRowIndex);
  const process = resolveTraceChunkRowProcess(payload, processRef);
  const threadId = readColumnValue(spanSearchColumns.threadId, spanTableRowIndex);
  const name = readColumnValue(spanSearchColumns.name, spanTableRowIndex);
  if (!process || !threadId || !name) {
    return null;
  }
  const source = readColumnValue(spanSearchColumns.source, spanTableRowIndex) ?? null;
  const keywords = readTraceChunkSidecarKeywords(payload, spanTableRowIndex);
  return buildTraceChunkSpanSearchText(
    name,
    source,
    keywords,
    process.name,
    process.threadMap[threadId]?.name ?? threadId
  );
}

/** Matches one ready chunk span through field-wise plain text or the generic combined-text path. */
function matchesTraceChunkSpanSearchText(params: {
  /** Store-owned normalized trace chunk. */
  readonly payload: TraceChunk;
  /** Stable chunk-local span-ref row index. */
  readonly spanRefRowIndex: number;
  /** Minimal span-table vectors needed before a search row matches. */
  readonly spanSearchColumns: TraceChunkSpanSearchColumns;
  /** Shared generic search predicate. */
  readonly matchesSearchText: (searchText: string) => boolean;
  /** Chunk-local single-token plain-text matcher eligible for field-wise matching. */
  readonly plainTextSpanSearchMatcher: TraceChunkPlainTextSpanSearchMatcher | null;
}): boolean {
  if (params.plainTextSpanSearchMatcher) {
    return traceChunkSpanMatchesPlainTextQuery(
      params.payload,
      params.spanRefRowIndex,
      params.spanSearchColumns,
      params.plainTextSpanSearchMatcher
    );
  }

  const searchText = readTraceChunkSpanSearchText(
    params.payload,
    params.spanRefRowIndex,
    params.spanSearchColumns
  );
  return searchText != null && params.matchesSearchText(searchText);
}

/** Matches one single-token plain-text query without allocating one combined row string. */
function traceChunkSpanMatchesPlainTextQuery(
  payload: TraceChunk,
  spanRefRowIndex: number,
  spanSearchColumns: TraceChunkSpanSearchColumns,
  spanSearchMatcher: TraceChunkPlainTextSpanSearchMatcher
): boolean {
  const spanTableRowIndex = getTraceChunkSpanTableRowIndex(payload, spanRefRowIndex);
  if (spanTableRowIndex == null) {
    return false;
  }

  if (
    traceChunkSpanSearchColumnMatchesPlainTextQuery({
      column: spanSearchColumns.name,
      utf8Source: spanSearchMatcher.nameUtf8Source,
      utf8View: spanSearchMatcher.nameUtf8View,
      rowIndex: spanTableRowIndex,
      query: spanSearchMatcher.query
    })
  ) {
    return true;
  }
  if (
    traceChunkSpanSearchColumnMatchesPlainTextQuery({
      column: spanSearchColumns.source,
      utf8Source: spanSearchMatcher.sourceUtf8Source,
      utf8View: spanSearchMatcher.sourceUtf8View,
      rowIndex: spanTableRowIndex,
      query: spanSearchMatcher.query
    })
  ) {
    return true;
  }

  const keywords = readTraceChunkSidecarKeywords(payload, spanTableRowIndex);
  if (
    keywords.some(keyword =>
      traceChunkSpanSearchFieldMatchesPlainTextQuery(keyword, spanSearchMatcher.query.text)
    )
  ) {
    return true;
  }

  if (
    spanSearchMatcher.mayMatchProcessOrKnownThreadName &&
    traceChunkSpanProcessOrKnownThreadMatchesPlainTextQuery(
      payload,
      spanTableRowIndex,
      spanSearchColumns,
      spanSearchMatcher.query.text
    )
  ) {
    return true;
  }

  return traceChunkSpanUnknownThreadIdMatchesPlainTextQuery(
    payload,
    spanTableRowIndex,
    spanSearchColumns,
    spanSearchMatcher
  );
}

/** Resolves the process metadata represented by one chunk span-table row. */
function resolveTraceChunkRowProcess(
  chunk: Pick<TraceChunk, 'processes' | 'processId' | 'processRefs'>,
  processRef: number | null
): ArrowTraceProcessMetadata | null {
  if (chunk.processId != null) {
    return (
      chunk.processes.find(process => process.processId === chunk.processId) ??
      (chunk.processes.length === 1 ? chunk.processes[0]! : null)
    );
  }
  if (processRef != null) {
    const representedProcessIndex = chunk.processRefs.indexOf(processRef as ProcessRef);
    if (representedProcessIndex >= 0) {
      return chunk.processes[representedProcessIndex] ?? null;
    }
    const processIndex = getProcessRefIndex(processRef as ProcessRef);
    return (
      chunk.processes[processIndex] ??
      chunk.processes.find(process => process.rankNum === processIndex) ??
      null
    );
  }
  return chunk.processes.length === 1 ? chunk.processes[0]! : null;
}

/** Resolves a stable span-ref row index into the backing Arrow span-table row index. */
function getTraceChunkSpanTableRowIndex(
  payload: Pick<TraceChunk, 'spanTable'>,
  spanRefRowIndex: number
): number | null {
  return spanRefRowIndex >= 0 && spanRefRowIndex < payload.spanTable.numRows
    ? spanRefRowIndex
    : null;
}

/** Reads the span-table vectors used repeatedly while scanning a trace chunk. */
function readTraceChunkSpanColumns(spanTable: ArrowTraceSpanTable): TraceChunkSpanColumns {
  return {
    processRef: getTraceChunkSpanColumn(spanTable, 'process_ref'),
    threadRef: getTraceChunkSpanColumn(spanTable, 'thread_ref'),
    spanId: getTraceChunkSpanColumn(spanTable, 'span_id'),
    externalSpanId: getTraceChunkSpanColumn(spanTable, 'external_span_id'),
    threadId: getTraceChunkSpanColumn(spanTable, 'thread_id'),
    name: getTraceChunkSpanColumn(spanTable, 'name'),
    source: getTraceChunkSpanColumn(spanTable, 'source'),
    primaryTimingKey: getTraceChunkSpanColumn(spanTable, 'primary_timing_key'),
    statusCode: getTraceChunkSpanColumn(spanTable, 'status_code'),
    startTimeMs: getTraceChunkSpanColumn(spanTable, 'start_time_ms'),
    endTimeMs: getTraceChunkSpanColumn(spanTable, 'end_time_ms'),
    durationMs: getTraceChunkSpanColumn(spanTable, 'duration_ms')
  };
}

/** Reads the span-table vectors needed before a search row is known to match. */
function readTraceChunkSpanSearchColumns(
  spanTable: ArrowTraceSpanTable
): TraceChunkSpanSearchColumns {
  return {
    processRef: getTraceChunkSpanColumn(spanTable, 'process_ref'),
    threadId: getTraceChunkSpanColumn(spanTable, 'thread_id'),
    name: getTraceChunkSpanColumn(spanTable, 'name'),
    source: getTraceChunkSpanColumn(spanTable, 'source')
  };
}

/** Reads the span-table vectors needed only after a search row matches. */
function readTraceChunkSpanSearchRecordColumns(
  spanTable: ArrowTraceSpanTable
): TraceChunkSpanSearchRecordColumns {
  return {
    spanId: getTraceChunkSpanColumn(spanTable, 'span_id'),
    statusCode: getTraceChunkSpanColumn(spanTable, 'status_code'),
    startTimeMs: getTraceChunkSpanColumn(spanTable, 'start_time_ms'),
    endTimeMs: getTraceChunkSpanColumn(spanTable, 'end_time_ms'),
    durationMs: getTraceChunkSpanColumn(spanTable, 'duration_ms')
  };
}

/** Returns one field-wise plain-text query only when concatenation cannot affect matching. */
function getSingleTokenTraceSpanPlainTextQuery(
  predicate: (searchText: string) => boolean
): string | null {
  const plainTextQuery = getTraceSpanPlainTextQuery(predicate);
  return plainTextQuery && !/\s/.test(plainTextQuery) ? plainTextQuery : null;
}

/** Builds one reusable plain-text query with optional direct UTF-8 bytes. */
function buildTraceChunkPlainTextSearchQuery(text: string): TraceChunkPlainTextSearchQuery {
  return {
    text,
    utf8View: isTraceChunkAsciiSearchText(text) ? makeUtf8StringView(text) : null
  };
}

/** Builds one chunk-local direct-buffer matcher for one plain-text search query. */
function buildTraceChunkPlainTextSpanSearchMatcher(
  payload: TraceChunk,
  spanSearchColumns: TraceChunkSpanSearchColumns,
  query: TraceChunkPlainTextSearchQuery
): TraceChunkPlainTextSpanSearchMatcher {
  return {
    query,
    nameUtf8Source: getTraceChunkUtf8ColumnSource(spanSearchColumns.name),
    nameUtf8View: createTraceChunkUtf8StringView(),
    sourceUtf8Source: getTraceChunkUtf8ColumnSource(spanSearchColumns.source),
    sourceUtf8View: createTraceChunkUtf8StringView(),
    threadIdUtf8Source: getTraceChunkUtf8ColumnSource(spanSearchColumns.threadId),
    threadIdUtf8View: createTraceChunkUtf8StringView(),
    mayMatchProcessOrKnownThreadName: payload.processes.some(process => {
      return (
        traceChunkSpanSearchFieldMatchesPlainTextQuery(process.name, query.text) ||
        Object.values(process.threadMap).some(thread =>
          traceChunkSpanSearchFieldMatchesPlainTextQuery(thread.name, query.text)
        )
      );
    })
  };
}

/** Matches one span-table UTF-8 column through direct bytes when Arrow exposes them. */
function traceChunkSpanSearchColumnMatchesPlainTextQuery(params: {
  /** Nullable span-table string vector. */
  readonly column: ColumnVector<string> | null;
  /** Direct UTF-8 source for the same span-table string vector. */
  readonly utf8Source: Utf8ColumnSource | null;
  /** Reusable direct UTF-8 row view for the same span-table string vector. */
  readonly utf8View: Utf8StringView;
  /** Span-table row index being searched. */
  readonly rowIndex: number;
  /** Lowercase plain-text query being searched. */
  readonly query: TraceChunkPlainTextSearchQuery;
}): boolean {
  if (params.query.utf8View && params.utf8Source) {
    return (
      getUtf8ColumnSourceRowView(params.utf8Source, params.rowIndex, params.utf8View) &&
      traceChunkUtf8ViewIncludesAsciiCaseInsensitive(params.utf8View, params.query.utf8View)
    );
  }

  return traceChunkSpanSearchFieldMatchesPlainTextQuery(
    readColumnValue(params.column, params.rowIndex),
    params.query.text
  );
}

/** Matches process or known-thread display names only when chunk metadata can contain the query. */
function traceChunkSpanProcessOrKnownThreadMatchesPlainTextQuery(
  payload: TraceChunk,
  spanTableRowIndex: number,
  spanSearchColumns: TraceChunkSpanSearchColumns,
  plainTextQuery: string
): boolean {
  const processRef = readArrowRefColumn(spanSearchColumns.processRef, spanTableRowIndex);
  const process = resolveTraceChunkRowProcess(payload, processRef);
  if (!process) {
    return false;
  }
  if (traceChunkSpanSearchFieldMatchesPlainTextQuery(process.name, plainTextQuery)) {
    return true;
  }

  const threadId = readColumnValue(spanSearchColumns.threadId, spanTableRowIndex);
  return Boolean(
    threadId &&
      traceChunkSpanSearchFieldMatchesPlainTextQuery(
        process.threadMap[threadId]?.name ?? null,
        plainTextQuery
      )
  );
}

/** Matches thread ids only when the row lacks a known thread display name. */
function traceChunkSpanUnknownThreadIdMatchesPlainTextQuery(
  payload: TraceChunk,
  spanTableRowIndex: number,
  spanSearchColumns: TraceChunkSpanSearchColumns,
  spanSearchMatcher: TraceChunkPlainTextSpanSearchMatcher
): boolean {
  if (
    !traceChunkSpanSearchColumnMatchesPlainTextQuery({
      column: spanSearchColumns.threadId,
      utf8Source: spanSearchMatcher.threadIdUtf8Source,
      utf8View: spanSearchMatcher.threadIdUtf8View,
      rowIndex: spanTableRowIndex,
      query: spanSearchMatcher.query
    })
  ) {
    return false;
  }

  const processRef = readArrowRefColumn(spanSearchColumns.processRef, spanTableRowIndex);
  const process = resolveTraceChunkRowProcess(payload, processRef);
  if (!process) {
    return false;
  }
  const threadId = readColumnValue(spanSearchColumns.threadId, spanTableRowIndex);
  return Boolean(threadId && process.threadMap[threadId] == null);
}

/** Returns one direct UTF-8 source for a nullable span-table UTF-8 vector. */
function getTraceChunkUtf8ColumnSource(
  column: ColumnVector<string> | null
): Utf8ColumnSource | null {
  if (!column) {
    return null;
  }
  return getArrowUtf8ColumnSource(column as Parameters<typeof getArrowUtf8ColumnSource>[0]);
}

/** Creates one empty direct UTF-8 row view reused during a span search pass. */
function createTraceChunkUtf8StringView(): Utf8StringView {
  return {data: EMPTY_TRACE_CHUNK_UTF8_DATA, start: 0, end: 0};
}

/** Returns whether one lowercase plain-text query can use ASCII UTF-8 byte matching. */
function isTraceChunkAsciiSearchText(searchText: string): boolean {
  for (let index = 0; index < searchText.length; index += 1) {
    if (searchText.charCodeAt(index) > 0x7f) {
      return false;
    }
  }
  return true;
}

/** Matches one UTF-8 field view against one lowercase ASCII UTF-8 query view. */
function traceChunkUtf8ViewIncludesAsciiCaseInsensitive(
  fieldView: Utf8StringView,
  queryView: Utf8StringView
): boolean {
  const queryByteCount = queryView.end - queryView.start;
  if (queryByteCount === 0) {
    return true;
  }
  const lastStartIndex = fieldView.end - queryByteCount;
  for (let fieldIndex = fieldView.start; fieldIndex <= lastStartIndex; fieldIndex += 1) {
    let queryIndex = 0;
    for (; queryIndex < queryByteCount; queryIndex += 1) {
      if (
        lowercaseTraceChunkAsciiByte(fieldView.data[fieldIndex + queryIndex]!) !==
        queryView.data[queryView.start + queryIndex]
      ) {
        break;
      }
    }
    if (queryIndex === queryByteCount) {
      return true;
    }
  }
  return false;
}

/** Lowercases one ASCII byte while leaving UTF-8 continuation bytes unchanged. */
function lowercaseTraceChunkAsciiByte(byte: number): number {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
}

/** Matches one nullable search field against a normalized single-token plain-text query. */
function traceChunkSpanSearchFieldMatchesPlainTextQuery(
  field: string | null,
  plainTextQuery: string
): boolean {
  return field != null && field.toLowerCase().includes(plainTextQuery);
}

/** Resolves one Arrow span-table vector by column name. */
function getTraceChunkSpanColumn<Value>(
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

/** Resolves one optional Arrow sidecar vector by column name. */
function getTraceChunkSidecarColumn<Value>(
  table: ArrowTraceSpanSidecarTable | undefined,
  columnName: string
): ColumnVector<Value> | null {
  if (!table) {
    return null;
  }
  return (
    (
      table as unknown as {
        getChild(name: string): ColumnVector<Value> | null | undefined;
      }
    ).getChild(columnName) ?? null
  );
}

/** Reads one row's keyword labels from the Arrow sidecar table. */
function readTraceChunkSidecarKeywords(payload: TraceChunk, rowIndex: number): readonly string[] {
  const value = readColumnValue<unknown>(
    getTraceChunkSidecarColumn(payload.spanSidecarTable, 'keywords'),
    rowIndex
  );
  if (Array.isArray(value)) {
    return value.filter((keyword): keyword is string => typeof keyword === 'string');
  }
  return EMPTY_TRACE_CHUNK_SEARCH_KEYWORDS;
}

/** Decodes one full user-data payload for detail-only chunk-window consumers. */
function readTraceChunkSidecarUserData(
  payload: TraceChunk,
  rowIndex: number
): Record<string, unknown> | undefined {
  return deserializeArrowTraceJson<Record<string, unknown>>(
    readColumnValue<string>(
      getTraceChunkSidecarColumn(payload.spanSidecarTable, 'userDataJson'),
      rowIndex
    )
  );
}

/** Reads one unresolved endpoint id from the Arrow sidecar table. */
function readTraceChunkSidecarEndpointId(
  payload: TraceChunk,
  rowIndex: number
): TraceCrossProcessEndpointId | null {
  return (
    (readColumnValue<string>(
      getTraceChunkSidecarColumn(payload.spanSidecarTable, 'crossProcessEndpointId'),
      rowIndex
    ) as TraceCrossProcessEndpointId | null) ?? null
  );
}

/** Decodes optional timing projections from native sidecars or legacy JSON columns. */
function readTraceChunkSpanTimings(
  payload: TraceChunk,
  rowIndex: number
): Record<string, TraceSpanTiming> | undefined {
  const nativeTimings = readTraceChunkNativeSpanTimings(payload, rowIndex);
  const legacyTimings =
    deserializeArrowTraceJson<Record<string, TraceSpanTiming>>(
      readColumnValue<string>(
        getTraceChunkSidecarColumn(payload.spanSidecarTable, 'timingsJson'),
        rowIndex
      )
    ) ??
    deserializeArrowTraceJson<Record<string, TraceSpanTiming>>(
      readColumnValue<string>(getTraceChunkSpanColumn(payload.spanTable, 'timingsJson'), rowIndex)
    );
  if (!nativeTimings) {
    return legacyTimings;
  }
  return legacyTimings ? {...legacyTimings, ...nativeTimings} : nativeTimings;
}

/** Reads every Arrow-native non-primary timing projection from one chunk sidecar row. */
function readTraceChunkNativeSpanTimings(
  payload: TraceChunk,
  rowIndex: number
): Record<string, TraceSpanTiming> | undefined {
  const timingsColumn = getTraceChunkSidecarColumn(
    payload.spanSidecarTable,
    'timings'
  ) as arrow.Vector<arrow.Struct<arrow.TypeMap>> | null;
  if (!timingsColumn) {
    return undefined;
  }

  const timings = Object.fromEntries(
    timingsColumn.type.children.flatMap(field => {
      const timing = readTraceChunkNativeSpanTiming(timingsColumn, field.name, rowIndex);
      return timing ? [[field.name, timing] as const] : [];
    })
  );
  return Object.keys(timings).length > 0 ? timings : undefined;
}

/** Reads one Arrow-native non-primary timing projection from a chunk sidecar row. */
function readTraceChunkNativeSpanTiming(
  timingsColumn: arrow.Vector<arrow.Struct<arrow.TypeMap>>,
  timingKey: string,
  rowIndex: number
): TraceSpanTiming | null {
  const timingFieldIndex = timingsColumn.type.children.findIndex(field => field.name === timingKey);
  const timingColumn =
    timingFieldIndex < 0
      ? null
      : (timingsColumn.getChildAt(timingFieldIndex) as
          | arrow.Vector<arrow.Struct<arrow.TypeMap>>
          | null
          | undefined);
  if (!timingColumn) {
    return null;
  }

  const status = decodeTraceSpanTimingStatusCode(
    readTraceChunkNativeTimingField<number>(timingColumn, 'status_code', rowIndex)
  );
  const startTimeMs = readTraceChunkNativeTimingField<number>(
    timingColumn,
    'start_time_ms',
    rowIndex
  );
  const endTimeMs = readTraceChunkNativeTimingField<number>(timingColumn, 'end_time_ms', rowIndex);
  const durationMs = readTraceChunkNativeTimingField<number>(timingColumn, 'duration_ms', rowIndex);
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
    durationMsAsString: formatTraceChunkTimingDuration(status, durationMs)
  };
}

/** Reads one scalar child value from an Arrow-native chunk timing projection. */
function readTraceChunkNativeTimingField<Value>(
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

/** Formats one Arrow-native chunk timing duration for detail consumers. */
function formatTraceChunkTimingDuration(
  status: TraceSpanTiming['status'],
  durationMs: number
): string {
  if (status === 'not-started') {
    return 'not started';
  }
  if (status === 'not-finished') {
    return 'incomplete';
  }
  return formatTimeMs(durationMs, {roundDigits: 3});
}

/** Reads structured unresolved endpoint payloads from canonical span columns. */
function readTraceChunkSpanCrossProcessEndpoints(
  payload: TraceChunk,
  rowIndex: number
): readonly TraceCrossProcessEndpoint[] {
  const value = readColumnValue<unknown>(
    getTraceChunkSpanColumn(payload.spanTable, 'crossProcessDependencyEndpoints'),
    rowIndex
  );
  return Array.isArray(value)
    ? value.filter(
        (endpoint): endpoint is TraceCrossProcessEndpoint =>
          endpoint != null && typeof endpoint === 'object'
      )
    : [];
}

/** Reads one typed value from an extracted Arrow column if the column exists. */
function readColumnValue<T>(column: ColumnVector<T> | null, rowIndex: number): T | null {
  return column ? (column.get(rowIndex) ?? null) : null;
}

/** Reads one extracted Arrow ref column and normalizes numeric/bigint Arrow scalar values. */
function readArrowRefColumn(column: ColumnVector<unknown> | null, rowIndex: number): number | null {
  return normalizeArrowRefNumber(readColumnValue(column, rowIndex));
}

/** Normalizes Arrow ref columns that may be nullish or bigint-backed into safe integers. */
function normalizeArrowRefNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    const numberValue = Number(value);
    return Number.isSafeInteger(numberValue) ? numberValue : null;
  }
  return null;
}

/** Returns a normalized external span id from a nullable Arrow string value. */
function normalizeExternalSpanId(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}

/** Reads the primary timing projection from one Arrow span row. */
function readPrimaryTiming(
  spanColumns: TraceChunkSpanPrimaryTimingColumns,
  rowIndex: number
): TraceSpanTiming {
  const status =
    decodeTraceSpanTimingStatusCode(readColumnValue(spanColumns.statusCode, rowIndex)) ??
    'finished';
  const durationMs = readColumnValue(spanColumns.durationMs, rowIndex) ?? 0;
  return {
    status,
    startTimeMs: readColumnValue(spanColumns.startTimeMs, rowIndex) ?? 0,
    endTimeMs: readColumnValue(spanColumns.endTimeMs, rowIndex) ?? 0,
    durationMs,
    durationMsAsString: status === 'finished' ? `${durationMs}ms` : 'Not finished'
  };
}

/** Computes parent dependency wait time from two timing projections. */
function computeWaitTimeMs(
  startTiming: TraceSpanTiming | null,
  endTiming: TraceSpanTiming | null
): number {
  if (!startTiming || !endTiming) {
    return 0;
  }
  return Math.max(0, endTiming.startTimeMs - startTiming.startTimeMs);
}
