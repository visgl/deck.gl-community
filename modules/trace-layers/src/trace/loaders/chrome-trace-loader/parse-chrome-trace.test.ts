// parseChromeTrace.spec.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {buildTraceRanksFromChromeTrace} from '../../trace-chrome/build-trace-graph-from-chrome-trace';
import {COLORS_LIST} from '../../trace-style/color-palette';
import {ChromeTraceFileSchema, validateChromeTraceFile} from './chrome-trace-schema';
import {parseChromeTrace} from './parse-chrome-trace';

// Mock the schema module to assert validation is called
vi.mock('./chrome-trace-schema', () => {
  return {
    validateChromeTraceFile: vi.fn(),
    ChromeTraceEventSchema: {},
    ChromeTraceFileSchema: {}
  };
});

// Helper to quickly create events (Chrome trace uses microseconds)
function ev(
  partial: Partial<ChromeTraceFileSchema['traceEvents'][number]>
): ChromeTraceFileSchema['traceEvents'][number] {
  return {
    ph: 'i', // Default phase
    pid: 1, // Default process ID
    tid: 2, // Default thread ID
    ts: 1000, // Default timestamp (1000 µs = 1 ms)
    name: 'evt', // Default name
    cat: undefined, // Default category
    args: undefined, // Default arguments
    ...partial // Override defaults with provided values
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(validateChromeTraceFile).mockImplementation(value => value as ChromeTraceFileSchema);
});

