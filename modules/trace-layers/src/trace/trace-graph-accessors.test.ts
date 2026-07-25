import {describe, expect, it, vi} from 'vitest';

import {type TraceProcessId} from './index';
import {
  buildArrowTraceSameProcessDependencyTable,
  buildArrowTraceSpanSidecarTableFromColumns,
  buildArrowTraceSpanSidecarTableFromRows,
  buildArrowTraceSpanTableFromColumns
} from './ingestion/arrow-trace';
import {buildJSONTrace} from './ingestion/json-trace';
import {
  getActiveTraceGraphSpanDetailSource,
  getActiveTraceGraphSpanGeometrySource,
  getArrowTraceSpanField,
  getTraceGraphSpanDetailSource,
  getTraceGraphSpanGeometrySource,
  getTraceGraphSpanLaneSource,
  getTraceGraphSpanLayoutLaneSource,
  getTraceGraphSpanUserData
} from './trace-graph-accessors';
import {createTraceDatasetFromJSONTraceForTest} from './trace-graph/trace-graph-test-fixtures';
import {encodeChunkRef, encodeProcessRef, encodeSpanRef} from './trace-graph/trace-id-encoder';

import type {JSONTrace} from './trace-graph';
import type {
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from './trace-graph/trace-types';

describe('trace-graph-accessors', () => {
  it('reads ref-native sources from Arrow tables without compatibility span storage', () => {
    const graph = createGraph('arrow-accessors', [
      {
        processId: 'rank-1',
        spans: [
          {spanId: 'rank-1-span-1', startTimeMs: 0, endTimeMs: 5},
          {
            spanId: 'rank-1-span-2',
            startTimeMs: 6,
            endTimeMs: 8,
            source: 'worker-trace.json'
          }
        ]
      },
      {
        processId: 'rank-2',
        spans: [{spanId: 'rank-2-span-1', startTimeMs: 1, endTimeMs: 7}]
      }
    ]);
    const traceSource = createArrowGraphWithoutCompatibilityBlocks(graph);

    expect('spanMap' in traceSource).toBe(false);
    expect(traceSource.processes.every(process => !('spans' in process))).toBe(true);
    expect(traceSource.processes.every(process => !('spanMap' in process))).toBe(true);
    const spanIndex = encodeSpanRef(0, 1);
    expect(spanIndex).not.toBeNull();
    expect(getTraceGraphSpanGeometrySource(traceSource, spanIndex)).toMatchObject({
      primaryTimingKey: 'primary'
    });
    expect(getTraceGraphSpanLaneSource(traceSource, spanIndex)).toMatchObject({
      spanId: 'rank-1-span-2',
      threadId: 'rank-1-thread',
      primaryTimingKey: 'primary'
    });
    expect(getTraceGraphSpanDetailSource(traceSource, spanIndex)).toMatchObject({
      spanId: 'rank-1-span-2',
      source: 'worker-trace.json',
      name: 'rank-1-span-2',
      processName: 'rank-1',
      threadId: 'rank-1-thread'
    });
    expect(getArrowTraceSpanField(traceSource, 'rank-1-span-2' as TraceSpanId, 'name')).toBe(
      'rank-1-span-2'
    );
    expect(getArrowTraceSpanField(traceSource, 'rank-1-span-2' as TraceSpanId, 'source')).toBe(
      'worker-trace.json'
    );
    expect(getArrowTraceSpanField(traceSource, 'rank-1-span-2' as TraceSpanId, 'durationMs')).toBe(
      2
    );
  });

  it('uses the span-specific runtime chunk resolver before generic ref dispatch', () => {
    const graph = createGraph('runtime-chunk-resolver-accessors', [
      {
        processId: 'rank-1',
        spans: [
          {spanId: 'rank-1-span-1', startTimeMs: 0, endTimeMs: 5},
          {spanId: 'rank-1-span-2', startTimeMs: 6, endTimeMs: 8}
        ]
      }
    ]);
    const traceSource = createArrowGraphWithoutCompatibilityBlocks(graph);
    const resolvedChunk = traceSource.chunks[0]!;
    const spanRef = encodeSpanRef(resolvedChunk.chunkIndex, 1);
    const getSpanChunkByRef = vi.fn(() => resolvedChunk);
    const getChunkByRef = vi.fn(() => {
      throw new Error('generic chunk resolver should not handle span refs');
    });
    const registryBackedGraph = {
      ...traceSource,
      chunks: [],
      getSpanChunkByRef,
      getChunkByRef
    } as typeof traceSource & {
      /** Resolve a span ref through the runtime span-chunk registry. */
      getSpanChunkByRef: (ref: typeof spanRef) => typeof resolvedChunk | null;
      /** Resolve a span ref through a runtime chunk registry. */
      getChunkByRef: (ref: typeof spanRef) => typeof resolvedChunk | null;
    };

    expect(getTraceGraphSpanDetailSource(registryBackedGraph, spanRef)?.spanId).toBe(
      'rank-1-span-2'
    );
    expect(getTraceGraphSpanGeometrySource(registryBackedGraph, spanRef)?.primaryTimingKey).toBe(
      'primary'
    );
    expect(getArrowTraceSpanField(registryBackedGraph, spanRef, 'name')).toBe('rank-1-span-2');
    expect(getSpanChunkByRef).toHaveBeenCalledWith(spanRef);
    expect(getChunkByRef).not.toHaveBeenCalled();

    const inactiveRegistryBackedGraph = {
      ...registryBackedGraph,
      spanRefs: []
    };
    expect(getTraceGraphSpanDetailSource(inactiveRegistryBackedGraph, spanRef)).toBeNull();
    expect(getActiveTraceGraphSpanDetailSource(inactiveRegistryBackedGraph, spanRef)?.spanId).toBe(
      'rank-1-span-2'
    );
    expect(
      getActiveTraceGraphSpanGeometrySource(inactiveRegistryBackedGraph, spanRef)?.primaryTimingKey
    ).toBe('primary');
  });

  it('keeps geometry sources off lane-only Arrow span columns', () => {
    const graph = createGraph('geometry-only-source-accessors', [
      {
        processId: 'rank-1',
        spans: [{spanId: 'rank-1-span-1', startTimeMs: 0, endTimeMs: 5}]
      }
    ]);
    const traceSource = createArrowGraphWithoutCompatibilityBlocks(graph);
    const spanTable = traceSource.chunks[0]!.spanTable;
    const getChild = vi.spyOn(spanTable, 'getChild');

    expect(getTraceGraphSpanGeometrySource(traceSource, encodeSpanRef(0, 0))).toMatchObject({
      primaryTimingKey: 'primary'
    });
    expect(getChild.mock.calls.some(([columnName]) => columnName === 'span_id')).toBe(false);
    expect(getChild.mock.calls.some(([columnName]) => columnName === 'thread_id')).toBe(false);

    expect(getTraceGraphSpanLaneSource(traceSource, encodeSpanRef(0, 0))).toMatchObject({
      spanId: 'rank-1-span-1',
      threadId: 'rank-1-thread'
    });
  });

  it('skips non-primary timing sidecars for primary-only geometry reads', () => {
    const process = createProcess(
      {
        processId: 'rank-1',
        spans: [{spanId: 'rank-1-span-1', startTimeMs: 0, endTimeMs: 5}]
      },
      0
    );
    const spanTable = buildArrowTraceSpanTableFromColumns({
      process_ref: [encodeProcessRef(0)],
      span_id: ['rank-1-span-1'],
      thread_id: ['rank-1-thread'],
      name: ['rank-1-span-1'],
      source: [null],
      primary_timing_key: ['primary'],
      status: ['finished'],
      start_time_ms: [0],
      end_time_ms: [5],
      duration_ms: [5]
    });
    const resolvedSameProcessDependencyTable = buildArrowTraceSameProcessDependencyTable([]);
    const spanSidecarTable = buildArrowTraceSpanSidecarTableFromColumns({
      rowCount: 1,
      timingsJson: [
        JSON.stringify({
          primary: {
            status: 'finished',
            startTimeMs: 0,
            endTimeMs: 5,
            durationMs: 5,
            durationMsAsString: '5ms'
          },
          secondary: {
            status: 'finished',
            startTimeMs: 1,
            endTimeMs: 4,
            durationMs: 3,
            durationMsAsString: '3ms'
          }
        })
      ]
    });
    const traceSource = {
      ...createArrowAccessorSource(
        buildJSONTrace([process], [], {name: 'primary-only-geometry-accessors'})
      ),
      spanSidecarTableMap: {['rank-1' as TraceProcessId]: spanSidecarTable},
      chunks: [
        {
          chunkIndex: 0,
          chunkRef: encodeChunkRef(0),
          chunkKey: 'chunk-rank-1',
          processRefs: [encodeProcessRef(0)],
          processId: 'rank-1' as TraceProcessId,
          spanTable,
          resolvedSameProcessDependencyTable,
          spanSidecarTable
        }
      ]
    };
    const spanRef = encodeSpanRef(0, 0);

    expect(getTraceGraphSpanGeometrySource(traceSource, spanRef)?.timings).toHaveProperty(
      'secondary'
    );
    const layoutLaneSource = getTraceGraphSpanLayoutLaneSource(traceSource, spanRef);
    expect(layoutLaneSource?.timings).toHaveProperty('secondary');
    expect(layoutLaneSource).toMatchObject({
      spanRef,
      processRef: encodeProcessRef(0),
      primaryTimingKey: 'primary'
    });
    expect(layoutLaneSource).not.toHaveProperty('spanId');
    expect(layoutLaneSource).not.toHaveProperty('threadId');
    expect(layoutLaneSource).not.toHaveProperty('layoutTopY');
    expect(layoutLaneSource).not.toHaveProperty('layoutHeight');
    expect(getTraceGraphSpanGeometrySource(traceSource, spanRef, null)?.timings).toEqual({
      primary: expect.objectContaining({startTimeMs: 0, endTimeMs: 5})
    });
    expect(
      getTraceGraphSpanGeometrySource(traceSource, spanRef, 'secondary')?.timings
    ).toHaveProperty('secondary');
  });

  it('reads one requested native timing projection without duplicating the primary timing', () => {
    const process = createProcess(
      {
        processId: 'rank-1',
        spans: [{spanId: 'rank-1-span-1', startTimeMs: 0, endTimeMs: 5}]
      },
      0
    );
    const spanTable = buildArrowTraceSpanTableFromColumns({
      process_ref: [encodeProcessRef(0)],
      span_id: ['rank-1-span-1'],
      thread_id: ['rank-1-thread'],
      name: ['rank-1-span-1'],
      source: [null],
      primary_timing_key: ['envelope'],
      status: ['finished'],
      start_time_ms: [0],
      end_time_ms: [5],
      duration_ms: [5]
    });
    const resolvedSameProcessDependencyTable = buildArrowTraceSameProcessDependencyTable([]);
    const spanSidecarTable = buildArrowTraceSpanSidecarTableFromRows([
      {
        primaryTimingKey: 'envelope',
        timings: {
          envelope: {
            status: 'finished',
            startTimeMs: 0,
            endTimeMs: 5,
            durationMs: 5,
            durationMsAsString: '5 ms'
          },
          latest_start: {
            status: 'finished',
            startTimeMs: 2,
            endTimeMs: 4,
            durationMs: 2,
            durationMsAsString: '2 ms'
          }
        },
        keywords: [],
        sameProcessDependencyIds: [],
        incomingSameProcessDependencyRowIndexes: [],
        outgoingSameProcessDependencyRowIndexes: [],
        crossProcessEndpointId: null,
        crossProcessDependencyEndpoints: []
      }
    ]);
    const traceSource = {
      ...createArrowAccessorSource(
        buildJSONTrace([process], [], {name: 'native-timing-geometry-accessors'})
      ),
      spanSidecarTableMap: {['rank-1' as TraceProcessId]: spanSidecarTable},
      chunks: [
        {
          chunkIndex: 0,
          chunkRef: encodeChunkRef(0),
          chunkKey: 'chunk-rank-1',
          processRefs: [encodeProcessRef(0)],
          processId: 'rank-1' as TraceProcessId,
          spanTable,
          resolvedSameProcessDependencyTable,
          spanSidecarTable
        }
      ]
    };
    const spanRef = encodeSpanRef(0, 0);

    expect(spanSidecarTable.getChild('timingsJson')).toBeNull();
    expect(getTraceGraphSpanGeometrySource(traceSource, spanRef, null)?.timings).toEqual({
      envelope: expect.objectContaining({startTimeMs: 0, endTimeMs: 5})
    });
    expect(getTraceGraphSpanGeometrySource(traceSource, spanRef, 'latest_start')?.timings).toEqual({
      envelope: expect.objectContaining({startTimeMs: 0, endTimeMs: 5}),
      latest_start: expect.objectContaining({startTimeMs: 2, endTimeMs: 4})
    });
    expect(getTraceGraphSpanDetailSource(traceSource, spanRef)?.timings).toEqual({
      envelope: expect.objectContaining({startTimeMs: 0, endTimeMs: 5}),
      latest_start: expect.objectContaining({startTimeMs: 2, endTimeMs: 4})
    });
  });

  it('resolves span user data from canonical process sidecar tables', () => {
    const process = createProcess(
      {
        processId: 'rank-1',
        spans: [{spanId: 'rank-1-span-1', startTimeMs: 0, endTimeMs: 1}]
      },
      0
    );
    const spanTable = buildArrowTraceSpanTableFromColumns({
      process_ref: [encodeProcessRef(0)],
      span_id: ['rank-1-span-1'],
      thread_id: ['rank-1-thread'],
      name: ['rank-1-span-1'],
      source: [null],
      primary_timing_key: ['primary'],
      status: ['finished'],
      start_time_ms: [0],
      end_time_ms: [1],
      duration_ms: [1]
    });
    const resolvedSameProcessDependencyTable = buildArrowTraceSameProcessDependencyTable([]);
    const traceSource = {
      ...createArrowAccessorSource(
        buildJSONTrace([process], [], {name: 'chunk-sidecar-user-data'})
      ),
      spanSidecarTableMap: {
        ['rank-1' as TraceProcessId]: buildArrowTraceSpanSidecarTableFromColumns({
          rowCount: 1,
          userDataJson: ['{"span_id":"process-sidecar-span"}']
        })
      },
      chunks: [
        {
          chunkIndex: 0,
          chunkRef: encodeChunkRef(0),
          chunkKey: 'chunk-rank-1',
          processRefs: [encodeProcessRef(0)],
          processId: 'rank-1' as TraceProcessId,
          spanTable,
          resolvedSameProcessDependencyTable,
          spanSidecarTable: buildArrowTraceSpanSidecarTableFromColumns({
            rowCount: 1,
            userDataJson: ['{"span_id":"chunk-sidecar-span"}']
          })
        }
      ]
    };

    expect(getTraceGraphSpanUserData(traceSource, encodeSpanRef(0, 0))).toEqual({
      span_id: 'process-sidecar-span'
    });
    expect(getTraceGraphSpanDetailSource(traceSource, encodeSpanRef(0, 0))?.userData).toEqual({
      span_id: 'process-sidecar-span'
    });
  });

  it('resolves span keywords from chunk sidecar tables for ref-native color schemes', () => {
    const process = createProcess(
      {
        processId: 'rank-1',
        spans: [{spanId: 'rank-1-span-1', startTimeMs: 0, endTimeMs: 1}]
      },
      0
    );
    const spanTable = buildArrowTraceSpanTableFromColumns({
      process_ref: [encodeProcessRef(0)],
      span_id: ['rank-1-span-1'],
      thread_id: ['rank-1-thread'],
      name: ['rank-1-span-1'],
      source: [null],
      primary_timing_key: ['primary'],
      status: ['finished'],
      start_time_ms: [0],
      end_time_ms: [1],
      duration_ms: [1]
    });
    const resolvedSameProcessDependencyTable = buildArrowTraceSameProcessDependencyTable([]);
    const spanSidecarTable = buildArrowTraceSpanSidecarTableFromColumns({
      rowCount: 1,
      keywords: [['ATTN', 'SUBMIT']],
      crossProcessEndpointId: [null],
      userDataJson: [null]
    });
    const traceSource = {
      ...createArrowAccessorSource(buildJSONTrace([process], [], {name: 'chunk-sidecar-keywords'})),
      spanSidecarTableMap: {['rank-1' as TraceProcessId]: spanSidecarTable},
      chunks: [
        {
          chunkIndex: 0,
          chunkRef: encodeChunkRef(0),
          chunkKey: 'chunk-rank-1',
          processRefs: [encodeProcessRef(0)],
          processId: 'rank-1' as TraceProcessId,
          spanTable,
          resolvedSameProcessDependencyTable,
          spanSidecarTable
        }
      ]
    };

    expect(getArrowTraceSpanField(traceSource, encodeSpanRef(0, 0), 'keywords')).toEqual([
      'ATTN',
      'SUBMIT'
    ]);
    expect(getTraceGraphSpanDetailSource(traceSource, encodeSpanRef(0, 0))?.keywords).toEqual([
      'ATTN',
      'SUBMIT'
    ]);
  });

  it('resolves packed span indexes above the previous 16-bit row-index limit', () => {
    const graph = createGraph('arrow-large-row-index', [
      {
        processId: 'rank-1',
        spans: Array.from({length: 65_537}, (_, rowIndex) => ({
          spanId: `rank-1-span-${rowIndex}`,
          startTimeMs: rowIndex,
          endTimeMs: rowIndex + 1
        }))
      }
    ]);
    const traceSource = createArrowGraphWithoutCompatibilityBlocks(graph);
    const spanIndex = encodeSpanRef(0, 65_536);

    expect(spanIndex).not.toBeNull();
    expect(getArrowTraceSpanField(traceSource, spanIndex!, 'spanId')).toBe('rank-1-span-65536');
  }, 15_000);
});

/**
 * Builds a small normalized graph with deterministic process-local span ordering.
 */
function createGraph(
  name: string,
  processSpecs: ReadonlyArray<{
    processId: string;
    spans: ReadonlyArray<{
      spanId: string;
      startTimeMs: number;
      endTimeMs: number;
      source?: string;
    }>;
  }>
): JSONTrace {
  return buildJSONTrace(
    processSpecs.map((processSpec, index) => createProcess(processSpec, index)),
    [],
    {name}
  );
}

/**
 * Builds one process with a single thread and the requested spans.
 */
function createProcess(
  processSpec: {
    processId: string;
    spans: ReadonlyArray<{
      spanId: string;
      startTimeMs: number;
      endTimeMs: number;
      source?: string;
    }>;
  },
  index: number
): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: `${processSpec.processId}-thread`,
    threadId: `${processSpec.processId}-thread` as TraceThreadId,
    processId: processSpec.processId
  };
  const spans = processSpec.spans.map(blockSpec => createBlock(blockSpec, thread));

  return {
    type: 'trace-process',
    processId: processSpec.processId,
    name: processSpec.processId,
    rankNum: index,
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
    sameProcessDependencies: [],
    remoteDependencies: []
  } satisfies TraceProcess;
}

