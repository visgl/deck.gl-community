import {getTraceGraphSpanRefProcessId} from '../trace-graph-accessors';
import {
  encodeLocalSpanRef,
  encodeSameProcessDependencyRef,
  getSameProcessDependencyRefProcessIndex,
  getSameProcessDependencyRefRowIndex,
  isSameProcessDependencyRef
} from './trace-id-encoder';

import type {TraceGraph, TraceSpanDirectionalDependencyRefs} from './trace-graph';
import type {SameProcessDependencyRef} from './trace-id-encoder';
import type {SpanRef, TraceDependency, TraceSpanId} from './trace-types';

/** Dependency keyword used by TraceGraph parent traversal helpers. */
export const TRACE_GRAPH_PARENT_KEYWORD = 'PARENT';

/** Shared immutable empty result for spans without directional dependency refs. */
export const EMPTY_SPAN_DIRECTIONAL_DEPENDENCY_REFS: TraceSpanDirectionalDependencyRefs = {
  sameProcessDependencyRefs: [],
  crossProcessDependencyRefs: []
};

type TraceGraphLaneAssignmentModeUserData = {
  /** Optional process-authored lane assignment mode. */
  laneAssignmentMode?: unknown;
};

/** Reads the generic process lane-assignment mode owned by TraceGraph runtime data. */
export function getTraceGraphProcessLaneAssignmentMode(
  userData?: Record<string, unknown>
): 'auto' | 'none' {
  return (userData as TraceGraphLaneAssignmentModeUserData | undefined)?.laneAssignmentMode ===
    'none'
    ? 'none'
    : 'auto';
}

/** Normalizes a sidecar same-process-dependency ref or legacy row index into the current process chunk. */
export function normalizeDirectionalSameProcessDependencyRef(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef,
  dependencyRef: number
): SameProcessDependencyRef[] {
  const processId = getTraceGraphSpanRefProcessId(traceGraph, spanRef);
  if (!processId) {
    return [];
  }
  const dependencyTable = traceGraph.sameProcessDependencyTableMap[processId];
  if (!dependencyTable) {
    return [];
  }

  const processIndex = traceGraph.processIdsByIndex.indexOf(processId);
  if (processIndex < 0) {
    return [];
  }
  const dependencyRowIndex = isSameProcessDependencyRef(dependencyRef)
    ? getSameProcessDependencyRefRowIndex(dependencyRef)
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
    isSameProcessDependencyRef(dependencyRef) &&
    getSameProcessDependencyRefProcessIndex(dependencyRef) === processIndex
  ) {
    return [dependencyRef as SameProcessDependencyRef];
  }
  return [encodeSameProcessDependencyRef(encodeLocalSpanRef(processIndex, dependencyRowIndex))];
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
  /** Exact parent span whose outgoing dependency rows should be scanned. */
  spanRef: SpanRef;
  /** Graph that resolves exact child span timings. */
  traceGraph: Readonly<TraceGraph>;
}): TraceGraphSearchChildDependency[] {
  const spanId = params.traceGraph.getSpanId(params.spanRef);
  if (!spanId) {
    return [];
  }

  const processRef = params.traceGraph.getProcessRefBySpanRef(params.spanRef);
  const candidates: TraceGraphSearchChildDependency[] = [];
  const directionalRefs = params.traceGraph.getSpanDirectionalDependencyRefs(
    params.spanRef,
    'outgoing'
  );
  for (const dependencyRef of [
    ...directionalRefs.sameProcessDependencyRefs,
    ...directionalRefs.crossProcessDependencyRefs
  ]) {
    const startSpanId = params.traceGraph.getDependencyStartBlockId(dependencyRef);
    const endSpanId = params.traceGraph.getDependencyEndBlockId(dependencyRef);
    if (
      startSpanId !== spanId ||
      !endSpanId ||
      !params.traceGraph.getDependencyIsParent(dependencyRef)
    ) {
      continue;
    }

    const endSpanRef = params.traceGraph.getDependencyEndSpan(dependencyRef);
    const directEndSpanRef =
      endSpanRef != null && params.traceGraph.getSpanId(endSpanRef) === endSpanId
        ? endSpanRef
        : null;
    const childSpanRef =
      directEndSpanRef ??
      (isSameProcessDependencyRef(dependencyRef) && processRef != null
        ? params.traceGraph.getProcessScopedSpanRef(processRef, endSpanId)
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
      childSpanId: endSpanId,
      startTimeMs,
      endTimeMs
    });
  }

  return candidates.sort(compareTraceGraphSearchChildDependencies);
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
