import {
  buildArrowTraceSameProcessDependencyTableFromColumns,
  buildArrowTraceSpanSidecarTableFromColumns,
  buildArrowTraceSpanTableFromColumns
} from './ingestion/arrow-trace';
import {
  buildTraceChunkRowWindowTable,
  buildTraceChunkSourceDependencyTableFromColumns
} from './trace-chunk-data';
import {encodeProcessRef, encodeProcessThreadRef} from './trace-graph/trace-id-encoder';

import type {ArrowTraceProcessMetadata} from './ingestion/arrow-trace';
import type {TraceChunkData} from './trace-chunk-data';
import type {
  TraceProcessId,
  TraceSpanAttributePath,
  TraceSpanTiming,
  TraceThread,
  TraceThreadId
} from './trace-graph/trace-types';

/** Array-like column accepted by the physical-span chunk builder. */
export type TracePhysicalSpanColumn<T> =
  | ReadonlyArray<T>
  | {
      /** Number of values available in the column. */
      readonly length: number;
      /** Read one nullable value without materializing the column. */
      get(index: number): T | null;
    };

/** Generic column-oriented physical span payload for one streamed source batch. */
export type TracePhysicalSpanChunkColumns = {
  /** Stable external span ids used for cross-batch identity and dependency resolution. */
  readonly externalSpanIds: TracePhysicalSpanColumn<string>;
  /** Optional parent external span ids aligned with span rows. */
  readonly parentExternalSpanIds?: TracePhysicalSpanColumn<string | null>;
  /** Stable semantic process ids aligned with span rows. */
  readonly processIds: TracePhysicalSpanColumn<string>;
  /** Human-readable process names aligned with span rows. */
  readonly processNames: TracePhysicalSpanColumn<string>;
  /** Stable semantic thread ids aligned with span rows, or null when unknown. */
  readonly threadIds: TracePhysicalSpanColumn<string | null>;
  /** Human-readable thread names aligned with span rows, or null when unknown. */
  readonly threadNames?: TracePhysicalSpanColumn<string | null>;
  /** Human-readable span names aligned with span rows. */
  readonly names: TracePhysicalSpanColumn<string>;
  /** Optional source labels aligned with span rows. */
  readonly sources?: TracePhysicalSpanColumn<string | null>;
  /** Span start timestamps in milliseconds aligned with span rows. */
  readonly startTimeMs: TracePhysicalSpanColumn<number>;
  /** Nullable span end timestamps in milliseconds aligned with span rows. */
  readonly endTimeMs: TracePhysicalSpanColumn<number | null>;
  /** Optional keyword lists aligned with span rows. */
  readonly keywords?: TracePhysicalSpanColumn<readonly string[]>;
  /** Optional pre-serialized user-data JSON aligned with span rows. */
  readonly userDataJson?: TracePhysicalSpanColumn<string | null>;
  /** Optional source user-data rows used to project declared primitive span attributes. */
  readonly spanAttributeRows?: TracePhysicalSpanColumn<Record<string, unknown> | undefined>;
};

/** Options for building one generic physical-span chunk. */
export type BuildTracePhysicalSpanChunkOptions = {
  /** Store-local key identifying this immutable source batch. */
  readonly chunkKey: string;
  /** Optional semantic tags keyed by stable process id. */
  readonly processTagsById?: Readonly<Record<string, readonly string[]>>;
  /** Optional generic process user data keyed by stable process id. */
  readonly processUserDataById?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Declared primitive span attribute paths projected from optional source user-data rows. */
  readonly declaredSpanAttributePaths?: readonly TraceSpanAttributePath[];
};

type MutableProcessMetadata = {
  readonly processId: TraceProcessId;
  readonly name: string;
  readonly rankNum: number;
  readonly threads: TraceThread[];
  readonly threadIndexes: Map<string, number>;
};

/**
 * Build one parser-local Arrow chunk directly from column-oriented physical span data.
 * Invalid rows are dropped and reported in diagnostics; parent ids remain source references for
 * `TraceChunkStore` to resolve after any batch order.
 */
