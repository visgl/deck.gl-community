import {arrowFindUtf8, makeUtf8StringView} from '@deck.gl-community/infovis-layers';
import {
  getArrowTraceChunkSpanRefRowIndex,
  getArrowTraceChunkSpanTableRowIndex
} from '../ingestion/arrow-trace';
import {encodeSpanRef} from './trace-id-encoder';
import {getTraceSpanExactExternalIdQuery} from './trace-span-name-search';
import {getPrimaryTiming} from './trace-types';

import type {TraceSpanDetailSource} from '../trace-graph-accessors';
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
  readonly getSearchText?: (spanSource: TraceSpanDetailSource) => string;
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
  if (params.limit <= 0) {
    return 0;
  }

  let visitedCount = 0;
  const exactExternalIdQuery = getTraceSpanExactExternalIdQuery(params.matchesSearchText);
  const exactMatchedSpanRefs = exactExternalIdQuery ? new Set<SpanRef>() : null;
  const visitMatchingRecord = (spanSource: TraceSpanDetailSource, spanRef: SpanRef): boolean => {
    visitedCount += 1;
    const shouldContinue =
      params.visitRecord(buildLoadedChunkSpanSearchRecord(traceGraph, spanSource, spanRef)) !==
      false;
    return shouldContinue && visitedCount < params.limit;
  };

  if (exactExternalIdQuery) {
    const shouldContinue = visitLoadedChunkExactExternalIdSpanRefs(
      traceGraph,
      exactExternalIdQuery,
      spanRef => {
        const spanSource = traceGraph.getSpanDetailSource(spanRef);
        if (!spanSource) {
          return;
        }
        exactMatchedSpanRefs?.add(spanRef);
        return visitMatchingRecord(spanSource, spanRef);
      }
    );
    if (!shouldContinue) {
      return visitedCount;
    }
  }

  visitLoadedChunkSpanRefs(traceGraph, spanRef => {
    if (exactMatchedSpanRefs?.has(spanRef)) {
      return;
    }
    const spanSource = traceGraph.getSpanDetailSource(spanRef);
    if (!spanSource) {
      return;
    }
    const searchText = params.getSearchText?.(spanSource) ?? buildSpanSearchText(spanSource);
    if (!params.matchesSearchText(searchText)) {
      return;
    }
    return visitMatchingRecord(spanSource, spanRef);
  });
  return visitedCount;
}

/**
 * Visits exact external-id span refs through Arrow UTF-8 search without scanning every span row.
 *
 * @returns Whether the visitor reached the end of the matching loaded span refs.
 */
function visitLoadedChunkExactExternalIdSpanRefs(
  traceGraph: TraceGraph,
  exactExternalIdQuery: string,
  visitSpanRef: (spanRef: SpanRef) => boolean | void
): boolean {
  const requestedView = makeUtf8StringView(exactExternalIdQuery);
  for (const chunk of traceGraph.chunks) {
    const externalSpanIdColumn = chunk.spanTable.getChild('external_span_id');
    if (!externalSpanIdColumn) {
      continue;
    }

    let rowIndex = arrowFindUtf8(externalSpanIdColumn, requestedView);
    while (rowIndex !== -1) {
      const spanRefRowIndex = getArrowTraceChunkSpanRefRowIndex(chunk, rowIndex);
      if (
        spanRefRowIndex != null &&
        visitSpanRef(encodeSpanRef(chunk.chunkIndex, spanRefRowIndex)) === false
      ) {
        return false;
      }
      rowIndex = arrowFindUtf8(externalSpanIdColumn, requestedView, rowIndex + 1);
    }
  }
  return true;
}

/**
 * Visits loaded span refs in graph search order without materializing span detail rows.
 *
 * @returns Whether the visitor reached the end of the loaded span refs.
 */
function visitLoadedChunkSpanRefs(
  traceGraph: TraceGraph,
  visitSpanRef: (spanRef: SpanRef) => boolean | void
): boolean {
  if (traceGraph.spanRefs) {
    for (const spanRef of traceGraph.spanRefs) {
      if (visitSpanRef(spanRef) === false) {
        return false;
      }
    }
    return true;
  }

  for (const chunk of traceGraph.chunks) {
    for (let spanRefRowIndex = 0; spanRefRowIndex < chunk.spanTable.numRows; spanRefRowIndex += 1) {
      const rowIndex = getArrowTraceChunkSpanTableRowIndex(chunk, spanRefRowIndex);
      if (rowIndex == null) {
        continue;
      }
      if (visitSpanRef(encodeSpanRef(chunk.chunkIndex, spanRefRowIndex)) === false) {
        return false;
      }
    }
  }
  return true;
}

function buildLoadedChunkSpanSearchRecord(
  traceGraph: TraceGraph,
  spanSource: TraceSpanDetailSource,
  spanRef: SpanRef
): TraceGraphSpanSearchRecord {
  const filterReason = traceGraph.spanFilterReason(spanRef, {
    spanName: spanSource.name
  });
  const threadName =
    spanSource.threadRef == null
      ? String(spanSource.threadId)
      : (traceGraph.getThreadSourceByRef(spanSource.threadRef)?.name ??
        String(spanSource.threadId));
  return {
    spanRef,
    spanId: spanSource.spanId,
    blockName: spanSource.name,
    processName: spanSource.processName,
    threadName,
    primaryTiming: getPrimaryTiming(spanSource),
    keywordsText: spanSource.keywords.join(' '),
    searchText: spanSource.name.toLowerCase(),
    filterMask: filterReason.filterMask,
    filterReason
  };
}

function buildSpanSearchText(source: TraceSpanDetailSource): string {
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
