import {IndexedArrowTable} from '../../arrow-utils/index';
import {buildTraceProcessSpanRefTableWithFilterMaskColumn} from '../ingestion/arrow-trace';
import {getHeapUsageProbeFields, log} from '../log';
import {
  getArrowTraceSpanField,
  getArrowTraceSpanRow,
  getTraceGraphProcessSpanOrdinal,
  getTraceGraphSpanRefProcessId,
  getTraceGraphSpanTableRowIndex,
  getUniqueTraceGraphSpanRef,
  iterateTraceGraphProcessSpanRefs
} from '../trace-graph-accessors';
import {buildTraceCardSpan} from './build-trace-span-card-data';
import {
  getArrowTraceSpanCrossProcessEndpoints,
  getArrowTraceSpanLaneValue
} from './trace-graph-arrow-fields';
import {
  endpointMatchesCrossDependency,
  endpointMatchesCrossDependencyValues,
  getProcessIdByRankNum,
  getProcessScopedSpanRefsByProcessId,
  isParentLocalDependency
} from './trace-graph-selection-utils';
import {
  areSpanFilterListsEqual,
  buildCompiledTraceSpanFilterPlan,
  getTraceSpanNameFilterMatchMask,
  getTraceSpanSourceFilterMatchMask,
  normalizeTraceSpanFilters
} from './trace-graph-span-filters';
import {TRACE_SPAN_FILTER_MASK_NONE, TRACE_SPAN_FILTER_MASK_TOPOLOGY} from './trace-graph-types';
import {
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  encodeVisibleCrossDependencyRef,
  encodeVisibleLocalDependencyRef,
  getCrossDependencyRefIndex,
  isCrossDependencyRef,
  isLocalDependencyRef,
  isVisibleCrossDependencyRef,
  isVisibleLocalDependencyRef
} from './trace-id-encoder';

import type {
  ArrowTraceCrossDependencyTable,
  ArrowTraceLocalDependencyTable,
  ArrowTraceProcessMetadata,
  TraceGraphData,
  TraceProcessSpanRefTable
} from '../ingestion/arrow-trace';
import type {
  TraceCrossDependencySource,
  TraceDependencySource,
  TraceLocalDependencySource
} from '../trace-graph-accessors';
import type {TraceCardSpan, TraceSpanCardParentChainEntry} from './build-trace-span-card-data';
import type {TraceGraph} from './trace-graph';
import type {
  TraceGraphFilteredSpanCountsByFilter,
  TraceGraphOverlappingParentSpanFilter,
  TraceGraphPreparedState,
  TraceGraphProjection,
  TraceGraphSimilarDurationChainSpanFilter,
  TraceGraphVisibleDependencyOverride,
  TraceGraphVisibleIndex,
  TraceGraphVisibleSpanTable,
  TraceSpanFilterMask
} from './trace-graph-types';
import type {
  CrossDependencyRef,
  LocalDependencyRef,
  ProcessRef,
  ThreadRef,
  TraceDependencyRef,
  VisibleCrossDependencyRef,
  VisibleDependencyRef,
  VisibleLocalDependencyRef
} from './trace-id-encoder';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceDependency,
  TraceDependencyId,
  TraceLocalDependency,
  TraceProcessId,
  TraceSpanId,
  TraceThreadId
} from './trace-types';

type TraceProcessSpanFilterMaskState = {
  /** Process whose process-local span table receives nonzero graph filter state. */
  readonly processId: TraceProcessId;
  /** Source process span table defining the row order for `filterMask`. */
  readonly processSpanTable: TraceProcessSpanRefTable;
  /** Mutable row-aligned mask buffer written directly by filter stages during graph-state build. */
  readonly filterMask: Uint8Array;
};

type TraceProcessSpanFilterMaskStateMap = Partial<
  Record<TraceProcessId, TraceProcessSpanFilterMaskState>
>;

/** Caches direct parent span refs keyed by child span ref for selected-card parent walks. */
const directParentSpanRefMapCache = new WeakMap<
  Readonly<TraceGraph>,
  ReadonlyMap<SpanRef, readonly SpanRef[]>
>();

/**
 * Builds one owned typed row-index buffer for visible spans in one process.
 *
 * @param params - Visible-block row-index build inputs.
 * @param params.traceGraph - Source graph providing canonical block-to-row lookups.
 * @param params.spanRefs - Visible span refs in the order that should be preserved by the view.
 * @returns Owned typed raw-row indexes matching the supplied visible block order.
 */
function getVisibleBlockRowIndexesForProcess(params: {
  traceGraph: TraceGraph;
  processId: TraceProcessId;
  spanRefs: readonly SpanRef[];
}): Int32Array {
  const {spanRefs} = params;
  const rowIndexes = new Int32Array(spanRefs.length);

  for (let visibleRowIndex = 0; visibleRowIndex < spanRefs.length; visibleRowIndex += 1) {
    rowIndexes[visibleRowIndex] =
      getTraceGraphProcessSpanOrdinal(
        params.traceGraph,
        params.processId,
        spanRefs[visibleRowIndex]!
      ) ?? -1;
  }

  return rowIndexes;
}

/** Resolves a source span ref by block id only when the block id is unique in the source tables. */
function resolveSourceSpanRef(
  traceGraph: Readonly<TraceGraphData>,
  spanId: TraceSpanId
): SpanRef | null {
  return getUniqueTraceGraphSpanRef(traceGraph, spanId);
}

/**
 * Builds direct parent span refs keyed by child span ref for selected-card parent walks.
 */
function buildDirectParentSpanRefMap(
  traceGraph: Readonly<TraceGraph>
): ReadonlyMap<SpanRef, readonly SpanRef[]> {
  const parentSpanRefs = new Map<SpanRef, SpanRef[]>();
  const scopedSpanRefsByProcessId = getProcessScopedSpanRefsByProcessId(traceGraph);

  for (const process of traceGraph.processes) {
    const processId = process.processId as TraceProcessId;
    const processScopedSpanRefs = scopedSpanRefsByProcessId[processId];
    const dependencyTable = traceGraph.localDependencyTableMap[processId];
    if (!processScopedSpanRefs || !dependencyTable) {
      continue;
    }

    const startSpanIdColumn = dependencyTable.getChild('startSpanId');
    const endSpanIdColumn = dependencyTable.getChild('endSpanId');
    const hasParentKeywordColumn = dependencyTable.getChild('hasParentKeyword');

    for (let rowIndex = 0; rowIndex < dependencyTable.numRows; rowIndex += 1) {
      if (hasParentKeywordColumn?.get(rowIndex) !== true) {
        continue;
      }

      const startSpanId = startSpanIdColumn?.get(rowIndex) as TraceSpanId | null | undefined;
      const endSpanId = endSpanIdColumn?.get(rowIndex) as TraceSpanId | null | undefined;
      const startSpanRef = startSpanId ? (processScopedSpanRefs.get(startSpanId) ?? null) : null;
      const endSpanRef = endSpanId ? (processScopedSpanRefs.get(endSpanId) ?? null) : null;
      if (startSpanRef == null || endSpanRef == null) {
        continue;
      }

      appendDirectParentSpanRef(parentSpanRefs, endSpanRef, startSpanRef);
    }
  }

  const processIdByRankNum = getProcessIdByRankNum(traceGraph);
  const startRankNumColumn = getArrowTableColumn(traceGraph.crossDependencyTable, 'startRankNum');
  const endRankNumColumn = getArrowTableColumn(traceGraph.crossDependencyTable, 'endRankNum');
  const startSpanIdColumn = getArrowTableColumn(traceGraph.crossDependencyTable, 'startSpanId');
  const endSpanIdColumn = getArrowTableColumn(traceGraph.crossDependencyTable, 'endSpanId');
  const hasParentKeywordColumn = getArrowTableColumn(
    traceGraph.crossDependencyTable,
    'hasParentKeyword'
  );
  const topologyColumn = getArrowTableColumn(traceGraph.crossDependencyTable, 'topology');

  for (let rowIndex = 0; rowIndex < traceGraph.crossDependencyTable.numRows; rowIndex += 1) {
    if (
      hasParentKeywordColumn?.get(rowIndex) !== true &&
      topologyColumn?.get(rowIndex) !== 'parent'
    ) {
      continue;
    }

    const startProcessId = processIdByRankNum.get(
      (startRankNumColumn?.get(rowIndex) as number | null | undefined) ?? NaN
    );
    const endProcessId = processIdByRankNum.get(
      (endRankNumColumn?.get(rowIndex) as number | null | undefined) ?? NaN
    );
    if (!startProcessId || !endProcessId) {
      continue;
    }

    const startSpanId = startSpanIdColumn?.get(rowIndex) as TraceSpanId | null | undefined;
    const endSpanId = endSpanIdColumn?.get(rowIndex) as TraceSpanId | null | undefined;
    const startSpanRef = startSpanId
      ? (getProcessScopedSpanRefsByProcessId(traceGraph)[startProcessId]?.get(startSpanId) ?? null)
      : null;
    const endSpanRef = endSpanId
      ? (getProcessScopedSpanRefsByProcessId(traceGraph)[endProcessId]?.get(endSpanId) ?? null)
      : null;
    if (startSpanRef == null || endSpanRef == null) {
      continue;
    }

    appendDirectParentSpanRef(parentSpanRefs, endSpanRef, startSpanRef);
  }

  return parentSpanRefs;
}

/**
 * Returns the memoized direct parent span-ref lookup used by selected-card parent walks.
 */
export function getDirectParentSpanRefMap(
  traceGraph: Readonly<TraceGraph>
): ReadonlyMap<SpanRef, readonly SpanRef[]> {
  const cachedParentSpanRefMap = directParentSpanRefMapCache.get(traceGraph);
  if (cachedParentSpanRefMap) {
    return cachedParentSpanRefMap;
  }

  const nextParentSpanRefMap = buildDirectParentSpanRefMap(traceGraph);
  directParentSpanRefMapCache.set(traceGraph, nextParentSpanRefMap);
  return nextParentSpanRefMap;
}

/**
 * Reads one Arrow table column without letting malformed chunked tables crash card resolution.
 */
function getArrowTableColumn(
  table: {getChild(name: string): {get(index: number): unknown} | null | undefined},
  columnName: string
): {get(index: number): unknown} | null {
  try {
    return table.getChild(columnName) ?? null;
  } catch {
    return null;
  }
}

function buildLocalParentDependencyMap(traceGraph: {
  processes: ReadonlyArray<Pick<ArrowTraceProcessMetadata, 'processId'>>;
  localDependencyTableMap: Readonly<Record<TraceProcessId, ArrowTraceLocalDependencyTable>>;
}): Map<TraceSpanId, TraceSpanId> {
  const parentDependencyMap = new Map<TraceSpanId, TraceSpanId>();

  for (const process of traceGraph.processes) {
    const processId = process.processId as TraceProcessId;
    const dependencyTable = traceGraph.localDependencyTableMap[processId];
    const dependencyCount = dependencyTable?.numRows ?? 0;
    for (let rowIndex = 0; rowIndex < dependencyCount; rowIndex += 1) {
      if (dependencyTable.getChild('hasParentKeyword')?.get(rowIndex) !== true) {
        continue;
      }

      const startSpanId = dependencyTable.getChild('startSpanId')?.get(rowIndex) as
        | TraceSpanId
        | null
        | undefined;
      const endSpanId = dependencyTable.getChild('endSpanId')?.get(rowIndex) as
        | TraceSpanId
        | null
        | undefined;
      if (startSpanId && endSpanId) {
        parentDependencyMap.set(endSpanId, startSpanId);
      }
    }
  }

  return parentDependencyMap;
}

function buildGlobalParentDependencyMap(traceGraph: {
  processes: ReadonlyArray<Pick<ArrowTraceProcessMetadata, 'processId'>>;
  localDependencyTableMap: Readonly<Record<TraceProcessId, ArrowTraceLocalDependencyTable>>;
  crossDependencyTable: Readonly<ArrowTraceCrossDependencyTable>;
}): Map<TraceSpanId, TraceSpanId> {
  const parentDependencyMap = buildLocalParentDependencyMap(traceGraph);

  const dependencyCount = traceGraph.crossDependencyTable.numRows;
  const hasParentKeywordColumn = getArrowTableColumn(
    traceGraph.crossDependencyTable,
    'hasParentKeyword'
  );
  const topologyColumn = getArrowTableColumn(traceGraph.crossDependencyTable, 'topology');
  const startSpanIdColumn = getArrowTableColumn(traceGraph.crossDependencyTable, 'startSpanId');
  const endSpanIdColumn = getArrowTableColumn(traceGraph.crossDependencyTable, 'endSpanId');
  for (let rowIndex = 0; rowIndex < dependencyCount; rowIndex += 1) {
    const hasParentKeyword = hasParentKeywordColumn?.get(rowIndex);
    const topology = topologyColumn?.get(rowIndex);
    if (hasParentKeyword !== true && topology !== 'parent') {
      continue;
    }

    const startSpanId = startSpanIdColumn?.get(rowIndex) as TraceSpanId | null | undefined;
    const endSpanId = endSpanIdColumn?.get(rowIndex) as TraceSpanId | null | undefined;
    if (startSpanId && endSpanId) {
      parentDependencyMap.set(endSpanId, startSpanId);
    }
  }

  return parentDependencyMap;
}

