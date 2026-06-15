import {validateChromeTraceFile} from './chrome-trace-schema';

import type {ChromeTraceValidationOptions} from './chrome-trace-schema';
import type {
  ChromeTrace,
  ChromeTraceCounter,
  ChromeTraceFlow,
  ChromeTraceInstant,
  ChromeTraceProcess,
  ChromeTraceSpan,
  ChromeTraceThread
} from './chrome-trace-types';
import type {Log} from '@probe.gl/log';

/** ---------- Palette wiring (customize as you like) ---------- */

// Simple category palette (RGBA)
const CATEGORY_PALETTE: Record<string, [number, number, number, number]> = {
  blink: [66, 133, 244, 255], // blue
  net: [219, 68, 55, 255], // red
  v8: [244, 180, 0, 255], // yellow
  gpu: [15, 157, 88, 255], // green
  input: [171, 71, 188, 255], // purple
  scheduler: [0, 121, 107, 255] // teal
};

// Deterministic fallback color for unknown categories
function hashColorRGBA(s: string): [number, number, number, number] {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const r = h & 0xff;
  const g = (h >>> 8) & 0xff;
  const b = (h >>> 16) & 0xff;
  return [r, g, b, 255];
}

function colorForCat(cat?: string): [number, number, number, number] | undefined {
  if (!cat) return undefined;
  return CATEGORY_PALETTE[cat] ?? hashColorRGBA(cat);
}

/** ---------- Parser Implementation ---------- */

type StackEntry = {
  spanId: string;
  trackId: string;
  name: string;
  startTimeMs: number;
  color?: [number, number, number, number];
  userData?: Record<string, unknown>;
};

const DEFAULT_TIME_UNIT_TO_MS = 1 / 1000; // microseconds → milliseconds
const TRACE_TIMING_LOG_LEVEL = 1;
const TIME_UNIT_TO_MS: Record<string, number> = {
  ns: 1 / 1_000_000,
  nanoseconds: 1 / 1_000_000,
  μs: 1 / 1000,
  µs: 1 / 1000,
  us: 1 / 1000,
  microseconds: 1 / 1000,
  ms: 1,
  milliseconds: 1,
  s: 1000,
  seconds: 1000
};

function isNumericLabel(label: string): boolean {
  return /^[0-9]+$/.test(label);
}

function getTimeUnitToMs(displayTimeUnit?: string): number {
  if (!displayTimeUnit) return DEFAULT_TIME_UNIT_TO_MS;
  const normalizedUnit = displayTimeUnit.trim().toLowerCase();
  return TIME_UNIT_TO_MS[normalizedUnit] ?? DEFAULT_TIME_UNIT_TO_MS;
}

type ParseChromeTraceStats = {
  startTimeMs: number;
  processCount: number;
  threadCount: number;
  spanCount: number;
  instantCount: number;
  counterCount: number;
  flowCount: number;
};

export type ChromeTraceParseOptions = ChromeTraceValidationOptions & {
  log?: Log;
};

