import {
  buildArrowTraceLocalDependencyTable,
  buildTraceGraphData,
  buildTraceGraphDataFromJSONTrace
} from './ingestion/arrow-trace';
import {buildJSONTrace} from './ingestion/json-trace';
import {getHeapUsageProbeFields, log} from './log';
import {isTraceChunk} from './trace-chunk';
import {
  getTraceGraphSpanDisplaySource,
  getTraceGraphSpanExternalSpanId,
  iterateTraceGraphSpanRefs
} from './trace-graph-accessors';
import {TraceGraph} from './trace-graph/trace-graph';
import {createTraceGraphRuntimeSource} from './trace-graph/trace-graph-source-adapter';
import {getTraceSpanSourceFilterMatchMask} from './trace-graph/trace-graph-span-filters';
import {
  hasTraceSpanNameFilter,
  hasTraceSpanSourceFilter,
  TRACE_SPAN_FILTER_MASK_NONE
} from './trace-graph/trace-graph-types';
import {
  encodeProcessRef,
  encodeSpanRef,
  encodeVisibleCrossDependencyRef,
  encodeVisibleLocalDependencyRef,
  getProcessRefIndex,
  getSpanRefChunkIndex,
  getSpanRefRowIndex
} from './trace-graph/trace-id-encoder';
import {
  isTraceSpanTimingEligibleForTimeExtents,
  isTraceSpanTimingTimestampEligibleForTimeExtents
} from './trace-time-extents';

import type {
  ArrowTraceChunk,
  ArrowTraceLocalDependencyTable,
  ArrowTraceProcessMetadata,
  ArrowTraceSpanTable,
  TraceGraphData,
  TraceSpanArrowSidecarRow
} from './ingestion/arrow-trace';
import type {TraceChunk} from './trace-chunk';
import type {TraceChunkSpanOverlapRange} from './trace-chunk-data';
import type {
  TraceChunkDescriptor,
  TraceChunkStore,
  TraceChunkStoreReadyChunk,
  TraceWindow
} from './trace-chunk-store';
import type {TraceSpanDisplaySource} from './trace-graph-accessors';
import type {CompiledTraceSpanFilterPlan} from './trace-graph/trace-graph-span-filters';
import type {TraceGraphStats} from './trace-graph/trace-graph-stats';
import type {
  TraceGraphSpanFilterNavigation,
  TraceGraphSpanFilterStore,
  TraceGraphSpanSearchContext,
  TraceGraphSpanSearchRecord,
  TraceSpanFilterMask
} from './trace-graph/trace-graph-types';
import type {ProcessRef, ThreadRef} from './trace-graph/trace-id-encoder';
import type {TraceOwnerRefRegistry} from './trace-graph/trace-owner-ref-registry';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceLocalDependency,
  TraceProcess,
  TraceProcessId,
  TraceSpan,
  TraceSpanId,
  TraceSpanTiming,
  TraceThread,
  TraceThreadId
} from './trace-graph/trace-types';

const HIDDEN_TRACE_CHUNK_SPAN_INSPECTOR_STORE: TraceGraphSpanFilterStore = {
  isFiltered: () => false,
  getFilterReason: () => ({
    filterMask: TRACE_SPAN_FILTER_MASK_NONE,
    isFiltered: false,
    state: 'outside-window'
  }),
  hasActiveSourceSpanFilter: () => false
};

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
  JSONTraceChunkLocalDependency,
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
  TDescriptor extends TraceChunkDescriptor,
  TWindowGraphState = unknown
