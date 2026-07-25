import * as arrow from 'apache-arrow';

import {
  buildArrowTraceSameProcessDependencyTableFromColumns,
  buildArrowTraceSpanSidecarTableFromColumns,
  buildArrowTraceSpanTableFromColumns
} from './ingestion/arrow-trace';
import {
  decodeTraceDependencyWaitModeCode,
  traceDependencyKeywordFlagsHasParent
} from './ingestion/trace-dependency-arrow-fields';
import {decodeTraceSpanTimingStatusCode} from './ingestion/trace-span-timing-status-code';

import type {
  ArrowTraceProcessMetadata,
  ArrowTraceSameProcessDependencyTable,
  ArrowTraceSpanSidecarTable,
  ArrowTraceSpanTable,
  TraceSameProcessDependencyArrowColumns,
  TraceSpanArrowColumns,
  TraceSpanArrowSidecarColumns,
  TraceSpanArrowTimingProjectionColumns
} from './ingestion/arrow-trace';
import type {
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceProcessId,
  TraceSameProcessDependency
} from './trace-graph/trace-types';

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
  readonly waitMode?: TraceSameProcessDependencyWaitMode | null;
};

type TraceChunkSourceDependencyTableTypeMap = arrow.TypeMap & {
  /** Dependency family supplied by the parser, for example `parent`. */
  dependencyKind: arrow.Utf8;
  /** Stable source id for the dependency source span. */
  startExternalSpanId: arrow.Utf8;
  /** Stable source id for the dependency destination span. */
  endExternalSpanId: arrow.Utf8;
  /** Optional wait-mode hint used when materializing a runtime dependency. */
  waitMode: arrow.Utf8;
};

/** Source dependency rows carried by parser-local chunk data. */
export type TraceChunkSourceDependencyTable = arrow.Table<TraceChunkSourceDependencyTableTypeMap>;

/** Column-oriented Arrow source dependency payload used by chunk transport. */
export type TraceChunkSourceDependencyArrowColumns = {
  /** Dependency family supplied by the parser, for example `parent`. */
  readonly dependencyKind: string[];
  /** Stable source ids for dependency source spans. */
  readonly startExternalSpanId: string[];
  /** Stable source ids for dependency destination spans. */
  readonly endExternalSpanId: string[];
  /** Optional wait-mode hints used when materializing runtime dependencies. */
  readonly waitMode?: Array<TraceSameProcessDependencyWaitMode | null>;
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
  /** Number of kept span rows whose canonical timing status is `not-started`. */
  readonly notStartedSpanCount: number;
  /** Number of kept span rows whose canonical timing status is `not-finished`. */
  readonly unfinishedSpanCount: number;
  /** Number of source rows rejected during parser-local normalization. */
  readonly invalidRecordCount: number;
  /** Earliest canonical chunk timing bound in UTC milliseconds, when one exists. */
  readonly minTimeMs: number | null;
  /** Latest canonical chunk timing bound in UTC milliseconds, when one exists. */
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
  /** Compatibility owning process id when this parser-local chunk is process-scoped. */
  readonly processId?: TraceProcessId | null;
  /** Canonical Arrow span table for this chunk. */
  readonly spanTable: ArrowTraceSpanTable;
  /**
   * Same-process dependency rows already resolved for this storage chunk.
   *
   * Same-process is a graph category; it does not require both endpoint rows to originate from
   * the same source chunk.
   */
  readonly resolvedSameProcessDependencyTable: ArrowTraceSameProcessDependencyTable;
  /** Optional row-aligned Arrow sidecar table for this chunk. */
  readonly spanSidecarTable?: ArrowTraceSpanSidecarTable;
  /** Unresolved cross-process endpoint groups retained until selected chunks are stitched. */
  readonly crossProcessEndpointsByEndpointId?: Readonly<
    Record<TraceCrossProcessEndpointId, readonly TraceCrossProcessEndpoint[]>
  >;
  /**
   * Neutral source-level dependency rows awaiting graph-level endpoint resolution and category
   * classification.
   */
  readonly sourceDependencyTable?: TraceChunkSourceDependencyTable;
  /** Row-level time-window overlap metadata. */
  readonly rowWindowTable?: TraceChunkRowWindowTable;
  /** Parser-local diagnostics for this chunk. */
  readonly diagnostics: TraceChunkDiagnostics;
  /** Ref lifecycle marker for parser-local output. */
  readonly refState: 'parser-local';
};

/** JSON-safe same-process dependency metadata embedded in chunk process metadata. */
export type JSONTraceChunkSameProcessDependency = Omit<TraceSameProcessDependency, 'keywords'> & {
  /** Dependency keyword labels serialized as plain JSON arrays. */
  readonly keywords: readonly string[];
};

