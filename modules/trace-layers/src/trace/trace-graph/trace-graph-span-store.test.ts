import {describe, expect, it} from 'vitest';

import {
  buildArrowTraceSpanTableFromRows,
  buildTraceProcessSpanRefTables,
  toTraceSpanArrowRow
} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {getTraceGraphSpanNameUtf8} from '../trace-graph-accessors';
import {TraceGraph} from './trace-graph';
import {
  createDatasetRuntimeTraceGraphForTest,
  createDatasetTraceGraphRuntimeSourceForTest,
  createTraceDatasetFromJSONTraceForTest
} from './trace-graph-test-fixtures';
import {getVisibleSpanGeometrySourcesByProcess} from './trace-graph-visible-span-sources';
import {
  encodeChunkRef,
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef
} from './trace-id-encoder';

import type {
  SpanRef,
  TraceProcess,
  TraceProcessId,
  TraceSpan,
  TraceSpanId,
  TraceThreadId
} from './trace-types';

function createTestTraceGraph(
  traceDataset: Parameters<typeof createDatasetTraceGraphRuntimeSourceForTest>[0],
  options?: Parameters<typeof createDatasetRuntimeTraceGraphForTest>[1]
): TraceGraph {
  return createDatasetRuntimeTraceGraphForTest(traceDataset, options);
}

