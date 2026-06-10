import {getSearchParentChildDependencies} from './trace-graph-runtime-helpers';

import type {ArrowTraceProcessMetadata, TraceProcessSpanRefTable} from '../ingestion/arrow-trace';
import type {TraceProcessSource} from '../trace-graph-accessors';
import type {TraceGraph} from './trace-graph';
import type {TraceGraphVisibleSpanSearchRecord} from './trace-graph-types';
import type {ProcessRef} from './trace-id-encoder';
import type {
  SpanRef,
  TraceProcessId,
  TraceSpanId,
  TraceSpanTiming,
  TraceThreadId
} from './trace-types';

/** Minimal graph surface used to build search records directly from Arrow span tables. */
type TraceGraphSearchSource = {
  /** Metadata-only process records in graph order. */
  readonly processes: ReadonlyArray<ArrowTraceProcessMetadata>;
  /** Process-local span-ref tables keyed by process id. */
  readonly processSpanTableMap: Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>>;
  /** Returns process display metadata for a process ref. */
  getProcessSourceByRef(processRef: ProcessRef): TraceProcessSource | null;
  /** Returns the span display name for one span ref. */
  getSpanName(spanRef: SpanRef): string | null;
  /** Returns the external span id for one span ref. */
  getSpanBlockId(spanRef: SpanRef): TraceSpanId | null;
  /** Returns the thread id for one span ref. */
  getSpanStreamId(spanRef: SpanRef): TraceThreadId | null;
  /** Returns the timing status for one span ref. */
  getSpanStatus(spanRef: SpanRef): TraceSpanTiming['status'] | null;
  /** Returns the start time for one span ref. */
  getSpanStartTimeMs(spanRef: SpanRef): number | null;
  /** Returns the end time for one span ref. */
  getSpanEndTimeMs(spanRef: SpanRef): number | null;
  /** Returns the duration for one span ref. */
  getSpanDurationMs(spanRef: SpanRef): number | null;
  /** Returns the formatted duration label for one span ref. */
  getSpanDurationLabel(spanRef: SpanRef): string | null;
  /** Returns keyword labels for one span ref. */
  getSpanKeywords(spanRef: SpanRef): readonly string[];
};

/** Returns the first visible descendant under the existing parent-child traversal ordering. */
export function getFirstVisibleSearchDescendantSpanRef(
  graph: Readonly<TraceGraph>,
  spanRef: SpanRef
): SpanRef | null {
  if (!graph.getSpanBlockId(spanRef)) {
    return null;
  }

  const projection = graph.getSourceProjection();
  const visitedSpanRefs = new Set<SpanRef>([spanRef]);
  const stack = getSearchParentChildDependencies({
    projection,
    spanRef,
    traceGraph: graph
  }).reverse();

  while (stack.length > 0) {
    const nextDependency = stack.pop();
    if (!nextDependency || visitedSpanRefs.has(nextDependency.childSpanRef)) {
      continue;
    }
    visitedSpanRefs.add(nextDependency.childSpanRef);

    if (graph.getVisibleDisplaySourceBySpanRef(nextDependency.childSpanRef) != null) {
      return nextDependency.childSpanRef;
    }

    const childDependencies = getSearchParentChildDependencies({
      projection,
      spanRef: nextDependency.childSpanRef,
      traceGraph: graph
    });
    for (let index = childDependencies.length - 1; index >= 0; index -= 1) {
      const childDependency = childDependencies[index];
      if (childDependency && !visitedSpanRefs.has(childDependency.childSpanRef)) {
        stack.push(childDependency);
      }
    }
  }

  return null;
}

/** Scans block tables with caller-supplied row visibility and search-record shaping. */
export function searchTraceGraphBlockRecordsWithOptions<
  TRecord extends TraceGraphVisibleSpanSearchRecord
