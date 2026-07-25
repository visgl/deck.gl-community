import {deserializeArrowTraceJson} from '../ingestion/arrow-trace-json';
import {
  decodeTraceDependencyWaitModeCode,
  traceDependencyKeywordFlagsHasParent,
  traceDependencyKeywordFlagsHasSubmit
} from '../ingestion/trace-dependency-arrow-fields';
import {
  dependencyKeywordListHas,
  isDependencyUserData,
  isTraceDependencyWaitMode
} from './trace-graph-runtime-helpers';
import {
  getCrossProcessDependencyRefIndex,
  getSameProcessDependencyRefProcessIndex,
  getSameProcessDependencyRefRowIndex,
  isCrossProcessDependencyRef,
  isSameProcessDependencyRef
} from './trace-id-encoder';
import {encodeSameProcessDependencyIdFromRef} from './trace-id-utils';

import type {
  ArrowTraceCrossProcessDependencyTable,
  ArrowTraceProcessMetadata,
  ArrowTraceSameProcessDependencyTable
} from '../ingestion/arrow-trace';
import type {TraceSameProcessDependencySource} from '../trace-graph-accessors';
import type {
  CrossProcessDependencyRef,
  ProcessRef,
  SameProcessDependencyRef
} from './trace-id-encoder';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceDependency,
  TraceDependencyId,
  TraceProcessId,
  TraceSpanId
} from './trace-types';

/** Minimal graph surface used for dependency field access without materializing objects. */
type TraceGraphDependencyAccessorSource = {
  /** Metadata-only process records in graph order. */
  readonly processes: Readonly<ArrowTraceProcessMetadata[]>;
  /** Process-local Arrow dependency tables keyed by process id. */
  readonly sameProcessDependencyTableMap: Readonly<
    Record<TraceProcessId, ArrowTraceSameProcessDependencyTable>
  >;
  /** Graph-global Arrow cross-process dependency table. */
  readonly crossProcessDependencyTable: Readonly<ArrowTraceCrossProcessDependencyTable>;
  /** Canonical process ids indexed by packed process index. */
  readonly processIdsByIndex: ReadonlyArray<TraceProcessId>;
  /** Returns canonical process refs in graph order. */
  getProcessRefs(): ReadonlyArray<ProcessRef>;
  /** Returns the external span id for one span ref. */
  getSpanId(spanRef: SpanRef): TraceSpanId | null;
  /** Returns the owning process ref for one span ref. */
  getProcessRefBySpanRef(spanRef: SpanRef): ProcessRef | null;
  /** Returns a span ref by external span id. */
  getSpanRefById(spanId: TraceSpanId): SpanRef | null;
  /** Returns a process-scoped span ref by process ref and external span id. */
  getProcessScopedSpanRef(processRef: ProcessRef, spanId: TraceSpanId): SpanRef | null;
};

/** Cross-process dependency Arrow table fields readable through generic table helpers. */
type CrossProcessDependencyTableFieldName =
  | 'dependencyId'
  | 'endpointId'
  | 'startRankNum'
  | 'endRankNum'
  | 'startSpanRef'
  | 'startSpanId'
  | 'endSpanRef'
  | 'endSpanId'
  | 'waitMode'
  | 'bidirectional'
  | 'topology'
  | 'waitTimeMs'
  | 'waiting'
  | 'waitNotFinished'
  | 'keywords'
  | 'hasParentKeyword'
  | 'userDataJson';

/** Returns the source span ref for one local or cross-process dependency ref without materializing it. */
export function getTraceGraphDependencyStartSpan(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef
): SpanRef | null {
  const startSpanId = getTraceGraphDependencyStartBlockId(graph, dependencyRef);
  const startSpanRef = getDependencySpanRefField(graph, dependencyRef, 'startSpanRef');
  if (
    startSpanRef != null &&
    dependencySpanRefMatchesEndpoint(graph, dependencyRef, startSpanRef, startSpanId, 'start')
  ) {
    return startSpanRef;
  }
  return startSpanId
    ? resolveDependencyEndpointSpanRef(graph, dependencyRef, startSpanId, 'start')
    : null;
}

