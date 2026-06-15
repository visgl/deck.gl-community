import {getHeapUsageProbeFields, log} from '../log';
import {
  getSpanExtremalTimingForTimeExtents,
  getSpanFiniteTimingEnvelopeForTimeExtents
} from '../trace-graph-accessors';
import {buildSpanDependencyMap} from '../trace-graph/trace-dependency-utils';
import {
  buildArrowTraceEventTableFromEvents,
  buildTraceEventMap,
  EMPTY_ARROW_TRACE_EVENT_TABLE
} from '../trace-graph/trace-event-table';
import {
  getPrimaryTiming,
  TraceCounter,
  TraceCounterId,
  TraceCrossProcessDependency,
  TraceDependency,
  TraceDependencyId,
  TraceEvent,
  TraceEventId,
  TraceInstant,
  TraceInstantId,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceSpanLayoutMode,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../trace-graph/trace-types';
import {
  clamp,
  COLLAPSED_ACTIVITY_FALLBACK_COLOR_RGB,
  COLLAPSED_ACTIVITY_MIN_WIDTH_MS,
  getCollapsedActivityStep,
  toRgb
} from '../trace-graph/utils/collapsed-activity';
import {sliceMipmap} from '../trace-graph/utils/slice-mipmap';
import {createTraceColorResolver} from '../trace-style/trace-colors';

import type {ArrowTraceEventTable} from '../trace-graph/trace-event-table';
import type {TraceGraphStats} from '../trace-graph/trace-graph-stats';
import type {Slice} from '../trace-graph/utils/slice-mipmap';
import type {TraceProcessActivityInterval} from '../trace-layout/trace-layout';
import type {TraceColorScheme, TraceSpanColorSource} from '../trace-style/trace-color-scheme';

type TraceGraphStatsOverrides = Partial<
  Pick<
    TraceGraphStats,
    'droppedSpanCount' | 'droppedDependencyCount' | 'droppedCrossDependencyCount'
  >
>;

export type BuildJSONTraceOptions = {
  /** Human-friendly name for the JSON trace. */
  name: string;
  /** Whether spans use generated lanes or authored thread-relative vertical geometry. */
  spanLayout?: TraceSpanLayoutMode;
  /** Optional graph-global events serialized with the public JSON trace. */
  events?: ReadonlyArray<TraceEvent>;
  /** Canonical time extents to use instead of deriving them from span/event timings. */
  timeExtents?: TraceGraphTimeExtents;
  stats?: TraceGraphStatsOverrides;
};

type TraceGraphTimeExtents = {
  /** Earliest canonical timestamp in the graph. */
  minTimeMs: number;
  /** Latest canonical timestamp in the graph. */
  maxTimeMs: number;
};

export type JSONTrace = {
  type: 'trace-graph';

  /** Human friendly name for this JSON trace (e.g. "Step 1") */
  name: string;

  /** Whether spans use generated lanes or authored thread-relative vertical geometry. */
  spanLayout?: TraceSpanLayoutMode;

  /** List of ranks */
  processes: Readonly<JSONTraceProcess[]>;
  /** List of cross dependencies across ranks. */
  crossDependencies?: Readonly<JSONTraceCrossProcessDependency[]>;
  /** Optional graph-global events serialized with the public JSON trace. */
  events?: Readonly<TraceEvent[]>;
  /** Optional canonical time extents for the trace. */
  timeExtents?: TraceGraphTimeExtents;
};

/**
 * Public JSON-safe process record without derived lookup maps.
 */
export type JSONTraceProcess = Omit<
  TraceProcess,
  | 'threads'
  | 'threadMap'
  | 'spans'
  | 'spanMap'
  | 'instants'
  | 'instantMap'
  | 'threadInstantMap'
  | 'counters'
  | 'counterMap'
  | 'threadCounterMap'
  | 'localDependencies'
> & {
  /** Public thread rows in authoring order. */
  threads: Readonly<TraceThread[]>;
  /** Public span rows in authoring order. */
  spans: Readonly<JSONTraceSpan[]>;
  /** Public instant rows in authoring order. */
  instants: Readonly<TraceInstant[]>;
  /** Public counter rows in authoring order. */
  counters: Readonly<TraceCounter[]>;
  /** Public local dependency rows defined once per process. */
  localDependencies: Readonly<JSONTraceLocalDependency[]>;
};

/**
 * Public JSON-safe span record without duplicated dependency objects.
 */
export type JSONTraceSpan = Omit<TraceSpan, 'localDependencies'>;

/**
 * Public JSON-safe local dependency record.
 */
export type JSONTraceLocalDependency = Omit<TraceLocalDependency, 'keywords'> & {
  /** Keyword labels serialized as JSON strings. */
  keywords: ReadonlyArray<string>;
};

/**
 * Public JSON-safe cross-process dependency record.
 */
export type JSONTraceCrossProcessDependency = Omit<TraceCrossProcessDependency, 'keywords'> & {
  /** Keyword labels serialized as JSON strings. */
  keywords: ReadonlyArray<string>;
};

/**
 * Internal indexed graph representation used after normalizing a public {@link JSONTrace}.
 */
export type MaterializedJSONTrace = {
  /** Stable graph type tag. */
  type: 'trace-graph';
  /** Human-friendly trace name. */
  name: string;
  /** Normalized span layout mode for runtime consumers. */
  spanLayout: TraceSpanLayoutMode;
  /** List of normalized processes. */
  processes: Readonly<TraceProcess[]>;
  /** List of cross-process dependencies. */
  crossDependencies: Readonly<TraceCrossProcessDependency[]>;
  /** Minimum time in the trace, used for scaling. */
  minTimeMs: number;
  /** Maximum time in the trace, used for scaling. */
  maxTimeMs: number;
  /** Map of all threads across all processes. */
  threadMap: Record<TraceThreadId, TraceThread>;
  /** Map of all instants across the trace, keyed by thread. */
  threadInstantMap: Record<TraceThreadId, TraceInstant[]>;
  /** Map of all counters across the trace, keyed by thread. */
  threadCounterMap: Record<TraceThreadId, TraceCounter[]>;
  /** Map for fast lookups of instants across all processes. */
  instantMap: Readonly<Record<TraceInstantId, TraceInstant>>;
  /** Map for fast lookups of counters across all processes. */
  counterMap: Readonly<Record<TraceCounterId, TraceCounter>>;
  /** Extents for counter totals per thread. */
  counterExtents: Readonly<Record<TraceThreadId, {min: number; max: number}>>;
  /** Canonical graph-global Arrow event table. */
  events: Readonly<ArrowTraceEventTable>;
  /** Map for fast lookups of graph-global events across the trace. */
  eventMap: Readonly<Record<TraceEventId, TraceEvent>>;
  /** Map for fast lookups of spans across all processes. */
  spanMap: Readonly<Record<TraceSpanId, TraceSpan>>;
  /** Map for fast lookups of dependencies across the trace. */
  dependencyMap: Readonly<Record<TraceDependencyId, TraceDependency>>;
  /** Map for fast lookups of dependencies by span id. */
  spanDependencyMap: Readonly<Record<TraceSpanId, TraceDependency[]>>;
  /** Aggregated counts about the trace. */
  stats: TraceGraphStats;
};

export const EMPTY_JSON_TRACE = {
  type: 'trace-graph',
  name: 'Trace Graph',
  spanLayout: 'auto',
  processes: [] as JSONTraceProcess[],
  crossDependencies: [] as JSONTraceCrossProcessDependency[],
  events: [] as TraceEvent[],
  timeExtents: {minTimeMs: 0, maxTimeMs: 0}
} as const satisfies JSONTrace;

function normalizeTraceEventTable(events: JSONTrace['events']): Readonly<ArrowTraceEventTable> {
  if (!events) {
    return EMPTY_ARROW_TRACE_EVENT_TABLE;
  }
  return buildArrowTraceEventTableFromEvents(events);
}

type TraceProcessActivityByProcessId = Readonly<
  Record<string, ReadonlyArray<TraceProcessActivityInterval>>
>;

type TraceCollapsedActivitySource = Pick<MaterializedJSONTrace, 'minTimeMs' | 'maxTimeMs'> & {
  /** Stores the visible per-process block rows used for collapsed activity sampling. */
  processes: ReadonlyArray<TraceCollapsedActivityProcessRow>;
};

/**
 * Minimal visible row data needed to build collapsed-activity summaries without a graph clone.
 */
export type TraceCollapsedActivityProcessRow = {
  /** Identifies the visible process row. */
  readonly processId: TraceProcess['processId'];
  /** Lists the visible threads represented by the row. */
  readonly threads: readonly TraceProcess['threads'][number][];
  /** Lists the visible spans represented by the row. */
  readonly spans: readonly TraceSpanColorSource[];
};

/**
 * Builds collapsed-activity summaries from visible process rows instead of a graph-shaped object.
 */
export function buildCollapsedActivityByProcessRows(params: {
  /** Canonical minimum time used as the collapsed-activity X origin. */
  readonly minTimeMs: number;
  /** Canonical maximum time used to size the collapsed-activity window. */
  readonly maxTimeMs: number;
  /** Visible per-process rows to summarize. */
  readonly processRows: ReadonlyArray<TraceCollapsedActivityProcessRow>;
  /** Color scheme used to sample representative block colors. */
  readonly colorScheme: TraceColorScheme;
  /** Visualization settings that affect span coloring and summary density. */
  readonly settings: TraceVisSettings;
}): TraceProcessActivityByProcessId {
  return buildCollapsedActivityByProcessIdInternal(
    {
      minTimeMs: params.minTimeMs,
      maxTimeMs: params.maxTimeMs,
      processes: params.processRows
    },
    params.colorScheme,
    params.settings
  );
}

/**
 * Builds collapsed-activity summaries from a graph-shaped visible source.
 */
export function buildCollapsedActivityByProcessId(
  traceGraph: TraceCollapsedActivitySource | JSONTrace,
  colorScheme: TraceColorScheme,
  settings: TraceVisSettings
): TraceProcessActivityByProcessId {
  const source =
    'minTimeMs' in traceGraph && 'maxTimeMs' in traceGraph
      ? traceGraph
      : materializeJSONTrace(traceGraph);
  return buildCollapsedActivityByProcessIdInternal(source, colorScheme, settings);
}

function buildCollapsedActivityByProcessIdInternal(
  traceGraph: TraceCollapsedActivitySource,
  colorScheme: TraceColorScheme,
  settings: TraceVisSettings
): TraceProcessActivityByProcessId {
  const buildStartTime = performance.now();
  let colorSamplingDurationMs = 0;
  let sliceConstructionDurationMs = 0;
  let mipmapDurationMs = 0;
  let intervalReductionDurationMs = 0;
  let blockCount = 0;
  let sliceCount = 0;
  let bucketCount = 0;
  const intervalsByProcessId: Record<string, TraceProcessActivityInterval[]> = {};
  const defaultWindowEnd = Math.max(0, traceGraph.maxTimeMs - traceGraph.minTimeMs);
  const colorResolver = createTraceColorResolver({colorScheme, settings});

  for (const rank of traceGraph.processes) {
    const streamDepthMap = new Map<TraceThreadId, number>();
    rank.threads.forEach((thread, index) => {
      streamDepthMap.set(thread.threadId, index);
    });

    const spanColorMap = new Map<number, [number, number, number]>();
    const colorSamplingStartTime = performance.now();
    rank.spans.forEach((block, index) => {
      spanColorMap.set(
        index,
        toRgb(colorResolver.getSpanFillColor(block, 'any')) ?? [
          ...COLLAPSED_ACTIVITY_FALLBACK_COLOR_RGB
        ]
      );
    });
    colorSamplingDurationMs += performance.now() - colorSamplingStartTime;
    blockCount += rank.spans.length;

    let maxSliceEnd = 0;
    const sliceConstructionStartTime = performance.now();
    const slices = rank.spans
      .map((block, index) => {
        const timing = getPrimaryTiming(block);
        if (!Number.isFinite(timing.startTimeMs) || !Number.isFinite(timing.endTimeMs)) {
          return null;
        }
        const ts = Math.min(timing.startTimeMs, timing.endTimeMs) - traceGraph.minTimeMs;
        const end = Math.max(timing.startTimeMs, timing.endTimeMs) - traceGraph.minTimeMs;
        if (!Number.isFinite(ts) || !Number.isFinite(end)) {
          return null;
        }
        const dur = Math.max(COLLAPSED_ACTIVITY_MIN_WIDTH_MS, end - ts);
        maxSliceEnd = Math.max(maxSliceEnd, ts + dur);
        return {
          id: index,
          ts,
          dur,
          depth: streamDepthMap.get(block.threadId) ?? 0
        } satisfies Slice;
      })
      .filter((slice): slice is Slice => Boolean(slice));
    sliceConstructionDurationMs += performance.now() - sliceConstructionStartTime;
    sliceCount += slices.length;

    if (slices.length === 0) {
      intervalsByProcessId[rank.processId] = [];
      continue;
    }

    const windowStart = 0;
    const windowEnd = Math.max(defaultWindowEnd, maxSliceEnd);
    if (!(windowEnd > windowStart)) {
      intervalsByProcessId[rank.processId] = [];
      continue;
    }

    const step = getCollapsedActivityStep(windowEnd - windowStart, streamDepthMap.size || 1);
    const mipmapStartTime = performance.now();
    const rows = sliceMipmap(slices, windowStart, windowEnd, step, {
      includeOverlappingPrev: true,
      perfettoOverlapHeuristic: false,
      sortOutput: true
    });
    mipmapDurationMs += performance.now() - mipmapStartTime;

    const bucketSummary = new Map<
      number,
      {
        bucketStart: number;
        bucketEnd: number;
        sampleCount: number;
        depthCount: number;
        dominantWeight: number;
        dominantColor: [number, number, number];
      }
    >();
    const intervalReductionStartTime = performance.now();
    for (const row of rows) {
      const rowColor = spanColorMap.get(row.id) ?? [...COLLAPSED_ACTIVITY_FALLBACK_COLOR_RGB];
      const rowWeight = Math.max(0, row.sampleCount);
      const existing = bucketSummary.get(row.bucketIndex);
      if (!existing) {
        bucketSummary.set(row.bucketIndex, {
          bucketStart: row.bucketStart,
          bucketEnd: row.bucketEnd,
          sampleCount: Math.max(0, row.sampleCount),
          depthCount: 1,
          dominantWeight: rowWeight,
          dominantColor: rowColor
        });
        continue;
      }
      existing.sampleCount += Math.max(0, row.sampleCount);
      existing.depthCount += 1;
      if (rowWeight > existing.dominantWeight) {
        existing.dominantWeight = rowWeight;
        existing.dominantColor = rowColor;
      }
    }
    bucketCount += bucketSummary.size;

    const intervals = [...bucketSummary.values()]
      .sort((a, b) => a.bucketStart - b.bucketStart)
      .reduce<TraceProcessActivityInterval[]>((next, bucket) => {
        const startX = clamp(bucket.bucketStart, windowStart, windowEnd);
        const endX = clamp(
          Math.max(bucket.bucketEnd, startX + COLLAPSED_ACTIVITY_MIN_WIDTH_MS),
          windowStart,
          windowEnd
        );
        if (!(endX > startX)) {
          return next;
        }
        next.push({
          startX,
          endX,
          activity: Math.max(1, bucket.sampleCount, bucket.depthCount),
          color: bucket.dominantColor
        });
        return next;
      }, []);
    intervalReductionDurationMs += performance.now() - intervalReductionStartTime;

    intervalsByProcessId[rank.processId] = intervals;
  }

  log.probe(0, 'buildCollapsedActivityByProcessRows done', {
    rowCount: traceGraph.processes.length,
    blockCount,
    sliceCount,
    bucketCount,
    colorSamplingDurationMs,
    sliceConstructionDurationMs,
    mipmapDurationMs,
    intervalReductionDurationMs,
    durationMs: performance.now() - buildStartTime,
    ...getHeapUsageProbeFields()
  })();
  return intervalsByProcessId;
}

export function buildJSONTrace(
  processes: Readonly<TraceProcess[]>,
  crossDependencies: Readonly<TraceCrossProcessDependency[]>,
  options: BuildJSONTraceOptions = {name: 'Trace Graph'}
): Readonly<JSONTrace> {
  const timeExtents = normalizeTraceGraphTimeExtents(options.timeExtents) ?? undefined;

  return {
    type: 'trace-graph',
    name: options.name,
    spanLayout: normalizeTraceSpanLayoutMode(options.spanLayout),
    processes: processes.map(serializeJSONTraceProcess),
    crossDependencies: crossDependencies.map(serializeCrossProcessDependency),
    events: options.events,
    timeExtents
  } satisfies JSONTrace;
}

/**
 * Builds the indexed runtime companion for a public {@link JSONTrace}.
 */
export function materializeJSONTrace(
  traceGraph: Readonly<JSONTrace> | Readonly<MaterializedJSONTrace>,
  statsOverrides?: TraceGraphStatsOverrides
): Readonly<MaterializedJSONTrace> {
  if (isMaterializedJSONTrace(traceGraph)) {
    return traceGraph;
  }

  const processes = traceGraph.processes;
  const crossDependencies = (traceGraph.crossDependencies ?? []).map(
    materializeCrossProcessDependency
  );
  const normalizedProcesses = processes.map(materializeTraceProcess);
  const spanDependencyMap = buildSpanDependencyMap(normalizedProcesses, crossDependencies);
  const threadMap = normalizedProcesses.reduce(
    (acc, rank) => {
      rank.threads.forEach(thread => {
        acc[thread.threadId] = thread;
      });
      return acc;
    },
    {} as Record<TraceThreadId, TraceThread>
  );

  const spanMap = normalizedProcesses.reduce(
    (acc, rank) => {
      rank.spans.forEach(block => {
        acc[block.spanId] = block;
      });
      return acc;
    },
    {} as Record<TraceSpanId, TraceSpan>
  );

  const dependencyMap = normalizedProcesses.reduce(
    (acc, rank) => {
      rank.localDependencies?.forEach(dep => {
        acc[dep.dependencyId] = dep;
      });
      return acc;
    },
    {} as Record<TraceDependencyId, TraceDependency>
  );

  const instantMap = normalizedProcesses.reduce(
    (acc, rank) => Object.assign(acc, rank.instantMap),
    {} as Record<TraceInstantId, TraceInstant>
  );

  const counterMap = normalizedProcesses.reduce(
    (acc, rank) => Object.assign(acc, rank.counterMap),
    {} as Record<TraceCounterId, TraceCounter>
  );

  const threadInstantMap = normalizedProcesses.reduce(
    (acc, rank) => {
      Object.entries(rank.threadInstantMap).forEach(([threadId, instants]) => {
        const key = threadId as TraceThreadId;
        const list = acc[key] ?? [];
        list.push(...instants);
        acc[key] = list;
      });
      return acc;
    },
    {} as Record<TraceThreadId, TraceInstant[]>
  );

  const threadCounterMap = normalizedProcesses.reduce(
    (acc, rank) => {
      Object.entries(rank.threadCounterMap).forEach(([threadId, counters]) => {
        const key = threadId as TraceThreadId;
        const list = acc[key] ?? [];
        list.push(...counters);
        acc[key] = list;
      });
      return acc;
    },
    {} as Record<TraceThreadId, TraceCounter[]>
  );

  const counterExtents = Object.entries(threadCounterMap).reduce(
    (acc, [threadId, counters]) => {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      counters.forEach(counter => {
        if (Number.isFinite(counter.totalValue)) {
          min = Math.min(min, counter.totalValue);
          max = Math.max(max, counter.totalValue);
        }
      });
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = 0;
        max = 0;
      }
      acc[threadId as TraceThreadId] = {min, max};
      return acc;
    },
    {} as Record<TraceThreadId, {min: number; max: number}>
  );

  const stats = buildTraceGraphStats(normalizedProcesses, crossDependencies, statsOverrides);
  const events = normalizeTraceEventTable(traceGraph.events);
  const eventMap = buildTraceEventMap(events);

  const timeExtents =
    normalizeTraceGraphTimeExtents(traceGraph.timeExtents) ??
    computeTraceGraphTimeExtents(normalizedProcesses, events);

  return {
    type: 'trace-graph',
    name: traceGraph.name,
    spanLayout: normalizeTraceSpanLayoutMode(traceGraph.spanLayout),
    processes: normalizedProcesses,
    crossDependencies,
    minTimeMs: timeExtents.minTimeMs,
    maxTimeMs: timeExtents.maxTimeMs,
    spanDependencyMap,
    spanMap,
    dependencyMap,
    threadMap,
    threadInstantMap,
    threadCounterMap,
    instantMap,
    counterMap,
    events,
    eventMap,
    counterExtents,
    stats
  } satisfies MaterializedJSONTrace;
}

