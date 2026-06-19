import {
  buildArrowTraceLocalDependencyTableFromColumns,
  buildArrowTraceSpanSidecarTableFromColumns,
  buildArrowTraceSpanTableFromColumns
} from './ingestion/arrow-trace';

import type {
  ArrowTraceLocalDependencyTable,
  ArrowTraceProcessMetadata,
  ArrowTraceSpanSidecarTable,
  ArrowTraceSpanTable,
  TraceLocalDependencyArrowColumns,
  TraceSpanArrowColumns,
  TraceSpanArrowSidecarColumns,
  TraceSpanArrowSidecarRow
} from './ingestion/arrow-trace';
import type {TraceLocalDependency} from './trace-graph/trace-types';

/** Inclusive trace-chunk timing envelope used to test active window visibility. */
export type TraceChunkSpanOverlapRange = {
  /** Inclusive UTC millisecond start for this chunk row envelope. */
  readonly startTimeMs: number;
  /** Inclusive UTC millisecond end for this chunk row envelope. */
  readonly endTimeMs: number;
};

/** Source dependency row emitted by parsers before store-level ref resolution. */
export type TraceChunkSourceDependencyRow = {
  /** Dependency family supplied by the parser, for example `parent`. */
  readonly dependencyKind: string;
  /** Stable source id for the dependency source span. */
  readonly startExternalSpanId: string;
  /** Stable source id for the dependency destination span. */
  readonly endExternalSpanId: string;
  /** Optional wait-mode hint used when materializing a runtime dependency. */
  readonly waitMode?: TraceLocalDependencyWaitMode | null;
};

/** Source dependency table carried by parser-local chunk data. */
export type TraceChunkSourceDependencyTable = {
  /** Dependency rows in parser-provided order. */
  readonly rows: readonly TraceChunkSourceDependencyRow[];
};

/** Row-window metadata carried by parser-local chunk data. */
export type TraceChunkRowWindowTable = {
  /** Window-overlap envelopes aligned by chunk-local span-ref row index. */
  readonly overlapRangesByRow: readonly (readonly TraceChunkSpanOverlapRange[])[];
};

/** Chunk-local diagnostics emitted by parsers and extended by store indexing. */
export type TraceChunkDiagnostics = {
  /** Number of source rows kept after parser-local normalization. */
  readonly rowCount: number;
  /** Number of source rows rejected during parser-local normalization. */
  readonly invalidRecordCount: number;
  /** Earliest chunk row timing bound in UTC milliseconds, when one exists. */
  readonly minTimeMs: number | null;
  /** Latest chunk row timing bound in UTC milliseconds, when one exists. */
  readonly maxTimeMs: number | null;
  /** Parser-local warning counters kept for diagnostics. */
  readonly warningCounters: Readonly<Record<string, number>>;
};

/** Parser/ingester output consumed by `TraceChunkStore.add`. */
export type TraceChunkData = {
  /** Payload discriminator for parser-local chunk data. */
  readonly type: 'trace-chunk-data';
  /** Store-local chunk key that owns this normalized payload. */
  readonly chunkKey: string;
  /** Metadata for every process represented by rows in this chunk. */
  readonly processes: readonly ArrowTraceProcessMetadata[];
  /** Canonical Arrow span table for this chunk. */
  readonly spanTable: ArrowTraceSpanTable;
  /** Canonical Arrow local dependency table for chunk-local dependencies. */
  readonly localDependencyTable: ArrowTraceLocalDependencyTable;
  /** Optional row-aligned compatibility payloads kept during migration. */
  readonly spanSidecarRows?: readonly TraceSpanArrowSidecarRow[];
  /** Optional row-aligned Arrow sidecar table for this chunk. */
  readonly spanSidecarTable?: ArrowTraceSpanSidecarTable;
  /** Source-level dependency rows that may resolve across chunk boundaries. */
  readonly sourceDependencyTable?: TraceChunkSourceDependencyTable;
  /** Row-level time-window overlap metadata. */
  readonly rowWindowTable?: TraceChunkRowWindowTable;
  /** Parser-local diagnostics for this chunk. */
  readonly diagnostics: TraceChunkDiagnostics;
  /** Ref lifecycle marker for parser-local output. */
  readonly refState: 'parser-local';
};