/** Returns the destination span ref for one local or cross-process dependency ref without materializing it. */
export function getTraceGraphDependencyEndSpan(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef
): SpanRef | null {
  const endSpanId = getTraceGraphDependencyEndBlockId(graph, dependencyRef);
  const endSpanRef = getDependencySpanRefField(graph, dependencyRef, 'endSpanRef');
  if (
    endSpanRef != null &&
    dependencySpanRefMatchesEndpoint(graph, dependencyRef, endSpanRef, endSpanId, 'end')
  ) {
    return endSpanRef;
  }
  return endSpanId
    ? resolveDependencyEndpointSpanRef(graph, dependencyRef, endSpanId, 'end')
    : null;
}

/** Returns the stable dependency id for one local or cross-process dependency ref. */
export function getTraceGraphDependencyId(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef
): TraceDependencyId | null {
  const dependencyId = getDependencyStringField(
    graph,
    dependencyRef,
    'dependencyId'
  ) as TraceDependencyId | null;
  return (
    dependencyId ??
    (isSameProcessDependencyRef(dependencyRef)
      ? encodeSameProcessDependencyIdFromRef(dependencyRef)
      : null)
  );
}

/** Returns the source block id for one local or cross-process dependency ref. */
export function getTraceGraphDependencyStartBlockId(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef
): TraceSpanId | null {
  return getDependencyEndpointBlockId(graph, dependencyRef, 'startSpanRef', 'startSpanId');
}

/** Returns the destination block id for one local or cross-process dependency ref. */
export function getTraceGraphDependencyEndBlockId(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef
): TraceSpanId | null {
  return getDependencyEndpointBlockId(graph, dependencyRef, 'endSpanRef', 'endSpanId');
}

/** Returns the wait-mode field for one local or cross-process dependency ref. */
export function getTraceGraphDependencyWaitMode(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef
): TraceDependency['waitMode'] | null {
  if (isSameProcessDependencyRef(dependencyRef)) {
    const source = getSameProcessDependencyArrowRow(graph, dependencyRef);
    return decodeTraceDependencyWaitModeCode(
      source?.sameProcessDependencyTable.getChild('waitModeCode')?.get(source.rowIndex)
    );
  }
  const waitMode = getDependencyStringField(graph, dependencyRef, 'waitMode');
  return isTraceDependencyWaitMode(waitMode) ? waitMode : null;
}

/** Returns the bidirectional flag for one local or cross-process dependency ref. */
export function getTraceGraphDependencyBidirectional(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef
): boolean | null {
  return getDependencyBooleanField(graph, dependencyRef, 'bidirectional');
}

/** Returns the wait duration in milliseconds for one local or cross-process dependency ref. */
export function getTraceGraphDependencyWaitTimeMs(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef
): number | null {
  return getDependencyNumberField(graph, dependencyRef, 'waitTimeMs');
}

/** Returns whether one local or cross-process dependency row should route as a parent-child edge. */
export function getTraceGraphDependencyIsParent(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef
): boolean {
  if (isSameProcessDependencyRef(dependencyRef)) {
    const source = getSameProcessDependencyArrowRow(graph, dependencyRef);
    return traceDependencyKeywordFlagsHasParent(
      source?.sameProcessDependencyTable.getChild('keywordFlags')?.get(source.rowIndex)
    );
  }
  const hasParentKeyword = getDependencyBooleanField(graph, dependencyRef, 'hasParentKeyword');
  if (hasParentKeyword === true) {
    return true;
  }
  return isCrossProcessDependencyRef(dependencyRef)
    ? getTraceGraphCrossProcessDependencyTopology(graph, dependencyRef) === 'parent'
    : false;
}

/** Returns dependency keywords for one local or cross-process dependency ref. */
export function getTraceGraphDependencyKeywords(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef
): ReadonlySet<string> | null {
  if (isSameProcessDependencyRef(dependencyRef)) {
    const source = getSameProcessDependencyArrowRow(graph, dependencyRef);
    const keywords = source?.sameProcessDependencyTable.getChild('keywords')?.get(source.rowIndex);
    return keywords == null ? new Set() : new Set(Array.from(keywords as Iterable<string>));
  }
  if (isCrossProcessDependencyRef(dependencyRef)) {
    const keywords = getCrossProcessDependencyTableValue<unknown>(graph, dependencyRef, 'keywords');
    return keywords == null ? new Set() : new Set(Array.from(keywords as Iterable<string>));
  }
  return null;
}

