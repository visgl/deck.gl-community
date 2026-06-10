import {materializeJSONTrace} from '../../ingestion/json-trace';
import {
  iterateMaterializedTraceGraphProcessSpans,
  materializeTraceGraphSpan
} from '../../trace-graph-accessors';
import {getPrimaryTiming} from '../../trace-graph/trace-types';

import type {ArrowTraceProcessMetadata, TraceGraphData} from '../../ingestion/arrow-trace';
import type {JSONTrace} from '../../ingestion/json-trace';
import type {
  TraceCounter,
  TraceDependency,
  TraceDependencyId,
  TraceInstant,
  TraceProcess,
  TraceSpan,
  TraceSpanId
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
  'name' | 'threads' | 'instants' | 'counters' | 'localDependencies'
>;

type ChromeTraceGraphSource = {
  /** Human-readable graph name copied into the Chrome trace metadata. */
  name: string;
  /** Minimum graph timestamp used as the default time origin. */
  minTimeMs: number;
  /** Processes in render order. */
  processes: ReadonlyArray<ChromeTraceSourceProcess>;
  /** Graph-wide dependencies keyed by id. */
  dependencyMap: Readonly<Record<TraceDependencyId, TraceDependency>>;
  /** Iterates spans for one process in canonical export order. */
  iterateProcessBlocks: (processIndex: number, visit: (block: TraceSpan) => void) => void;
  /** Resolves a block for dependency-flow endpoint materialization. */
  getSpan: (spanId: TraceSpanId) => TraceSpan | null;
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

/** Encodes a {@link TraceGraphData} as Chrome trace JSON without building a compatibility graph. */
export const ArrowChromeTraceWriter = {
  encode: (traceGraphData: TraceGraphData, options?: ChromeTraceWriterOptions): ArrayBuffer => {
    return encodeTextToArrayBuffer(writeArrowChromeTrace(traceGraphData, options));
  },
  encodeText: (traceGraphData: TraceGraphData, options?: ChromeTraceWriterOptions): string =>
    writeArrowChromeTrace(traceGraphData, options)
};

/** Serializes a plain {@link JSONTrace} to Chrome trace JSON text. */
export function writeChromeTrace(
  traceGraph: JSONTrace,
  options: ChromeTraceWriterOptions = {}
): string {
  return serializeChromeTraceFile(buildChromeTraceFile(traceGraph, options), options);
}

/** Serializes a {@link TraceGraphData} to Chrome trace JSON text. */
export function writeArrowChromeTrace(
  traceGraphData: TraceGraphData,
  options: ChromeTraceWriterOptions = {}
): string {
  return serializeChromeTraceFile(buildArrowChromeTraceFile(traceGraphData, options), options);
}

/** Builds a Chrome trace file object from a plain {@link JSONTrace}. */
export function buildChromeTraceFile(
  traceGraph: JSONTrace,
  options: ChromeTraceWriterOptions = {}
): ChromeTraceFileSchema {
  return buildChromeTraceFileFromSource(createTraceGraphSource(traceGraph), options);
}

/** Builds a Chrome trace file object from a {@link TraceGraphData}. */
export function buildArrowChromeTraceFile(
  traceGraphData: TraceGraphData,
  options: ChromeTraceWriterOptions = {}
): ChromeTraceFileSchema {
  return buildChromeTraceFileFromSource(createTraceGraphDataSource(traceGraphData), options);
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
  return {
    name: materializedTraceGraph.name,
    minTimeMs: materializedTraceGraph.minTimeMs,
    processes: materializedTraceGraph.processes,
    dependencyMap: buildProcessLocalDependencyMap(materializedTraceGraph.processes),
    iterateProcessBlocks: (processIndex, visit) => {
      for (const block of materializedTraceGraph.processes[processIndex]?.spans ?? []) {
        visit(block);
      }
    },
    getSpan: spanId => materializedTraceGraph.spanMap[spanId] ?? null
  };
}

/** Builds the Arrow-native source adapter consumed by the shared writer core. */
function createTraceGraphDataSource(traceGraphData: TraceGraphData): ChromeTraceGraphSource {
  return {
    name: traceGraphData.name,
    minTimeMs: traceGraphData.minTimeMs,
    processes: traceGraphData.processes,
    dependencyMap: buildProcessLocalDependencyMap(traceGraphData.processes),
    iterateProcessBlocks: (processIndex, visit) => {
      const process = traceGraphData.processes[processIndex];
      if (!process) {
        return;
      }
      for (const block of iterateMaterializedTraceGraphProcessSpans(
        traceGraphData,
        process.processId
      )) {
        visit(block);
      }
    },
    getSpan: spanId => materializeTraceGraphSpan(traceGraphData, spanId)
  };
}

/** Rebuilds the writer's local-only dependency map from process-owned dependencies. */
function buildProcessLocalDependencyMap(
  processes: ReadonlyArray<Pick<ArrowTraceProcessMetadata | TraceProcess, 'localDependencies'>>
): Readonly<Record<TraceDependencyId, TraceDependency>> {
  return processes.reduce(
    (dependencyMap, process) => {
      (process.localDependencies ?? []).forEach(dependency => {
        dependencyMap[dependency.dependencyId] = dependency;
      });
      return dependencyMap;
    },
    {} as Record<TraceDependencyId, TraceDependency>
  );
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
    Object.values(source.dependencyMap).forEach(dependency => {
      const startBlock = source.getSpan(dependency.startSpanId);
      const endBlock = source.getSpan(dependency.endSpanId);
      if (!startBlock || !endBlock) {
        return;
      }
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
  block: TraceSpan
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
  block: TraceSpan,
  identifiers: ThreadIdentifiers,
  timeOriginMs: number,
  includeUserData: boolean,
  bigintSerialization: ChromeTraceBigIntSerialization
): ChromeTraceEventSchema | null {
  const timing = getPrimaryTiming(block);
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
  dependency: TraceDependency,
  startBlock: TraceSpan,
  endBlock: TraceSpan
): {startMs: number; endMs: number} | null {
  const startTiming = getPrimaryTiming(startBlock);
  const endTiming = getPrimaryTiming(endBlock);

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
  dependency: TraceDependency,
  startBlock: TraceSpan,
  endBlock: TraceSpan,
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
      keywords: Array.from(dependency.keywords ?? [])
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
