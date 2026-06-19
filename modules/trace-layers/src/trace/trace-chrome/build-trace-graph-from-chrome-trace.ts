import {
  encodeSpanRef,
  encodeVisibleCrossDependencyRef,
  encodeVisibleLocalDependencyRef
} from '../trace-graph/trace-id-encoder';
import {brand, getPrimaryTiming} from '../trace-graph/trace-types';
import {COLORS_LIST} from '../trace-style/color-palette';

import type {
  ChromeTrace,
  ChromeTraceCounter,
  ChromeTraceFlow,
  ChromeTraceInstant,
  ChromeTraceProcess,
  ChromeTraceSpan,
  ChromeTraceThread
} from '../loaders/chrome-trace-loader/chrome-trace-types';
import type {
  TraceCounter,
  TraceCounterId,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceInstant,
  TraceInstantId,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceSpanTiming,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {TraceDeckColor} from '../trace-style/trace-color-scheme';
import type {Log} from '@probe.gl/log';

const TRACE_TIMING_LOG_LEVEL = 1;

// trace-graph-from-chrome.ts

// ---- imports: adjust paths as needed ----

// <- put your JSONTrace types in this file or adjust import

// ---------- Options ----------
export type ChromeTraceProcessColorSeed = {
  match: RegExp | string;
  color: TraceDeckColor;
};

export type ChromeTraceProcessColorOptions = {
  /** Palette to use when assigning colors to processes. Defaults to `COLORS_LIST`. */
  palette?: Readonly<TraceDeckColor[]>;
  /** Specific assignments keyed by regex/name to keep important processes stable. */
  seeds?: ChromeTraceProcessColorSeed[];
};

export type BuildChromeTraceRanksOptions = {
  /** How to compute wait time between two spans linked by a flow */
  waitMode?: 'end-to-start' | 'end-to-end' | 'start-to-start';
  /** If true, include the original ChromeTrace(s) on the JSONTrace */
  includeRawTraces?: boolean;
  /** Optional process color configuration */
  processColors?: ChromeTraceProcessColorOptions;
  /** Optional log for performance logging */
  log?: Log;
};

// ---------- Public API ----------
/** Builds trace ranks and dependencies from one or more Chrome trace inputs. */
export function buildTraceRanksFromChromeTrace(
  tracesInput: ChromeTrace | ChromeTrace[],
  opts: BuildChromeTraceRanksOptions = {}
): {
  ranks: Readonly<TraceProcess[]>;
  crossDependencies: Readonly<TraceCrossProcessDependency[]>;
  traces?: Readonly<ChromeTrace[]>;
} {
  const startTime = performance.now();
  let processCount = 0;
  let threadCount = 0;
  let spanCount = 0;
  let instantCount = 0;
  let counterCount = 0;
  let flowCount = 0;

  const traces = Array.isArray(tracesInput) ? tracesInput : [tracesInput];
  const waitMode = opts.waitMode ?? 'end-to-start';

  // 1) Build ranks (per process) and streams (per thread). Also build spans (per span).
  const ranks: TraceProcess[] = [];
  const rankByPid = new Map<string, TraceProcess>();
  const streamByTrack = new Map<string, TraceThread>();
  const spansByTrack = new Map<string, TraceSpan[]>();
  const blockLookupByTrack = new Map<
    string,
    {
      spans: TraceSpan[];
      startTimes: number[];
      endTimes: number[];
      maxEndTimes: number[];
    }
  >();
  const blockById = new Map<string, TraceSpan>();
  const streamMapGlobal: Record<string, TraceThread> = {}; // convenience global map if you need it

  // Deterministic rank numbers: enumerate processes in ascending pid order across all traces
  const allProcesses = traces.flatMap(t => t.processes);
  processCount = allProcesses.length;
  const uniquePids = Array.from(new Set(allProcesses.map(p => p.id))).sort((a, b) => {
    const na = Number(a),
      nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });

  const processByPid = new Map<string, ChromeTraceProcess>();
  for (const proc of allProcesses) {
    if (!processByPid.has(proc.id)) {
      processByPid.set(proc.id, proc);
    }
  }

  const processColorMap = buildProcessColorMap({
    palette: opts.processColors?.palette,
    pids: uniquePids,
    seeds: opts.processColors?.seeds,
    processByPid
  });

  const pidToRankNum = new Map<string, number>();
  uniquePids.forEach((pid, i) => pidToRankNum.set(pid, i));

  // create or get rank
  /** Ensures a TraceProcess exists for the provided process. */
  const ensureRank = (proc: ChromeTraceProcess) => {
    const rankLabel = proc.label?.trim();
    const rankDisplayName = rankLabel && rankLabel.length > 0 ? rankLabel : String(proc.id);
    const processColor = processColorMap.get(proc.id);

    let rank = rankByPid.get(proc.id);
    if (!rank) {
      rank = {
        type: 'trace-process',
        processId: proc.id, // API rank id (process id)
        name: rankDisplayName,
        rankNum: pidToRankNum.get(proc.id) ?? ranks.length,
        stepNum: 0, // unknown; keep 0 unless you have semantics
        threads: [],
        threadMap: {},
        spans: [],
        spanMap: {},
        instants: [],
        instantMap: {},
        threadInstantMap: {},
        counters: [],
        counterMap: {},
        threadCounterMap: {},
        localDependencies: [],
        remoteDependencies: [],
        userData: {
          color: processColor,
          pid: proc.id,
          label: rankDisplayName,
          category: proc.category
        }
      };
      rankByPid.set(proc.id, rank);
      ranks.push(rank);
    } else {
      rank.name = rankDisplayName;
    }
    return rank;
  };

  // create stream for a thread
  /** Creates a stable stream id for a track id. */
  const makeThreadId = (trackId: string): TraceThreadId =>
    brand<'stream', string>(`stream:${trackId}`);
  /** Ensures a TraceThread exists for the provided thread. */
  const ensureThread = (rank: TraceProcess, chromeThread: ChromeTraceThread) => {
    const trackId = `${chromeThread.pid}:${chromeThread.tid}`;
    let thread = streamByTrack.get(trackId);
    const processColor = processColorMap.get(chromeThread.pid);
    if (!thread) {
      const streamLabelFromArgs = findThreadLabelFromUserData(chromeThread);
      const streamLabel = chromeThread.label?.trim();
      const threadName = streamLabelFromArgs?.trim() || streamLabel;
      const formattedThreadName = formatThreadNameWithId(threadName, chromeThread.tid);
      const streamName =
        formattedThreadName || (streamLabel && streamLabel.length > 0 ? streamLabel : trackId);
      const streamColor = chromeThread.color ?? processColor;
      thread = {
        type: 'trace-thread',
        name: streamName,
        threadId: makeThreadId(trackId),
        processId: rank.processId,
        userData: {
          pid: chromeThread.pid,
          tid: chromeThread.tid,
          category: chromeThread.category,
          color: streamColor,
          rankColor: processColor,
          processColor,
          laneCollapseMode: 'top-only'
        }
      } satisfies TraceThread;
      streamByTrack.set(trackId, thread);
      rank.threads.push(thread);
      rank.threadMap[trackId] = thread;
      streamMapGlobal[trackId] = thread;
    }
    return thread;
  };

  /** Creates a stable block id for a span. */
  const makeSpanId = (trackId: string, s: ChromeTraceSpan): TraceSpanId =>
    brand<'block', string>(`block:${trackId}:${s.name}:${s.startTimeMs}:${s.endTimeMs}`);
  /** Creates a stable instant id for a chrome instant block. */
  const makeInstantId = (trackId: string, instant: ChromeTraceInstant): TraceInstantId =>
    brand<'instant', string>(`instant:${trackId}:${instant.id}:${instant.atMs}`);
  /** Creates a stable counter id for a chrome counter block. */
  const makeCounterId = (trackId: string, counter: ChromeTraceCounter): TraceCounterId =>
    brand<'counter', string>(`counter:${trackId}:${counter.id}:${counter.atMs}`);

  /** Formats milliseconds as a short string with two decimal places. */
  const formatMs = (ms: number) => `${round2(ms)} ms`;
  /** Rounds a number to two decimal places. */
  const round2 = (v: number) => Math.round(v * 100) / 100;

  // Build ranks/streams/spans
  for (const t of traces) {
    for (const chromeProcess of t.processes) {
      const rank = ensureRank(chromeProcess);
      for (const chromeThread of chromeProcess.threads) {
        threadCount += 1;
        spanCount += chromeThread.spans.length;
        instantCount += chromeThread.instants.length;
        counterCount += chromeThread.counters.length;
        flowCount += chromeThread.flows.length;
        const thread = ensureThread(rank, chromeThread);
        const trackId = `${chromeThread.pid}:${chromeThread.tid}`;
        const processName = rank.name?.trim() ? rank.name : rank.processId;

        const processColor = processColorMap.get(chromeProcess.id);

        for (const span of chromeThread.spans) {
          const start = span.startTimeMs;
          const end = span.endTimeMs ?? span.startTimeMs; // tolerate missing end (shouldn't happen w/ your parser)
          const duration = Math.max(0, end - start);
          const streamColor = thread.userData?.color as TraceDeckColor | undefined;
          const blockColor = (span.color ?? streamColor ?? processColor) as
            | TraceDeckColor
            | undefined;

          const spanId = makeSpanId(trackId, span);
          const timing: TraceSpanTiming = {
            status: (span.endTimeMs ?? null) === null ? 'not-finished' : 'finished',
            startTimeMs: start,
            endTimeMs: end,
            durationMs: duration,
            durationMsAsString: formatMs(duration)
          };
          const block: TraceSpan = {
            type: 'trace-span',
            spanRef: encodeSpanRef(rank.rankNum, rank.spans.length),
            spanId,
            threadId: thread.threadId,
            processName,
            name: span.name,
            keywords: undefined,
            primaryTimingKey: 'trace',
            timings: {
              trace: timing
            },
            localDependencyIds: [],
            localDependencies: [],
            crossProcessEndpointId: null,
            crossProcessDependencyEndpoints: [],
            userData: {
              ...(span.userData ?? {}),
              color: blockColor,
              streamColor: streamColor ?? processColor,
              rankColor: processColor,
              trackId: span.trackId,
              spanId: span.spanId,
              pid: chromeThread.pid,
              tid: chromeThread.tid,
              category: chromeThread.category
            }
          };

          // register block
          rank.spans.push(block);
          rank.spanMap[String(block.spanId)] = block;
          blockById.set(String(block.spanId), block);
          const list = spansByTrack.get(trackId) ?? [];
          list.push(block);
          spansByTrack.set(trackId, list);
        }

        if (chromeThread.instants?.length) {
          const instantsForThread = rank.threadInstantMap[String(thread.threadId)] ?? [];
          for (const instantEvent of chromeThread.instants) {
            const instantId = makeInstantId(trackId, instantEvent);
            const processColor = processColorMap.get(chromeProcess.id);
            const threadColor = thread.userData?.color as TraceDeckColor | undefined;
            const instantColor = (instantEvent.color ?? threadColor ?? processColor) as
              | TraceDeckColor
              | undefined;
            const instant: TraceInstant = {
              type: 'trace-instant',
              instantId,
              threadId: thread.threadId,
              name: instantEvent.name,
              atTimeMs: instantEvent.atMs,
              scope: instantEvent.scope,
              userData: {
                color: instantColor,
                pid: chromeThread.pid,
                tid: chromeThread.tid,
                category: chromeThread.category,
                trackId: instantEvent.trackId,
                instantId: instantEvent.id,
                scope: instantEvent.scope,
                instantUserData: instantEvent.userData,
                streamColor: threadColor ?? processColor,
                rankColor: processColor
              }
            };

            rank.instants.push(instant);
            rank.instantMap[String(instant.instantId)] = instant;
            instantsForThread.push(instant);
          }
          rank.threadInstantMap[String(thread.threadId)] = instantsForThread;
        }

        if (chromeThread.counters?.length) {
          const countersForThread = rank.threadCounterMap[String(thread.threadId)] ?? [];
          for (const counterEvent of chromeThread.counters) {
            const counterId = makeCounterId(trackId, counterEvent);
            const seriesEntries = Object.entries(counterEvent.series ?? {});
            const totalValue = seriesEntries.reduce((sum, [, value]) => {
              return Number.isFinite(value) ? sum + value : sum;
            }, 0);
            const processColor = processColorMap.get(chromeProcess.id);
            const threadColor = thread.userData?.color as TraceDeckColor | undefined;
            const counterColor = (counterEvent.color ?? threadColor ?? processColor) as
              | TraceDeckColor
              | undefined;
            const counter: TraceCounter = {
              type: 'trace-counter',
              counterId,
              threadId: thread.threadId,
              name: counterEvent.name,
              atTimeMs: counterEvent.atMs,
              totalValue,
              series: counterEvent.series ?? {},
              userData: {
                color: counterColor,
                pid: chromeThread.pid,
                tid: chromeThread.tid,
                category: chromeThread.category,
                trackId: counterEvent.trackId,
                counterId: counterEvent.id,
                counterUserData: counterEvent.userData,
                streamColor: threadColor ?? processColor,
                rankColor: processColor
              }
            };

            rank.counters.push(counter);
            rank.counterMap[String(counter.counterId)] = counter;
            countersForThread.push(counter);
          }
          rank.threadCounterMap[String(thread.threadId)] = countersForThread;
        }
      }
    }
  }

  // Sort spans per track by start time (for interval lookup)
  for (const [, list] of spansByTrack) {
    list.sort((a, b) => {
      const aTiming = getPrimaryTiming(a);
      const bTiming = getPrimaryTiming(b);
      return aTiming.startTimeMs - bTiming.startTimeMs || aTiming.endTimeMs - bTiming.endTimeMs;
    });
  }

  for (const [trackId, list] of spansByTrack) {
    if (list.length === 0) {
      blockLookupByTrack.set(trackId, {
        spans: list,
        startTimes: [],
        endTimes: [],
        maxEndTimes: []
      });
      continue;
    }

    const startTimes = new Array<number>(list.length);
    const endTimes = new Array<number>(list.length);
    const maxEndTimes = new Array<number>(list.length);
    let runningMaxEnd = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < list.length; index += 1) {
      const block = list[index];
      const timing = getPrimaryTiming(block);
      startTimes[index] = timing.startTimeMs;
      endTimes[index] = timing.endTimeMs;
      runningMaxEnd = Math.max(runningMaxEnd, timing.endTimeMs);
      maxEndTimes[index] = runningMaxEnd;
    }

    blockLookupByTrack.set(trackId, {
      spans: list,
      startTimes,
      endTimes,
      maxEndTimes
    });
  }

  // 2) Build dependencies from flow chains
  // Gather all flows across all threads
  type FlowEvent = ChromeTraceFlow & {__trackId: string; __pid: string; __tid: string};
  const flowsByKey = new Map<string, FlowEvent[]>();

  for (const t of traces) {
    for (const proc of t.processes) {
      for (const thread of proc.threads) {
        const trackId = `${thread.pid}:${thread.tid}`;
        for (const f of thread.flows) {
          const key = flowKey(f);
          const entry: FlowEvent = Object.assign({}, f, {
            __trackId: f.trackId ?? trackId,
            __pid: String(thread.pid),
            __tid: String(thread.tid)
          });
          (flowsByKey.get(key) ?? flowsByKey.set(key, []).get(key)!).push(entry);
        }
      }
    }
  }

  // Build local and cross-rank dependencies by linking consecutive flow spans
  const crossDependencies: TraceCrossProcessDependency[] = [];

  for (const [key, list] of flowsByKey) {
    list.sort((a, b) => a.atMs - b.atMs);

    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i];
      const b = list[i + 1];

      const startBlock = findBlockAtTime(blockLookupByTrack.get(a.__trackId), a.atMs);
      const endBlock = findBlockAtTime(blockLookupByTrack.get(b.__trackId), b.atMs);

      const startRank = startBlock ? rankByPid.get(String(startBlock.userData?.pid)) : undefined;
      const endRank = endBlock ? rankByPid.get(String(endBlock.userData?.pid)) : undefined;

      // If both spans not found, skip this edge (no visible anchor)
      if (!startBlock && !endBlock) continue;

      // If exactly one side is found, attach an endpoint to that block
      if (startBlock && !endBlock) {
        startBlock.crossProcessDependencyEndpoints.push(
          makeEndpointFromSingleSide('start', key, startBlock, b.atMs, waitMode)
        );
        continue;
      }
      if (!startBlock && endBlock) {
        endBlock.crossProcessDependencyEndpoints.push(
          makeEndpointFromSingleSide('end', key, endBlock, a.atMs, waitMode)
        );
        continue;
      }

      // Both sides exist
      const sameRank = startRank?.processId === endRank?.processId;
      const depId: TraceDependencyId = brand<'dependency', string>(
        `dep:${key}:${a.atMs}->${b.atMs}`
      );

      const waitTimeMs = computeWaitTime(waitMode, startBlock!, endBlock!);

      if (sameRank && startRank) {
        // Local dependency
        const localDep: TraceLocalDependency = {
          type: 'trace-local-dependency',
          dependencyRef: encodeVisibleLocalDependencyRef(startRank.localDependencies.length),
          startSpanRef: startBlock!.spanRef,
          endSpanRef: endBlock!.spanRef,
          dependencyId: depId,
          startSpanId: startBlock!.spanId,
          endSpanId: endBlock!.spanId,
          keywords: new Set(),
          waitMode,
          bidirectional: false,
          waitTimeMs,
          userData: {flowKey: key}
        };
        startRank.localDependencies.push(localDep);
        // Attach to spans
        startBlock!.localDependencyIds.push(localDep.dependencyId);
        startBlock!.localDependencies.push(localDep);
      } else if (startRank && endRank) {
        // Cross-rank dependency
        const endpointId: TraceCrossProcessEndpointId = brand<'endpoint', string>(
          `endpoint:${key}:${a.atMs}->${b.atMs}`
        );
        const crossDep: TraceCrossProcessDependency = {
          type: 'trace-cross-process-dependency',
          dependencyRef: encodeVisibleCrossDependencyRef(crossDependencies.length),
          startSpanRef: startBlock!.spanRef,
          endSpanRef: endBlock!.spanRef,
          dependencyId: depId,
          endpointId,
          startRankNum: startRank.rankNum,
          endRankNum: endRank.rankNum,
          startSpanId: startBlock!.spanId,
          endSpanId: endBlock!.spanId,
          waitMode,
          bidirectional: false,
          topology: 'flow',
          waitTimeMs,
          waiting: false,
          waitNotFinished: false,
          keywords: new Set(),
          userData: {flowKey: key}
        };
        crossDependencies.push(crossDep);
      }
    }
  }

  // Normalize timestamps to the start of the trace to avoid extremely large time origins making the
  // visualization span effectively invisible.
  let globalMinTimeMs = Number.POSITIVE_INFINITY;
  for (const rank of ranks) {
    for (const block of rank.spans) {
      const timing = getPrimaryTiming(block);
      globalMinTimeMs = Math.min(
        globalMinTimeMs,
        timing.startTimeMs ?? Number.POSITIVE_INFINITY,
        timing.endTimeMs ?? Number.POSITIVE_INFINITY
      );
    }
    for (const instant of rank.instants) {
      globalMinTimeMs = Math.min(globalMinTimeMs, instant.atTimeMs ?? Number.POSITIVE_INFINITY);
    }
    for (const counter of rank.counters) {
      globalMinTimeMs = Math.min(globalMinTimeMs, counter.atTimeMs ?? Number.POSITIVE_INFINITY);
    }
  }

  if (!Number.isFinite(globalMinTimeMs)) {
    globalMinTimeMs = 0;
  }

  if (globalMinTimeMs !== 0) {
    for (const rank of ranks) {
      for (const block of rank.spans) {
        const timing = getPrimaryTiming(block);
        const startTimeMs = timing.startTimeMs - globalMinTimeMs;
        const endTimeMs = timing.endTimeMs - globalMinTimeMs;
        const durationMs = Math.max(0, endTimeMs - startTimeMs);
        block.timings[block.primaryTimingKey] = {
          ...timing,
          startTimeMs,
          endTimeMs,
          durationMs,
          durationMsAsString: formatMs(durationMs)
        };
      }
      for (const instant of rank.instants) {
        instant.atTimeMs -= globalMinTimeMs;
      }
      for (const counter of rank.counters) {
        counter.atTimeMs -= globalMinTimeMs;
      }
    }
  }

  const rankCount = ranks.length;
  const streamCount = ranks.reduce((count, rank) => count + rank.threads.length, 0);
  const blockCount = ranks.reduce((count, rank) => count + rank.spans.length, 0);
  opts.log?.probe(TRACE_TIMING_LOG_LEVEL, 'buildTraceRanksFromChromeTrace timing', {
    durationMs: performance.now() - startTime,
    traceCount: traces.length,
    processCount,
    threadCount,
    spanCount,
    instantCount,
    counterCount,
    flowCount,
    rankCount,
    streamCount,
    blockCount
  })();

  // 3) finalize/return
  // (Optional) you could deduplicate localDependencies or endpoints if flows overlapped
  return {
    traces: opts.includeRawTraces ? Object.freeze(traces) : undefined,
    ranks: Object.freeze(ranks),
    crossDependencies: Object.freeze(crossDependencies)
  };
}

