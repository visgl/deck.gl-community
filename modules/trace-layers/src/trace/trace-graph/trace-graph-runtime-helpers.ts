import {getTraceGraphSpanRefProcessId, iterateTraceGraphSpanRefs} from '../trace-graph-accessors';
import {TRACE_SPAN_FILTER_MASK_NONE} from './trace-graph-types';
import {
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  getCrossDependencyRefIndex,
  getLocalDependencyRefProcessIndex,
  getLocalDependencyRefRowIndex,
  isCrossDependencyRef,
  isLocalDependencyRef,
  isVisibleCrossDependencyRef,
  isVisibleLocalDependencyRef
} from './trace-id-encoder';

import type {TraceGraph, TraceSpanDirectionalDependencyRefs} from './trace-graph';
import type {
  TraceGraphOverlappingParentSpanFilter,
  TraceGraphProjection,
  TraceGraphSimilarDurationChainSpanFilter
} from './trace-graph-types';
import type {
  CrossDependencyRef,
  LocalDependencyRef,
  ThreadRef,
  TraceDependencyRef,
  VisibleDependencyRef
} from './trace-id-encoder';
import type {SpanRef, TraceDependency, TraceProcessId, TraceSpanId} from './trace-types';

/** Dependency keyword used by TraceGraph parent traversal helpers. */
export const TRACE_GRAPH_PARENT_KEYWORD = 'PARENT';

/** Shared immutable empty result for spans without directional dependency refs. */
export const EMPTY_SPAN_DIRECTIONAL_DEPENDENCY_REFS: TraceSpanDirectionalDependencyRefs = {
  localDependencyRefs: [],
  crossDependencyRefs: []
};

/** Reads one Arrow list cell into safe JavaScript numbers. */
export function readArrowNumberListColumn(
  table: {getChild(name: string): {get(index: number): unknown} | null | undefined},
  columnName: string,
  rowIndex: number
): number[] | null {
  const column = table.getChild(columnName);
  if (!column) {
    return null;
  }
  const value = column.get(rowIndex);
  if (value == null) {
    return [];
  }
  const rawValues =
    typeof value === 'object' && Symbol.iterator in value
      ? Array.from(value as Iterable<unknown>)
      : [];
  return rawValues.flatMap(entry => {
    const numberValue = normalizeArrowRefNumber(entry);
    return numberValue == null ? [] : [numberValue];
  });
}

/** Normalizes a sidecar local-dependency ref or legacy row index into the current process chunk. */
export function normalizeDirectionalLocalDependencyRef(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef,
  dependencyRef: number
): LocalDependencyRef[] {
  const processId = getTraceGraphSpanRefProcessId(traceGraph, spanRef);
  if (!processId) {
    return [];
  }
  const dependencyTable = traceGraph.localDependencyTableMap[processId];
  if (!dependencyTable) {
    return [];
  }

  const processIndex = traceGraph.processIdsByIndex.indexOf(processId);
  if (processIndex < 0) {
    return [];
  }
  const dependencyRowIndex = isLocalDependencyRef(dependencyRef)
    ? getLocalDependencyRefRowIndex(dependencyRef)
    : Number.isInteger(dependencyRef)
      ? dependencyRef
      : null;
  if (
    dependencyRowIndex == null ||
    dependencyRowIndex < 0 ||
    dependencyRowIndex >= dependencyTable.numRows
  ) {
    return [];
  }

  if (
    isLocalDependencyRef(dependencyRef) &&
    getLocalDependencyRefProcessIndex(dependencyRef) === processIndex
  ) {
    return [dependencyRef as LocalDependencyRef];
  }
  return [encodeLocalDependencyRef(encodeLocalSpanRef(processIndex, dependencyRowIndex))];
}

/** Normalizes a sidecar cross-dependency ref into a valid graph-global cross dependency ref. */
export function normalizeDirectionalCrossDependencyRef(
  traceGraph: Readonly<TraceGraph>,
  dependencyRef: number
): CrossDependencyRef[] {
  if (!isCrossDependencyRef(dependencyRef)) {
    return [];
  }
  const dependencyIndex = getCrossDependencyRefIndex(dependencyRef);
  if (dependencyIndex < 0 || dependencyIndex >= traceGraph.crossDependencyTable.numRows) {
    return [];
  }
  return [dependencyRef as CrossDependencyRef];
}