export function getTraceSpanMap(processes: Readonly<TraceProcess[]>) {
  const map = {} as Record<string, TraceSpan>;
  processes.forEach(rank => {
    rank.spans.forEach(block => {
      map[block.spanId] = block;
    });
  });
  return map;
}

export function getTraceStreamMap(processes: Readonly<TraceProcess[]>) {
  const map = {} as Record<string, TraceThread>;
  processes.forEach(rank => {
    rank.threads.forEach(thread => {
      map[thread.threadId] = thread;
    });
  });
  return map;
}

export function getThreadFromSpan(
  traceGraph: Readonly<JSONTrace>,
  spanId: TraceSpanId
): TraceThread | null {
  const materializedTraceGraph = materializeJSONTrace(traceGraph);
  const block = materializedTraceGraph.spanMap?.[spanId];
  if (!block) {
    return null;
  }

  return materializedTraceGraph.threadMap?.[block.threadId] ?? null;
}

export function getProcessFromSpan(
  traceGraph: Readonly<JSONTrace>,
  spanId: TraceSpanId
): TraceProcess | null {
  const materializedTraceGraph = materializeJSONTrace(traceGraph);
  const thread = getThreadFromSpan(traceGraph, spanId);
  if (!thread) {
    return null;
  }

  const byRankId = materializedTraceGraph.processes.find(
    process => process.processId === thread.processId
  );
  if (byRankId) {
    return byRankId;
  }

  return (
    materializedTraceGraph.processes.find(process => {
      if (process.threadMap?.[thread.threadId]) {
        return true;
      }

      return process.threads?.some(processThread => processThread.threadId === thread.threadId);
    }) ?? null
  );
}