function resolveFilteredAncestorBlockId(params: {
  spanId: TraceSpanId;
  filteredBlockIds: ReadonlySet<TraceSpanId>;
  parentDependencyMap: ReadonlyMap<TraceSpanId, TraceSpanId>;
  ancestorCache: Map<TraceSpanId, TraceSpanId | null>;
  recursionGuard: Set<TraceSpanId>;
}): TraceSpanId | null {
  const {spanId, filteredBlockIds, parentDependencyMap, ancestorCache, recursionGuard} = params;

  if (!filteredBlockIds.has(spanId)) {
    return spanId;
  }

  const cachedAncestor = ancestorCache.get(spanId);
  if (cachedAncestor !== undefined) {
    return cachedAncestor;
  }

  let currentBlockId = spanId;
  const path: TraceSpanId[] = [];

  while (true) {
    const cached = ancestorCache.get(currentBlockId);
    if (cached !== undefined) {
      for (let index = 0; index < path.length; index += 1) {
        const visibleAncestor = cached;
        const pathBlockId = path[index];
        ancestorCache.set(pathBlockId, visibleAncestor);
        recursionGuard.delete(pathBlockId);
      }
      return cached;
    }

    if (!filteredBlockIds.has(currentBlockId)) {
      for (let index = 0; index < path.length; index += 1) {
        const pathBlockId = path[index];
        ancestorCache.set(pathBlockId, currentBlockId);
        recursionGuard.delete(pathBlockId);
      }
      return currentBlockId;
    }

    if (recursionGuard.has(currentBlockId)) {
      for (let index = 0; index < path.length; index += 1) {
        const pathBlockId = path[index];
        ancestorCache.set(pathBlockId, null);
        recursionGuard.delete(pathBlockId);
      }
      return null;
    }

    const directParent = parentDependencyMap.get(currentBlockId);
    if (!directParent) {
      for (let index = 0; index < path.length; index += 1) {
        const pathBlockId = path[index];
        ancestorCache.set(pathBlockId, null);
        recursionGuard.delete(pathBlockId);
      }
      return null;
    }

    recursionGuard.add(currentBlockId);
    path.push(currentBlockId);
    currentBlockId = directParent;
  }
}

/**
 * Precomputes resolved visible ancestors for every filtered span under one parent map.
 */
function buildResolvedFilteredAncestorMap(params: {
  filteredBlockIds: ReadonlySet<TraceSpanId>;
  parentDependencyMap: ReadonlyMap<TraceSpanId, TraceSpanId>;
}): ReadonlyMap<TraceSpanId, TraceSpanId | null> {
  const ancestorCache = new Map<TraceSpanId, TraceSpanId | null>();
  for (const spanId of params.filteredBlockIds) {
    resolveFilteredAncestorBlockId({
      spanId,
      filteredBlockIds: params.filteredBlockIds,
      parentDependencyMap: params.parentDependencyMap,
      ancestorCache,
      recursionGuard: new Set()
    });
  }
  return ancestorCache;
}

/**
 * Returns whether a compact span ref points at a real source span row in this graph.
 */
export function isValidSourceSpanRef(traceGraph: Readonly<TraceGraph>, spanRef: SpanRef): boolean {
  return getTraceGraphSpanTableRowIndex(traceGraph, spanRef) != null;
}

/**
 * Walks process-aware parent dependencies from an exact span ref.
 */
export function buildParentDependencyChainBySpanRef(params: {
  traceGraph: Readonly<TraceGraph>;
  spanRef: SpanRef;
  useVisibleParents: boolean;
}): TraceSpanCardParentChainEntry[] {
  const {traceGraph, spanRef, useVisibleParents} = params;
  if (!isValidSourceSpanRef(traceGraph, spanRef)) {
    return [];
  }

  const parentSpanRefs = getDirectParentSpanRefMap(traceGraph);
  const chain: TraceSpanCardParentChainEntry[] = [];
  const visited = new Set<SpanRef>([spanRef]);
  const queue = (parentSpanRefs.get(spanRef) ?? []).map(parentSpanRef => ({
    chainIndex: 1,
    spanRef: parentSpanRef
  }));

  while (queue.length > 0) {
    const parentEntry = queue.shift();
    if (!parentEntry) {
      continue;
    }
    const resolvedParentSpanRef =
      useVisibleParents && traceGraph.spanIsFiltered(parentEntry.spanRef)
        ? traceGraph.getTraceSpanFilteredParentRef(parentEntry.spanRef)
        : parentEntry.spanRef;
    if (resolvedParentSpanRef == null || visited.has(resolvedParentSpanRef)) {
      continue;
    }

    const parentSpan = buildTraceCardSpan({
      traceGraph,
      spanRef: resolvedParentSpanRef
    });
    if (!parentSpan) {
      continue;
    }

    chain.push({
      spanRef: resolvedParentSpanRef,
      span: parentSpan,
      chainIndex: parentEntry.chainIndex,
      isFiltered: parentSpan.isFiltered
    });
    visited.add(resolvedParentSpanRef);
    for (const nextParentSpanRef of parentSpanRefs.get(resolvedParentSpanRef) ?? []) {
      queue.push({
        chainIndex: parentEntry.chainIndex + 1,
        spanRef: nextParentSpanRef
      });
    }
  }

  return chain;
}

/**
 * Appends one direct parent span ref to a child row while preserving source dependency order.
 */
function appendDirectParentSpanRef(
  parentSpanRefs: Map<SpanRef, SpanRef[]>,
  childSpanRef: SpanRef,
  parentSpanRef: SpanRef
): void {
  const childParentSpanRefs = parentSpanRefs.get(childSpanRef) ?? [];
  if (childParentSpanRefs.includes(parentSpanRef)) {
    return;
  }
  childParentSpanRefs.push(parentSpanRef);
  parentSpanRefs.set(childSpanRef, childParentSpanRefs);
}

/**
 * Walks one dependency-key parent chain through source dependencies and returns card-ready spans.
 */
export function buildDependencyChainFromSourceAdapter(params: {
  /** Exact span ref of the starting span. */
  spanRef: SpanRef;
  /** Dependency keyword that identifies the parent chain edge to follow. */
  dependencyKey: string;
  /** Graph whose Arrow-backed accessors resolve projected dependency fields. */
  traceGraph: Readonly<TraceGraph>;
}): TraceCardSpan[] {
  const {spanRef, dependencyKey, traceGraph} = params;
  const projection = traceGraph.getSourceProjection();
  const chain: TraceCardSpan[] = [];
  let currentRef: SpanRef | null = spanRef;
  const visited = new Set<SpanRef>([spanRef]);
  const normalizedKey = dependencyKey.toUpperCase();

  while (currentRef != null) {
    const parentDependency: TraceDependency | undefined = projection.inDependenciesBySpanRef
      .get(currentRef)
      ?.find(
        dependency => dependency.endSpanRef === currentRef && dependency.keywords.has(normalizedKey)
      );
    if (!parentDependency) {
      break;
    }
    const parentRef: SpanRef | null = parentDependency.startSpanRef ?? null;
    const parentId = parentDependency.startSpanId ?? null;
    if (parentRef == null || !parentId || visited.has(parentRef)) {
      break;
    }
    const parentSpan = buildTraceCardSpanForProjectionDependencyStart({
      dependency: parentDependency,
      fallbackBlockId: parentId,
      traceGraph
    });
    if (!parentSpan) {
      break;
    }
    chain.push(parentSpan);
    visited.add(parentRef);
    currentRef = parentRef;
  }

  return chain;
}

/**
 * Walks one dependency-key parent chain through the active visible projection.
 */
export function buildVisibleDependencyChainFromProjection(params: {
  /** Exact span ref of the starting visible span. */
  spanRef: SpanRef;
  /** Dependency keyword that identifies the visible parent-chain edge to follow. */
  dependencyKey: string;
  /** Graph whose visible dependency accessors resolve stitched dependency fields. */
  traceGraph: Readonly<TraceGraph>;
}): TraceCardSpan[] {
  const {spanRef, dependencyKey, traceGraph} = params;
  const projection = traceGraph.getProjection();
  const normalizedKey = dependencyKey.toUpperCase();
  const chain: TraceCardSpan[] = [];
  let currentRef: SpanRef | null = spanRef;
  const visited = new Set<SpanRef>([spanRef]);

  while (currentRef != null) {
    const parentDependency: TraceDependency | undefined = projection.inDependenciesBySpanRef
      .get(currentRef)
      ?.find(
        dependency => dependency.endSpanRef === currentRef && dependency.keywords.has(normalizedKey)
      );
    if (!parentDependency) {
      break;
    }
    const parentRef: SpanRef | null = parentDependency.startSpanRef ?? null;
    const parentId = parentDependency.startSpanId ?? null;
    if (parentRef == null || !parentId || visited.has(parentRef)) {
      break;
    }
    const parentSpan = buildTraceCardSpanForProjectionDependencyStart({
      dependency: parentDependency,
      fallbackBlockId: parentId,
      traceGraph
    });
    if (!parentSpan) {
      break;
    }
    chain.push(parentSpan);
    visited.add(parentRef);
    currentRef = parentRef;
  }

  return chain;
}

/**
 * Builds one card span from a projected dependency start without materializing `TraceSpan`.
 */
function buildTraceCardSpanForProjectionDependencyStart(params: {
  /** Projected dependency row whose start span should be returned. */
  dependency: TraceDependency;
  /** External block id fallback for legacy projected dependencies that lack a start span ref. */
  fallbackBlockId: TraceSpanId;
  /** Graph that owns the Arrow span fields used by the card model. */
  traceGraph: Readonly<TraceGraph>;
}): TraceCardSpan | null {
  const {dependency, fallbackBlockId, traceGraph} = params;
  const spanRef =
    dependency.startSpanRef ?? traceGraph.getSpanRefByExternalBlockId(fallbackBlockId);
  return spanRef == null ? null : buildTraceCardSpan({traceGraph, spanRef});
}

/** Materializes one visible dependency object for one exact runtime dependency ref. */
export function materializeVisibleDependencyByRef(
  traceGraph: Readonly<TraceGraph>,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef
): TraceDependency | null {
  const visibleIndex = (
    traceGraph as unknown as {
      getVisibleIndex(): TraceGraphVisibleIndex;
    }
  ).getVisibleIndex();
  const dependencySource = traceGraph.getVisibleDependencySourceByRef(dependencyRef);
  const dependencyId = dependencySource?.dependencyId ?? null;
  if (!dependencyId) {
    return null;
  }
  if (!traceGraph.hasActiveSpanFilter()) {
    return dependencySource ? materializeDependencySourceForProjection(dependencySource) : null;
  }

  return materializeVisibleDependency({
    traceGraph,
    dependencyId,
    dependencyOverrideSpec:
      isVisibleLocalDependencyRef(dependencyRef) || isVisibleCrossDependencyRef(dependencyRef)
        ? (visibleIndex.dependencyOverrideSpecsByRef.get(dependencyRef) ?? null)
        : null,
    sourceDependency: dependencySource
      ? materializeDependencySourceForProjection(dependencySource)
      : null
  });
}

/** Materializes one exact visible dependency source without collapsing through dependency id. */
function materializeVisibleDependencySource(
  traceGraph: Readonly<TraceGraph>,
  dependencySource: TraceDependencySource
): TraceDependency | null {
  return dependencySource.dependencyRef != null
    ? materializeVisibleDependencyByRef(traceGraph, dependencySource.dependencyRef)
    : null;
}

function materializeDependencySourceForProjection(
  dependencySource: TraceDependencySource
): TraceDependency {
  if (dependencySource.type === 'trace-cross-process-dependency') {
    const {keywords, ...crossDependencySource} = dependencySource;
    return {
      ...crossDependencySource,
      keywords: new Set(keywords)
    } satisfies TraceCrossProcessDependency;
  }

  const {keywords, ...localDependencySource} = dependencySource;
  return {
    ...localDependencySource,
    keywords: new Set(keywords)
  } satisfies TraceDependency;
}

function addDependencyToProjectionMaps(params: {
  /** Incoming visible dependencies grouped by endpoint span ref. */
  inDependenciesBySpanRef: Map<SpanRef, TraceDependency[]>;
  /** Outgoing visible dependencies grouped by endpoint span ref. */
  outDependenciesBySpanRef: Map<SpanRef, TraceDependency[]>;
  dependency: TraceDependency;
}) {
  const {inDependenciesBySpanRef, outDependenciesBySpanRef, dependency} = params;
  if (dependency.endSpanRef != null) {
    const inDependencies = inDependenciesBySpanRef.get(dependency.endSpanRef) ?? [];
    inDependencies.push(dependency);
    inDependenciesBySpanRef.set(dependency.endSpanRef, inDependencies);
  }
  if (dependency.startSpanRef != null) {
    const outDependencies = outDependenciesBySpanRef.get(dependency.startSpanRef) ?? [];
    outDependencies.push(dependency);
    outDependenciesBySpanRef.set(dependency.startSpanRef, outDependencies);
  }
}

/** Returns whether one endpoint lacks a resolved cross-dependency row in Arrow storage. */
function isUnresolvedCrossEndpointFromResolvedKeySet(params: {
  /** Resolved endpoint keys built from cross-dependency Arrow rows. */
  resolvedCrossEndpointKeys: ReadonlySet<string>;
  /** Span block id that owns the unresolved endpoint candidate. */
  spanId: TraceSpanId;
  /** Endpoint candidate read from the span sidecar. */
  endpoint: TraceCrossProcessEndpoint;
}): boolean {
  const {resolvedCrossEndpointKeys, spanId, endpoint} = params;
  return !resolvedCrossEndpointKeys.has(
    getResolvedCrossEndpointKey({
      spanId,
      endpointId: endpoint.endpointId,
      rankNum: endpoint.endRankNum
    })
  );
}

/** Returns the compact scalar key for one resolved cross-endpoint side. */
function getResolvedCrossEndpointKey(params: {
  /** Block id on the resolved dependency side. */
  spanId: TraceSpanId;
  /** Endpoint id shared by the dependency pair. */
  endpointId: TraceCrossProcessEndpointId;
  /** Opposite rank number accepted by the unresolved endpoint matcher. */
  rankNum: number;
}): string {
  return `${params.spanId}\u0000${params.endpointId}\u0000${params.rankNum}`;
}

/**
 * Builds the visible dependency and cross-endpoint projection for the active filtered graph.
 */
