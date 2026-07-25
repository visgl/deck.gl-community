import {
  findArrowTraceChunkByIndex,
  getArrowTraceChunkSpanTableRowIndex
} from '../../ingestion/arrow-trace';
import {deserializeArrowTraceJson} from '../../ingestion/arrow-trace-json';
import {materializeJSONTrace} from '../../ingestion/json-trace';
import {decodeTraceDependencyWaitModeCode} from '../../ingestion/trace-dependency-arrow-fields';
import {decodeTraceSpanTimingStatusCode} from '../../ingestion/trace-span-timing-status-code';
import {getTraceDatasetSpanRefProcessId} from '../../trace-dataset';
import {
  encodeLocalSpanRef,
  encodeSameProcessDependencyRef,
  getSpanRefChunkIndex,
  getSpanRefRowIndex
} from '../../trace-graph/trace-id-encoder';
import {encodeSameProcessDependencyIdFromRef} from '../../trace-graph/trace-id-utils';
import {getPrimaryTiming} from '../../trace-graph/trace-types';

import type {
  ArrowTraceChunk,
  ArrowTraceProcessMetadata,
  ArrowTraceSameProcessDependencyTable
} from '../../ingestion/arrow-trace';
import type {JSONTrace} from '../../ingestion/json-trace';
import type {TraceDataset} from '../../trace-dataset';
import type {
  SpanRef,
  TraceCounter,
  TraceDependency,
  TraceDependencyId,
  TraceInstant,
  TraceProcess,
  TraceProcessId,
  TraceSpan,
  TraceSpanId,
  TraceSpanTiming
} from '../../trace-graph/trace-types';
import type {ChromeTraceEventSchema, ChromeTraceFileSchema} from './chrome-trace-schema';

type ThreadIdentifiers = {
  /** Chrome trace process identifier derived from process order. */
  pid: number;
  /** Chrome trace thread identifier derived from thread order within a process. */
  tid: number;
};

type ChromeTraceSourceProcess = Pick<
  ArrowTraceProcessMetadata | TraceProcess,
  'name' | 'threads' | 'instants' | 'counters' | 'sameProcessDependencies'
>;

/** Primary timing scalars needed by duration and flow events. */
type ChromeTracePrimaryTiming = Pick<
  TraceSpanTiming,
  'status' | 'startTimeMs' | 'endTimeMs' | 'durationMs'
>;

/** Minimal span payload needed to write Chrome trace events. */
type ChromeTraceSpan = {
  /** Owning thread identifier used for Chrome tid lookup. */
  threadId: TraceSpan['threadId'];
  /** Human-readable span name. */
  name: string;
  /** Human-readable owning process name used as the Chrome category. */
  processName: string;
  /** Stable source span identifier emitted in event args. */
  spanId: TraceSpanId;
  /** Optional keyword labels emitted in event args. */
  keywords?: readonly string[];
  /** Optional app-owned payload emitted when user data is enabled. */
  userData?: Record<string, unknown>;
  /** Canonical primary timing scalars used by duration and flow events. */
  timing: ChromeTracePrimaryTiming;
};

/** Minimal endpoint payload needed to place one Chrome trace dependency flow. */
type ChromeTraceFlowEndpoint = Pick<ChromeTraceSpan, 'threadId' | 'timing'>;

/** Minimal dependency payload needed to write Chrome trace flow events. */
type ChromeTraceDependency = {
  /** Stable dependency identifier emitted as the Chrome flow id. */
  dependencyId: TraceDependencyId;
  /** Timing mode used to choose flow endpoints. */
  waitMode: TraceDependency['waitMode'];
  /** Whether the source dependency is bidirectional. */
  bidirectional: boolean;
  /** Keyword labels emitted in flow args. */
  keywords: readonly string[];
  /** Optional app-owned payload emitted when user data is enabled. */
  userData?: Record<string, unknown>;
};

/** Receives one writer-local dependency flow with already-resolved endpoint spans. */
type ChromeTraceFlowVisitor = (
  dependency: ChromeTraceDependency,
  startBlock: ChromeTraceFlowEndpoint,
  endBlock: ChromeTraceFlowEndpoint
) => void;

/** One narrow Arrow scalar column read by the dataset export path. */
type ArrowScalarColumn = {
  /** Reads one nullable row value without materializing a row object. */
  get(rowIndex: number): unknown;
};

/** Resolved canonical Arrow address for one dataset span ref. */
type TraceDatasetSpanRow = {
  /** Chunk table that owns the span row. */
  chunk: ArrowTraceChunk;
  /** Row offset inside the chunk span table. */
  rowIndex: number;
};

