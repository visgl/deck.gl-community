import {describe, expect, it, vi} from 'vitest';

import {type TraceProcessId, type TraceSpanArrowSidecarRow} from './index';
import {
  buildArrowTraceLocalDependencyTable,
  buildArrowTraceSpanTableFromColumns,
  buildTraceGraphData,
  buildTraceGraphDataFromJSONTrace,
  buildTraceSpanTablesByProcessId,
  toArrowTraceProcessMetadata
} from './ingestion/arrow-trace';
import {buildJSONTrace, materializeJSONTrace} from './ingestion/json-trace';
import {
  getActiveTraceGraphSpanDisplaySource,
  getActiveTraceGraphSpanGeometrySource,
  getArrowTraceSpanField,
  getArrowTraceSpanMaterializationCount,
  getArrowTraceSpanRow,
  getTraceGraphProcessSpanCount,
  getTraceGraphSpanCount,
  getTraceGraphSpanDisplaySource,
  getTraceGraphSpanGeometrySource,
  getTraceGraphSpanRenderSource,
  getTraceGraphSpanUserData,
  iterateMaterializedTraceGraphProcessSpans,
  iterateMaterializedTraceGraphSpans,
  materializeTraceGraphSpanByRef,
  resetArrowTraceSpanMaterializationCount
} from './trace-graph-accessors';
import {
  encodeChunkRef,
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  encodeProcessRef,
  encodeSpanRef
} from './trace-graph/trace-id-encoder';

import type {JSONTrace} from './trace-graph';
import type {
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceSpanTiming,
  TraceThread,
  TraceThreadId
} from './trace-graph/trace-types';