/** JSON-safe local dependency metadata embedded in chunk process metadata. */
export type JSONTraceChunkLocalDependency = Omit<TraceLocalDependency, 'keywords'> & {
  /** Dependency keyword labels serialized as plain JSON arrays. */
  readonly keywords: readonly string[];
};

/** JSON-safe process metadata embedded in one trace chunk transport payload. */
export type JSONTraceChunkProcessMetadata = Omit<ArrowTraceProcessMetadata, 'localDependencies'> & {
  /** Optional local dependency metadata with Set-backed fields converted to JSON arrays. */
  readonly localDependencies?: readonly JSONTraceChunkLocalDependency[];
};

/** JSON-safe transport form for one parser-local {@link TraceChunkData} payload. */
export type JSONTraceChunkData = {
  /** Payload discriminator for JSON-safe trace chunk data. */
  readonly type: 'json-trace-chunk-data';
  /** Store-local chunk key that owns this normalized payload. */
  readonly chunkKey: string;
  /** JSON-safe metadata for every process represented by rows in this chunk. */
  readonly processes: readonly JSONTraceChunkProcessMetadata[];
  /** Column-oriented span payload used to rebuild the chunk span table. */
  readonly spanColumns: TraceSpanArrowColumns;
  /** Column-oriented dependency payload used to rebuild the chunk local dependency table. */
  readonly localDependencyColumns: TraceLocalDependencyArrowColumns;
  /** Optional column-oriented sidecar payload used to rebuild the chunk sidecar table. */
  readonly spanSidecarColumns?: TraceSpanArrowSidecarColumns;
  /** Optional row-aligned compatibility sidecars kept with this chunk. */
  readonly spanSidecarRows?: readonly TraceSpanArrowSidecarRow[];
  /** Source-level dependency rows that may resolve across chunk boundaries. */
  readonly sourceDependencyTable?: TraceChunkSourceDependencyTable;
  /** Row-level time-window overlap metadata. */
  readonly rowWindowTable?: TraceChunkRowWindowTable;
  /** Parser-local diagnostics for this chunk. */
  readonly diagnostics: TraceChunkDiagnostics;
};

/** Builds one source dependency table from parser-normalized rows. */
export function buildTraceChunkSourceDependencyTable(
  rows: readonly TraceChunkSourceDependencyRow[]
): TraceChunkSourceDependencyTable {
  return {rows};
}

/** Builds one row-window table from parser-normalized row overlap ranges. */
export function buildTraceChunkRowWindowTable(
  overlapRangesByRow: readonly (readonly TraceChunkSpanOverlapRange[])[]
): TraceChunkRowWindowTable {
  return {overlapRangesByRow};
}

/** Returns whether a payload is parser-local trace chunk data. */
export function isTraceChunkData(payload: unknown): payload is TraceChunkData {
  return (
    payload != null &&
    typeof payload === 'object' &&
    (payload as {readonly type?: unknown}).type === 'trace-chunk-data'
  );
}

/** Builds parser-local chunk data from a JSON-safe trace chunk transport payload. */
export function buildTraceChunkDataFromJSONTraceChunkData(
  data: JSONTraceChunkData
): TraceChunkData {
  return {
    type: 'trace-chunk-data',
    chunkKey: data.chunkKey,
    processes: data.processes.map(toArrowTraceChunkProcessMetadata),
    spanTable: buildArrowTraceSpanTableFromColumns(data.spanColumns),
    localDependencyTable: buildArrowTraceLocalDependencyTableFromColumns(
      data.localDependencyColumns
    ),
    spanSidecarRows: data.spanSidecarRows,
    spanSidecarTable: data.spanSidecarColumns
      ? buildArrowTraceSpanSidecarTableFromColumns(data.spanSidecarColumns)
      : undefined,
    sourceDependencyTable: data.sourceDependencyTable,
    rowWindowTable: data.rowWindowTable,
    diagnostics: data.diagnostics,
    refState: 'parser-local'
  };
}