/** Shared inputs for one dataset-native dependency-table scan. */
type TraceDatasetFlowIterationParams = {
  /** Canonical Arrow-backed dataset being exported. */
  traceDataset: TraceDataset;
  /** Whether row-aligned app payloads should be decoded. */
  includeUserData: boolean;
  /** Receives one resolved writer-local dependency flow. */
  visit: ChromeTraceFlowVisitor;
};

type ChromeTraceGraphSource = {
  /** Human-readable graph name copied into the Chrome trace metadata. */
  name: string;
  /** Minimum graph timestamp used as the default time origin. */
  minTimeMs: number;
  /** Processes in render order. */
  processes: ReadonlyArray<ChromeTraceSourceProcess>;
  /** Iterates spans for one process in canonical export order. */
  iterateProcessBlocks: (processIndex: number, visit: (block: ChromeTraceSpan) => void) => void;
  /** Visits dependency flows with already-resolved endpoint spans. */
  iterateFlows: (visit: ChromeTraceFlowVisitor) => void;
};

export type ChromeTraceBigIntSerialization = 'string' | 'raw-number';

export type ChromeTraceWriterOptions = {
  /**
   * Offset applied to all timestamps. Defaults to the source graph's `minTimeMs`.
   */
  timeOriginMs?: number;
  /** Include trace spans as duration events. */
  includeBlocks?: boolean;
  /** Include instants. */
  includeInstants?: boolean;
  /** Include counters. */
  includeCounters?: boolean;
  /** Include dependency flows. */
  includeFlows?: boolean;
  /** Include userData in args fields. */
  includeUserData?: boolean;
  /** How bigint values are emitted in the serialized trace JSON. */
  bigintSerialization?: ChromeTraceBigIntSerialization;
};

function encodeTextToArrayBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

/** Encodes a plain {@link JSONTrace} as Chrome trace JSON. */
export const ChromeTraceWriter = {
  encode: (traceGraph: JSONTrace, options?: ChromeTraceWriterOptions): ArrayBuffer => {
    return encodeTextToArrayBuffer(writeChromeTrace(traceGraph, options));
  },
  encodeText: (traceGraph: JSONTrace, options?: ChromeTraceWriterOptions): string =>
    writeChromeTrace(traceGraph, options)
};

/** Encodes a canonical {@link TraceDataset} as Chrome trace JSON without graph materialization. */
export const ArrowChromeTraceWriter = {
  encode: (traceDataset: TraceDataset, options?: ChromeTraceWriterOptions): ArrayBuffer => {
    return encodeTextToArrayBuffer(writeArrowChromeTrace(traceDataset, options));
  },
  encodeText: (traceDataset: TraceDataset, options?: ChromeTraceWriterOptions): string =>
    writeArrowChromeTrace(traceDataset, options)
};

/** Serializes a plain {@link JSONTrace} to Chrome trace JSON text. */
export function writeChromeTrace(
  traceGraph: JSONTrace,
  options: ChromeTraceWriterOptions = {}
): string {
  return serializeChromeTraceFile(buildChromeTraceFile(traceGraph, options), options);
}

/** Serializes a canonical {@link TraceDataset} to Chrome trace JSON text. */
export function writeArrowChromeTrace(
  traceDataset: TraceDataset,
  options: ChromeTraceWriterOptions = {}
): string {
  return serializeChromeTraceFile(buildArrowChromeTraceFile(traceDataset, options), options);
}

/** Builds a Chrome trace file object from a plain {@link JSONTrace}. */
export function buildChromeTraceFile(
  traceGraph: JSONTrace,
  options: ChromeTraceWriterOptions = {}
): ChromeTraceFileSchema {
  return buildChromeTraceFileFromSource(createTraceGraphSource(traceGraph), options);
}

/** Builds a Chrome trace file object from a canonical {@link TraceDataset}. */
export function buildArrowChromeTraceFile(
  traceDataset: TraceDataset,
  options: ChromeTraceWriterOptions = {}
): ChromeTraceFileSchema {
  return buildChromeTraceFileFromSource(
    createTraceDatasetSource(
      traceDataset,
      options.includeUserData ?? DEFAULT_OPTIONS.includeUserData
    ),
    options
  );
}

const DEFAULT_OPTIONS: Required<
  Pick<
    ChromeTraceWriterOptions,
    | 'includeBlocks'
    | 'includeInstants'
    | 'includeCounters'
    | 'includeFlows'
    | 'includeUserData'
    | 'bigintSerialization'
  >
> = {
  includeBlocks: true,
  includeInstants: true,
  includeCounters: true,
  includeFlows: true,
  includeUserData: true,
  bigintSerialization: 'string'
};