export function buildTraceGraphProjection(traceGraph: TraceGraph): TraceGraphProjection {
  const inDependenciesBySpanRef = new Map<SpanRef, TraceDependency[]>();
  const outDependenciesBySpanRef = new Map<SpanRef, TraceDependency[]>();
  const endpointsWithDependenciesBySpanRef = new Map<
    SpanRef,
    [TraceCrossProcessEndpoint, TraceCrossProcessDependency | null][]
  >();
  const visibleCrossDependencies = traceGraph
    .getVisibleCrossDependencySources()
    .flatMap(dependencySource => {
      const dependency = materializeVisibleDependencySource(traceGraph, dependencySource);
      return dependency?.type === 'trace-cross-process-dependency' ? [dependency] : [];
    });

  const addCrossEndpointWithDependency = (params: {
    dependency: TraceCrossProcessDependency;
    /** Endpoint span ref when the endpoint resolves in the current graph. */
    spanRef: SpanRef | null;
    spanId: TraceSpanId;
    startRankNum: number;
    endRankNum: number;
  }) => {
    const {dependency, spanRef, spanId, startRankNum, endRankNum} = params;
    if (spanRef == null) {
      return;
    }
    const endpointsWithDependencies = endpointsWithDependenciesBySpanRef.get(spanRef) ?? [];
    const existingIndex = endpointsWithDependencies.findIndex(([endpoint]) =>
      endpointMatchesCrossDependency({endpoint, dependency})
    );
    if (existingIndex >= 0) {
      const [endpoint] = endpointsWithDependencies[existingIndex]!;
      endpointsWithDependencies[existingIndex] = [endpoint, dependency];
      endpointsWithDependenciesBySpanRef.set(spanRef, endpointsWithDependencies);
      return;
    }

    endpointsWithDependencies.push([
      {
        type: 'cross-process-dependency-endpoint',
        endpointId: dependency.endpointId,
        spanId,
        startRankNum,
        endRankNum,
        islandNum: 0,
        waitTimeMs: dependency.waitTimeMs,
        waiting: dependency.waiting,
        waitNotFinished: dependency.waitNotFinished,
        userData: dependency.userData
      },
      dependency
    ]);
    endpointsWithDependenciesBySpanRef.set(spanRef, endpointsWithDependencies);
  };

  for (const processRef of traceGraph.getVisibleProcessRefs()) {
    for (const dependencySource of traceGraph.getVisibleLocalDependencySources(processRef)) {
      const dependency = materializeVisibleDependencySource(traceGraph, dependencySource);
      if (!dependency || dependency.type !== 'trace-local-dependency') {
        continue;
      }
      if (
        dependency.startSpanId === dependency.endSpanId ||
        dependency.startSpanId === undefined ||
        dependency.endSpanId === undefined
      ) {
        continue;
      }
      addDependencyToProjectionMaps({
        inDependenciesBySpanRef,
        outDependenciesBySpanRef,
        dependency
      });
    }

    for (const block of traceGraph.getVisibleProcessDisplaySources(processRef)) {
      endpointsWithDependenciesBySpanRef.set(
        block.spanRef,
        block.crossProcessDependencyEndpoints.map(endpoint => [endpoint, null])
      );
    }
  }

  for (const dependency of visibleCrossDependencies) {
    if (
      dependency.startSpanId === dependency.endSpanId ||
      dependency.startSpanId === undefined ||
      dependency.endSpanId === undefined
    ) {
      continue;
    }
    addDependencyToProjectionMaps({
      inDependenciesBySpanRef,
      outDependenciesBySpanRef,
      dependency
    });
    addCrossEndpointWithDependency({
      dependency,
      spanRef: dependency.startSpanRef ?? null,
      spanId: dependency.startSpanId,
      startRankNum: dependency.startRankNum,
      endRankNum: dependency.endRankNum
    });
    addCrossEndpointWithDependency({
      dependency,
      spanRef: dependency.endSpanRef ?? null,
      spanId: dependency.endSpanId,
      startRankNum: dependency.endRankNum,
      endRankNum: dependency.startRankNum
    });
  }

  return {
    inDependenciesBySpanRef,
    outDependenciesBySpanRef,
    endpointsWithDependenciesBySpanRef
  } satisfies TraceGraphProjection;
}

/**
 * Builds the raw source dependency and cross-endpoint projection before filtered rewiring.
 */
export function buildSourceTraceGraphProjection(traceGraph: TraceGraph): TraceGraphProjection {
  const inDependenciesBySpanRef = new Map<SpanRef, TraceDependency[]>();
  const outDependenciesBySpanRef = new Map<SpanRef, TraceDependency[]>();
  const endpointsWithDependenciesBySpanRef = new Map<
    SpanRef,
    [TraceCrossProcessEndpoint, TraceCrossProcessDependency | null][]
  >();

  const addCrossEndpointWithDependency = (params: {
    dependency: TraceCrossProcessDependency;
    /** Endpoint span ref when the endpoint resolves in the current graph. */
    spanRef: SpanRef | null;
    spanId: TraceSpanId;
    startRankNum: number;
    endRankNum: number;
  }) => {
    const {dependency, spanRef, spanId, startRankNum, endRankNum} = params;
    if (spanRef == null) {
      return;
    }
    const endpointsWithDependencies = endpointsWithDependenciesBySpanRef.get(spanRef) ?? [];
    const existingIndex = endpointsWithDependencies.findIndex(([endpoint]) =>
      endpointMatchesCrossDependency({endpoint, dependency})
    );
    if (existingIndex >= 0) {
      const [endpoint] = endpointsWithDependencies[existingIndex]!;
      endpointsWithDependencies[existingIndex] = [endpoint, dependency];
      endpointsWithDependenciesBySpanRef.set(spanRef, endpointsWithDependencies);
      return;
    }

    endpointsWithDependencies.push([
      {
        type: 'cross-process-dependency-endpoint',
        endpointId: dependency.endpointId,
        spanId,
        startRankNum,
        endRankNum,
        islandNum: 0,
        waitTimeMs: dependency.waitTimeMs,
        waiting: dependency.waiting,
        waitNotFinished: dependency.waitNotFinished,
        userData: dependency.userData
      },
      dependency
    ]);
    endpointsWithDependenciesBySpanRef.set(spanRef, endpointsWithDependencies);
  };

  for (const [processIndex, process] of traceGraph.processes.entries()) {
    const processId = process.processId as TraceProcessId;
    const processRef = traceGraph.getProcessRefs()[processIndex] ?? null;
    const localDependencies =
      processRef == null
        ? []
        : traceGraph.getLocalDependencyRefs(processRef).flatMap(dependencyRef => {
            const dependencySource = traceGraph.getVisibleDependencySourceByRef(dependencyRef);
            return dependencySource?.type === 'trace-local-dependency'
              ? [materializeDependencySourceForProjection(dependencySource)]
              : [];
          });
    for (const dependency of localDependencies) {
      if (
        dependency.startSpanId === dependency.endSpanId ||
        dependency.startSpanId === undefined ||
        dependency.endSpanId === undefined
      ) {
        continue;
      }
      addDependencyToProjectionMaps({
        inDependenciesBySpanRef,
        outDependenciesBySpanRef,
        dependency
      });
    }

    for (const spanRef of iterateTraceGraphProcessSpanRefs(traceGraph, processId)) {
      const block = traceGraph.getDisplaySourceBySpanRef(spanRef);
      if (!block) {
        continue;
      }

      endpointsWithDependenciesBySpanRef.set(
        spanRef,
        block.crossProcessDependencyEndpoints.map(endpoint => [endpoint, null])
      );
    }
  }

  for (const dependencyRef of traceGraph.iterateCrossDependencyRefs()) {
    const dependencyId = traceGraph.getDependencyId(dependencyRef);
    const endpointId = traceGraph.getCrossDependencyEndpointId(dependencyRef);
    const startRankNum = traceGraph.getCrossDependencyStartRankNum(dependencyRef);
    const endRankNum = traceGraph.getCrossDependencyEndRankNum(dependencyRef);
    const startSpanId = traceGraph.getDependencyStartBlockId(dependencyRef);
    const endSpanId = traceGraph.getDependencyEndBlockId(dependencyRef);
    const waitMode = traceGraph.getDependencyWaitMode(dependencyRef);
    const topology = traceGraph.getCrossDependencyTopology(dependencyRef);
    if (
      !dependencyId ||
      !endpointId ||
      startRankNum == null ||
      endRankNum == null ||
      !startSpanId ||
      !endSpanId ||
      startSpanId === endSpanId ||
      !waitMode ||
      !topology
    ) {
      continue;
    }
    const dependency = {
      type: 'trace-cross-process-dependency',
      dependencyRef,
      dependencyId,
      endpointId,
      startRankNum,
      endRankNum,
      startSpanId,
      endSpanId,
      startSpanRef: traceGraph.getDependencyStartSpan(dependencyRef) ?? undefined,
      endSpanRef: traceGraph.getDependencyEndSpan(dependencyRef) ?? undefined,
      waitMode,
      bidirectional: traceGraph.getDependencyBidirectional(dependencyRef) ?? false,
      topology,
      waitTimeMs: traceGraph.getDependencyWaitTimeMs(dependencyRef) ?? 0,
      waiting: traceGraph.getCrossDependencyWaiting(dependencyRef) ?? false,
      waitNotFinished: traceGraph.getCrossDependencyWaitNotFinished(dependencyRef) ?? false,
      keywords: new Set(traceGraph.getDependencyKeywords(dependencyRef) ?? [])
    } satisfies TraceCrossProcessDependency;
    addDependencyToProjectionMaps({
      inDependenciesBySpanRef,
      outDependenciesBySpanRef,
      dependency
    });
    addCrossEndpointWithDependency({
      dependency,
      spanRef: dependency.startSpanRef ?? null,
      spanId: dependency.startSpanId,
      startRankNum: dependency.startRankNum,
      endRankNum: dependency.endRankNum
    });
    addCrossEndpointWithDependency({
      dependency,
      spanRef: dependency.endSpanRef ?? null,
      spanId: dependency.endSpanId,
      startRankNum: dependency.endRankNum,
      endRankNum: dependency.startRankNum
    });
  }

  return {
    inDependenciesBySpanRef,
    outDependenciesBySpanRef,
    endpointsWithDependenciesBySpanRef
  } satisfies TraceGraphProjection;
}

/**
 * Builds compact visible indexes for the unfiltered case without cloning process or graph objects.
 */
function buildUnfilteredVisibleIndex(traceGraph: TraceGraph): TraceGraphVisibleIndex {
  const visibleIndexBuildStartTime = performance.now();
  const sourceTraceGraph = traceGraph;
  const visibleProcessIds = sourceTraceGraph.processes.map(
    process => process.processId as TraceProcessId
  ) as readonly TraceProcessId[];
  const visibleSpanRefsByProcessId = {} as Record<TraceProcessId, readonly SpanRef[]>;
  const visibleBlockTablesByProcessId = {} as Record<TraceProcessId, TraceGraphVisibleSpanTable>;
  const visibleLocalDependencyIdsByProcessId = {} as Record<
    TraceProcessId,
    readonly TraceDependencyId[]
  >;
  const visibleLocalDependencyRefsByProcessId = {} as Record<
    TraceProcessId,
    readonly VisibleLocalDependencyRef[]
  >;
  const visibleLocalDependencyIds: TraceDependencyId[] = [];
  const visibleLocalDependencySourceRefs: (LocalDependencyRef | null)[] = [];
  const visibleDependencyRefsBySpanRefStartTime = performance.now();
  const visibleDependencyRefsBySpanRef = new Map<
    SpanRef,
    (VisibleLocalDependencyRef | VisibleCrossDependencyRef)[]
  >();
  const visibleLocalDependencyRefBySourceRef = new Map<
    LocalDependencyRef,
    VisibleLocalDependencyRef
  >();
  const visibleCrossDependencyRefBySourceRef = new Map<
    CrossDependencyRef,
    VisibleCrossDependencyRef
  >();
  const visibleCrossDependencySourceRefs: (CrossDependencyRef | null)[] = [];
  const visibleLocalDependencyProcessIdByRef = new Map<VisibleLocalDependencyRef, TraceProcessId>();
  const visibleCrossDependencyIds: TraceDependencyId[] = [];
  const visibleSpanRefs = new Set<SpanRef>();
  const visibleDependencyIds = new Set<TraceDependencyId>();
  const addVisibleDependencyRefForSpan = (
    spanRef: SpanRef | null,
    dependencyRef: VisibleLocalDependencyRef | VisibleCrossDependencyRef
  ) => {
    if (spanRef == null) {
      return;
    }
    let dependencyRefs = visibleDependencyRefsBySpanRef.get(spanRef);
    if (!dependencyRefs) {
      dependencyRefs = [];
      visibleDependencyRefsBySpanRef.set(spanRef, dependencyRefs);
    }
    if (!dependencyRefs.includes(dependencyRef)) {
      dependencyRefs.push(dependencyRef);
    }
  };
  const addVisibleLocalDependencyRef = (
    processId: TraceProcessId,
    dependencyId: TraceDependencyId,
    sourceDependencyRef?: LocalDependencyRef | null
  ): VisibleLocalDependencyRef => {
    const existingDependencyRef =
      sourceDependencyRef == null
        ? null
        : (visibleLocalDependencyRefBySourceRef.get(sourceDependencyRef) ?? null);
    if (existingDependencyRef != null) {
      return existingDependencyRef;
    }

    const dependencyRef = encodeVisibleLocalDependencyRef(visibleLocalDependencyIds.length);
    visibleLocalDependencyIds.push(dependencyId);
    visibleLocalDependencySourceRefs.push(sourceDependencyRef ?? null);
    if (sourceDependencyRef != null) {
      visibleLocalDependencyRefBySourceRef.set(sourceDependencyRef, dependencyRef);
    }
    visibleLocalDependencyProcessIdByRef.set(dependencyRef, processId);
    return dependencyRef;
  };
  const processPassStartTime = performance.now();
  for (const [processIndex, process] of sourceTraceGraph.processes.entries()) {
    const processId = process.processId as TraceProcessId;
    const spanRefs = [...iterateTraceGraphProcessSpanRefs(sourceTraceGraph, processId)];
    const spanTable = sourceTraceGraph.processSpanTableMap[processId];

    if (spanTable) {
      visibleBlockTablesByProcessId[processId] = new IndexedArrowTable(spanTable);
    }
    visibleSpanRefsByProcessId[processId] = spanRefs;
    spanRefs.forEach(spanRef => visibleSpanRefs.add(spanRef));

    const localDependencyIds: TraceDependencyId[] = [];
    const localDependencyRefs: VisibleLocalDependencyRef[] = [];
    visibleLocalDependencyIdsByProcessId[processId] = localDependencyIds;
    visibleLocalDependencyRefsByProcessId[processId] = localDependencyRefs;
    for (const dependency of getArrowLocalDependencyRows({
      traceGraph: sourceTraceGraph,
      processId,
      processIndex
    })) {
      const dependencyId = dependency.dependencyId;
      if (!dependencyId || !dependency.startSpanId || !dependency.endSpanId) {
        continue;
      }

      const sourceDependencyRef = dependency.dependencyRef;
      localDependencyIds.push(dependencyId);
      visibleDependencyIds.add(dependencyId);
      const visibleDependencyRef = addVisibleLocalDependencyRef(
        processId,
        dependencyId,
        sourceDependencyRef
      );
      localDependencyRefs.push(visibleDependencyRef);
      addVisibleDependencyRefForSpan(
        sourceTraceGraph.getDependencyStartSpan(sourceDependencyRef),
        visibleDependencyRef
      );
      addVisibleDependencyRefForSpan(
        sourceTraceGraph.getDependencyEndSpan(sourceDependencyRef),
        visibleDependencyRef
      );
    }
  }
  const visibleDependencyRefsBySpanRefDurationMs =
    performance.now() - visibleDependencyRefsBySpanRefStartTime;

  const processPassDurationMs = performance.now() - processPassStartTime;
  const crossDependencyPassStartTime = performance.now();
  for (const dependencyRef of sourceTraceGraph.iterateCrossDependencyRefs()) {
    const dependencyId = sourceTraceGraph.getDependencyId(dependencyRef);
    if (!dependencyId) {
      continue;
    }
    const dependencyIndex = getCrossDependencyRefIndex(dependencyRef);
    visibleDependencyIds.add(dependencyId);
    visibleCrossDependencyIds[dependencyIndex] = dependencyId;
    visibleCrossDependencySourceRefs[dependencyIndex] = dependencyRef;
    visibleCrossDependencyRefBySourceRef.set(
      dependencyRef,
      encodeVisibleCrossDependencyRef(dependencyIndex)
    );
    addVisibleDependencyRefForSpan(
      sourceTraceGraph.getDependencyStartSpan(dependencyRef),
      encodeVisibleCrossDependencyRef(dependencyIndex)
    );
    addVisibleDependencyRefForSpan(
      sourceTraceGraph.getDependencyEndSpan(dependencyRef),
      encodeVisibleCrossDependencyRef(dependencyIndex)
    );
  }
  const crossDependencyPassDurationMs = performance.now() - crossDependencyPassStartTime;

  log.probe(0, `buildUnfilteredVisibleIndex graph=${sourceTraceGraph.name} done`, {
    processCount: visibleProcessIds.length,
    visibleSpanCount: visibleSpanRefs.size,
    visibleDependencyCount: visibleDependencyIds.size,
    visibleLocalDependencyCount: visibleLocalDependencyIds.length,
    visibleCrossDependencyCount: visibleCrossDependencyIds.length,
    visibleDependencyRefsBySpanRefDurationMs,
    processPassDurationMs,
    crossDependencyPassDurationMs,
    durationMs: performance.now() - visibleIndexBuildStartTime,
    ...getHeapUsageProbeFields()
  })();

  return {
    visibleProcessIds,
    visibleSpanRefsByProcessId,
    visibleBlockTablesByProcessId,
    visibleLocalDependencyIdsByProcessId,
    visibleLocalDependencyRefsByProcessId,
    visibleLocalDependencyIds,
    visibleLocalDependencySourceRefs,
    visibleCrossDependencyIds,
    visibleCrossDependencySourceRefs,
    visibleLocalDependencyRefBySourceRef,
    visibleCrossDependencyRefBySourceRef,
    visibleLocalDependencyProcessIdByRef,
    visibleDependencyRefsBySpanRef,
    visibleSpanRefSet: visibleSpanRefs,
    visibleDependencyIdSet: visibleDependencyIds,
    dependencyOverrideSpecsByRef: new Map(),
    visibleLocalDependencyRefsBySpanRef: new Map(),
    endpointsBySpanRef: new Map(),
    primaryEndpointIdBySpanRef: new Map(),
    visibleLaneLayoutInfo: {
      explicitLaneValueCount: 0,
      threadsWithLaneDataCount: 0
    }
  };
}