// ---------- helpers ----------

type NormalizedProcessColorSeed = {
  matcher: RegExp;
  color: TraceDeckColor;
};

/** Extracts a thread name from user data when present. */
function getThreadNameFromUserData(
  userData: Record<string, unknown> | undefined
): string | undefined {
  if (!userData) {
    return undefined;
  }

  const threadName = userData.thread_name;
  if (typeof threadName === 'string' && threadName.trim().length > 0) {
    return threadName.trim();
  }

  const direct = userData['thread.name'];
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }

  const thread = userData.thread as {name?: unknown} | undefined;
  if (thread && typeof thread.name === 'string' && thread.name.trim().length > 0) {
    return thread.name.trim();
  }

  return undefined;
}

/** Formats a thread name with its id when helpful. */
function formatThreadNameWithId(name: string | undefined, tid: string): string | undefined {
  if (!name || name.trim().length === 0) {
    return undefined;
  }

  const trimmedName = name.trim();
  if (trimmedName === `Thread ${tid}`) {
    return trimmedName;
  }

  if (/^[0-9]+$/.test(tid)) {
    return `${trimmedName} (${tid})`;
  }

  return trimmedName;
}

/** Searches a thread for a label stored in block user data. */
function findThreadLabelFromUserData(thread: ChromeTraceThread): string | undefined {
  const sources = [
    ...thread.spans.map(span => span.userData),
    ...thread.instants.map(instant => instant.userData),
    ...thread.counters.map(counter => counter.userData),
    ...thread.flows.map(flow => flow.userData)
  ];

  for (const userData of sources) {
    const label = getThreadNameFromUserData(userData);
    if (label) {
      return label;
    }
  }

  return undefined;
}

