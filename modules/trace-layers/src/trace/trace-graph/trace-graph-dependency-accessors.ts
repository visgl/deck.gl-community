import {
  dependencyKeywordListHas,
  isDependencyUserData,
  isTraceDependencyWaitMode,
  normalizeArrowRefNumber
} from './trace-graph-runtime-helpers';
import {
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  getCrossDependencyRefIndex,
  getLocalDependencyRefProcessIndex,
  getVisibleLocalDependencyRefIndex,
  isCrossDependencyRef,
  isLocalDependencyRef
} from './trace-id-encoder';

import type {
  ArrowTraceCrossDependencyTable,
  ArrowTraceLocalDependencyTable,
  ArrowTraceProcessMetadata
} from '../ingestion/arrow-trace';
import type {TraceLocalDependencySource} from '../trace-graph-accessors';
import type {TraceGraphVisibleDependencyOverride} from './trace-graph-types';
import type {
  CrossDependencyRef,
  DecodedTraceRef,
  LocalDependencyRef,
  ProcessRef,
  TraceDependencyRef,
  VisibleDependencyRef,
  VisibleLocalDependencyRef
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
  readonly localDependencyTableMap: Readonly<
    Record<TraceProcessId, ArrowTraceLocalDependencyTable>
  >;
  /** Graph-global Arrow cross-process dependency table. */
  readonly crossDependencyTable: Readonly<ArrowTraceCrossDependencyTable>;
  /** Optional row-aligned compatibility payloads keyed by process id. */
  readonly crossDependencies: Readonly<TraceCrossProcessDependency[]>;
  /** Canonical process ids indexed by packed process index. */
  readonly processIdsByIndex: ReadonlyArray<TraceProcessId>;
  /** Decodes one packed runtime ref. */
  decodeRef(ref: number): DecodedTraceRef | null;
  /** Returns canonical process refs in graph order. */
  getProcessRefs(): ReadonlyArray<ProcessRef>;
  /** Returns the external span id for one span ref. */
  getSpanBlockId(spanRef: SpanRef): TraceSpanId | null;
  /** Returns the owning process ref for one span ref. */
  getProcessRefBySpanRef(spanRef: SpanRef): ProcessRef | null;
  /** Returns a span ref by external span id. */
  getSpanRefByExternalBlockId(spanId: TraceSpanId): SpanRef | null;
  /** Returns a process-scoped span ref by process ref and external span id. */
  getProcessScopedSpanRef(processRef: ProcessRef, spanId: TraceSpanId): SpanRef | null;
};

/** Minimal graph surface used for visible dependency access without materializing objects. */
type TraceGraphVisibleDependencyAccessorSource = TraceGraphDependencyAccessorSource & {
  /** Returns the source block id for one dependency ref. */
  getDependencyStartBlockId(
    dependencyRef: LocalDependencyRef | CrossDependencyRef
  ): TraceSpanId | null;
  /** Returns the destination block id for one dependency ref. */
  getDependencyEndBlockId(
    dependencyRef: LocalDependencyRef | CrossDependencyRef
  ): TraceSpanId | null;
  /** Returns the source span ref for one dependency ref. */
  getDependencyStartSpan(dependencyRef: LocalDependencyRef | CrossDependencyRef): SpanRef | null;
  /** Returns the destination span ref for one dependency ref. */
  getDependencyEndSpan(dependencyRef: LocalDependencyRef | CrossDependencyRef): SpanRef | null;
  /** Returns the wait-mode field for one dependency ref. */
  getDependencyWaitMode(
    dependencyRef: LocalDependencyRef | CrossDependencyRef
  ): TraceDependency['waitMode'] | null;
  /** Returns the bidirectional flag for one dependency ref. */
  getDependencyBidirectional(
    dependencyRef: LocalDependencyRef | CrossDependencyRef
  ): boolean | null;
  /** Returns the wait duration for one dependency ref. */
  getDependencyWaitTimeMs(dependencyRef: LocalDependencyRef | CrossDependencyRef): number | null;
  /** Returns keywords for one dependency ref. */
  getDependencyKeywords(
    dependencyRef: LocalDependencyRef | CrossDependencyRef
  ): ReadonlySet<string> | null;
  /** Returns whether one dependency ref has a keyword. */
  getDependencyHasKeyword(
    dependencyRef: LocalDependencyRef | CrossDependencyRef,
    keyword: string
  ): boolean;
};

