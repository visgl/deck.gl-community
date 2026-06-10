import {describe, expect, it} from 'vitest';

import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {buildTraceEventMap} from '../trace-graph/trace-event-table';
import {TraceGraph} from '../trace-graph/trace-graph';
import {
  encodeChunkRef,
  encodeCrossDependencyRef,
  encodeEventRefFromChunkRow,
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  encodeProcessRef,
  encodeSpanRef,
  getSpanRefProcessId,
  getSpanRefRowIndex
} from '../trace-graph/trace-id-encoder';
import {
  buildArrowFloat64Vector,
  buildArrowTraceEventTableFromRows,
  buildArrowTraceLocalDependencyTable,
  buildArrowTraceSpanSidecarTableFromColumns,
  buildArrowTraceSpanTableFromColumns,
  buildArrowUint64ListVector,
  buildArrowUint64Vector,
  buildArrowUtf8Vector,
  buildTraceGraphData,
  buildTraceGraphDataFromJSONTrace,
  buildTraceProcessSpanRefTables,
  getCombinedBlockTable,
  toArrowTraceProcessMetadata
} from './arrow-trace';
import {buildJSONTrace, materializeJSONTrace} from './json-trace';

import type {
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceLocalDependency,
  TraceProcess,
  TraceProcessId,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {
  ArrowTraceChunk,
  ArrowTraceCrossDependencyTable,
  ArrowTraceLocalDependencyTable,
  ArrowTraceProcessMetadata,
  ArrowTraceSpanSidecarTable,
  ArrowTraceSpanTable,
  TraceSpanArrowSidecarMap,
  TraceSpanArrowSidecarRow
} from './arrow-trace';

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

describe('arrow-trace', () => {
  it('builds fast primitive vectors with the same read semantics as Arrow array builders', () => {
    const uint64Vector = buildArrowUint64Vector(new BigUint64Array([1n, 2n, 3n]));
    expect(uint64Vector.get(0)).toBe(1n);
    expect(uint64Vector.get(2)).toBe(3n);

    const float64Vector = buildArrowFloat64Vector(new Float64Array([1.5, 2.5, 3.5]));
    expect(float64Vector.get(0)).toBe(1.5);
    expect(float64Vector.get(2)).toBe(3.5);

    const utf8Vector = buildArrowUtf8Vector(['DependencyId(1)', 'end-to-start']);
    expect(utf8Vector.get(0)).toBe('DependencyId(1)');
    expect(utf8Vector.get(1)).toBe('end-to-start');
  });

  it('builds fast Uint64 list vectors with stable row list semantics', () => {
    const vector = buildArrowUint64ListVector([[1, 2], [], [3]]);

    expect(Array.from(vector.get(0) as Iterable<bigint>)).toEqual([1n, 2n]);
    expect(Array.from(vector.get(1) as Iterable<bigint>)).toEqual([]);
    expect(Array.from(vector.get(2) as Iterable<bigint>)).toEqual([3n]);
  });

  it('preserves optional external span ids and sources in span tables', () => {
    const spanTable = buildArrowTraceSpanTableFromColumns({
      process_ref: [0, 0],
      thread_ref: [0, 0],
      span_id: ['internal-a', 'internal-b'],
      external_span_id: ['6149800612493239450', null],
      thread_id: ['thread-a', 'thread-a'],
      name: ['span a', 'span b'],
      source: ['worker-trace.json', null],
      primary_timing_key: ['primary', 'primary'],
      status: ['finished', 'finished'],
      start_time_ms: [0, 1],
      end_time_ms: [1, 2],
      duration_ms: [1, 1]
    });

    expect(spanTable.getChild('external_span_id')?.get(0)).toBe('6149800612493239450');
    expect(spanTable.getChild('external_span_id')?.get(1)).toBeNull();
    expect(spanTable.getChild('source')?.get(0)).toBe('worker-trace.json');
    expect(spanTable.getChild('source')?.get(1)).toBeNull();
  });

  it('builds process-local SpanRef index tables from direct chunk rows', () => {
    const processA = {
      processId: 'rank-a' as TraceProcessId
    } satisfies Pick<ArrowTraceProcessMetadata, 'processId'>;
    const processB = {
      processId: 'rank-b' as TraceProcessId
    } satisfies Pick<ArrowTraceProcessMetadata, 'processId'>;
    const spanTable = buildArrowTraceSpanTableFromColumns({
      process_ref: [encodeProcessRef(0), encodeProcessRef(1), encodeProcessRef(0)],
      thread_ref: [0, 0, 0],
      span_id: ['a-original-10', 'b-original-20', 'a-original-30'],
      external_span_id: [null, null, null],
      thread_id: ['thread-a', 'thread-b', 'thread-a'],
      name: ['span a 10', 'span b 20', 'span a 30'],
      source: [null, null, null],
      primary_timing_key: ['primary', 'primary', 'primary'],
      status: ['finished', 'finished', 'finished'],
      start_time_ms: [0, 10, 30],
      end_time_ms: [1, 11, 31],
      duration_ms: [1, 1, 1],
      layout_top_y: [1, null, 3],
      layout_height: [0.5, null, 0.75]
    });
    const chunk = {
      chunkIndex: 7,
      chunkRef: encodeChunkRef(7),
      chunkKey: 'multi',
      processRefs: [encodeProcessRef(0), encodeProcessRef(1)],
      spanTable,
      localDependencyTable: buildArrowTraceLocalDependencyTable([])
    } satisfies ArrowTraceChunk;

    const tables = buildTraceProcessSpanRefTables([chunk], [processA, processB], {
      processIdsByIndex: [processA.processId, processB.processId],
      spanRefs: [encodeSpanRef(7, 2), encodeSpanRef(7, 0), encodeSpanRef(7, 1)].sort(
        (left, right) => left - right
      )
    });

    expect(Array.from(tables[processA.processId]!.getChild('span_ref')!.toArray())).toEqual([
      encodeSpanRef(7, 0),
      encodeSpanRef(7, 2)
    ]);
    expect(Array.from(tables[processA.processId]!.getChild('layout_top_y')!.toArray())).toEqual([
      1, 3
    ]);
    expect(Array.from(tables[processA.processId]!.getChild('filter_mask')!.toArray())).toEqual([
      0, 0
    ]);
    expect(Array.from(tables[processB.processId]!.getChild('span_ref')!.toArray())).toEqual([
      encodeSpanRef(7, 1)
    ]);
    expect(tables[processB.processId]?.getChild('layout_top_y')?.get(0)).toBeNull();
    expect(
      (tables[processA.processId] as unknown as {getChild(name: string): unknown}).getChild('name')
    ).toBeNull();
  });

  it('uses process-scoped chunk ids instead of stale span-table process refs', () => {
    const processA = {
      processId: 'rank-a' as TraceProcessId
    } satisfies Pick<ArrowTraceProcessMetadata, 'processId'>;
    const processB = {
      processId: 'rank-b' as TraceProcessId
    } satisfies Pick<ArrowTraceProcessMetadata, 'processId'>;
    const spanTable = buildArrowTraceSpanTableFromColumns({
      process_ref: [encodeProcessRef(1)],
      thread_ref: [0],
      span_id: ['span-a'],
      external_span_id: [null],
      thread_id: ['thread-a'],
      name: ['span a'],
      source: [null],
      primary_timing_key: ['primary'],
      status: ['finished'],
      start_time_ms: [0],
      end_time_ms: [1],
      duration_ms: [1]
    });
    const chunk = {
      chunkIndex: 0,
      chunkRef: encodeChunkRef(0),
      chunkKey: 'rank-a',
      processRefs: [encodeProcessRef(0)],
      processId: processA.processId,
      spanTable,
      localDependencyTable: buildArrowTraceLocalDependencyTable([])
    } satisfies ArrowTraceChunk;

    const tables = buildTraceProcessSpanRefTables([chunk], [processA, processB], {
      processIdsByIndex: [processA.processId, processB.processId]
    });

    expect(Array.from(tables[processA.processId]!.getChild('span_ref')!.toArray())).toEqual([
      encodeSpanRef(0, 0)
    ]);
    expect(tables[processA.processId]?.getChild('filter_mask')?.get(0)).toBe(0);
    expect(tables[processB.processId]?.numRows).toBe(0);
  });

  it('round-trips optional chunk-row event refs through graph-global event tables', () => {
    const eventRef = encodeEventRefFromChunkRow(3, 9);
    const events = buildArrowTraceEventTableFromRows([
      {
        eventRef,
        eventId: 'event-chunk',
        name: 'chunk',
        atTimeMs: 10,
        userDataJson: null
      },
      {
        eventId: 'event-legacy',
        name: 'legacy',
        atTimeMs: 20,
        userDataJson: null
      }
    ]);
    const eventMap = buildTraceEventMap(events);

    expect(Number(events.getChild('eventRef')?.get(0))).toBe(eventRef);
    expect(events.getChild('eventRef')?.get(1)).toBeNull();
    expect(eventMap['event-chunk' as keyof typeof eventMap]?.eventRef).toBe(eventRef);
    expect(eventMap['event-legacy' as keyof typeof eventMap]?.eventRef).toBeUndefined();
  });

  it('keeps not-started and zero-start span rows out of computed Arrow time extents', () => {
    const processId = 'rank-placeholder' as TraceProcessId;
    const threadId = 'rank-placeholder-stream' as TraceThreadId;
    const thread = {
      type: 'trace-thread',
      name: 'placeholder stream',
      threadId,
      processId
    } satisfies TraceThread;
    const process = {
      type: 'trace-process',
      processId,
      name: 'rank-placeholder',
      rankNum: 0,
      stepNum: 0,
      threads: [thread],
      threadMap: {[threadId]: thread},
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      localDependencies: [],
      remoteDependencies: []
    } satisfies ArrowTraceProcessMetadata;
    const spanTable = buildArrowTraceSpanTableFromColumns({
      span_id: ['not-started-span', 'zero-start-span', 'unfinished-span', 'finished-span'],
      thread_id: [threadId, threadId, threadId, threadId],
      name: ['not started', 'zero start', 'unfinished', 'finished'],
      source: [null, null, null, null],
      primary_timing_key: ['primary', 'primary', 'primary', 'primary'],
      status: ['not-started', 'finished', 'not-finished', 'finished'],
      start_time_ms: [0, 0, 25, 40],
      end_time_ms: [0, 100, 0, 50],
      duration_ms: [0, 100, 0, 10]
    });

    const traceGraphData = buildTraceGraphData({
      name: 'placeholder-arrow',
      processes: [process],
      crossDependencies: [],
      spanTableMap: {[processId]: spanTable}
    });

    expect(traceGraphData.minTimeMs).toBe(25);
    expect(traceGraphData.maxTimeMs).toBe(50);
    expect(traceGraphData.stats.spanCount).toBe(4);
  });

  it('round-trips span timings and userData through the Arrow-backed compatibility graph', () => {
    const graph = createGraph('arrow-round-trip', [
      {
        processId: 'rank-1',
        spans: [
          {
            spanId: 'span-1',
            startTimeMs: 10,
            endTimeMs: 20,
            extraTimings: {
              alternate: {
                status: 'finished',
                startTimeMs: 12,
                endTimeMs: 24,
                durationMs: 12,
                durationMsAsString: '12ms'
              }
            },
            keywords: ['rpc', 'leaf'],
            crossProcessDependencyEndpoints: [
              {
                type: 'cross-process-dependency-endpoint',
                endpointId:
                  'endpoint-1' as TraceSpan['crossProcessDependencyEndpoints'][number]['endpointId'],
                spanId: 'span-1' as TraceSpanId,
                startRankNum: 0,
                endRankNum: 1,
                islandNum: 0,
                waitTimeMs: 3,
                waiting: false,
                waitNotFinished: false,
                userData: {token: 9n}
              }
            ],
            userData: {
              traceId: 123n,
              nested: {
                value: 456n
              }
            }
          }
        ]
      }
    ]);

    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const materializedGraph = materializeJSONTrace(graph);
    const combinedBlockTable = getCombinedBlockTable(traceGraphData);

    expect(combinedBlockTable.numRows).toBe(1);
    expect(combinedBlockTable.getChild('primary_timing_key')?.get(0)).toBe('primary');
    expect('spanMap' in traceGraphData).toBe(false);
    expect(traceGraphData.processes.every(process => !('spans' in process))).toBe(true);
    expect(traceGraphData.processes.every(process => !('spanMap' in process))).toBe(true);
    expect(traceGraphData.threadMap).toEqual(materializedGraph.threadMap);
    expect(traceGraphData.threadInstantMap).toEqual(materializedGraph.threadInstantMap);

    const traceGraph = createTestTraceGraph(traceGraphData, {});
    const spanId = 'span-1' as TraceSpanId;
    const spanRef = traceGraph.getSpanRefByExternalBlockId(spanId);
    expect(spanRef).not.toBeNull();
    expect(traceGraph.getDisplaySourceBySpanRef(spanRef!)).toMatchObject({
      spanId,
      spanRef,
      threadId: materializedGraph.spanMap[spanId]!.threadId,
      name: materializedGraph.spanMap[spanId]!.name,
      processName: materializedGraph.spanMap[spanId]!.processName,
      primaryTimingKey: materializedGraph.spanMap[spanId]!.primaryTimingKey,
      timings: materializedGraph.spanMap[spanId]!.timings,
      localDependencyIds: materializedGraph.spanMap[spanId]!.localDependencyIds,
      crossProcessEndpointId: materializedGraph.spanMap[spanId]!.crossProcessEndpointId,
      crossProcessDependencyEndpoints:
        materializedGraph.spanMap[spanId]!.crossProcessDependencyEndpoints,
      userData: materializedGraph.spanMap[spanId]!.userData
    });
  });

  it('round-trips manual span geometry through Arrow tables and TraceGraph sources', () => {
    const graph = createGraph(
      'manual-arrow-round-trip',
      [
        {
          processId: 'rank-1',
          spans: [
            {
              spanId: 'manual-span',
              startTimeMs: 1,
              endTimeMs: 3,
              layoutTopY: 2.5,
              layoutHeight: 1.25
            }
          ]
        }
      ],
      [],
      'manual'
    );

    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const traceGraph = createTestTraceGraph(traceGraphData);
    const spanRef = traceGraph.getSpanRefByExternalBlockId('manual-span' as TraceSpanId);

    expect(traceGraphData.spanLayout).toBe('manual');
    expect(getCombinedBlockTable(traceGraphData).getChild('layout_top_y')?.get(0)).toBe(2.5);
    expect(getCombinedBlockTable(traceGraphData).getChild('layout_height')?.get(0)).toBe(1.25);
    expect(traceGraph.spanLayout).toBe('manual');
    expect(traceGraph.getDisplaySourceBySpanRef(spanRef!)).toMatchObject({
      layoutTopY: 2.5,
      layoutHeight: 1.25
    });
  });

  it('builds process-local locators and a derived combined span table', () => {
    const graph = createGraph('multi-process', [
      {
        processId: 'rank-1',
        spans: [
          {spanId: 'rank-1-span-1', startTimeMs: 0, endTimeMs: 5},
          {spanId: 'rank-1-span-2', startTimeMs: 6, endTimeMs: 8}
        ]
      },
      {
        processId: 'rank-2',
        spans: [{spanId: 'rank-2-span-1', startTimeMs: 1, endTimeMs: 7}]
      }
    ]);

    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const traceGraph = createTestTraceGraph(traceGraphData, {});
    const rankOneBlockOneRef = traceGraph.getSpanRefByExternalBlockId(
      'rank-1-span-1' as TraceSpanId
    );
    const rankOneBlockTwoRef = traceGraph.getSpanRefByExternalBlockId(
      'rank-1-span-2' as TraceSpanId
    );
    const rankTwoBlockOneRef = traceGraph.getSpanRefByExternalBlockId(
      'rank-2-span-1' as TraceSpanId
    );

    expect(traceGraphData.processSpanTableMap['rank-1' as TraceProcessId].numRows).toBe(2);
    expect(traceGraphData.processSpanTableMap['rank-2' as TraceProcessId].numRows).toBe(1);
    expect(traceGraphData.processIdsByIndex).toEqual(['rank-1', 'rank-2']);
    expect(typeof rankOneBlockOneRef).toBe('number');
    expect(getSpanRefProcessId(traceGraphData.processIdsByIndex, rankOneBlockOneRef!)).toBe(
      'rank-1'
    );
    expect(getSpanRefRowIndex(rankOneBlockTwoRef!)).toBe(1);
    expect(getSpanRefProcessId(traceGraphData.processIdsByIndex, rankTwoBlockOneRef!)).toBe(
      'rank-2'
    );
    expect(getBlockIdsFromTable(getCombinedBlockTable(traceGraphData))).toEqual([
      'rank-1-span-1',
      'rank-1-span-2',
      'rank-2-span-1'
    ]);
  });

  it('builds additive dependency tables while preserving compatibility dependency surfaces', () => {
    const localDependencyA = createLocalDependency(
      'dep-a-b',
      'rank-1-span-a' as TraceSpanId,
      'rank-1-span-b' as TraceSpanId,
      ['parent'],
      5
    );
    const localDependencyB = createLocalDependency(
      'dep-b-c',
      'rank-1-span-b' as TraceSpanId,
      'rank-1-span-c' as TraceSpanId,
      ['CHAIN'],
      7
    );
    const crossDependencyA = createCrossDependency(
      'dep-c-remote',
      'endpoint-c-remote',
      'rank-1-span-c' as TraceSpanId,
      'rank-2-span-1' as TraceSpanId,
      0,
      1,
      'rpc',
      ['parent'],
      11
    );
    const crossDependencyB = createCrossDependency(
      'dep-a-remote',
      'endpoint-a-remote',
      'rank-1-span-a' as TraceSpanId,
      'rank-2-span-1' as TraceSpanId,
      0,
      1,
      'rpc-secondary',
      [],
      13
    );
    const graph = createGraph(
      'dependency-tables',
      [
        {
          processId: 'rank-1',
          spans: [
            {spanId: 'rank-1-span-a', startTimeMs: 0, endTimeMs: 5},
            {spanId: 'rank-1-span-b', startTimeMs: 6, endTimeMs: 10},
            {spanId: 'rank-1-span-c', startTimeMs: 11, endTimeMs: 15}
          ],
          localDependencies: [localDependencyA, localDependencyB]
        },
        {
          processId: 'rank-2',
          spans: [{spanId: 'rank-2-span-1', startTimeMs: 1, endTimeMs: 16}]
        }
      ],
      [crossDependencyA, crossDependencyB]
    );

    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);

    const typedLocalDependencyTableMap: Readonly<
      Record<TraceProcessId, ArrowTraceLocalDependencyTable>
    > = traceGraphData.localDependencyTableMap;
    const typedCrossDependencyTable: Readonly<ArrowTraceCrossDependencyTable> =
      traceGraphData.crossDependencyTable;

    const localTable = typedLocalDependencyTableMap['rank-1' as TraceProcessId];
    expect(localTable.numRows).toBe(2);
    expect(localTable.getChild('dependencyId')?.toArray()).toEqual([
      localDependencyA.dependencyId,
      localDependencyB.dependencyId
    ]);
    expect(localTable.getChild('startSpanId')?.toArray()).toEqual([
      localDependencyA.startSpanId,
      localDependencyB.startSpanId
    ]);
    expect(localTable.getChild('endSpanId')?.toArray()).toEqual([
      localDependencyA.endSpanId,
      localDependencyB.endSpanId
    ]);
    expect(localTable.getChild('waitMode')?.toArray()).toEqual([
      localDependencyA.waitMode,
      localDependencyB.waitMode
    ]);
    expect(localTable.getChild('bidirectional')?.toArray()).toEqual([false, false]);
    expect(Array.from(localTable.getChild('waitTimeMs')?.toArray() ?? [])).toEqual([5, 7]);
    expect(localTable.getChild('hasParentKeyword')?.toArray()).toEqual([true, false]);
    expect(traceGraphData.localDependencyTableMap['rank-2' as TraceProcessId]?.numRows).toBe(0);

    expect(typedCrossDependencyTable.numRows).toBe(2);
    expect(typedCrossDependencyTable.getChild('dependencyId')?.toArray()).toEqual([
      crossDependencyA.dependencyId,
      crossDependencyB.dependencyId
    ]);
    expect(typedCrossDependencyTable.getChild('endpointId')?.toArray()).toEqual([
      crossDependencyA.endpointId,
      crossDependencyB.endpointId
    ]);
    expect(Array.from(typedCrossDependencyTable.getChild('startRankNum')?.toArray() ?? [])).toEqual(
      [0, 0]
    );
    expect(Array.from(typedCrossDependencyTable.getChild('endRankNum')?.toArray() ?? [])).toEqual([
      1, 1
    ]);
    expect(typedCrossDependencyTable.getChild('startSpanId')?.toArray()).toEqual([
      crossDependencyA.startSpanId,
      crossDependencyB.startSpanId
    ]);
    expect(typedCrossDependencyTable.getChild('endSpanId')?.toArray()).toEqual([
      crossDependencyA.endSpanId,
      crossDependencyB.endSpanId
    ]);
    expect(typedCrossDependencyTable.getChild('topology')?.toArray()).toEqual([
      'rpc',
      'rpc-secondary'
    ]);
    expect(Array.from(typedCrossDependencyTable.getChild('waitTimeMs')?.toArray() ?? [])).toEqual([
      11, 13
    ]);
    expect(typedCrossDependencyTable.getChild('waiting')?.toArray()).toEqual([false, false]);
    expect(typedCrossDependencyTable.getChild('waitNotFinished')?.toArray()).toEqual([
      false,
      false
    ]);
    expect(typedCrossDependencyTable.getChild('hasParentKeyword')?.toArray()).toEqual([
      true,
      false
    ]);

    const materializedGraph = materializeJSONTrace(graph);
    expect(traceGraphData.processes[0]?.localDependencies).toEqual(
      materializedGraph.processes[0]?.localDependencies
    );
    expect(traceGraphData.crossDependencies).toEqual(materializedGraph.crossDependencies);
    expect(Object.keys(traceGraphData.dependencyMap)).toEqual([
      localDependencyA.dependencyId,
      localDependencyB.dependencyId,
      crossDependencyA.dependencyId,
      crossDependencyB.dependencyId
    ]);
    expect(traceGraphData.dependencyMap[localDependencyA.dependencyId]).toEqual(localDependencyA);
    expect(traceGraphData.dependencyMap[crossDependencyB.dependencyId]).toEqual(crossDependencyB);
  });

  it('derives one storage chunk per process by default', () => {
    const graph = createGraph('chunk-defaults', [
      {
        processId: 'rank-1',
        spans: [{spanId: 'rank-1-span-1', startTimeMs: 0, endTimeMs: 5}]
      },
      {
        processId: 'rank-2',
        spans: [{spanId: 'rank-2-span-1', startTimeMs: 1, endTimeMs: 7}]
      }
    ]);

    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);

    expect(traceGraphData.chunks.map(chunk => chunk.chunkKey)).toEqual(['rank-1', 'rank-2']);
    expect(traceGraphData.chunks.map(chunk => chunk.chunkIndex)).toEqual([0, 1]);
    expect(traceGraphData.chunks.map(chunk => chunk.chunkRef)).toEqual([
      encodeChunkRef(0),
      encodeChunkRef(1)
    ]);
    expect(
      traceGraphData.processSpanTableMap['rank-1' as TraceProcessId]?.getChild('span_ref')?.get(0)
    ).toBe(encodeSpanRef(0, 0));
    expect(traceGraphData.chunks[1]?.localDependencyTable).toBe(
      traceGraphData.localDependencyTableMap['rank-2' as TraceProcessId]
    );
  });

  it('keeps untouched-process locators stable when another process is removed', () => {
    const fullGraph = createGraph('full', [
      {
        processId: 'rank-1',
        spans: [
          {spanId: 'rank-1-span-1', startTimeMs: 0, endTimeMs: 5},
          {spanId: 'rank-1-span-2', startTimeMs: 6, endTimeMs: 8}
        ]
      },
      {
        processId: 'rank-2',
        spans: [{spanId: 'rank-2-span-1', startTimeMs: 1, endTimeMs: 7}]
      }
    ]);
    const fullArrowGraph = buildTraceGraphDataFromJSONTrace(fullGraph);
    const remainingProcess = materializeJSONTrace(fullGraph).processes[1]!;
    const remainingChunk = fullArrowGraph.chunks.find(
      chunk => chunk.processId === remainingProcess.processId
    );
    const reducedArrowGraph = buildTraceGraphData({
      name: 'reduced',
      processes: [toArrowTraceProcessMetadata(remainingProcess)],
      crossDependencies: [],
      spanTableMap: {
        [remainingProcess.processId]: remainingChunk!.spanTable
      } as Record<TraceProcessId, ArrowTraceSpanTable>
    });
    const fullTraceGraph = createTestTraceGraph(fullArrowGraph);
    const reducedTraceGraph = createTestTraceGraph(reducedArrowGraph);
    const fullSpanRef = fullTraceGraph.getSpanRefByExternalBlockId('rank-2-span-1' as TraceSpanId);
    const reducedSpanRef = reducedTraceGraph.getSpanRefByExternalBlockId(
      'rank-2-span-1' as TraceSpanId
    );

    expect(getSpanRefProcessId(fullArrowGraph.processIdsByIndex, fullSpanRef!)).toBe('rank-2');
    expect(getSpanRefRowIndex(fullSpanRef!)).toBe(0);
    expect(getSpanRefProcessId(reducedArrowGraph.processIdsByIndex, reducedSpanRef!)).toBe(
      'rank-2'
    );
    expect(getSpanRefRowIndex(reducedSpanRef!)).toBe(0);
    expect(
      findCombinedRowIndex(getCombinedBlockTable(fullArrowGraph), 'rank-2-span-1' as TraceSpanId)
    ).toBe(2);
    expect(
      findCombinedRowIndex(getCombinedBlockTable(reducedArrowGraph), 'rank-2-span-1' as TraceSpanId)
    ).toBe(0);
  });

  it('derives local dependency refs without mutating read-only sidecar rows', () => {
    const processId = 'rank-1' as TraceProcessId;
    const dependency = createLocalDependency(
      'dep-a-b',
      'rank-1-span-a' as TraceSpanId,
      'rank-1-span-b' as TraceSpanId
    );
    const graph = createGraph('frozen-sidecars', [
      {
        processId: processId,
        spans: [
          {spanId: 'rank-1-span-a', startTimeMs: 0, endTimeMs: 5},
          {spanId: 'rank-1-span-b', startTimeMs: 6, endTimeMs: 10}
        ],
        localDependencies: [dependency]
      }
    ]);
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const sidecarRows = traceGraphData.spanSidecarMap?.[processId] ?? [];
    const frozenSidecarRows = Object.freeze(
      sidecarRows.map(sidecarRow =>
        Object.freeze({
          ...sidecarRow,
          incomingLocalDependencyRefs: [],
          outgoingLocalDependencyRefs: []
        } satisfies TraceSpanArrowSidecarRow)
      )
    );
    const spanSidecarMap = Object.freeze({
      [processId]: frozenSidecarRows
    }) as TraceSpanArrowSidecarMap;

    const rebuiltGraph = buildTraceGraphData({
      name: 'rebuilt-frozen-sidecars',
      processes: traceGraphData.processes,
      crossDependencies: [],
      spanTableMap: buildSourceSpanTableMapFromChunks(traceGraphData.chunks),
      localDependencyTableMap: traceGraphData.localDependencyTableMap,
      spanSidecarMap
    });

    expect(rebuiltGraph.spanSidecarMap?.[processId]?.[0]?.outgoingLocalDependencyRefs).toEqual([
      encodeLocalDependencyRef(encodeLocalSpanRef(0, 0))
    ]);
    expect(rebuiltGraph.spanSidecarMap?.[processId]?.[1]?.incomingLocalDependencyRefs).toEqual([
      encodeLocalDependencyRef(encodeLocalSpanRef(0, 0))
    ]);
    expect(frozenSidecarRows[0]?.outgoingLocalDependencyRefs).toEqual([]);
    expect(frozenSidecarRows[1]?.incomingLocalDependencyRefs).toEqual([]);
  });

  it('constructs TraceGraphDatas with row-aligned span sidecar tables', () => {
    const processId = 'rank-1' as TraceProcessId;
    const graph = createGraph('arrow-sidecar-table', [
      {
        processId: processId,
        spans: [{spanId: 'rank-1-span-a', startTimeMs: 0, endTimeMs: 5}]
      }
    ]);
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const sidecarTable = buildArrowTraceSpanSidecarTableFromColumns({
      incomingLocalDependencyRefs: [[]],
      outgoingLocalDependencyRefs: [[0]],
      keywords: [['arrow-keyword']],
      crossProcessEndpointId: ['arrow-endpoint'],
      userDataJson: ['{"source":"arrow"}']
    });

    const rebuiltGraph = buildTraceGraphData({
      name: 'rebuilt-arrow-sidecar-table',
      processes: traceGraphData.processes,
      crossDependencies: [],
      spanTableMap: buildSourceSpanTableMapFromChunks(traceGraphData.chunks),
      localDependencyTableMap: traceGraphData.localDependencyTableMap,
      spanSidecarTableMap: {
        [processId]: sidecarTable
      } as Record<TraceProcessId, ArrowTraceSpanSidecarTable>
    });

    expect(rebuiltGraph.spanSidecarTableMap?.[processId]).toBe(sidecarTable);
    expect(createTestTraceGraph(rebuiltGraph).spanSidecarTableMap?.[processId]).toBe(sidecarTable);
  });

  it('prefers Arrow span sidecar table values over JS sidecar rows', () => {
    const processId = 'rank-1' as TraceProcessId;
    const dependency = createLocalDependency(
      'dep-a-b',
      'rank-1-span-a' as TraceSpanId,
      'rank-1-span-b' as TraceSpanId
    );
    const graph = createGraph('arrow-sidecar-precedence', [
      {
        processId: processId,
        spans: [
          {spanId: 'rank-1-span-a', startTimeMs: 0, endTimeMs: 5},
          {spanId: 'rank-1-span-b', startTimeMs: 6, endTimeMs: 10}
        ],
        localDependencies: [dependency]
      }
    ]);
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const dependencyRef = encodeLocalDependencyRef(encodeLocalSpanRef(0, 0));
    const spanSidecarMap = {
      [processId]: traceGraphData.spanSidecarMap![processId]!.map(sidecarRow => ({
        ...sidecarRow,
        userData: {source: 'js'},
        keywords: ['js-keyword'],
        localDependencyIds: ['js-dependency' as TraceDependencyId],
        crossProcessEndpointId: 'js-endpoint' as TraceCrossProcessEndpointId
      }))
    } satisfies TraceSpanArrowSidecarMap;
    const spanSidecarTableMap = {
      [processId]: buildArrowTraceSpanSidecarTableFromColumns({
        incomingLocalDependencyRefs: [[], [dependencyRef]],
        outgoingLocalDependencyRefs: [[dependencyRef], []],
        keywords: [['arrow-keyword-a'], ['arrow-keyword-b']],
        crossProcessEndpointId: ['arrow-endpoint', null],
        userDataJson: ['{"source":"arrow"}', null]
      })
    } as Record<TraceProcessId, ArrowTraceSpanSidecarTable>;

    const rebuiltGraph = buildTraceGraphData({
      name: 'rebuilt-arrow-sidecar-precedence',
      processes: traceGraphData.processes,
      crossDependencies: [],
      spanTableMap: buildSourceSpanTableMapFromChunks(traceGraphData.chunks),
      localDependencyTableMap: traceGraphData.localDependencyTableMap,
      spanSidecarMap,
      spanSidecarTableMap
    });
    const runtimeGraph = createTestTraceGraph(rebuiltGraph);
    const span = runtimeGraph.getDisplaySourceBySpanRef(
      runtimeGraph.getSpanRefByExternalBlockId('rank-1-span-a' as TraceSpanId)!
    );

    expect(span?.userData).toEqual({source: 'arrow'});
    expect(span?.keywords).toEqual(['arrow-keyword-a']);
    expect(span?.localDependencyIds).toEqual([dependency.dependencyId]);
    expect(span?.crossProcessEndpointId).toBe('arrow-endpoint');
  });

  it('preserves JS sidecar-only compatibility traces', () => {
    const processId = 'rank-1' as TraceProcessId;
    const graph = createGraph('js-sidecar-fallback', [
      {
        processId: processId,
        spans: [
          {
            spanId: 'rank-1-span-a',
            startTimeMs: 0,
            endTimeMs: 5,
            keywords: ['js-keyword'],
            userData: {source: 'js'}
          }
        ]
      }
    ]);
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const sidecarRow = traceGraphData.spanSidecarMap![processId]![0]!;
    const rebuiltGraph = buildTraceGraphData({
      name: 'rebuilt-js-sidecar-fallback',
      processes: traceGraphData.processes,
      crossDependencies: [],
      spanTableMap: buildSourceSpanTableMapFromChunks(traceGraphData.chunks),
      localDependencyTableMap: traceGraphData.localDependencyTableMap,
      spanSidecarMap: {
        [processId]: [
          {
            ...sidecarRow,
            crossProcessEndpointId: 'js-endpoint' as TraceCrossProcessEndpointId
          }
        ]
      } satisfies TraceSpanArrowSidecarMap
    });
    const runtimeGraph = createTestTraceGraph(rebuiltGraph);
    const span = runtimeGraph.getDisplaySourceBySpanRef(
      runtimeGraph.getSpanRefByExternalBlockId('rank-1-span-a' as TraceSpanId)!
    );

    expect(span?.userData).toEqual({source: 'js'});
    expect(span?.keywords).toEqual(['js-keyword']);
    expect(span?.crossProcessEndpointId).toBe('js-endpoint');
  });

  it('builds empty and non-empty List<Uint64> sidecar dependency ref columns', () => {
    const table = buildArrowTraceSpanSidecarTableFromColumns({
      incomingLocalDependencyRefs: [[], [0, 42]],
      outgoingLocalDependencyRefs: [[7], []],
      localDependencyRefs: [[7], [0, 42]],
      incomingCrossDependencyRefs: [[9], []],
      outgoingCrossDependencyRefs: [[], [11]],
      crossDependencyRefs: [[9], [11]]
    });

    expect(readArrowUint64ListCell(table, 'incomingLocalDependencyRefs', 0)).toEqual([]);
    expect(readArrowUint64ListCell(table, 'incomingLocalDependencyRefs', 1)).toEqual([0, 42]);
    expect(readArrowUint64ListCell(table, 'outgoingLocalDependencyRefs', 0)).toEqual([7]);
    expect(readArrowUint64ListCell(table, 'localDependencyRefs', 1)).toEqual([0, 42]);
    expect(readArrowUint64ListCell(table, 'incomingCrossDependencyRefs', 0)).toEqual([9]);
    expect(readArrowUint64ListCell(table, 'outgoingCrossDependencyRefs', 1)).toEqual([11]);
    expect(readArrowUint64ListCell(table, 'crossDependencyRefs', 0)).toEqual([9]);
  });

  it('attaches directional cross dependency refs to source and destination span sidecars', () => {
    const rootBlockId = 'rank-1-root' as TraceSpanId;
    const childBlockId = 'rank-2-child' as TraceSpanId;
    const crossDependency = createCrossDependency(
      'cross-root-child',
      'endpoint-root-child',
      rootBlockId,
      childBlockId,
      0,
      1,
      'parent',
      ['PARENT']
    );
    const graph = createGraph(
      'cross-sidecar-refs',
      [
        {
          processId: 'rank-1',
          spans: [{spanId: rootBlockId, startTimeMs: 0, endTimeMs: 5}]
        },
        {
          processId: 'rank-2',
          spans: [{spanId: childBlockId, startTimeMs: 6, endTimeMs: 10}]
        }
      ],
      [crossDependency]
    );

    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const dependencyRef = encodeCrossDependencyRef(0);

    expect(traceGraphData.spanSidecarMap?.['rank-1' as TraceProcessId]?.[0]).toMatchObject({
      outgoingCrossDependencyRefs: [dependencyRef]
    });
    expect(traceGraphData.spanSidecarMap?.['rank-2' as TraceProcessId]?.[0]).toMatchObject({
      incomingCrossDependencyRefs: [dependencyRef]
    });
  });
});

