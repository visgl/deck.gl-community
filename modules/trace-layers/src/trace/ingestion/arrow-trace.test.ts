import {describe, expect, it, vi} from 'vitest';

import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {buildTraceEventMap} from '../trace-graph/trace-event-table';
import {TraceGraph} from '../trace-graph/trace-graph';
import {
  createDatasetRuntimeTraceGraphForTest,
  createDatasetTraceGraphRuntimeSourceForTest,
  createRuntimeTraceGraph,
  createTraceDatasetFromJSONTraceForTest
} from '../trace-graph/trace-graph-test-fixtures';
import {
  encodeChunkRef,
  encodeCrossProcessDependencyRef,
  encodeEventRefFromChunkRow,
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef,
  getSpanRefProcessId,
  getSpanRefRowIndex
} from '../trace-graph/trace-id-encoder';
import {
  buildArrowFloat64Vector,
  buildArrowTraceEventTableFromRows,
  buildArrowTraceSameProcessDependencyTable,
  buildArrowTraceSpanSidecarTableFromColumns,
  buildArrowTraceSpanSidecarTableFromRows,
  buildArrowTraceSpanTableFromColumns,
  buildArrowUtf8Vector,
  buildTraceChunkDataFromJSONTrace,
  buildTraceChunkDataFromTraceProcesses,
  buildTraceProcessSpanRefTables,
  replaceArrowTraceSpanRefColumns
} from './arrow-trace';
import {buildJSONTrace, materializeJSONTrace} from './json-trace';

