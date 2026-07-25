import {encodeLocalSpanRef, encodeSameProcessDependencyRef} from './trace-graph/trace-id-encoder';
import {EMPTY_TRACE_REF_SOURCE} from './trace-ref-source';

import type {
  ArrowTraceSameProcessDependencyTable,
  TraceProcessSpanRefTable
} from './ingestion/arrow-trace';
import type {SameProcessDependencyRef} from './trace-graph/trace-id-encoder';
import type {SpanRef, TraceProcessId} from './trace-graph/trace-types';
import type {TraceRefSource} from './trace-ref-source';

/** Dataset-owned ref sources and dependency prefixes aligned with canonical process indexes. */
export type TraceDatasetRefSources = {
  /** Process-local span-ref sources aligned with owner-ref process indexes. */
  readonly spanRefSourcesByProcessIndex: readonly TraceRefSource<SpanRef>[];
  /** Canonical same-process dependency sources aligned with owner-ref process indexes. */
  readonly sameProcessDependencyRefSourcesByProcessIndex: readonly TraceRefSource<SameProcessDependencyRef>[];
};

/** Builds zero-copy/descriptor-only canonical ref sources for one immutable dataset snapshot. */
export function buildTraceDatasetRefSources(params: {
  /** Canonical process ids aligned with packed process-ref indexes. */
  readonly processIdsByIndex: readonly TraceProcessId[];
  /** Process-local active span-ref Arrow tables keyed by process id. */
  readonly processSpanTableMap: Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>>;
  /** Process-local canonical same-process dependency tables keyed by process id. */
  readonly sameProcessDependencyTableMap: Readonly<
    Record<TraceProcessId, ArrowTraceSameProcessDependencyTable>
  >;
}): TraceDatasetRefSources {
  const spanRefSourcesByProcessIndex: TraceRefSource<SpanRef>[] = [];
  const sameProcessDependencyRefSourcesByProcessIndex: TraceRefSource<SameProcessDependencyRef>[] =
    [];

  for (const [processIndex, processId] of params.processIdsByIndex.entries()) {
    const dependencyRowCount = params.sameProcessDependencyTableMap[processId]?.numRows ?? 0;

    spanRefSourcesByProcessIndex.push(
      buildTraceDatasetSpanRefSource(params.processSpanTableMap[processId])
    );
    sameProcessDependencyRefSourcesByProcessIndex.push(
      buildTraceDatasetSameProcessDependencyRefSource(processIndex, dependencyRowCount)
    );
  }

  return Object.freeze({
    spanRefSourcesByProcessIndex: Object.freeze(spanRefSourcesByProcessIndex),
    sameProcessDependencyRefSourcesByProcessIndex: Object.freeze(
      sameProcessDependencyRefSourcesByProcessIndex
    )
  });
}

/** Builds one borrowed Arrow span-ref source without copying process-local ref rows. */
function buildTraceDatasetSpanRefSource(
  table: TraceProcessSpanRefTable | undefined
): TraceRefSource<SpanRef> {
  const spanRefColumn = table?.getChild('span_ref');
  const length = table?.numRows ?? 0;
  if (!spanRefColumn || length === 0) {
    return EMPTY_TRACE_REF_SOURCE;
  }

  return Object.freeze({
    length,
    at(index: number): SpanRef | undefined {
      return isTraceRefSourceIndex(index, length)
        ? readTraceDatasetSpanRef(spanRefColumn.get(index))
        : undefined;
    },
    *[Symbol.iterator](): Iterator<SpanRef> {
      for (let index = 0; index < length; index += 1) {
        const spanRef = readTraceDatasetSpanRef(spanRefColumn.get(index));
        if (spanRef != null) {
          yield spanRef;
        }
      }
    }
  } satisfies TraceRefSource<SpanRef>);
}

/** Builds one numeric canonical dependency source without retaining per-row dependency refs. */
function buildTraceDatasetSameProcessDependencyRefSource(
  processIndex: number,
  length: number
): TraceRefSource<SameProcessDependencyRef> {
  if (length === 0) {
    return EMPTY_TRACE_REF_SOURCE;
  }

  return Object.freeze({
    length,
    at(index: number): SameProcessDependencyRef | undefined {
      return isTraceRefSourceIndex(index, length)
        ? encodeSameProcessDependencyRef(encodeLocalSpanRef(processIndex, index))
        : undefined;
    },
    *[Symbol.iterator](): Iterator<SameProcessDependencyRef> {
      for (let index = 0; index < length; index += 1) {
        yield encodeSameProcessDependencyRef(encodeLocalSpanRef(processIndex, index));
      }
    }
  } satisfies TraceRefSource<SameProcessDependencyRef>);
}

/** Returns whether one source index is an in-bounds safe integer. */
function isTraceRefSourceIndex(index: number, length: number): boolean {
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

/** Reads one trusted process-local Arrow span ref from a borrowed scalar column value. */
function readTraceDatasetSpanRef(value: unknown): SpanRef | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? (value as SpanRef) : undefined;
}