/** JSON-safe process metadata embedded in one trace chunk transport payload. */
export type JSONTraceChunkProcessMetadata = Omit<
  ArrowTraceProcessMetadata,
  'sameProcessDependencies'
> & {
  /** Optional same-process dependency metadata with Set-backed fields converted to JSON arrays. */
  readonly sameProcessDependencies?: readonly JSONTraceChunkSameProcessDependency[];
};

/** JSON-safe transport form for one parser-local {@link TraceChunkData} payload. */
export type JSONTraceChunkData = {
  /** Payload discriminator for JSON-safe trace chunk data. */
  readonly type: 'json-trace-chunk-data';
  /** Store-local chunk key that owns this normalized payload. */
  readonly chunkKey: string;
  /** JSON-safe metadata for every process represented by rows in this chunk. */
  readonly processes: readonly JSONTraceChunkProcessMetadata[];
  /** Compatibility owning process id when this parser-local chunk is process-scoped. */
  readonly processId?: TraceProcessId | null;
  /** Column-oriented span payload used to rebuild the chunk span table. */
  readonly spanColumns: TraceSpanArrowColumns;
  /** Column-oriented dependency payload used to rebuild the resolved chunk dependency table. */
  readonly sameProcessDependencyColumns: TraceSameProcessDependencyArrowColumns;
  /** Optional column-oriented sidecar payload used to rebuild the chunk sidecar table. */
  readonly spanSidecarColumns?: TraceSpanArrowSidecarColumns;
  /** Unresolved cross-process endpoint groups retained until selected chunks are stitched. */
  readonly crossProcessEndpointsByEndpointId?: Readonly<
    Record<TraceCrossProcessEndpointId, readonly TraceCrossProcessEndpoint[]>
  >;
  /** Column-oriented source dependency rows that may resolve across chunk boundaries. */
  readonly sourceDependencyColumns?: TraceChunkSourceDependencyArrowColumns;
  /** Row-level time-window overlap metadata. */
  readonly rowWindowTable?: TraceChunkRowWindowTable;
  /** Parser-local diagnostics for this chunk. */
  readonly diagnostics: TraceChunkDiagnostics;
};

/** Builds one source dependency table from parser-normalized rows. */
export function buildTraceChunkSourceDependencyTable(
  rows: readonly TraceChunkSourceDependencyRow[]
): TraceChunkSourceDependencyTable {
  return buildTraceChunkSourceDependencyTableFromColumns({
    dependencyKind: rows.map(row => row.dependencyKind),
    startExternalSpanId: rows.map(row => row.startExternalSpanId),
    endExternalSpanId: rows.map(row => row.endExternalSpanId),
    waitMode: rows.map(row => row.waitMode ?? null)
  });
}

/** Builds one source dependency Arrow table from column-oriented payloads. */
export function buildTraceChunkSourceDependencyTableFromColumns(
  columns: TraceChunkSourceDependencyArrowColumns
): TraceChunkSourceDependencyTable {
  const rowCount = columns.dependencyKind.length;
  if (
    columns.startExternalSpanId.length !== rowCount ||
    columns.endExternalSpanId.length !== rowCount ||
    (columns.waitMode != null && columns.waitMode.length !== rowCount)
  ) {
    throw new Error('Expected source dependency columns to preserve row count.');
  }
  return new arrow.Table({
    dependencyKind: arrow.vectorFromArray(columns.dependencyKind, new arrow.Utf8()),
    startExternalSpanId: arrow.vectorFromArray(columns.startExternalSpanId, new arrow.Utf8()),
    endExternalSpanId: arrow.vectorFromArray(columns.endExternalSpanId, new arrow.Utf8()),
    waitMode: arrow.vectorFromArray(
      columns.waitMode ?? Array(rowCount).fill(null),
      new arrow.Utf8()
    )
  }) as unknown as TraceChunkSourceDependencyTable;
}

/** Reads one parser-normalized source dependency row from its Arrow table. */
export function readTraceChunkSourceDependencyRow(
  table: Readonly<TraceChunkSourceDependencyTable>,
  rowIndex: number
): TraceChunkSourceDependencyRow | null {
  if (rowIndex < 0 || rowIndex >= table.numRows) {
    return null;
  }
  const dependencyKind = table.getChild('dependencyKind')?.get(rowIndex);
  const startExternalSpanId = table.getChild('startExternalSpanId')?.get(rowIndex);
  const endExternalSpanId = table.getChild('endExternalSpanId')?.get(rowIndex);
  if (
    typeof dependencyKind !== 'string' ||
    typeof startExternalSpanId !== 'string' ||
    typeof endExternalSpanId !== 'string'
  ) {
    return null;
  }
  const waitMode = table.getChild('waitMode')?.get(rowIndex);
  return {
    dependencyKind,
    startExternalSpanId,
    endExternalSpanId,
    ...(typeof waitMode === 'string' && waitMode.length > 0
      ? {waitMode: waitMode as TraceSameProcessDependencyWaitMode}
      : {})
  };
}