/** Normalizes process color seeds into regex matchers. */
function normalizeProcessColorSeeds(
  seeds: ChromeTraceProcessColorSeed[] | undefined
): NormalizedProcessColorSeed[] {
  return (seeds ?? []).map(seed => ({
    matcher:
      typeof seed.match === 'string'
        ? new RegExp(seed.match, 'i')
        : new RegExp(seed.match.source, seed.match.flags),
    color: seed.color
  }));
}

/** Checks whether a process or its threads match a seed matcher. */
function matchesSeed(matcher: RegExp, proc: ChromeTraceProcess): boolean {
  const candidates = new Set<string>([proc.label ?? '', String(proc.id)]);
  proc.threads?.forEach(thread => {
    candidates.add(thread.label ?? '');
    candidates.add(`${thread.pid}:${thread.tid}`);
  });

  for (const candidate of candidates) {
    if (!candidate) continue;
    matcher.lastIndex = 0;
    if (matcher.test(candidate)) return true;
  }

  return false;
}

/** Finds the first seeded color matching a process. */
function findSeedColor(
  proc: ChromeTraceProcess | undefined,
  seeds: NormalizedProcessColorSeed[]
): TraceDeckColor | undefined {
  if (!proc) return undefined;
  for (const seed of seeds) {
    if (matchesSeed(seed.matcher, proc)) {
      return seed.color;
    }
  }
  return undefined;
}