/** Returns optional app-specific user data attached to one source dependency. */
export function getTraceGraphDependencyUserData(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef
): Record<string, unknown> | undefined {
  const userDataJson = isSameProcessDependencyRef(dependencyRef)
    ? (() => {
        const source = getSameProcessDependencyArrowRow(graph, dependencyRef);
        return source
          ? source.sameProcessDependencyTable.getChild('userDataJson')?.get(source.rowIndex)
          : undefined;
      })()
    : isCrossProcessDependencyRef(dependencyRef)
      ? getCrossProcessDependencyTableValue<unknown>(graph, dependencyRef, 'userDataJson')
      : undefined;
  const value =
    typeof userDataJson === 'string'
      ? deserializeArrowTraceJson<Record<string, unknown>>(userDataJson)
      : undefined;
  return isDependencyUserData(value) ? value : undefined;
}

/** Returns whether one local or cross-process dependency row has a keyword without building a Set. */
export function getTraceGraphDependencyHasKeyword(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef,
  keyword: string
): boolean {
  if (isSameProcessDependencyRef(dependencyRef)) {
    const source = getSameProcessDependencyArrowRow(graph, dependencyRef);
    const keywordFlags = source?.sameProcessDependencyTable
      .getChild('keywordFlags')
      ?.get(source.rowIndex);
    if (keyword === 'PARENT') {
      return traceDependencyKeywordFlagsHasParent(keywordFlags);
    }
    if (keyword === 'SUBMIT') {
      return traceDependencyKeywordFlagsHasSubmit(keywordFlags);
    }
    const keywords = source?.sameProcessDependencyTable.getChild('keywords')?.get(source.rowIndex);
    return dependencyKeywordListHas(keywords, keyword);
  }
  if (isCrossProcessDependencyRef(dependencyRef)) {
    const keywords = getCrossProcessDependencyTableValue<unknown>(graph, dependencyRef, 'keywords');
    return dependencyKeywordListHas(keywords, keyword);
  }
  return false;
}

/** Returns the endpoint id for one cross-process dependency ref without materializing an object. */
export function getTraceGraphCrossProcessDependencyEndpointId(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossProcessDependencyRef
): TraceCrossProcessDependency['endpointId'] | null {
  return getDependencyStringField(graph, dependencyRef, 'endpointId') as
    | TraceCrossProcessDependency['endpointId']
    | null;
}

/** Returns the source rank number for one cross-process dependency ref. */
export function getTraceGraphCrossProcessDependencyStartRankNum(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossProcessDependencyRef
): number | null {
  return getDependencyNumberField(graph, dependencyRef, 'startRankNum');
}

/** Returns the destination rank number for one cross-process dependency ref. */
export function getTraceGraphCrossProcessDependencyEndRankNum(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossProcessDependencyRef
): number | null {
  return getDependencyNumberField(graph, dependencyRef, 'endRankNum');
}

/** Returns the topology label for one cross-process dependency ref. */
export function getTraceGraphCrossProcessDependencyTopology(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossProcessDependencyRef
): string | null {
  return getDependencyStringField(graph, dependencyRef, 'topology');
}

/** Returns whether one cross-process dependency is still waiting. */
export function getTraceGraphCrossProcessDependencyWaiting(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossProcessDependencyRef
): boolean | null {
  return getDependencyBooleanField(graph, dependencyRef, 'waiting');
}

/** Returns whether one cross-process dependency is still unfinished. */
export function getTraceGraphCrossProcessDependencyWaitNotFinished(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossProcessDependencyRef
): boolean | null {
  return getDependencyBooleanField(graph, dependencyRef, 'waitNotFinished');
}