export function getJSONTraceTimingBounds(
  traceGraph: JSONTrace,
  timingKey?: string | null
): {minTimeMs: number; maxTimeMs: number} {
  const materializedTraceGraph = materializeJSONTrace(traceGraph);
  if (!timingKey) {
    return {
      minTimeMs: materializedTraceGraph.minTimeMs,
      maxTimeMs: materializedTraceGraph.maxTimeMs
    };
  }

  let minTimeMs = Number.MAX_SAFE_INTEGER;
  let maxTimeMs = Number.MIN_SAFE_INTEGER;

  for (const process of materializedTraceGraph.processes) {
    for (const block of process.spans) {
      const timing = block.timings[timingKey] ?? getPrimaryTiming(block);
      minTimeMs = Math.min(minTimeMs, timing.startTimeMs ?? Number.MAX_SAFE_INTEGER);
      minTimeMs = Math.min(minTimeMs, timing.endTimeMs ?? Number.MAX_SAFE_INTEGER);
      maxTimeMs = Math.max(maxTimeMs, timing.startTimeMs ?? Number.MIN_SAFE_INTEGER);
      maxTimeMs = Math.max(maxTimeMs, timing.endTimeMs ?? Number.MIN_SAFE_INTEGER);
    }
    for (const instant of process.instants) {
      minTimeMs = Math.min(minTimeMs, instant.atTimeMs ?? Number.MAX_SAFE_INTEGER);
      maxTimeMs = Math.max(maxTimeMs, instant.atTimeMs ?? Number.MIN_SAFE_INTEGER);
    }
    for (const counter of process.counters) {
      minTimeMs = Math.min(minTimeMs, counter.atTimeMs ?? Number.MAX_SAFE_INTEGER);
      maxTimeMs = Math.max(maxTimeMs, counter.atTimeMs ?? Number.MIN_SAFE_INTEGER);
    }
  }

  if (minTimeMs === Number.MAX_SAFE_INTEGER) {
    minTimeMs = 0;
  }
  if (maxTimeMs === Number.MIN_SAFE_INTEGER) {
    maxTimeMs = 0;
  }

  return {minTimeMs, maxTimeMs};
}

