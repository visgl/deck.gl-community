import {getArrowTraceChunkSpanTableRowIndex} from '../ingestion/arrow-trace';
import {encodeSpanRef} from './trace-id-encoder';
import {getPrimaryTiming} from './trace-types';

import type {TraceSpanDisplaySource} from '../trace-graph-accessors';
import type {TraceGraph} from './trace-graph';
import type {TraceGraphSpanSearchRecord} from './trace-graph-types';
import type {SpanRef} from './trace-types';

export type TraceGraphLoadedChunkSpanSearchParams = {
  /** Search predicate applied to normalized chunk-row text. */
  readonly matchesSearchText: (searchText: string) => boolean;
  /** Visitor invoked for each materialized matching record. */
  readonly visitRecord: (record: TraceGraphSpanSearchRecord) => boolean | void;
  /** Maximum number of records to visit. */
  readonly limit: number;
  /** Optional search text projection; defaults to the rich chunk-row text. */
  readonly getSearchText?: (displaySource: TraceSpanDisplaySource) => string;
};

/**
 * Scans loaded graph chunks without falling back to process-table enumeration.
 *
 * @returns Number of matching records visited before the callback, limit, or chunk scan stopped.
 */
export function searchLoadedChunkSpanRecords(
  traceGraph: TraceGraph,
  params: TraceGraphLoadedChunkSpanSearchParams
): number {
  let visitedCount = 0;
  if (traceGraph.spanRefs) {
    for (const spanRef of traceGraph.spanRefs) {
      const displaySource = traceGraph.getSpanDisplaySource(spanRef);
      if (!displaySource) {
        continue;
      }
      const searchText =
        params.getSearchText?.(displaySource) ?? buildSpanSearchText(displaySource);
      if (!params.matchesSearchText(searchText)) {
        continue;
      }

      visitedCount += 1;
      const shouldContinue =
        params.visitRecord(buildLoadedChunkSpanSearchRecord(traceGraph, displaySource, spanRef)) !==
        false;
      if (!shouldContinue || visitedCount >= params.limit) {
        return visitedCount;
      }
    }
    return visitedCount;
  }

  for (const chunk of traceGraph.chunks) {
    for (let spanRefRowIndex = 0; spanRefRowIndex < chunk.spanTable.numRows; spanRefRowIndex += 1) {
      const rowIndex = getArrowTraceChunkSpanTableRowIndex(chunk, spanRefRowIndex);
      if (rowIndex == null) {
        continue;
      }
      const spanRef = encodeSpanRef(chunk.chunkIndex, spanRefRowIndex);
      const displaySource = traceGraph.getSpanDisplaySource(spanRef);
      if (!displaySource) {
        continue;
      }
      const searchText =
        params.getSearchText?.(displaySource) ?? buildSpanSearchText(displaySource);
      if (!params.matchesSearchText(searchText)) {
        continue;
      }

      visitedCount += 1;
      const shouldContinue =
        params.visitRecord(buildLoadedChunkSpanSearchRecord(traceGraph, displaySource, spanRef)) !==
        false;
      if (!shouldContinue || visitedCount >= params.limit) {
        return visitedCount;
      }
    }
  }
  return visitedCount;
}

function buildLoadedChunkSpanSearchRecord(
  traceGraph: TraceGraph,
  displaySource: TraceSpanDisplaySource,
  spanRef: SpanRef
): TraceGraphSpanSearchRecord {
  const filterReason = traceGraph.spanFilterReason(spanRef, {
    spanName: displaySource.name
  });
  const threadName =
    displaySource.threadRef == null
      ? String(displaySource.threadId)
      : (traceGraph.getThreadSourceByRef(displaySource.threadRef)?.name ??
        String(displaySource.threadId));
  return {
    spanRef,
    spanId: displaySource.spanId,
    blockName: displaySource.name,
    processName: displaySource.processName,
    threadName,
    primaryTiming: getPrimaryTiming(displaySource),
    keywordsText: displaySource.keywords.join(' '),
    searchText: displaySource.name.toLowerCase(),
    filterMask: filterReason.filterMask,
    filterReason
  };
}

function buildSpanSearchText(source: TraceSpanDisplaySource): string {
  return [
    source.name,
    source.source ?? '',
    source.keywords.join(' '),
    source.processName,
    source.threadId
  ]
    .join('\n')
    .toLowerCase();
}