>(params: {
  /** Active trace chunk store. */
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor, TWindowGraphState>;
  /** Active materialized graph used only for filter/window provenance. */
  readonly traceGraph: TraceGraphSpanSearchContext;
  /** Shared search predicate used to match normalized row text. */
  readonly matchesSearchText: (searchText: string) => boolean;
  /** Maximum number of span records to return. */
  readonly limit: number;
}): TraceGraphSpanSearchRecord[] {
  const results: TraceGraphSpanSearchRecord[] = [];
  const resultLimit = Math.max(0, params.limit);
  if (resultLimit === 0) {
    return results;
  }

  const visitedStats = visitReadyTraceChunkRows(params.traceChunkStore, (row, readyChunk) => {
    if (results.length >= resultLimit) {
      return false;
    }
    if (!params.matchesSearchText(buildTraceChunkSpanSearchText(row))) {
      return;
    }
    const record = buildTraceChunkSpanSearchRecord({
      row,
      readyChunk,
      traceGraph: params.traceGraph
    });
    if (!record) {
      return;
    }
    results.push(record);
  });
  log.probe(0, 'TraceChunkStore search spans done', {
    readyChunkCount: visitedStats.readyChunkCount,
    scannedRowCount: visitedStats.rowCount,
    matchCount: results.length,
    limit: resultLimit,
    ...getHeapUsageProbeFields()
  })();
  return results;
}

/**
 * Apply source-column filename filters to every normalized row in one store-owned chunk payload.
 */
export function applyTraceChunkSourceSpanFilters(
  payload: TraceChunk,
  filterPlan: Readonly<CompiledTraceSpanFilterPlan>
): TraceChunk {
  if (filterPlan.literalPrefixes.length === 0 && filterPlan.regexMatchers.length === 0) {
    return payload.sourceFilterMaskByRow == null
      ? payload
      : omitTraceChunkSourceFilterMask(payload);
  }

  const sourceFilterMaskByRow = new Uint8Array(payload.spanTable.numRows);
  const sourceColumn = getTraceChunkSpanColumn<string>(payload.spanTable, 'source');
  for (let rowIndex = 0; rowIndex < payload.spanTable.numRows; rowIndex += 1) {
    const source = readColumnValue(sourceColumn, rowIndex);
    sourceFilterMaskByRow[rowIndex] = getTraceSpanSourceFilterMatchMask({
      source,
      filterPlan
    });
  }

  return areUint8ArraysEqual(payload.sourceFilterMaskByRow, sourceFilterMaskByRow)
    ? payload
    : {...payload, sourceFilterMaskByRow};
}

/**
 * Return the store-owned source-column filename filter mask for one chunk-local span row.
 *
 * When a compiled filter plan is provided, compute the row mask from the chunk's source column
 * without requiring the chunk payload to carry an eager `sourceFilterMaskByRow` allocation.
 */
export function getTraceChunkSourceFilterMask(
  payload: TraceChunk,
  spanRefRowIndex: number,
  filterPlan?: Readonly<CompiledTraceSpanFilterPlan>
): TraceSpanFilterMask {
  if (hasCompiledTraceSpanFilterPlanMatchers(filterPlan)) {
    const sourceColumn = getTraceChunkSpanColumn<string>(payload.spanTable, 'source');
    return getTraceSpanSourceFilterMatchMask({
      source: readColumnValue(sourceColumn, spanRefRowIndex),
      filterPlan
    });
  }
  return payload.sourceFilterMaskByRow?.[spanRefRowIndex] ?? TRACE_SPAN_FILTER_MASK_NONE;
}

/**
 * Resolve display data for a ready normalized trace-chunk row by store-backed span ref.
 */
export function getTraceChunkStoreSpanDisplaySource<
  TPayload,
  TDescriptor extends TraceChunkDescriptor,
  TWindowGraphState = unknown
>(
  traceChunkStore: TraceChunkStore<TPayload, TDescriptor, TWindowGraphState>,
  spanRef: SpanRef
): TraceSpanDisplaySource | null {
  const matched = findReadyTraceChunkRowBySpanRef(traceChunkStore, spanRef);
  return matched ? buildTraceChunkSpanDisplaySource(matched.row, spanRef) : null;
}

/**
 * Resolve display data for one ready normalized trace-chunk row without scanning the store.
 */
export function getTraceChunkSpanDisplaySource(
  payload: TraceChunk,
  spanRef: SpanRef
): TraceSpanDisplaySource | null {
  if (payload.chunkIndex !== getSpanRefChunkIndex(spanRef)) {
    return null;
  }
  const row = readTraceChunkSpanRow(
    payload,
    getSpanRefRowIndex(spanRef),
    readTraceChunkSpanColumns(payload.spanTable)
  );
  return row ? buildTraceChunkSpanDisplaySource(row, spanRef) : null;
}