/**
 * Merges multiple `JSONTrace` objects into a single `JSONTrace`.
 */
export function mergeJSONTraces(graphs: Readonly<JSONTrace[]>): JSONTrace {
  const materializedGraphs = graphs.map(graph => materializeJSONTrace(graph));
  const mergedProcesses: TraceProcess[] = [];
  const mergedCrossDependencies: TraceCrossProcessDependency[] = [];
  const mergedEvents: TraceEvent[] = [];
  const mergedEventMap: Record<string, TraceEvent> = {};

  let minTimeMs = Infinity;
  let maxTimeMs = -Infinity;

  materializedGraphs.forEach(graph => {
    // Merge processes
    mergedProcesses.push(...graph.processes);

    // Merge cross-dependencies
    mergedCrossDependencies.push(...graph.crossDependencies);

    Object.entries(graph.eventMap ?? {}).forEach(([eventId, event]) => {
      if (!mergedEventMap[eventId]) {
        mergedEventMap[eventId] = event;
        mergedEvents.push(event);
      }
    });

    // Update min and max time
    if (graph.minTimeMs < minTimeMs) minTimeMs = graph.minTimeMs;
    if (graph.maxTimeMs > maxTimeMs) maxTimeMs = graph.maxTimeMs;
  });

  // Ensure minTimeMs and maxTimeMs are valid
  if (minTimeMs === Infinity) minTimeMs = 0;
  if (maxTimeMs === -Infinity) maxTimeMs = 0;

  const mergedName =
    graphs.length === 0
      ? 'Trace Graph'
      : graphs.length === 1
        ? graphs[0]!.name
        : graphs.map(graph => graph.name).join(', ');

  return {
    type: 'trace-graph',
    name: mergedName,
    spanLayout: materializedGraphs.every(graph => graph.spanLayout === 'manual')
      ? 'manual'
      : 'auto',
    processes: mergedProcesses.map(serializeJSONTraceProcess),
    crossDependencies: mergedCrossDependencies.map(serializeCrossProcessDependency),
    events: mergedEvents,
    timeExtents: {minTimeMs, maxTimeMs}
  };
}