/** Builds a map of process ids to colors using optional seeds and palette. */
function buildProcessColorMap(params: {
  palette?: Readonly<TraceDeckColor[]>;
  pids: string[];
  seeds?: ChromeTraceProcessColorSeed[];
  processByPid: Map<string, ChromeTraceProcess>;
}): Map<string, TraceDeckColor> {
  const colorMap = new Map<string, TraceDeckColor>();
  const normalizedSeeds = normalizeProcessColorSeeds(params.seeds);
  const palette = params.palette && params.palette.length > 0 ? params.palette : COLORS_LIST;

  let paletteIndex = 0;
  for (const pid of params.pids) {
    const seededColor = findSeedColor(params.processByPid.get(pid), normalizedSeeds);
    if (seededColor) {
      colorMap.set(pid, seededColor);
      continue;
    }

    const color = palette[paletteIndex % palette.length];
    paletteIndex += 1;
    colorMap.set(pid, color);
  }

  return colorMap;
}

/** Selects a stable flow key for stitching s/t/f steps. */
function flowKey(f: ChromeTraceFlow): string {
  // Prefer bindId when present; fall back to id, then blockKey
  return String(f.bindId ?? f.id ?? f.eventKey ?? '');
}

/** Computes wait time between two spans based on the wait mode. */
function computeWaitTime(
  mode: 'end-to-start' | 'end-to-end' | 'start-to-start',
  a: TraceSpan,
  b: TraceSpan
): number {
  const aTiming = getPrimaryTiming(a);
  const bTiming = getPrimaryTiming(b);
  switch (mode) {
    case 'end-to-start':
      return Math.max(0, bTiming.startTimeMs - aTiming.endTimeMs);
    case 'end-to-end':
      return Math.max(0, bTiming.endTimeMs - aTiming.endTimeMs);
    case 'start-to-start':
      return Math.max(0, bTiming.startTimeMs - aTiming.startTimeMs);
  }
}