describe('parseChromeTrace', () => {
  it('calls validateChromeTraceFile and passes through metadata', () => {
    const file: ChromeTraceFileSchema = {
      metadata: {source: 'unit-test'},
      traceEvents: []
    };
    const out = parseChromeTrace(file);

    expect(validateChromeTraceFile).toHaveBeenCalledTimes(1);
    expect(out.metadata).toEqual({source: 'unit-test'});
  });

  it('creates process/thread with default labels and ids', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [ev({ph: 'i', pid: 42, tid: 7, name: 'mark'})]
    };
    const out = parseChromeTrace(file);

    expect(out.processes).toHaveLength(1);
    const proc = out.processes[0];
    expect(proc.id).toBe('42');
    expect(proc.label).toBe('42');

    expect(proc.threads).toHaveLength(1);
    const thr = proc.threads[0];
    expect(thr.id).toBe('42:7');
    expect(thr.pid).toBe('42');
    expect(thr.tid).toBe('7');
    expect(thr.label).toBe('Thread 7');
  });

  it('accepts metadata events without timestamps', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [
        {
          name: 'process_name',
          ph: 'M',
          pid: 42,
          tid: 7,
          args: {name: 'proc-42'}
        },
        ev({ph: 'i', pid: 42, tid: 7, ts: 5_000, name: 'mark'})
      ]
    };
    const out = parseChromeTrace(file);

    expect(out.processes[0].label).toBe('proc-42');
    expect(out.processes[0].threads[0].instants[0]?.atMs).toBe(5);
  });

  it('parses instant events: ms conversion, default scope "t", palette color for known category', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [ev({ph: 'i', ts: 12_345, name: 'Instant', cat: 'input', args: {a: 1}})]
    };
    const out = parseChromeTrace(file);
    const inst = out.processes[0].threads[0].instants[0];

    expect(inst.name).toBe('Instant');
    expect(inst.atMs).toBe(12.345); // µs → ms
    expect(inst.scope).toBe('t'); // defaulted
    expect(inst.trackId).toBe('1:2');
    expect(inst.userData).toEqual({a: 1});
    // Palette color for "input": [171, 71, 188, 255]
    expect(inst.color).toEqual([171, 71, 188, 255]);
  });

  it('parses counter events: series copied from args and ms conversion', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [
        ev({ph: 'C', ts: 2_000, name: 'CPU', cat: 'scheduler', args: {value: 42, other: 3.14}})
      ]
    };
    const out = parseChromeTrace(file);
    const ctr = out.processes[0].threads[0].counters[0];

    expect(ctr.name).toBe('CPU');
    expect(ctr.atMs).toBe(2); // 2000 µs → 2 ms
    expect(ctr.series).toEqual({value: 42, other: 3.14});
    // Palette color for "scheduler": [0, 121, 107, 255]
    expect(ctr.color).toEqual([0, 121, 107, 255]);
  });

  it('maps flow phases s/t/f to kind start/step/end and picks up bind_id', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [
        ev({ph: 's', ts: 10_000, name: 'Flow', args: {bind_id: 'B1', extra: 1}}),
        ev({ph: 't', ts: 11_000, name: 'Flow', args: {bind_id: 'B1'}}),
        ev({ph: 'f', ts: 12_000, name: 'Flow', args: {bind_id: 'B1'}})
      ]
    };
    const out = parseChromeTrace(file);
    const flows = out.processes[0].threads[0].flows;

    expect(flows).toHaveLength(3);
    expect(flows.map(f => f.kind)).toEqual(['start', 'step', 'end']);
    expect(flows.every(f => f.bindId === 'B1')).toBe(true);
    expect(flows[0].atMs).toBe(10); // 10000 µs → 10 ms
    expect(flows[0].eventKey).toBe('1:2:Flow');
    expect(flows[0].trackId).toBe('1:2');
    expect(flows[0].name).toBe('Flow');
    expect(flows[0].userData).toEqual({bind_id: 'B1', extra: 1});
  });

  it('falls back to top-level flow bind_id and id fields', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [
        ev({ph: 's', ts: 10_000, name: 'Flow', id: 'from-id'}),
        ev({ph: 't', ts: 11_000, name: 'Flow', bind_id: 'from-bind-id', id: 'ignored-id'}),
        ev({ph: 'f', ts: 12_000, name: 'Flow', id: 42})
      ]
    };
    const out = parseChromeTrace(file);
    const flows = out.processes[0].threads[0].flows;

    expect(flows.map(flow => flow.bindId)).toEqual(['from-id', 'from-bind-id', '42']);
  });

  it('creates spans from X (complete) events using ts+dur', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [ev({ph: 'X', name: 'Work', ts: 1_000, dur: 4_000, cat: 'v8', args: {x: 1}})]
    };
    const out = parseChromeTrace(file);
    const span = out.processes[0].threads[0].spans[0];

    expect(span.name).toBe('Work');
    expect(span.startTimeMs).toBe(1); // 1000 µs → 1 ms
    expect(span.endTimeMs).toBe(5); // (1000+4000) µs → 5 ms
    // Palette color for "v8": [244, 180, 0, 255]
    expect(span.color).toEqual([244, 180, 0, 255]);
    expect(span.userData).toEqual({x: 1});
  });

  it('pairs B/E with a stack per thread and sets endTimeMs to E.ts', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [
        ev({ph: 'B', name: 'Outer', ts: 1_000, cat: 'gpu'}),
        ev({ph: 'B', name: 'Inner', ts: 2_000}),
        ev({ph: 'E', name: 'Inner', ts: 3_500}),
        ev({ph: 'E', name: 'Outer', ts: 5_000})
      ]
    };
    const out = parseChromeTrace(file);
    const spans = out.processes[0].threads[0].spans;

    // Produced order matches input E’s (each push on E)
    expect(spans).toHaveLength(2);

    const inner = spans[0];
    expect(inner.name).toBe('Inner');
    expect(inner.startTimeMs).toBe(2); // 2000 µs → 2 ms
    expect(inner.endTimeMs).toBe(3.5); // 3500 µs → 3.5 ms

    const outer = spans[1];
    expect(outer.name).toBe('Outer');
    expect(outer.startTimeMs).toBe(1); // 1000 µs → 1 ms
    expect(outer.endTimeMs).toBe(5); // 5000 µs → 5 ms
    // Palette color for "gpu": [15, 157, 88, 255]
    expect(outer.color).toEqual([15, 157, 88, 255]);
  });

  it('ignores unmatched E and drops dangling B (no span emitted)', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [
        ev({ph: 'E', name: 'NoBegin', ts: 2_000}), // ignored
        ev({ph: 'B', name: 'Dangling', ts: 3_000}) // left open
        // no E for Dangling
      ]
    };
    const out = parseChromeTrace(file);
    const spans = out.processes[0].threads[0].spans;

    expect(spans).toHaveLength(0);
  });

  it('applies hashed fallback color for unknown categories', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [ev({ph: 'i', cat: 'totally-unknown-cat'})]
    };
    const out = parseChromeTrace(file);
    const inst = out.processes[0].threads[0].instants[0];

    expect(Array.isArray(inst.color)).toBe(true);
    expect(inst.color).toHaveLength(4);
    expect(inst.color?.[3]).toBe(255);

    // Ensure it is not equal to any known palette color
    const known = new Set([
      '66,133,244,255', // blink
      '219,68,55,255', // net
      '244,180,0,255', // v8
      '15,157,88,255', // gpu
      '171,71,188,255', // input
      '0,121,107,255' // scheduler
    ]);
    expect(known.has(inst.color!.join(','))).toBe(false);
  });

  it('groups multiple threads under the same process', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [
        ev({ph: 'i', pid: 9, tid: 1, name: 't1'}),
        ev({ph: 'i', pid: 9, tid: 2, name: 't2'}),
        ev({ph: 'C', pid: 9, tid: 2, name: 'c2', args: {value: 1}})
      ]
    };
    const out = parseChromeTrace(file);
    const proc = out.processes[0];

    expect(out.processes).toHaveLength(1);
    expect(proc.id).toBe('9');
    expect(proc.threads).toHaveLength(2);

    const t1 = proc.threads.find(t => t.tid === '1')!;
    const t2 = proc.threads.find(t => t.tid === '2')!;
    expect(t1.instants.map(i => i.name)).toEqual(['t1']);
    expect(t2.instants.map(i => i.name)).toEqual(['t2']);
    expect(t2.counters.map(c => c.name)).toEqual(['c2']);
  });

  it('ignores X without dur (defensive)', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [
        ev({ph: 'X', name: 'BadComplete', ts: 1_000}) // dur missing
      ]
    };
    const out = parseChromeTrace(file);
    expect(out.processes[0].threads[0].spans).toHaveLength(0);
  });

  it('assigns deterministic process colors and propagates to chrome trace data', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [
        ev({ph: 'X', pid: 2, tid: 4, name: 'p2-span', ts: 1_000, dur: 2_000}),
        ev({ph: 'X', pid: 1, tid: 3, name: 'p1-span', ts: 2_000, dur: 3_000}),
        ev({ph: 'i', pid: 1, tid: 3, ts: 6_000, name: 'instant'}),
        ev({ph: 'C', pid: 1, tid: 3, ts: 7_000, name: 'ctr', args: {value: 7}})
      ]
    };

    const trace = parseChromeTrace(file);
    const {ranks} = buildTraceRanksFromChromeTrace(trace);

    const rank1 = ranks.find(rank => rank.processId === '1');
    const rank2 = ranks.find(rank => rank.processId === '2');

    expect(rank1?.userData?.color).toEqual(COLORS_LIST[0]);
    expect(rank2?.userData?.color).toEqual(COLORS_LIST[1]);

    const rank1Stream = rank1?.threads[0];
    const rank1Block = rank1?.spans[0];
    const rank1Instant = rank1?.instants[0];
    const rank1Counter = rank1?.counters[0];

    expect(rank1Stream?.userData?.color).toEqual(COLORS_LIST[0]);
    expect(rank1Block?.userData?.color).toEqual(COLORS_LIST[0]);
    expect(rank1Block?.userData?.streamColor).toEqual(COLORS_LIST[0]);
    expect(rank1Instant?.userData?.color).toEqual(COLORS_LIST[0]);
    expect(rank1Counter?.userData?.color).toEqual(COLORS_LIST[0]);
  });

  it('uses args.thread_name for stream naming when available', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [
        ev({
          ph: 'X',
          pid: 1,
          tid: 2,
          name: 'work',
          ts: 1_000,
          dur: 2_000,
          args: {thread_name: 'Worker Thread'}
        })
      ]
    };

    const trace = parseChromeTrace(file);
    const {ranks} = buildTraceRanksFromChromeTrace(trace);
    const threadName = ranks[0]?.threads[0]?.name;
    expect(threadName).toBe('Worker Thread (2)');
  });

  it('names numeric thread ids with a Thread prefix', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [ev({ph: 'X', pid: 1, tid: 7, name: 'work', ts: 1_000, dur: 2_000})]
    };

    const trace = parseChromeTrace(file);
    const {ranks} = buildTraceRanksFromChromeTrace(trace);
    const threadName = ranks[0]?.threads[0]?.name;
    expect(threadName).toBe('Thread 7');
  });

  it('does not append ids for non-numeric thread ids', () => {
    const file: ChromeTraceFileSchema = {
      traceEvents: [
        ev({
          ph: 'X',
          pid: 1,
          tid: 2,
          name: 'work',
          ts: 1_000,
          dur: 2_000,
          args: {thread_name: 'Worker Thread'}
        })
      ]
    };

    const trace = parseChromeTrace(file);
    const {ranks} = buildTraceRanksFromChromeTrace(trace);
    const threadName = ranks[0]?.threads[0]?.name;
    expect(threadName).toBe('Worker Thread (2)');
  });

  it('honors seeded process color overrides for known process labels', () => {
    const seededColor: [number, number, number, number] = [10, 20, 30, 255];
    const file: ChromeTraceFileSchema = {
      traceEvents: [
        ev({ph: 'M', pid: 7, tid: 0, name: 'process_name', args: {name: 'RenderMain'}}),
        ev({ph: 'X', pid: 7, tid: 1, name: 'render', ts: 1_000, dur: 1_000}),
        ev({ph: 'X', pid: 9, tid: 1, name: 'other', ts: 2_500, dur: 1_000})
      ]
    };

    const trace = parseChromeTrace(file);
    const {ranks} = buildTraceRanksFromChromeTrace(trace, {
      processColors: {
        seeds: [{match: /render/i, color: seededColor}]
      }
    });

    const renderRank = ranks.find(rank => rank.processId === '7');
    const otherRank = ranks.find(rank => rank.processId === '9');

    expect(renderRank?.userData?.color).toEqual(seededColor);
    expect(renderRank?.threads[0]?.userData?.color).toEqual(seededColor);
    expect(renderRank?.spans[0]?.userData?.color).toEqual(seededColor);

    expect(otherRank?.userData?.color).toEqual(COLORS_LIST[0]);
  });

  it('converts timestamps to milliseconds based on displayTimeUnit', () => {
    const nsFile: ChromeTraceFileSchema = {
      displayTimeUnit: 'ns',
      traceEvents: [ev({ph: 'X', pid: 3, tid: 4, ts: 1_000_000, dur: 500_000, name: 'ns'})]
    };
    const nsSpan = parseChromeTrace(nsFile).processes[0].threads[0].spans[0];
    expect(nsSpan.startTimeMs).toBe(1);
    expect(nsSpan.endTimeMs).toBe(1.5);

    const msFile: ChromeTraceFileSchema = {
      displayTimeUnit: 'ms',
      traceEvents: [ev({ph: 'X', pid: 5, tid: 6, ts: 5, dur: 3, name: 'ms'})]
    };
    const msSpan = parseChromeTrace(msFile).processes[0].threads[0].spans[0];
    expect(msSpan.startTimeMs).toBe(5);
    expect(msSpan.endTimeMs).toBe(8);
  });
});