/** Normalizes optional public layout mode metadata for runtime consumers. */
function normalizeTraceSpanLayoutMode(spanLayout?: TraceSpanLayoutMode): TraceSpanLayoutMode {
  return spanLayout === 'manual' ? 'manual' : 'auto';
}

/**
 * Computes canonical graph-wide time extents from span timings, instants, and counters.
 *
 * Unfinished spans are extended only to the latest finite timestamp observed anywhere in the
 * graph instead of an artificial infinite horizon.
 */
function computeTraceGraphTimeExtents(
  processes: Readonly<TraceProcess[]>,
  events: Readonly<ArrowTraceEventTable>
): TraceGraphTimeExtents {
  // Avoid spreading trace-sized timing arrays into Math.max; browsers cap function arguments.
  let minTimeMs = Number.MAX_SAFE_INTEGER;
  let finiteMaxTimeMs = Number.MIN_SAFE_INTEGER;

  for (const process of processes) {
    for (const block of process.spans) {
      const timing = getSpanFiniteTimingEnvelopeForTimeExtents(block);
      if (!timing) {
        continue;
      }
      minTimeMs = Math.min(minTimeMs, timing.startTimeMs);
      finiteMaxTimeMs = Math.max(finiteMaxTimeMs, timing.endTimeMs);
    }
    for (const instant of process.instants) {
      minTimeMs = Math.min(minTimeMs, instant.atTimeMs ?? Number.MAX_SAFE_INTEGER);
      finiteMaxTimeMs = Math.max(finiteMaxTimeMs, instant.atTimeMs ?? Number.MIN_SAFE_INTEGER);
    }
    for (const counter of process.counters) {
      minTimeMs = Math.min(minTimeMs, counter.atTimeMs ?? Number.MAX_SAFE_INTEGER);
      finiteMaxTimeMs = Math.max(finiteMaxTimeMs, counter.atTimeMs ?? Number.MIN_SAFE_INTEGER);
    }
  }
  const eventTimeColumn = events.getChild('atTimeMs');
  for (let rowIndex = 0; rowIndex < events.numRows; rowIndex += 1) {
    const atTimeMs = Number(eventTimeColumn?.get(rowIndex) ?? Number.NaN);
    if (!Number.isFinite(atTimeMs)) {
      continue;
    }
    minTimeMs = Math.min(minTimeMs, atTimeMs);
    finiteMaxTimeMs = Math.max(finiteMaxTimeMs, atTimeMs);
  }

  if (minTimeMs === Number.MAX_SAFE_INTEGER) {
    minTimeMs = 0;
  }
  if (finiteMaxTimeMs === Number.MIN_SAFE_INTEGER) {
    finiteMaxTimeMs = 0;
  }

  let maxTimeMs = finiteMaxTimeMs;
  for (const process of processes) {
    for (const block of process.spans) {
      const timing = getSpanExtremalTimingForTimeExtents(block, finiteMaxTimeMs);
      if (!timing) {
        continue;
      }
      minTimeMs = Math.min(minTimeMs, timing.startTimeMs);
      maxTimeMs = Math.max(maxTimeMs, timing.endTimeMs);
    }
  }

  return {minTimeMs, maxTimeMs};
}