/**
 * Iterates canonical Arrow local dependency rows for one process without reading
 * compatibility `process.localDependencies` objects.
 */
function* getArrowLocalDependencyRows(params: {
  /** Trace graph that owns the process-local dependency table. */
  traceGraph: Readonly<TraceGraph>;
  /** Process id whose dependency table should be scanned. */
  processId: TraceProcessId;
  /** Process index used to encode stable source dependency refs. */
  processIndex: number;
}): Generator<{
  /** Stable dependency id stored in the Arrow row. */
  dependencyId: TraceDependencyId | null;
  /** Stable source block id stored in the Arrow row. */
  startSpanId: TraceSpanId | null;
  /** Stable destination block id stored in the Arrow row. */
  endSpanId: TraceSpanId | null;
  /** Canonical source dependency ref for this process-local row. */
  dependencyRef: LocalDependencyRef;
}> {
  const dependencyTable = params.traceGraph.localDependencyTableMap[params.processId];
  const dependencyIdColumn = dependencyTable?.getChild('dependencyId');
  const startSpanIdColumn = dependencyTable?.getChild('startSpanId');
  const endSpanIdColumn = dependencyTable?.getChild('endSpanId');
  if (!dependencyTable || !dependencyIdColumn || !startSpanIdColumn || !endSpanIdColumn) {
    return;
  }

  for (let rowIndex = 0; rowIndex < dependencyTable.numRows; rowIndex += 1) {
    yield {
      dependencyId:
        (dependencyIdColumn.get(rowIndex) as TraceDependencyId | null | undefined) ?? null,
      startSpanId: (startSpanIdColumn.get(rowIndex) as TraceSpanId | null | undefined) ?? null,
      endSpanId: (endSpanIdColumn.get(rowIndex) as TraceSpanId | null | undefined) ?? null,
      dependencyRef: encodeLocalDependencyRef(encodeLocalSpanRef(params.processIndex, rowIndex))
    };
  }
}

/**
 * Builds compact visible indexes for the filtered graph without cloning a visible graph object.
 */