const MS_TO_US = 1000;
const RAW_BIGINT_TOKEN_PREFIX = '__chrome_trace_bigint__:';
const RAW_BIGINT_TOKEN_PATTERN = new RegExp(`"${RAW_BIGINT_TOKEN_PREFIX}(-?\\d+)"`, 'g');

/** Builds the plain-graph source adapter consumed by the shared writer core. */
function createTraceGraphSource(traceGraph: JSONTrace): ChromeTraceGraphSource {
  const materializedTraceGraph = materializeJSONTrace(traceGraph);
  const dependencyMap = buildProcessSameProcessDependencyMap(materializedTraceGraph.processes);
  return {
    name: materializedTraceGraph.name,
    minTimeMs: materializedTraceGraph.minTimeMs,
    processes: materializedTraceGraph.processes,
    iterateProcessBlocks: (processIndex, visit) => {
      for (const block of materializedTraceGraph.processes[processIndex]?.spans ?? []) {
        visit(toChromeTraceSpan(block));
      }
    },
    iterateFlows: visit => {
      Object.values(dependencyMap).forEach(dependency => {
        const startBlock = materializedTraceGraph.spanMap[dependency.startSpanId];
        const endBlock = materializedTraceGraph.spanMap[dependency.endSpanId];
        if (startBlock && endBlock) {
          visit(
            toChromeTraceDependency(dependency),
            toChromeTraceSpan(startBlock),
            toChromeTraceSpan(endBlock)
          );
        }
      });
    }
  };
}

/** Rebuilds the writer's local-only dependency map from process-owned dependencies. */
function buildProcessSameProcessDependencyMap(
  processes: ReadonlyArray<
    Pick<ArrowTraceProcessMetadata | TraceProcess, 'sameProcessDependencies'>
  >
): Readonly<Record<TraceDependencyId, TraceDependency>> {
  return processes.reduce(
    (dependencyMap, process) => {
      (process.sameProcessDependencies ?? []).forEach(dependency => {
        dependencyMap[dependency.dependencyId] = dependency;
      });
      return dependencyMap;
    },
    {} as Record<TraceDependencyId, TraceDependency>
  );
}

/** Builds the dataset-native source adapter consumed by the shared writer core. */
function createTraceDatasetSource(
  traceDataset: TraceDataset,
  includeUserData: boolean
): ChromeTraceGraphSource {
  return {
    name: traceDataset.name,
    minTimeMs: traceDataset.timeExtents.minTimeMs,
    processes: traceDataset.processes,
    iterateProcessBlocks: (processIndex, visit) => {
      const process = traceDataset.processes[processIndex];
      const spanRefTable = process
        ? traceDataset.processSpanTableMap[process.processId as TraceProcessId]
        : undefined;
      const spanRefColumn = spanRefTable?.getChild('span_ref');
      if (!process || !spanRefTable || !spanRefColumn) {
        return;
      }
      for (let rowIndex = 0; rowIndex < spanRefTable.numRows; rowIndex += 1) {
        const spanRef = readArrowSpanRef(spanRefColumn.get(rowIndex));
        if (spanRef == null) {
          continue;
        }
        const span = readTraceDatasetChromeSpan(
          traceDataset,
          spanRef,
          process.name,
          includeUserData
        );
        if (span) {
          visit(span);
        }
      }
    },
    iterateFlows: visit => {
      iterateTraceDatasetSameProcessFlows({
        traceDataset,
        includeUserData,
        visit
      });
      iterateTraceDatasetCrossProcessFlows({
        traceDataset,
        includeUserData,
        visit
      });
    }
  };
}

/** Converts one plain compatibility span into the writer's narrow timing payload. */
function toChromeTraceSpan(span: TraceSpan): ChromeTraceSpan {
  const timing = getPrimaryTiming(span);
  return {
    threadId: span.threadId,
    name: span.name,
    processName: span.processName,
    spanId: span.spanId,
    keywords: span.keywords,
    userData: span.userData,
    timing: {
      status: timing.status,
      startTimeMs: timing.startTimeMs,
      endTimeMs: timing.endTimeMs,
      durationMs: timing.durationMs
    }
  };
}

/** Converts one plain compatibility dependency into the writer's narrow flow payload. */
function toChromeTraceDependency(dependency: TraceDependency): ChromeTraceDependency {
  return {
    dependencyId: dependency.dependencyId,
    waitMode: dependency.waitMode,
    bidirectional: dependency.bidirectional,
    keywords: Array.from(dependency.keywords ?? []),
    userData: dependency.userData
  };
}