/** Reads parser-normalized source dependency rows from their Arrow table. */
export function readTraceChunkSourceDependencyRows(
  table: Readonly<TraceChunkSourceDependencyTable>
): TraceChunkSourceDependencyRow[] {
  const rows: TraceChunkSourceDependencyRow[] = [];
  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    const row = readTraceChunkSourceDependencyRow(table, rowIndex);
    if (row) {
      rows.push(row);
    }
  }
  return rows;
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
    processId: data.processId ?? null,
    spanTable: buildArrowTraceSpanTableFromColumns(data.spanColumns),
    resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTableFromColumns(
      data.sameProcessDependencyColumns
    ),
    spanSidecarTable: data.spanSidecarColumns
      ? buildArrowTraceSpanSidecarTableFromColumns(data.spanSidecarColumns)
      : undefined,
    crossProcessEndpointsByEndpointId: data.crossProcessEndpointsByEndpointId,
    sourceDependencyTable: data.sourceDependencyColumns
      ? buildTraceChunkSourceDependencyTableFromColumns(data.sourceDependencyColumns)
      : undefined,
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
    processId: data.processId ?? null,
    spanColumns: readTraceSpanArrowColumns(data.spanTable),
    sameProcessDependencyColumns: readTraceSameProcessDependencyArrowColumns(
      data.resolvedSameProcessDependencyTable
    ),
    spanSidecarColumns: data.spanSidecarTable
      ? readTraceSpanArrowSidecarColumns(data.spanSidecarTable)
      : undefined,
    crossProcessEndpointsByEndpointId: data.crossProcessEndpointsByEndpointId,
    sourceDependencyColumns: data.sourceDependencyTable
      ? readTraceChunkSourceDependencyArrowColumns(data.sourceDependencyTable)
      : undefined,
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

type TraceSameProcessDependencyWaitMode = 'start-to-start' | 'end-to-start' | 'end-to-end';

type ArrowReadableTable = {
  readonly numRows: number;
  getChild(name: string): {get(rowIndex: number): unknown} | null | undefined;
};

function toJSONTraceChunkProcessMetadata(
  process: ArrowTraceProcessMetadata
): JSONTraceChunkProcessMetadata {
  return {
    ...process,
    sameProcessDependencies: process.sameProcessDependencies?.map(
      toJSONTraceChunkSameProcessDependency
    )
  };
}

function toArrowTraceChunkProcessMetadata(
  process: JSONTraceChunkProcessMetadata
): ArrowTraceProcessMetadata {
  return {
    ...process,
    sameProcessDependencies: process.sameProcessDependencies?.map(toTraceSameProcessDependency)
  };
}

function toJSONTraceChunkSameProcessDependency(
  dependency: TraceSameProcessDependency
): JSONTraceChunkSameProcessDependency {
  return {
    ...dependency,
    keywords: Array.from(dependency.keywords)
  };
}

function toTraceSameProcessDependency(
  dependency: JSONTraceChunkSameProcessDependency
): TraceSameProcessDependency {
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
    status: readTraceSpanTimingStatusCodeColumn(table),
    start_time_ms: readNumberColumn(table, 'start_time_ms'),
    end_time_ms: readNumberColumn(table, 'end_time_ms'),
    duration_ms: readNumberColumn(table, 'duration_ms'),
    layout_top_y: readOptionalNullableNumberColumn(table, 'layout_top_y'),
    layout_height: readOptionalNullableNumberColumn(table, 'layout_height')
  };
}

/** Decodes canonical compact span timing-status scalars for JSON-safe chunk transport. */
function readTraceSpanTimingStatusCodeColumn(
  table: ArrowTraceSpanTable
): TraceSpanArrowColumns['status'] {
  return readNumberColumn(table, 'status_code').map(statusCode => {
    const status = decodeTraceSpanTimingStatusCode(statusCode);
    if (!status) {
      throw new Error('Expected canonical span timing-status code ' + statusCode + '.');
    }
    return status;
  });
}

function readTraceSameProcessDependencyArrowColumns(
  table: ArrowTraceSameProcessDependencyTable
): TraceSameProcessDependencyArrowColumns {
  return {
    dependencyId: readOptionalStringColumn(table, 'dependencyId'),
    startSpanRef: readOptionalNullableNumberColumn(table, 'startSpanRef'),
    startSpanId: readOptionalStringColumn(table, 'startSpanId'),
    endSpanRef: readOptionalNullableNumberColumn(table, 'endSpanRef'),
    endSpanId: readOptionalStringColumn(table, 'endSpanId'),
    waitMode: readTraceDependencyWaitModeCodeColumn(table),
    bidirectional: readBooleanColumn(table, 'bidirectional'),
    waitTimeMs: readNumberColumn(table, 'waitTimeMs'),
    keywords: readOptionalStringListColumn(table, 'keywords'),
    hasParentKeyword: readNumberColumn(table, 'keywordFlags').map(keywordFlags =>
      traceDependencyKeywordFlagsHasParent(keywordFlags)
    ),
    userDataJson: readOptionalNullableStringColumn(table, 'userDataJson')
  };
}