export function buildVisibleIndex(traceGraph: TraceGraph): TraceGraphVisibleIndex {
  const sourceTraceGraph = traceGraph;
  const visibleIndexBuildStartTime = performance.now();
  const label = `buildVisibleIndex graph=${sourceTraceGraph.name}`;
  const filteredSpanRefs = buildVisibleIndexFilteredSpanRefs(traceGraph);

  if (filteredSpanRefs.size === 0) {
    return buildUnfilteredVisibleIndex(traceGraph);
  }

  const localParentDependencyMap = buildLocalParentDependencyMap(sourceTraceGraph);
  const globalParentDependencyMap = buildGlobalParentDependencyMap(sourceTraceGraph);
  const filteredBlockIds = new Set(
    Array.from(filteredSpanRefs).flatMap(spanRef => {
      const spanId = sourceTraceGraph.getSpanBlockId(spanRef);
      return spanId ? [spanId] : [];
    })
  );
  const resolvedLocalAncestorByFilteredBlockId = buildResolvedFilteredAncestorMap({
    filteredBlockIds: filteredBlockIds,
    parentDependencyMap: localParentDependencyMap
  });
  const resolvedVisibleAncestorByFilteredBlockId = buildResolvedFilteredAncestorMap({
    filteredBlockIds: filteredBlockIds,
    parentDependencyMap: globalParentDependencyMap
  });
  const resolveLocalVisibleBlockId = (spanId: TraceSpanId): TraceSpanId | null => {
    return filteredBlockIds.has(spanId)
      ? (resolvedLocalAncestorByFilteredBlockId.get(spanId) ?? null)
      : spanId;
  };
  /** Resolves one block id to its nearest visible ancestor using the global parent graph. */
  const resolveVisibleBlockIdFast = (spanId: TraceSpanId): TraceSpanId | null => {
    return filteredBlockIds.has(spanId)
      ? (resolvedVisibleAncestorByFilteredBlockId.get(spanId) ?? null)
      : spanId;
  };
  /** Resolves one original dependency endpoint ref while rejecting stale compatibility refs. */
  const resolveDependencySourceSpanRef = (
    spanRef: SpanRef | undefined,
    spanId: TraceSpanId
  ): SpanRef | undefined => {
    if (spanRef != null && sourceTraceGraph.getSpanBlockId(spanRef) === spanId) {
      return spanRef;
    }
    return resolveSourceSpanRef(sourceTraceGraph, spanId) ?? undefined;
  };
  const stitchedLocalParentsByKey = new Map<string, TraceLocalDependency>();
  const stitchedCrossParentsByKey = new Map<string, TraceCrossProcessDependency>();
  const visibleProcessIds = sourceTraceGraph.processes.map(
    process => process.processId as TraceProcessId
  ) as readonly TraceProcessId[];
  const visibleSpanRefsByProcessId = {} as Record<TraceProcessId, readonly SpanRef[]>;
  const visibleBlockTablesByProcessId = {} as Record<TraceProcessId, TraceGraphVisibleSpanTable>;
  const visibleLocalDependencyIdsByProcessId = {} as Record<TraceProcessId, TraceDependencyId[]>;
  const visibleLocalDependencyRefsByProcessId = {} as Record<
    TraceProcessId,
    VisibleLocalDependencyRef[]
  >;
  const visibleLocalDependencyIds: TraceDependencyId[] = [];
  const visibleLocalDependencySourceRefs: (LocalDependencyRef | null)[] = [];
  const visibleDependencyRefsBySpanRef = new Map<
    SpanRef,
    (VisibleLocalDependencyRef | VisibleCrossDependencyRef)[]
  >();
  const visibleLocalDependencyRefsBySpanRef = new Map<SpanRef, VisibleLocalDependencyRef[]>();
  const endpointsBySpanRef = new Map<SpanRef, TraceCrossProcessEndpoint[]>();
  const primaryEndpointIdBySpanRef = new Map<SpanRef, TraceCrossProcessEndpointId | null>();
  const visibleLocalDependencyRefBySourceRef = new Map<
    LocalDependencyRef,
    VisibleLocalDependencyRef
  >();
  const visibleCrossDependencyRefBySourceRef = new Map<
    CrossDependencyRef,
    VisibleCrossDependencyRef
  >();
  const visibleLocalDependencyProcessIdByRef = new Map<VisibleLocalDependencyRef, TraceProcessId>();
  const dependencyOverrideSpecsByRef = new Map<
    VisibleLocalDependencyRef | VisibleCrossDependencyRef,
    TraceGraphVisibleDependencyOverride
  >();
  const visibleCrossDependencyIds: TraceDependencyId[] = [];
  const visibleCrossDependencySourceRefs: (CrossDependencyRef | null)[] = [];
  const visibleLaneCountsByThreadRef = new Map<ThreadRef, number>();
  let visibleExplicitLaneValueCount = 0;
  const visibleSpanRefs = new Set<SpanRef>();
  const visibleDependencyIds = new Set<TraceDependencyId>();
  const sourceProcessById = new Map(
    sourceTraceGraph.processes.map(process => [process.processId, process] as const)
  );
  /** Resolves source process metadata for one visible block id via canonical span locations. */
  const getSourceProcessForBlockId = (spanId: TraceSpanId): ArrowTraceProcessMetadata | null => {
    const spanIndex = resolveSourceSpanRef(sourceTraceGraph, spanId);
    const processId =
      spanIndex == null ? null : getTraceGraphSpanRefProcessId(sourceTraceGraph, spanIndex);
    return processId ? (sourceProcessById.get(processId) ?? null) : null;
  };

  const addVisibleDependencyRefForSpan = (
    spanRef: SpanRef | null,
    dependencyRef: VisibleLocalDependencyRef | VisibleCrossDependencyRef
  ) => {
    if (spanRef == null) {
      return;
    }
    const dependencyRefs = visibleDependencyRefsBySpanRef.get(spanRef) ?? [];
    if (!dependencyRefs.includes(dependencyRef)) {
      visibleDependencyRefsBySpanRef.set(spanRef, [...dependencyRefs, dependencyRef]);
    }
  };

  const addVisibleLocalDependencyRefForSpan = (
    spanRef: SpanRef | null,
    dependencyRef: VisibleLocalDependencyRef
  ) => {
    if (spanRef == null) {
      return;
    }
    const dependencyRefs = visibleLocalDependencyRefsBySpanRef.get(spanRef) ?? [];
    if (!dependencyRefs.includes(dependencyRef)) {
      visibleLocalDependencyRefsBySpanRef.set(spanRef, [...dependencyRefs, dependencyRef]);
    }
  };

  const addVisibleLocalDependencyRef = (
    processId: TraceProcessId,
    dependencyId: TraceDependencyId,
    sourceDependencyRef?: LocalDependencyRef | null
  ): VisibleLocalDependencyRef => {
    const existingDependencyRef =
      sourceDependencyRef == null
        ? null
        : (visibleLocalDependencyRefBySourceRef.get(sourceDependencyRef) ?? null);
    if (existingDependencyRef != null) {
      return existingDependencyRef;
    }

    const dependencyRef = encodeVisibleLocalDependencyRef(visibleLocalDependencyIds.length);
    visibleLocalDependencyIds.push(dependencyId);
    visibleLocalDependencySourceRefs.push(sourceDependencyRef ?? null);
    if (sourceDependencyRef != null) {
      visibleLocalDependencyRefBySourceRef.set(sourceDependencyRef, dependencyRef);
    }
    visibleLocalDependencyProcessIdByRef.set(dependencyRef, processId);
    return dependencyRef;
  };

  const setDependencyOverrideSpec = (
    dependencyRef: VisibleLocalDependencyRef | VisibleCrossDependencyRef,
    override: TraceGraphVisibleDependencyOverride
  ) => {
    dependencyOverrideSpecsByRef.set(dependencyRef, override);
  };

  const addVisibleCrossDependencyRef = (
    dependencyId: TraceDependencyId,
    sourceDependencyRef?: CrossDependencyRef | null
  ): VisibleCrossDependencyRef => {
    const existingDependencyRef =
      sourceDependencyRef == null
        ? null
        : (visibleCrossDependencyRefBySourceRef.get(sourceDependencyRef) ?? null);
    if (existingDependencyRef != null) {
      return existingDependencyRef;
    }

    const dependencyRef = encodeVisibleCrossDependencyRef(visibleCrossDependencyIds.length);
    visibleCrossDependencyIds.push(dependencyId);
    visibleCrossDependencySourceRefs.push(sourceDependencyRef ?? null);
    if (sourceDependencyRef != null) {
      visibleCrossDependencyRefBySourceRef.set(sourceDependencyRef, dependencyRef);
    }
    return dependencyRef;
  };

  const addCrossEndpointForSpan = (params: {
    dependencyId: TraceDependencyId;
    endpointId: TraceCrossProcessEndpointId;
    spanRef: SpanRef | null;
    startRankNum: number;
    endRankNum: number;
    waitTimeMs: number;
    waiting: boolean;
    waitNotFinished: boolean;
    userData?: Record<string, unknown>;
  }) => {
    const {
      endpointId,
      spanRef,
      startRankNum,
      endRankNum,
      waitTimeMs,
      waiting,
      waitNotFinished,
      userData
    } = params;
    if (spanRef == null) {
      return;
    }
    const spanId = sourceTraceGraph.getSpanBlockId(spanRef);
    if (!spanId) {
      return;
    }
    const endpoints = endpointsBySpanRef.get(spanRef) ?? [];
    const existingIndex = endpoints.findIndex(endpoint =>
      endpointMatchesCrossDependencyValues({
        endpoint,
        endpointId,
        startRankNum,
        endRankNum
      })
    );
    if (existingIndex === -1) {
      endpointsBySpanRef.set(spanRef, [
        ...endpoints,
        {
          type: 'cross-process-dependency-endpoint',
          endpointId,
          spanId,
          startRankNum,
          endRankNum,
          islandNum: 0,
          waitTimeMs,
          waiting,
          waitNotFinished,
          userData
        }
      ]);
    }
    if (!primaryEndpointIdBySpanRef.has(spanRef) || !primaryEndpointIdBySpanRef.get(spanRef)) {
      primaryEndpointIdBySpanRef.set(spanRef, endpointId);
    }
  };

  const resolvedCrossEndpointKeys = new Set<string>();
  for (const dependencyRef of sourceTraceGraph.iterateCrossDependencyRefs()) {
    const endpointId = sourceTraceGraph.getCrossDependencyEndpointId(dependencyRef);
    const startSpanId = sourceTraceGraph.getDependencyStartBlockId(dependencyRef);
    const endSpanId = sourceTraceGraph.getDependencyEndBlockId(dependencyRef);
    const startRankNum = sourceTraceGraph.getCrossDependencyStartRankNum(dependencyRef);
    const endRankNum = sourceTraceGraph.getCrossDependencyEndRankNum(dependencyRef);
    if (!endpointId || !startSpanId || !endSpanId || startRankNum == null || endRankNum == null) {
      continue;
    }
    for (const [spanId, rankNum] of [
      [startSpanId, startRankNum],
      [startSpanId, endRankNum],
      [endSpanId, startRankNum],
      [endSpanId, endRankNum]
    ] as const) {
      resolvedCrossEndpointKeys.add(
        getResolvedCrossEndpointKey({
          spanId,
          endpointId,
          rankNum
        })
      );
    }
  }

  const visibleProcessPassStartTime = performance.now();
  for (const [processIndex, rank] of sourceTraceGraph.processes.entries()) {
    const processId = rank.processId as TraceProcessId;
    const visibleSpanRefsForProcess: SpanRef[] = [];
    for (const spanIndex of iterateTraceGraphProcessSpanRefs(sourceTraceGraph, processId)) {
      const spanId = getArrowTraceSpanField(
        sourceTraceGraph,
        spanIndex,
        'spanId'
      ) as TraceSpanId | null;
      if (!spanId || filteredSpanRefs.has(spanIndex)) {
        continue;
      }
      visibleSpanRefsForProcess.push(spanIndex);
      visibleSpanRefs.add(spanIndex);

      const laneValue = getArrowTraceSpanLaneValue(sourceTraceGraph, spanIndex);
      if (typeof laneValue === 'number' && Number.isFinite(laneValue) && laneValue >= 0) {
        visibleExplicitLaneValueCount += 1;
        const threadRef = sourceTraceGraph.getThreadRefBySpanRef(spanIndex);
        if (threadRef != null) {
          const currentLaneCount = visibleLaneCountsByThreadRef.get(threadRef) ?? 1;
          visibleLaneCountsByThreadRef.set(
            threadRef,
            Math.max(currentLaneCount, Math.floor(laneValue) + 1)
          );
        }
      }

      const unresolvedCrossEndpoints = getArrowTraceSpanCrossProcessEndpoints(
        sourceTraceGraph,
        spanIndex
      ).filter(endpoint =>
        isUnresolvedCrossEndpointFromResolvedKeySet({
          resolvedCrossEndpointKeys,
          spanId,
          endpoint
        })
      );
      if (unresolvedCrossEndpoints.length > 0) {
        endpointsBySpanRef.set(spanIndex, [...unresolvedCrossEndpoints]);
        primaryEndpointIdBySpanRef.set(spanIndex, unresolvedCrossEndpoints[0]?.endpointId ?? null);
      } else {
        primaryEndpointIdBySpanRef.set(spanIndex, null);
      }
    }

    visibleSpanRefsByProcessId[processId] = visibleSpanRefsForProcess;
    const spanTable = sourceTraceGraph.processSpanTableMap[processId];
    if (spanTable) {
      visibleBlockTablesByProcessId[processId] = IndexedArrowTable.fromOwnedIndexes(
        spanTable,
        getVisibleBlockRowIndexesForProcess({
          traceGraph: sourceTraceGraph,
          processId,
          spanRefs: visibleSpanRefsForProcess
        })
      );
    }
    visibleLocalDependencyIdsByProcessId[processId] = [];
    visibleLocalDependencyRefsByProcessId[processId] = [];

    const visibleDependencyIdsForProcess: TraceDependencyId[] = [];
    const dependencyTable = sourceTraceGraph.localDependencyTableMap[processId];
    const dependencyIdColumn = dependencyTable?.getChild('dependencyId');
    const startSpanIdColumn = dependencyTable?.getChild('startSpanId');
    const endSpanIdColumn = dependencyTable?.getChild('endSpanId');
    const hasParentKeywordColumn = dependencyTable?.getChild('hasParentKeyword');
    for (let rowIndex = 0; rowIndex < (dependencyTable?.numRows ?? 0); rowIndex += 1) {
      if (hasParentKeywordColumn?.get(rowIndex) === true) {
        continue;
      }

      const dependencyId = dependencyIdColumn?.get(rowIndex) as TraceDependencyId | null;
      const rawStartBlockId = startSpanIdColumn?.get(rowIndex) as TraceSpanId | null;
      const rawEndBlockId = endSpanIdColumn?.get(rowIndex) as TraceSpanId | null;
      if (!dependencyId || !rawStartBlockId || !rawEndBlockId) {
        continue;
      }

      const startSpanId = resolveLocalVisibleBlockId(rawStartBlockId);
      const endSpanId = resolveLocalVisibleBlockId(rawEndBlockId);
      if (!startSpanId || !endSpanId || startSpanId === endSpanId) {
        continue;
      }

      const sourceDependencyRef = encodeLocalDependencyRef(
        encodeLocalSpanRef(processIndex, rowIndex)
      );
      const startSpanRef =
        startSpanId !== rawStartBlockId
          ? resolveSourceSpanRef(sourceTraceGraph, startSpanId)
          : sourceTraceGraph.getDependencyStartSpan(sourceDependencyRef);
      const endSpanRef =
        endSpanId !== rawEndBlockId
          ? resolveSourceSpanRef(sourceTraceGraph, endSpanId)
          : sourceTraceGraph.getDependencyEndSpan(sourceDependencyRef);
      if (!startSpanRef || !endSpanRef) {
        continue;
      }

      visibleDependencyIdsForProcess.push(dependencyId);
      visibleDependencyIds.add(dependencyId);
      const visibleDependencyRef = addVisibleLocalDependencyRef(
        processId,
        dependencyId,
        sourceDependencyRef
      );
      visibleLocalDependencyRefsByProcessId[processId]!.push(visibleDependencyRef);
      if (startSpanId !== rawStartBlockId || endSpanId !== rawEndBlockId) {
        setDependencyOverrideSpec(visibleDependencyRef, {
          kind: 'local-rewrite',
          startSpanRef,
          endSpanRef
        });
      }
      addVisibleDependencyRefForSpan(startSpanRef, visibleDependencyRef);
      addVisibleDependencyRefForSpan(endSpanRef, visibleDependencyRef);
      addVisibleLocalDependencyRefForSpan(startSpanRef, visibleDependencyRef);
      addVisibleLocalDependencyRefForSpan(endSpanRef, visibleDependencyRef);
    }
    visibleLocalDependencyIdsByProcessId[processId] = visibleDependencyIdsForProcess;
  }
  const visibleProcessPassDurationMs = performance.now() - visibleProcessPassStartTime;

  const parentStitchingStartTime = performance.now();
  const addStitchedParentDependency = (
    dependency: TraceLocalDependency | TraceCrossProcessDependency
  ) => {
    const sourceStartSpanRef = resolveDependencySourceSpanRef(
      dependency.startSpanRef,
      dependency.startSpanId
    );
    const sourceEndSpanRef = resolveDependencySourceSpanRef(
      dependency.endSpanRef,
      dependency.endSpanId
    );
    const resolvedStartBlockId = resolveVisibleBlockIdFast(dependency.startSpanId);
    const resolvedEndBlockId = resolveVisibleBlockIdFast(dependency.endSpanId);

    if (
      !resolvedStartBlockId ||
      !resolvedEndBlockId ||
      resolvedStartBlockId === resolvedEndBlockId
    ) {
      return;
    }

    const startProcess = getSourceProcessForBlockId(resolvedStartBlockId);
    const endProcess = getSourceProcessForBlockId(resolvedEndBlockId);
    if (!startProcess || !endProcess) {
      return;
    }

    if (startProcess.processId === endProcess.processId) {
      const key = `parent-local:${resolvedStartBlockId}->${resolvedEndBlockId}`;
      if (stitchedLocalParentsByKey.has(key)) {
        return;
      }

      stitchedLocalParentsByKey.set(key, {
        type: 'trace-local-dependency',
        dependencyRef:
          dependency.type === 'trace-local-dependency'
            ? dependency.dependencyRef
            : encodeVisibleLocalDependencyRef(0),
        startSpanRef: sourceStartSpanRef,
        endSpanRef: sourceEndSpanRef,
        dependencyId: dependency.dependencyId,
        startSpanId: resolvedStartBlockId,
        endSpanId: resolvedEndBlockId,
        keywords: dependency.keywords,
        waitMode: dependency.waitMode,
        bidirectional: dependency.bidirectional,
        waitTimeMs: dependency.waitTimeMs,
        userData: dependency.userData
      });
      return;
    }

    const key = `parent-cross:${resolvedStartBlockId}->${resolvedEndBlockId}`;
    if (stitchedCrossParentsByKey.has(key)) {
      return;
    }

    stitchedCrossParentsByKey.set(key, {
      type: 'trace-cross-process-dependency',
      dependencyRef:
        dependency.type === 'trace-cross-process-dependency'
          ? dependency.dependencyRef
          : encodeVisibleCrossDependencyRef(0),
      startSpanRef: sourceStartSpanRef,
      endSpanRef: sourceEndSpanRef,
      dependencyId: dependency.dependencyId,
      endpointId:
        dependency.type === 'trace-cross-process-dependency'
          ? dependency.endpointId
          : (`filtered-parent:${dependency.dependencyId}:${resolvedStartBlockId}->${resolvedEndBlockId}` as TraceCrossProcessEndpointId),
      startRankNum: startProcess.rankNum,
      endRankNum: endProcess.rankNum,
      startSpanId: resolvedStartBlockId,
      endSpanId: resolvedEndBlockId,
      waitMode: dependency.waitMode,
      bidirectional: dependency.bidirectional,
      topology:
        dependency.type === 'trace-cross-process-dependency' ? dependency.topology : 'parent',
      waitTimeMs: dependency.waitTimeMs,
      waiting: dependency.type === 'trace-cross-process-dependency' ? dependency.waiting : false,
      waitNotFinished:
        dependency.type === 'trace-cross-process-dependency' ? dependency.waitNotFinished : false,
      keywords: dependency.keywords,
      userData: dependency.userData
    });
  };

  for (const process of sourceTraceGraph.processes) {
    for (const dependency of process.localDependencies ?? []) {
      if (isParentLocalDependency(dependency)) {
        addStitchedParentDependency(dependency);
      }
    }
  }

  for (const dependencyRef of sourceTraceGraph.iterateCrossDependencyRefs()) {
    const topology = sourceTraceGraph.getCrossDependencyTopology(dependencyRef);
    if (
      !sourceTraceGraph.getDependencyHasKeyword(dependencyRef, 'PARENT') &&
      topology !== 'parent'
    ) {
      continue;
    }

    const dependencyId = sourceTraceGraph.getDependencyId(dependencyRef);
    const endpointId = sourceTraceGraph.getCrossDependencyEndpointId(dependencyRef);
    const startRankNum = sourceTraceGraph.getCrossDependencyStartRankNum(dependencyRef);
    const endRankNum = sourceTraceGraph.getCrossDependencyEndRankNum(dependencyRef);
    const startSpanId = sourceTraceGraph.getDependencyStartBlockId(dependencyRef);
    const endSpanId = sourceTraceGraph.getDependencyEndBlockId(dependencyRef);
    const waitMode = sourceTraceGraph.getDependencyWaitMode(dependencyRef);
    if (
      !dependencyId ||
      !endpointId ||
      startRankNum == null ||
      endRankNum == null ||
      !startSpanId ||
      !endSpanId ||
      !waitMode
    ) {
      continue;
    }

    addStitchedParentDependency({
      type: 'trace-cross-process-dependency',
      startSpanRef: sourceTraceGraph.getDependencyStartSpan(dependencyRef) ?? undefined,
      endSpanRef: sourceTraceGraph.getDependencyEndSpan(dependencyRef) ?? undefined,
      dependencyId,
      endpointId,
      startRankNum,
      endRankNum,
      startSpanId,
      endSpanId,
      waitMode,
      bidirectional: sourceTraceGraph.getDependencyBidirectional(dependencyRef) ?? false,
      topology: topology ?? 'parent',
      waitTimeMs: sourceTraceGraph.getDependencyWaitTimeMs(dependencyRef) ?? 0,
      waiting: sourceTraceGraph.getCrossDependencyWaiting(dependencyRef) ?? false,
      waitNotFinished: sourceTraceGraph.getCrossDependencyWaitNotFinished(dependencyRef) ?? false,
      keywords: new Set(sourceTraceGraph.getDependencyKeywords(dependencyRef) ?? [])
    });
  }

  for (const dependency of stitchedLocalParentsByKey.values()) {
    const startSpanRef = resolveSourceSpanRef(sourceTraceGraph, dependency.startSpanId);
    const endSpanRef = resolveSourceSpanRef(sourceTraceGraph, dependency.endSpanId);
    if (startSpanRef == null || endSpanRef == null) {
      continue;
    }
    const processId = getSourceProcessForBlockId(dependency.startSpanId)?.processId as
      | TraceProcessId
      | undefined;
    if (!processId || !sourceProcessById.has(processId)) {
      continue;
    }
    const override = {
      kind: 'local-parent',
      startSpanRef,
      endSpanRef,
      waitMode: dependency.waitMode,
      bidirectional: dependency.bidirectional,
      waitTimeMs: dependency.waitTimeMs,
      keywords: [...dependency.keywords],
      userData: dependency.userData
    } satisfies TraceGraphVisibleDependencyOverride;
    visibleLocalDependencyIdsByProcessId[processId] ??= [];
    visibleLocalDependencyIdsByProcessId[processId].push(dependency.dependencyId);
    visibleDependencyIds.add(dependency.dependencyId);
    const visibleDependencyRef = addVisibleLocalDependencyRef(
      processId,
      dependency.dependencyId,
      dependency.dependencyRef != null && isLocalDependencyRef(dependency.dependencyRef)
        ? (dependency.dependencyRef as LocalDependencyRef)
        : null
    );
    visibleLocalDependencyRefsByProcessId[processId] ??= [];
    visibleLocalDependencyRefsByProcessId[processId].push(visibleDependencyRef);
    setDependencyOverrideSpec(visibleDependencyRef, override);
    addVisibleDependencyRefForSpan(startSpanRef, visibleDependencyRef);
    addVisibleDependencyRefForSpan(endSpanRef, visibleDependencyRef);
    addVisibleLocalDependencyRefForSpan(startSpanRef, visibleDependencyRef);
    addVisibleLocalDependencyRefForSpan(endSpanRef, visibleDependencyRef);
  }
  const parentStitchingDurationMs = performance.now() - parentStitchingStartTime;

  for (const sourceDependencyRef of sourceTraceGraph.iterateCrossDependencyRefs()) {
    const dependencyId = sourceTraceGraph.getDependencyId(sourceDependencyRef);
    const startSpanRef = sourceTraceGraph.getDependencyStartSpan(sourceDependencyRef);
    const endSpanRef = sourceTraceGraph.getDependencyEndSpan(sourceDependencyRef);
    if (
      !dependencyId ||
      sourceTraceGraph.getDependencyHasKeyword(sourceDependencyRef, 'PARENT') ||
      sourceTraceGraph.getCrossDependencyTopology(sourceDependencyRef) === 'parent' ||
      (startSpanRef != null && filteredSpanRefs.has(startSpanRef)) ||
      (endSpanRef != null && filteredSpanRefs.has(endSpanRef))
    ) {
      continue;
    }

    const endpointId = sourceTraceGraph.getCrossDependencyEndpointId(sourceDependencyRef);
    const startRankNum = sourceTraceGraph.getCrossDependencyStartRankNum(sourceDependencyRef);
    const endRankNum = sourceTraceGraph.getCrossDependencyEndRankNum(sourceDependencyRef);
    const waitTimeMs = sourceTraceGraph.getDependencyWaitTimeMs(sourceDependencyRef) ?? 0;
    const waiting = sourceTraceGraph.getCrossDependencyWaiting(sourceDependencyRef) ?? false;
    const waitNotFinished =
      sourceTraceGraph.getCrossDependencyWaitNotFinished(sourceDependencyRef) ?? false;
    if (!endpointId || startRankNum == null || endRankNum == null) {
      continue;
    }

    visibleDependencyIds.add(dependencyId);
    const visibleDependencyRef = addVisibleCrossDependencyRef(dependencyId, sourceDependencyRef);
    addVisibleDependencyRefForSpan(startSpanRef, visibleDependencyRef);
    addVisibleDependencyRefForSpan(endSpanRef, visibleDependencyRef);
    addCrossEndpointForSpan({
      dependencyId,
      endpointId,
      spanRef: startSpanRef,
      startRankNum,
      endRankNum,
      waitTimeMs,
      waiting,
      waitNotFinished
    });
    addCrossEndpointForSpan({
      dependencyId,
      endpointId,
      spanRef: endSpanRef,
      startRankNum: endRankNum,
      endRankNum: startRankNum,
      waitTimeMs,
      waiting,
      waitNotFinished
    });
  }

  for (const dependency of stitchedCrossParentsByKey.values()) {
    const startSpanRef = resolveSourceSpanRef(sourceTraceGraph, dependency.startSpanId);
    const endSpanRef = resolveSourceSpanRef(sourceTraceGraph, dependency.endSpanId);
    if (startSpanRef == null || endSpanRef == null) {
      continue;
    }
    const override = {
      kind: 'cross-parent',
      endpointId: dependency.endpointId,
      startRankNum: dependency.startRankNum,
      endRankNum: dependency.endRankNum,
      sourceStartSpanRef: dependency.startSpanRef,
      sourceEndSpanRef: dependency.endSpanRef,
      startSpanRef,
      endSpanRef,
      waitMode: dependency.waitMode,
      bidirectional: dependency.bidirectional,
      waitTimeMs: dependency.waitTimeMs,
      keywords: [...dependency.keywords],
      userData: dependency.userData,
      topology: dependency.topology,
      waiting: dependency.waiting,
      waitNotFinished: dependency.waitNotFinished
    } satisfies TraceGraphVisibleDependencyOverride;
    visibleDependencyIds.add(dependency.dependencyId);
    const visibleDependencyRef = addVisibleCrossDependencyRef(
      dependency.dependencyId,
      dependency.dependencyRef != null && isCrossDependencyRef(dependency.dependencyRef)
        ? (dependency.dependencyRef as CrossDependencyRef)
        : null
    );
    setDependencyOverrideSpec(visibleDependencyRef, override);
    addVisibleDependencyRefForSpan(startSpanRef, visibleDependencyRef);
    addVisibleDependencyRefForSpan(endSpanRef, visibleDependencyRef);
    addCrossEndpointForSpan({
      dependencyId: dependency.dependencyId,
      endpointId: dependency.endpointId,
      spanRef: startSpanRef,
      startRankNum: dependency.startRankNum,
      endRankNum: dependency.endRankNum,
      waitTimeMs: dependency.waitTimeMs,
      waiting: dependency.waiting,
      waitNotFinished: dependency.waitNotFinished,
      userData: dependency.userData
    });
    addCrossEndpointForSpan({
      dependencyId: dependency.dependencyId,
      endpointId: dependency.endpointId,
      spanRef: endSpanRef,
      startRankNum: dependency.endRankNum,
      endRankNum: dependency.startRankNum,
      waitTimeMs: dependency.waitTimeMs,
      waiting: dependency.waiting,
      waitNotFinished: dependency.waitNotFinished,
      userData: dependency.userData
    });
  }
  log.probe(0, `${label} done`, {
    processCount: visibleProcessIds.length,
    visibleSpanCount: visibleSpanRefs.size,
    visibleDependencyCount: visibleDependencyIds.size,
    visibleLocalDependencyCount: Object.values(visibleLocalDependencyIdsByProcessId).reduce(
      (count, dependencyIds) => count + dependencyIds.length,
      0
    ),
    stitchedLocalParentCount: stitchedLocalParentsByKey.size,
    stitchedCrossParentCount: stitchedCrossParentsByKey.size,
    visibleProcessPassDurationMs,
    parentStitchingDurationMs,
    durationMs: performance.now() - visibleIndexBuildStartTime,
    ...getHeapUsageProbeFields()
  })();

  return {
    visibleProcessIds,
    visibleSpanRefsByProcessId,
    visibleBlockTablesByProcessId,
    visibleLocalDependencyIdsByProcessId,
    visibleLocalDependencyRefsByProcessId,
    visibleLocalDependencyIds,
    visibleLocalDependencySourceRefs,
    visibleCrossDependencyIds,
    visibleCrossDependencySourceRefs,
    visibleLocalDependencyRefBySourceRef,
    visibleCrossDependencyRefBySourceRef,
    visibleLocalDependencyProcessIdByRef,
    visibleDependencyRefsBySpanRef,
    visibleSpanRefSet: visibleSpanRefs,
    visibleDependencyIdSet: visibleDependencyIds,
    dependencyOverrideSpecsByRef,
    visibleLocalDependencyRefsBySpanRef,
    endpointsBySpanRef,
    primaryEndpointIdBySpanRef,
    visibleLaneLayoutInfo: {
      threadLaneLayoutMapByRef:
        visibleLaneCountsByThreadRef.size > 0
          ? new Map(
              [...visibleLaneCountsByThreadRef.entries()].map(([threadRef, laneCount]) => [
                threadRef,
                {laneCount}
              ])
            )
          : undefined,
      explicitLaneValueCount: visibleExplicitLaneValueCount,
      threadsWithLaneDataCount: visibleLaneCountsByThreadRef.size
    }
  };
}

