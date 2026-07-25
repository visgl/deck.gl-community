import {describe, expect, it, vi} from 'vitest';

import {
  buildTraceChunkDataFromJSONTrace,
  buildTraceProcessSpanRefTables
} from '../../ingestion/arrow-trace';
import {buildJSONTrace, materializeJSONTrace} from '../../ingestion/json-trace';
import {buildTraceDatasetFromReadyTraceChunks} from '../../trace-chunk-graph-assembler';
import {createStaticTraceChunkStore} from '../../trace-chunk-store';
import {encodeSpanRef} from '../../trace-graph/trace-id-encoder';
import {brand} from '../../trace-graph/trace-types';
import {
  buildArrowChromeTraceFile,
  buildChromeTraceFile,
  writeArrowChromeTrace,
  writeChromeTrace
} from './chrome-trace-writer';

import type {TraceDataset} from '../../trace-dataset';
import type {JSONTrace} from '../../trace-graph';
import type {
  TraceCounter,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceInstant,
  TraceProcess,
  TraceSameProcessDependency,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../../trace-graph/trace-types';

describe('ChromeTraceWriter', () => {
  it('stringifies bigint values in trace args before serialization', () => {
    const graph = createBigintGraph('writer', 'Writer Graph');
    const traceDataset = createTraceDataset(graph);

    const traceFile = buildChromeTraceFile(graph);
    const traceDatasetFile = buildArrowChromeTraceFile(traceDataset);
    const spanEvent = traceFile.traceEvents.find(event => event.ph === 'X');
    const counterEvent = traceFile.traceEvents.find(event => event.ph === 'C');

    expect(traceDatasetFile).toEqual(traceFile);
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
    expect(writeArrowChromeTrace(traceDataset)).toEqual(writeChromeTrace(graph));
    expect(() => writeArrowChromeTrace(traceDataset)).not.toThrow();

    const parsed = JSON.parse(writeArrowChromeTrace(traceDataset)) as {
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

  it('can emit bigint values as raw JSON integers for TraceDataset inputs', () => {
    const graph = createBigintGraph('writer-raw', 'Writer Raw Graph');
    const traceDataset = createTraceDataset(graph);

    const serialized = writeChromeTrace(graph, {bigintSerialization: 'raw-number'});
    const arrowSerialized = writeArrowChromeTrace(traceDataset, {
      bigintSerialization: 'raw-number'
    });

    expect(arrowSerialized).toEqual(serialized);
    expect(serialized).toContain('"largeId":12345678901234567890');
    expect(serialized).toContain('"bigSeriesValue":777777777777777777');
  });

  it('matches plain writer output for multi-process Arrow graphs with spans, instants, counters, and flows', () => {
    const graph = createMultiProcessGraph();
    const traceDataset = createTraceDataset(graph);

    expect(buildArrowChromeTraceFile(traceDataset)).toEqual(buildChromeTraceFile(graph));
    expect(writeArrowChromeTrace(traceDataset)).toEqual(writeChromeTrace(graph));

    const parsed = JSON.parse(writeArrowChromeTrace(traceDataset)) as {
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

  it('streams cross-process flows from the canonical dataset dependency table', () => {
    const traceDataset = createTraceDataset(
      createMultiProcessGraph([
        {
          type: 'trace-cross-process-dependency',
          dependencyId: 'dep-cross' as TraceDependencyId,
          endpointId: 'endpoint:cross' as TraceCrossProcessEndpointId,
          startRankNum: 0,
          endRankNum: 1,
          startSpanId: 'span:a' as TraceSpanId,
          endSpanId: 'span:c' as TraceSpanId,
          waitMode: 'end-to-start',
          bidirectional: false,
          topology: 'cross',
          waitTimeMs: 0,
          waiting: false,
          waitNotFinished: false,
          keywords: new Set(['cross']),
          userData: {crossId: 3n}
        }
      ])
    );

    const parsed = JSON.parse(writeArrowChromeTrace(traceDataset)) as {
      traceEvents: Array<{
        ph: string;
        pid: number;
        tid: number;
        id?: string;
        args?: Record<string, unknown>;
      }>;
    };
    const crossFlowEvents = parsed.traceEvents.filter(event => event.id === 'dep-cross');

    expect(crossFlowEvents.map(event => ({ph: event.ph, pid: event.pid, tid: event.tid}))).toEqual([
      {ph: 's', pid: 1, tid: 1},
      {ph: 'f', pid: 2, tid: 1}
    ]);
    expect(crossFlowEvents[0]?.args).toMatchObject({
      keywords: ['cross'],
      userData: {crossId: '3'}
    });
  });

  it('exports only active window spans and omits flows with inactive endpoints', () => {
    const traceDataset = createTraceDataset(createMultiProcessGraph());
    const spanRefs = [encodeSpanRef(0, 0)];
    const windowDataset = {
      ...traceDataset,
      spanRefs,
      processSpanTableMap: buildTraceProcessSpanRefTables(
        traceDataset.chunks,
        traceDataset.processes,
        {
          processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex,
          spanRefs
        }
      )
    } satisfies TraceDataset;

    const parsed = JSON.parse(writeArrowChromeTrace(windowDataset)) as {
      traceEvents: Array<{ph: string; name: string}>;
    };

    expect(parsed.traceEvents.filter(event => event.ph === 'X').map(event => event.name)).toEqual([
      'Start'
    ]);
    expect(parsed.traceEvents.filter(event => event.ph === 's' || event.ph === 'f')).toEqual([]);
  });

  it('does not read span sidecars for flow-only export endpoints', () => {
    const traceDataset = createTraceDataset(createMultiProcessGraph());
    const sidecarTable = traceDataset.chunks[0]?.spanSidecarTable;
    const keywordsColumn = sidecarTable?.getChild('keywords');
    const userDataColumn = sidecarTable?.getChild('userDataJson');
    if (!keywordsColumn || !userDataColumn) {
      throw new Error('Expected writer fixture span sidecar columns.');
    }
    const keywordsGet = vi.spyOn(keywordsColumn, 'get');
    const userDataGet = vi.spyOn(userDataColumn, 'get');

    writeArrowChromeTrace(traceDataset, {includeBlocks: false});

    expect(keywordsGet).not.toHaveBeenCalled();
    expect(userDataGet).not.toHaveBeenCalled();
  });
});

/** Builds one static canonical dataset from a plain graph fixture for writer parity tests. */
function createTraceDataset(traceGraph: JSONTrace): TraceDataset {
  const materializedTrace = materializeJSONTrace(traceGraph);
  const traceChunkStore = createStaticTraceChunkStore({
    identityKey: 'chrome-trace-writer:' + materializedTrace.name,
    chunks: buildTraceChunkDataFromJSONTrace(materializedTrace)
  });
  const selection = traceChunkStore.select({
    window: {
      startTimeMs: -Number.MAX_SAFE_INTEGER,
      endTimeMs: Number.MAX_SAFE_INTEGER
    },
    spanBudget: null
  });
  const traceDataset = traceChunkStore.withReadyChunks(
    selection,
    ({ownerRefRegistry, readyChunks}) =>
      buildTraceDatasetFromReadyTraceChunks({
        name: materializedTrace.name,
        spanLayout: materializedTrace.spanLayout,
        ownerRefRegistry,
        readyChunks,
        crossProcessDependencies: materializedTrace.crossProcessDependencies,
        timeExtents: {
          minTimeMs: materializedTrace.minTimeMs,
          maxTimeMs: materializedTrace.maxTimeMs
        }
      })
  );
  if (!traceDataset) {
    throw new Error('Expected static trace chunks to materialize synchronously.');
  }
  return traceDataset;
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

function createMultiProcessGraph(
  crossProcessDependencies: TraceCrossProcessDependency[] = []
): JSONTrace {
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

  const sameProcessDependency: TraceSameProcessDependency = {
    type: 'trace-same-process-dependency',
    dependencyId: 'dep-local-a' as TraceDependencyId,
    startSpanId: blockA.spanId,
    endSpanId: blockB.spanId,
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: 1,
    keywords: new Set(['local']),
    userData: {localId: 1n}
  };

  const secondSameProcessDependency: TraceSameProcessDependency = {
    type: 'trace-same-process-dependency',
    dependencyId: 'dep-local-b' as TraceDependencyId,
    startSpanId: blockC.spanId,
    endSpanId: blockD.spanId,
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: 1,
    keywords: new Set(['local']),
    userData: {localId: 2n}
  };

  blockA.sameProcessDependencies = [sameProcessDependency];
  blockA.sameProcessDependencyIds = [sameProcessDependency.dependencyId];
  blockB.sameProcessDependencies = [sameProcessDependency];
  blockB.sameProcessDependencyIds = [sameProcessDependency.dependencyId];
  blockC.sameProcessDependencies = [secondSameProcessDependency];
  blockC.sameProcessDependencyIds = [secondSameProcessDependency.dependencyId];
  blockD.sameProcessDependencies = [secondSameProcessDependency];
  blockD.sameProcessDependencyIds = [secondSameProcessDependency.dependencyId];

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
        sameProcessDependencies: [sameProcessDependency]
      }),
      makeProcess({
        processId: 'rank-b',
        name: 'Rank B',
        rankNum: 1,
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
        sameProcessDependencies: [secondSameProcessDependency]
      })
    ],
    crossProcessDependencies,
    {name: 'Multi Process Writer Graph'}
  );
}

function makeProcess(params: {
  processId: string;
  name: string;
  /** Stable process rank used by cross-process dependency endpoint resolution. */
  rankNum?: number;
  thread: TraceThread;
  spans: TraceSpan[];
  counters?: TraceCounter[];
  instants?: TraceInstant[];
  sameProcessDependencies?: TraceSameProcessDependency[];
}): TraceProcess {
  const counters = params.counters ?? [];
  const instants = params.instants ?? [];

  return {
    type: 'trace-process',
    processId: params.processId,
    name: params.name,
    rankNum: params.rankNum ?? 0,
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
    sameProcessDependencies: params.sameProcessDependencies ?? [],
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
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
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
