import {
  decodeChromeTraceArrowSource,
  readChromeTraceArrowSourceMetadata
} from './loaders/chrome-trace-loader/chrome-trace-arrow-adapter';
import {parseChromeTraceToArrowRecordBatches} from './loaders/chrome-trace-loader/chrome-trace-arrow-parser';
import {parseChromeTrace} from './loaders/chrome-trace-loader/parse-chrome-trace';
import {buildTraceRanksFromChromeTrace} from './trace-chrome/build-trace-graph-from-chrome-trace';
import {createTraceStreamReplaceChunk} from './trace-stream-session';

import type {ChromeTraceArrowSourceItem} from './loaders/chrome-trace-loader/chrome-trace-arrow-adapter';
import type {ChromeTraceArrowParseOptions} from './loaders/chrome-trace-loader/chrome-trace-arrow-parser';
import type {
  ChromeTraceEventSchema,
  ChromeTraceFileSchema
} from './loaders/chrome-trace-loader/chrome-trace-schema';
import type {ChromeTraceParseOptions} from './loaders/chrome-trace-loader/parse-chrome-trace';
import type {BuildChromeTraceRanksOptions} from './trace-chrome/build-trace-graph-from-chrome-trace';
import type {
  TraceStreamChunk,
  TraceStreamPublishedSnapshot,
  TraceStreamSession
} from './trace-stream-session';

export type {ChromeTraceArrowSourceItem};

/** One item yielded by a parsed Chrome-event async stream. */
export type ChromeTraceEventStreamItem =
  | ChromeTraceEventSchema
  | ReadonlyArray<ChromeTraceEventSchema>;

/** Shared options for Chrome streaming ingestion helpers. */
export type ChromeTraceStreamOptions = ChromeTraceParseOptions &
  BuildChromeTraceRanksOptions &
  ChromeTraceArrowParseOptions & {
    /** Human-readable trace name used in published replacement snapshots. */
    name?: string;
    /** Explicit display time unit for streamed events when top-level metadata is absent. */
    displayTimeUnit?: string;
    /** Explicit top-level metadata for streamed events when file metadata is absent. */
    metadata?: Record<string, unknown>;
    /** Event count threshold that triggers one replacement publish while consuming a stream. */
    publishEveryEvents?: number;
  };

/**
 * Build replacement chunks from a parsed Chrome Trace event stream.
 */
export async function* streamChromeTraceEventChunks(
  source: AsyncIterable<ChromeTraceEventStreamItem>,
  options: ChromeTraceStreamOptions = {}
): AsyncIterable<TraceStreamChunk> {
  const state = createChromeTraceAccumulator(options);

  for await (const item of source) {
    const events = Array.isArray(item) ? item : [item];
    appendChromeTraceEvents(state, events);
    if (state.eventsSincePublish >= state.publishEveryEvents) {
      const chunk = buildChromeTraceAccumulatorChunk(state);
      if (chunk) {
        yield chunk;
      }
    }
  }

  const finalChunk = buildChromeTraceAccumulatorChunk(state);
  if (finalChunk) {
    yield finalChunk;
  }
}

/**
 * Builds replacement chunks from an Arrow-backed Chrome trace event stream.
 */
export async function* streamChromeTraceArrowChunks(
  source: AsyncIterable<ChromeTraceArrowSourceItem>,
  options: ChromeTraceStreamOptions = {}
): AsyncIterable<TraceStreamChunk> {
  const state = createChromeTraceAccumulator(options);

  for await (const item of source) {
    const metadata = readChromeTraceArrowSourceMetadata(item);
    state.displayTimeUnit = metadata.displayTimeUnit ?? state.displayTimeUnit;
    state.metadata = metadata.metadata ?? state.metadata;
    appendChromeTraceEvents(state, decodeChromeTraceArrowSource(item));

    if (state.eventsSincePublish >= state.publishEveryEvents) {
      const chunk = buildChromeTraceAccumulatorChunk(state);
      if (chunk) {
        yield chunk;
      }
    }
  }

  const finalChunk = buildChromeTraceAccumulatorChunk(state);
  if (finalChunk) {
    yield finalChunk;
  }
}

/**
 * Builds replacement chunks from a chunked Chrome Trace JSON file stream.
 */
export async function* streamChromeTraceFileChunks(
  source: AsyncIterable<string | ArrayBufferLike | ArrayBufferView>,
  options: ChromeTraceStreamOptions = {}
): AsyncIterable<TraceStreamChunk> {
  const arrowSource = parseChromeTraceToArrowRecordBatches(source, {
    batchSize: options.batchSize,
    maxLength: options.maxLength
  });

  yield* streamChromeTraceArrowChunks(arrowSource, options);
}

/**
 * Consume a parsed Chrome Trace event stream into one existing live trace session.
 */