/**
 * Builds the active filtered-ref set for a visible-index pass without storing trace-store state on TraceGraph.
 */
function buildVisibleIndexFilteredSpanRefs(traceGraph: TraceGraph): ReadonlySet<SpanRef> {
  if (!traceGraph.hasActiveTraceStoreSpanFilter()) {
    return traceGraph.filteredSpanRefs;
  }

  const filteredSpanRefs = new Set(traceGraph.filteredSpanRefs);
  for (const process of traceGraph.processes) {
    const processId = process.processId as TraceProcessId;
    for (const spanRef of iterateTraceGraphProcessSpanRefs(traceGraph, processId)) {
      if (traceGraph.spanIsFiltered(spanRef)) {
        filteredSpanRefs.add(spanRef);
      }
    }
  }
  return filteredSpanRefs;
}

/**
 * Materializes one visible dependency from its compact override spec plus the canonical source dependency.
 */
function materializeVisibleDependency(params: {
  traceGraph: Readonly<TraceGraph>;
  dependencyId: TraceDependencyId;
  dependencyOverrideSpec: TraceGraphVisibleDependencyOverride | null;
  sourceDependency: TraceDependency | null;
}): TraceDependency | null {
  const {dependencyId, dependencyOverrideSpec, sourceDependency, traceGraph} = params;
  if (!dependencyOverrideSpec) {
    return sourceDependency
      ? withResolvedVisibleDependencyRuntimeRefs({
          traceGraph,
          dependency: sourceDependency
        })
      : null;
  }

  const baseDependency = sourceDependency;
  if (!baseDependency) {
    return null;
  }

  if (dependencyOverrideSpec.kind === 'local-rewrite') {
    if (baseDependency.type !== 'trace-local-dependency') {
      return null;
    }
    const startSpanId = traceGraph.getSpanBlockId(dependencyOverrideSpec.startSpanRef);
    const endSpanId = traceGraph.getSpanBlockId(dependencyOverrideSpec.endSpanRef);
    if (!startSpanId || !endSpanId) {
      return null;
    }
    return withResolvedVisibleDependencyRuntimeRefs({
      traceGraph,
      dependency: {
        ...baseDependency,
        startSpanRef: dependencyOverrideSpec.startSpanRef,
        endSpanRef: dependencyOverrideSpec.endSpanRef,
        startSpanId,
        endSpanId
      } satisfies TraceLocalDependency
    });
  }

  if (dependencyOverrideSpec.kind === 'local-parent') {
    const startSpanId = traceGraph.getSpanBlockId(dependencyOverrideSpec.startSpanRef);
    const endSpanId = traceGraph.getSpanBlockId(dependencyOverrideSpec.endSpanRef);
    if (!startSpanId || !endSpanId) {
      return null;
    }
    return withResolvedVisibleDependencyRuntimeRefs({
      traceGraph,
      dependency: {
        type: 'trace-local-dependency',
        dependencyRef:
          baseDependency.type === 'trace-local-dependency'
            ? baseDependency.dependencyRef
            : encodeVisibleLocalDependencyRef(0),
        startSpanRef: dependencyOverrideSpec.startSpanRef,
        endSpanRef: dependencyOverrideSpec.endSpanRef,
        dependencyId,
        startSpanId,
        endSpanId,
        keywords: baseDependency.keywords,
        waitMode: baseDependency.waitMode,
        bidirectional: baseDependency.bidirectional,
        waitTimeMs: baseDependency.waitTimeMs,
        userData: baseDependency.userData
      } satisfies TraceLocalDependency
    });
  }

  const startSpanId = traceGraph.getSpanBlockId(dependencyOverrideSpec.startSpanRef);
  const endSpanId = traceGraph.getSpanBlockId(dependencyOverrideSpec.endSpanRef);
  if (!startSpanId || !endSpanId) {
    return null;
  }
  return withResolvedVisibleDependencyRuntimeRefs({
    traceGraph,
    dependency: {
      type: 'trace-cross-process-dependency',
      dependencyRef:
        baseDependency.type === 'trace-cross-process-dependency'
          ? baseDependency.dependencyRef
          : encodeVisibleCrossDependencyRef(0),
      startSpanRef: dependencyOverrideSpec.startSpanRef,
      endSpanRef: dependencyOverrideSpec.endSpanRef,
      dependencyId,
      endpointId: dependencyOverrideSpec.endpointId,
      startRankNum: dependencyOverrideSpec.startRankNum,
      endRankNum: dependencyOverrideSpec.endRankNum,
      startSpanId,
      endSpanId,
      waitMode: baseDependency.waitMode,
      bidirectional: baseDependency.bidirectional,
      topology: dependencyOverrideSpec.topology,
      waitTimeMs: baseDependency.waitTimeMs,
      waiting: dependencyOverrideSpec.waiting,
      waitNotFinished: dependencyOverrideSpec.waitNotFinished,
      keywords: baseDependency.keywords,
      userData: baseDependency.userData
    } satisfies TraceCrossProcessDependency
  });
}

