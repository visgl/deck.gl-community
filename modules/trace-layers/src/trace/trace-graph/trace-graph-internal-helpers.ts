import {traceDependencyKeywordFlagsHasParent} from '../ingestion/trace-dependency-arrow-fields';
import {getTraceGraphSpanTableRowIndex} from '../trace-graph-accessors';
import {buildTraceCardSpan} from './build-trace-span-card-data';
import {
  getProcessIdByRankNum,
  getProcessScopedSpanRefsByProcessId
} from './trace-graph-selection-utils';
import {encodeLocalSpanRef, encodeSameProcessDependencyRef} from './trace-id-encoder';

import type {TraceCardSpan, TraceSpanCardParentChainEntry} from './build-trace-span-card-data';
import type {TraceGraph} from './trace-graph';
import type {TraceDependencyRef} from './trace-id-encoder';
import type {SpanRef, TraceProcessId, TraceSpanId} from './trace-types';

/**
 * Builds direct parent span refs keyed by child span ref for selected-card parent walks.
 */
function buildDirectParentSpanRefMap(
  traceGraph: Readonly<TraceGraph>
): ReadonlyMap<SpanRef, readonly SpanRef[]> {
  const parentSpanRefs = new Map<SpanRef, SpanRef[]>();
  for (const [processIndex, process] of traceGraph.processes.entries()) {
    const processId = process.processId as TraceProcessId;
    const dependencyTable = traceGraph.sameProcessDependencyTableMap[processId];
    if (!dependencyTable) {
      continue;
    }

    const keywordFlagsColumn = dependencyTable.getChild('keywordFlags');

    for (let rowIndex = 0; rowIndex < dependencyTable.numRows; rowIndex += 1) {
      if (!traceDependencyKeywordFlagsHasParent(keywordFlagsColumn?.get(rowIndex))) {
        continue;
      }

      const dependencyRef = encodeSameProcessDependencyRef(
        encodeLocalSpanRef(processIndex, rowIndex)
      );
      const startSpanRef = traceGraph.getDependencyStartSpan(dependencyRef);
      const endSpanRef = traceGraph.getDependencyEndSpan(dependencyRef);
      if (startSpanRef == null || endSpanRef == null) {
        continue;
      }

      appendDirectParentSpanRef(parentSpanRefs, endSpanRef, startSpanRef);
    }
  }

  const processIdByRankNum = getProcessIdByRankNum(traceGraph);
  const processScopedSpanRefsByProcessId = getProcessScopedSpanRefsByProcessId(traceGraph);
  const startRankNumColumn = getArrowTableColumn(
    traceGraph.crossProcessDependencyTable,
    'startRankNum'
  );
  const endRankNumColumn = getArrowTableColumn(
    traceGraph.crossProcessDependencyTable,
    'endRankNum'
  );
  const startSpanIdColumn = getArrowTableColumn(
    traceGraph.crossProcessDependencyTable,
    'startSpanId'
  );
  const endSpanIdColumn = getArrowTableColumn(traceGraph.crossProcessDependencyTable, 'endSpanId');
  const hasParentKeywordColumn = getArrowTableColumn(
    traceGraph.crossProcessDependencyTable,
    'hasParentKeyword'
  );
  const topologyColumn = getArrowTableColumn(traceGraph.crossProcessDependencyTable, 'topology');

  for (let rowIndex = 0; rowIndex < traceGraph.crossProcessDependencyTable.numRows; rowIndex += 1) {
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
      ? (processScopedSpanRefsByProcessId[startProcessId]?.get(startSpanId) ?? null)
      : null;
    const endSpanRef = endSpanId
      ? (processScopedSpanRefsByProcessId[endProcessId]?.get(endSpanId) ?? null)
      : null;
    if (startSpanRef == null || endSpanRef == null) {
      continue;
    }

    appendDirectParentSpanRef(parentSpanRefs, endSpanRef, startSpanRef);
  }

  return parentSpanRefs;
}

/**
 * Builds the direct parent span-ref lookup used by one selected-card parent walk.
 *
 * The lookup is intentionally invocation-local. Parent navigation is a sparse card boundary, so
 * retaining a graph-wide map after the card closes would create a second row-heavy owner.
 */
export function getDirectParentSpanRefMap(
  traceGraph: Readonly<TraceGraph>
): ReadonlyMap<SpanRef, readonly SpanRef[]> {
  return buildDirectParentSpanRefMap(traceGraph);
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
  /** Graph whose Arrow-backed accessors resolve dependency fields. */
  traceGraph: Readonly<TraceGraph>;
  /** Whether each parent hop must remain in the active visible dependency view. */
  visibleOnly?: boolean;
}): TraceCardSpan[] {
  const {spanRef, dependencyKey, traceGraph, visibleOnly = false} = params;
  const chain: TraceCardSpan[] = [];
  let currentRef: SpanRef | null = spanRef;
  const visited = new Set<SpanRef>([spanRef]);
  const normalizedKey = dependencyKey.toUpperCase();

  while (currentRef != null) {
    const parentDependencyRef = getDependencyChainIncomingRefs({
      traceGraph,
      spanRef: currentRef,
      visibleOnly
    }).find(
      dependencyRef =>
        traceGraph.getDependencyEndSpan(dependencyRef) === currentRef &&
        traceGraph.getDependencyHasKeyword(dependencyRef, normalizedKey)
    );
    if (parentDependencyRef == null) {
      break;
    }
    const parentRef = traceGraph.getDependencyStartSpan(parentDependencyRef);
    const parentId = traceGraph.getDependencyStartBlockId(parentDependencyRef);
    if (parentRef == null || !parentId || visited.has(parentRef)) {
      break;
    }
    const parentSpan = buildTraceCardSpan({traceGraph, spanRef: parentRef});
    if (!parentSpan) {
      break;
    }
    chain.push(parentSpan);
    visited.add(parentRef);
    currentRef = parentRef;
  }

  return chain;
}

/** Returns touched incoming dependency refs for one source or visible chain step. */
function getDependencyChainIncomingRefs(params: {
  /** Graph whose directional dependency refs should be read. */
  traceGraph: Readonly<TraceGraph>;
  /** Exact current span ref whose incoming edges should be inspected. */
  spanRef: SpanRef;
  /** Whether only visible dependency refs should participate in the chain. */
  visibleOnly: boolean;
}): readonly TraceDependencyRef[] {
  if (params.visibleOnly) {
    return params.traceGraph.getVisibleDirectionalDependencyRefSlice(
      params.spanRef,
      'incoming',
      Number.POSITIVE_INFINITY
    ).dependencyRefs;
  }

  const directionalRefs = params.traceGraph.getSpanDirectionalDependencyRefs(
    params.spanRef,
    'incoming'
  );
  return [
    ...directionalRefs.sameProcessDependencyRefs,
    ...directionalRefs.crossProcessDependencyRefs
  ];
}