function createGraph(
  name: string,
  processSpecs: ReadonlyArray<{
    processId: string;
    spans: ReadonlyArray<{
      spanId: string;
      startTimeMs: number;
      endTimeMs: number;
      status?: TraceSpan['timings'][string]['status'];
      extraTimings?: TraceSpan['timings'];
      layoutTopY?: number;
      layoutHeight?: number;
      keywords?: string[];
      crossProcessDependencyEndpoints?: TraceSpan['crossProcessDependencyEndpoints'];
      userData?: TraceSpan['userData'];
    }>;
    localDependencies?: TraceLocalDependency[];
  }>,
  crossDependencies: ReadonlyArray<TraceCrossProcessDependency> = [],
  spanLayout?: 'auto' | 'manual'
) {
  return buildJSONTrace(
    processSpecs.map((processSpec, index) => createProcess(processSpec, index)),
    crossDependencies,
    {name, spanLayout}
  );
}

function createProcess(
  processSpec: {
    processId: string;
    spans: ReadonlyArray<{
      spanId: string;
      startTimeMs: number;
      endTimeMs: number;
      status?: TraceSpan['timings'][string]['status'];
      extraTimings?: TraceSpan['timings'];
      layoutTopY?: number;
      layoutHeight?: number;
      keywords?: string[];
      crossProcessDependencyEndpoints?: TraceSpan['crossProcessDependencyEndpoints'];
      userData?: TraceSpan['userData'];
    }>;
    localDependencies?: TraceLocalDependency[];
  },
  index: number
): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: `${processSpec.processId}-stream`,
    threadId: `${processSpec.processId}-stream` as TraceThreadId,
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
    localDependencies: processSpec.localDependencies ?? [],
    remoteDependencies: []
  } satisfies TraceProcess;
}