/** Visits canonical process-local dependency rows with active dataset endpoint spans. */
function iterateTraceDatasetSameProcessFlows(params: TraceDatasetFlowIterationParams): void {
  params.traceDataset.processes.forEach((process, processIndex) => {
    const table =
      params.traceDataset.sameProcessDependencyTableMap[process.processId as TraceProcessId];
    if (!table) {
      return;
    }
    const dependencyIdColumn = getArrowColumn(table, 'dependencyId');
    const startSpanRefColumn = getArrowColumn(table, 'startSpanRef');
    const endSpanRefColumn = getArrowColumn(table, 'endSpanRef');
    const waitModeCodeColumn = getArrowColumn(table, 'waitModeCode');
    const bidirectionalColumn = getArrowColumn(table, 'bidirectional');
    const keywordsColumn = getArrowColumn(table, 'keywords');
    const userDataJsonColumn = getArrowColumn(table, 'userDataJson');
    for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
      const startSpanRef = readArrowSpanRef(startSpanRefColumn?.get(rowIndex));
      const endSpanRef = readArrowSpanRef(endSpanRefColumn?.get(rowIndex));
      const waitMode = decodeTraceDependencyWaitModeCode(waitModeCodeColumn?.get(rowIndex));
      if (startSpanRef == null || endSpanRef == null || waitMode == null) {
        continue;
      }
      const startBlock = readActiveTraceDatasetFlowEndpoint(params.traceDataset, startSpanRef);
      const endBlock = readActiveTraceDatasetFlowEndpoint(params.traceDataset, endSpanRef);
      if (!startBlock || !endBlock) {
        continue;
      }
      const dependencyId =
        (readArrowString(dependencyIdColumn?.get(rowIndex)) as TraceDependencyId | null) ??
        encodeSameProcessDependencyIdFromRef(
          encodeSameProcessDependencyRef(encodeLocalSpanRef(processIndex, rowIndex))
        );
      params.visit(
        {
          dependencyId,
          waitMode,
          bidirectional: readArrowBoolean(bidirectionalColumn?.get(rowIndex)) ?? false,
          keywords: readArrowStringList(keywordsColumn?.get(rowIndex)),
          userData: readArrowUserData(userDataJsonColumn?.get(rowIndex), params.includeUserData)
        },
        startBlock,
        endBlock
      );
    }
  });
}

/** Visits canonical cross-process dependency rows with active dataset endpoint spans. */
function iterateTraceDatasetCrossProcessFlows(params: TraceDatasetFlowIterationParams): void {
  const table = params.traceDataset.crossProcessDependencyTable;
  const dependencyIdColumn = getArrowColumn(table, 'dependencyId');
  const startSpanRefColumn = getArrowColumn(table, 'startSpanRef');
  const endSpanRefColumn = getArrowColumn(table, 'endSpanRef');
  const waitModeColumn = getArrowColumn(table, 'waitMode');
  const bidirectionalColumn = getArrowColumn(table, 'bidirectional');
  const keywordsColumn = getArrowColumn(table, 'keywords');
  const userDataJsonColumn = getArrowColumn(table, 'userDataJson');
  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    const dependencyId = readArrowString(dependencyIdColumn?.get(rowIndex));
    const startSpanRef = readArrowSpanRef(startSpanRefColumn?.get(rowIndex));
    const endSpanRef = readArrowSpanRef(endSpanRefColumn?.get(rowIndex));
    const waitMode = readTraceDependencyWaitMode(waitModeColumn?.get(rowIndex));
    if (!dependencyId || startSpanRef == null || endSpanRef == null || waitMode == null) {
      continue;
    }
    const startBlock = readActiveTraceDatasetFlowEndpoint(params.traceDataset, startSpanRef);
    const endBlock = readActiveTraceDatasetFlowEndpoint(params.traceDataset, endSpanRef);
    if (!startBlock || !endBlock) {
      continue;
    }
    params.visit(
      {
        dependencyId: dependencyId as TraceDependencyId,
        waitMode,
        bidirectional: readArrowBoolean(bidirectionalColumn?.get(rowIndex)) ?? false,
        keywords: readArrowStringList(keywordsColumn?.get(rowIndex)),
        userData: readArrowUserData(userDataJsonColumn?.get(rowIndex), params.includeUserData)
      },
      startBlock,
      endBlock
    );
  }
}

/**
 * Reads only the active endpoint scalars needed by one dependency flow.
 *
 * Flow placement never needs names, ids, keywords, or user data from endpoint spans, so this
 * intentionally avoids the broader block-export reader and its sidecar columns.
 */