/**
 * Re-attaches canonical visible dependency refs and endpoint span refs to one runtime dependency.
 */
function withResolvedVisibleDependencyRuntimeRefs(params: {
  traceGraph: Readonly<TraceGraph>;
  dependency: TraceDependency;
}): TraceDependency {
  const {traceGraph, dependency} = params;
  if (dependency.type === 'trace-local-dependency') {
    const dependencyRef =
      (traceGraph.getVisibleDependencyRefForDependency(
        dependency
      ) as VisibleLocalDependencyRef | null) ?? dependency.dependencyRef;
    const fallbackProcessSpanRef = dependency.startSpanRef ?? dependency.endSpanRef ?? null;
    const processRef =
      (dependencyRef != null && isVisibleLocalDependencyRef(dependencyRef)
        ? traceGraph.getVisibleLocalDependencyProcessRefByRef(dependencyRef)
        : null) ??
      (fallbackProcessSpanRef != null
        ? traceGraph.getProcessRefBySpanRef(fallbackProcessSpanRef)
        : null) ??
      null;
    const startSpanRef =
      resolveProcessScopedSpanRef(traceGraph, dependency.startSpanId, processRef) ??
      dependency.startSpanRef;
    const endSpanRef =
      resolveProcessScopedSpanRef(traceGraph, dependency.endSpanId, processRef) ??
      dependency.endSpanRef;
    return {
      ...dependency,
      dependencyRef,
      startSpanRef,
      endSpanRef
    } satisfies TraceLocalDependency;
  }

  const dependencyRef =
    (traceGraph.getVisibleDependencyRefForDependency(
      dependency
    ) as VisibleCrossDependencyRef | null) ?? dependency.dependencyRef;
  const startSpanRef =
    resolveProcessScopedSpanRef(
      traceGraph,
      dependency.startSpanId,
      getProcessRefByRankNum(traceGraph, dependency.startRankNum)
    ) ?? dependency.startSpanRef;
  const endSpanRef =
    resolveProcessScopedSpanRef(
      traceGraph,
      dependency.endSpanId,
      getProcessRefByRankNum(traceGraph, dependency.endRankNum)
    ) ?? dependency.endSpanRef;
  return {
    ...dependency,
    dependencyRef,
    startSpanRef,
    endSpanRef
  } satisfies TraceCrossProcessDependency;
}

/**
 * Resolves one canonical process ref from a process rank number.
 */
export function getProcessRefByRankNum(
  traceGraph: Readonly<TraceGraph>,
  rankNum: number
): ProcessRef | null {
  const processId = getProcessIdByRankNum(traceGraph).get(rankNum) ?? null;
  if (!processId) {
    return null;
  }

  const processIndex = traceGraph.processes.findIndex(process => process.processId === processId);
  return processIndex < 0 ? null : (traceGraph.getProcessRefs()[processIndex] ?? null);
}

/**
 * Converts one resolved visible dependency into the ref-native runtime dependency source shape.
 */
export function buildVisibleDependencySource(params: {
  dependencyId: TraceDependencyId;
  dependency: TraceDependency;
}): TraceDependencySource | null {
  const {dependencyId, dependency} = params;
  if (dependency.type === 'trace-local-dependency') {
    if (
      dependency.startSpanRef == null ||
      dependency.endSpanRef == null ||
      dependency.dependencyRef == null ||
      !isVisibleLocalDependencyRef(dependency.dependencyRef)
    ) {
      return null;
    }

    return {
      type: 'trace-local-dependency',
      dependencyRef: dependency.dependencyRef,
      dependencyId,
      startSpanId: dependency.startSpanId,
      endSpanId: dependency.endSpanId,
      startSpanRef: dependency.startSpanRef,
      endSpanRef: dependency.endSpanRef,
      waitMode: dependency.waitMode,
      bidirectional: dependency.bidirectional,
      waitTimeMs: dependency.waitTimeMs,
      keywords: dependency.keywords,
      userData: dependency.userData
    } satisfies TraceLocalDependencySource;
  }

  if (
    dependency.startSpanRef == null ||
    dependency.endSpanRef == null ||
    dependency.dependencyRef == null ||
    !isVisibleCrossDependencyRef(dependency.dependencyRef)
  ) {
    return null;
  }

  return {
    type: 'trace-cross-process-dependency',
    dependencyRef: dependency.dependencyRef,
    dependencyId,
    endpointId: dependency.endpointId,
    startRankNum: dependency.startRankNum,
    endRankNum: dependency.endRankNum,
    startSpanId: dependency.startSpanId,
    endSpanId: dependency.endSpanId,
    startSpanRef: dependency.startSpanRef,
    endSpanRef: dependency.endSpanRef,
    waitMode: dependency.waitMode,
    bidirectional: dependency.bidirectional,
    topology: dependency.topology,
    waitTimeMs: dependency.waitTimeMs,
    waiting: dependency.waiting,
    waitNotFinished: dependency.waitNotFinished,
    keywords: dependency.keywords,
    userData: dependency.userData
  } satisfies TraceCrossDependencySource;
}

/**
 * Resolves one span ref using process-local ownership when available, then falls back globally.
 */
export function resolveProcessScopedSpanRef(
  traceGraph: Readonly<TraceGraph>,
  spanId: TraceSpanId,
  processRef: ProcessRef | null
): SpanRef | null {
  if (processRef) {
    const scopedSpanRef = traceGraph.getProcessScopedSpanRef(processRef, spanId);
    if (scopedSpanRef != null) {
      return scopedSpanRef;
    }
  }
  return traceGraph.getSpanRefByExternalBlockId(spanId);
}

/**
 * Returns process span-ref tables with graph filter-mask columns applied to touched processes.
 */
function buildTraceGraphProcessSpanTableMap(params: {
  /** Process span-ref tables from the source graph. */
  processSpanTableMap: Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>>;
  /** Build-local row-aligned filter masks keyed by touched process id. */
  processFilterMaskStates: Readonly<TraceProcessSpanFilterMaskStateMap>;
}): Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>> | undefined {
  let nextProcessSpanTableMap: Record<TraceProcessId, TraceProcessSpanRefTable> | null = null;
  for (const [processId, processFilterMaskState] of Object.entries(
    params.processFilterMaskStates
  )) {
    if (!processFilterMaskState) {
      continue;
    }
    const nextProcessSpanTable = buildTraceProcessSpanRefTableWithFilterMaskColumn(
      processFilterMaskState.processSpanTable,
      processFilterMaskState.filterMask
    );
    nextProcessSpanTableMap ??= {...params.processSpanTableMap};
    nextProcessSpanTableMap[processId as TraceProcessId] = nextProcessSpanTable;
  }

  return nextProcessSpanTableMap ?? undefined;
}

/** Reads the source `SpanRef` stored at one process-local span-table row. */
function getTraceProcessSpanRefAtRow(
  processSpanTable: TraceProcessSpanRefTable,
  processRowIndex: number
): SpanRef | null {
  const spanRefValue = processSpanTable.getChild('span_ref')?.get(processRowIndex);
  return typeof spanRefValue === 'number' && Number.isFinite(spanRefValue)
    ? (spanRefValue as SpanRef)
    : null;
}

/** ORs nonzero filter bits into the row-aligned build buffer for one touched process. */
function addTraceProcessSpanFilterMask(params: {
  /** Mutable build-local process mask buffers keyed by process id. */
  processFilterMaskStates: TraceProcessSpanFilterMaskStateMap;
  /** Process owning the process-local row. */
  processId: TraceProcessId;
  /** Source process span table that defines the buffer row count and row order. */
  processSpanTable: TraceProcessSpanRefTable;
  /** Row ordinal in `processSpanTable`. */
  processRowIndex: number;
  /** Filter mask bits to OR into this row. */
  filterMask: TraceSpanFilterMask;
}): void {
  if (
    params.filterMask === TRACE_SPAN_FILTER_MASK_NONE ||
    params.processRowIndex < 0 ||
    params.processRowIndex >= params.processSpanTable.numRows
  ) {
    return;
  }

  let processFilterMaskState = params.processFilterMaskStates[params.processId];
  if (!processFilterMaskState) {
    processFilterMaskState = {
      processId: params.processId,
      processSpanTable: params.processSpanTable,
      filterMask: new Uint8Array(params.processSpanTable.numRows)
    };
    params.processFilterMaskStates[params.processId] = processFilterMaskState;
  }

  processFilterMaskState.filterMask[params.processRowIndex] |= params.filterMask;
}

/**
 * Builds per-span filter state and nearest visible parent metadata for one source graph.
 */
export function buildTraceGraphState(
  traceGraphData: TraceGraphData,
  spanFilters: readonly string[],
  includeSourceSpanFilters: boolean,
  overlappingParentSpanFilter: TraceGraphOverlappingParentSpanFilter | null,
  similarDurationChainSpanFilter: TraceGraphSimilarDurationChainSpanFilter | null
): TraceGraphPreparedState {
  const stateBuildStartTime = performance.now();
  const traceGraphTables = traceGraphData;
  const label = `buildTraceGraphState graph=${traceGraphData.name}`;
  const filterPlan = buildCompiledTraceSpanFilterPlan(spanFilters);
  const hasNameSpanFilters =
    filterPlan.literalPrefixes.length > 0 || filterPlan.regexMatchers.length > 0;
  const filteredSpanRefs = new Set<SpanRef>();
  const processFilterMaskStates: TraceProcessSpanFilterMaskStateMap = {};
  const filteredBlockIds = new Set<TraceSpanId>();
  const filteredSpanCountsByFilter: {
    -readonly [Key in keyof TraceGraphFilteredSpanCountsByFilter]: number;
  } = {
    spanFilterCount: 0,
    overlappingParentSpanFilterCount: 0,
    similarDurationChainSpanFilterCount: 0
  };
  const filteredSpanScanStartTime = performance.now();
  for (const process of traceGraphData.processes) {
    const processId = process.processId as TraceProcessId;
    const processSpanTable = traceGraphData.processSpanTableMap[processId];
    if (!processSpanTable) {
      continue;
    }
    const processSpanRowIndexById = new Map<TraceSpanId, number>();
    const reusableSpanRow = {
      spanId: '' as TraceSpanId,
      threadId: '' as TraceThreadId,
      name: '',
      source: null,
      processName: '',
      primaryTimingKey: 'primary',
      status: 'finished' as const,
      startTimeMs: 0,
      endTimeMs: 0,
      durationMs: 0,
      durationMsAsString: '0ms',
      keywords: []
    };
    for (
      let processRowIndex = 0;
      processRowIndex < processSpanTable.numRows;
      processRowIndex += 1
    ) {
      const spanIndex = getTraceProcessSpanRefAtRow(processSpanTable, processRowIndex);
      if (spanIndex == null) {
        continue;
      }
      const spanRow = getArrowTraceSpanRow(traceGraphTables, spanIndex, reusableSpanRow);
      if (spanRow) {
        processSpanRowIndexById.set(spanRow.spanId, processRowIndex);
      }
      const nameFilterMask =
        spanRow && hasNameSpanFilters
          ? getTraceSpanNameFilterMatchMask({
              spanName: spanRow.name,
              filterPlan
            })
          : TRACE_SPAN_FILTER_MASK_NONE;
      const sourceFilterMask =
        spanRow && hasNameSpanFilters && includeSourceSpanFilters
          ? getTraceSpanSourceFilterMatchMask({
              source: spanRow.source,
              filterPlan
            })
          : TRACE_SPAN_FILTER_MASK_NONE;
      const textFilterMask = nameFilterMask | sourceFilterMask;
      if (spanRow && textFilterMask !== TRACE_SPAN_FILTER_MASK_NONE) {
        if (!filteredSpanRefs.has(spanIndex)) {
          filteredSpanCountsByFilter.spanFilterCount += 1;
        }
        filteredSpanRefs.add(spanIndex);
        addTraceProcessSpanFilterMask({
          processFilterMaskStates,
          processId,
          processSpanTable,
          processRowIndex,
          filterMask: textFilterMask
        });
        filteredBlockIds.add(spanRow.spanId);
      }
    }

    if (overlappingParentSpanFilter) {
      filteredSpanCountsByFilter.overlappingParentSpanFilterCount +=
        filterOverlappingParentSpansForProcess({
          traceGraphTables,
          processId,
          processSpanTable,
          processSpanRowIndexById,
          overlappingParentSpanFilter,
          filteredSpanRefs,
          processFilterMaskStates,
          filteredBlockIds
        });
    }

    if (similarDurationChainSpanFilter) {
      filteredSpanCountsByFilter.similarDurationChainSpanFilterCount +=
        filterSimilarDurationSpanChainsForProcess({
          traceGraphTables,
          processId,
          processSpanTable,
          processSpanRowIndexById,
          similarDurationChainSpanFilter,
          filteredSpanRefs,
          processFilterMaskStates,
          filteredBlockIds
        });
    }
  }
  const filteredSpanScanDurationMs = performance.now() - filteredSpanScanStartTime;
  log.probe(0, `${label} done`, {
    processCount: traceGraphTables.processes.length,
    filteredSpanCount: filteredSpanRefs.size,
    filteredSpanScanDurationMs,
    durationMs: performance.now() - stateBuildStartTime,
    ...getHeapUsageProbeFields()
  })();

  return {
    filteredSpanRefs,
    processSpanTableMap: buildTraceGraphProcessSpanTableMap({
      processSpanTableMap: traceGraphTables.processSpanTableMap,
      processFilterMaskStates
    }),
    filteredSpanCountsByFilter,
    spanFilters,
    overlappingParentSpanFilter: overlappingParentSpanFilter ?? undefined,
    similarDurationChainSpanFilter: similarDurationChainSpanFilter ?? undefined
  };
}

/**
 * Returns a compatible prepared filter state, or null when the active filters differ.
 */