/** Resolves one same-process dependency ref to its process-local Arrow row. */
function getSameProcessDependencyArrowRow(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef
): {
  readonly sameProcessDependencyTable: Readonly<ArrowTraceSameProcessDependencyTable>;
  readonly processIndex: number;
  readonly rowIndex: number;
} | null {
  const processIndex = getSameProcessDependencyRefProcessIndex(dependencyRef);
  const rowIndex = getSameProcessDependencyRefRowIndex(dependencyRef);
  const processId = graph.processIdsByIndex[processIndex];
  const sameProcessDependencyTable = processId
    ? graph.sameProcessDependencyTableMap[processId]
    : null;
  if (!sameProcessDependencyTable || rowIndex >= sameProcessDependencyTable.numRows) {
    return null;
  }
  return {
    sameProcessDependencyTable,
    processIndex,
    rowIndex
  };
}

/** Reads one string-valued dependency field from local or cross-process dependency storage. */
function getDependencyStringField(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef,
  fieldName: 'dependencyId' | 'endpointId' | 'startSpanId' | 'endSpanId' | 'waitMode' | 'topology'
): string | null {
  if (isSameProcessDependencyRef(dependencyRef)) {
    if (fieldName === 'endpointId' || fieldName === 'topology') {
      return null;
    }
    const source = getSameProcessDependencyArrowRow(graph, dependencyRef);
    const value = source?.sameProcessDependencyTable.getChild(fieldName)?.get(source.rowIndex);
    return typeof value === 'string' ? value : null;
  }
  if (isCrossProcessDependencyRef(dependencyRef)) {
    const rowIndex = getCrossProcessDependencyRefIndex(dependencyRef);
    const value = graph.crossProcessDependencyTable.getChild(fieldName)?.get(rowIndex);
    return typeof value === 'string' ? value : null;
  }
  return null;
}

/** Resolves one dependency endpoint block id from stored ids first, then stored span refs. */
function getDependencyEndpointBlockId(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef,
  spanRefFieldName: 'startSpanRef' | 'endSpanRef',
  spanIdFieldName: 'startSpanId' | 'endSpanId'
): TraceSpanId | null {
  const spanId = getDependencyStringField(graph, dependencyRef, spanIdFieldName);
  if (spanId) {
    return spanId as TraceSpanId;
  }
  const spanRef = getDependencySpanRefField(graph, dependencyRef, spanRefFieldName);
  return spanRef == null ? null : graph.getSpanId(spanRef);
}

/** Reads one boolean-valued dependency field from local or cross-process dependency storage. */
function getDependencyBooleanField(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef,
  fieldName: 'bidirectional' | 'hasParentKeyword' | 'waiting' | 'waitNotFinished'
): boolean | null {
  if (isSameProcessDependencyRef(dependencyRef)) {
    if (fieldName === 'waiting' || fieldName === 'waitNotFinished') {
      return null;
    }
    const source = getSameProcessDependencyArrowRow(graph, dependencyRef);
    const value = source?.sameProcessDependencyTable.getChild(fieldName)?.get(source.rowIndex);
    return typeof value === 'boolean' ? value : null;
  }
  if (isCrossProcessDependencyRef(dependencyRef)) {
    const value = graph.crossProcessDependencyTable
      .getChild(fieldName)
      ?.get(getCrossProcessDependencyRefIndex(dependencyRef));
    return typeof value === 'boolean' ? value : null;
  }
  return null;
}

/** Reads one numeric dependency field from local or cross-process dependency storage. */
function getDependencyNumberField(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef,
  fieldName: 'waitTimeMs' | 'startRankNum' | 'endRankNum'
): number | null {
  if (isSameProcessDependencyRef(dependencyRef)) {
    if (fieldName === 'startRankNum' || fieldName === 'endRankNum') {
      return null;
    }
    const source = getSameProcessDependencyArrowRow(graph, dependencyRef);
    const value = source?.sameProcessDependencyTable.getChild(fieldName)?.get(source.rowIndex);
    return typeof value === 'number' ? value : null;
  }
  if (isCrossProcessDependencyRef(dependencyRef)) {
    const value = graph.crossProcessDependencyTable
      .getChild(fieldName)
      ?.get(getCrossProcessDependencyRefIndex(dependencyRef));
    return typeof value === 'number' ? value : null;
  }
  return null;
}