function readActiveTraceDatasetFlowEndpoint(
  traceDataset: TraceDataset,
  spanRef: SpanRef
): ChromeTraceFlowEndpoint | null {
  if (getTraceDatasetSpanRefProcessId(traceDataset, spanRef) == null) {
    return null;
  }
  const spanRow = resolveTraceDatasetSpanRow(traceDataset, spanRef);
  if (!spanRow) {
    return null;
  }
  const threadId = readArrowString(
    spanRow.chunk.spanTable.getChild('thread_id')?.get(spanRow.rowIndex)
  );
  const timing = readTraceDatasetChromeTiming(spanRow);
  return threadId && timing
    ? {
        threadId: threadId as TraceSpan['threadId'],
        timing
      }
    : null;
}

/** Reads one writer-local span payload from the canonical chunk row behind a span ref. */
function readTraceDatasetChromeSpan(
  traceDataset: TraceDataset,
  spanRef: SpanRef,
  processName: string,
  includeUserData: boolean
): ChromeTraceSpan | null {
  const spanRow = resolveTraceDatasetSpanRow(traceDataset, spanRef);
  if (!spanRow) {
    return null;
  }
  const spanId = readArrowString(
    spanRow.chunk.spanTable.getChild('span_id')?.get(spanRow.rowIndex)
  );
  const threadId = readArrowString(
    spanRow.chunk.spanTable.getChild('thread_id')?.get(spanRow.rowIndex)
  );
  const timing = readTraceDatasetChromeTiming(spanRow);
  if (!spanId || !threadId || !timing) {
    return null;
  }
  const sidecarTable = spanRow.chunk.spanSidecarTable;
  return {
    threadId: threadId as TraceSpan['threadId'],
    name: readArrowString(spanRow.chunk.spanTable.getChild('name')?.get(spanRow.rowIndex)) ?? '',
    processName,
    spanId: spanId as TraceSpanId,
    keywords: readArrowStringList(sidecarTable?.getChild('keywords')?.get(spanRow.rowIndex)),
    userData: readArrowUserData(
      sidecarTable?.getChild('userDataJson')?.get(spanRow.rowIndex),
      includeUserData
    ),
    timing
  };
}

/** Reads the canonical primary timing scalars required by block and flow export. */
function readTraceDatasetChromeTiming(
  spanRow: TraceDatasetSpanRow
): ChromeTracePrimaryTiming | null {
  const status = decodeTraceSpanTimingStatusCode(
    spanRow.chunk.spanTable.getChild('status_code')?.get(spanRow.rowIndex)
  );
  const startTimeMs = readArrowNumber(
    spanRow.chunk.spanTable.getChild('start_time_ms')?.get(spanRow.rowIndex)
  );
  const endTimeMs = readArrowNumber(
    spanRow.chunk.spanTable.getChild('end_time_ms')?.get(spanRow.rowIndex)
  );
  const durationMs = readArrowNumber(
    spanRow.chunk.spanTable.getChild('duration_ms')?.get(spanRow.rowIndex)
  );
  return status && startTimeMs != null && endTimeMs != null && durationMs != null
    ? {status, startTimeMs, endTimeMs, durationMs}
    : null;
}

/** Resolves one canonical dataset span ref into its Arrow chunk and table row. */
function resolveTraceDatasetSpanRow(
  traceDataset: TraceDataset,
  spanRef: SpanRef
): TraceDatasetSpanRow | null {
  const chunk = findArrowTraceChunkByIndex(traceDataset.chunks, getSpanRefChunkIndex(spanRef));
  const rowIndex = chunk
    ? getArrowTraceChunkSpanTableRowIndex(chunk, getSpanRefRowIndex(spanRef))
    : null;
  return chunk && rowIndex != null ? {chunk, rowIndex} : null;
}

/** Reads an arbitrary Arrow column through the writer's narrow scalar interface. */
function getArrowColumn(
  table: ArrowTraceSameProcessDependencyTable | TraceDataset['crossProcessDependencyTable'],
  columnName: string
): ArrowScalarColumn | null {
  return (
    table as unknown as {
      getChild(name: string): ArrowScalarColumn | null;
    }
  ).getChild(columnName);
}

/** Reads one safe packed span ref from a number-like Arrow scalar. */
function readArrowSpanRef(value: unknown): SpanRef | null {
  const spanRef = typeof value === 'bigint' ? Number(value) : value;
  return typeof spanRef === 'number' && Number.isSafeInteger(spanRef) && spanRef >= 0
    ? (spanRef as SpanRef)
    : null;
}