export function buildTracePhysicalSpanChunk(
  columns: TracePhysicalSpanChunkColumns,
  options: BuildTracePhysicalSpanChunkOptions
): TraceChunkData {
  const sourceRowCount = columns.externalSpanIds.length;
  validatePhysicalSpanColumnLengths(columns, sourceRowCount);

  const processes: MutableProcessMetadata[] = [];
  const processIndexes = new Map<string, number>();
  const seenExternalSpanIds = new Set<string>();
  const processRefs: number[] = [];
  const threadRefs: number[] = [];
  const spanIds: string[] = [];
  const externalSpanIds: string[] = [];
  const threadIds: string[] = [];
  const names: string[] = [];
  const sources: Array<string | null> = [];
  const statuses: Array<TraceSpanTiming['status']> = [];
  const startTimesMs: number[] = [];
  const endTimesMs: number[] = [];
  const durationsMs: number[] = [];
  const keywords: Array<readonly string[]> = [];
  const userDataJson: Array<string | null> = [];
  const spanAttributeRows =
    options.declaredSpanAttributePaths?.length && columns.spanAttributeRows
      ? ([] as Array<Record<string, unknown> | undefined>)
      : undefined;
  const dependencyKinds: string[] = [];
  const dependencyStartIds: string[] = [];
  const dependencyEndIds: string[] = [];
  const dependencyWaitModes: Array<'start-to-start'> = [];
  let invalidRecordCount = 0;
  let minTimeMs = Number.POSITIVE_INFINITY;
  let maxTimeMs = Number.NEGATIVE_INFINITY;
  let unfinishedSpanCount = 0;

  for (let rowIndex = 0; rowIndex < sourceRowCount; rowIndex += 1) {
    const externalSpanId = readPhysicalSpanColumn(columns.externalSpanIds, rowIndex);
    const processIdValue = readPhysicalSpanColumn(columns.processIds, rowIndex);
    const processName = readPhysicalSpanColumn(columns.processNames, rowIndex);
    const name = readPhysicalSpanColumn(columns.names, rowIndex);
    const startTimeMs = readPhysicalSpanColumn(columns.startTimeMs, rowIndex);
    const sourceEndTimeMs = readPhysicalSpanColumn(columns.endTimeMs, rowIndex);
    if (
      !isNonEmptyString(externalSpanId) ||
      !isNonEmptyString(processIdValue) ||
      !isNonEmptyString(processName) ||
      !isNonEmptyString(name) ||
      typeof startTimeMs !== 'number' ||
      !Number.isFinite(startTimeMs) ||
      (sourceEndTimeMs != null &&
        (typeof sourceEndTimeMs !== 'number' ||
          !Number.isFinite(sourceEndTimeMs) ||
          sourceEndTimeMs < startTimeMs)) ||
      seenExternalSpanIds.has(externalSpanId)
    ) {
      invalidRecordCount += 1;
      continue;
    }

    seenExternalSpanIds.add(externalSpanId);
    const processIndex = ensurePhysicalSpanProcess(
      processes,
      processIndexes,
      processIdValue,
      processName
    );
    const process = processes[processIndex]!;
    const sourceThreadId = readOptionalPhysicalSpanColumn(columns.threadIds, rowIndex);
    const threadIdValue = isNonEmptyString(sourceThreadId)
      ? sourceThreadId
      : `${processIdValue}:thread:unknown`;
    const sourceThreadName = readOptionalPhysicalSpanColumn(columns.threadNames, rowIndex);
    const threadName = isNonEmptyString(sourceThreadName) ? sourceThreadName : 'Unknown thread';
    const threadIndex = ensurePhysicalSpanThread(process, threadIdValue, threadName);
    const endTimeMs = sourceEndTimeMs ?? startTimeMs;

    processRefs.push(encodeProcessRef(processIndex));
    threadRefs.push(encodeProcessThreadRef(processIndex, threadIndex));
    spanIds.push(externalSpanId);
    externalSpanIds.push(externalSpanId);
    threadIds.push(threadIdValue);
    names.push(name);
    sources.push(readOptionalPhysicalSpanColumn(columns.sources, rowIndex));
    statuses.push(sourceEndTimeMs == null ? 'not-finished' : 'finished');
    startTimesMs.push(startTimeMs);
    endTimesMs.push(endTimeMs);
    durationsMs.push(endTimeMs - startTimeMs);
    keywords.push(readOptionalPhysicalSpanColumn(columns.keywords, rowIndex) ?? []);
    userDataJson.push(readOptionalPhysicalSpanColumn(columns.userDataJson, rowIndex));
    spanAttributeRows?.push(
      readOptionalPhysicalSpanColumn(columns.spanAttributeRows, rowIndex) ?? undefined
    );
    minTimeMs = Math.min(minTimeMs, startTimeMs);
    if (sourceEndTimeMs == null) {
      unfinishedSpanCount += 1;
      maxTimeMs = Math.max(maxTimeMs, startTimeMs + 1);
    } else {
      maxTimeMs = Math.max(maxTimeMs, endTimeMs);
    }

    const parentExternalSpanId = readOptionalPhysicalSpanColumn(
      columns.parentExternalSpanIds,
      rowIndex
    );
    if (isNonEmptyString(parentExternalSpanId) && parentExternalSpanId !== externalSpanId) {
      dependencyKinds.push('parent');
      dependencyStartIds.push(parentExternalSpanId);
      dependencyEndIds.push(externalSpanId);
      dependencyWaitModes.push('start-to-start');
    }
  }

  const processMetadata = processes.map(process =>
    buildPhysicalSpanProcessMetadata(process, options)
  );
  const rowCount = spanIds.length;
  return {
    type: 'trace-chunk-data',
    chunkKey: options.chunkKey,
    processes: processMetadata,
    processId:
      processMetadata.length === 1 ? (processMetadata[0]!.processId as TraceProcessId) : null,
    spanTable: buildArrowTraceSpanTableFromColumns(
      {
        process_ref: processRefs,
        thread_ref: threadRefs,
        span_id: spanIds,
        external_span_id: externalSpanIds,
        thread_id: threadIds,
        name: names,
        source: sources,
        primary_timing_key: Array(rowCount).fill('primary'),
        status: statuses,
        start_time_ms: startTimesMs,
        end_time_ms: endTimesMs,
        duration_ms: durationsMs
      },
      undefined,
      {
        declaredSpanAttributePaths: options.declaredSpanAttributePaths,
        spanAttributeRows
      }
    ),
    resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTableFromColumns({
      waitMode: [],
      bidirectional: [],
      waitTimeMs: [],
      hasParentKeyword: []
    }),
    spanSidecarTable: buildArrowTraceSpanSidecarTableFromColumns({
      rowCount,
      keywords,
      userDataJson
    }),
    sourceDependencyTable: buildTraceChunkSourceDependencyTableFromColumns({
      dependencyKind: dependencyKinds,
      startExternalSpanId: dependencyStartIds,
      endExternalSpanId: dependencyEndIds,
      waitMode: dependencyWaitModes
    }),
    rowWindowTable: buildTraceChunkRowWindowTable(
      startTimesMs.map((startTimeMs, rowIndex) => [
        {startTimeMs, endTimeMs: endTimesMs[rowIndex] ?? startTimeMs}
      ])
    ),
    diagnostics: {
      rowCount,
      notStartedSpanCount: 0,
      unfinishedSpanCount,
      invalidRecordCount,
      minTimeMs: rowCount === 0 ? null : minTimeMs,
      maxTimeMs: rowCount === 0 ? null : maxTimeMs,
      warningCounters: invalidRecordCount === 0 ? {} : {invalidPhysicalSpan: invalidRecordCount}
    },
    refState: 'parser-local'
  };
}