/** Reads one packed span-ref dependency field from local or cross-process dependency storage. */
function getDependencySpanRefField(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef,
  fieldName: 'startSpanRef' | 'endSpanRef'
): SpanRef | null {
  const value = isSameProcessDependencyRef(dependencyRef)
    ? (() => {
        const source = getSameProcessDependencyArrowRow(graph, dependencyRef);
        const column = source?.sameProcessDependencyTable.getChild(fieldName);
        return source && column && column.isValid(source.rowIndex)
          ? column.get(source.rowIndex)
          : null;
      })()
    : isCrossProcessDependencyRef(dependencyRef)
      ? (() => {
          const rowIndex = getCrossProcessDependencyRefIndex(dependencyRef);
          const column = graph.crossProcessDependencyTable.getChild(fieldName);
          return column && column.isValid(rowIndex) ? column.get(rowIndex) : null;
        })()
      : null;
  const spanRef =
    typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : null;
  return spanRef != null && Number.isSafeInteger(spanRef) && spanRef >= 0
    ? (spanRef as SpanRef)
    : null;
}

/** Returns whether a span ref matches the expected dependency endpoint id and process. */
function dependencySpanRefMatchesEndpoint(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef,
  spanRef: SpanRef,
  spanId: TraceSpanId | null,
  endpoint: 'start' | 'end'
): boolean {
  const resolvedSpanId = graph.getSpanId(spanRef);
  if (!resolvedSpanId || (spanId != null && resolvedSpanId !== spanId)) {
    return false;
  }

  const expectedProcessRef = getDependencyEndpointProcessRef(graph, dependencyRef, endpoint);
  return expectedProcessRef == null || graph.getProcessRefBySpanRef(spanRef) === expectedProcessRef;
}

/** Resolves a dependency endpoint id to the best process-scoped runtime span ref. */
function resolveDependencyEndpointSpanRef(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef,
  spanId: TraceSpanId,
  endpoint: 'start' | 'end'
): SpanRef | null {
  const processRef = getDependencyEndpointProcessRef(graph, dependencyRef, endpoint);
  const currentSpanRef = graph.getSpanRefById(spanId);
  if (
    currentSpanRef != null &&
    (processRef == null || graph.getProcessRefBySpanRef(currentSpanRef) === processRef)
  ) {
    return currentSpanRef;
  }

  const processScopedSpanRef = processRef
    ? graph.getProcessScopedSpanRef(processRef, spanId)
    : null;
  if (
    processScopedSpanRef != null &&
    dependencySpanRefMatchesEndpoint(graph, dependencyRef, processScopedSpanRef, spanId, endpoint)
  ) {
    return processScopedSpanRef;
  }

  return currentSpanRef;
}

/** Resolves the owning process ref expected for one dependency endpoint. */
function getDependencyEndpointProcessRef(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: SameProcessDependencyRef | CrossProcessDependencyRef,
  endpoint: 'start' | 'end'
): ProcessRef | null {
  if (isSameProcessDependencyRef(dependencyRef)) {
    const source = getSameProcessDependencyArrowRow(graph, dependencyRef);
    return source ? (graph.getProcessRefs()[source.processIndex] ?? null) : null;
  }
  if (isCrossProcessDependencyRef(dependencyRef)) {
    const rankNum =
      endpoint === 'start'
        ? getTraceGraphCrossProcessDependencyStartRankNum(graph, dependencyRef)
        : getTraceGraphCrossProcessDependencyEndRankNum(graph, dependencyRef);
    return rankNum == null ? null : getProcessRefByRankNumFromSource(graph, rankNum);
  }
  return null;
}

/** Resolves a process ref from source process metadata by rank number. */
function getProcessRefByRankNumFromSource(
  graph: TraceGraphDependencyAccessorSource,
  rankNum: number
): ProcessRef | null {
  const processIndex = graph.processes.findIndex(process => process.rankNum === rankNum);
  return processIndex >= 0 ? (graph.getProcessRefs()[processIndex] ?? null) : null;
}