/**
 * Counts graph-filtered spans by scanning process-local `filter_mask` columns in row order.
 *
 * This path is valid only when filtering is fully represented by graph-owned process span tables.
 * Trace-store filters use the span-ref scan path because their state is external to
 * `processSpanTableMap`.
 */
export function buildGraphFilteredSpanCountByThreadRef(
  traceGraph: TraceGraph
): ReadonlyMap<ThreadRef, number> {
  const counts = new Map<ThreadRef, number>();
  for (const process of traceGraph.processes) {
    const processId = process.processId as TraceProcessId;
    const spanTable = traceGraph.processSpanTableMap[processId];
    const spanRefColumn = spanTable?.getChild('span_ref');
    const filterMaskColumn = spanTable?.getChild('filter_mask');
    if (!spanTable || !spanRefColumn || !filterMaskColumn) {
      continue;
    }

    for (let rowIndex = 0; rowIndex < spanTable.numRows; rowIndex += 1) {
      const filterMask = filterMaskColumn.get(rowIndex);
      if (
        typeof filterMask !== 'number' ||
        filterMask === TRACE_SPAN_FILTER_MASK_NONE ||
        !Number.isFinite(filterMask)
      ) {
        continue;
      }

      const spanRef = normalizeArrowRefNumber(spanRefColumn.get(rowIndex));
      const threadRef =
        spanRef == null ? null : traceGraph.getThreadRefBySpanRef(spanRef as SpanRef);
      if (threadRef != null) {
        counts.set(threadRef, (counts.get(threadRef) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * Counts filtered spans through `spanIsFiltered(...)` for trace-store filtering and fallback paths.
 */
export function buildFilteredSpanCountByThreadRefBySpanScan(
  traceGraph: TraceGraph
): ReadonlyMap<ThreadRef, number> {
  const counts = new Map<ThreadRef, number>();
  if (!traceGraph.hasActiveSpanFilter()) {
    return counts;
  }

  for (const spanIndex of iterateTraceGraphSpanRefs(traceGraph)) {
    const spanId = traceGraph.getSpanBlockId(spanIndex);
    if (!spanId || !traceGraph.spanIsFiltered(spanIndex)) {
      continue;
    }
    const threadRef = traceGraph.getThreadRefBySpanRef(spanIndex);
    if (threadRef != null) {
      counts.set(threadRef, (counts.get(threadRef) ?? 0) + 1);
    }
  }
  return counts;
}

/** Returns true when a dependency ref is from the legacy graph-wide visible namespace. */
export function isLegacyVisibleDependencyRef(
  dependencyRef: TraceDependencyRef | VisibleDependencyRef
): dependencyRef is VisibleDependencyRef {
  return isVisibleLocalDependencyRef(dependencyRef) || isVisibleCrossDependencyRef(dependencyRef);
}

/** Returns whether an unknown value is a supported dependency wait mode. */
export function isTraceDependencyWaitMode(value: unknown): value is TraceDependency['waitMode'] {
  return value === 'end-to-start' || value === 'end-to-end' || value === 'start-to-start';
}

/** Returns whether an unknown value is an object-shaped dependency user-data payload. */
export function isDependencyUserData(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns one Arrow numeric ref cell as a JavaScript safe integer. */
export function normalizeArrowRefNumber(value: unknown): number | null {
  const numberValue =
    typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : null;
  return numberValue != null && Number.isSafeInteger(numberValue) ? numberValue : null;
}

/** Returns whether a raw Arrow keyword-list cell contains the target keyword. */
export function dependencyKeywordListHas(value: unknown, keyword: string): boolean {
  if (value == null || typeof (value as Iterable<unknown>)[Symbol.iterator] !== 'function') {
    return false;
  }

  for (const candidate of value as Iterable<unknown>) {
    if (candidate === keyword) {
      return true;
    }
  }
  return false;
}

/** Child dependency metadata used while resolving filtered-search navigation targets. */
type TraceGraphSearchChildDependency = {
  /** Exact span ref for the candidate child. */
  childSpanRef: SpanRef;
  /** Stable block id for visited-set tracking. */
  childSpanId: TraceSpanId;
  /** Candidate child start time used for deterministic ordering. */
  startTimeMs: number;
  /** Candidate child end time used for deterministic ordering. */
  endTimeMs: number;
};

/** Returns ordered parent-child dependencies reachable from one source span id. */
export function getSearchParentChildDependencies(params: {
  /** Source projection that retains filtered intermediate nodes. */
  projection: TraceGraphProjection;
  /** Exact parent span whose outgoing dependency rows should be scanned. */
  spanRef: SpanRef;
  /** Graph that resolves exact child span timings. */
  traceGraph: Readonly<TraceGraph>;
}): TraceGraphSearchChildDependency[] {
  const spanId = params.traceGraph.getSpanBlockId(params.spanRef);
  if (!spanId) {
    return [];
  }

  const processRef = params.traceGraph.getProcessRefBySpanRef(params.spanRef);
  const candidates: TraceGraphSearchChildDependency[] = [];
  for (const dependency of params.projection.outDependenciesBySpanId[spanId] ?? []) {
    if (dependency.startSpanId !== spanId || !isSearchParentDependency(dependency)) {
      continue;
    }

    const directEndSpanRef =
      dependency.endSpanRef != null &&
      params.traceGraph.getSpanBlockId(dependency.endSpanRef) === dependency.endSpanId
        ? dependency.endSpanRef
        : null;
    const childSpanRef =
      directEndSpanRef ??
      (dependency.type === 'trace-local-dependency' && processRef != null
        ? params.traceGraph.getProcessScopedSpanRef(processRef, dependency.endSpanId)
        : null);
    if (childSpanRef == null) {
      continue;
    }

    const startTimeMs = params.traceGraph.getSpanStartTimeMs(childSpanRef);
    const endTimeMs = params.traceGraph.getSpanEndTimeMs(childSpanRef);
    if (startTimeMs == null || endTimeMs == null) {
      continue;
    }

    candidates.push({
      childSpanRef,
      childSpanId: dependency.endSpanId,
      startTimeMs,
      endTimeMs
    });
  }

  return candidates.sort(compareTraceGraphSearchChildDependencies);
}

/** Normalizes an optional overlapping-parent filter into a valid immutable constructor input. */
export function normalizeOverlappingParentSpanFilter(
  filter: TraceGraphOverlappingParentSpanFilter | undefined
): TraceGraphOverlappingParentSpanFilter | null {
  if (!filter || !Number.isFinite(filter.maxChildDurationMs) || filter.maxChildDurationMs < 0) {
    return null;
  }

  return {
    maxChildDurationMs: filter.maxChildDurationMs
  };
}

/** Normalizes an optional similar-duration chain filter into a valid constructor input. */
export function normalizeSimilarDurationChainSpanFilter(
  filter: TraceGraphSimilarDurationChainSpanFilter | undefined
): TraceGraphSimilarDurationChainSpanFilter | null {
  if (
    !filter ||
    !Number.isFinite(filter.maxRelativeDurationDelta) ||
    filter.maxRelativeDurationDelta < 0
  ) {
    return null;
  }

  return {
    maxRelativeDurationDelta: filter.maxRelativeDurationDelta
  };
}

/** Matches the parent-edge semantics used by descendant traversal. */
function isSearchParentDependency(dependency: Readonly<TraceDependency>): boolean {
  const hasParentKeyword = [...dependency.keywords].some(
    keyword => keyword.toUpperCase() === TRACE_GRAPH_PARENT_KEYWORD
  );
  return dependency.type === 'trace-local-dependency'
    ? hasParentKeyword
    : hasParentKeyword || dependency.topology === 'parent';
}

/** Sorts search-child candidates with the same stable order used by descendant traversal. */
function compareTraceGraphSearchChildDependencies(
  left: Readonly<TraceGraphSearchChildDependency>,
  right: Readonly<TraceGraphSearchChildDependency>
): number {
  return (
    left.startTimeMs - right.startTimeMs ||
    left.endTimeMs - right.endTimeMs ||
    left.childSpanId.localeCompare(right.childSpanId)
  );
}
