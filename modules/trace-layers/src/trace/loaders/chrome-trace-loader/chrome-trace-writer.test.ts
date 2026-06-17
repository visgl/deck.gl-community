import {describe, expect, it} from 'vitest';

import {buildTraceGraphDataFromJSONTrace} from '../../ingestion/arrow-trace';
import {buildJSONTrace} from '../../ingestion/json-trace';
import {brand} from '../../trace-graph/trace-types';
import {
  buildArrowChromeTraceFile,
  buildChromeTraceFile,
  writeArrowChromeTrace,
  writeChromeTrace
} from './chrome-trace-writer';

import type {JSONTrace, TraceGraphData} from '../../trace-graph';
import type {
  TraceCounter,
  TraceDependencyId,
  TraceInstant,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../../trace-graph/trace-types';

describe('ChromeTraceWriter', () => {
  it('stringifies bigint values in trace args before serialization', () => {
    const graph = createBigintGraph('writer', 'Writer Graph');
    const traceGraphData = createArrowGraphWithoutBlockMap(graph);

    const traceFile = buildChromeTraceFile(graph);
    const traceGraphDataFile = buildArrowChromeTraceFile(traceGraphData);
    const spanEvent = traceFile.traceEvents.find(event => event.ph === 'X');
    const counterEvent = traceFile.traceEvents.find(event => event.ph === 'C');

    expect(traceGraphDataFile).toEqual(traceFile);
    expect(spanEvent?.args).toMatchObject({
      userData: {
        largeId: '12345678901234567890',
        nested: {
          traceId: '999999999999999999',
          values: ['1', 'ok']
        }
      }
    });
    expect(counterEvent?.args?.bigSeriesValue).toBe('777777777777777777');
    expect(writeArrowChromeTrace(traceGraphData)).toEqual(writeChromeTrace(graph));
    expect(() => writeArrowChromeTrace(traceGraphData)).not.toThrow();

    const parsed = JSON.parse(writeArrowChromeTrace(traceGraphData)) as {
      traceEvents: Array<{ph: string; args?: Record<string, unknown>}>;
    };
    const parsedSpanEvent = parsed.traceEvents.find(event => event.ph === 'X');
    expect(parsedSpanEvent?.args?.userData).toEqual({
      largeId: '12345678901234567890',
      nested: {
        traceId: '999999999999999999',
        values: ['1', 'ok']
      }
    });
  });

  it('can emit bigint values as raw JSON integers for TraceGraphData inputs', () => {
    const graph = createBigintGraph('writer-raw', 'Writer Raw Graph');
    const traceGraphData = createArrowGraphWithoutBlockMap(graph);

    const serialized = writeChromeTrace(graph, {bigintSerialization: 'raw-number'});
    const arrowSerialized = writeArrowChromeTrace(traceGraphData, {
      bigintSerialization: 'raw-number'
    });

    expect(arrowSerialized).toEqual(serialized);
    expect(serialized).toContain('"largeId":12345678901234567890');
    expect(serialized).toContain('"bigSeriesValue":777777777777777777');
  });

  it('matches plain writer output for multi-process Arrow graphs with spans, instants, counters, and flows', () => {
    const graph = createMultiProcessGraph();
    const traceGraphData = createArrowGraphWithoutBlockMap(graph);

    expect(buildArrowChromeTraceFile(traceGraphData)).toEqual(buildChromeTraceFile(graph));
    expect(writeArrowChromeTrace(traceGraphData)).toEqual(writeChromeTrace(graph));

    const parsed = JSON.parse(writeArrowChromeTrace(traceGraphData)) as {
      traceEvents: Array<{
        ph: string;
        pid: number;
        tid: number;
        name: string;
        id?: string;
        args?: Record<string, unknown>;
      }>;
    };
    expect(
      parsed.traceEvents
        .filter(event => event.ph === 's' || event.ph === 'f')
        .map(event => ({
          ph: event.ph,
          pid: event.pid,
          tid: event.tid,
          id: event.id
        }))
    ).toEqual([
      {ph: 's', pid: 1, tid: 1, id: 'dep-local-a'},
      {ph: 'f', pid: 1, tid: 1, id: 'dep-local-a'},
      {ph: 's', pid: 2, tid: 1, id: 'dep-local-b'},
      {ph: 'f', pid: 2, tid: 1, id: 'dep-local-b'}
    ]);
  });
});

function createArrowGraphWithoutBlockMap(traceGraph: JSONTrace): TraceGraphData {
  return buildTraceGraphDataFromJSONTrace(traceGraph);
}

function createBigintGraph(suffix: string, name: string): JSONTrace {
  const threadId = brand<'stream', string>(`stream:${suffix}`);
  const spanId = brand<'block', string>(`span:${suffix}`);
  const counterId = brand<'counter', string>(`counter:${suffix}`);

  const thread = createThread(`rank-${suffix}`, threadId, 'Worker');
  const span = createBlock({
    spanId,
    threadId,
    processName: `Rank ${suffix}`,
    name: 'Span With Bigints',
    startTimeMs: 10,
    endTimeMs: 12,
    userData: {
      largeId: 12345678901234567890n,
      nested: {
        traceId: 999999999999999999n,
        values: [1n, 'ok']
      }
    }
  });
  const counter = createCounter({
    counterId,
    threadId,
    name: 'Counter With Bigint',
    atTimeMs: 11,
    series: {
      bigSeriesValue: 777777777777777777n as unknown as number
    }
  });

  return buildJSONTrace(
    [
      makeProcess({
        processId: `rank-${suffix}`,
        name: `Rank ${suffix}`,
        thread,
        spans: [span],
        counters: [counter]
      })
    ],
    [],
    {name}
  );
}

function createMultiProcessGraph(): JSONTrace {
  const threadA = createThread('rank-a', 'stream:a' as TraceThreadId, 'Worker A');
  const threadB = createThread('rank-b', 'stream:b' as TraceThreadId, 'Worker B');

  const blockA = createBlock({
    spanId: 'span:a' as TraceSpanId,
    threadId: threadA.threadId,
    processName: 'Rank A',
    name: 'Start',
    startTimeMs: 0,
    endTimeMs: 5
  });
  const blockB = createBlock({
    spanId: 'span:b' as TraceSpanId,
    threadId: threadA.threadId,
    processName: 'Rank A',
    name: 'Middle',
    startTimeMs: 6,
    endTimeMs: 9
  });
  const blockC = createBlock({
    spanId: 'span:c' as TraceSpanId,
    threadId: threadB.threadId,
    processName: 'Rank B',
    name: 'Start B',
    startTimeMs: 10,
    endTimeMs: 14
  });
  const blockD = createBlock({
    spanId: 'span:d' as TraceSpanId,
    threadId: threadB.threadId,
    processName: 'Rank B',
    name: 'Finish B',
    startTimeMs: 15,
    endTimeMs: 18
  });

  const localDependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId: 'dep-local-a' as TraceDependencyId,
    startSpanId: blockA.spanId,
    endSpanId: blockB.spanId,
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: 1,
    keywords: new Set(['local']),
    userData: {localId: 1n}
  };

  const secondLocalDependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId: 'dep-local-b' as TraceDependencyId,
    startSpanId: blockC.spanId,
    endSpanId: blockD.spanId,
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: 1,
    keywords: new Set(['local']),
    userData: {localId: 2n}
  };

  blockA.localDependencies = [localDependency];
  blockA.localDependencyIds = [localDependency.dependencyId];
  blockB.localDependencies = [localDependency];
  blockB.localDependencyIds = [localDependency.dependencyId];
  blockC.localDependencies = [secondLocalDependency];
  blockC.localDependencyIds = [secondLocalDependency.dependencyId];
  blockD.localDependencies = [secondLocalDependency];
  blockD.localDependencyIds = [secondLocalDependency.dependencyId];

  return buildJSONTrace(
    [
      makeProcess({
        processId: 'rank-a',
        name: 'Rank A',
        thread: threadA,
        spans: [blockA, blockB],
        counters: [
          createCounter({
            counterId: 'counter:a' as TraceCounter['counterId'],
            threadId: threadA.threadId,
            name: 'Queue Depth',
            atTimeMs: 5,
            series: {value: 3}
          })
        ],
        instants: [
          createInstant({
            instantId: 'instant:a' as TraceInstant['instantId'],
            threadId: threadA.threadId,
            name: 'Checkpoint',
            atTimeMs: 4
          })
        ],
        localDependencies: [localDependency]
      }),
      makeProcess({
        processId: 'rank-b',
        name: 'Rank B',
        thread: threadB,
        spans: [blockC, blockD],
        counters: [
          createCounter({
            counterId: 'counter:b' as TraceCounter['counterId'],
            threadId: threadB.threadId,
            name: 'Workers',
            atTimeMs: 11,
            series: {value: 1}
          })
        ],
        localDependencies: [secondLocalDependency]
      })
    ],
    [],
    {name: 'Multi Process Writer Graph'}
  );
}