import type {TraceDataset} from '../trace-dataset';
import type {
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceProcess,
  TraceProcessId,
  TraceSameProcessDependency,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {
  ArrowTraceChunk,
  ArrowTraceCrossProcessDependencyTable,
  ArrowTraceProcessMetadata,
  ArrowTraceSameProcessDependencyTable
} from './arrow-trace';

/** Creates a graph only for tests that intentionally mutate structural dataset tables. */
function createRawTestTraceGraph(
  traceDataset: Parameters<typeof createDatasetTraceGraphRuntimeSourceForTest>[0],
  options?: Parameters<typeof createRuntimeTraceGraph>[1]
): TraceGraph {
  return createDatasetRuntimeTraceGraphForTest(traceDataset, options);
}

describe('arrow-trace', () => {
  it('builds fast primitive vectors with the same read semantics as Arrow array builders', () => {
    const float64Vector = buildArrowFloat64Vector(new Float64Array([1.5, 2.5, 3.5]));
    expect(float64Vector.get(0)).toBe(1.5);
    expect(float64Vector.get(2)).toBe(3.5);

    const utf8Vector = buildArrowUtf8Vector(['DependencyId(1)', 'end-to-start']);
    expect(utf8Vector.get(0)).toBe('DependencyId(1)');
    expect(utf8Vector.get(1)).toBe('end-to-start');
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
    expect(spanTable.schema.fields.map(field => field.name)).not.toContain('status');
    expect(Array.from(spanTable.getChild('status_code')?.toArray() ?? [])).toEqual([2, 2]);
  });

  it('borrows number-native Float64 owner-ref buffers for canonical span tables', () => {
    const processRefs = new Float64Array([encodeProcessRef(0), encodeProcessRef(1)]);
    const threadRefs = new Float64Array([
      encodeProcessThreadRef(0, 0),
      encodeProcessThreadRef(1, 0)
    ]);
    const spanTable = buildArrowTraceSpanTableFromColumns({
      process_ref: processRefs,
      thread_ref: threadRefs,
      span_id: ['span-a', 'span-b'],
      thread_id: ['thread-a', 'thread-b'],
      name: ['span a', 'span b'],
      primary_timing_key: ['primary', 'primary'],
      status: ['finished', 'finished'],
      start_time_ms: [0, 1],
      end_time_ms: [1, 2],
      duration_ms: [1, 1]
    });

    expect(spanTable.getChild('process_ref')?.type.toString()).toBe('Float64');
    expect(spanTable.getChild('thread_ref')?.type.toString()).toBe('Float64');
    expect(spanTable.getChild('process_ref')?.data[0]?.values).toBe(processRefs);
    expect(spanTable.getChild('thread_ref')?.data[0]?.values).toBe(threadRefs);
    expect(spanTable.getChild('process_ref')?.get(1)).toBe(encodeProcessRef(1));
    expect(spanTable.getChild('thread_ref')?.get(1)).toBe(encodeProcessThreadRef(1, 0));
  });

  it('rejects non-safe canonical owner refs while building and mutating Float64 columns', () => {
    const createColumns = () => ({
      process_ref: [encodeProcessRef(0)],
      thread_ref: [encodeProcessThreadRef(0, 0)],
      span_id: ['span-a'],
      thread_id: ['thread-a'],
      name: ['span a'],
      primary_timing_key: ['primary'],
      status: ['finished' as const],
      start_time_ms: [0],
      end_time_ms: [1],
      duration_ms: [1]
    });

    expect(() =>
      buildArrowTraceSpanTableFromColumns({
        ...createColumns(),
        process_ref: new Float64Array([1.5])
      })
    ).toThrow('process_ref[0]');

    const spanTable = buildArrowTraceSpanTableFromColumns(createColumns());
    expect(() =>
      replaceArrowTraceSpanRefColumns({
        sourceTable: spanTable,
        processRef: [Number.MAX_SAFE_INTEGER + 1],
        threadRef: [encodeProcessThreadRef(0, 0)]
      })
    ).toThrow('safe integer');
  });

  it('stores only non-primary timing projections in a native Struct sidecar', () => {
    const sidecarTable = buildArrowTraceSpanSidecarTableFromRows([
      {
        primaryTimingKey: 'envelope',
        timings: {
          envelope: {
            status: 'finished',
            startTimeMs: 0,
            endTimeMs: 10,
            durationMs: 10,
            durationMsAsString: '10 ms'
          },
          latest_start: {
            status: 'finished',
            startTimeMs: 2,
            endTimeMs: 8,
            durationMs: 6,
            durationMsAsString: '6 ms'
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

    expect(sidecarTable.getChild('timingsJson')).toBeNull();
    expect(JSON.parse(JSON.stringify(sidecarTable.getChild('timings')?.get(0)))).toEqual({
      latest_start: {
        status_code: 2,
        start_time_ms: 2,
        end_time_ms: 8,
        duration_ms: 6
      }
    });
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
      resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTable([])
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
    expect(
      tables[processA.processId]!.schema.fields.some(field => field.name === 'filter_mask')
    ).toBe(false);
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
      resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTable([])
    } satisfies ArrowTraceChunk;

    const tables = buildTraceProcessSpanRefTables([chunk], [processA, processB], {
      processIdsByIndex: [processA.processId, processB.processId]
    });

    expect(Array.from(tables[processA.processId]!.getChild('span_ref')!.toArray())).toEqual([
      encodeSpanRef(0, 0)
    ]);
    expect(
      tables[processA.processId]?.schema.fields.some(field => field.name === 'filter_mask')
    ).toBe(false);
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

  it('stores exact status counts and unfinished timing bounds in chunk diagnostics', () => {
    const chunks = buildTraceChunkDataFromJSONTrace(
      createGraph('chunk-diagnostics', [
        {
          processId: 'rank-1',
          spans: [
            {spanId: 'not-started', status: 'not-started', startTimeMs: 0, endTimeMs: 0},
            {spanId: 'unfinished', status: 'not-finished', startTimeMs: 25, endTimeMs: 0}
          ]
        }
      ])
    );

    expect(chunks[0]?.diagnostics).toMatchObject({
      rowCount: 2,
      notStartedSpanCount: 1,
      unfinishedSpanCount: 1,
      minTimeMs: 25,
      maxTimeMs: 26
    });
  });

  it('builds process-scoped parser-local chunks directly from normalized processes', () => {
    const materializedTrace = materializeJSONTrace(
      createGraph('process-chunks', [
        {
          processId: 'rank-1',
          spans: [{spanId: 'span-1', startTimeMs: 5, endTimeMs: 12}]
        },
        {
          processId: 'rank-2',
          spans: [{spanId: 'span-2', startTimeMs: 15, endTimeMs: 22}]
        }
      ])
    );

    const chunks = buildTraceChunkDataFromTraceProcesses(materializedTrace.processes);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      type: 'trace-chunk-data',
      chunkKey: 'rank-1',
      processId: 'rank-1',
      refState: 'parser-local',
      diagnostics: {
        rowCount: 1,
        minTimeMs: 5,
        maxTimeMs: 12
      }
    });
    expect(chunks[0]?.spanTable.getChild('span_id')?.get(0)).toBe('span-1');
    expect(chunks.map(chunk => chunk.processes.map(process => process.processId))).toEqual([
      ['rank-1'],
      ['rank-2']
    ]);
  });

  it('round-trips span timings and userData through the dataset-backed runtime graph', () => {
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
              },
              smallValues: [1, 2, 3],
              largeValues: [1, 2, 3, 4, 5, 6, 7, 8, 9],
              arbitrary: {
                deep: {
                  value: 'detail-only'
                }
              }
            }
          }
        ]
      }
    ]);

    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const materializedGraph = materializeJSONTrace(graph);

    expect('spanMap' in traceDataset).toBe(false);
    expect(traceDataset.processes.every(process => !('spans' in process))).toBe(true);
    expect(traceDataset.processes.every(process => !('spanMap' in process))).toBe(true);

    const traceGraph = createRuntimeTraceGraph(graph, {});
    expect(traceGraph.threadMap).toEqual(materializedGraph.threadMap);
    expect(traceGraph.threadInstantMap).toEqual(materializedGraph.threadInstantMap);
    const spanId = 'span-1' as TraceSpanId;
    const spanRef = traceGraph.getSpanRefById(spanId);
    const spanSidecarTable = traceDataset.spanSidecarTableMap?.['rank-1' as TraceProcessId];
    expect(spanRef).not.toBeNull();
    expect(spanSidecarTable?.getChild('timingsJson')).toBeNull();
    expect(JSON.parse(JSON.stringify(spanSidecarTable?.getChild('timings')?.get(0)))).toEqual({
      alternate: {
        status_code: 2,
        start_time_ms: 12,
        end_time_ms: 24,
        duration_ms: 12
      }
    });
    expect(traceGraph.getSpanDetailSource(spanRef!)).toMatchObject({
      spanId,
      spanRef,
      threadId: materializedGraph.spanMap[spanId]!.threadId,
      name: materializedGraph.spanMap[spanId]!.name,
      processName: materializedGraph.spanMap[spanId]!.processName,
      primaryTimingKey: materializedGraph.spanMap[spanId]!.primaryTimingKey,
      timings: {
        primary: expect.objectContaining({
          status: 'finished',
          startTimeMs: 10,
          endTimeMs: 20,
          durationMs: 10
        }),
        alternate: expect.objectContaining({
          status: 'finished',
          startTimeMs: 12,
          endTimeMs: 24,
          durationMs: 12
        })
      },
      crossProcessEndpointId: materializedGraph.spanMap[spanId]!.crossProcessEndpointId,
      crossProcessDependencyEndpoints:
        materializedGraph.spanMap[spanId]!.crossProcessDependencyEndpoints,
      userData: materializedGraph.spanMap[spanId]!.userData
    });

    const declaredTraceGraph = new TraceGraph(
      createStaticTraceGraphRuntimeSource({
        identityKey: `${materializedGraph.name}:declared-attributes`,
        name: materializedGraph.name,
        spanLayout: materializedGraph.spanLayout,
        chunks: buildTraceChunkDataFromJSONTrace(materializedGraph, {
          declaredSpanAttributePaths: [
            ['traceId'],
            ['nested', 'value'],
            ['smallValues'],
            ['largeValues']
          ]
        }),
        crossProcessDependencies: materializedGraph.crossProcessDependencies,
        events: materializedGraph.events,
        timeExtents: {
          minTimeMs: materializedGraph.minTimeMs,
          maxTimeMs: materializedGraph.maxTimeMs
        },
        stats: {
          droppedSpanCount: materializedGraph.stats.droppedSpanCount,
          droppedDependencyCount: materializedGraph.stats.droppedDependencyCount,
          droppedCrossProcessDependencyCount:
            materializedGraph.stats.droppedCrossProcessDependencyCount
        }
      })
    );
    const declaredSpanRef = declaredTraceGraph.getSpanRefById(spanId)!;
    const spanUserDataSpy = vi.spyOn(declaredTraceGraph, 'getSpanUserData');
    const spanDetailSpy = vi.spyOn(declaredTraceGraph, 'getSpanDetailSource');

    expect(declaredTraceGraph.getSpanAttribute(declaredSpanRef, ['traceId'])).toBe(123n);
    expect(declaredTraceGraph.getSpanAttribute(declaredSpanRef, ['nested', 'value'])).toBe(456n);
    expect(declaredTraceGraph.getSpanAttribute(declaredSpanRef, ['smallValues'])).toEqual([
      1, 2, 3
    ]);
    expect(declaredTraceGraph.getSpanAttribute(declaredSpanRef, ['largeValues'])).toBeUndefined();
    expect(declaredTraceGraph.getSpanAttribute(declaredSpanRef, ['arbitrary'])).toBeUndefined();
    expect(spanUserDataSpy).not.toHaveBeenCalled();
    expect(spanDetailSpy).not.toHaveBeenCalled();
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

    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const traceGraph = createRuntimeTraceGraph(graph);
    const spanRef = traceGraph.getSpanRefById('manual-span' as TraceSpanId);

    expect(traceDataset.spanLayout).toBe('manual');
    expect(traceGraph.spanLayout).toBe('manual');
    expect(traceGraph.getSpanDetailSource(spanRef!)).toMatchObject({
      layoutTopY: 2.5,
      layoutHeight: 1.25
    });
  });

  it('builds process-local locators', () => {
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

    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const traceGraph = createRuntimeTraceGraph(graph, {});
    const rankOneBlockOneRef = traceGraph.getSpanRefById('rank-1-span-1' as TraceSpanId);
    const rankOneBlockTwoRef = traceGraph.getSpanRefById('rank-1-span-2' as TraceSpanId);
    const rankTwoBlockOneRef = traceGraph.getSpanRefById('rank-2-span-1' as TraceSpanId);

    expect(traceDataset.processSpanTableMap['rank-1' as TraceProcessId].numRows).toBe(2);
    expect(traceDataset.processSpanTableMap['rank-2' as TraceProcessId].numRows).toBe(1);
    expect(traceDataset.ownerRefSnapshot.processIdsByIndex).toEqual(['rank-1', 'rank-2']);
    expect(typeof rankOneBlockOneRef).toBe('number');
    expect(
      getSpanRefProcessId(traceDataset.ownerRefSnapshot.processIdsByIndex, rankOneBlockOneRef!)
    ).toBe('rank-1');
    expect(getSpanRefRowIndex(rankOneBlockTwoRef!)).toBe(1);
    expect(
      getSpanRefProcessId(traceDataset.ownerRefSnapshot.processIdsByIndex, rankTwoBlockOneRef!)
    ).toBe('rank-2');
  });

  it('builds one-process span-ref tables without rereading source layout rows', () => {
    const graph = createGraph('single-process', [
      {
        processId: 'rank-1',
        spans: [
          {spanId: 'rank-1-span-1', startTimeMs: 0, endTimeMs: 5},
          {spanId: 'rank-1-span-2', startTimeMs: 6, endTimeMs: 8}
        ]
      }
    ]);
    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const chunk = traceDataset.chunks[0]!;
    const layoutTopYGet = vi.spyOn(chunk.spanTable.getChild('layout_top_y')!, 'get');
    const layoutHeightGet = vi.spyOn(chunk.spanTable.getChild('layout_height')!, 'get');

    const processSpanTableMap = buildTraceProcessSpanRefTables([chunk], traceDataset.processes, {
      processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex
    });

    expect(processSpanTableMap['rank-1' as TraceProcessId].numRows).toBe(2);
    expect(layoutTopYGet).not.toHaveBeenCalled();
    expect(layoutHeightGet).not.toHaveBeenCalled();
  });

  it('uses immutable table identity instead of content generations', () => {
    const process = {
      processId: 'rank-1' as TraceProcessId
    } satisfies Pick<ArrowTraceProcessMetadata, 'processId'>;
    const buildProcessScopedChunk = (layoutTopY: number): ArrowTraceChunk => ({
      chunkIndex: 0,
      chunkRef: encodeChunkRef(0),
      chunkKey: 'single-process',
      processRefs: [encodeProcessRef(0)],
      processId: process.processId,
      spanTable: buildArrowTraceSpanTableFromColumns({
        process_ref: [encodeProcessRef(0)],
        thread_ref: [0],
        span_id: ['rank-1-span-1'],
        external_span_id: [null],
        thread_id: ['thread-a'],
        name: ['span 1'],
        source: [null],
        primary_timing_key: ['primary'],
        status: ['finished'],
        start_time_ms: [0],
        end_time_ms: [1],
        duration_ms: [1],
        layout_top_y: [layoutTopY],
        layout_height: [0.5]
      }),
      resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTable([])
    });

    const originalChunk = buildProcessScopedChunk(1);
    const updatedChunk = buildProcessScopedChunk(2);
    const originalTable = buildTraceProcessSpanRefTables([originalChunk], [process], {
      processIdsByIndex: [process.processId]
    })[process.processId]!;
    const updatedTable = buildTraceProcessSpanRefTables([updatedChunk], [process], {
      processIdsByIndex: [process.processId]
    })[process.processId]!;

    expect(originalTable).not.toBe(updatedTable);
    expect(originalTable.getChild('layout_top_y')?.get(0)).toBe(1);
    expect(updatedTable.getChild('layout_top_y')?.get(0)).toBe(2);
    expect('generation' in originalTable).toBe(false);
    expect('generation' in updatedTable).toBe(false);
  });

  it('builds additive dependency tables while preserving compatibility dependency surfaces', () => {
    const sameProcessDependencyA = createSameProcessDependency(
      'dep-a-b',
      'rank-1-span-a' as TraceSpanId,
      'rank-1-span-b' as TraceSpanId,
      ['parent'],
      5
    );
    const sameProcessDependencyB = createSameProcessDependency(
      'dep-b-c',
      'rank-1-span-b' as TraceSpanId,
      'rank-1-span-c' as TraceSpanId,
      ['CHAIN'],
      7
    );
    const crossProcessDependencyA = createCrossProcessDependency(
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
    const crossProcessDependencyB = createCrossProcessDependency(
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
          sameProcessDependencies: [sameProcessDependencyA, sameProcessDependencyB]
        },
        {
          processId: 'rank-2',
          spans: [{spanId: 'rank-2-span-1', startTimeMs: 1, endTimeMs: 16}]
        }
      ],
      [crossProcessDependencyA, crossProcessDependencyB]
    );

    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);

    const typedSameProcessDependencyTableMap: Readonly<
      Record<TraceProcessId, ArrowTraceSameProcessDependencyTable>
    > = traceDataset.sameProcessDependencyTableMap;
    const typedCrossProcessDependencyTable: Readonly<ArrowTraceCrossProcessDependencyTable> =
      traceDataset.crossProcessDependencyTable;

    const localTable = typedSameProcessDependencyTableMap['rank-1' as TraceProcessId];
    expect(localTable.numRows).toBe(2);
    expect(localTable.getChild('dependencyId')?.toArray()).toEqual([
      sameProcessDependencyA.dependencyId,
      sameProcessDependencyB.dependencyId
    ]);
    expect(localTable.getChild('startSpanId')?.toArray()).toEqual([
      sameProcessDependencyA.startSpanId,
      sameProcessDependencyB.startSpanId
    ]);
    expect(localTable.getChild('endSpanId')?.toArray()).toEqual([
      sameProcessDependencyA.endSpanId,
      sameProcessDependencyB.endSpanId
    ]);
    expect(localTable.getChild('waitMode')).toBeNull();
    expect(Array.from(localTable.getChild('waitModeCode')?.toArray() ?? [])).toEqual([2, 2]);
    expect(localTable.getChild('bidirectional')?.toArray()).toEqual([false, false]);
    expect(Array.from(localTable.getChild('waitTimeMs')?.toArray() ?? [])).toEqual([5, 7]);
    expect(localTable.getChild('hasParentKeyword')).toBeNull();
    expect(Array.from(localTable.getChild('keywordFlags')?.toArray() ?? [])).toEqual([1, 0]);
    expect(traceDataset.sameProcessDependencyTableMap['rank-2' as TraceProcessId]?.numRows).toBe(0);

    expect(typedCrossProcessDependencyTable.numRows).toBe(2);
    expect(typedCrossProcessDependencyTable.getChild('dependencyId')?.toArray()).toEqual([
      crossProcessDependencyA.dependencyId,
      crossProcessDependencyB.dependencyId
    ]);
    expect(typedCrossProcessDependencyTable.getChild('endpointId')?.toArray()).toEqual([
      crossProcessDependencyA.endpointId,
      crossProcessDependencyB.endpointId
    ]);
    expect(
      Array.from(typedCrossProcessDependencyTable.getChild('startRankNum')?.toArray() ?? [])
    ).toEqual([0, 0]);
    expect(
      Array.from(typedCrossProcessDependencyTable.getChild('endRankNum')?.toArray() ?? [])
    ).toEqual([1, 1]);
    expect(typedCrossProcessDependencyTable.getChild('startSpanId')?.toArray()).toEqual([
      crossProcessDependencyA.startSpanId,
      crossProcessDependencyB.startSpanId
    ]);
    expect(typedCrossProcessDependencyTable.getChild('endSpanId')?.toArray()).toEqual([
      crossProcessDependencyA.endSpanId,
      crossProcessDependencyB.endSpanId
    ]);
    expect(typedCrossProcessDependencyTable.getChild('topology')?.toArray()).toEqual([
      'rpc',
      'rpc-secondary'
    ]);
    expect(
      Array.from(typedCrossProcessDependencyTable.getChild('waitTimeMs')?.toArray() ?? [])
    ).toEqual([11, 13]);
    expect(typedCrossProcessDependencyTable.getChild('waiting')?.toArray()).toEqual([false, false]);
    expect(typedCrossProcessDependencyTable.getChild('waitNotFinished')?.toArray()).toEqual([
      false,
      false
    ]);
    expect(typedCrossProcessDependencyTable.getChild('hasParentKeyword')?.toArray()).toEqual([
      true,
      false
    ]);

    expect(traceDataset.processes[0]?.sameProcessDependencies).toBeUndefined();
    expect('crossProcessDependencies' in traceDataset).toBe(false);
    expect('dependencyMap' in traceDataset).toBe(false);
    const traceGraph = createRuntimeTraceGraph(graph);
    expect(traceGraph.processes).toEqual(traceDataset.processes);
    expect(traceGraph.processes[0]?.sameProcessDependencies).toBeUndefined();
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

    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);

    expect(traceDataset.chunks.map(chunk => chunk.chunkKey)).toEqual(['rank-1', 'rank-2']);
    expect(traceDataset.chunks.map(chunk => chunk.chunkIndex)).toEqual([0, 1]);
    expect(traceDataset.chunks.map(chunk => chunk.chunkRef)).toEqual([
      encodeChunkRef(0),
      encodeChunkRef(1)
    ]);
    expect(
      traceDataset.processSpanTableMap['rank-1' as TraceProcessId]?.getChild('span_ref')?.get(0)
    ).toBe(encodeSpanRef(0, 0));
    expect(traceDataset.chunks[1]?.resolvedSameProcessDependencyTable).toBe(
      traceDataset.sameProcessDependencyTableMap['rank-2' as TraceProcessId]
    );
  });

  it('resolves equivalent span locators after another process is removed', () => {
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
    const reducedGraph = createGraph('reduced', [
      {
        processId: 'rank-2',
        spans: [{spanId: 'rank-2-span-1', startTimeMs: 1, endTimeMs: 7}]
      }
    ]);
    const fullTraceDataset = createTraceDatasetFromJSONTraceForTest(fullGraph);
    const reducedTraceDataset = createTraceDatasetFromJSONTraceForTest(reducedGraph);
    const fullTraceGraph = createRuntimeTraceGraph(fullGraph);
    const reducedTraceGraph = createRuntimeTraceGraph(reducedGraph);
    const fullSpanRef = fullTraceGraph.getSpanRefById('rank-2-span-1' as TraceSpanId);
    const reducedSpanRef = reducedTraceGraph.getSpanRefById('rank-2-span-1' as TraceSpanId);

    expect(
      getSpanRefProcessId(fullTraceDataset.ownerRefSnapshot.processIdsByIndex, fullSpanRef!)
    ).toBe('rank-2');
    expect(getSpanRefRowIndex(fullSpanRef!)).toBe(0);
    expect(
      getSpanRefProcessId(reducedTraceDataset.ownerRefSnapshot.processIdsByIndex, reducedSpanRef!)
    ).toBe('rank-2');
    expect(getSpanRefRowIndex(reducedSpanRef!)).toBe(0);
  });

  it('retains row-aligned span sidecar tables on structural datasets', () => {
    const processId = 'rank-1' as TraceProcessId;
    const graph = createGraph('arrow-sidecar-table', [
      {
        processId: processId,
        spans: [{spanId: 'rank-1-span-a', startTimeMs: 0, endTimeMs: 5}]
      }
    ]);
    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const sidecarTable = buildArrowTraceSpanSidecarTableFromColumns({
      rowCount: 1,
      keywords: [['arrow-keyword']],
      crossProcessEndpointId: ['arrow-endpoint'],
      userDataJson: ['{"source":"arrow"}']
    });

    const datasetWithSidecar: TraceDataset = {
      ...traceDataset,
      spanSidecarTableMap: {
        ...traceDataset.spanSidecarTableMap,
        [processId]: sidecarTable
      },
      chunks: traceDataset.chunks.map(chunk =>
        chunk.processId === processId ? {...chunk, spanSidecarTable: sidecarTable} : chunk
      )
    };

    expect(datasetWithSidecar.spanSidecarTableMap?.[processId]).toBe(sidecarTable);
    expect(createRawTestTraceGraph(datasetWithSidecar).spanSidecarTableMap?.[processId]).toBe(
      sidecarTable
    );
  });

  it('reads directional cross-process dependency refs from canonical dependency rows', () => {
    const rootBlockId = 'rank-1-root' as TraceSpanId;
    const childBlockId = 'rank-2-child' as TraceSpanId;
    const crossProcessDependency = createCrossProcessDependency(
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
      [crossProcessDependency]
    );

    const traceGraph = createRuntimeTraceGraph(graph);
    const dependencyRef = encodeCrossProcessDependencyRef(0);
    const rootSpanRef = traceGraph.getSpanRefById(rootBlockId);
    const childSpanRef = traceGraph.getSpanRefById(childBlockId);

    expect(rootSpanRef).not.toBeNull();
    expect(childSpanRef).not.toBeNull();
    expect(
      traceGraph.getSpanDirectionalDependencyRefs(rootSpanRef!, 'outgoing')
        .crossProcessDependencyRefs
    ).toEqual([dependencyRef]);
    expect(
      traceGraph.getSpanDirectionalDependencyRefs(childSpanRef!, 'incoming')
        .crossProcessDependencyRefs
    ).toEqual([dependencyRef]);
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
    sameProcessDependencies?: TraceSameProcessDependency[];
  }>,
  crossProcessDependencies: ReadonlyArray<TraceCrossProcessDependency> = [],
  spanLayout?: 'auto' | 'manual'
) {
  return buildJSONTrace(
    processSpecs.map((processSpec, index) => createProcess(processSpec, index)),
    crossProcessDependencies,
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
    sameProcessDependencies?: TraceSameProcessDependency[];
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
    sameProcessDependencies: processSpec.sameProcessDependencies ?? [],
    remoteDependencies: []
  } satisfies TraceProcess;
}

function createSameProcessDependency(
  dependencyId: string,
  startSpanId: TraceSpanId,
  endSpanId: TraceSpanId,
  keywords: string[] = [],
  waitTimeMs = 0
): TraceSameProcessDependency {
  return {
    type: 'trace-same-process-dependency',
    dependencyId: dependencyId as TraceDependencyId,
    startSpanId,
    endSpanId,
    keywords: new Set(keywords),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs
  };
}

function createCrossProcessDependency(
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
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: blockSpec.crossProcessDependencyEndpoints ?? [],
    layoutTopY: blockSpec.layoutTopY,
    layoutHeight: blockSpec.layoutHeight,
    userData: blockSpec.userData
  } satisfies TraceSpan;
}