/**
 * Validates caller-provided trace extents and normalizes their ordering.
 */
function normalizeTraceGraphTimeExtents(
  timeExtents?: TraceGraphTimeExtents
): TraceGraphTimeExtents | null {
  if (!timeExtents) {
    return null;
  }

  if (!Number.isFinite(timeExtents.minTimeMs) || !Number.isFinite(timeExtents.maxTimeMs)) {
    return null;
  }

  return {
    minTimeMs: Math.min(timeExtents.minTimeMs, timeExtents.maxTimeMs),
    maxTimeMs: Math.max(timeExtents.minTimeMs, timeExtents.maxTimeMs)
  };
}

/**
 * Ensures legacy process-level indexes exist after a public JSON trace is loaded.
 */
function materializeTraceProcess(process: JSONTraceProcess): TraceProcess {
  const processThreads = process.threads ?? [];
  const processSpans = process.spans ?? [];
  const processInstants = process.instants ?? [];
  const processCounters = process.counters ?? [];
  const processLocalDependencies = process.localDependencies ?? [];
  const processRemoteDependencies = process.remoteDependencies ?? [];
  const localDependencies = processLocalDependencies.map(materializeLocalDependency);
  const dependencyMap = Object.fromEntries(
    localDependencies.map(dependency => [dependency.dependencyId, dependency])
  ) as Record<TraceDependencyId, TraceLocalDependency>;
  const spans = processSpans.map(span => ({
    ...span,
    localDependencies: (span.localDependencyIds ?? []).flatMap(dependencyId => {
      const dependency = dependencyMap[dependencyId];
      return dependency ? [dependency] : [];
    })
  }));
  const threadMap = Object.fromEntries(processThreads.map(thread => [thread.threadId, thread]));
  const spanMap = Object.fromEntries(spans.map(span => [span.spanId, span]));
  const instantMap = Object.fromEntries(
    processInstants.map(instant => [instant.instantId, instant])
  );
  const counterMap = Object.fromEntries(
    processCounters.map(counter => [counter.counterId, counter])
  );
  const threadInstantMap = buildTraceItemsByThread(processInstants, 'threadId');
  const threadCounterMap = buildTraceItemsByThread(processCounters, 'threadId');

  return {
    ...process,
    threads: [...processThreads],
    spans,
    instants: [...processInstants],
    counters: [...processCounters],
    localDependencies,
    remoteDependencies: [...processRemoteDependencies],
    threadMap,
    spanMap,
    instantMap,
    counterMap,
    threadInstantMap,
    threadCounterMap
  };
}