function makeProcess(params: {
  processId: string;
  name: string;
  thread: TraceThread;
  spans: TraceSpan[];
  counters?: TraceCounter[];
  instants?: TraceInstant[];
  localDependencies?: TraceLocalDependency[];
}): TraceProcess {
  const counters = params.counters ?? [];
  const instants = params.instants ?? [];

  return {
    type: 'trace-process',
    processId: params.processId,
    name: params.name,
    rankNum: 0,
    stepNum: 0,
    threads: [params.thread],
    threadMap: {[params.thread.threadId]: params.thread},
    spans: params.spans,
    spanMap: Object.fromEntries(params.spans.map(span => [span.spanId, span])),
    instants,
    instantMap: Object.fromEntries(instants.map(instant => [instant.instantId, instant])),
    threadInstantMap: {[params.thread.threadId]: instants},
    counters,
    counterMap: Object.fromEntries(counters.map(counter => [counter.counterId, counter])),
    threadCounterMap: {[params.thread.threadId]: counters},
    localDependencies: params.localDependencies ?? [],
    remoteDependencies: []
  };
}

function createThread(processId: string, threadId: TraceThreadId, name: string): TraceThread {
  return {
    type: 'trace-thread',
    name,
    threadId,
    processId
  };
}

function createBlock(params: {
  spanId: TraceSpanId;
  threadId: TraceThreadId;
  processName: string;
  name: string;
  startTimeMs: number;
  endTimeMs: number;
  userData?: TraceSpan['userData'];
}): TraceSpan {
  return {
    type: 'trace-span',
    spanId: params.spanId,
    threadId: params.threadId,
    processName: params.processName,
    name: params.name,
    primaryTimingKey: 'primary',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: params.startTimeMs,
        endTimeMs: params.endTimeMs,
        durationMs: params.endTimeMs - params.startTimeMs,
        durationMsAsString: `${params.endTimeMs - params.startTimeMs} ms`
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: [],
    userData: params.userData
  };
}

function createCounter(params: {
  counterId: TraceCounter['counterId'];
  threadId: TraceThreadId;
  name: string;
  atTimeMs: number;
  series: TraceCounter['series'];
}): TraceCounter {
  return {
    type: 'trace-counter',
    counterId: params.counterId,
    threadId: params.threadId,
    name: params.name,
    atTimeMs: params.atTimeMs,
    totalValue: Object.values(params.series)[0] ?? 0,
    series: params.series
  };
}

function createInstant(params: {
  instantId: TraceInstant['instantId'];
  threadId: TraceThreadId;
  name: string;
  atTimeMs: number;
}): TraceInstant {
  return {
    type: 'trace-instant',
    instantId: params.instantId,
    threadId: params.threadId,
    name: params.name,
    atTimeMs: params.atTimeMs,
    scope: 't'
  };
}
