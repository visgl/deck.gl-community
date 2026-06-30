import {getTraceGraphSpanStoreRow} from '../trace-graph-accessors';

import type {TraceGraphData} from '../ingestion/arrow-trace';
import type {
  SpanRef,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceProcessId,
  TraceSpanId
} from './trace-types';

/** Reads the visible lane hint from one Arrow span row without materializing a `TraceSpan`. */
export function getArrowTraceSpanLaneValue(
  traceGraph: Readonly<TraceGraphData>,
  span: SpanRef
): number | null {
  const spanRow = getTraceGraphSpanStoreRow(traceGraph, span);
  if (!spanRow?.processId) {
    return null;
  }

  const userDataValue = getArrowTraceTableField<unknown>({
    traceGraph,
    processId: spanRow.processId,
    rowIndex: spanRow.rowIndex,
    spanRef: span,
    fieldName: 'userDataJson'
  });
  if (!userDataValue) {
    return null;
  }

  const userData =
    typeof userDataValue === 'string'
      ? deserializeArrowTraceJson<Record<string, unknown>>(userDataValue)
      : ((userDataValue as Record<string, unknown> | null) ?? null);
  const laneValue = userData?.lane;
  return typeof laneValue === 'number' && Number.isFinite(laneValue) ? laneValue : null;
}

/** Reads unresolved cross-rank endpoints from one Arrow span row without materializing a block. */
export function getArrowTraceSpanCrossProcessEndpoints(
  traceGraph: Readonly<TraceGraphData>,
  span: SpanRef
): TraceCrossProcessEndpoint[] {
  const sparseEndpoints = traceGraph.crossProcessEndpointsBySpanRef?.get(span);
  if (sparseEndpoints) {
    return [...sparseEndpoints];
  }

  const spanRow = getTraceGraphSpanStoreRow(traceGraph, span);
  if (!spanRow?.processId) {
    return [];
  }

  return normalizeCrossProcessEndpoints(
    getArrowTraceTableField<unknown>({
      traceGraph,
      processId: spanRow.processId,
      rowIndex: spanRow.rowIndex,
      spanRef: span,
      fieldName: 'crossProcessDependencyEndpoints'
    })
  );
}

/** Reads one raw Arrow table or sidecar field by process id and row index. */
export function getArrowTraceTableField<Value>(params: {
  traceGraph: Readonly<TraceGraphData>;
  processId: TraceProcessId;
  rowIndex: number;
  spanRef?: SpanRef;
  fieldName: string;
}): Value | null {
  const spanRow = params.spanRef
    ? getTraceGraphSpanStoreRow(params.traceGraph, params.spanRef)
    : null;
  const sidecarTableValue = getArrowTraceSpanSidecarTableField<Value>({...params, spanRow});
  if (sidecarTableValue != null) {
    return sidecarTableValue;
  }

  const sidecarRow =
    spanRow?.chunk.spanSidecarRows?.[spanRow.rowIndex] ??
    (spanRow == null || spanRow.chunk.processId === params.processId
      ? params.traceGraph.spanSidecarMap?.[params.processId]?.[params.rowIndex]
      : null);
  if (sidecarRow) {
    if (params.fieldName === 'userDataJson') {
      return (sidecarRow.userData as Value | undefined) ?? null;
    }
    if (params.fieldName === 'crossProcessDependencyEndpoints') {
      return (sidecarRow.crossProcessDependencyEndpoints as Value | undefined) ?? null;
    }
    if (params.fieldName === 'localDependencyIds') {
      return (sidecarRow.localDependencyIds as Value | undefined) ?? null;
    }
    if (params.fieldName === 'crossProcessEndpointId') {
      return (sidecarRow.crossProcessEndpointId as Value | undefined) ?? null;
    }
    if (params.fieldName === 'keywords') {
      return (sidecarRow.keywords as Value | undefined) ?? null;
    }
    if (params.fieldName === 'timingsJson') {
      return (sidecarRow.timings as Value | undefined) ?? null;
    }
  }

  const table = spanRow?.spanTable;
  const column = (table as unknown as {getChild(name: string): unknown} | null)?.getChild?.(
    params.fieldName
  ) as {get(index: number): Value | null | undefined} | null | undefined;
  return (column?.get(spanRow?.rowIndex ?? -1) as Value | null | undefined) ?? null;
}