function createLocalDependency(
  dependencyId: string,
  startSpanId: TraceSpanId,
  endSpanId: TraceSpanId,
  keywords: string[] = [],
  waitTimeMs = 0
): TraceLocalDependency {
  return {
    type: 'trace-local-dependency',
    dependencyId: dependencyId as TraceDependencyId,
    startSpanId,
    endSpanId,
    keywords: new Set(keywords),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs
  };
}

function createCrossDependency(
  dependencyId: string,
  endpointId: string,
  startSpanId: TraceSpanId,
  endSpanId: TraceSpanId,
  startRankNum: number,
  endRankNum: number,
  topology: string,
  keywords: string[] = [],
  waitTimeMs = 0
): TraceCrossProcessDependency {
  return {
    type: 'trace-cross-process-dependency',
    dependencyId: dependencyId as TraceDependencyId,
    endpointId: endpointId as TraceCrossProcessEndpointId,
    startRankNum,
    endRankNum,
    startSpanId,
    endSpanId,
    waitMode: 'start-to-start',
    bidirectional: false,
    topology,
    waitTimeMs,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set(keywords)
  };
}

function createBlock(
  blockSpec: {
    spanId: string;
    startTimeMs: number;
    endTimeMs: number;
    status?: TraceSpan['timings'][string]['status'];
    extraTimings?: TraceSpan['timings'];
    layoutTopY?: number;
    layoutHeight?: number;
    keywords?: string[];
    crossProcessDependencyEndpoints?: TraceSpan['crossProcessDependencyEndpoints'];
    userData?: TraceSpan['userData'];
  },
  thread: TraceThread
): TraceSpan {
  return {
    type: 'trace-span',
    spanId: blockSpec.spanId as TraceSpanId,
    threadId: thread.threadId,
    processName: thread.processId,
    name: blockSpec.spanId,
    keywords: blockSpec.keywords ?? [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
        status: blockSpec.status ?? 'finished',
        startTimeMs: blockSpec.startTimeMs,
        endTimeMs: blockSpec.endTimeMs,
        durationMs: blockSpec.endTimeMs - blockSpec.startTimeMs,
        durationMsAsString: `${blockSpec.endTimeMs - blockSpec.startTimeMs}ms`
      },
      ...(blockSpec.extraTimings ?? {})
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: blockSpec.crossProcessDependencyEndpoints ?? [],
    layoutTopY: blockSpec.layoutTopY,
    layoutHeight: blockSpec.layoutHeight,
    userData: blockSpec.userData
  } satisfies TraceSpan;
}