/** Creates a cross-rank dependency endpoint when only one side is known. */
function makeEndpointFromSingleSide(
  side: 'start' | 'end',
  key: string,
  block: TraceSpan,
  otherAtMs: number,
  waitMode: 'end-to-start' | 'end-to-end' | 'start-to-start'
): TraceCrossProcessEndpoint {
  const endpointId: TraceCrossProcessEndpointId = brand<'endpoint', string>(
    `endpoint:${key}:${String(block.spanId)}:${side}`
  );
  const timing = getPrimaryTiming(block);

  // Compute a best-effort wait depending on which side we know
  const waitTimeMs = (() => {
    switch (waitMode) {
      case 'end-to-start':
        return side === 'start'
          ? Math.max(0, otherAtMs - timing.endTimeMs)
          : Math.max(0, timing.startTimeMs - otherAtMs);
      case 'end-to-end':
        return side === 'start'
          ? Math.max(0, otherAtMs - timing.endTimeMs)
          : Math.max(0, timing.endTimeMs - otherAtMs);
      case 'start-to-start':
        return side === 'start'
          ? Math.max(0, otherAtMs - timing.startTimeMs)
          : Math.max(0, timing.startTimeMs - otherAtMs);
    }
  })();

  // Pull rank numbers from block.userData (pid stored there in this builder)
  const pid = String(block.userData?.pid ?? '');
  const tid = String(block.userData?.tid ?? '');
  // We don’t have rankNum here; UI can back-fill later if needed

  return {
    type: 'cross-process-dependency-endpoint',
    endpointId,
    spanId: block.spanId,
    startRankNum: Number(pid) || 0, // placeholder; override if you have an explicit mapping
    endRankNum: Number(pid) || 0, // placeholder (endRankNum is unknown at this stage)
    islandNum: 0,
    waitTimeMs,
    waiting: true,
    waitNotFinished: true,
    userData: {flowKey: key, side, pid, tid, otherAtMs}
  };
}