/**
 * Resolve visible navigation targets for a store-backed normalized trace-chunk row.
 */
export function getTraceChunkStoreSpanFilterNavigation<
  TPayload,
  TDescriptor extends TraceChunkDescriptor,
  TWindowGraphState = unknown
>(params: {
  /** Active trace chunk store. */
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor, TWindowGraphState>;
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
    spanName: matched.row.name
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
export function searchHiddenTraceChunkSpans<
  TDescriptor extends TraceChunkDescriptor,
  TWindowGraphState = unknown
>(params: {
  /** Active trace chunk store. */
  readonly traceChunkStore: TraceChunkStore<TraceChunk, TDescriptor, TWindowGraphState>;
  /** Active visible TraceGraph used to determine loaded row availability. */
  readonly traceGraph: TraceGraph;
  /** Shared search predicate used to match span name and source text. */
  readonly matchesQuery: (searchText: string) => boolean;
  /** Maximum number of hidden results to return. */
  readonly limit: number;
}): TraceChunkSpanSearchResult[] {
  const results: TraceChunkSpanSearchResult[] = [];
  visitReadyTraceChunkRows(params.traceChunkStore, (row, readyChunk) => {
    if (results.length >= params.limit) {
      return false;
    }
    if (!row.externalSpanId) {
      return;
    }

    const spanRef = encodeSpanRef(readyChunk.chunkIndex, row.rowIndex);
    const filterReason = params.traceGraph.spanFilterReason(spanRef, {
      spanName: row.name
    });
    if (filterReason.state !== 'outside-window') {
      return;
    }

    const searchText = `${row.name} ${row.source ?? ''}`.toLowerCase();
    if (!params.matchesQuery(searchText)) {
      return;
    }

    results.push(buildTraceChunkSpanSearchResult({filterReason, readyChunk, row}));
  });
  return results;
}

/**
 * Resolve visible ancestor and descendant targets for a hidden trace-chunk span.
 */
export function resolveHiddenTraceChunkSpanNavigation<
  TPayload,
  TDescriptor extends TraceChunkDescriptor,
  TWindowGraphState = unknown
>(params: {
  /** Hidden span selected from trace-chunk search. */
  readonly result: TraceChunkSpanSearchResult;
  /** Active trace chunk store. */
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor, TWindowGraphState>;
  /** Active visible TraceGraph used to resolve visible span refs. */
  readonly traceGraph: TraceGraph;
}): TraceChunkSpanNavigation {
  return {
    visibleAncestorSpanRef: resolveVisibleAncestorSpanRef(params),
    visibleDescendantSpanRef: resolveVisibleDescendantSpanRef(params)
  };
}

/**
 * Build a one-spa TraceGraph for rendering details for a loaded span outside the window.
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
    localDependencyIds: [],
    localDependencies: [],
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
    localDependencies: [],
    remoteDependencies: []
  };
  const traceGraph = new TraceGraph(
    createTraceGraphRuntimeSource({
      traceGraphData: buildTraceGraphDataFromJSONTrace(
        buildJSONTrace([process], [], {name: 'Hidden loaded chunk span'})
      ),
      traceStore: HIDDEN_TRACE_CHUNK_SPAN_INSPECTOR_STORE
    }),
    {spanFilters: options?.spanFilters}
  );
  const spanRef = traceGraph.getSpanRefByExternalBlockId(spanId);
  if (spanRef == null) {
    throw new Error('Hidden trace-chunk span inspector graph did not contain its span.');
  }
  return {traceGraph, spanRef};
}

/**
 * Build a visible TraceGraphData for one trace window from ready normalized chunks.
 */
export function buildTraceChunkWindowGraphData<TDescriptor extends TraceChunkDescriptor>(params: {
  /** Human-friendly name for the materialized TraceGraphData. */
  readonly name: string;
  /** Trace-global process/thread owner-ref allocator kept for materializer compatibility. */
  readonly ownerRefRegistry: TraceOwnerRefRegistry;
  /** Registered trace window being materialized. */
  readonly window: TraceWindow;
  /** Ready normalized chunks that may contribute visible rows. */
  readonly readyChunks: readonly TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>[];
}): TraceGraphData {
  const selectedRows = selectTraceChunkRowsForWindow(params.readyChunks, params.window);
  const dependencies = buildTraceChunkParentDependencies(selectedRows);
  const ownerRefSnapshot = params.ownerRefRegistry.createSnapshot();
  const processes = buildArrowTraceProcesses({
    ownerRefRegistry: params.ownerRefRegistry,
    localDependenciesByProcessId: dependencies.localDependenciesByProcessId
  });
  const selectedSpanRefs = selectedRows.map(row => row.spanRef).sort((left, right) => left - right);
  const traceGraphData = buildTraceGraphData({
    name: params.name,
    processes,
    crossDependencies: dependencies.crossDependencies,
    spanTableMap: {},
    localDependencyTableMap: buildLocalDependencyTableMap(
      processes,
      dependencies.localDependenciesByProcessId
    ),
    chunks: buildTraceChunkWindowStorageChunks({
      readyChunks: params.readyChunks
    }),
    spanRefs: selectedSpanRefs,
    ownerRefSnapshot,
    timeExtents: buildTraceChunkWindowTimeExtents(selectedRows),
    stats: buildTraceChunkWindowStats({
      dependencies,
      processes,
      selectedRows
    })
  });
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
      dependencies.crossDependencies.length +
      [...dependencies.localDependenciesByProcessId.values()].reduce(
        (total, processDependencies) => total + processDependencies.length,
        0
      ),
    ...getHeapUsageProbeFields()
  })();
  return traceGraphData;
}

