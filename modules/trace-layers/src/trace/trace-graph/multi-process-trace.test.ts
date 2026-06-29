import {describe, expect, it} from 'vitest';

import {buildArrowTraceSpanTableFromRows} from '../ingestion/arrow-trace';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {
  multiProcessTrace_addProcessData,
  multiProcessTrace_buildTraceGraphData,
  multiProcessTrace_create,
  multiProcessTrace_getTraceGraph,
  multiProcessTrace_removeProcessData,
  multiProcessTrace_updateCrossDependencies,
  multiProcessTrace_updateProcessList,
  multiProcessTrace_updateTraceGraph
} from './multi-process-trace';
import {TraceGraph} from './trace-graph';
import {
  encodeChunkRef,
  encodeCrossDependencyRef,
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  encodeSpanRef,
  getSpanRefChunkIndex,
  getSpanRefRowIndex
} from './trace-id-encoder';

import type {
  ArrowTraceProcessMetadata,
  TraceSpanArrowRow,
  TraceSpanArrowSidecarRow
} from '../ingestion/arrow-trace';
import type {MultiProcessTrace, MultiProcessTraceProcessData} from './multi-process-trace';
import type {
  SpanRef,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceLocalDependency,
  TraceProcessId,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from './trace-types';

function createTestTraceGraph(
  traceGraphData: Parameters<typeof createStaticTraceGraphRuntimeSource>[0]['traceGraphData'],
  options?: ConstructorParameters<typeof TraceGraph>[1]
): TraceGraph {
  return new TraceGraph(
    createStaticTraceGraphRuntimeSource({
      identityKey: `${traceGraphData.name}:test`,
      traceGraphData
    }),
    options
  );
}

describe('multi-process-trace', () => {
  it('creates an empty trace and updates the available process list', () => {
    const trace = multiProcessTrace_updateProcessList(multiProcessTrace_create({name: 'empty'}), [
      'rank-5',
      'rank-9'
    ]);

    expect(trace.allProcessKeys).toEqual(['rank-5', 'rank-9']);
    expect(trace.loadedProcessKeys).toEqual([]);
    expect(trace.traceGraphData).toBeNull();
    expect(trace.traceGraph).toBeNull();
    expect(multiProcessTrace_buildTraceGraphData(trace)).toBeNull();
  });

  it('appends processes, reuses rank-local span tables, and rebases local span refs', () => {
    let trace = multiProcessTrace_create({name: 'sparse-ranks'});
    trace = addProcess(trace, {
      ...createProcessData(processId('rank-5'), ['rank-5-a', 'rank-5-b']),
      chunkKey: 'chunk-rank-5'
    });
    const firstChunk = trace.traceGraphData?.chunks[0];
    trace = addProcess(trace, {
      ...createProcessData(
        processId('rank-9'),
        ['rank-9-a', 'rank-9-b'],
        [createLocalDependency('local-rank-9', 'rank-9-a', 'rank-9-b')]
      ),
      chunkKey: 'chunk-rank-9'
    });

    expect(trace.traceGraphData?.processIdsByIndex).toEqual(['rank-5', 'rank-9']);
    expect(trace.traceGraphData?.chunks.map(chunk => chunk.chunkKey)).toEqual([
      'chunk-rank-5',
      'chunk-rank-9'
    ]);
    expect(trace.traceGraphData?.chunks.map(chunk => chunk.chunkRef)).toEqual([
      encodeChunkRef(0),
      encodeChunkRef(1)
    ]);
    expect(trace.traceGraphData?.chunks[0]).toBe(firstChunk);
    expect(trace.traceGraphData?.processSpanTableMap['rank-9' as TraceProcessId].numRows).toBe(2);
    expect(trace.traceGraph?.processIdsByIndex).toEqual(['rank-5', 'rank-9']);
    expect(trace.traceGraph?.chunks.map(chunk => chunk.chunkKey)).toEqual([
      'chunk-rank-5',
      'chunk-rank-9'
    ]);
    expect(multiProcessTrace_getTraceGraph(trace)?.stats.spanCount).toBe(4);

    const dependency = trace.traceGraphData?.processes[1]?.localDependencies?.[0];
    expect(dependency?.startSpanRef).toBeDefined();
    expect(getSpanRefChunkIndex(dependency!.startSpanRef!)).toBe(1);
    expect(getSpanRefRowIndex(dependency!.startSpanRef!)).toBe(0);
    expect(getSpanRefChunkIndex(dependency!.endSpanRef!)).toBe(1);
    expect(getSpanRefRowIndex(dependency!.endSpanRef!)).toBe(1);
  });

  it('keeps incremental and rebuilt time extents aligned for placeholder span timings', () => {
    const firstProcessId = processId('rank-time-0');
    const secondProcessId = processId('rank-time-1');
    let trace = multiProcessTrace_create({name: 'time-extents'});
    trace = addProcess(
      trace,
      createProcessDataFromSpanRows(firstProcessId, [
        {
          ...createSpanRow('rank-time-0-finished', firstProcessId, 0),
          start_time_ms: 10,
          end_time_ms: 20,
          duration_ms: 10
        }
      ])
    );
    trace = addProcess(
      trace,
      createProcessDataFromSpanRows(secondProcessId, [
        {
          ...createSpanRow('rank-time-1-not-started', secondProcessId, 0),
          status: 'not-started',
          start_time_ms: 0,
          end_time_ms: 0,
          duration_ms: 0
        },
        {
          ...createSpanRow('rank-time-1-zero-start', secondProcessId, 1),
          start_time_ms: 0,
          end_time_ms: 200,
          duration_ms: 200
        },
        {
          ...createSpanRow('rank-time-1-unfinished', secondProcessId, 2),
          status: 'not-finished',
          start_time_ms: 25,
          end_time_ms: 0,
          duration_ms: 0
        },
        {
          ...createSpanRow('rank-time-1-finished', secondProcessId, 3),
          start_time_ms: 40,
          end_time_ms: 50,
          duration_ms: 10
        }
      ])
    );

    const rebuiltTraceGraphData = multiProcessTrace_buildTraceGraphData(trace);

    expect(trace.traceGraphData?.minTimeMs).toBe(10);
    expect(trace.traceGraphData?.maxTimeMs).toBe(50);
    expect(trace.traceGraphData?.stats.spanCount).toBe(5);
    expect(rebuiltTraceGraphData?.minTimeMs).toBe(trace.traceGraphData?.minTimeMs);
    expect(rebuiltTraceGraphData?.maxTimeMs).toBe(trace.traceGraphData?.maxTimeMs);
  });

  it('supports ref-native dependencies without exposing a spanLocationMap', () => {
    const endpointId = 'endpoint-no-map' as TraceCrossProcessEndpointId;
    let trace = multiProcessTrace_create({name: 'no-span-location-map'});
    trace = addProcessWithoutSpanLocationMap(
      trace,
      createProcessData(
        processId('rank-0'),
        ['rank-0-a'],
        [],
        [createEndpointWithSpanRef(endpointId, 'rank-0-a', 0, encodeSpanRef(0, 0))]
      )
    );
    trace = addProcessWithoutSpanLocationMap(
      trace,
      createProcessData(
        processId('rank-1'),
        ['rank-1-a', 'rank-1-b'],
        [createLocalDependency('local-rank-1', 'rank-1-a', 'rank-1-b')],
        [createEndpointWithSpanRef(endpointId, 'rank-1-a', 1, encodeSpanRef(0, 0))]
      )
    );

    expect('spanLocationMap' in trace.traceGraphData!).toBe(false);
    expect(
      trace.traceGraphData?.localDependencyTableMap[processId('rank-1')]
        ?.getChild('startSpanRef')
        ?.get(0)
    ).toBe(encodeSpanRef(1, 0));
    expect(
      trace.traceGraphData?.localDependencyTableMap[processId('rank-1')]
        ?.getChild('dependencyRef')
        ?.get(0)
    ).toBe(encodeLocalDependencyRef(encodeLocalSpanRef(1, 0)));
    expect(
      trace.traceGraph?.getDependencyStartSpan(encodeLocalDependencyRef(encodeLocalSpanRef(1, 0)))
    ).toBe(encodeSpanRef(1, 0));
    expect(
      trace.traceGraph?.getDependencyEndSpan(encodeLocalDependencyRef(encodeLocalSpanRef(1, 0)))
    ).toBe(encodeSpanRef(1, 1));
    expect(trace.traceGraph?.getDependencyStartSpan(encodeCrossDependencyRef(0))).toBe(
      encodeSpanRef(0, 0)
    );
    expect(trace.traceGraph?.getDependencyEndSpan(encodeCrossDependencyRef(0))).toBe(
      encodeSpanRef(1, 0)
    );
    expect(trace.traceGraph?.getSpanRefByExternalBlockId('rank-1-a' as TraceSpanId)).toBe(
      encodeSpanRef(1, 0)
    );
  });

  it('keeps no-filter prepared state as an empty sentinel when appending a process', () => {
    let trace = multiProcessTrace_create({name: 'trace-graph-state'});
    trace = addProcess(trace, createProcessData(processId('rank-0'), ['rank-0-a']));
    const firstPreparedState = trace.traceGraphPreparedState;

    trace = addProcess(trace, createProcessData(processId('rank-1'), ['rank-1-a']));

    expect(trace.traceGraph).not.toBeNull();
    expect(trace.traceGraphNeedsUpdate).toBe(false);
    expect(trace.traceGraphPreparedState.filteredSpanRefs.size).toBe(0);
    expect(trace.traceGraphPreparedState.processSpanTableMap).toBeUndefined();
    expect(trace.traceGraphPreparedState).not.toBe(firstPreparedState);
    expect(
      trace.traceGraph?.processSpanTableMap[processId('rank-0')]?.getChild('filter_mask')?.get(0)
    ).toBe(0);
  });

  it('returns a new top-level trace object for every state-changing update', () => {
    const emptyTrace = multiProcessTrace_create({name: 'immutable'});

    const listedTrace = multiProcessTrace_updateProcessList(emptyTrace, ['rank-0']);
    expect(listedTrace).not.toBe(emptyTrace);
    expect(emptyTrace.allProcessKeys).toEqual([]);
    expect(listedTrace.allProcessKeys).toEqual(['rank-0']);

    const firstProcessTrace = addProcess(
      listedTrace,
      createProcessData(processId('rank-0'), ['rank-0-a'])
    );
    expect(firstProcessTrace).not.toBe(listedTrace);
    expect(listedTrace.loadedProcessKeys).toEqual([]);
    expect(firstProcessTrace.loadedProcessKeys).toEqual(['rank-0']);

    const removedTrace = multiProcessTrace_removeProcessData(firstProcessTrace, 'rank-0');
    expect(removedTrace).not.toBe(firstProcessTrace);
    expect(firstProcessTrace.loadedProcessKeys).toEqual(['rank-0']);
    expect(removedTrace.loadedProcessKeys).toEqual([]);

    const rebuiltTrace = multiProcessTrace_updateCrossDependencies(removedTrace);
    expect(rebuiltTrace).not.toBe(removedTrace);
    expect(removedTrace.traceGraphDataNeedsUpdate).toBe(true);
    expect(rebuiltTrace.traceGraphDataNeedsUpdate).toBe(false);

    const traceGraphRefreshInput = {
      ...firstProcessTrace,
      traceGraphNeedsUpdate: true,
      traceGraph: null
    };
    const traceGraphRefreshTrace = multiProcessTrace_updateTraceGraph(traceGraphRefreshInput);
    expect(traceGraphRefreshTrace).not.toBe(traceGraphRefreshInput);
    expect(traceGraphRefreshInput.traceGraph).toBeNull();
    expect(traceGraphRefreshTrace.traceGraph).toBeInstanceOf(TraceGraph);
  });

  it('constructs an equivalent TraceGraph from prepared no-filter state', () => {
    const trace = addProcess(
      multiProcessTrace_create({name: 'prepared-constructor'}),
      createProcessData(processId('rank-0'), ['rank-0-a', 'rank-0-b'])
    );
    const traceGraphData = trace.traceGraphData;
    expect(traceGraphData).not.toBeNull();

    const traceGraph = createTestTraceGraph(traceGraphData!, {
      preparedState: trace.traceGraphPreparedState
    });

    expect(traceGraph.stats.spanCount).toBe(trace.traceGraph?.stats.spanCount);
    expect(traceGraph.filteredSpanRefs).toBe(trace.traceGraphPreparedState.filteredSpanRefs);
    expect(traceGraph.processSpanTableMap).toBe(traceGraphData!.processSpanTableMap);
    expect(traceGraph.spanIsFiltered(encodeSpanRef(0, 0))).toBe(false);
  });

  it('incrementally adds cross-process dependencies from matching endpoint groups', () => {
    const endpointId = 'endpoint-rpc' as TraceCrossProcessEndpointId;
    const firstTrace = addProcess(
      multiProcessTrace_create({name: 'cross-deps'}),
      createProcessData(
        processId('rank-0'),
        ['rank-0-a'],
        [createLocalDependency('local-rank-0', 'rank-0-a', 'rank-0-a')],
        [createEndpoint(endpointId, 'rank-0-a', 0)]
      )
    );
    const firstDependencyMap = firstTrace.traceGraphData?.dependencyMap;

    const trace = addProcess(
      firstTrace,
      createProcessData(
        processId('rank-1'),
        ['rank-1-a'],
        [],
        [createEndpoint(endpointId, 'rank-1-a', 1)]
      )
    );

    expect(trace.traceGraphData?.dependencyMap).not.toBe(firstDependencyMap);
    expect(Object.keys(firstTrace.traceGraphData?.dependencyMap ?? {})).toHaveLength(1);
    expect(Object.keys(trace.traceGraphData?.dependencyMap ?? {})).toHaveLength(2);
    expect(trace.crossDependencies).toHaveLength(1);
    expect(trace.crossDependencies[0]).toMatchObject({
      endpointId,
      startSpanId: 'rank-0-a',
      endSpanId: 'rank-1-a'
    });
    expect(trace.traceGraphData?.crossDependencyTable.numRows).toBe(1);
    expect(trace.traceGraphData?.crossDependencies[0]?.startSpanRef).toBe(encodeSpanRef(0, 0));
    expect(trace.traceGraphData?.crossDependencies[0]?.endSpanRef).toBe(encodeSpanRef(1, 0));
  });

  it('does not expose span-id dependency adjacency when appending cross-process dependencies', () => {
    const endpointId = 'endpoint-rpc' as TraceCrossProcessEndpointId;
    const firstTrace = addProcess(
      addProcess(
        multiProcessTrace_create({name: 'cross-deps'}),
        createProcessData(
          processId('rank-0'),
          ['rank-0-a', 'rank-0-untouched'],
          [createLocalDependency('local-rank-0', 'rank-0-untouched', 'rank-0-untouched')],
          [createEndpoint(endpointId, 'rank-0-a', 0)]
        )
      ),
      createProcessData(
        processId('rank-1'),
        ['rank-1-a'],
        [],
        [createEndpoint(endpointId, 'rank-1-a', 1)]
      )
    );
    expect('blockDependencyMap' in firstTrace.traceGraphData!).toBe(false);

    const trace = addProcess(firstTrace, createProcessData(processId('rank-2'), ['rank-2-a']));

    expect('blockDependencyMap' in trace.traceGraphData!).toBe(false);
  });

  it('reuses cross-dependency Arrow artifacts when an append creates no cross-process dependencies', () => {
    const endpointId = 'endpoint-rpc' as TraceCrossProcessEndpointId;
    const firstTrace = addProcess(
      addProcess(
        multiProcessTrace_create({name: 'cross-deps'}),
        createProcessData(
          processId('rank-0'),
          ['rank-0-a'],
          [],
          [createEndpoint(endpointId, 'rank-0-a', 0)]
        )
      ),
      createProcessData(
        processId('rank-1'),
        ['rank-1-a'],
        [],
        [createEndpoint(endpointId, 'rank-1-a', 1)]
      )
    );
    const previousCrossDependencies = firstTrace.traceGraphData?.crossDependencies;
    const previousCrossDependencyTable = firstTrace.traceGraphData?.crossDependencyTable;
    const previousCrossDependencyIdToIndexMap =
      firstTrace.traceGraphData?.crossDependencyIdToIndexMap;

    const trace = addProcess(firstTrace, createProcessData(processId('rank-2'), ['rank-2-a']));

    expect(trace.crossDependencies).toBe(firstTrace.crossDependencies);
    expect(trace.traceGraphData?.crossDependencies).toBe(previousCrossDependencies);
    expect(trace.traceGraphData?.crossDependencyTable).toBe(previousCrossDependencyTable);
    expect(trace.traceGraphData?.crossDependencyIdToIndexMap).toBe(
      previousCrossDependencyIdToIndexMap
    );
    expect(trace.traceGraphData?.crossDependencyTable.numRows).toBe(1);
  });

  it('appends cross-dependency Arrow table batches when an append creates new cross-process dependencies', () => {
    const endpointId = 'endpoint-rpc' as TraceCrossProcessEndpointId;
    const firstTrace = addProcess(
      addProcess(
        multiProcessTrace_create({name: 'cross-deps'}),
        createProcessData(
          processId('rank-0'),
          ['rank-0-a'],
          [],
          [createEndpoint(endpointId, 'rank-0-a', 0)]
        )
      ),
      createProcessData(
        processId('rank-1'),
        ['rank-1-a'],
        [],
        [createEndpoint(endpointId, 'rank-1-a', 1)]
      )
    );
    const previousCrossDependencyTable = firstTrace.traceGraphData?.crossDependencyTable;
    const previousFirstBatch = previousCrossDependencyTable?.batches[0];
    const frozenAppendInput = {
      ...firstTrace,
      _crossProcessEndpointMap: Object.freeze({...(firstTrace._crossProcessEndpointMap ?? {})}),
      _crossDependencyMap: Object.freeze({...(firstTrace._crossDependencyMap ?? {})})
    } satisfies MultiProcessTrace;

    const trace = addProcess(
      frozenAppendInput,
      createProcessData(
        processId('rank-2'),
        ['rank-2-a'],
        [],
        [createEndpoint(endpointId, 'rank-2-a', 2)]
      )
    );

    expect(trace.traceGraphData?.crossDependencyTable).not.toBe(previousCrossDependencyTable);
    expect(trace.traceGraphData?.crossDependencyTable.batches[0]).toBe(previousFirstBatch);
    expectFlatRecord(trace.traceGraphData?.crossDependencyIdToIndexMap);
    expectFlatRecord(trace.traceGraphData?.dependencyMap);
    expect(trace._crossProcessEndpointMap?.[endpointId]).toHaveLength(3);
    expect(
      Object.prototype.hasOwnProperty.call(trace._crossProcessEndpointMap ?? {}, endpointId)
    ).toBe(true);
    expect(trace.traceGraphData?.crossDependencyTable.batches.length).toBeGreaterThan(
      previousCrossDependencyTable?.batches.length ?? 0
    );
    expect(trace.traceGraphData?.crossDependencyTable.numRows).toBe(3);
    expect(trace.crossDependencies).toHaveLength(3);
  });

  it('keeps append indexes flat across repeated cross-process dependency appends', () => {
    const endpointId = 'endpoint-rpc' as TraceCrossProcessEndpointId;
    let trace = multiProcessTrace_create({name: 'flat-append-indexes'});

    for (let rankIndex = 0; rankIndex < 6; rankIndex += 1) {
      trace = addProcess(
        trace,
        createProcessData(
          processId(`rank-${rankIndex}`),
          [`rank-${rankIndex}-a`],
          [],
          [createEndpoint(endpointId, `rank-${rankIndex}-a`, rankIndex)]
        )
      );
    }

    expectFlatRecord(trace._crossProcessEndpointMap);
    expectFlatRecord(trace._crossDependencyMap);
    expectFlatRecord(trace.traceGraphData?.crossDependencyIdToIndexMap);
    expectFlatRecord(trace.traceGraphData?.dependencyMap);
    expect(trace.crossDependencies).toHaveLength(15);
    expect(trace.traceGraphData?.crossDependencyTable.numRows).toBe(15);
  });

  it('resolves targeted cross-process endpoints without all-to-all rank pairing', () => {
    const endpointId = 'endpoint-rpc' as TraceCrossProcessEndpointId;
    const trace = addProcess(
      addProcess(
        addProcess(
          multiProcessTrace_create({name: 'targeted-cross-deps'}),
          createProcessData(
            processId('rank-0'),
            ['rank-0-a'],
            [],
            [
              createTargetedEndpoint(endpointId, 'rank-0-a', 0, 1),
              createTargetedEndpoint(endpointId, 'rank-0-a', 0, 2)
            ]
          )
        ),
        createProcessData(
          processId('rank-1'),
          ['rank-1-a'],
          [],
          [
            createTargetedEndpoint(endpointId, 'rank-1-a', 1, 0),
            createTargetedEndpoint(endpointId, 'rank-1-a', 1, 2)
          ]
        )
      ),
      createProcessData(
        processId('rank-2'),
        ['rank-2-a'],
        [],
        [createTargetedEndpoint(endpointId, 'rank-2-a', 2, 0)]
      )
    );

    expect(trace.crossDependencies).toHaveLength(2);
    expect(trace.crossDependencies.map(dependency => dependency.dependencyId).sort()).toEqual([
      'rank-0-a->rank-1-a',
      'rank-0-a->rank-2-a'
    ]);
  });

  it('suppresses same-process endpoint pairs', () => {
    const endpointId = 'endpoint-local-only' as TraceCrossProcessEndpointId;
    const trace = addProcess(
      multiProcessTrace_create({name: 'same-process'}),
      createProcessData(
        processId('rank-0'),
        ['rank-0-a', 'rank-0-b'],
        [],
        [createEndpoint(endpointId, 'rank-0-a', 0), createEndpoint(endpointId, 'rank-0-b', 0)]
      )
    );

    expect(trace.crossDependencies).toEqual([]);
    expect(trace.traceGraphData?.crossDependencyTable.numRows).toBe(0);
  });

  it('invalidates caches on remove and rebuilds the remaining process trace', () => {
    let trace = addProcess(
      addProcess(
        multiProcessTrace_create({name: 'remove'}),
        createProcessData(processId('rank-0'), ['rank-0-a'])
      ),
      createProcessData(processId('rank-1'), ['rank-1-a'])
    );

    trace = multiProcessTrace_removeProcessData(trace, 'rank-0');

    expect(trace.traceGraphData).toBeNull();
    expect(trace.traceGraph).toBeNull();
    expect(trace.traceGraphDataNeedsUpdate).toBe(true);
    expect(trace.traceGraphNeedsUpdate).toBe(true);
    expect(trace.crossDependenciesNeedUpdate).toBe(true);

    trace = multiProcessTrace_updateCrossDependencies(trace);

    expect(trace.loadedProcessKeys).toEqual(['rank-1']);
    expect(trace.traceGraphDataNeedsUpdate).toBe(false);
    expect(trace.traceGraphNeedsUpdate).toBe(false);
    expect(trace.traceGraphData?.processIdsByIndex).toEqual(['rank-1']);
    expect(trace.traceGraphData?.chunks.map(chunk => chunk.processId)).toEqual(['rank-1']);
    expect(trace.traceGraph?.processIdsByIndex).toEqual(['rank-1']);
    expect(trace.traceGraph?.chunks.map(chunk => chunk.processId)).toEqual(['rank-1']);
    expect(trace.traceGraph?.processSpanTableMap[processId('rank-0')]).toBeUndefined();
    expect(trace.traceGraphPreparedState.processSpanTableMap).toBeUndefined();
    expect(trace.traceGraph?.getSpanRefByExternalBlockId('rank-1-a' as TraceSpanId)).toBe(
      encodeSpanRef(0, 0)
    );
  });
});

function addProcess(
  trace: Readonly<MultiProcessTrace>,
  processData: MultiProcessTraceProcessData
): MultiProcessTrace {
  return multiProcessTrace_addProcessData(trace, processData.process.processId, processData, {
    createDependencyId: (startSpanId, endSpanId) =>
      `${startSpanId}->${endSpanId}` as TraceDependencyId
  });
}

function addProcessWithoutSpanLocationMap(
  trace: Readonly<MultiProcessTrace>,
  processData: MultiProcessTraceProcessData
): MultiProcessTrace {
  return multiProcessTrace_addProcessData(trace, processData.process.processId, processData, {
    createDependencyId: (startSpanId, endSpanId) =>
      `${startSpanId}->${endSpanId}` as TraceDependencyId
  });
}

function createProcessData(
  processId: TraceProcessId,
  spanIds: string[],
  localDependencies: TraceLocalDependency[] = [],
  endpoints: TraceCrossProcessEndpoint[] = []
): MultiProcessTraceProcessData {
  const spanRows = spanIds.map((spanId, rowIndex) => createSpanRow(spanId, processId, rowIndex));
  const sidecarRows = spanRows.map(() => createSidecarRow());
  return {
    process: createProcess(processId, localDependencies),
    spanTable: buildArrowTraceSpanTableFromRows(spanRows),
    spanSidecarRows: sidecarRows,
    crossProcessEndpointsByEndpointId: groupEndpointsById(endpoints)
  };
}

/** Builds one process fixture from explicit Arrow span rows. */
function createProcessDataFromSpanRows(
  processId: TraceProcessId,
  spanRows: TraceSpanArrowRow[],
  localDependencies: TraceLocalDependency[] = [],
  endpoints: TraceCrossProcessEndpoint[] = []
): MultiProcessTraceProcessData {
  const sidecarRows = spanRows.map(() => createSidecarRow());
  return {
    process: createProcess(processId, localDependencies),
    spanTable: buildArrowTraceSpanTableFromRows(spanRows),
    spanSidecarRows: sidecarRows,
    crossProcessEndpointsByEndpointId: groupEndpointsById(endpoints)
  };
}

function createProcess(
  processId: TraceProcessId,
  localDependencies: readonly TraceLocalDependency[]
): ArrowTraceProcessMetadata {
  const threadId = `${processId}-thread` as TraceThreadId;
  const thread = {
    type: 'trace-thread',
    name: `${processId} thread`,
    threadId: threadId,
    processId: processId,
    userData: {}
  } satisfies TraceThread;
  return {
    type: 'trace-process',
    processId: processId,
    name: processId,
    rankNum: Number(processId.split('-').at(-1) ?? 0),
    stepNum: 0,
    threads: [thread],
    threadMap: {[threadId]: thread},
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: [...localDependencies],
    remoteDependencies: [],
    userData: {}
  };
}

function createSpanRow(
  spanId: string,
  processId: TraceProcessId,
  rowIndex: number
): TraceSpanArrowRow {
  return {
    span_id: spanId as TraceSpanId,
    thread_id: `${processId}-thread`,
    name: spanId,
    source: null,
    primary_timing_key: 'primary',
    status: 'finished',
    start_time_ms: rowIndex * 10,
    end_time_ms: rowIndex * 10 + 5,
    duration_ms: 5
  };
}

function createSidecarRow(): TraceSpanArrowSidecarRow {
  return {
    timings: {},
    userData: {},
    keywords: [],
    localDependencyIds: [],
    incomingLocalDependencyRowIndexes: [],
    outgoingLocalDependencyRowIndexes: [],
    incomingLocalDependencyRefs: [],
    outgoingLocalDependencyRefs: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}

function createLocalDependency(
  dependencyId: string,
  startSpanId: string,
  endSpanId: string
): TraceLocalDependency {
  return {
    type: 'trace-local-dependency',
    dependencyId: dependencyId as TraceDependencyId,
    startSpanId: startSpanId as TraceSpanId,
    endSpanId: endSpanId as TraceSpanId,
    startSpanRef: encodeSpanRef(0, 0),
    endSpanRef: encodeSpanRef(0, 1),
    keywords: new Set(),
    waitTimeMs: 0,
    waitMode: 'end-to-start',
    bidirectional: false
  };
}

function processId(value: string): TraceProcessId {
  return value as TraceProcessId;
}

function createEndpoint(
  endpointId: TraceCrossProcessEndpointId,
  spanId: string,
  rankNum: number
): TraceCrossProcessEndpoint {
  return createTargetedEndpoint(endpointId, spanId, rankNum, rankNum);
}

function createEndpointWithSpanRef(
  endpointId: TraceCrossProcessEndpointId,
  spanId: string,
  rankNum: number,
  spanRef: SpanRef
): TraceCrossProcessEndpoint {
  return {
    ...createEndpoint(endpointId, spanId, rankNum),
    spanRef
  };
}

function createTargetedEndpoint(
  endpointId: TraceCrossProcessEndpointId,
  spanId: string,
  rankNum: number,
  endRankNum: number
): TraceCrossProcessEndpoint {
  return {
    type: 'cross-process-dependency-endpoint',
    endpointId,
    spanId: spanId as TraceSpanId,
    startRankNum: rankNum,
    endRankNum,
    islandNum: 0,
    waitTimeMs: 0,
    waiting: false,
    waitNotFinished: false
  };
}

/**
 * Asserts that an append index is a flat record rather than a prototype-chain layer.
 */
function expectFlatRecord(record: unknown): void {
  expect(record).toBeDefined();
  const prototype = Object.getPrototypeOf(record);
  expect(prototype === Object.prototype || prototype === null).toBe(true);
}

function groupEndpointsById(
  endpoints: readonly TraceCrossProcessEndpoint[]
): Record<TraceCrossProcessEndpointId, readonly TraceCrossProcessEndpoint[]> {
  const map: Record<TraceCrossProcessEndpointId, TraceCrossProcessEndpoint[]> = {};
  for (const endpoint of endpoints) {
    map[endpoint.endpointId] ??= [];
    map[endpoint.endpointId]!.push(endpoint);
  }
  return map;
}