/** Reads one nullable string Arrow scalar. */
function readArrowString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Reads one nullable finite numeric Arrow scalar. */
function readArrowNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads one nullable boolean Arrow scalar. */
function readArrowBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** Reads one Arrow list cell into the writer's JSON-ready keyword array. */
function readArrowStringList(value: unknown): string[] {
  if (value == null || typeof value !== 'object' || !(Symbol.iterator in value)) {
    return [];
  }
  return Array.from(value as Iterable<unknown>).filter(
    (keyword): keyword is string => typeof keyword === 'string'
  );
}

/** Decodes one row-aligned Arrow user-data payload only when export args request it. */
function readArrowUserData(
  value: unknown,
  includeUserData: boolean
): Record<string, unknown> | undefined {
  if (!includeUserData || typeof value !== 'string') {
    return undefined;
  }
  const userData = deserializeArrowTraceJson<unknown>(value);
  return userData != null && typeof userData === 'object' && !Array.isArray(userData)
    ? (userData as Record<string, unknown>)
    : undefined;
}

/** Reads one valid closed-domain dependency wait mode from a Utf8 Arrow scalar. */
function readTraceDependencyWaitMode(value: unknown): TraceDependency['waitMode'] | null {
  return value === 'start-to-start' || value === 'end-to-end' || value === 'end-to-start'
    ? value
    : null;
}

/** Serializes a Chrome trace file with the writer's bigint handling semantics. */
function serializeChromeTraceFile(
  traceFile: ChromeTraceFileSchema,
  options: ChromeTraceWriterOptions
): string {
  const serialized = JSON.stringify(traceFile, chromeTraceJsonReplacer);
  if ((options.bigintSerialization ?? DEFAULT_OPTIONS.bigintSerialization) !== 'raw-number') {
    return serialized;
  }
  return serialized.replace(RAW_BIGINT_TOKEN_PATTERN, '$1');
}

/** Builds the Chrome trace file from an abstract graph source shared by both writer entry points. */
function buildChromeTraceFileFromSource(
  source: ChromeTraceGraphSource,
  options: ChromeTraceWriterOptions
): ChromeTraceFileSchema {
  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    ...options
  };
  const timeOriginMs = options.timeOriginMs ?? source.minTimeMs;
  const threadIds = buildThreadIndex(source.processes);
  const traceEvents: ChromeTraceEventSchema[] = [];

  source.processes.forEach((process, processIndex) => {
    const pid = processIndex + 1;
    traceEvents.push(buildProcessMetadata(pid, process.name));

    process.threads.forEach((thread, threadIndex) => {
      const tid = threadIndex + 1;
      traceEvents.push(buildThreadMetadata(pid, tid, thread.name));
    });
  });

  if (mergedOptions.includeBlocks) {
    source.processes.forEach((_, processIndex) => {
      source.iterateProcessBlocks(processIndex, block => {
        const identifiers = getSpanIdentifiers(threadIds, block);
        if (!identifiers) {
          return;
        }
        const event = buildBlockEvent(
          block,
          identifiers,
          timeOriginMs,
          mergedOptions.includeUserData,
          mergedOptions.bigintSerialization
        );
        if (event) {
          traceEvents.push(event);
        }
      });
    });
  }

  if (mergedOptions.includeInstants) {
    source.processes.forEach(process => {
      process.instants.forEach(instant => {
        const identifiers = threadIds.get(instant.threadId);
        if (!identifiers) {
          return;
        }
        const event = buildInstantEvent(
          instant,
          identifiers,
          timeOriginMs,
          mergedOptions.includeUserData,
          mergedOptions.bigintSerialization
        );
        if (event) {
          traceEvents.push(event);
        }
      });
    });
  }

  if (mergedOptions.includeCounters) {
    source.processes.forEach(process => {
      process.counters.forEach(counter => {
        const identifiers = threadIds.get(counter.threadId);
        if (!identifiers) {
          return;
        }
        const event = buildCounterEvent(
          counter,
          identifiers,
          timeOriginMs,
          mergedOptions.includeUserData,
          mergedOptions.bigintSerialization
        );
        if (event) {
          traceEvents.push(event);
        }
      });
    });
  }

  if (mergedOptions.includeFlows) {
    source.iterateFlows((dependency, startBlock, endBlock) => {
      const startIdentifiers = getSpanIdentifiers(threadIds, startBlock);
      const endIdentifiers = getSpanIdentifiers(threadIds, endBlock);
      if (!startIdentifiers || !endIdentifiers) {
        return;
      }
      traceEvents.push(
        ...buildFlowEvents(
          dependency,
          startBlock,
          endBlock,
          startIdentifiers,
          endIdentifiers,
          timeOriginMs,
          mergedOptions.includeUserData,
          mergedOptions.bigintSerialization
        )
      );
    });
  }

  return {
    traceEvents,
    metadata: {
      traceGraphName: source.name
    }
  };
}