/** Reads one typed field value from the graph-global cross-process-dependency table. */
function getCrossProcessDependencyTableValue<ValueT>(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossProcessDependencyRef,
  fieldName: CrossProcessDependencyTableFieldName
): ValueT | null {
  if (!isCrossProcessDependencyRef(dependencyRef)) {
    return null;
  }
  const rowIndex = getCrossProcessDependencyRefIndex(dependencyRef);
  if (rowIndex < 0 || rowIndex >= graph.crossProcessDependencyTable.numRows) {
    return null;
  }
  return (
    (graph.crossProcessDependencyTable.getChild(fieldName)?.get(rowIndex) as ValueT | null) ?? null
  );
}

/** Builds one unfiltered same-process dependency source directly from its Arrow source ref. */
export function buildTraceGraphUnfilteredSameProcessDependencySourceByRef(
  graph: TraceGraphUnfilteredSameProcessDependencySource,
  dependencyRef: SameProcessDependencyRef
): TraceSameProcessDependencySource | null {
  const dependencyId = graph.getDependencyId(dependencyRef);
  const startSpanId = graph.getDependencyStartBlockId(dependencyRef);
  const endSpanId = graph.getDependencyEndBlockId(dependencyRef);
  const waitMode = graph.getDependencyWaitMode(dependencyRef);
  if (!dependencyId || !startSpanId || !endSpanId || !waitMode) {
    return null;
  }

  return {
    type: 'trace-same-process-dependency',
    dependencyRef,
    dependencyId,
    startSpanId,
    endSpanId,
    startSpanRef: graph.getDependencyStartSpan(dependencyRef) ?? undefined,
    endSpanRef: graph.getDependencyEndSpan(dependencyRef) ?? undefined,
    waitMode,
    bidirectional: graph.getDependencyBidirectional(dependencyRef) ?? false,
    waitTimeMs: graph.getDependencyWaitTimeMs(dependencyRef) ?? 0,
    keywords: graph.getDependencyKeywords(dependencyRef) ?? new Set(),
    userData: graph.getDependencyUserData(dependencyRef)
  } satisfies TraceSameProcessDependencySource;
}

/** Minimal graph surface for materializing one unfiltered same-process dependency source. */
type TraceGraphUnfilteredSameProcessDependencySource = TraceGraphDependencyAccessorSource & {
  /** Returns the stable dependency id for one same-process dependency ref. */
  getDependencyId(dependencyRef: SameProcessDependencyRef): TraceDependencyId | null;
  /** Returns the source block id for one same-process dependency ref. */
  getDependencyStartBlockId(dependencyRef: SameProcessDependencyRef): TraceSpanId | null;
  /** Returns the destination block id for one same-process dependency ref. */
  getDependencyEndBlockId(dependencyRef: SameProcessDependencyRef): TraceSpanId | null;
  /** Returns the wait mode for one same-process dependency ref. */
  getDependencyWaitMode(
    dependencyRef: SameProcessDependencyRef
  ): TraceDependency['waitMode'] | null;
  /** Returns the source span ref for one same-process dependency ref. */
  getDependencyStartSpan(dependencyRef: SameProcessDependencyRef): SpanRef | null;
  /** Returns the destination span ref for one same-process dependency ref. */
  getDependencyEndSpan(dependencyRef: SameProcessDependencyRef): SpanRef | null;
  /** Returns the bidirectional flag for one same-process dependency ref. */
  getDependencyBidirectional(dependencyRef: SameProcessDependencyRef): boolean | null;
  /** Returns the wait duration for one same-process dependency ref. */
  getDependencyWaitTimeMs(dependencyRef: SameProcessDependencyRef): number | null;
  /** Returns keyword labels for one same-process dependency ref. */
  getDependencyKeywords(dependencyRef: SameProcessDependencyRef): ReadonlySet<string> | null;
  /** Returns optional app-specific dependency user data. */
  getDependencyUserData(
    dependencyRef: SameProcessDependencyRef
  ): Record<string, unknown> | undefined;
};