/** Finds a block that covers a given time on a track (start <= t <= end). */
export function findBlockAtTime(
  lookup:
    | {
        spans: TraceSpan[];
        startTimes: number[];
        endTimes: number[];
        maxEndTimes: number[];
      }
    | undefined,
  t: number
): TraceSpan | undefined {
  if (!lookup || lookup.spans.length === 0) {
    return undefined;
  }

  const {spans, startTimes, endTimes, maxEndTimes} = lookup;
  const lastStartIndex = upperBound(startTimes, t) - 1;
  if (lastStartIndex < 0) {
    return undefined;
  }

  if (maxEndTimes[lastStartIndex] < t) {
    return undefined;
  }

  const earliestCoveringIndex = lowerBound(maxEndTimes, t, 0, lastStartIndex);
  for (let index = earliestCoveringIndex; index <= lastStartIndex; index += 1) {
    if (endTimes[index] >= t) {
      return spans[index];
    }
  }

  return undefined;
}

/** Returns the first index greater than target in a sorted array. */
export function upperBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (values[mid] <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/** Returns the first index within [low, high] whose value is >= target. */
export function lowerBound(values: number[], target: number, low: number, high: number): number {
  let left = low;
  let right = high + 1;
  while (left < right) {
    const mid = left + Math.floor((right - left) / 2);
    if (values[mid] < target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  return left;
}