/** Converts milliseconds to Chrome trace microseconds. */
function toMicroseconds(ms: number): number {
  return Math.round(ms * MS_TO_US);
}

/** Replaces bigint values with JSON-safe placeholder tokens during serialization. */
function chromeTraceJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? `${RAW_BIGINT_TOKEN_PREFIX}${value.toString()}` : value;
}

/** Normalizes nested values into a JSON-safe shape with explicit bigint handling. */
function toJsonSafeValue(
  value: unknown,
  bigintSerialization: ChromeTraceBigIntSerialization
): unknown {
  if (typeof value === 'bigint') {
    return bigintSerialization === 'raw-number'
      ? `${RAW_BIGINT_TOKEN_PREFIX}${value.toString()}`
      : value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(entry => toJsonSafeValue(entry, bigintSerialization));
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries(), ([key, entryValue]) => [
        String(key),
        toJsonSafeValue(entryValue, bigintSerialization)
      ])
    );
  }
  if (value instanceof Set) {
    return Array.from(value, entry => toJsonSafeValue(entry, bigintSerialization));
  }
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      return value;
    }
    return Array.from(value as unknown as Iterable<unknown>, entry =>
      toJsonSafeValue(entry, bigintSerialization)
    );
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        toJsonSafeValue(entryValue, bigintSerialization)
      ])
    );
  }
  return value;
}

/** Merges base event args with optional user data and applies bigint normalization. */
function withUserData(
  base: Record<string, unknown>,
  userData: Record<string, unknown> | undefined,
  includeUserData: boolean,
  bigintSerialization: ChromeTraceBigIntSerialization
): Record<string, unknown> {
  if (!includeUserData || !userData || Object.keys(userData).length === 0) {
    return toJsonSafeValue(base, bigintSerialization) as Record<string, unknown>;
  }
  return toJsonSafeValue(
    {
      ...base,
      userData
    },
    bigintSerialization
  ) as Record<string, unknown>;
}

/** Builds the process/thread id mapping used by Chrome trace events. */
function buildThreadIndex(
  processes: ReadonlyArray<ChromeTraceSourceProcess>
): Map<string, ThreadIdentifiers> {
  const threadIds = new Map<string, ThreadIdentifiers>();
  processes.forEach((process, processIndex) => {
    const pid = processIndex + 1;
    process.threads.forEach((thread, index) => {
      threadIds.set(thread.threadId, {pid, tid: index + 1});
    });
  });

  return threadIds;
}

/** Resolves the Chrome trace process/thread identifiers for one block. */
function getSpanIdentifiers(
  threadIds: Map<string, ThreadIdentifiers>,
  block: Pick<ChromeTraceSpan, 'threadId'>
): ThreadIdentifiers | null {
  const identifiers = threadIds.get(block.threadId);
  return identifiers ?? null;
}

/** Builds the Chrome trace metadata event for one process name. */
function buildProcessMetadata(pid: number, name: string): ChromeTraceEventSchema {
  return {
    name: 'process_name',
    ph: 'M',
    ts: 0,
    pid,
    tid: 0,
    args: {
      name
    }
  };
}

/** Builds the Chrome trace metadata event for one thread name. */
function buildThreadMetadata(pid: number, tid: number, name: string): ChromeTraceEventSchema {
  return {
    name: 'thread_name',
    ph: 'M',
    ts: 0,
    pid,
    tid,
    args: {
      name
    }
  };
}

/** Builds one duration event for a trace block. */
function buildBlockEvent(
  block: ChromeTraceSpan,
  identifiers: ThreadIdentifiers,
  timeOriginMs: number,
  includeUserData: boolean,
  bigintSerialization: ChromeTraceBigIntSerialization
): ChromeTraceEventSchema | null {
  const timing = block.timing;
  if (!Number.isFinite(timing.startTimeMs) || !Number.isFinite(timing.endTimeMs)) {
    return null;
  }
  const startTimeMs = timing.startTimeMs - timeOriginMs;
  const endTimeMs = timing.endTimeMs - timeOriginMs;
  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)) {
    return null;
  }
  const durMs = Math.max(0, endTimeMs - startTimeMs);

  return {
    name: block.name,
    ph: 'X',
    ts: toMicroseconds(startTimeMs),
    dur: toMicroseconds(durMs),
    pid: identifiers.pid,
    tid: identifiers.tid,
    cat: block.processName,
    args: withUserData(
      {
        spanId: block.spanId,
        threadId: block.threadId,
        status: timing.status,
        durationMs: timing.durationMs,
        keywords: block.keywords ?? []
      },
      block.userData,
      includeUserData,
      bigintSerialization
    )
  };
}