>(
  graph: TraceGraphSearchSource,
  params: {
    /** Process refs whose span tables should be scanned. */
    processRefs: ReadonlyArray<ProcessRef>;
    /** Resolves one raw ingestion process id for a canonical runtime process ref. */
    getProcessIdByRef: (processRef: ProcessRef) => TraceProcessId | null;
    /** Search predicate applied to lowercase block names. */
    matchesSearchText: (searchText: string) => boolean;
    /** Visitor invoked for each materialized matching record. */
    visitRecord: (record: TRecord) => boolean | void;
    /** Maximum number of records to visit. */
    limit: number;
    /** Optional row resolver for visible-only scans. */
    getRowIndexes?: (
      typedProcessId: TraceProcessId,
      spanTable: TraceProcessSpanRefTable
    ) => number | Iterable<number>;
    /** Converts the shared search metadata into the caller-specific record shape. */
    buildRecord: (record: TraceGraphVisibleSpanSearchRecord) => TRecord;
  }
): number {
  const resultLimit = Math.max(0, params.limit);
  if (resultLimit === 0) {
    return 0;
  }

  let visitedCount = 0;
  for (const processRef of params.processRefs) {
    const typedProcessId = params.getProcessIdByRef(processRef);
    if (!typedProcessId) {
      continue;
    }

    const spanTable = graph.processSpanTableMap[typedProcessId];
    const spanRefColumn = spanTable?.getChild('span_ref');
    if (!spanTable || !spanRefColumn) {
      continue;
    }

    const processSource = graph.getProcessSourceByRef(processRef);
    const processName = processSource?.name ?? String(processRef);
    const rawProcess =
      graph.processes.find(process => process.processId === typedProcessId) ?? null;
    const threadMap = rawProcess?.threadMap ?? {};
    const rowIndexes = params.getRowIndexes?.(typedProcessId, spanTable) ?? spanTable.numRows;

    const visitRow = (rowIndex: number): boolean => {
      const spanRefValue = spanRefColumn.get(rowIndex);
      const spanRef =
        typeof spanRefValue === 'number'
          ? (spanRefValue as SpanRef)
          : typeof spanRefValue === 'bigint'
            ? (Number(spanRefValue) as SpanRef)
            : null;
      if (spanRef == null) {
        return true;
      }
      const blockName = graph.getSpanName(spanRef);
      if (blockName == null) {
        return true;
      }
      const searchText = String(blockName).toLowerCase();
      if (!params.matchesSearchText(searchText)) {
        return true;
      }

      const spanId = graph.getSpanBlockId(spanRef);
      const threadId = graph.getSpanStreamId(spanRef);
      const status = graph.getSpanStatus(spanRef);
      const startTimeMs = graph.getSpanStartTimeMs(spanRef);
      const endTimeMs = graph.getSpanEndTimeMs(spanRef);
      const durationMs = graph.getSpanDurationMs(spanRef);
      const durationMsAsString = graph.getSpanDurationLabel(spanRef);
      if (
        !spanId ||
        !threadId ||
        status == null ||
        startTimeMs == null ||
        endTimeMs == null ||
        durationMs == null ||
        durationMsAsString == null
      ) {
        return true;
      }

      const threadName = threadMap[threadId]?.name ?? String(threadId);
      const primaryTiming = {
        status,
        startTimeMs,
        endTimeMs,
        durationMs,
        durationMsAsString
      };
      visitedCount += 1;
      const shouldContinue =
        params.visitRecord(
          params.buildRecord({
            spanRef,
            spanId,
            blockName: String(blockName),
            processName,
            threadName,
            primaryTiming,
            keywordsText: graph.getSpanKeywords(spanRef).join(' '),
            searchText
          })
        ) !== false;
      return shouldContinue && visitedCount < resultLimit;
    };

    if (typeof rowIndexes === 'number') {
      for (let rowIndex = 0; rowIndex < rowIndexes; rowIndex += 1) {
        if (!visitRow(rowIndex)) {
          return visitedCount;
        }
      }
    } else {
      for (const rowIndex of rowIndexes) {
        if (!visitRow(rowIndex)) {
          return visitedCount;
        }
      }
    }
  }

  return visitedCount;
}