/** Resolver that maps visible dependency refs back to canonical source dependency refs. */
type GetVisibleDependencySourceRefByRef = (
  dependencyRef: TraceDependencyRef | VisibleDependencyRef
) => LocalDependencyRef | CrossDependencyRef | null;

/** Resolver that returns synthetic visible dependency endpoint or parent metadata. */
type GetVisibleDependencyOverrideSpec = (
  dependencyRef: TraceDependencyRef | VisibleDependencyRef
) => TraceGraphVisibleDependencyOverride | null;

/** Visible dependency override variants that provide rewritten endpoint span refs. */
type TraceGraphVisibleDependencyEndpointOverride = Extract<
  TraceGraphVisibleDependencyOverride,
  {kind: 'local-rewrite' | 'local-parent' | 'cross-parent'}
>;

/** Visible dependency override variants that also provide dependency metadata fields. */
type TraceGraphVisibleDependencyParentOverride = Extract<
  TraceGraphVisibleDependencyOverride,
  {kind: 'local-parent' | 'cross-parent'}
>;

/** Cross-dependency Arrow table fields readable through generic table helpers. */
type CrossDependencyTableFieldName =
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
  | 'hasParentKeyword';

/** Returns the source span ref for one local or cross dependency ref without materializing it. */
export function getTraceGraphDependencyStartSpan(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef
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

/** Returns the destination span ref for one local or cross dependency ref without materializing it. */
export function getTraceGraphDependencyEndSpan(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef
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

/** Returns the stable dependency id for one local or cross dependency ref. */
export function getTraceGraphDependencyId(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef
): TraceDependencyId | null {
  return getDependencyStringField(graph, dependencyRef, 'dependencyId') as TraceDependencyId | null;
}

/** Returns the source block id for one local or cross dependency ref. */
export function getTraceGraphDependencyStartBlockId(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef
): TraceSpanId | null {
  return getDependencyStringField(graph, dependencyRef, 'startSpanId') as TraceSpanId | null;
}

/** Returns the destination block id for one local or cross dependency ref. */
export function getTraceGraphDependencyEndBlockId(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef
): TraceSpanId | null {
  return getDependencyStringField(graph, dependencyRef, 'endSpanId') as TraceSpanId | null;
}

/** Returns the wait-mode field for one local or cross dependency ref. */
export function getTraceGraphDependencyWaitMode(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef
): TraceDependency['waitMode'] | null {
  const waitMode = getDependencyStringField(graph, dependencyRef, 'waitMode');
  return isTraceDependencyWaitMode(waitMode) ? waitMode : null;
}

/** Returns the bidirectional flag for one local or cross dependency ref. */
export function getTraceGraphDependencyBidirectional(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef
): boolean | null {
  return getDependencyBooleanField(graph, dependencyRef, 'bidirectional');
}

/** Returns the wait duration in milliseconds for one local or cross dependency ref. */
export function getTraceGraphDependencyWaitTimeMs(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef
): number | null {
  return getDependencyNumberField(graph, dependencyRef, 'waitTimeMs');
}

/** Returns dependency keywords for one local or cross dependency ref. */
export function getTraceGraphDependencyKeywords(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef
): ReadonlySet<string> | null {
  if (isLocalDependencyRef(dependencyRef)) {
    const source = getLocalDependencyArrowRow(graph, dependencyRef);
    const keywords = source?.localDependencyTable.getChild('keywords')?.get(source.rowIndex);
    return keywords == null ? new Set() : new Set(Array.from(keywords as Iterable<string>));
  }
  if (isCrossDependencyRef(dependencyRef)) {
    const keywords = getCrossDependencyTableValue<unknown>(graph, dependencyRef, 'keywords');
    return keywords == null ? new Set() : new Set(Array.from(keywords as Iterable<string>));
  }
  return null;
}

/** Returns optional app-specific user data attached to one source dependency. */
export function getTraceGraphDependencyUserData(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef
): Record<string, unknown> | undefined {
  const value = isLocalDependencyRef(dependencyRef)
    ? (() => {
        const source = getLocalDependencyArrowRow(graph, dependencyRef);
        return source
          ? graph.processes[source.processIndex]?.localDependencies?.[source.rowIndex]?.userData
          : undefined;
      })()
    : isCrossDependencyRef(dependencyRef)
      ? graph.crossDependencies[getCrossDependencyRefIndex(dependencyRef)]?.userData
      : undefined;
  return isDependencyUserData(value) ? value : undefined;
}

/** Returns whether one local or cross dependency row has a keyword without building a Set. */
export function getTraceGraphDependencyHasKeyword(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef,
  keyword: string
): boolean {
  if (isLocalDependencyRef(dependencyRef)) {
    const source = getLocalDependencyArrowRow(graph, dependencyRef);
    const keywords = source?.localDependencyTable.getChild('keywords')?.get(source.rowIndex);
    return dependencyKeywordListHas(keywords, keyword);
  }
  if (isCrossDependencyRef(dependencyRef)) {
    const keywords = getCrossDependencyTableValue<unknown>(graph, dependencyRef, 'keywords');
    return dependencyKeywordListHas(keywords, keyword);
  }
  return false;
}

/** Returns the endpoint id for one cross dependency ref without materializing an object. */
export function getTraceGraphCrossDependencyEndpointId(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossDependencyRef
): TraceCrossProcessDependency['endpointId'] | null {
  return getDependencyStringField(graph, dependencyRef, 'endpointId') as
    | TraceCrossProcessDependency['endpointId']
    | null;
}

/** Returns the source rank number for one cross dependency ref. */
export function getTraceGraphCrossDependencyStartRankNum(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossDependencyRef
): number | null {
  return getDependencyNumberField(graph, dependencyRef, 'startRankNum');
}

/** Returns the destination rank number for one cross dependency ref. */
export function getTraceGraphCrossDependencyEndRankNum(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossDependencyRef
): number | null {
  return getDependencyNumberField(graph, dependencyRef, 'endRankNum');
}

/** Returns the topology label for one cross dependency ref. */
export function getTraceGraphCrossDependencyTopology(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossDependencyRef
): string | null {
  return getDependencyStringField(graph, dependencyRef, 'topology');
}

/** Returns whether one cross dependency is still waiting. */
export function getTraceGraphCrossDependencyWaiting(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossDependencyRef
): boolean | null {
  return getDependencyBooleanField(graph, dependencyRef, 'waiting');
}

/** Returns whether one cross dependency is still unfinished. */
export function getTraceGraphCrossDependencyWaitNotFinished(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossDependencyRef
): boolean | null {
  return getDependencyBooleanField(graph, dependencyRef, 'waitNotFinished');
}

/** Resolves one local dependency ref to its process-local Arrow row. */
function getLocalDependencyArrowRow(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef
): {
  readonly localDependencyTable: Readonly<ArrowTraceLocalDependencyTable>;
  readonly processIndex: number;
  readonly rowIndex: number;
} | null {
  const decodedRef = graph.decodeRef(dependencyRef);
  if (decodedRef?.kind !== 'localDependency') {
    return null;
  }
  const processId = graph.processIdsByIndex[decodedRef.chunkIndex];
  const localDependencyTable = processId ? graph.localDependencyTableMap[processId] : null;
  if (!localDependencyTable || decodedRef.rowIndex >= localDependencyTable.numRows) {
    return null;
  }
  return {
    localDependencyTable,
    processIndex: decodedRef.chunkIndex,
    rowIndex: decodedRef.rowIndex
  };
}

/** Reads one string-valued dependency field from local or cross dependency storage. */
function getDependencyStringField(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef,
  fieldName: 'dependencyId' | 'endpointId' | 'startSpanId' | 'endSpanId' | 'waitMode' | 'topology'
): string | null {
  if (isLocalDependencyRef(dependencyRef)) {
    if (fieldName === 'endpointId' || fieldName === 'topology') {
      return null;
    }
    const source = getLocalDependencyArrowRow(graph, dependencyRef);
    const value = source?.localDependencyTable.getChild(fieldName)?.get(source.rowIndex);
    return typeof value === 'string' ? value : null;
  }
  if (isCrossDependencyRef(dependencyRef)) {
    const rowIndex = getCrossDependencyRefIndex(dependencyRef);
    const value = graph.crossDependencyTable.getChild(fieldName)?.get(rowIndex);
    return typeof value === 'string' ? value : null;
  }
  return null;
}

/** Reads one boolean-valued dependency field from local or cross dependency storage. */
function getDependencyBooleanField(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef,
  fieldName: 'bidirectional' | 'waiting' | 'waitNotFinished'
): boolean | null {
  if (isLocalDependencyRef(dependencyRef)) {
    if (fieldName === 'waiting' || fieldName === 'waitNotFinished') {
      return null;
    }
    const source = getLocalDependencyArrowRow(graph, dependencyRef);
    const value = source?.localDependencyTable.getChild(fieldName)?.get(source.rowIndex);
    return typeof value === 'boolean' ? value : null;
  }
  if (isCrossDependencyRef(dependencyRef)) {
    const value = graph.crossDependencyTable
      .getChild(fieldName)
      ?.get(getCrossDependencyRefIndex(dependencyRef));
    return typeof value === 'boolean' ? value : null;
  }
  return null;
}

/** Reads one numeric dependency field from local or cross dependency storage. */
function getDependencyNumberField(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef,
  fieldName: 'waitTimeMs' | 'startRankNum' | 'endRankNum'
): number | null {
  if (isLocalDependencyRef(dependencyRef)) {
    if (fieldName === 'startRankNum' || fieldName === 'endRankNum') {
      return null;
    }
    const source = getLocalDependencyArrowRow(graph, dependencyRef);
    const value = source?.localDependencyTable.getChild(fieldName)?.get(source.rowIndex);
    return typeof value === 'number' ? value : null;
  }
  if (isCrossDependencyRef(dependencyRef)) {
    const value = graph.crossDependencyTable
      .getChild(fieldName)
      ?.get(getCrossDependencyRefIndex(dependencyRef));
    return typeof value === 'number' ? value : null;
  }
  return null;
}

/** Reads one packed span-ref dependency field from local or cross dependency storage. */
function getDependencySpanRefField(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef,
  fieldName: 'startSpanRef' | 'endSpanRef'
): SpanRef | null {
  const value = isLocalDependencyRef(dependencyRef)
    ? (() => {
        const source = getLocalDependencyArrowRow(graph, dependencyRef);
        const column = source?.localDependencyTable.getChild(fieldName);
        return source && column && column.isValid(source.rowIndex)
          ? column.get(source.rowIndex)
          : null;
      })()
    : isCrossDependencyRef(dependencyRef)
      ? (() => {
          const rowIndex = getCrossDependencyRefIndex(dependencyRef);
          const column = graph.crossDependencyTable.getChild(fieldName);
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
  dependencyRef: LocalDependencyRef | CrossDependencyRef,
  spanRef: SpanRef,
  spanId: TraceSpanId | null,
  endpoint: 'start' | 'end'
): boolean {
  if (!spanId || graph.getSpanBlockId(spanRef) !== spanId) {
    return false;
  }

  const expectedProcessRef = getDependencyEndpointProcessRef(graph, dependencyRef, endpoint);
  return expectedProcessRef == null || graph.getProcessRefBySpanRef(spanRef) === expectedProcessRef;
}

/** Resolves a dependency endpoint id to the best process-scoped runtime span ref. */
function resolveDependencyEndpointSpanRef(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: LocalDependencyRef | CrossDependencyRef,
  spanId: TraceSpanId,
  endpoint: 'start' | 'end'
): SpanRef | null {
  const processRef = getDependencyEndpointProcessRef(graph, dependencyRef, endpoint);
  const currentSpanRef = graph.getSpanRefByExternalBlockId(spanId);
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
  dependencyRef: LocalDependencyRef | CrossDependencyRef,
  endpoint: 'start' | 'end'
): ProcessRef | null {
  if (isLocalDependencyRef(dependencyRef)) {
    const source = getLocalDependencyArrowRow(graph, dependencyRef);
    return source ? (graph.getProcessRefs()[source.processIndex] ?? null) : null;
  }
  if (isCrossDependencyRef(dependencyRef)) {
    const rankNum =
      endpoint === 'start'
        ? getTraceGraphCrossDependencyStartRankNum(graph, dependencyRef)
        : getTraceGraphCrossDependencyEndRankNum(graph, dependencyRef);
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

/** Reads one typed field value from the graph-global cross-dependency table. */
function getCrossDependencyTableValue<ValueT>(
  graph: TraceGraphDependencyAccessorSource,
  dependencyRef: CrossDependencyRef,
  fieldName: CrossDependencyTableFieldName
): ValueT | null {
  if (!isCrossDependencyRef(dependencyRef)) {
    return null;
  }
  const rowIndex = getCrossDependencyRefIndex(dependencyRef);
  if (rowIndex < 0 || rowIndex >= graph.crossDependencyTable.numRows) {
    return null;
  }
  return (graph.crossDependencyTable.getChild(fieldName)?.get(rowIndex) as ValueT | null) ?? null;
}

/** Returns the visible source block id for one dependency ref without materializing it. */
export function getTraceGraphVisibleDependencyStartBlockId(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  getSourceRefByRef: GetVisibleDependencySourceRefByRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): TraceSpanId | null {
  return getVisibleDependencyEndpointBlockId(
    graph,
    dependencyRef,
    'start',
    getSourceRefByRef,
    getOverrideSpec
  );
}

/** Returns the visible destination block id for one dependency ref without materializing it. */
export function getTraceGraphVisibleDependencyEndBlockId(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  getSourceRefByRef: GetVisibleDependencySourceRefByRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): TraceSpanId | null {
  return getVisibleDependencyEndpointBlockId(
    graph,
    dependencyRef,
    'end',
    getSourceRefByRef,
    getOverrideSpec
  );
}

/** Returns the visible source span ref for one dependency ref without materializing it. */
export function getTraceGraphVisibleDependencyStartSpan(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  getSourceRefByRef: GetVisibleDependencySourceRefByRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): SpanRef | null {
  return getVisibleDependencyEndpointSpan(
    graph,
    dependencyRef,
    'start',
    getSourceRefByRef,
    getOverrideSpec
  );
}

/** Returns the visible destination span ref for one dependency ref without materializing it. */
export function getTraceGraphVisibleDependencyEndSpan(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  getSourceRefByRef: GetVisibleDependencySourceRefByRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): SpanRef | null {
  return getVisibleDependencyEndpointSpan(
    graph,
    dependencyRef,
    'end',
    getSourceRefByRef,
    getOverrideSpec
  );
}

/** Returns the wait-mode field for one visible dependency ref without materializing it. */
export function getTraceGraphVisibleDependencyWaitMode(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  getSourceRefByRef: GetVisibleDependencySourceRefByRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): TraceDependency['waitMode'] | null {
  return getVisibleDependencyScalarField(
    graph,
    dependencyRef,
    'waitMode',
    getSourceRefByRef,
    getOverrideSpec
  ) as TraceDependency['waitMode'] | null;
}

/** Returns the bidirectional field for one visible dependency ref without materializing it. */
export function getTraceGraphVisibleDependencyBidirectional(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  getSourceRefByRef: GetVisibleDependencySourceRefByRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): boolean | null {
  return getVisibleDependencyScalarField(
    graph,
    dependencyRef,
    'bidirectional',
    getSourceRefByRef,
    getOverrideSpec
  ) as boolean | null;
}

/** Returns the wait duration for one visible dependency ref without materializing it. */
export function getTraceGraphVisibleDependencyWaitTimeMs(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  getSourceRefByRef: GetVisibleDependencySourceRefByRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): number | null {
  return getVisibleDependencyScalarField(
    graph,
    dependencyRef,
    'waitTimeMs',
    getSourceRefByRef,
    getOverrideSpec
  ) as number | null;
}

/** Returns keyword labels for one visible dependency ref without materializing it. */
export function getTraceGraphVisibleDependencyKeywords(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  getSourceRefByRef: GetVisibleDependencySourceRefByRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): ReadonlySet<string> {
  const sourceRef = getDirectOrVisibleDependencySourceRef(graph, dependencyRef, getSourceRefByRef);
  if (sourceRef) {
    return graph.getDependencyKeywords(sourceRef) ?? new Set();
  }
  const override = getVisibleDependencyParentOverride(graph, dependencyRef, getOverrideSpec);
  return override ? new Set(override.keywords) : new Set();
}

/** Returns whether one visible dependency has a keyword without materializing it. */
export function getTraceGraphVisibleDependencyHasKeyword(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  keyword: string,
  getSourceRefByRef: GetVisibleDependencySourceRefByRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): boolean {
  const sourceRef = getDirectOrVisibleDependencySourceRef(graph, dependencyRef, getSourceRefByRef);
  if (sourceRef) {
    return graph.getDependencyHasKeyword(sourceRef, keyword);
  }
  const override = getVisibleDependencyParentOverride(graph, dependencyRef, getOverrideSpec);
  return override ? override.keywords.some(candidate => candidate === keyword) : false;
}

/** Resolves a direct or visible dependency ref to the canonical source dependency ref. */
function getDirectOrVisibleDependencySourceRef(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  getSourceRefByRef: GetVisibleDependencySourceRefByRef
): LocalDependencyRef | CrossDependencyRef | null {
  return isLocalDependencyRef(dependencyRef) || isCrossDependencyRef(dependencyRef)
    ? dependencyRef
    : getSourceRefByRef.call(graph, dependencyRef);
}

/** Resolves one visible dependency endpoint to its external block id. */
function getVisibleDependencyEndpointBlockId(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  endpoint: 'start' | 'end',
  getSourceRefByRef: GetVisibleDependencySourceRefByRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): TraceSpanId | null {
  if (isLocalDependencyRef(dependencyRef) || isCrossDependencyRef(dependencyRef)) {
    return endpoint === 'start'
      ? graph.getDependencyStartBlockId(dependencyRef)
      : graph.getDependencyEndBlockId(dependencyRef);
  }
  const override = getVisibleDependencyEndpointOverride(graph, dependencyRef, getOverrideSpec);
  if (override) {
    return graph.getSpanBlockId(endpoint === 'start' ? override.startSpanRef : override.endSpanRef);
  }
  const sourceRef = getSourceRefByRef.call(graph, dependencyRef);
  if (!sourceRef) {
    return null;
  }
  return endpoint === 'start'
    ? graph.getDependencyStartBlockId(sourceRef)
    : graph.getDependencyEndBlockId(sourceRef);
}

/** Resolves one visible dependency endpoint to its runtime span ref. */
function getVisibleDependencyEndpointSpan(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  endpoint: 'start' | 'end',
  getSourceRefByRef: GetVisibleDependencySourceRefByRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): SpanRef | null {
  if (isLocalDependencyRef(dependencyRef) || isCrossDependencyRef(dependencyRef)) {
    return endpoint === 'start'
      ? graph.getDependencyStartSpan(dependencyRef)
      : graph.getDependencyEndSpan(dependencyRef);
  }
  const override = getVisibleDependencyEndpointOverride(graph, dependencyRef, getOverrideSpec);
  if (override) {
    return endpoint === 'start' ? override.startSpanRef : override.endSpanRef;
  }
  const sourceRef = getSourceRefByRef.call(graph, dependencyRef);
  if (sourceRef) {
    return endpoint === 'start'
      ? graph.getDependencyStartSpan(sourceRef)
      : graph.getDependencyEndSpan(sourceRef);
  }
  const spanId = getVisibleDependencyEndpointBlockId(
    graph,
    dependencyRef,
    endpoint,
    getSourceRefByRef,
    getOverrideSpec
  );
  return spanId ? graph.getSpanRefByExternalBlockId(spanId) : null;
}

/** Reads one scalar field from a visible dependency source or parent override. */
function getVisibleDependencyScalarField(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  fieldName: 'waitMode' | 'bidirectional' | 'waitTimeMs',
  getSourceRefByRef: GetVisibleDependencySourceRefByRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): TraceDependency['waitMode'] | boolean | number | null {
  const sourceRef = getDirectOrVisibleDependencySourceRef(graph, dependencyRef, getSourceRefByRef);
  if (sourceRef) {
    if (fieldName === 'waitMode') {
      return graph.getDependencyWaitMode(sourceRef);
    }
    if (fieldName === 'bidirectional') {
      return graph.getDependencyBidirectional(sourceRef);
    }
    return graph.getDependencyWaitTimeMs(sourceRef);
  }
  const override = getVisibleDependencyParentOverride(graph, dependencyRef, getOverrideSpec);
  if (!override) {
    return null;
  }
  if (fieldName === 'waitMode') {
    return override.waitMode;
  }
  if (fieldName === 'bidirectional') {
    return override.bidirectional;
  }
  return override.waitTimeMs;
}

/** Returns a visible-dependency override that rewrites endpoint span refs. */
function getVisibleDependencyEndpointOverride(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): TraceGraphVisibleDependencyEndpointOverride | null {
  const override = getOverrideSpec.call(graph, dependencyRef);
  return override?.kind === 'local-rewrite' ||
    override?.kind === 'local-parent' ||
    override?.kind === 'cross-parent'
    ? override
    : null;
}

/** Returns a visible-dependency parent override that carries dependency metadata. */
function getVisibleDependencyParentOverride(
  graph: TraceGraphVisibleDependencyAccessorSource,
  dependencyRef: TraceDependencyRef | VisibleDependencyRef,
  getOverrideSpec: GetVisibleDependencyOverrideSpec
): TraceGraphVisibleDependencyParentOverride | null {
  const override = getOverrideSpec.call(graph, dependencyRef);
  return override?.kind === 'local-parent' || override?.kind === 'cross-parent' ? override : null;
}

/** Maps an unfiltered visible local dependency ref to its canonical Arrow source ref. */
export function getTraceGraphUnfilteredVisibleLocalDependencySourceRefByRef(
  graph: TraceGraphDependencyAccessorSource,
  startIndexByProcessId: ReadonlyMap<TraceProcessId, number>,
  dependencyRef: VisibleLocalDependencyRef
): LocalDependencyRef | null {
  const visibleDependencyIndex = getVisibleLocalDependencyRefIndex(dependencyRef);
  for (const [processIndex, processId] of graph.processIdsByIndex.entries()) {
    const startIndex = startIndexByProcessId.get(processId);
    const table = graph.localDependencyTableMap[processId];
    const rowCount = table?.numRows ?? 0;
    if (startIndex == null || visibleDependencyIndex < startIndex) {
      continue;
    }

    const rowIndex = visibleDependencyIndex - startIndex;
    if (rowIndex >= 0 && rowIndex < rowCount) {
      const dependencyRefColumn = table?.getChild('dependencyRef');
      const tableDependencyRef = normalizeArrowRefNumber(dependencyRefColumn?.get(rowIndex));
      return tableDependencyRef == null ||
        getLocalDependencyRefProcessIndex(tableDependencyRef as LocalDependencyRef) !== processIndex
        ? encodeLocalDependencyRef(encodeLocalSpanRef(processIndex, rowIndex))
        : (tableDependencyRef as LocalDependencyRef);
    }
  }
  return null;
}

/** Builds one unfiltered local dependency source directly from its Arrow source ref. */
export function buildTraceGraphUnfilteredLocalDependencySourceByRef(
  graph: TraceGraphUnfilteredLocalDependencySource,
  dependencyRef: LocalDependencyRef
): TraceLocalDependencySource | null {
  const dependencyId = graph.getDependencyId(dependencyRef);
  const startSpanId = graph.getDependencyStartBlockId(dependencyRef);
  const endSpanId = graph.getDependencyEndBlockId(dependencyRef);
  const waitMode = graph.getDependencyWaitMode(dependencyRef);
  if (!dependencyId || !startSpanId || !endSpanId || !waitMode) {
    return null;
  }

  return {
    type: 'trace-local-dependency',
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
  } satisfies TraceLocalDependencySource;
}

/** Minimal graph surface for materializing one unfiltered local dependency source. */
type TraceGraphUnfilteredLocalDependencySource = TraceGraphDependencyAccessorSource & {
  /** Returns the stable dependency id for one local dependency ref. */
  getDependencyId(dependencyRef: LocalDependencyRef): TraceDependencyId | null;
  /** Returns the source block id for one local dependency ref. */
  getDependencyStartBlockId(dependencyRef: LocalDependencyRef): TraceSpanId | null;
  /** Returns the destination block id for one local dependency ref. */
  getDependencyEndBlockId(dependencyRef: LocalDependencyRef): TraceSpanId | null;
  /** Returns the wait mode for one local dependency ref. */
  getDependencyWaitMode(dependencyRef: LocalDependencyRef): TraceDependency['waitMode'] | null;
  /** Returns the source span ref for one local dependency ref. */
  getDependencyStartSpan(dependencyRef: LocalDependencyRef): SpanRef | null;
  /** Returns the destination span ref for one local dependency ref. */
  getDependencyEndSpan(dependencyRef: LocalDependencyRef): SpanRef | null;
  /** Returns the bidirectional flag for one local dependency ref. */
  getDependencyBidirectional(dependencyRef: LocalDependencyRef): boolean | null;
  /** Returns the wait duration for one local dependency ref. */
  getDependencyWaitTimeMs(dependencyRef: LocalDependencyRef): number | null;
  /** Returns keyword labels for one local dependency ref. */
  getDependencyKeywords(dependencyRef: LocalDependencyRef): ReadonlySet<string> | null;
  /** Returns optional app-specific dependency user data. */
  getDependencyUserData(dependencyRef: LocalDependencyRef): Record<string, unknown> | undefined;
};