describe('TraceGraph span store rows', () => {
  it('resolves store-backed UTF-8 span names through direct chunk rows', () => {
    const blockA = createBlockForProcess({
      spanId: 'unsorted-row-a',
      processId: 'rank-a',
      threadId: 'thread-a',
      name: 'alpha'
    });
    const blockB = createBlockForProcess({
      spanId: 'unsorted-row-b',
      processId: 'rank-a',
      threadId: 'thread-a',
      name: 'beta'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-a',
          rankNum: 0,
          threadId: 'thread-a',
          spans: [blockA, blockB]
        })
      ],
      [],
      {name: 'unsorted-chunk-row-name-test'}
    );
    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const processRef = encodeProcessRef(0);
    const threadRef = encodeProcessThreadRef(0, 0);
    const storeSpanTable = buildArrowTraceSpanTableFromRows([
      {
        ...toTraceSpanArrowRow(blockA),
        process_ref: processRef,
        thread_ref: threadRef
      },
      {
        ...toTraceSpanArrowRow(blockB),
        process_ref: processRef,
        thread_ref: threadRef
      }
    ]);
    const renderOrderChunk = {
      ...traceDataset.chunks[0]!,
      chunkIndex: 0,
      chunkRef: encodeChunkRef(0),
      chunkKey: 'unsorted-row-chunk',
      processRefs: [processRef],
      processId: null,
      spanTable: storeSpanTable,
      resolvedSameProcessDependencyTable:
        traceDataset.sameProcessDependencyTableMap['rank-a' as TraceProcessId]!
    };
    const traceGraph = createTestTraceGraph({
      ...traceDataset,
      chunks: [renderOrderChunk],
      processSpanTableMap: buildTraceProcessSpanRefTables(
        [renderOrderChunk],
        traceDataset.processes,
        {
          processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex
        }
      )
    });
    const spanRefA = encodeSpanRef(0, 0);
    const spanRefB = encodeSpanRef(0, 1);
    const spanNameUtf8View = {data: new Uint8Array(), start: 0, end: 0};

    expect(getTraceGraphSpanNameUtf8(traceGraph, spanRefA, spanNameUtf8View)).toBe(true);
    expect(
      Array.from(spanNameUtf8View.data.subarray(spanNameUtf8View.start, spanNameUtf8View.end))
    ).toEqual([97, 108, 112, 104, 97]);
    expect(getTraceGraphSpanNameUtf8(traceGraph, spanRefB, spanNameUtf8View)).toBe(true);
    expect(
      Array.from(spanNameUtf8View.data.subarray(spanNameUtf8View.start, spanNameUtf8View.end))
    ).toEqual([98, 101, 116, 97]);
  });

  it('uses process-scoped chunk owners when row owner refs are stale', () => {
    const block = createBlockForProcess({
      spanId: 'process-scoped-stale-row-ref',
      processId: 'rank-b',
      threadId: 'thread-b',
      name: 'rank-b-label'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-a',
          rankNum: 0,
          threadId: 'thread-a',
          spans: []
        }),
        createProcess({
          processId: 'rank-b',
          rankNum: 1,
          threadId: 'thread-b',
          spans: [block]
        })
      ],
      [],
      {name: 'process-scoped-owner-test'}
    );
    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const processRefA = encodeProcessRef(0);
    const processRefB = encodeProcessRef(1);
    const threadRefA = encodeProcessThreadRef(0, 0);
    const threadRefB = encodeProcessThreadRef(1, 0);
    const staleRowOwnerSpanTable = buildArrowTraceSpanTableFromRows([
      {
        ...toTraceSpanArrowRow(block),
        process_ref: processRefA,
        thread_ref: threadRefA
      }
    ]);
    const processScopedChunk = {
      ...traceDataset.chunks.find(chunk => chunk.processId === 'rank-b')!,
      chunkIndex: 0,
      chunkRef: encodeChunkRef(0),
      chunkKey: 'rank-b-chunk',
      processRefs: [processRefB],
      processId: 'rank-b' as TraceProcessId,
      spanTable: staleRowOwnerSpanTable,
      resolvedSameProcessDependencyTable:
        traceDataset.sameProcessDependencyTableMap['rank-b' as TraceProcessId]!
    };
    const spanRef = encodeSpanRef(0, 0);
    const traceGraph = createTestTraceGraph({
      ...traceDataset,
      chunks: [processScopedChunk],
      spanRefs: [spanRef],
      processSpanTableMap: buildTraceProcessSpanRefTables(
        [processScopedChunk],
        traceDataset.processes,
        {
          processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex,
          spanRefs: [spanRef]
        }
      )
    });

    expect(traceGraph.getVisibleProcessRefs()).toEqual([processRefB]);
    expect(traceGraph.getProcessRefBySpanRef(spanRef)).toBe(processRefB);
    expect(traceGraph.getThreadRefBySpanRef(spanRef)).toBe(threadRefB);
    expect(traceGraph.getSpanDetailSource(spanRef)?.processRef).toBe(processRefB);
    expect(traceGraph.getSpanDetailSource(spanRef)?.threadRef).toBe(threadRefB);
    expect(Array.from(traceGraph.iterateVisibleSpanRefsByProcess(processRefB))).toEqual([spanRef]);

    const spanNameUtf8View = {data: new Uint8Array(), start: 0, end: 0};
    expect(getTraceGraphSpanNameUtf8(traceGraph, spanRef, spanNameUtf8View)).toBe(true);
    expect(
      Array.from(spanNameUtf8View.data.subarray(spanNameUtf8View.start, spanNameUtf8View.end))
    ).toEqual([114, 97, 110, 107, 45, 98, 45, 108, 97, 98, 101, 108]);
  });

  it('treats process span materializations as immutable graph-owned snapshots', () => {
    const blockA = createBlockForProcess({
      spanId: 'growing-row-a',
      processId: 'rank-a',
      threadId: 'thread-a',
      name: 'alpha'
    });
    const blockB = createBlockForProcess({
      spanId: 'growing-row-b',
      processId: 'rank-a',
      threadId: 'thread-a',
      name: 'beta'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-a',
          rankNum: 0,
          threadId: 'thread-a',
          spans: [blockA, blockB]
        })
      ],
      [],
      {name: 'growing-process-span-refs-test'}
    );
    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const processRef = encodeProcessRef(0);
    const spanRefA = encodeSpanRef(0, 0);
    const spanRefB = encodeSpanRef(0, 1);
    const firstActiveSpanRefs = [spanRefA];
    const firstProcessSpanTableMap = buildTraceProcessSpanRefTables(
      traceDataset.chunks,
      traceDataset.processes,
      {
        processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex,
        spanRefs: firstActiveSpanRefs
      }
    );
    const firstTraceGraph = createTestTraceGraph({
      ...traceDataset,
      spanRefs: firstActiveSpanRefs,
      processSpanTableMap: firstProcessSpanTableMap
    });

    expect(Array.from(firstTraceGraph.iterateVisibleSpanRefsByProcess(processRef))).toEqual([
      spanRefA
    ]);
    expect(
      getVisibleSpanGeometrySourcesByProcess(firstTraceGraph, processRef).map(span => span.spanRef)
    ).toEqual([spanRefA]);

    const nextActiveSpanRefs = [spanRefA, spanRefB];
    const nextProcessSpanTableMap = buildTraceProcessSpanRefTables(
      traceDataset.chunks,
      traceDataset.processes,
      {
        processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex,
        spanRefs: nextActiveSpanRefs
      }
    );
    const nextTraceGraph = createTestTraceGraph({
      ...traceDataset,
      spanRefs: nextActiveSpanRefs,
      processSpanTableMap: nextProcessSpanTableMap
    });

    expect(Array.from(firstTraceGraph.iterateVisibleSpanRefsByProcess(processRef))).toEqual([
      spanRefA
    ]);
    expect(Array.from(nextTraceGraph.iterateVisibleSpanRefsByProcess(processRef))).toEqual([
      spanRefA,
      spanRefB
    ]);
    expect(
      getVisibleSpanGeometrySourcesByProcess(nextTraceGraph, processRef).map(span => span.spanRef)
    ).toEqual([spanRefA, spanRefB]);
  });
});

function createBlockForProcess(params: {
  spanId: string;
  processId: string;
  threadId: string;
  name: string;
}): TraceSpan {
  return {
    type: 'trace-span',
    spanRef: 0 as SpanRef,
    spanId: params.spanId as TraceSpanId,
    threadId: params.threadId as TraceThreadId,
    processName: params.processId,
    name: params.name,
    keywords: [],
    primaryTimingKey: 'test',
    timings: {
      test: {
        status: 'finished',
        startTimeMs: 0,
        endTimeMs: 1,
        durationMs: 1,
        durationMsAsString: '1ms'
      }
    },
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}

function createProcess(params: {
  processId: string;
  rankNum: number;
  threadId: string;
  spans: TraceSpan[];
}): TraceProcess {
  const thread = {
    type: 'trace-thread' as const,
    name: params.threadId,
    threadId: params.threadId as TraceThreadId,
    processId: params.processId
  };

  return {
    type: 'trace-process',
    processId: params.processId,
    name: params.processId,
    rankNum: params.rankNum,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: params.spans,
    spanMap: Object.fromEntries(params.spans.map(span => [span.spanId, span])),
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