/** Validate that every supplied source column preserves the required row alignment. */
function validatePhysicalSpanColumnLengths(
  columns: TracePhysicalSpanChunkColumns,
  rowCount: number
): void {
  const alignedColumns: Array<[string, TracePhysicalSpanColumn<unknown> | undefined]> = [
    ['parentExternalSpanIds', columns.parentExternalSpanIds],
    ['processIds', columns.processIds],
    ['processNames', columns.processNames],
    ['threadIds', columns.threadIds],
    ['threadNames', columns.threadNames],
    ['names', columns.names],
    ['sources', columns.sources],
    ['startTimeMs', columns.startTimeMs],
    ['endTimeMs', columns.endTimeMs],
    ['keywords', columns.keywords],
    ['userDataJson', columns.userDataJson],
    ['spanAttributeRows', columns.spanAttributeRows]
  ];
  for (const [name, column] of alignedColumns) {
    if (column != null && column.length !== rowCount) {
      throw new Error(`Expected ${name} to contain ${rowCount} rows; received ${column.length}.`);
    }
  }
}

/** Read one source column value without converting the full column to JavaScript rows. */
function readPhysicalSpanColumn<T>(column: TracePhysicalSpanColumn<T>, index: number): T | null {
  return 'get' in column ? column.get(index) : (column[index] ?? null);
}

/** Read one optional source column value without converting the full column. */
function readOptionalPhysicalSpanColumn<T>(
  column: TracePhysicalSpanColumn<T> | undefined,
  index: number
): T | null {
  return column == null ? null : readPhysicalSpanColumn(column, index);
}

/** Return whether a source identity field contains a usable non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Find or create parser-local process metadata for a physical span row. */
function ensurePhysicalSpanProcess(
  processes: MutableProcessMetadata[],
  processIndexes: Map<string, number>,
  processId: string,
  processName: string
): number {
  const existingIndex = processIndexes.get(processId);
  if (existingIndex != null) {
    return existingIndex;
  }
  const rankNum = processes.length;
  processIndexes.set(processId, rankNum);
  processes.push({
    processId: processId as TraceProcessId,
    name: processName,
    rankNum,
    threads: [],
    threadIndexes: new Map()
  });
  return rankNum;
}

/** Find or create parser-local thread metadata for a physical span row. */
function ensurePhysicalSpanThread(
  process: MutableProcessMetadata,
  threadId: string,
  threadName: string
): number {
  const existingIndex = process.threadIndexes.get(threadId);
  if (existingIndex != null) {
    return existingIndex;
  }
  const threadIndex = process.threads.length;
  process.threadIndexes.set(threadId, threadIndex);
  process.threads.push({
    type: 'trace-thread',
    threadId: threadId as TraceThreadId,
    processId: process.processId,
    name: threadName
  });
  return threadIndex;
}

/** Convert mutable parser-local owner metadata into canonical Arrow process metadata. */
function buildPhysicalSpanProcessMetadata(
  process: MutableProcessMetadata,
  options: BuildTracePhysicalSpanChunkOptions
): ArrowTraceProcessMetadata {
  return {
    type: 'trace-process',
    processId: process.processId,
    name: process.name,
    tags: [...(options.processTagsById?.[process.processId] ?? [])],
    rankNum: process.rankNum,
    processOrder: process.rankNum,
    stepNum: 0,
    threads: process.threads,
    threadMap: Object.fromEntries(process.threads.map(thread => [thread.threadId, thread])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    remoteDependencies: [],
    userData: options.processUserDataById?.[process.processId]
  };
}