export function parseChromeTrace(
  traceFile: unknown,
  options: ChromeTraceParseOptions = {}
): ChromeTrace {
  const validatedTraceFile = validateChromeTraceFile(traceFile, options);

  const timeUnitToMs = getTimeUnitToMs(validatedTraceFile.displayTimeUnit);
  const toMs = (value: number) => value * timeUnitToMs;
  const processes: Record<string, ChromeTraceProcess> = {};
  const threadsByTid: Record<string, Record<string, ChromeTraceThread>> = {};
  // One stack per (pid:tid)
  const stacks: Record<string, StackEntry[]> = {};

  const stats = {
    startTimeMs: performance.now(),
    processCount: 0,
    threadCount: 0,
    spanCount: 0,
    instantCount: 0,
    counterCount: 0,
    flowCount: 0
  } satisfies ParseChromeTraceStats;

  for (const e of validatedTraceFile.traceEvents) {
    const {pid, tid, ph, /* cat, */ name, dur, args} = e;
    const pkey = String(pid);
    const tkey = String(tid);
    const trackId = `${pkey}:${tkey}`;
    const key = trackId;

    // ensure process/thread
    if (!processes[pkey]) {
      processes[pkey] = {
        id: pkey,
        label: pkey,
        threads: []
      } satisfies ChromeTraceProcess;
      threadsByTid[pkey] = {};
      stats.processCount += 1;
    }

    let thread = threadsByTid[pkey]?.[tkey];
    if (!thread) {
      const threadLabel = isNumericLabel(tkey) ? `Thread ${tkey}` : tkey;
      thread = {
        id: trackId,
        pid: pkey,
        tid: tkey,
        label: threadLabel,
        spans: [],
        instants: [],
        counters: [],
        flows: []
      } satisfies ChromeTraceThread;
      processes[pkey].threads.push(thread);
      threadsByTid[pkey][tkey] = thread;
      stats.threadCount += 1;
    }

    const color = colorForCat(e.cat);
    const eventTs = typeof e.ts === 'number' ? e.ts : ph === 'M' ? 0 : null;
    if (eventTs == null) {
      continue;
    }
    const ms = toMs(eventTs);

    switch (ph) {
      case 'X': {
        // complete duration (has ts + dur)
        if (typeof dur !== 'number') break;
        const durMs = toMs(dur);
        thread.spans.push({
          spanId: `${trackId}:${name}:${eventTs}`,
          trackId,
          name,
          startTimeMs: ms,
          endTimeMs: ms + durMs,
          color,
          userData: args
        } satisfies ChromeTraceSpan);
        stats.spanCount += 1;
        break;
      }
      case 'B': {
        // begin: push
        stacks[key] ??= [];
        stacks[key].push({
          spanId: `${trackId}:${name}:${eventTs}`,
          trackId,
          name,
          startTimeMs: ms,
          color,
          userData: args
        } satisfies StackEntry);
        break;
      }
      case 'E': {
        // end: pop
        const stack = stacks[key];
        if (!stack || stack.length === 0) {
          // unmatched end; ignore or log
          break;
        }
        const begin = stack.pop()!;
        thread.spans.push({
          spanId: begin.spanId,
          trackId,
          name: begin.name, // name may differ; typically same
          startTimeMs: begin.startTimeMs,
          endTimeMs: ms, // end ts marks end time
          color: begin.color ?? color,
          userData: begin.userData // prefer begin args
        } satisfies ChromeTraceSpan);
        stats.spanCount += 1;
        break;
      }
      case 'i': {
        thread.instants.push({
          id: `${trackId}:${name}:${eventTs}`,
          trackId,
          name,
          atMs: ms,
          scope: 't',
          color,
          userData: args
        } satisfies ChromeTraceInstant);
        stats.instantCount += 1;
        break;
      }
      case 'C': {
        thread.counters.push({
          id: `${trackId}:${name}:${eventTs}`,
          trackId,
          name,
          atMs: ms,
          series: args || {},
          color,
          userData: args
        } satisfies ChromeTraceCounter);
        stats.counterCount += 1;
        break;
      }
      case 's':
      case 't':
      case 'f': {
        thread.flows.push({
          id: `${trackId}:${name}:${eventTs}`,
          bindId: e.args?.bind_id || '',
          kind: ph === 's' ? 'start' : ph === 't' ? 'step' : 'end',
          eventKey: `${trackId}:${name}`,
          trackId,
          atMs: ms,
          name,
          userData: args
        } satisfies ChromeTraceFlow);
        stats.flowCount += 1;
        break;
      }
      case 'M': {
        const metadataName = (() => {
          if (typeof args?.name === 'string') {
            return args.name.trim();
          }
          if (typeof args?.thread_name === 'string') {
            return args.thread_name.trim();
          }
          if (typeof args?.process_name === 'string') {
            return args.process_name.trim();
          }
          return undefined;
        })();
        if (!metadataName) {
          break;
        }

        if (name === 'thread_name') {
          thread.label = metadataName;
        } else if (name === 'process_name') {
          processes[pkey].label = metadataName;
        }
        break;
      }
      default:
        // ignore others for now
        break;
    }
  }

  // Optionally: handle any leftover begins (unclosed spans) — drop or mark incomplete
  // for (const process of Object.values(processes)) {
  //   console.log(`PROCESS ${process.id}: threads=${process.threads.length}`, process);
  //   for (const thread of process.threads) {
  //     console.log(
  //       `THREAD: spans=${thread.spans.length} flows=${thread.flows.length} instants=${thread.instants.length} counters=${thread.counters.length}`,
  //     );
  //   }
  // }

  options.log?.probe(TRACE_TIMING_LOG_LEVEL, 'parseChromeTrace timing', {
    durationMs: performance.now() - stats.startTimeMs,
    sourceEventCount: validatedTraceFile.traceEvents.length,
    processCount: stats.processCount,
    threadCount: stats.threadCount,
    spanCount: stats.spanCount,
    instantCount: stats.instantCount,
    counterCount: stats.counterCount,
    flowCount: stats.flowCount
  })();

  return {processes: Object.values(processes), metadata: validatedTraceFile.metadata};
}