/**
 * Detects the internal indexed companion without requiring callers to track normalization state.
 */
function isMaterializedJSONTrace(
  traceGraph: Readonly<JSONTrace> | Readonly<MaterializedJSONTrace>
): traceGraph is Readonly<MaterializedJSONTrace> {
  return (
    'minTimeMs' in traceGraph &&
    'maxTimeMs' in traceGraph &&
    'spanMap' in traceGraph &&
    'eventMap' in traceGraph &&
    'stats' in traceGraph
  );
}

/**
 * Serializes one runtime process into the public JSON-safe process shape.
 */
function serializeJSONTraceProcess(process: TraceProcess): JSONTraceProcess {
  return {
    type: process.type,
    processId: process.processId,
    name: process.name,
    tags: process.tags,
    rankNum: process.rankNum,
    processOrder: process.processOrder,
    stepNum: process.stepNum,
    threads: process.threads,
    spans: process.spans.map(({localDependencies: _localDependencies, ...span}) => span),
    instants: process.instants,
    counters: process.counters,
    localDependencies: process.localDependencies.map(serializeLocalDependency),
    remoteDependencies: process.remoteDependencies,
    userData: process.userData
  };
}

/**
 * Serializes one local dependency into the public JSON-safe dependency shape.
 */
function serializeLocalDependency(dependency: TraceLocalDependency): JSONTraceLocalDependency {
  return {
    ...dependency,
    keywords: [...dependency.keywords]
  };
}