export async function consumeChromeTraceEventStream(
  session: TraceStreamSession,
  source: AsyncIterable<ChromeTraceEventStreamItem>,
  options: ChromeTraceStreamOptions = {}
): Promise<TraceStreamPublishedSnapshot | null> {
  let latestSnapshot: TraceStreamPublishedSnapshot | null = null;
  for await (const chunk of streamChromeTraceEventChunks(source, options)) {
    session.applyChunk(chunk);
    latestSnapshot = session.publishSnapshot() ?? latestSnapshot;
  }
  return latestSnapshot ?? session.publishSnapshot();
}

/**
 * Consume an Arrow-backed Chrome Trace stream into one existing live trace session.
 */
export async function consumeChromeTraceArrowStream(
  session: TraceStreamSession,
  source: AsyncIterable<ChromeTraceArrowSourceItem>,
  options: ChromeTraceStreamOptions = {}
): Promise<TraceStreamPublishedSnapshot | null> {
  let latestSnapshot: TraceStreamPublishedSnapshot | null = null;
  for await (const chunk of streamChromeTraceArrowChunks(source, options)) {
    session.applyChunk(chunk);
    latestSnapshot = session.publishSnapshot() ?? latestSnapshot;
  }
  return latestSnapshot ?? session.publishSnapshot();
}

/**
 * Consume a chunked Chrome Trace JSON file stream into one existing live trace session.
 */
export async function consumeChromeTraceFileStream(
  session: TraceStreamSession,
  source: AsyncIterable<string | ArrayBufferLike | ArrayBufferView>,
  options: ChromeTraceStreamOptions = {}
): Promise<TraceStreamPublishedSnapshot | null> {
  let latestSnapshot: TraceStreamPublishedSnapshot | null = null;
  for await (const chunk of streamChromeTraceFileChunks(source, options)) {
    session.applyChunk(chunk);
    latestSnapshot = session.publishSnapshot() ?? latestSnapshot;
  }
  return latestSnapshot ?? session.publishSnapshot();
}

type ChromeTraceAccumulatorState = {
  /** Human-readable published trace name. */
  name: string;
  /** Accumulated Chrome events preserved across incremental publishes. */
  events: ChromeTraceEventSchema[];
  /** Optional display time unit resolved from the stream. */
  displayTimeUnit?: string;
  /** Optional top-level metadata resolved from the stream. */
  metadata?: Record<string, unknown>;
  /** Event count threshold for replacement publishes. */
  publishEveryEvents: number;
  /** Number of events added since the previous replacement publish. */
  eventsSincePublish: number;
  /** Parser options reused for every replacement publish. */
  parseOptions: ChromeTraceParseOptions;
  /** Rank-building options reused for every replacement publish. */
  buildOptions: BuildChromeTraceRanksOptions;
};

/**
 * Create one mutable accumulator used by the Chrome streaming helpers.
 */
function createChromeTraceAccumulator(
  options: ChromeTraceStreamOptions
): ChromeTraceAccumulatorState {
  return {
    name: options.name ?? 'Chrome Trace Live Stream',
    events: [],
    displayTimeUnit: options.displayTimeUnit,
    metadata: options.metadata,
    publishEveryEvents: normalizeChromeTracePublishEveryEvents(options.publishEveryEvents),
    eventsSincePublish: 0,
    parseOptions: options,
    buildOptions: options
  };
}

/**
 * Append parsed Chrome events into the shared accumulator.
 */
function appendChromeTraceEvents(
  state: ChromeTraceAccumulatorState,
  events: ReadonlyArray<ChromeTraceEventSchema>
): void {
  if (events.length === 0) {
    return;
  }

  state.events.push(...events);
  state.eventsSincePublish += events.length;
}

/**
 * Build one immutable replacement chunk from the accumulated Chrome events.
 */
function buildChromeTraceAccumulatorChunk(
  state: ChromeTraceAccumulatorState
): TraceStreamChunk | null {
  if (state.events.length === 0) {
    return null;
  }
  const traceFile: ChromeTraceFileSchema = {
    traceEvents: state.events,
    ...(state.displayTimeUnit ? {displayTimeUnit: state.displayTimeUnit} : {}),
    ...(state.metadata ? {metadata: state.metadata} : {})
  };
  const trace = parseChromeTrace(traceFile, state.parseOptions);
  const {ranks, crossDependencies} = buildTraceRanksFromChromeTrace(trace, state.buildOptions);
  const chunk = createTraceStreamReplaceChunk({
    name: state.name,
    processes: ranks,
    crossDependencies
  });
  state.eventsSincePublish = 0;
  return chunk;
}

/**
 * Normalize the incremental publish threshold for Chrome streaming.
 */
function normalizeChromeTracePublishEveryEvents(publishEveryEvents: number | undefined): number {
  if (
    publishEveryEvents == null ||
    !Number.isFinite(publishEveryEvents) ||
    publishEveryEvents <= 0
  ) {
    return 256;
  }
  return Math.max(1, Math.floor(publishEveryEvents));
}