function getBlockIdsFromTable(table: ReturnType<typeof getCombinedBlockTable>): string[] {
  const spanIdColumn = table.getChild('span_id');
  return Array.from({length: table.numRows}, (_, index) => spanIdColumn?.get(index) as string);
}

function findCombinedRowIndex(
  table: ReturnType<typeof getCombinedBlockTable>,
  spanId: TraceSpanId
): number {
  return getBlockIdsFromTable(table).findIndex(entry => entry === spanId);
}

function buildSourceSpanTableMapFromChunks(
  chunks: readonly ArrowTraceChunk[]
): Record<TraceProcessId, ArrowTraceSpanTable> {
  const spanTableMap = {} as Record<TraceProcessId, ArrowTraceSpanTable>;
  for (const chunk of chunks) {
    if (chunk.processId != null) {
      spanTableMap[chunk.processId] = chunk.spanTable;
    }
  }
  return spanTableMap;
}

/**
 * Reads one Arrow `List<Uint64>` test cell into plain JS numbers.
 */
function readArrowUint64ListCell(
  table: ArrowTraceSpanSidecarTable,
  columnName:
    | 'incomingLocalDependencyRefs'
    | 'outgoingLocalDependencyRefs'
    | 'localDependencyRefs'
    | 'incomingCrossDependencyRefs'
    | 'outgoingCrossDependencyRefs'
    | 'crossDependencyRefs',
  rowIndex: number
): number[] {
  const value = table.getChild(columnName)?.get(rowIndex);
  return Array.from((value ?? []) as Iterable<number | bigint>).map(entry =>
    typeof entry === 'bigint' ? Number(entry) : entry
  );
}