/**
 * Builds one span with a single finished timing projection.
 */
function createBlock(
  blockSpec: {
    spanId: string;
    startTimeMs: number;
    endTimeMs: number;
    source?: string;
  },
  thread: TraceThread
): TraceSpan {
  return {
    type: 'trace-span',
    spanId: blockSpec.spanId as TraceSpanId,
    threadId: thread.threadId,
    processName: thread.processId,
    name: blockSpec.spanId,
    keywords: [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: blockSpec.startTimeMs,
        endTimeMs: blockSpec.endTimeMs,
        durationMs: blockSpec.endTimeMs - blockSpec.startTimeMs,
        durationMsAsString: `${blockSpec.endTimeMs - blockSpec.startTimeMs}ms`
      }
    },
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: [],
    ...(blockSpec.source ? {userData: {source: blockSpec.source}} : {})
  };
}

/**
 * Builds the narrow Arrow accessor source carried by one canonical dataset fixture.
 */
function createArrowAccessorSource(graph: JSONTrace) {
  const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
  return {
    ...traceDataset,
    processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex
  };
}

/** Builds an Arrow accessor source whose process metadata omits compatibility span storage. */
function createArrowGraphWithoutCompatibilityBlocks(graph: JSONTrace) {
  return createArrowAccessorSource(graph);
}