/** Builds a JSON-safe trace chunk transport payload from parser-local chunk data. */
export function buildJSONTraceChunkDataFromTraceChunkData(
  data: TraceChunkData
): JSONTraceChunkData {
  return {
    type: 'json-trace-chunk-data',
    chunkKey: data.chunkKey,
    processes: data.processes.map(toJSONTraceChunkProcessMetadata),
    spanColumns: readTraceSpanArrowColumns(data.spanTable),
    localDependencyColumns: readTraceLocalDependencyArrowColumns(data.localDependencyTable),
    spanSidecarColumns: data.spanSidecarTable
      ? readTraceSpanArrowSidecarColumns(data.spanSidecarTable)
      : undefined,
    spanSidecarRows: data.spanSidecarRows,
    sourceDependencyTable: data.sourceDependencyTable,
    rowWindowTable: data.rowWindowTable,
    diagnostics: data.diagnostics
  };
}

/** Returns whether a payload is JSON-safe trace chunk transport data. */
export function isJSONTraceChunkData(payload: unknown): payload is JSONTraceChunkData {
  return (
    payload != null &&
    typeof payload === 'object' &&
    (payload as {readonly type?: unknown}).type === 'json-trace-chunk-data'
  );
}

type TraceLocalDependencyWaitMode = 'start-to-start' | 'end-to-start' | 'end-to-end';

type ArrowReadableTable = {
  readonly numRows: number;
  getChild(name: string): {get(rowIndex: number): unknown} | null | undefined;
};

function toJSONTraceChunkProcessMetadata(
  process: ArrowTraceProcessMetadata
): JSONTraceChunkProcessMetadata {
  return {
    ...process,
    localDependencies: process.localDependencies?.map(toJSONTraceChunkLocalDependency)
  };
}

function toArrowTraceChunkProcessMetadata(
  process: JSONTraceChunkProcessMetadata
): ArrowTraceProcessMetadata {
  return {
    ...process,
    localDependencies: process.localDependencies?.map(toTraceLocalDependency)
  };
}

function toJSONTraceChunkLocalDependency(
  dependency: TraceLocalDependency
): JSONTraceChunkLocalDependency {
  return {
    ...dependency,
    keywords: Array.from(dependency.keywords)
  };
}

function toTraceLocalDependency(dependency: JSONTraceChunkLocalDependency): TraceLocalDependency {
  return {
    ...dependency,
    keywords: new Set(dependency.keywords)
  };
}

function readTraceSpanArrowColumns(table: ArrowTraceSpanTable): TraceSpanArrowColumns {
  return {
    process_ref: readOptionalNullableNumberColumn(table, 'process_ref'),
    thread_ref: readOptionalNullableNumberColumn(table, 'thread_ref'),
    span_id: readStringColumn(table, 'span_id'),
    external_span_id: readOptionalNullableStringColumn(table, 'external_span_id'),
    thread_id: readStringColumn(table, 'thread_id'),
    name: readStringColumn(table, 'name'),
    source: readOptionalNullableStringColumn(table, 'source'),
    primary_timing_key: readStringColumn(table, 'primary_timing_key'),
    status: readStringColumn(table, 'status'),
    start_time_ms: readNumberColumn(table, 'start_time_ms'),
    end_time_ms: readNumberColumn(table, 'end_time_ms'),
    duration_ms: readNumberColumn(table, 'duration_ms'),
    layout_top_y: readOptionalNullableNumberColumn(table, 'layout_top_y'),
    layout_height: readOptionalNullableNumberColumn(table, 'layout_height')
  };
}

function readTraceLocalDependencyArrowColumns(
  table: ArrowTraceLocalDependencyTable
): TraceLocalDependencyArrowColumns {
  return {
    dependencyRef: readOptionalNumberColumn(table, 'dependencyRef'),
    dependencyId: readStringColumn(table, 'dependencyId'),
    startSpanRef: readOptionalNullableNumberColumn(table, 'startSpanRef'),
    startSpanId: readStringColumn(table, 'startSpanId'),
    endSpanRef: readOptionalNullableNumberColumn(table, 'endSpanRef'),
    endSpanId: readStringColumn(table, 'endSpanId'),
    waitMode: readStringColumn(table, 'waitMode') as TraceLocalDependencyWaitMode[],
    bidirectional: readBooleanColumn(table, 'bidirectional'),
    waitTimeMs: readNumberColumn(table, 'waitTimeMs'),
    keywords: readOptionalStringListColumn(table, 'keywords'),
    hasParentKeyword: readBooleanColumn(table, 'hasParentKeyword')
  };
}