/** Normalizes Arrow-backed numeric arrays into plain JS numbers. */
export function normalizeNumberArray(value: unknown): number[] {
  return toArray(value)
    .map(entry => (typeof entry === 'bigint' ? Number(entry) : entry))
    .filter((entry): entry is number => typeof entry === 'number' && Number.isSafeInteger(entry));
}

function getArrowTraceSpanSidecarTableField<Value>(params: {
  traceGraph: Readonly<TraceGraphData>;
  processId: TraceProcessId;
  rowIndex: number;
  spanRow?: ReturnType<typeof getTraceGraphSpanStoreRow>;
  fieldName: string;
}): Value | null {
  if (
    params.fieldName !== 'userDataJson' &&
    params.fieldName !== 'crossProcessEndpointId' &&
    params.fieldName !== 'keywords' &&
    params.fieldName !== 'incomingLocalDependencyRefs' &&
    params.fieldName !== 'outgoingLocalDependencyRefs' &&
    params.fieldName !== 'localDependencyRefs' &&
    params.fieldName !== 'incomingCrossDependencyRefs' &&
    params.fieldName !== 'outgoingCrossDependencyRefs' &&
    params.fieldName !== 'crossDependencyRefs'
  ) {
    return null;
  }

  const table =
    params.spanRow?.chunk.spanSidecarTable ??
    (params.spanRow == null || params.spanRow.chunk.processId === params.processId
      ? params.traceGraph.spanSidecarTableMap?.[params.processId]
      : null);
  const column = (table as unknown as {getChild(name: string): unknown} | null)?.getChild?.(
    params.fieldName
  ) as {get(index: number): Value | null | undefined} | null | undefined;
  return (
    (column?.get(params.spanRow?.rowIndex ?? params.rowIndex) as Value | null | undefined) ?? null
  );
}

function deserializeArrowTraceJson<Value>(value: string | null): Value | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as Value;
  } catch {
    return null;
  }
}

function normalizeCrossProcessEndpoints(value: unknown): TraceCrossProcessEndpoint[] {
  return toArray(value)
    .map(entry => normalizeCrossProcessEndpoint(entry))
    .filter((entry): entry is TraceCrossProcessEndpoint => Boolean(entry));
}

function normalizeCrossProcessEndpoint(value: unknown): TraceCrossProcessEndpoint | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const endpoint = value as Record<string, unknown>;
  const endpointId = typeof endpoint.endpointId === 'string' ? endpoint.endpointId : null;
  const spanId = typeof endpoint.spanId === 'string' ? endpoint.spanId : null;
  if (!endpointId || !spanId) {
    return null;
  }

  return {
    type: 'cross-process-dependency-endpoint',
    endpointId: endpointId as TraceCrossProcessEndpointId,
    spanId: spanId as TraceSpanId,
    spanRef:
      typeof endpoint.spanRef === 'number' && Number.isSafeInteger(endpoint.spanRef)
        ? (endpoint.spanRef as SpanRef)
        : undefined,
    startRankNum: Number(endpoint.startRankNum ?? 0),
    endRankNum: Number(endpoint.endRankNum ?? 0),
    islandNum: Number(endpoint.islandNum ?? 0),
    waitTimeMs: Number(endpoint.waitTimeMs ?? 0),
    waiting: Boolean(endpoint.waiting),
    waitNotFinished: Boolean(endpoint.waitNotFinished),
    userData:
      (typeof endpoint.userData === 'object' &&
      endpoint.userData !== null &&
      !Array.isArray(endpoint.userData)
        ? (endpoint.userData as Record<string, unknown>)
        : deserializeArrowTraceJson<Record<string, unknown>>(
            typeof endpoint.userDataJson === 'string' ? endpoint.userDataJson : null
          )) ?? undefined
  } satisfies TraceCrossProcessEndpoint;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  if (typeof value === 'object' && Symbol.iterator in (value as object)) {
    return Array.from(value as Iterable<unknown>);
  }
  if (typeof value === 'object' && 'toArray' in (value as object)) {
    const toArrayFn = (value as {toArray?: () => unknown[]}).toArray;
    return typeof toArrayFn === 'function' ? toArrayFn.call(value) : [];
  }
  return [];
}