/** Returns a payload copy with any previous source-filter column removed. */
function omitTraceChunkSourceFilterMask(payload: TraceChunk): TraceChunk {
  const {sourceFilterMaskByRow: _sourceFilterMaskByRow, ...payloadWithoutSourceFilterMask} =
    payload;
  return payloadWithoutSourceFilterMask;
}

/** Returns whether two source-filter mask columns contain identical values. */
function areUint8ArraysEqual(
  left: Readonly<Uint8Array> | undefined,
  right: Readonly<Uint8Array>
): boolean {
  if (!left || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < right.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/** Returns whether one compiled source-filter plan has any active matcher. */
function hasCompiledTraceSpanFilterPlanMatchers(
  filterPlan: Readonly<CompiledTraceSpanFilterPlan> | undefined
): filterPlan is Readonly<CompiledTraceSpanFilterPlan> {
  return (
    filterPlan !== undefined &&
    (filterPlan.literalPrefixes.length > 0 || filterPlan.regexMatchers.length > 0)
  );
}

/** Walks chunk parent pointers upward until a visible active-graph ancestor is found. */
function resolveVisibleAncestorSpanRef<
  TPayload,
  TDescriptor extends TraceChunkDescriptor,
  TWindowGraphState
>(params: {
  readonly result: TraceChunkSpanSearchResult;
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor, TWindowGraphState>;
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
  TDescriptor extends TraceChunkDescriptor,
  TWindowGraphState
>(params: {
  readonly result: TraceChunkSpanSearchResult;
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor, TWindowGraphState>;
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
    visitReadyTraceChunkRows(params.traceChunkStore, row => {
      if (!row.externalSpanId || row.parentExternalSpanId !== currentExternalSpanId) {
        return;
      }

      const visibleSpanRef = resolveVisibleSpanRefByExternalSpanId(
        params.traceGraph,
        row.externalSpanId
      );
      if (visibleSpanRef != null) {
        foundSpanRef = visibleSpanRef;
        return false;
      }
      queue.push(row.externalSpanId);
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
      (spanExternalSpanId == null &&
        getTraceGraphSpanDisplaySource(traceGraph, spanRef)?.spanId === externalSpanId)
    ) {
      return spanRef;
    }
  }
  return null;
}

/** Finds one ready chunk row by its generic external span id. */
function findReadyTraceChunkRow<
  TPayload,
  TDescriptor extends TraceChunkDescriptor,
  TWindowGraphState
>(
  traceChunkStore: TraceChunkStore<TPayload, TDescriptor, TWindowGraphState>,
  externalSpanId: string
): TraceChunkSpanRowView | null {
  let matchedRow: TraceChunkSpanRowView | null = null;
  visitReadyTraceChunkRows(traceChunkStore, row => {
    if (row.externalSpanId === externalSpanId) {
      matchedRow = row;
      return false;
    }
  });
  return matchedRow;
}

/** Finds one ready chunk row by its exact store-backed span ref. */
function findReadyTraceChunkRowBySpanRef<
  TPayload,
  TDescriptor extends TraceChunkDescriptor,
  TWindowGraphState
>(
  traceChunkStore: TraceChunkStore<TPayload, TDescriptor, TWindowGraphState>,
  spanRef: SpanRef
): {
  readonly row: TraceChunkSpanRowView;
  readonly readyChunk: TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>;
} | null {
  const chunkIndex = getSpanRefChunkIndex(spanRef);
  const rowIndex = getSpanRefRowIndex(spanRef);
  let matchedRow: {
    readonly row: TraceChunkSpanRowView;
    readonly readyChunk: TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>;
  } | null = null;
  visitReadyTraceChunkRows(traceChunkStore, (row, readyChunk) => {
    if (readyChunk.chunkIndex === chunkIndex && row.rowIndex === rowIndex) {
      matchedRow = {row, readyChunk};
      return false;
    }
  });
  return matchedRow;
}

/** Iterates currently ready chunk rows without triggering additional chunk loads. */
function visitReadyTraceChunkRows<
  TPayload,
  TDescriptor extends TraceChunkDescriptor,
  TWindowGraphState
>(
  traceChunkStore: TraceChunkStore<TPayload, TDescriptor, TWindowGraphState>,
  visitRow: (
    row: TraceChunkSpanRowView,
    readyChunk: TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>
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
    const spanColumns = readTraceChunkSpanColumns(traceChunkReadyChunk.payload.spanTable);
    for (
      let rowIndex = 0;
      rowIndex < traceChunkReadyChunk.payload.spanTable.numRows;
      rowIndex += 1
    ) {
      const row = readTraceChunkSpanRow(traceChunkReadyChunk.payload, rowIndex, spanColumns);
      rowCount += 1;
      if (row && visitRow(row, traceChunkReadyChunk) === false) {
        return {readyChunkCount, rowCount};
      }
    }
  }
  return {readyChunkCount, rowCount};
}

/** Converts one normalized chunk row into canonical search metadata. */
function buildTraceChunkSpanSearchRecord<TDescriptor extends TraceChunkDescriptor>(params: {
  readonly row: TraceChunkSpanRowView;
  readonly readyChunk: TraceChunkStoreReadyChunk<TraceChunk, TDescriptor>;
  readonly traceGraph: TraceGraphSpanSearchContext;
}): TraceGraphSpanSearchRecord | null {
  const spanRef = encodeSpanRef(params.readyChunk.chunkIndex, params.row.rowIndex);
  const primaryTiming = getPrimaryTiming(params.row);
  if (!primaryTiming) {
    return null;
  }
  const filterReason = params.traceGraph.spanFilterReason(spanRef, {
    spanName: params.row.name
  });
  return {
    spanRef,
    spanId: params.row.spanId,
    blockName: params.row.name,
    processName: params.row.process.name,
    threadName: params.row.thread.name,
    primaryTiming,
    keywordsText: params.row.keywords.join(' '),
    searchText: params.row.name.toLowerCase(),
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

/** Converts one normalized chunk row into a display source suitable for selected-card rendering. */
function buildTraceChunkSpanDisplaySource(
  row: TraceChunkSpanRowView,
  spanRef: SpanRef
): TraceSpanDisplaySource {
  return {
    spanRef,
    processRef: undefined,
    threadRef: undefined,
    spanId: row.spanId,
    threadId: row.thread.threadId,
    primaryTimingKey: row.primaryTimingKey,
    timings: row.timings as Record<string, TraceSpanTiming>,
    userData: {...row.userData},
    processName: row.process.name,
    name: row.name,
    source: row.source,
    keywords: [...row.keywords],
    localDependencyIds: [...(row.sidecarRow?.localDependencyIds ?? [])] as TraceDependencyId[],
    crossProcessEndpointId: row.sidecarRow?.crossProcessEndpointId ?? null,
    crossProcessDependencyEndpoints: (row.sidecarRow?.crossProcessDependencyEndpoints ?? []).map(
      endpoint => ({
        type: 'cross-process-dependency-endpoint',
        ...endpoint
      })
    )
  };
}

/** Builds normalized lowercase row text for store-backed span search. */
function buildTraceChunkSpanSearchText(row: TraceChunkSpanRowView): string {
  return [row.name, row.source ?? '', row.keywords.join(' '), row.process.name, row.thread.name]
    .join('\n')
    .toLowerCase();
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
  /** Row-aligned sidecar payload from the normalized chunk, when present. */
  readonly sidecarRow: TraceSpanArrowSidecarRow | null;
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
  /** Primary timing status column. */
  readonly status: ColumnVector<TraceSpanTiming['status']> | null;
  /** Primary timing start column. */
  readonly startTimeMs: ColumnVector<number> | null;
  /** Primary timing end column. */
  readonly endTimeMs: ColumnVector<number> | null;
  /** Primary timing duration column. */
  readonly durationMs: ColumnVector<number> | null;
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
  window: TraceWindow
): SelectedTraceChunkSpanRow[] {
  const selectedRows: SelectedTraceChunkSpanRow[] = [];
  const scratchSelectedRow = {} as MutableSelectedTraceChunkSpanRow;
  for (const readyChunk of readyChunks) {
    const spanColumns = readTraceChunkSpanColumns(readyChunk.payload.spanTable);
    for (let rowIndex = 0; rowIndex < readyChunk.payload.spanTable.numRows; rowIndex += 1) {
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
  window: TraceWindow
): boolean {
  return overlapRanges.some(
    range => range.endTimeMs >= window.minTimeMs && range.startTimeMs <= window.maxTimeMs
  );
}

/** Builds Arrow process metadata from the store's current owner-ref snapshot. */
function buildArrowTraceProcesses(params: {
  readonly ownerRefRegistry: TraceOwnerRefRegistry;
  readonly localDependenciesByProcessId: ReadonlyMap<TraceProcessId, TraceLocalDependency[]>;
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
      localDependencies:
        params.localDependenciesByProcessId.get(process.processId as TraceProcessId) ?? [],
      remoteDependencies: []
    };
  });
}

/** Builds window storage chunks by reusing the original stored chunk tables. */
function buildTraceChunkWindowStorageChunks(params: {
  readonly readyChunks: readonly TraceChunkStoreReadyChunk<TraceChunk, TraceChunkDescriptor>[];
}): ArrowTraceChunk[] {
  return params.readyChunks.map(readyChunk => ({
    chunkIndex: readyChunk.chunkIndex,
    chunkRef: readyChunk.chunkRef,
    chunkKey: readyChunk.descriptor.chunkKey,
    processRefs: getTraceChunkProcessRefs(readyChunk.payload),
    processId: null,
    spanTable: readyChunk.payload.spanTable,
    localDependencyTable: readyChunk.payload.localDependencyTable,
    spanSidecarRows: readyChunk.payload.spanSidecarRows,
    spanSidecarTable: readyChunk.payload.spanSidecarTable
  }));
}

/** Returns process refs represented by one original stored chunk payload. */
function getTraceChunkProcessRefs(payload: TraceChunk): readonly ProcessRef[] {
  if (payload.processRefs.length > 0) {
    return payload.processRefs;
  }
  const processRefColumn = getTraceChunkSpanColumn(payload.spanTable, 'process_ref');
  const processRefs: ProcessRef[] = [];
  const seenProcessRefs = new Set<ProcessRef>();
  for (let rowIndex = 0; rowIndex < payload.spanTable.numRows; rowIndex += 1) {
    const processRef = readArrowRefColumn(processRefColumn, rowIndex) as ProcessRef | null;
    if (processRef != null && !seenProcessRefs.has(processRef)) {
      processRefs.push(processRef);
      seenProcessRefs.add(processRef);
    }
  }
  if (processRefs.length > 0) {
    return processRefs;
  }
  return payload.processes.map(process => encodeProcessRef(process.rankNum));
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
  const localDependencyCount = [
    ...params.dependencies.localDependenciesByProcessId.values()
  ].reduce((total, dependencies) => total + dependencies.length, 0);
  const crossDependencyCount = params.dependencies.crossDependencies.length;
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
    localDependencyCount,
    notStartedSpanCount,
    unfinishedSpanCount,
    droppedSpanCount: 0,
    dependencyCount: localDependencyCount + crossDependencyCount,
    droppedDependencyCount: 0,
    crossDependencyCount,
    droppedCrossDependencyCount: 0
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
  readonly localDependenciesByProcessId: ReadonlyMap<TraceProcessId, TraceLocalDependency[]>;
  readonly crossDependencies: readonly TraceCrossProcessDependency[];
} {
  const rowByExternalSpanId = new Map<string, SelectedTraceChunkSpanRow>();
  for (const selectedRow of selectedRows) {
    if (selectedRow.externalSpanId && !rowByExternalSpanId.has(selectedRow.externalSpanId)) {
      rowByExternalSpanId.set(selectedRow.externalSpanId, selectedRow);
    }
  }

  const localDependenciesByProcessId = new Map<TraceProcessId, TraceLocalDependency[]>();
  const crossDependencies: TraceCrossProcessDependency[] = [];
  for (const endRow of selectedRows) {
    for (const parentExternalSpanId of endRow.parentExternalSpanIds) {
      const startRow = rowByExternalSpanId.get(parentExternalSpanId);
      if (!startRow) {
        continue;
      }
      appendTraceChunkParentDependency({
        startRow,
        endRow,
        localDependenciesByProcessId,
        crossDependencies
      });
    }
  }

  return {localDependenciesByProcessId, crossDependencies};
}

/** Appends one local or cross-process parent dependency for two visible chunk rows. */
function appendTraceChunkParentDependency(params: {
  readonly startRow: SelectedTraceChunkSpanRow;
  readonly endRow: SelectedTraceChunkSpanRow;
  readonly localDependenciesByProcessId: Map<TraceProcessId, TraceLocalDependency[]>;
  readonly crossDependencies: TraceCrossProcessDependency[];
}): void {
  const waitTimeMs = computeWaitTimeMs(params.startRow.primaryTiming, params.endRow.primaryTiming);
  const dependencyId =
    `dep:parent:${params.startRow.externalSpanId ?? params.startRow.spanId}->${params.endRow.externalSpanId ?? params.endRow.spanId}` as TraceDependencyId;
  const startProcessId = params.startRow.process.processId as TraceProcessId;
  const endProcessId = params.endRow.process.processId as TraceProcessId;
  if (startProcessId === endProcessId) {
    const dependencies = params.localDependenciesByProcessId.get(startProcessId) ?? [];
    dependencies.push({
      type: 'trace-local-dependency',
      dependencyRef: encodeVisibleLocalDependencyRef(dependencies.length),
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
    params.localDependenciesByProcessId.set(startProcessId, dependencies);
    return;
  }

  const endpointId =
    `endpoint:parent:${params.startRow.externalSpanId ?? params.startRow.spanId}->${params.endRow.externalSpanId ?? params.endRow.spanId}` as TraceCrossProcessEndpointId;
  params.crossDependencies.push({
    type: 'trace-cross-process-dependency',
    dependencyRef: encodeVisibleCrossDependencyRef(params.crossDependencies.length),
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
function buildLocalDependencyTableMap(
  processes: readonly ArrowTraceProcessMetadata[],
  localDependenciesByProcessId: ReadonlyMap<TraceProcessId, TraceLocalDependency[]>
): Readonly<Record<TraceProcessId, ArrowTraceLocalDependencyTable>> {
  return Object.fromEntries(
    processes.map(process => [
      process.processId as TraceProcessId,
      buildArrowTraceLocalDependencyTable(
        localDependenciesByProcessId.get(process.processId as TraceProcessId) ?? []
      )
    ])
  ) as Readonly<Record<TraceProcessId, ReturnType<typeof buildArrowTraceLocalDependencyTable>>>;
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
  const primaryTimingKey =
    readColumnValue(spanColumns.primaryTimingKey, spanTableRowIndex) ?? 'primary';
  const sidecarTimings = payload.spanSidecarRows?.[spanTableRowIndex]?.timings;
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
  out.primaryTiming = sidecarTimings
    ? (sidecarTimings[primaryTimingKey] ?? null)
    : readPrimaryTiming(spanColumns, spanTableRowIndex);
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
    const dependencyRow = payload.sourceDependencyTable?.rows[sourceDependencyRowIndex];
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
  const sidecarRow = payload.spanSidecarRows?.[spanTableRowIndex] ?? null;
  const primaryTimingKey =
    readColumnValue(spanColumns.primaryTimingKey, spanTableRowIndex) ?? 'primary';
  const primaryTiming = readPrimaryTiming(spanColumns, spanTableRowIndex);
  const timings = sidecarRow?.timings ?? {[primaryTimingKey]: primaryTiming};
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
    keywords: sidecarRow?.keywords ?? [],
    primaryTimingKey,
    timings,
    userData: sidecarRow?.userData ?? {},
    overlapRanges: payload.rowWindowTable?.overlapRangesByRow[spanRefRowIndex] ?? [],
    sidecarRow
  };
}

/** Resolves the process metadata represented by one chunk span-table row. */
function resolveTraceChunkRowProcess(
  chunk: Pick<TraceChunk, 'processes'>,
  processRef: number | null
): ArrowTraceProcessMetadata | null {
  if (processRef != null) {
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
    status: getTraceChunkSpanColumn(spanTable, 'status'),
    startTimeMs: getTraceChunkSpanColumn(spanTable, 'start_time_ms'),
    endTimeMs: getTraceChunkSpanColumn(spanTable, 'end_time_ms'),
    durationMs: getTraceChunkSpanColumn(spanTable, 'duration_ms')
  };
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

/** Reads one typed value from an extracted Arrow column if the column exists. */
function readColumnValue<T>(column: ColumnVector<T> | null, rowIndex: number): T | null {
  return column ? (column.get(rowIndex) ?? null) : null;
}

/** Reads one extracted Arrow ref column and normalizes numeric/bigint Arrow scalar values. */
function readArrowRefColumn(column: ColumnVector<unknown> | null, rowIndex: number): number | null {
  return normalizeArrowRefNumber(readColumnValue(column, rowIndex));
}

/** Normalizes Arrow ref columns that may be nullish or bigint-backed. */
function normalizeArrowRefNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
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
function readPrimaryTiming(spanColumns: TraceChunkSpanColumns, rowIndex: number): TraceSpanTiming {
  const status = readColumnValue(spanColumns.status, rowIndex) ?? 'finished';
  const durationMs = readColumnValue(spanColumns.durationMs, rowIndex) ?? 0;
  return {
    status,
    startTimeMs: readColumnValue(spanColumns.startTimeMs, rowIndex) ?? 0,
    endTimeMs: readColumnValue(spanColumns.endTimeMs, rowIndex) ?? 0,
    durationMs,
    durationMsAsString: status === 'finished' ? `${durationMs}ms` : 'Not finished'
  };
}

/** Returns the chunk row's primary timing projection when available. */
function getPrimaryTiming(row: TraceChunkSpanRowView): TraceSpanTiming | null {
  return row.timings[row.primaryTimingKey] ?? null;
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