export function getUsableTraceGraphPreparedState(
  preparedState: TraceGraphPreparedState | undefined,
  spanFilters: readonly string[],
  overlappingParentSpanFilter: TraceGraphOverlappingParentSpanFilter | null,
  similarDurationChainSpanFilter: TraceGraphSimilarDurationChainSpanFilter | null
): TraceGraphPreparedState | null {
  if (!preparedState) {
    return null;
  }
  const preparedSpanFilters = normalizeTraceSpanFilters(preparedState.spanFilters);
  if (!areSpanFilterListsEqual(spanFilters, preparedSpanFilters)) {
    return null;
  }
  const preparedOverlappingParentSpanFilter = preparedState.overlappingParentSpanFilter ?? null;
  if (
    preparedOverlappingParentSpanFilter?.maxChildDurationMs !==
    overlappingParentSpanFilter?.maxChildDurationMs
  ) {
    return null;
  }
  const preparedSimilarDurationChainSpanFilter =
    preparedState.similarDurationChainSpanFilter ?? null;
  if (
    preparedSimilarDurationChainSpanFilter?.maxRelativeDurationDelta !==
    similarDurationChainSpanFilter?.maxRelativeDurationDelta
  ) {
    return null;
  }
  return preparedState;
}

/**
 * Adds short same-process overlapping single-parent child spans to the filtered-state sets.
 *
 * @returns Number of spans newly filtered by this stage.
 */
function filterOverlappingParentSpansForProcess(params: {
  /** Arrow-backed graph tables that own the candidate span rows. */
  traceGraphTables: Readonly<TraceGraphData>;
  /** Process whose local dependencies should be scanned. */
  processId: TraceProcessId;
  /** Process-local span table that owns the row-aligned filter-mask buffer. */
  processSpanTable: TraceProcessSpanRefTable;
  /** Process-local span-table row indexes keyed by external span id. */
  processSpanRowIndexById: ReadonlyMap<TraceSpanId, number>;
  /** Topology-filter configuration for eligible short children. */
  overlappingParentSpanFilter: TraceGraphOverlappingParentSpanFilter;
  /** Mutable filtered span-ref set shared with text filters. */
  filteredSpanRefs: Set<SpanRef>;
  /** Mutable build-local row-aligned filter masks keyed by touched process id. */
  processFilterMaskStates: TraceProcessSpanFilterMaskStateMap;
  /** Mutable filtered external span-id set shared with text filters. */
  filteredBlockIds: Set<TraceSpanId>;
}): number {
  const {
    traceGraphTables,
    processId,
    processSpanTable,
    processSpanRowIndexById,
    overlappingParentSpanFilter,
    filteredSpanRefs,
    processFilterMaskStates,
    filteredBlockIds
  } = params;
  const dependencyTable = traceGraphTables.localDependencyTableMap[processId];
  if (!dependencyTable) {
    return 0;
  }

  const startSpanIdColumn = dependencyTable.getChild('startSpanId');
  const endSpanIdColumn = dependencyTable.getChild('endSpanId');
  const hasParentKeywordColumn = dependencyTable.getChild('hasParentKeyword');
  const parentDependencyCountsByChildId = new Map<TraceSpanId, number>();
  const uniqueParentByChildId = new Map<TraceSpanId, TraceSpanId>();

  for (let rowIndex = 0; rowIndex < dependencyTable.numRows; rowIndex += 1) {
    if (hasParentKeywordColumn?.get(rowIndex) !== true) {
      continue;
    }

    const parentSpanId = startSpanIdColumn?.get(rowIndex) as TraceSpanId | null | undefined;
    const childSpanId = endSpanIdColumn?.get(rowIndex) as TraceSpanId | null | undefined;
    if (!parentSpanId || !childSpanId) {
      continue;
    }

    parentDependencyCountsByChildId.set(
      childSpanId,
      (parentDependencyCountsByChildId.get(childSpanId) ?? 0) + 1
    );
    uniqueParentByChildId.set(childSpanId, parentSpanId);
  }

  let filteredSpanCount = 0;
  for (const [childSpanId, parentDependencyCount] of parentDependencyCountsByChildId) {
    if (parentDependencyCount !== 1) {
      continue;
    }

    const parentSpanId = uniqueParentByChildId.get(childSpanId);
    const childProcessRowIndex = processSpanRowIndexById.get(childSpanId);
    const parentProcessRowIndex = parentSpanId
      ? processSpanRowIndexById.get(parentSpanId)
      : undefined;
    if (childProcessRowIndex == null || parentProcessRowIndex == null) {
      continue;
    }
    const childSpanRef = getTraceProcessSpanRefAtRow(processSpanTable, childProcessRowIndex);
    const parentSpanRef = getTraceProcessSpanRefAtRow(processSpanTable, parentProcessRowIndex);
    if (childSpanRef == null || parentSpanRef == null) {
      continue;
    }

    if (
      shouldFilterOverlappingParentSpan({
        traceGraphTables,
        childSpanRef,
        parentSpanRef,
        overlappingParentSpanFilter
      })
    ) {
      if (!filteredSpanRefs.has(childSpanRef)) {
        filteredSpanCount += 1;
      }
      filteredSpanRefs.add(childSpanRef);
      addTraceProcessSpanFilterMask({
        processFilterMaskStates,
        processId,
        processSpanTable,
        processRowIndex: childProcessRowIndex,
        filterMask: TRACE_SPAN_FILTER_MASK_TOPOLOGY
      });
      filteredBlockIds.add(childSpanId);
    }
  }

  return filteredSpanCount;
}

/**
 * Adds non-terminal spans from similar-duration non-branching parent chains to the filtered sets.
 *
 * @returns Number of spans newly filtered by this stage.
 */
function filterSimilarDurationSpanChainsForProcess(params: {
  /** Arrow-backed graph tables that own the candidate span rows. */
  traceGraphTables: Readonly<TraceGraphData>;
  /** Process whose local parent chains should be scanned. */
  processId: TraceProcessId;
  /** Process-local span table that owns the row-aligned filter-mask buffer. */
  processSpanTable: TraceProcessSpanRefTable;
  /** Process-local span-table row indexes keyed by external span id. */
  processSpanRowIndexById: ReadonlyMap<TraceSpanId, number>;
  /** Topology-filter configuration for similar-duration parent chains. */
  similarDurationChainSpanFilter: TraceGraphSimilarDurationChainSpanFilter;
  /** Mutable filtered span-ref set shared with the other filters. */
  filteredSpanRefs: Set<SpanRef>;
  /** Mutable build-local row-aligned filter masks keyed by touched process id. */
  processFilterMaskStates: TraceProcessSpanFilterMaskStateMap;
  /** Mutable filtered external span-id set shared with the other filters. */
  filteredBlockIds: Set<TraceSpanId>;
}): number {
  const {
    traceGraphTables,
    processId,
    processSpanTable,
    processSpanRowIndexById,
    similarDurationChainSpanFilter,
    filteredSpanRefs,
    processFilterMaskStates,
    filteredBlockIds
  } = params;
  const dependencyTable = traceGraphTables.localDependencyTableMap[processId];
  if (!dependencyTable) {
    return 0;
  }

  const startSpanIdColumn = dependencyTable.getChild('startSpanId');
  const endSpanIdColumn = dependencyTable.getChild('endSpanId');
  const hasParentKeywordColumn = dependencyTable.getChild('hasParentKeyword');
  const parentDependencyCountsByChildId = new Map<TraceSpanId, number>();
  const childDependencyCountsByParentId = new Map<TraceSpanId, number>();
  const uniqueParentByChildId = new Map<TraceSpanId, TraceSpanId>();

  for (let rowIndex = 0; rowIndex < dependencyTable.numRows; rowIndex += 1) {
    if (hasParentKeywordColumn?.get(rowIndex) !== true) {
      continue;
    }

    const parentSpanId = startSpanIdColumn?.get(rowIndex) as TraceSpanId | null | undefined;
    const childSpanId = endSpanIdColumn?.get(rowIndex) as TraceSpanId | null | undefined;
    if (
      !parentSpanId ||
      !childSpanId ||
      !processSpanRowIndexById.has(parentSpanId) ||
      !processSpanRowIndexById.has(childSpanId)
    ) {
      continue;
    }

    parentDependencyCountsByChildId.set(
      childSpanId,
      (parentDependencyCountsByChildId.get(childSpanId) ?? 0) + 1
    );
    childDependencyCountsByParentId.set(
      parentSpanId,
      (childDependencyCountsByParentId.get(parentSpanId) ?? 0) + 1
    );
    uniqueParentByChildId.set(childSpanId, parentSpanId);
  }

  let filteredSpanCount = 0;
  for (const [candidateSpanId, candidateProcessRowIndex] of processSpanRowIndexById) {
    const candidateSpanRef = getTraceProcessSpanRefAtRow(
      processSpanTable,
      candidateProcessRowIndex
    );
    if (candidateSpanRef == null || filteredSpanRefs.has(candidateSpanRef)) {
      continue;
    }

    const candidateDurationMs = getFiniteTraceSpanDurationMs(traceGraphTables, candidateSpanRef);
    if (candidateDurationMs == null) {
      continue;
    }

    const collapsiblePredecessors: Array<{
      spanId: TraceSpanId;
      spanRef: SpanRef;
      processRowIndex: number;
    }> = [];
    const visitedSpanIds = new Set<TraceSpanId>([candidateSpanId]);
    let currentSpanId = candidateSpanId;

    while ((parentDependencyCountsByChildId.get(currentSpanId) ?? 0) === 1) {
      const parentSpanId = uniqueParentByChildId.get(currentSpanId);
      if (
        !parentSpanId ||
        visitedSpanIds.has(parentSpanId) ||
        (childDependencyCountsByParentId.get(parentSpanId) ?? 0) !== 1
      ) {
        break;
      }

      const parentProcessRowIndex = processSpanRowIndexById.get(parentSpanId);
      const parentSpanRef =
        parentProcessRowIndex == null
          ? null
          : getTraceProcessSpanRefAtRow(processSpanTable, parentProcessRowIndex);
      const parentDurationMs =
        parentSpanRef == null
          ? null
          : getFiniteTraceSpanDurationMs(traceGraphTables, parentSpanRef);
      if (
        parentSpanRef == null ||
        parentProcessRowIndex == null ||
        parentDurationMs == null ||
        !areTraceSpanDurationsSimilar({
          leftDurationMs: parentDurationMs,
          rightDurationMs: candidateDurationMs,
          maxRelativeDurationDelta: similarDurationChainSpanFilter.maxRelativeDurationDelta
        })
      ) {
        break;
      }

      collapsiblePredecessors.push({
        spanId: parentSpanId,
        spanRef: parentSpanRef,
        processRowIndex: parentProcessRowIndex
      });
      visitedSpanIds.add(parentSpanId);
      currentSpanId = parentSpanId;
    }

    for (const predecessor of collapsiblePredecessors) {
      if (!filteredSpanRefs.has(predecessor.spanRef)) {
        filteredSpanCount += 1;
      }
      filteredSpanRefs.add(predecessor.spanRef);
      addTraceProcessSpanFilterMask({
        processFilterMaskStates,
        processId,
        processSpanTable,
        processRowIndex: predecessor.processRowIndex,
        filterMask: TRACE_SPAN_FILTER_MASK_TOPOLOGY
      });
      filteredBlockIds.add(predecessor.spanId);
    }
  }

  return filteredSpanCount;
}

/** Returns whether one short child span overlaps its only local parent span in time. */
function shouldFilterOverlappingParentSpan(params: {
  /** Arrow-backed graph tables that own the candidate span rows. */
  traceGraphTables: Readonly<TraceGraphData>;
  /** Exact child span ref under evaluation. */
  childSpanRef: SpanRef;
  /** Exact parent span ref under evaluation. */
  parentSpanRef: SpanRef;
  /** Topology-filter configuration for eligible short children. */
  overlappingParentSpanFilter: TraceGraphOverlappingParentSpanFilter;
}): boolean {
  const {traceGraphTables, childSpanRef, parentSpanRef, overlappingParentSpanFilter} = params;
  const childDurationMs = getArrowTraceSpanField(traceGraphTables, childSpanRef, 'durationMs') as
    | number
    | null;
  if (
    childDurationMs == null ||
    !Number.isFinite(childDurationMs) ||
    childDurationMs > overlappingParentSpanFilter.maxChildDurationMs
  ) {
    return false;
  }

  const childStartTimeMs = getArrowTraceSpanField(traceGraphTables, childSpanRef, 'startTimeMs') as
    | number
    | null;
  const childEndTimeMs = getArrowTraceSpanField(traceGraphTables, childSpanRef, 'endTimeMs') as
    | number
    | null;
  const parentStartTimeMs = getArrowTraceSpanField(
    traceGraphTables,
    parentSpanRef,
    'startTimeMs'
  ) as number | null;
  const parentEndTimeMs = getArrowTraceSpanField(traceGraphTables, parentSpanRef, 'endTimeMs') as
    | number
    | null;
  if (
    childStartTimeMs == null ||
    childEndTimeMs == null ||
    parentStartTimeMs == null ||
    parentEndTimeMs == null ||
    !Number.isFinite(childStartTimeMs) ||
    !Number.isFinite(childEndTimeMs) ||
    !Number.isFinite(parentStartTimeMs) ||
    !Number.isFinite(parentEndTimeMs)
  ) {
    return false;
  }

  if (childDurationMs === 0) {
    return childStartTimeMs >= parentStartTimeMs && childStartTimeMs <= parentEndTimeMs;
  }

  return Math.min(childEndTimeMs, parentEndTimeMs) > Math.max(childStartTimeMs, parentStartTimeMs);
}

/** Returns one finite non-negative span duration from Arrow storage. */
function getFiniteTraceSpanDurationMs(
  traceGraphTables: Readonly<TraceGraphData>,
  spanRef: SpanRef
): number | null {
  const durationMs = getArrowTraceSpanField(traceGraphTables, spanRef, 'durationMs') as
    | number
    | null;
  return durationMs != null && Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
}

/** Returns whether two span durations remain within the configured relative-delta limit. */
function areTraceSpanDurationsSimilar(params: {
  /** First duration to compare. */
  leftDurationMs: number;
  /** Second duration to compare. */
  rightDurationMs: number;
  /** Maximum relative delta allowed between the compared durations. */
  maxRelativeDurationDelta: number;
}): boolean {
  const {leftDurationMs, rightDurationMs, maxRelativeDurationDelta} = params;
  if (leftDurationMs === 0 || rightDurationMs === 0) {
    return leftDurationMs === rightDurationMs;
  }

  const largestDurationMs = Math.max(leftDurationMs, rightDurationMs);
  return Math.abs(leftDurationMs - rightDurationMs) <= largestDurationMs * maxRelativeDurationDelta;
}