function readTraceSpanArrowSidecarColumns(
  table: ArrowTraceSpanSidecarTable
): TraceSpanArrowSidecarColumns {
  return {
    incomingLocalDependencyRefs: readNumberListColumn(table, 'incomingLocalDependencyRefs'),
    outgoingLocalDependencyRefs: readNumberListColumn(table, 'outgoingLocalDependencyRefs'),
    localDependencyRefs: readOptionalNumberListColumn(table, 'localDependencyRefs'),
    incomingCrossDependencyRefs: readOptionalNumberListColumn(table, 'incomingCrossDependencyRefs'),
    outgoingCrossDependencyRefs: readOptionalNumberListColumn(table, 'outgoingCrossDependencyRefs'),
    crossDependencyRefs: readOptionalNumberListColumn(table, 'crossDependencyRefs'),
    keywords: readOptionalStringListColumn(table, 'keywords'),
    crossProcessEndpointId: readOptionalNullableStringColumn(table, 'crossProcessEndpointId'),
    userDataJson: readOptionalNullableStringColumn(table, 'userDataJson')
  };
}

function readStringColumn(table: ArrowReadableTable, columnName: string): string[] {
  return readColumn(table, columnName, value => (value == null ? '' : String(value)));
}

function readNumberColumn(table: ArrowReadableTable, columnName: string): number[] {
  return readColumn(table, columnName, value => toFiniteNumber(value) ?? 0);
}

function readBooleanColumn(table: ArrowReadableTable, columnName: string): boolean[] {
  return readColumn(table, columnName, value => Boolean(value));
}

function readNumberListColumn(
  table: ArrowReadableTable,
  columnName: string
): Array<readonly number[]> {
  return readColumn(table, columnName, toNumberArray);
}

function readOptionalNumberColumn(
  table: ArrowReadableTable,
  columnName: string
): number[] | undefined {
  return table.getChild(columnName) ? readNumberColumn(table, columnName) : undefined;
}

function readOptionalNullableNumberColumn(
  table: ArrowReadableTable,
  columnName: string
): Array<number | null> | undefined {
  return table.getChild(columnName)
    ? readColumn(table, columnName, value => toFiniteNumber(value))
    : undefined;
}

function readOptionalNullableStringColumn(
  table: ArrowReadableTable,
  columnName: string
): Array<string | null> | undefined {
  return table.getChild(columnName)
    ? readColumn(table, columnName, value => (value == null ? null : String(value)))
    : undefined;
}

function readOptionalNumberListColumn(
  table: ArrowReadableTable,
  columnName: string
): Array<readonly number[]> | undefined {
  return table.getChild(columnName) ? readNumberListColumn(table, columnName) : undefined;
}

function readOptionalStringListColumn(
  table: ArrowReadableTable,
  columnName: string
): Array<readonly string[]> | undefined {
  return table.getChild(columnName) ? readColumn(table, columnName, toStringArray) : undefined;
}

function readColumn<T>(
  table: ArrowReadableTable,
  columnName: string,
  readValue: (value: unknown) => T
): T[] {
  const column = table.getChild(columnName);
  const values: T[] = [];
  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    values.push(readValue(column?.get(rowIndex)));
  }
  return values;
}

function toFiniteNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const numberValue = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toNumberArray(value: unknown): number[] {
  return toArray(value)
    .map(toFiniteNumber)
    .filter((item): item is number => item != null);
}

function toStringArray(value: unknown): string[] {
  return toArray(value).map(item => String(item));
}

function toArray(value: unknown): unknown[] {
  if (value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'object' && Symbol.iterator in value) {
    return Array.from(value as Iterable<unknown>);
  }
  return [];
}