/** Decodes canonical compact dependency wait-mode scalars for JSON-safe chunk transport. */
function readTraceDependencyWaitModeCodeColumn(
  table: ArrowTraceSameProcessDependencyTable
): TraceSameProcessDependencyWaitMode[] {
  return readNumberColumn(table, 'waitModeCode').map(waitModeCode => {
    const waitMode = decodeTraceDependencyWaitModeCode(waitModeCode);
    if (!waitMode) {
      throw new Error('Expected canonical dependency wait-mode code ' + waitModeCode + '.');
    }
    return waitMode;
  });
}

function readTraceSpanArrowSidecarColumns(
  table: ArrowTraceSpanSidecarTable
): TraceSpanArrowSidecarColumns {
  return {
    rowCount: table.numRows,
    keywords: readOptionalStringListColumn(table, 'keywords'),
    crossProcessEndpointId: readOptionalNullableStringColumn(table, 'crossProcessEndpointId'),
    userDataJson: readOptionalNullableStringColumn(table, 'userDataJson'),
    timings: readTraceSpanArrowTimingProjectionColumns(table),
    timingsJson: readOptionalNullableStringColumn(table, 'timingsJson')
  };
}

/** Reads Arrow-native secondary timing projections into JSON-safe sidecar columns. */
function readTraceSpanArrowTimingProjectionColumns(
  table: ArrowTraceSpanSidecarTable
): Readonly<Record<string, TraceSpanArrowTimingProjectionColumns>> | undefined {
  const timingsColumn = table.getChild('timings') as
    | arrow.Vector<arrow.Struct<arrow.TypeMap>>
    | null
    | undefined;
  if (!timingsColumn) {
    return undefined;
  }

  const timingColumns = Object.fromEntries(
    timingsColumn.type.children.flatMap((field, timingFieldIndex) => {
      const timingColumn = timingsColumn.getChildAt(timingFieldIndex) as
        | arrow.Vector<arrow.Struct<arrow.TypeMap>>
        | null
        | undefined;
      if (!timingColumn) {
        return [];
      }
      return [
        [
          field.name,
          {
            statusCode: readTraceSpanArrowTimingFieldColumn(
              timingColumn,
              'status_code',
              table.numRows
            ),
            startTimeMs: readTraceSpanArrowTimingFieldColumn(
              timingColumn,
              'start_time_ms',
              table.numRows
            ),
            endTimeMs: readTraceSpanArrowTimingFieldColumn(
              timingColumn,
              'end_time_ms',
              table.numRows
            ),
            durationMs: readTraceSpanArrowTimingFieldColumn(
              timingColumn,
              'duration_ms',
              table.numRows
            )
          } satisfies TraceSpanArrowTimingProjectionColumns
        ] as const
      ];
    })
  );
  return Object.keys(timingColumns).length > 0 ? timingColumns : undefined;
}

/** Reads one nullable scalar field from an Arrow-native secondary timing projection. */
function readTraceSpanArrowTimingFieldColumn(
  timingColumn: arrow.Vector<arrow.Struct<arrow.TypeMap>>,
  fieldName: string,
  rowCount: number
): Array<number | null> {
  const fieldIndex = timingColumn.type.children.findIndex(field => field.name === fieldName);
  const fieldColumn = fieldIndex < 0 ? null : timingColumn.getChildAt(fieldIndex);
  return Array.from({length: rowCount}, (_, rowIndex) =>
    toFiniteNumber(fieldColumn?.get(rowIndex))
  );
}

function readTraceChunkSourceDependencyArrowColumns(
  table: TraceChunkSourceDependencyTable
): TraceChunkSourceDependencyArrowColumns {
  return {
    dependencyKind: readStringColumn(table, 'dependencyKind'),
    startExternalSpanId: readStringColumn(table, 'startExternalSpanId'),
    endExternalSpanId: readStringColumn(table, 'endExternalSpanId'),
    waitMode: readOptionalNullableStringColumn(table, 'waitMode')?.map(waitMode =>
      waitMode == null ? null : (waitMode as TraceSameProcessDependencyWaitMode)
    )
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

/** Reads one optional string-valued Arrow column when the table stores it. */
function readOptionalStringColumn(
  table: ArrowReadableTable,
  columnName: string
): string[] | undefined {
  return table.getChild(columnName) ? readStringColumn(table, columnName) : undefined;
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