/**
 * Serializes one cross-process dependency into the public JSON-safe dependency shape.
 */
function serializeCrossProcessDependency(
  dependency: TraceCrossProcessDependency
): JSONTraceCrossProcessDependency {
  return {
    ...dependency,
    keywords: [...dependency.keywords]
  };
}

/**
 * Restores one local dependency from the public JSON-safe dependency shape.
 */
function materializeLocalDependency(dependency: JSONTraceLocalDependency): TraceLocalDependency {
  return {
    ...dependency,
    keywords: new Set(dependency.keywords)
  };
}

/**
 * Restores one cross-process dependency from the public JSON-safe dependency shape.
 */
function materializeCrossProcessDependency(
  dependency: JSONTraceCrossProcessDependency
): TraceCrossProcessDependency {
  return {
    ...dependency,
    keywords: new Set(dependency.keywords)
  };
}

/**
 * Groups thread-owned trace items by thread id.
 */
function buildTraceItemsByThread<ItemT extends {threadId: TraceThreadId}>(
  items: ReadonlyArray<ItemT>,
  key: 'threadId'
): Record<TraceThreadId, ItemT[]> {
  return items.reduce(
    (acc, item) => {
      const threadId = item[key];
      const list = acc[threadId] ?? [];
      list.push(item);
      acc[threadId] = list;
      return acc;
    },
    {} as Record<TraceThreadId, ItemT[]>
  );
}

function buildTraceGraphStats(
  processes: Readonly<TraceProcess[]>,
  crossDependencies: Readonly<TraceCrossProcessDependency[]>,
  overrides?: TraceGraphStatsOverrides
): TraceGraphStats {
  const processCount = processes.length;
  const threadCount = processes.reduce((total, process) => total + process.threads.length, 0);
  const laneCount = processes.reduce((total, process) => {
    return (
      total +
      process.threads.reduce((threadTotal, thread) => {
        const laneValue = (thread.userData as {laneCount?: number} | undefined)?.laneCount;
        if (typeof laneValue === 'number' && Number.isFinite(laneValue) && laneValue > 0) {
          return threadTotal + Math.floor(laneValue);
        }
        return threadTotal + 1;
      }, 0)
    );
  }, 0);
  const spanCount = processes.reduce((total, process) => total + process.spans.length, 0);

  let notStartedSpanCount = 0;
  let unfinishedSpanCount = 0;
  processes.forEach(process => {
    process.spans.forEach(block => {
      const timing = getPrimaryTiming(block);
      if (timing.status === 'not-started') {
        notStartedSpanCount += 1;
      } else if (timing.status === 'not-finished') {
        unfinishedSpanCount += 1;
      }
    });
  });

  const localDependencyCount = processes.reduce(
    (total, process) => total + (process.localDependencies?.length ?? 0),
    0
  );
  const crossDependencyCount = crossDependencies.length;
  const dependencyCount = localDependencyCount + crossDependencyCount;

  return {
    processCount,
    threadCount,
    laneCount,
    spanCount,
    localDependencyCount,
    notStartedSpanCount,
    unfinishedSpanCount,
    droppedSpanCount: Math.max(0, overrides?.droppedSpanCount ?? 0),
    dependencyCount,
    droppedDependencyCount: Math.max(0, overrides?.droppedDependencyCount ?? 0),
    crossDependencyCount,
    droppedCrossDependencyCount: Math.max(0, overrides?.droppedCrossDependencyCount ?? 0)
  };
}
