import {describe, expect, it} from 'vitest';

import {
  buildTraceGraphDataFromJSONTrace,
  buildTraceProcessSpanRefTables
} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {encodeChunkRef, encodeProcessRef, encodeSpanRef} from '../trace-graph/trace-id-encoder';
import {getProcessSpanChunkCacheKey} from './trace-geometry-layout-helpers';

import type {ArrowTraceChunk} from '../ingestion/arrow-trace';
import type {TraceGraph} from '../trace-graph/trace-graph';
import type {
  SpanRef,
  TraceProcess,
  TraceProcessId,
  TraceSpanId,
  TraceThreadId
} from '../trace-graph/trace-types';

describe('getProcessSpanChunkCacheKey', () => {
  it('changes when the active SpanRefs for a chunk-window process change', () => {
    const traceGraphData = buildTraceGraphDataFromJSONTrace(
      buildJSONTrace(
        [
          createProcess({
            processId: 'rank-a',
            spanIds: ['span-a', 'span-b']
          })
        ],
        [],
        {name: 'chunk-window-key-test'}
      )
    );
    const processRef = encodeProcessRef(0);
    const chunk = {
      chunkIndex: 7,
      chunkRef: encodeChunkRef(7),
      chunkKey: 'shared-ready-chunk',
      processRefs: [processRef],
      processId: null,
      spanTable: traceGraphData.chunks[0]!.spanTable,
      localDependencyTable: traceGraphData.localDependencyTableMap['rank-a' as TraceProcessId]!
    } satisfies ArrowTraceChunk;
    const firstWindowKey = getProcessSpanChunkCacheKey(
      createChunkWindowGraph(traceGraphData, chunk, [encodeSpanRef(7, 0)]),
      processRef
    );
    const secondWindowKey = getProcessSpanChunkCacheKey(
      createChunkWindowGraph(traceGraphData, chunk, [encodeSpanRef(7, 1)]),
      processRef
    );

    expect(firstWindowKey).toBeTruthy();
    expect(secondWindowKey).toBeTruthy();
    expect(secondWindowKey).not.toBe(firstWindowKey);
  });
});

function createChunkWindowGraph(
  traceGraphData: ReturnType<typeof buildTraceGraphDataFromJSONTrace>,
  chunk: ArrowTraceChunk,
  spanRefs: SpanRef[]
): Readonly<TraceGraph> {
  return {
    chunks: [chunk],
    processIdsByIndex: traceGraphData.processIdsByIndex,
    processSpanTableMap: buildTraceProcessSpanRefTables([chunk], traceGraphData.processes, {
      processIdsByIndex: traceGraphData.processIdsByIndex,
      spanRefs
    })
  } as unknown as Readonly<TraceGraph>;
}

function createProcess(params: {processId: string; spanIds: readonly string[]}): TraceProcess {
  const threadId = `thread/${params.processId}` as TraceThreadId;
  const spans = params.spanIds.map((spanId, spanIndex) => ({
    type: 'trace-span' as const,
    spanId: spanId as TraceSpanId,
    threadId,
    processName: params.processId,
    name: spanId,
    keywords: [],
    primaryTimingKey: 'default',
    timings: {
      default: {
        status: 'finished' as const,
        startTimeMs: spanIndex,
        endTimeMs: spanIndex + 1,
        durationMs: 1,
        durationMsAsString: '1ms'
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  }));
  const thread = {
    type: 'trace-thread' as const,
    processId: params.processId,
    threadId,
    name: threadId
  };
  return {
    type: 'trace-process',
    processId: params.processId,
    name: params.processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: [],
    remoteDependencies: []
  };
}
