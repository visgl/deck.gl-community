import {
  buildArrowTraceSameProcessDependencyTableFromColumns,
  buildArrowTraceSpanTableFromColumns
} from '../ingestion/arrow-trace';
import {createStaticTraceChunkStore} from '../trace-chunk-store';
import {
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef
} from '../trace-graph/trace-id-encoder';

import type {ArrowTraceProcessMetadata} from '../ingestion/arrow-trace';
import type {TraceChunk} from '../trace-chunk';
import type {TraceChunkData} from '../trace-chunk-data';
import type {
  TraceChunkDescriptor,
  TraceChunkStore,
  TraceChunkStoreReadyChunk
} from '../trace-chunk-store';
import type {TraceOwnerRefRegistry} from '../trace-graph/trace-owner-ref-registry';
import type {
  TraceProcessId,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';

/** Stable span name used by optional synthetic text-filter scenarios. */
export const SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME = 'synthetic-filter-match';

/** Options for generating a deterministic Arrow-backed synthetic trace fixture. */
export type SyntheticArrowTraceFixtureOptions = {
  /** Number of span rows generated across every process chunk. */
  readonly rowCount: number;
  /** Number of process-scoped chunks to generate. Defaults to eight for large fixtures. */
  readonly processCount?: number;
  /** Number of repeated thread lanes generated within every process. Defaults to four. */
  readonly threadsPerProcess?: number;
  /** Stable fixture identity used for chunk keys and store diagnostics. */
  readonly identityKey?: string;
  /** Optional global row stride whose matching rows receive the text-filter match name. */
  readonly textFilterMatchEvery?: number;
};

/** Expected deterministic counts and bounds produced by one synthetic fixture. */
export type SyntheticArrowTraceFixtureSummary = {
  /** Number of generated span rows. */
  readonly spanCount: number;
  /** Number of generated process chunks. */
  readonly processCount: number;
  /** Number of generated thread metadata rows. */
  readonly threadCount: number;
  /** Number of sequential same-process dependencies. */
  readonly sameProcessDependencyCount: number;
  /** Earliest generated start timestamp in milliseconds. */
  readonly minTimeMs: number;
  /** Latest generated end timestamp in milliseconds. */
  readonly maxTimeMs: number;
  /** Number of rows named for the optional deterministic text-filter scenario. */
  readonly textFilterMatchCount: number;
};

/** Ready chunk inputs used by dataset and graph materialization benchmarks. */
export type SyntheticArrowTraceMaterializationInputs = {
  /** Append-only owner-ref registry finalized by the synthetic chunk store. */
  readonly ownerRefRegistry: TraceOwnerRefRegistry;
  /** Ready finalized chunks selected for the full synthetic trace. */
  readonly readyChunks: readonly TraceChunkStoreReadyChunk<TraceChunk, TraceChunkDescriptor>[];
};

/** Generated Arrow fixture plus the finalized inputs needed by materializers. */
export type SyntheticArrowTraceFixture = {
  /** Parser-local canonical Arrow chunks, retained for buffer identity assertions. */
  readonly chunks: readonly TraceChunkData[];
  /** Static store that owns finalized chunk refs for the fixture. */
  readonly traceStore: TraceChunkStore<TraceChunk, TraceChunkDescriptor>;
  /** Full-selection inputs passed to dataset and graph materializers. */
  readonly materializationInputs: SyntheticArrowTraceMaterializationInputs;
  /** Deterministic counts and timing bounds expected from materialization. */
  readonly summary: SyntheticArrowTraceFixtureSummary;
};

/**
 * Build deterministic process-scoped Arrow chunks without materializing JSONTrace or TraceSpan
 * object rows.
 */
export function buildSyntheticArrowTraceFixture(
  options: SyntheticArrowTraceFixtureOptions
): SyntheticArrowTraceFixture {
  const rowCount = requirePositiveInteger(options.rowCount, 'rowCount');
  const processCount = Math.min(
    rowCount,
    requirePositiveInteger(options.processCount ?? Math.min(8, rowCount), 'processCount')
  );
  const threadsPerProcess = requirePositiveInteger(
    options.threadsPerProcess ?? 4,
    'threadsPerProcess'
  );
  const textFilterMatchEvery =
    options.textFilterMatchEvery == null
      ? null
      : requirePositiveInteger(options.textFilterMatchEvery, 'textFilterMatchEvery');
  const identityKey = options.identityKey ?? 'synthetic-arrow-trace-' + rowCount;
  const chunks = buildSyntheticTraceChunks({
    identityKey,
    processCount,
    rowCount,
    textFilterMatchEvery,
    threadsPerProcess
  });
  const traceStore = createStaticTraceChunkStore({identityKey, chunks});
  const selection = traceStore.select({
    window: {startTimeMs: 1, endTimeMs: rowCount + 1},
    spanBudget: null
  });
  let materializationInputs: SyntheticArrowTraceMaterializationInputs | null = null;
  traceStore.withReadyChunks(selection, ({ownerRefRegistry, readyChunks}) => {
    materializationInputs = {ownerRefRegistry, readyChunks};
    return null;
  });
  if (!materializationInputs) {
    throw new Error('Expected synthetic trace chunks to be ready for materialization.');
  }

  return {
    chunks,
    traceStore,
    materializationInputs,
    summary: {
      spanCount: rowCount,
      processCount,
      threadCount: computeSyntheticThreadCount(rowCount, processCount, threadsPerProcess),
      sameProcessDependencyCount: rowCount - processCount,
      minTimeMs: 1,
      maxTimeMs: rowCount + 1,
      textFilterMatchCount:
        textFilterMatchEvery == null ? 0 : Math.floor((rowCount - 1) / textFilterMatchEvery) + 1
    }
  };
}

/** Build process-scoped parser-local chunks from aligned synthetic Arrow columns. */
function buildSyntheticTraceChunks(params: {
  /** Stable fixture identity used in generated chunk keys. */
  readonly identityKey: string;
  /** Number of process-scoped chunks to generate. */
  readonly processCount: number;
  /** Number of span rows generated across chunks. */
  readonly rowCount: number;
  /** Optional global row stride whose matching rows receive the text-filter match name. */
  readonly textFilterMatchEvery: number | null;
  /** Number of repeated thread lanes generated per process. */
  readonly threadsPerProcess: number;
}): readonly TraceChunkData[] {
  const chunks: TraceChunkData[] = [];
  let globalRowOffset = 0;
  for (let processIndex = 0; processIndex < params.processCount; processIndex += 1) {
    const localRowCount =
      Math.floor(params.rowCount / params.processCount) +
      (processIndex < params.rowCount % params.processCount ? 1 : 0);
    chunks.push(
      buildSyntheticProcessChunk({
        chunkKey: params.identityKey + ':process:' + processIndex,
        globalRowOffset,
        localRowCount,
        processIndex,
        textFilterMatchEvery: params.textFilterMatchEvery,
        threadsPerProcess: params.threadsPerProcess
      })
    );
    globalRowOffset += localRowCount;
  }
  return chunks;
}

/** Build one process-scoped parser-local chunk from aligned scalar columns. */
function buildSyntheticProcessChunk(params: {
  /** Stable chunk key used by the static chunk store. */
  readonly chunkKey: string;
  /** First global synthetic row represented by this chunk. */
  readonly globalRowOffset: number;
  /** Number of rows represented by this chunk. */
  readonly localRowCount: number;
  /** Dense synthetic process ordinal. */
  readonly processIndex: number;
  /** Optional global row stride whose matching rows receive the text-filter match name. */
  readonly textFilterMatchEvery: number | null;
  /** Number of repeated thread lanes generated for this process. */
  readonly threadsPerProcess: number;
}): TraceChunkData {
  const processId = ('synthetic-process-' + params.processIndex) as TraceProcessId;
  const threadCount = Math.min(params.threadsPerProcess, params.localRowCount);
  const threads = buildSyntheticThreads(processId, threadCount);
  const threadIds = Array.from({length: params.localRowCount}, (_, rowIndex) => {
    const thread = threads[rowIndex % threadCount];
    if (!thread) {
      throw new Error('Expected synthetic thread metadata for every span row.');
    }
    return thread.threadId;
  });
  const spanIds = Array.from(
    {length: params.localRowCount},
    (_, rowIndex) => ('synthetic-span-' + (params.globalRowOffset + rowIndex)) as TraceSpanId
  );
  const startTimeMs = Array.from(
    {length: params.localRowCount},
    (_, rowIndex) => params.globalRowOffset + rowIndex + 1
  );
  const endTimeMs = startTimeMs.map(startTime => startTime + 1);
  const dependencyCount = Math.max(0, params.localRowCount - 1);
  const process = buildSyntheticProcessMetadata(processId, params.processIndex, threads);

  return {
    type: 'trace-chunk-data',
    chunkKey: params.chunkKey,
    processes: [process],
    processId,
    spanTable: buildArrowTraceSpanTableFromColumns({
      process_ref: Array(params.localRowCount).fill(encodeProcessRef(params.processIndex)),
      thread_ref: threadIds.map((_, rowIndex) =>
        encodeProcessThreadRef(params.processIndex, rowIndex % threadCount)
      ),
      span_id: spanIds,
      external_span_id: spanIds,
      thread_id: threadIds,
      name: Array.from({length: params.localRowCount}, (_, rowIndex) =>
        params.textFilterMatchEvery != null &&
        (params.globalRowOffset + rowIndex) % params.textFilterMatchEvery === 0
          ? SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME
          : 'synthetic-work'
      ),
      primary_timing_key: Array(params.localRowCount).fill('primary'),
      status: Array(params.localRowCount).fill('finished'),
      start_time_ms: startTimeMs,
      end_time_ms: endTimeMs,
      duration_ms: Array(params.localRowCount).fill(1)
    }),
    resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTableFromColumns({
      startSpanRef: Array.from({length: dependencyCount}, (_, rowIndex) =>
        encodeSpanRef(params.processIndex, rowIndex)
      ),
      endSpanRef: Array.from({length: dependencyCount}, (_, rowIndex) =>
        encodeSpanRef(params.processIndex, rowIndex + 1)
      ),
      waitMode: Array(dependencyCount).fill('end-to-start'),
      bidirectional: Array(dependencyCount).fill(false),
      waitTimeMs: Array(dependencyCount).fill(0),
      hasParentKeyword: Array(dependencyCount).fill(false)
    }),
    diagnostics: {
      rowCount: params.localRowCount,
      notStartedSpanCount: 0,
      unfinishedSpanCount: 0,
      invalidRecordCount: 0,
      minTimeMs: startTimeMs[0] ?? null,
      maxTimeMs: endTimeMs[endTimeMs.length - 1] ?? null,
      warningCounters: {}
    },
    refState: 'parser-local'
  };
}

/** Build repeated synthetic thread metadata for one generated process. */
function buildSyntheticThreads(
  processId: TraceProcessId,
  threadCount: number
): readonly TraceThread[] {
  return Array.from({length: threadCount}, (_, threadIndex) => {
    const threadId = (processId + ':thread:' + threadIndex) as TraceThreadId;
    return {
      type: 'trace-thread',
      processId,
      threadId,
      name: 'Thread ' + threadIndex
    };
  });
}

/** Build lightweight process metadata without compatibility span or dependency objects. */
function buildSyntheticProcessMetadata(
  processId: TraceProcessId,
  processIndex: number,
  threads: readonly TraceThread[]
): ArrowTraceProcessMetadata {
  return {
    type: 'trace-process',
    processId,
    name: 'Synthetic Process ' + processIndex,
    tags: [],
    rankNum: processIndex,
    processOrder: processIndex,
    stepNum: 0,
    threads: [...threads],
    threadMap: Object.fromEntries(threads.map(thread => [thread.threadId, thread])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    sameProcessDependencies: [],
    remoteDependencies: []
  };
}

/** Count generated thread metadata rows across uneven process chunk sizes. */
function computeSyntheticThreadCount(
  rowCount: number,
  processCount: number,
  threadsPerProcess: number
): number {
  let threadCount = 0;
  for (let processIndex = 0; processIndex < processCount; processIndex += 1) {
    const localRowCount =
      Math.floor(rowCount / processCount) + (processIndex < rowCount % processCount ? 1 : 0);
    threadCount += Math.min(threadsPerProcess, localRowCount);
  }
  return threadCount;
}

/** Validate one positive integer fixture option. */
function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Expected ' + name + ' to be a positive integer; received ' + value + '.');
  }
  return value;
}
