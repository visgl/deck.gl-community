import {deserializeArrowTraceJson} from '../ingestion/arrow-trace-json';
import {encodeCrossProcessDependencyRef} from './trace-id-encoder';

import type {ArrowTraceCrossProcessDependencyTable} from '../ingestion/arrow-trace';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceSpanId
} from './trace-types';

type ArrowTraceCrossProcessDependencyFieldName = Parameters<
  ArrowTraceCrossProcessDependencyTable['getChild']
>[0];

/** Parameters used to materialize cross-process dependency objects from Arrow rows. */
export type TraceCrossProcessDependencyArrowAccessParams = {
  /** Canonical graph-global Arrow cross-process dependency table. */
  readonly crossProcessDependencyTable: Readonly<ArrowTraceCrossProcessDependencyTable>;
};

/** Returns one cross-process dependency object from a canonical Arrow dependency row. */
export function materializeTraceCrossProcessDependencyFromArrowRow(
  params: TraceCrossProcessDependencyArrowAccessParams & {
    /** Graph-global cross-process dependency row index to materialize. */
    readonly rowIndex: number;
  }
): TraceCrossProcessDependency {
  const {crossProcessDependencyTable, rowIndex} = params;
  const dependencyId = readString(crossProcessDependencyTable, 'dependencyId', rowIndex);
  const endpointId = readString(crossProcessDependencyTable, 'endpointId', rowIndex);
  const startSpanId = readString(crossProcessDependencyTable, 'startSpanId', rowIndex);
  const endSpanId = readString(crossProcessDependencyTable, 'endSpanId', rowIndex);
  const waitMode = crossProcessDependencyTable.getChild('waitMode')?.get(rowIndex);
  if (
    dependencyId == null ||
    endpointId == null ||
    startSpanId == null ||
    endSpanId == null ||
    !isTraceCrossProcessDependencyWaitMode(waitMode)
  ) {
    throw new Error(`Invalid cross-process dependency Arrow row ${rowIndex}`);
  }

  return {
    type: 'trace-cross-process-dependency',
    dependencyRef: encodeCrossProcessDependencyRef(rowIndex),
    dependencyId: dependencyId as TraceDependencyId,
    endpointId: endpointId as TraceCrossProcessEndpointId,
    startRankNum: readNumber(crossProcessDependencyTable, 'startRankNum', rowIndex),
    endRankNum: readNumber(crossProcessDependencyTable, 'endRankNum', rowIndex),
    startSpanRef: readSpanRef(crossProcessDependencyTable, 'startSpanRef', rowIndex),
    startSpanId: startSpanId as TraceSpanId,
    endSpanRef: readSpanRef(crossProcessDependencyTable, 'endSpanRef', rowIndex),
    endSpanId: endSpanId as TraceSpanId,
    waitMode,
    bidirectional: readBoolean(crossProcessDependencyTable, 'bidirectional', rowIndex),
    topology: readString(crossProcessDependencyTable, 'topology', rowIndex) ?? '',
    waitTimeMs: readNumber(crossProcessDependencyTable, 'waitTimeMs', rowIndex),
    waiting: readBoolean(crossProcessDependencyTable, 'waiting', rowIndex),
    waitNotFinished: readBoolean(crossProcessDependencyTable, 'waitNotFinished', rowIndex),
    keywords: readKeywords(crossProcessDependencyTable, rowIndex),
    userData: deserializeArrowTraceJson<Record<string, unknown>>(
      readString(crossProcessDependencyTable, 'userDataJson', rowIndex)
    )
  };
}

/** Iterates materialized cross-process dependency objects from an Arrow table. */
export function* iterateTraceCrossProcessDependenciesFromArrowTable(
  params: TraceCrossProcessDependencyArrowAccessParams
): IterableIterator<TraceCrossProcessDependency> {
  for (let rowIndex = 0; rowIndex < params.crossProcessDependencyTable.numRows; rowIndex += 1) {
    yield materializeTraceCrossProcessDependencyFromArrowRow({...params, rowIndex});
  }
}

/** Materializes cross-process dependency objects from an Arrow table at an export boundary. */
export function materializeTraceCrossProcessDependenciesFromArrowTable(
  params: TraceCrossProcessDependencyArrowAccessParams
): TraceCrossProcessDependency[] {
  return Array.from(iterateTraceCrossProcessDependenciesFromArrowTable(params));
}

/** Reads one optional Arrow Utf8 cell as a plain string. */
function readString(
  table: Readonly<ArrowTraceCrossProcessDependencyTable>,
  columnName: ArrowTraceCrossProcessDependencyFieldName,
  rowIndex: number
): string | null {
  const value = table.getChild(columnName)?.get(rowIndex);
  return typeof value === 'string' ? value : null;
}

/** Reads one Arrow numeric cell as a finite JavaScript number. */
function readNumber(
  table: Readonly<ArrowTraceCrossProcessDependencyTable>,
  columnName: ArrowTraceCrossProcessDependencyFieldName,
  rowIndex: number
): number {
  const value = table.getChild(columnName)?.get(rowIndex);
  const numberValue = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

/** Reads one optional Arrow span-ref cell as a packed span ref. */
function readSpanRef(
  table: Readonly<ArrowTraceCrossProcessDependencyTable>,
  columnName: ArrowTraceCrossProcessDependencyFieldName,
  rowIndex: number
): SpanRef | undefined {
  const value = table.getChild(columnName)?.get(rowIndex);
  if (value == null) {
    return undefined;
  }
  const spanRef = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isSafeInteger(spanRef) && spanRef >= 0 ? (spanRef as SpanRef) : undefined;
}

/** Reads one Arrow boolean cell. */
function readBoolean(
  table: Readonly<ArrowTraceCrossProcessDependencyTable>,
  columnName: ArrowTraceCrossProcessDependencyFieldName,
  rowIndex: number
): boolean {
  return Boolean(table.getChild(columnName)?.get(rowIndex));
}

/** Reads one Arrow dependency keyword list. */
function readKeywords(
  table: Readonly<ArrowTraceCrossProcessDependencyTable>,
  rowIndex: number
): Set<string> {
  const keywords = table.getChild('keywords')?.get(rowIndex);
  if (keywords == null) {
    return new Set(table.getChild('hasParentKeyword')?.get(rowIndex) ? ['PARENT'] : []);
  }
  return new Set(Array.from(keywords as Iterable<unknown>, keyword => String(keyword)));
}

/** Returns whether one Arrow wait-mode cell is a supported dependency wait mode. */
function isTraceCrossProcessDependencyWaitMode(
  value: unknown
): value is TraceCrossProcessDependency['waitMode'] {
  return value === 'end-to-start' || value === 'end-to-end' || value === 'start-to-start';
}