describe('trace-graph-accessors', () => {
  it('matches process-order span iteration and lookup for Arrow-converted graphs', () => {
    const graph = createGraph('plain-accessors', [
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
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);

    expect(
      Array.from(iterateMaterializedTraceGraphSpans(traceGraphData)).map(span => span.spanId)
    ).toEqual(['rank-1-span-1', 'rank-1-span-2', 'rank-2-span-1']);
    expect(
      Array.from(iterateMaterializedTraceGraphProcessSpans(traceGraphData, 'rank-1')).map(
        span => span.spanId
      )
    ).toEqual(['rank-1-span-1', 'rank-1-span-2']);
    expect(materializeTraceGraphSpanByRef(traceGraphData, encodeSpanRef(0, 1))).toMatchObject(
      materializeJSONTrace(graph).spanMap['rank-1-span-2' as TraceSpanId]!
    );
    expect(getTraceGraphSpanCount(traceGraphData)).toBe(3);
    expect(getTraceGraphProcessSpanCount(traceGraphData, 'rank-2')).toBe(1);
  });

  it('materializes spans from Arrow tables when compatibility span storage is absent', () => {
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
    const traceGraphData = createArrowGraphWithoutCompatibilityBlocks(graph);

    expect('spanMap' in traceGraphData).toBe(false);
    expect(traceGraphData.processes.every(process => !('spans' in process))).toBe(true);
    expect(traceGraphData.processes.every(process => !('spanMap' in process))).toBe(true);
    expect(
      Array.from(iterateMaterializedTraceGraphSpans(traceGraphData)).map(span => span.spanId)
    ).toEqual(['rank-1-span-1', 'rank-1-span-2', 'rank-2-span-1']);
    expect(
      Array.from(iterateMaterializedTraceGraphProcessSpans(traceGraphData, 'rank-2')).map(
        span => span.spanId
      )
    ).toEqual(['rank-2-span-1']);
    resetArrowTraceSpanMaterializationCount();
    const spanIndex = encodeSpanRef(0, 1);
    expect(spanIndex).not.toBeNull();
    expect(getTraceGraphSpanGeometrySource(traceGraphData, spanIndex)).toMatchObject({
      spanId: 'rank-1-span-2',
      threadId: 'rank-1-thread',
      primaryTimingKey: 'primary'
    });
    expect(getTraceGraphSpanDisplaySource(traceGraphData, spanIndex)).toMatchObject({
      spanId: 'rank-1-span-2',
      source: 'worker-trace.json',
      name: 'rank-1-span-2',
      processName: 'rank-1',
      threadId: 'rank-1-thread'
    });
    expect(getArrowTraceSpanMaterializationCount()).toBe(0);

    const span = materializeTraceGraphSpanByRef(traceGraphData, encodeSpanRef(0, 1));
    expect(span).toMatchObject({
      spanId: 'rank-1-span-2',
      name: 'rank-1-span-2',
      processName: 'rank-1'
    });
    expect(getArrowTraceSpanMaterializationCount()).toBe(1);
    expect(materializeTraceGraphSpanByRef(traceGraphData, encodeSpanRef(0, 1))).not.toBe(span);
    expect(getArrowTraceSpanField(traceGraphData, 'rank-1-span-2' as TraceSpanId, 'name')).toBe(
      'rank-1-span-2'
    );
    expect(getArrowTraceSpanField(traceGraphData, 'rank-1-span-2' as TraceSpanId, 'source')).toBe(
      'worker-trace.json'
    );
    expect(
      getArrowTraceSpanField(traceGraphData, 'rank-1-span-2' as TraceSpanId, 'durationMs')
    ).toBe(2);
    expect(getArrowTraceSpanRow(traceGraphData, 'rank-1-span-2' as TraceSpanId)).toMatchObject({
      spanId: 'rank-1-span-2',
      source: 'worker-trace.json',
      name: 'rank-1-span-2',
      processName: 'rank-1'
    });
    const reusableRow = {
      spanId: 'placeholder' as TraceSpanId,
      threadId: 'placeholder' as TraceThreadId,
      name: 'placeholder',
      source: null,
      processName: 'placeholder',
      primaryTimingKey: 'placeholder',
      status: 'finished' as const,
      startTimeMs: -1,
      endTimeMs: -1,
      durationMs: -1,
      durationMsAsString: '-1ms',
      keywords: []
    };
    expect(getArrowTraceSpanRow(traceGraphData, 'rank-1-span-2' as TraceSpanId, reusableRow)).toBe(
      reusableRow
    );
    expect(reusableRow).toMatchObject({
      spanId: 'rank-1-span-2',
      source: 'worker-trace.json',
      name: 'rank-1-span-2',
      processName: 'rank-1',
      durationMs: 2
    });
    expect(getTraceGraphSpanCount(traceGraphData)).toBe(3);
    expect(getTraceGraphProcessSpanCount(traceGraphData, 'rank-1')).toBe(2);
  });

  it('uses a runtime chunk resolver before searching graph chunks', () => {
    const graph = createGraph('runtime-chunk-resolver-accessors', [
      {
        processId: 'rank-1',
        spans: [
          {spanId: 'rank-1-span-1', startTimeMs: 0, endTimeMs: 5},
          {spanId: 'rank-1-span-2', startTimeMs: 6, endTimeMs: 8}
        ]
      }
    ]);
    const traceGraphData = createArrowGraphWithoutCompatibilityBlocks(graph);
    const resolvedChunk = traceGraphData.chunks[0]!;
    const spanRef = encodeSpanRef(resolvedChunk.chunkIndex, 1);
    const getChunkByRef = vi.fn(() => resolvedChunk);
    const registryBackedGraph = {
      ...traceGraphData,
      chunks: [],
      getChunkByRef
    } as typeof traceGraphData & {
      /** Resolve a span ref through a runtime chunk registry. */
      getChunkByRef: (ref: typeof spanRef) => typeof resolvedChunk | null;
    };

    expect(getTraceGraphSpanDisplaySource(registryBackedGraph, spanRef)?.spanId).toBe(
      'rank-1-span-2'
    );
    expect(getTraceGraphSpanGeometrySource(registryBackedGraph, spanRef)?.spanId).toBe(
      'rank-1-span-2'
    );
    expect(getArrowTraceSpanField(registryBackedGraph, spanRef, 'name')).toBe('rank-1-span-2');
    expect(getChunkByRef).toHaveBeenCalledWith(spanRef);

    const inactiveRegistryBackedGraph = {
      ...registryBackedGraph,
      spanRefs: []
    };
    expect(getTraceGraphSpanDisplaySource(inactiveRegistryBackedGraph, spanRef)).toBeNull();
    expect(getActiveTraceGraphSpanDisplaySource(inactiveRegistryBackedGraph, spanRef)?.spanId).toBe(
      'rank-1-span-2'
    );
    expect(
      getActiveTraceGraphSpanGeometrySource(inactiveRegistryBackedGraph, spanRef)?.spanId
    ).toBe('rank-1-span-2');
  });

  it('adds primary timing fallback without mutating frozen sidecar timing maps', () => {
    const graph = createGraph('frozen-sidecar-timings', [
      {
        processId: 'rank-1',
        spans: [{spanId: 'rank-1-span-1', startTimeMs: 0, endTimeMs: 5}]
      }
    ]);
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const sidecarRow = traceGraphData.spanSidecarMap?.['rank-1' as TraceProcessId]?.[0];
    expect(sidecarRow).toBeDefined();
    sidecarRow!.timings = Object.freeze({}) as Record<string, TraceSpanTiming>;

    const geometrySource = getTraceGraphSpanGeometrySource(traceGraphData, encodeSpanRef(0, 0));
    expect(geometrySource?.timings.primary).toMatchObject({
      startTimeMs: 0,
      endTimeMs: 5
    });
    expect(Object.keys(sidecarRow!.timings ?? {})).toEqual([]);

    const materializedSpan = materializeTraceGraphSpanByRef(traceGraphData, encodeSpanRef(0, 0));
    expect(materializedSpan?.timings.primary).toMatchObject({
      startTimeMs: 0,
      endTimeMs: 5
    });
    expect(Object.keys(sidecarRow!.timings ?? {})).toEqual([]);
  });

  it('resolves span user data from chunk sidecar rows before process sidecar fallback', () => {
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
    const localDependencyTable = buildArrowTraceLocalDependencyTable([]);
    const traceGraphData = buildTraceGraphData({
      name: 'chunk-sidecar-user-data',
      processes: [process],
      crossDependencies: [],
      spanTableMap: {['rank-1' as TraceProcessId]: spanTable},
      localDependencyTableMap: {['rank-1' as TraceProcessId]: localDependencyTable},
      spanSidecarMap: {
        ['rank-1' as TraceProcessId]: [createSidecarRow({span_id: 'process-sidecar-span'})]
      },
      chunks: [
        {
          chunkIndex: 0,
          chunkRef: encodeChunkRef(0),
          chunkKey: 'chunk-rank-1',
          processRefs: [encodeProcessRef(0)],
          processId: 'rank-1' as TraceProcessId,
          spanTable,
          localDependencyTable,
          spanSidecarRows: [createSidecarRow({span_id: 'chunk-sidecar-span'})]
        }
      ]
    });

    expect(getTraceGraphSpanUserData(traceGraphData, encodeSpanRef(0, 0))).toEqual({
      span_id: 'chunk-sidecar-span'
    });
    expect(getTraceGraphSpanDisplaySource(traceGraphData, encodeSpanRef(0, 0))?.userData).toEqual({
      span_id: 'chunk-sidecar-span'
    });
  });

  it('materializes local dependencies using directional compact sidecar refs', () => {
    const dependencyId = 'local-dep-1' as TraceLocalDependency['dependencyId'];
    const incomingDependencyId = 'local-dep-2' as TraceLocalDependency['dependencyId'];
    const thread: TraceThread = {
      type: 'trace-thread',
      name: 'rank-1-thread',
      threadId: 'rank-1-thread' as TraceThreadId,
      processId: 'rank-1'
    };
    const rootBlock = createBlock(
      {
        spanId: 'root-span',
        startTimeMs: 0,
        endTimeMs: 10
      },
      thread
    );
    const middleBlock = createBlock(
      {
        spanId: 'middle-span',
        startTimeMs: 11,
        endTimeMs: 12
      },
      thread
    );
    const leafBlock = createBlock(
      {
        spanId: 'leaf-span',
        startTimeMs: 13,
        endTimeMs: 14
      },
      thread
    );
    const dependency: TraceLocalDependency = {
      type: 'trace-local-dependency',
      dependencyId,
      startSpanId: rootBlock.spanId,
      endSpanId: middleBlock.spanId,
      keywords: new Set(['CHAIN']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    };
    const incomingDependency: TraceLocalDependency = {
      type: 'trace-local-dependency',
      dependencyId: incomingDependencyId,
      startSpanId: middleBlock.spanId,
      endSpanId: leafBlock.spanId,
      keywords: new Set(['CHAIN']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    };
    const process: TraceProcess = {
      type: 'trace-process',
      processId: 'rank-1',
      name: 'rank-1',
      rankNum: 0,
      stepNum: 0,
      threads: [thread],
      threadMap: {[thread.threadId]: thread},
      spans: [rootBlock, middleBlock, leafBlock],
      spanMap: {
        [rootBlock.spanId]: rootBlock,
        [middleBlock.spanId]: middleBlock,
        [leafBlock.spanId]: leafBlock
      },
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      localDependencies: [dependency, incomingDependency],
      remoteDependencies: []
    };
    const graph: JSONTrace = buildJSONTrace([process], [], {
      name: 'sidecar-ref-accessor-regression'
    });
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const processId: TraceProcessId = 'rank-1' as TraceProcessId;
    const sidecarRows = traceGraphData.spanSidecarMap?.[processId];
    expect(sidecarRows?.[0]?.outgoingLocalDependencyRowIndexes).toEqual([0]);
    expect(sidecarRows?.[0]?.incomingLocalDependencyRowIndexes).toEqual([]);
    expect(sidecarRows?.[1]?.incomingLocalDependencyRowIndexes).toEqual([0]);
    expect(sidecarRows?.[1]?.outgoingLocalDependencyRowIndexes).toEqual([1]);
    expect(sidecarRows?.[2]?.incomingLocalDependencyRowIndexes).toEqual([1]);
    expect(sidecarRows?.[2]?.outgoingLocalDependencyRowIndexes).toEqual([]);

    expect(sidecarRows?.[0]?.incomingLocalDependencyRefs).toEqual([]);
    expect(sidecarRows?.[0]?.outgoingLocalDependencyRefs).toEqual([
      encodeLocalDependencyRef(encodeLocalSpanRef(0, 0))
    ]);
    expect(sidecarRows?.[1]?.incomingLocalDependencyRefs).toEqual([
      encodeLocalDependencyRef(encodeLocalSpanRef(0, 0))
    ]);
    expect(sidecarRows?.[1]?.outgoingLocalDependencyRefs).toEqual([
      encodeLocalDependencyRef(encodeLocalSpanRef(0, 1))
    ]);
    expect(sidecarRows?.[2]?.incomingLocalDependencyRefs).toEqual([
      encodeLocalDependencyRef(encodeLocalSpanRef(0, 1))
    ]);
    expect(sidecarRows?.[2]?.outgoingLocalDependencyRefs).toEqual([]);

    sidecarRows?.forEach((row: TraceSpanArrowSidecarRow) => {
      row.localDependencyIds = [];
    });

    const middle = materializeTraceGraphSpanByRef(traceGraphData, encodeSpanRef(0, 1));

    expect(middle?.localDependencyIds).toEqual([dependencyId, incomingDependencyId]);
    expect(
      middle?.localDependencies
        .filter((entry): entry is TraceLocalDependency => entry.type === 'trace-local-dependency')
        .map(entry => entry.dependencyId)
    ).toEqual([dependencyId, incomingDependencyId]);
    expect(
      getTraceGraphSpanDisplaySource(traceGraphData, encodeSpanRef(0, 1))?.localDependencyIds
    ).toEqual([dependencyId, incomingDependencyId]);
    const localDependencyTable = traceGraphData.localDependencyTableMap[processId]!;
    const originalGetChild = localDependencyTable.getChild.bind(localDependencyTable);
    const renderSourceGetChildSpy = vi
      .spyOn(localDependencyTable, 'getChild')
      .mockImplementation(columnName => {
        if (columnName === 'dependencyId') {
          throw new Error('Unexpected dependency id expansion for render source');
        }
        return originalGetChild(columnName);
      });
    const renderSource = getTraceGraphSpanRenderSource(traceGraphData, encodeSpanRef(0, 1));
    expect(renderSource).toMatchObject({
      spanId: middleBlock.spanId,
      name: middleBlock.name
    });
    expect(renderSource).not.toHaveProperty('localDependencyIds');
    renderSourceGetChildSpy.mockRestore();
    const leaf = materializeTraceGraphSpanByRef(traceGraphData, encodeSpanRef(0, 2));
    expect(leaf?.localDependencies.map(item => item.dependencyId)).toEqual([incomingDependencyId]);

    sidecarRows?.forEach(row => {
      row.incomingLocalDependencyRefs = [...row.incomingLocalDependencyRowIndexes];
      row.outgoingLocalDependencyRefs = [...row.outgoingLocalDependencyRowIndexes];
    });
    expect(sidecarRows?.[0]?.incomingLocalDependencyRefs?.[0]).toBeUndefined();
    expect(sidecarRows?.[2]?.outgoingLocalDependencyRefs).toEqual([]);
    const getChildSpy = vi
      .spyOn(localDependencyTable, 'getChild')
      .mockImplementation(columnName => {
        if (columnName === 'startSpanId' || columnName === 'endSpanId') {
          throw new Error(`Unexpected whole-table scan for ${String(columnName)}`);
        }
        return originalGetChild(columnName);
      });

    const tableBackedMiddle = materializeTraceGraphSpanByRef(traceGraphData, encodeSpanRef(0, 1));
    expect(tableBackedMiddle?.localDependencyIds).toEqual([dependencyId, incomingDependencyId]);

    const legacySidecarGraph = {
      ...traceGraphData,
      spanSidecarTableMap: undefined
    };
    const fallbackMiddle = materializeTraceGraphSpanByRef(legacySidecarGraph, encodeSpanRef(0, 1));
    expect(fallbackMiddle?.localDependencyIds).toEqual([dependencyId, incomingDependencyId]);
    getChildSpy.mockRestore();
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
    const traceGraphData = createArrowGraphWithoutCompatibilityBlocks(graph);
    const spanIndex = encodeSpanRef(0, 65_536);

    expect(spanIndex).not.toBeNull();
    expect(getArrowTraceSpanField(traceGraphData, spanIndex!, 'spanId')).toBe('rank-1-span-65536');
    expect(getArrowTraceSpanRow(traceGraphData, spanIndex!)).toMatchObject({
      spanId: 'rank-1-span-65536',
      name: 'rank-1-span-65536',
      processName: 'rank-1'
    });
  });
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
    localDependencies: [],
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
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: [],
    ...(blockSpec.source ? {userData: {source: blockSpec.source}} : {})
  };
}

/**
 * Builds one complete Arrow span sidecar row for accessor tests.
 */
function createSidecarRow(userData: Record<string, unknown>): TraceSpanArrowSidecarRow {
  return {
    userData,
    keywords: [],
    localDependencyIds: [],
    incomingLocalDependencyRowIndexes: [],
    outgoingLocalDependencyRowIndexes: [],
    incomingLocalDependencyRefs: [],
    outgoingLocalDependencyRefs: [],
    incomingCrossDependencyRefs: [],
    outgoingCrossDependencyRefs: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}

/**
 * Builds an Arrow graph that preserves span tables while dropping compatibility span storage.
 */
function createArrowGraphWithoutCompatibilityBlocks(graph: JSONTrace) {
  const materializedGraph = materializeJSONTrace(graph);
  const spanTableMap = buildTraceSpanTablesByProcessId(materializedGraph.processes);

  return buildTraceGraphData({
    name: materializedGraph.name,
    processes: materializedGraph.processes.map(toArrowTraceProcessMetadata),
    crossDependencies: materializedGraph.crossDependencies,
    spanTableMap: spanTableMap as Record<TraceProcessId, (typeof spanTableMap)[TraceProcessId]>,
    timeExtents: {
      minTimeMs: materializedGraph.minTimeMs,
      maxTimeMs: materializedGraph.maxTimeMs
    },
    stats: materializedGraph.stats
  });
}