/** Builds one instant event for a trace instant record. */
function buildInstantEvent(
  instant: TraceInstant,
  identifiers: ThreadIdentifiers,
  timeOriginMs: number,
  includeUserData: boolean,
  bigintSerialization: ChromeTraceBigIntSerialization
): ChromeTraceEventSchema | null {
  if (!Number.isFinite(instant.atTimeMs)) {
    return null;
  }
  const atTimeMs = instant.atTimeMs - timeOriginMs;
  if (!Number.isFinite(atTimeMs)) {
    return null;
  }

  return {
    name: instant.name,
    ph: 'I',
    ts: toMicroseconds(atTimeMs),
    pid: identifiers.pid,
    tid: identifiers.tid,
    s: instant.scope,
    args: withUserData(
      {
        instantId: instant.instantId,
        threadId: instant.threadId
      },
      instant.userData,
      includeUserData,
      bigintSerialization
    )
  };
}

/** Builds one counter event for a trace counter record. */
function buildCounterEvent(
  counter: TraceCounter,
  identifiers: ThreadIdentifiers,
  timeOriginMs: number,
  includeUserData: boolean,
  bigintSerialization: ChromeTraceBigIntSerialization
): ChromeTraceEventSchema | null {
  if (!Number.isFinite(counter.atTimeMs)) {
    return null;
  }
  const atTimeMs = counter.atTimeMs - timeOriginMs;
  if (!Number.isFinite(atTimeMs)) {
    return null;
  }

  return {
    name: counter.name,
    ph: 'C',
    ts: toMicroseconds(atTimeMs),
    pid: identifiers.pid,
    tid: identifiers.tid,
    args: withUserData(
      {
        counterId: counter.counterId,
        threadId: counter.threadId,
        ...counter.series
      },
      counter.userData,
      includeUserData,
      bigintSerialization
    )
  };
}

/** Resolves the timestamp pair used for one dependency flow. */
function getDependencyTimes(
  dependency: ChromeTraceDependency,
  startBlock: ChromeTraceFlowEndpoint,
  endBlock: ChromeTraceFlowEndpoint
): {startMs: number; endMs: number} | null {
  const startTiming = startBlock.timing;
  const endTiming = endBlock.timing;

  const startStart = startTiming.startTimeMs;
  const startEnd = startTiming.endTimeMs;
  const endStart = endTiming.startTimeMs;
  const endEnd = endTiming.endTimeMs;

  if (
    !Number.isFinite(startStart) ||
    !Number.isFinite(startEnd) ||
    !Number.isFinite(endStart) ||
    !Number.isFinite(endEnd)
  ) {
    return null;
  }

  switch (dependency.waitMode) {
    case 'start-to-start':
      return {startMs: startStart, endMs: endStart};
    case 'end-to-end':
      return {startMs: startEnd, endMs: endEnd};
    case 'end-to-start':
    default:
      return {startMs: startEnd, endMs: endStart};
  }
}

/** Builds the Chrome trace start/finish flow pair for one dependency. */
function buildFlowEvents(
  dependency: ChromeTraceDependency,
  startBlock: ChromeTraceFlowEndpoint,
  endBlock: ChromeTraceFlowEndpoint,
  startIdentifiers: ThreadIdentifiers,
  endIdentifiers: ThreadIdentifiers,
  timeOriginMs: number,
  includeUserData: boolean,
  bigintSerialization: ChromeTraceBigIntSerialization
): ChromeTraceEventSchema[] {
  const times = getDependencyTimes(dependency, startBlock, endBlock);
  if (!times) {
    return [];
  }

  const startMs = times.startMs - timeOriginMs;
  const endMs = times.endMs - timeOriginMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return [];
  }

  const args = withUserData(
    {
      dependencyId: dependency.dependencyId,
      waitMode: dependency.waitMode,
      bidirectional: dependency.bidirectional,
      keywords: dependency.keywords
    },
    dependency.userData,
    includeUserData,
    bigintSerialization
  );

  return [
    {
      name: 'dependency',
      ph: 's',
      ts: toMicroseconds(startMs),
      pid: startIdentifiers.pid,
      tid: startIdentifiers.tid,
      id: dependency.dependencyId,
      cat: 'dependency',
      args
    },
    {
      name: 'dependency',
      ph: 'f',
      ts: toMicroseconds(endMs),
      pid: endIdentifiers.pid,
      tid: endIdentifiers.tid,
      id: dependency.dependencyId,
      cat: 'dependency',
      args
    }
  ];
}
