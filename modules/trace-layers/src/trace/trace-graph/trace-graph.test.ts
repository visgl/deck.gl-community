import {describe, expect, it, vi} from 'vitest';

import {
  buildArrowTraceSameProcessDependencyTableFromColumns,
  buildArrowTraceSpanTableFromRows,
  buildTraceProcessSpanRefTables,
  toTraceSpanArrowRow
} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {
  getTraceGraphSpanNameUtf8,
  iterateTraceGraphProcessSpanRefRows,
  iterateTraceGraphProcessSpanRefs
} from '../trace-graph-accessors';
import * as traceGraphAccessors from '../trace-graph-accessors';
import {buildTraceLayoutProcesses} from '../trace-layout/trace-geometry-layout-helpers';
import {getDependencyLineColor, TRACE_COLOR} from '../trace-style/trace-colors';
import {buildTraceFilterSummary, hasTraceFilteredItems} from './trace-filter-summary';
import {TraceGraph} from './trace-graph';
import * as traceGraphArrowFields from './trace-graph-arrow-fields';
import {getSameProcessDependencyLookupByProcessId} from './trace-graph-selection-utils';
import {
  createBlock,
  createBlockForProcess,
  createCrossProcessDependency,
  createDatasetRuntimeTraceGraphForTest,
  createDatasetTraceGraphRuntimeSourceForTest,
  createGraphWithBlocks,
  createProcess,
  createRuntimeTraceGraph,
  createSameProcessDependency,
  createTraceDatasetFromJSONTraceForTest,
  getVisibleProcessSnapshot
} from './trace-graph-test-fixtures';
import {
  getRequiredProcessRef,
  getRequiredSpanRef,
  getRequiredSpanRefBySpanId,
  getRequiredThreadRef,
  getRequiredVisibleDisplaySourceBySpanId,
  getTraceGraphEndpointsWithDependencies,
  getTraceGraphFilteredParentSpanId,
  getTraceGraphRankNumForBlock,
  getTraceGraphSpanDependencies,
  getTraceGraphVisibleDependencyChainForBlock,
  isTraceGraphBlockFiltered
} from './trace-graph-test-utils';
import {TRACE_SPAN_FILTER_MASK_NONE, TRACE_SPAN_FILTER_MASK_REGEXP} from './trace-graph-types';
import {getVisibleSpanGeometrySourcesByProcess} from './trace-graph-visible-span-sources';
import {
  encodeChunkRef,
  encodeCounterRefFromChunkRow,
  encodeCrossProcessDependencyRef,
  encodeEventRefFromChunkRow,
  encodeInstantRefFromChunkRow,
  encodeLocalSpanRef,
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSameProcessDependencyRef,
  encodeSpanRef,
  getSpanRefProcessId,
  getSpanRefRowIndex
} from './trace-id-encoder';
import {createTraceSpanOmniBoxSearchPredicate} from './trace-span-name-search';

import type {
  TraceCounter,
  TraceCounterId,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceEventId,
  TraceInstant,
  TraceInstantId,
  TraceProcessId,
  TraceSameProcessDependency,
  TraceSpan,
  TraceThreadId
} from './trace-types';

function createTestTraceGraph(
  traceDataset: Parameters<typeof createDatasetTraceGraphRuntimeSourceForTest>[0],
  options?: Parameters<typeof createRuntimeTraceGraph>[1]
): TraceGraph {
  return createDatasetRuntimeTraceGraphForTest(traceDataset, options);
}

/** Resolves visible detail rows only for test assertions after the production detail helper was removed. */
function getVisibleSpanDetailsByProcess(
  traceGraph: TraceGraph,
  processRef: Parameters<TraceGraph['iterateVisibleSpanRefsByProcess']>[0]
) {
  return Array.from(traceGraph.iterateVisibleSpanRefsByProcess(processRef)).flatMap(
    spanRef => traceGraph.getSpanDetailSource(spanRef) ?? []
  );
}

describe('TraceGraph', () => {
  it('does not expose retired alias, projection, card, or selection methods', () => {
    const retiredMethods = [
      'getSpanBlockId',
      'getExternalBlockId',
      'getExternalBlockIdForUrl',
      'getTraceGraphSpanRef',
      'getSpanRefByExternalBlockId',
      'getVisibleSpanId',
      'getVisibleSpanBlockId',
      'getProcessSourceBySpanRef',
      'getThreadSourceBySpanRef',
      'getVisibleProcessRenderSpans',
      'getVisibleProcessGeometrySources',
      'getVisibleProcessLaneSources',
      'getVisibleGeometrySourceBySpanRef',
      'getVisibleDependencySourceByRef',
      'getDependencyChainBySpanRef',
      'getParentDependencyChainEntriesBySpanRef',
      'getVisibleDependencyChainBySpanRef',
      'getTraceSpanDependencySelection',
      'getTraceSpanCardModel',
      'getTraceSpanDescendants'
    ];

    for (const methodName of retiredMethods) {
      expect(TraceGraph.prototype).not.toHaveProperty(methodName);
    }
  });

  it('streams unfiltered refs without a runtime cache', () => {
    const root = createBlock('root');
    const child = createBlock('child');
    const traceGraph = createRuntimeTraceGraph(
      createGraphWithBlocks(
        [root, child],
        [createSameProcessDependency('dep-root-child', root.spanId, child.spanId)]
      )
    );
    const processRef = getRequiredProcessRef(traceGraph, 'rank-1');
    const spanRefs = Array.from(traceGraph.iterateVisibleSpanRefsByProcess(processRef));
    const dependencyRefs = Array.from(
      traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(processRef)
    );

    expect(spanRefs).toEqual([
      getRequiredSpanRef(traceGraph, root),
      getRequiredSpanRef(traceGraph, child)
    ]);
    expect(dependencyRefs).toHaveLength(1);
    expect(dependencyRefs.at(0)).toBeDefined();
    expect(Array.from(traceGraph.iterateVisibleSpanRefsByProcess(processRef))).toEqual(spanRefs);
    expect(
      Array.from(traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(processRef))
    ).toEqual(dependencyRefs);
    expect(
      (traceGraph as unknown as {visibleRuntimeCache?: unknown}).visibleRuntimeCache
    ).toBeUndefined();
  });

  it('preserves visual process order in runtime process sources', () => {
    const lateBlock = createBlockForProcess({
      spanId: 'late-span',
      processId: 'rank-late',
      threadId: 'thread-late',
      name: 'late-span',
      startTimeMs: 0,
      endTimeMs: 1
    });
    const earlyBlock = createBlockForProcess({
      spanId: 'early-span',
      processId: 'rank-early',
      threadId: 'thread-early',
      name: 'early-span',
      startTimeMs: 2,
      endTimeMs: 3
    });
    const traceGraph = createRuntimeTraceGraph(
      buildJSONTrace(
        [
          {
            ...createProcess({
              processId: 'rank-late',
              rankNum: 0,
              threadId: 'thread-late',
              spans: [lateBlock]
            }),
            processOrder: 1
          },
          {
            ...createProcess({
              processId: 'rank-early',
              rankNum: 1,
              threadId: 'thread-early',
              spans: [earlyBlock]
            }),
            processOrder: 0
          }
        ],
        [],
        {name: 'process-order-test'}
      )
    );
    const lateProcessRef = getRequiredProcessRef(traceGraph, 'rank-late');

    expect(traceGraph.getProcessSourceByRef(lateProcessRef)?.processOrder).toBe(1);
    expect(buildTraceLayoutProcesses(traceGraph).map(process => process.name)).toEqual([
      'rank-early',
      'rank-late'
    ]);
  });

  it('reads span and cross-process-dependency fields through ref-native accessors', () => {
    const blockA = {
      ...createBlockForProcess({
        spanId: 'span-a',
        processId: 'rank-a',
        threadId: 'thread-a',
        name: 'Block A',
        startTimeMs: 2,
        endTimeMs: 8
      }),
      keywords: ['ROOT'],
      userData: {source: 'model.py:42', owner: 'runtime'}
    } satisfies TraceSpan;
    const blockB = createBlockForProcess({
      spanId: 'span-b',
      processId: 'rank-b',
      threadId: 'thread-b',
      name: 'Block B',
      startTimeMs: 10,
      endTimeMs: 15
    });
    const crossProcessDependency = {
      ...createCrossProcessDependency(
        'cross-a-b',
        'endpoint-a-b',
        blockA.spanId,
        blockB.spanId,
        0,
        1,
        'ring',
        ['PARENT', 'REMOTE']
      ),
      waitMode: 'end-to-end',
      bidirectional: true,
      waitTimeMs: 7,
      waiting: true,
      waitNotFinished: true
    } satisfies TraceCrossProcessDependency;
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-a',
          rankNum: 0,
          threadId: 'thread-a',
          spans: [blockA]
        }),
        createProcess({
          processId: 'rank-b',
          rankNum: 1,
          threadId: 'thread-b',
          spans: [blockB]
        })
      ],
      [crossProcessDependency],
      {name: 'accessor-test'}
    );

    const traceGraph = createRuntimeTraceGraph(graph);
    const spanRef = traceGraph.getSpanRefById(blockA.spanId)!;
    const crossProcessDependencyRef = encodeCrossProcessDependencyRef(0);

    expect(traceGraph.getSpanId(spanRef)).toBe(blockA.spanId);
    expect(traceGraph.getSpanStreamId(spanRef)).toBe(blockA.threadId);
    expect(traceGraph.getSpanName(spanRef)).toBe('Block A');
    const spanNameUtf8View = {data: new Uint8Array(), start: 0, end: 0};
    expect(getTraceGraphSpanNameUtf8(traceGraph, spanRef, spanNameUtf8View)).toBe(true);
    expect(
      Array.from(spanNameUtf8View.data.subarray(spanNameUtf8View.start, spanNameUtf8View.end))
    ).toEqual([66, 108, 111, 99, 107, 32, 65]);
    expect(traceGraph.getSpanSource(spanRef)).toBe('model.py:42');
    expect(traceGraph.getSpanRankName(spanRef)).toBe('rank-a');
    expect(traceGraph.getSpanPrimaryTimingKey(spanRef)).toBe('test');
    expect(traceGraph.getSpanStatus(spanRef)).toBe('finished');
    expect(traceGraph.getSpanStartTimeMs(spanRef)).toBe(2);
    expect(traceGraph.getSpanEndTimeMs(spanRef)).toBe(8);
    expect(traceGraph.getSpanDurationMs(spanRef)).toBe(6);
    expect(traceGraph.getSpanDurationLabel(spanRef)).toBe('6 ms');
    expect(traceGraph.getSpanKeywords(spanRef)).toEqual(['ROOT']);
    expect(traceGraph.getSpanUserData(spanRef)).toMatchObject({owner: 'runtime'});
    expect(traceGraph.getSpanAttribute(spanRef, ['owner'])).toBeUndefined();
    expect(traceGraph.getSpanDetailSource(spanRef)?.spanId).toBe(blockA.spanId);
    expect(traceGraph.getSpanId(encodeSpanRef(0, 99))).toBeNull();

    expect(traceGraph.getDependencyId(crossProcessDependencyRef)).toBe(
      crossProcessDependency.dependencyId
    );
    expect(traceGraph.getDependencyStartBlockId(crossProcessDependencyRef)).toBe(blockA.spanId);
    expect(traceGraph.getDependencyEndBlockId(crossProcessDependencyRef)).toBe(blockB.spanId);
    expect(traceGraph.getDependencyWaitMode(crossProcessDependencyRef)).toBe('end-to-end');
    expect(traceGraph.getDependencyBidirectional(crossProcessDependencyRef)).toBe(true);
    expect(traceGraph.getDependencyWaitTimeMs(crossProcessDependencyRef)).toBe(7);
    expect(traceGraph.getDependencyKeywords(crossProcessDependencyRef)).toEqual(
      new Set(['PARENT', 'REMOTE'])
    );
    expect(traceGraph.getDependencyHasKeyword(crossProcessDependencyRef, 'REMOTE')).toBe(true);
    expect(traceGraph.getDependencyHasKeyword(crossProcessDependencyRef, 'MISSING')).toBe(false);
    expect(traceGraph.getCrossProcessDependencyEndpointId(crossProcessDependencyRef)).toBe(
      crossProcessDependency.endpointId
    );
    expect(traceGraph.getCrossProcessDependencyStartRankNum(crossProcessDependencyRef)).toBe(0);
    expect(traceGraph.getCrossProcessDependencyEndRankNum(crossProcessDependencyRef)).toBe(1);
    expect(traceGraph.getCrossProcessDependencyTopology(crossProcessDependencyRef)).toBe('ring');
    expect(traceGraph.getCrossProcessDependencyWaiting(crossProcessDependencyRef)).toBe(true);
    expect(traceGraph.getCrossProcessDependencyWaitNotFinished(crossProcessDependencyRef)).toBe(
      true
    );
    expect(
      traceGraph.getCrossProcessDependencyEndpointId(encodeCrossProcessDependencyRef(99))
    ).toBeNull();

    const visibleCrossProcessDependencyRef = Array.from(
      traceGraph.iterateVisibleCrossProcessDependencyRefs()
    )[0]!;
    expect(traceGraph.getDependencyStartBlockId(visibleCrossProcessDependencyRef)).toBe(
      blockA.spanId
    );
    expect(traceGraph.getDependencyEndBlockId(visibleCrossProcessDependencyRef)).toBe(
      blockB.spanId
    );
    expect(traceGraph.getDependencyStartSpan(visibleCrossProcessDependencyRef)).toBe(
      traceGraph.getSpanRefById(blockA.spanId)
    );
    expect(traceGraph.getDependencyEndSpan(visibleCrossProcessDependencyRef)).toBe(
      traceGraph.getSpanRefById(blockB.spanId)
    );
    expect(traceGraph.getDependencyWaitMode(visibleCrossProcessDependencyRef)).toBe('end-to-end');
    expect(traceGraph.getDependencyBidirectional(visibleCrossProcessDependencyRef)).toBe(true);
    expect(traceGraph.getDependencyWaitTimeMs(visibleCrossProcessDependencyRef)).toBe(7);
    expect(traceGraph.getDependencyKeywords(visibleCrossProcessDependencyRef)).toEqual(
      new Set(['PARENT', 'REMOTE'])
    );
    expect(traceGraph.getDependencyHasKeyword(visibleCrossProcessDependencyRef, 'REMOTE')).toBe(
      true
    );
  });

  it('stores one process table and indexes spans by process id + row', () => {
    const root = createBlock('root');
    const filteredParent = createBlock('filtered-parent');
    const child = createBlock('child');
    const graph = createGraphWithBlocks(
      [root, filteredParent, child],
      [
        createSameProcessDependency('dep-root-parent', root.spanId, filteredParent.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency('dep-parent-child', filteredParent.spanId, child.spanId, [
          'PARENT'
        ])
      ]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});

    expect(
      getSpanRefProcessId(traceGraph.processIdsByIndex, traceGraph.getSpanRefById(root.spanId)!)
    ).toBe('rank-1');
    expect(getSpanRefRowIndex(traceGraph.getSpanRefById(root.spanId)!)).toBe(0);
    expect(traceGraph.getName()).toBe(graph.name);
    expect(traceGraph.getStats()).toMatchObject({
      processCount: 1,
      spanCount: 3
    });
    expect(traceGraph.getTimeBounds()).toEqual({
      minTimeMs: 0,
      maxTimeMs: 0
    });
    expect(traceGraph.getProcessRefs()).toHaveLength(1);
    expect(getTraceGraphRankNumForBlock(traceGraph, child)).toBe(0);
    expect(Array.from(traceGraph.traceViewSnapshot.chunks[0]?.filterMaskByRow ?? [])).toEqual([
      TRACE_SPAN_FILTER_MASK_NONE,
      TRACE_SPAN_FILTER_MASK_REGEXP,
      TRACE_SPAN_FILTER_MASK_NONE
    ]);
    expect(isTraceGraphBlockFiltered(traceGraph, root)).toBe(false);
    expect(isTraceGraphBlockFiltered(traceGraph, filteredParent)).toBe(true);
    expect(
      traceGraph.spanFilterReason(getRequiredSpanRef(traceGraph, filteredParent)).filterMask
    ).toBe(TRACE_SPAN_FILTER_MASK_REGEXP);
    expect(getTraceGraphFilteredParentSpanId(traceGraph, filteredParent)).toBe(root.spanId);
    expect(getTraceGraphFilteredParentSpanId(traceGraph, child)).toBeNull();
  });

  it('keeps visible same-process dependency refs process-scoped when dependency ids repeat', () => {
    const rootA = createBlockForProcess({
      spanId: 'root-a',
      processId: 'rank-a',
      threadId: 'thread-a'
    });
    const childA = createBlockForProcess({
      spanId: 'child-a',
      processId: 'rank-a',
      threadId: 'thread-a'
    });
    const rootB = createBlockForProcess({
      spanId: 'root-b',
      processId: 'rank-b',
      threadId: 'thread-b'
    });
    const childB = createBlockForProcess({
      spanId: 'child-b',
      processId: 'rank-b',
      threadId: 'thread-b'
    });
    const sharedDependencyId = 'shared-dependency-id';
    const traceGraph = createRuntimeTraceGraph(
      buildJSONTrace(
        [
          createProcess({
            processId: 'rank-a',
            rankNum: 0,
            threadId: 'thread-a',
            spans: [rootA, childA],
            sameProcessDependencies: [
              createSameProcessDependency(sharedDependencyId, rootA.spanId, childA.spanId)
            ]
          }),
          createProcess({
            processId: 'rank-b',
            rankNum: 1,
            threadId: 'thread-b',
            spans: [rootB, childB],
            sameProcessDependencies: [
              createSameProcessDependency(sharedDependencyId, rootB.spanId, childB.spanId)
            ]
          })
        ],
        [],
        {name: 'duplicate-same-process-dependency-id-test'}
      )
    );
    const processRefA = getRequiredProcessRef(traceGraph, 'rank-a');
    const processRefB = getRequiredProcessRef(traceGraph, 'rank-b');
    const dependencyRefA = Array.from(
      traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(processRefA)
    ).at(0);
    const dependencyRefB = Array.from(
      traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(processRefB)
    ).at(0);

    expect(dependencyRefA).toBeDefined();
    expect(dependencyRefB).toBeDefined();
    expect(dependencyRefB).not.toBe(dependencyRefA);
    expect(traceGraph.getSameProcessDependencyProcessRefByRef(dependencyRefA!)).toBe(processRefA);
    expect(traceGraph.getSameProcessDependencyProcessRefByRef(dependencyRefB!)).toBe(processRefB);
    expect(traceGraph.getDependencySource(dependencyRefA!)).toMatchObject({
      startSpanId: rootA.spanId,
      endSpanId: childA.spanId
    });
    expect(traceGraph.getDependencySource(dependencyRefB!)).toMatchObject({
      startSpanId: rootB.spanId,
      endSpanId: childB.spanId
    });
  });

  it('omits rewritten same process dependencies that collapse onto one visible span', () => {
    const root = createBlock('root');
    const filteredParent = createBlock('filtered-parent');
    const graph = createGraphWithBlocks(
      [root, filteredParent],
      [
        createSameProcessDependency('dep-root-parent', root.spanId, filteredParent.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency('dep-filtered-root', filteredParent.spanId, root.spanId)
      ]
    );
    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});

    expect(
      traceGraph
        .getVisibleProcessRefs()
        .flatMap(processRef =>
          Array.from(traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(processRef))
        )
        .filter(
          dependencyRef =>
            traceGraph.getDependencyId(dependencyRef) === ('dep-filtered-root' as TraceDependencyId)
        )
    ).toEqual([]);
  });

  it('omits the all-zero filter-mask column for no-filter graphs', () => {
    const root = createBlock('root');
    const child = createBlock('child');
    const graph = createGraphWithBlocks([root, child], []);

    const traceGraph = createRuntimeTraceGraph(graph);
    const rootSpanRef = traceGraph.getSpanRefById(root.spanId)!;

    expect(traceGraph.hasActiveSpanFilter()).toBe(false);
    expect(traceGraph.traceViewSnapshot.filteredSpanCount).toBe(0);
    expect(
      traceGraph.processSpanTableMap['rank-1' as TraceProcessId]?.schema.fields.some(
        field => field.name === 'filter_mask'
      )
    ).toBe(false);
    expect(traceGraph.spanIsFiltered(rootSpanRef)).toBe(false);
    expect(isTraceGraphBlockFiltered(traceGraph, root)).toBe(false);
  });

  it('resolves chunk-backed span refs to process and thread refs', () => {
    const sharedThreadId = 'shared-thread';
    const blockA = createBlockForProcess({
      spanId: 'span-a',
      processId: 'rank-a',
      threadId: sharedThreadId
    });
    const blockB = createBlockForProcess({
      spanId: 'span-b',
      processId: 'rank-b',
      threadId: sharedThreadId
    });
    const instantA = {
      type: 'trace-instant',
      instantId: 'instant-a' as TraceInstantId,
      threadId: sharedThreadId as TraceThreadId,
      name: 'instant-a',
      atTimeMs: 0,
      scope: 't'
    } satisfies TraceInstant;
    const counterA = {
      type: 'trace-counter',
      counterId: 'counter-a' as TraceCounterId,
      threadId: sharedThreadId as TraceThreadId,
      name: 'counter-a',
      atTimeMs: 0,
      totalValue: 1,
      series: {value: 1}
    } satisfies TraceCounter;
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-a',
          rankNum: 0,
          threadId: sharedThreadId,
          spans: [blockA],
          instants: [instantA],
          counters: [counterA]
        }),
        createProcess({
          processId: 'rank-b',
          rankNum: 1,
          threadId: sharedThreadId,
          spans: [blockB]
        })
      ],
      [],
      {
        name: 'chunk-ref-registry-test',
        events: [
          {
            type: 'trace-event',
            eventId: 'event-a' as TraceEventId,
            name: 'event-a',
            atTimeMs: 0
          }
        ]
      }
    );
    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const traceGraph = createTestTraceGraph({
      ...traceDataset,
      chunks: traceDataset.chunks.map(chunk => ({
        ...chunk,
        chunkKey: `loaded-${chunk.processId}`
      }))
    });
    const spanRefA = getRequiredSpanRefBySpanId(traceGraph, blockA.spanId);
    const spanRefB = getRequiredSpanRefBySpanId(traceGraph, blockB.spanId);
    const processRefA = getRequiredProcessRef(traceGraph, 'rank-a');
    const processRefB = getRequiredProcessRef(traceGraph, 'rank-b');

    expect(traceGraph.decodeRef(spanRefA)).toMatchObject({
      kind: 'span',
      chunkIndex: 0,
      rowIndex: 0
    });
    expect(traceGraph.decodeRef(spanRefB)).toMatchObject({
      kind: 'span',
      chunkIndex: 1,
      rowIndex: 0
    });
    expect(traceGraph.chunks.map(chunk => chunk.chunkKey)).toEqual([
      'loaded-rank-a',
      'loaded-rank-b'
    ]);
    expect(traceGraph.chunks.map(chunk => chunk.chunkRef)).toEqual([
      encodeChunkRef(0),
      encodeChunkRef(1)
    ]);
    expect(traceGraph.getChunkByRef(spanRefA)?.chunkKey).toBe('loaded-rank-a');
    expect(
      traceGraph.processSpanTableMap['rank-a' as TraceProcessId]?.getChild('span_ref')?.get(0)
    ).toBe(spanRefA);
    expect(traceGraph.getChunkByRef(spanRefA)?.processRefs).toContain(processRefA);
    expect(traceGraph.getProcessRefByRef(spanRefA)).toBe(processRefA);
    expect(traceGraph.getProcessRefByRef(spanRefB)).toBe(processRefB);
    const threadRefA = traceGraph.getThreadRefsByProcessRef(processRefA)[0];
    const threadRefB = traceGraph.getThreadRefsByProcessRef(processRefB)[0];
    expect(traceGraph.getThreadRefByRef(spanRefA)).toBe(threadRefA);
    expect(traceGraph.getThreadRefByRef(spanRefB)).toBe(threadRefB);
    expect(traceGraph.getThreadSourceByRef(threadRefA)?.processRef).toBe(processRefA);
    expect(traceGraph.getThreadSourceByRef(threadRefB)?.processRef).toBe(processRefB);
    expect(
      traceGraph.getInstantSourcesByThreadRef(threadRefA).map(instant => instant.instantId)
    ).toEqual([instantA.instantId]);
    expect(traceGraph.getInstantSourcesByThreadRef(threadRefB)).toEqual([]);
    expect(
      traceGraph.getCounterSourcesByThreadRef(threadRefA).map(counter => counter.counterId)
    ).toEqual([counterA.counterId]);
    expect(traceGraph.getCounterSourcesByThreadRef(threadRefB)).toEqual([]);

    const eventRef = traceGraph.getEventSources()[0]?.eventRef;
    const instantRef = traceGraph.getInstantSources()[0]?.instantRef;
    const counterRef = traceGraph.getCounterSources()[0]?.counterRef;
    const crossProcessDependencyRef = encodeCrossProcessDependencyRef(0);

    expect(eventRef).toBeTruthy();
    expect(instantRef).toBeTruthy();
    expect(counterRef).toBeTruthy();
    expect(traceGraph.getChunkByRef(eventRef!)?.chunkKey).toBe('rank-a');
    expect(traceGraph.getChunkByRef(crossProcessDependencyRef)?.chunkKey).toBe('rank-a');
    expect(traceGraph.getChunkByRef(instantRef!)?.chunkKey).toBe('rank-a');
    expect(traceGraph.getChunkByRef(counterRef!)?.chunkKey).toBe('rank-a');
    expect(traceGraph.getProcessRefByRef(eventRef!)).toBe(processRefA);
    expect(traceGraph.getThreadRefByRef(eventRef!)).toBe(threadRefA);
  });

  it('reuses supplied chunk-row refs for chunk-row events, instants, and counters', () => {
    const eventRef = encodeEventRefFromChunkRow(0, 7);
    const instantRef = encodeInstantRefFromChunkRow(0, 8);
    const counterRef = encodeCounterRefFromChunkRow(0, 9);
    const process = createProcess({
      processId: 'rank-a',
      rankNum: 0,
      threadId: 'thread-a',
      spans: [createBlockForProcess({spanId: 'span-a', processId: 'rank-a', threadId: 'thread-a'})],
      instants: [
        {
          type: 'trace-instant',
          instantRef,
          instantId: 'instant-a' as TraceInstantId,
          threadId: 'thread-a' as TraceThreadId,
          name: 'instant-a',
          atTimeMs: 0,
          scope: 't'
        }
      ],
      counters: [
        {
          type: 'trace-counter',
          counterRef,
          counterId: 'counter-a' as TraceCounterId,
          threadId: 'thread-a' as TraceThreadId,
          name: 'counter-a',
          atTimeMs: 0,
          totalValue: 1,
          series: {value: 1}
        }
      ]
    });
    const traceGraph = createRuntimeTraceGraph(
      buildJSONTrace([process], [], {
        name: 'chunk-entity-ref-test',
        events: [
          {
            type: 'trace-event',
            eventRef,
            eventId: 'event-a' as TraceEventId,
            name: 'event-a',
            atTimeMs: 0
          }
        ]
      })
    );

    expect(traceGraph.getEventSources()[0]?.eventRef).toBe(eventRef);
    expect(traceGraph.getInstantSources()[0]?.instantRef).toBe(instantRef);
    expect(traceGraph.getCounterSources()[0]?.counterRef).toBe(counterRef);
    expect(traceGraph.getChunkByRef(eventRef)?.chunkIndex).toBe(0);
    expect(traceGraph.getChunkByRef(instantRef)?.chunkIndex).toBe(0);
    expect(traceGraph.getChunkByRef(counterRef)?.chunkIndex).toBe(0);
  });

  it('resolves row owners when one chunk contains spans for multiple processes', () => {
    const blockA = createBlockForProcess({
      spanId: 'shared-chunk-a',
      processId: 'rank-a',
      threadId: 'thread-a'
    });
    const blockB = createBlockForProcess({
      spanId: 'shared-chunk-b',
      processId: 'rank-b',
      threadId: 'thread-b'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-a',
          rankNum: 0,
          threadId: 'thread-a',
          spans: [blockA]
        }),
        createProcess({
          processId: 'rank-b',
          rankNum: 1,
          threadId: 'thread-b',
          spans: [blockB]
        })
      ],
      [],
      {name: 'multi-process-chunk-test'}
    );
    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const processRefA = encodeProcessRef(0);
    const processRefB = encodeProcessRef(1);
    const threadRefA = encodeProcessThreadRef(0, 0);
    const threadRefB = encodeProcessThreadRef(1, 0);
    const sharedSpanTable = buildArrowTraceSpanTableFromRows([
      {
        ...toTraceSpanArrowRow(blockA),
        process_ref: processRefA,
        thread_ref: threadRefA
      },
      {
        ...toTraceSpanArrowRow(blockB),
        process_ref: processRefB,
        thread_ref: threadRefB
      }
    ]);
    const sharedChunk = {
      ...traceDataset.chunks[0]!,
      chunkIndex: 0,
      chunkRef: encodeChunkRef(0),
      chunkKey: 'shared-chunk',
      processes: traceDataset.processes,
      processRefs: [processRefA, processRefB],
      processId: null,
      spanTable: sharedSpanTable,
      metadata: {
        ...traceDataset.chunks[0]!.metadata,
        rowCount: sharedSpanTable.numRows
      },
      resolvedSameProcessDependencyTable:
        traceDataset.sameProcessDependencyTableMap['rank-a' as TraceProcessId]!
    };
    const traceGraph = createTestTraceGraph({
      ...traceDataset,
      chunks: [sharedChunk],
      processSpanTableMap: buildTraceProcessSpanRefTables([sharedChunk], traceDataset.processes, {
        processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex
      })
    });
    const spanRefA = getRequiredSpanRefBySpanId(traceGraph, blockA.spanId);
    const spanRefB = getRequiredSpanRefBySpanId(traceGraph, blockB.spanId);

    expect(spanRefA).toBe(encodeSpanRef(0, 0));
    expect(spanRefB).toBe(encodeSpanRef(0, 1));
    expect(traceGraph.getChunkByRef(spanRefA)?.chunkKey).toBe('shared-chunk');
    expect(traceGraph.getChunkByRef(spanRefB!)?.chunkKey).toBe('shared-chunk');
    expect(traceGraph.getProcessRefByRef(spanRefA!)).toBe(processRefA);
    expect(traceGraph.getProcessRefByRef(spanRefB!)).toBe(processRefB);
    expect(traceGraph.getThreadRefByRef(spanRefA!)).toBe(threadRefA);
    expect(traceGraph.getThreadRefByRef(spanRefB!)).toBe(threadRefB);
    expect(Array.from(iterateTraceGraphProcessSpanRefRows(traceGraph, 'rank-a'))).toEqual([
      {spanRef: spanRefA, processRowIndex: 0}
    ]);
    expect(Array.from(iterateTraceGraphProcessSpanRefRows(traceGraph, 'rank-b'))).toEqual([
      {spanRef: spanRefB, processRowIndex: 0}
    ]);
    expect(Array.from(iterateTraceGraphProcessSpanRefs(traceGraph, 'rank-a'))).toEqual([spanRefA]);
    expect(Array.from(iterateTraceGraphProcessSpanRefs(traceGraph, 'rank-b'))).toEqual([spanRefB]);
  });

  it('resolves store-backed spans from direct chunk-table row addresses', () => {
    const blockA = createBlockForProcess({
      spanId: 'chunk-a',
      processId: 'rank-a',
      threadId: 'thread-a'
    });
    const blockB = createBlockForProcess({
      spanId: 'chunk-b',
      processId: 'rank-b',
      threadId: 'thread-b'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-a',
          rankNum: 0,
          threadId: 'thread-a',
          spans: [blockA]
        }),
        createProcess({
          processId: 'rank-b',
          rankNum: 1,
          threadId: 'thread-b',
          spans: [blockB]
        })
      ],
      [],
      {name: 'chunk-span-ref-test'}
    );
    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const processRefA = encodeProcessRef(0);
    const processRefB = encodeProcessRef(1);
    const storeSpanTable = buildArrowTraceSpanTableFromRows([
      {
        ...toTraceSpanArrowRow(blockA),
        process_ref: processRefA,
        thread_ref: encodeProcessThreadRef(0, 0)
      },
      {
        ...toTraceSpanArrowRow(blockB),
        process_ref: processRefB,
        thread_ref: encodeProcessThreadRef(1, 0)
      }
    ]);
    const sharedChunk = {
      ...traceDataset.chunks[0]!,
      chunkIndex: 0,
      chunkRef: encodeChunkRef(0),
      chunkKey: 'chunk-shared',
      processes: traceDataset.processes,
      processRefs: [processRefA, processRefB],
      processId: null,
      spanTable: storeSpanTable,
      metadata: {
        ...traceDataset.chunks[0]!.metadata,
        rowCount: storeSpanTable.numRows
      },
      resolvedSameProcessDependencyTable:
        traceDataset.sameProcessDependencyTableMap['rank-a' as TraceProcessId]!
    };
    const traceGraph = createTestTraceGraph(
      {
        ...traceDataset,
        chunks: [sharedChunk],
        processSpanTableMap: buildTraceProcessSpanRefTables([sharedChunk], traceDataset.processes, {
          processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex
        })
      },
      {spanFilters: ['chunk-filter-no-match']}
    );

    const spanRefA = getRequiredSpanRefBySpanId(traceGraph, blockA.spanId);
    const spanRefB = getRequiredSpanRefBySpanId(traceGraph, blockB.spanId);

    expect(spanRefA).toBe(encodeSpanRef(0, 0));
    expect(spanRefB).toBe(encodeSpanRef(0, 1));
    expect(traceGraph.getChunkByRef(spanRefA)?.chunkKey).toBe('chunk-shared');
    expect(traceGraph.getProcessRefByRef(spanRefA)).toBe(processRefA);
    expect(traceGraph.getProcessRefByRef(spanRefB)).toBe(processRefB);
    expect(Array.from(iterateTraceGraphProcessSpanRefs(traceGraph, 'rank-a'))).toEqual([spanRefA]);
    expect(Array.from(iterateTraceGraphProcessSpanRefs(traceGraph, 'rank-b'))).toEqual([spanRefB]);
    expect(traceGraph.getVisibleProcessRefs()).toEqual([processRefA, processRefB]);
  });

  it('builds the filtered visible index without materializing source spans', () => {
    const root = createBlock('root');
    const filteredParent = createBlock('filtered-parent');
    const child = createBlock('child');
    const graph = createGraphWithBlocks(
      [root, filteredParent, child],
      [
        createSameProcessDependency('dep-root-parent', root.spanId, filteredParent.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency('dep-parent-child', filteredParent.spanId, child.spanId, [
          'PARENT'
        ])
      ]
    );
    const traceGraph = createRuntimeTraceGraph(graph, {
      spanFilters: ['filtered-parent']
    });

    expect(traceGraph.getVisibleProcessRefs()).toEqual([
      getRequiredProcessRef(traceGraph, 'rank-1')
    ]);
    expect(traceGraph.traceViewSnapshot.filteredSpanCount).toBe(1);
  });

  it('preserves unfiltered visible dependency ids when reading from Arrow dependency tables', () => {
    const rank1BlockA = createBlockForProcess({
      spanId: 'rank-1-span-a',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const rank1BlockB = createBlockForProcess({
      spanId: 'rank-1-span-b',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const rank1BlockC = createBlockForProcess({
      spanId: 'rank-1-span-c',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const rank2BlockA = createBlockForProcess({
      spanId: 'rank-2-span-a',
      processId: 'rank-2',
      threadId: 'thread-2'
    });
    const rank2BlockB = createBlockForProcess({
      spanId: 'rank-2-span-b',
      processId: 'rank-2',
      threadId: 'thread-2'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-1',
          rankNum: 0,
          threadId: 'thread-1',
          spans: [rank1BlockA, rank1BlockB, rank1BlockC],
          sameProcessDependencies: [
            createSameProcessDependency('dep-a-b', rank1BlockA.spanId, rank1BlockB.spanId),
            createSameProcessDependency('dep-b-c', rank1BlockB.spanId, rank1BlockC.spanId)
          ]
        }),
        createProcess({
          processId: 'rank-2',
          rankNum: 1,
          threadId: 'thread-2',
          spans: [rank2BlockA, rank2BlockB],
          sameProcessDependencies: [
            createSameProcessDependency('dep-remote-a-b', rank2BlockA.spanId, rank2BlockB.spanId)
          ]
        })
      ],
      [
        createCrossProcessDependency(
          'dep-c-remote-a',
          'endpoint-c-remote-a',
          rank1BlockC.spanId,
          rank2BlockA.spanId,
          0,
          1,
          'rpc'
        ),
        createCrossProcessDependency(
          'dep-a-remote-b',
          'endpoint-a-remote-b',
          rank1BlockA.spanId,
          rank2BlockB.spanId,
          0,
          1,
          'rpc-secondary'
        )
      ],
      {name: 'unfiltered-visible-dependency-ids'}
    );

    const traceGraph = createRuntimeTraceGraph(graph);
    expect(
      Array.from(
        traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(
          getRequiredProcessRef(traceGraph, 'rank-1')
        )
      ).flatMap(dependencyRef => {
        const dependency = traceGraph.getDependencySource(dependencyRef);
        return dependency?.type === 'trace-same-process-dependency' ? [dependency] : [];
      })
    ).toEqual(
      graph.processes[0]?.sameProcessDependencies?.map(dependency =>
        expect.objectContaining({
          dependencyId: dependency.dependencyId,
          type: dependency.type,
          waitTimeMs: dependency.waitTimeMs
        })
      )
    );
    const visibleCrossProcessDependencies = Array.from(
      traceGraph.iterateVisibleCrossProcessDependencyRefs()
    ).flatMap(dependencyRef => {
      const dependency = traceGraph.getDependencySource(dependencyRef);
      return dependency?.type === 'trace-cross-process-dependency' ? [dependency] : [];
    });
    expect(visibleCrossProcessDependencies).toEqual(
      (graph.crossProcessDependencies ?? []).map(dependency =>
        expect.objectContaining({
          type: dependency.type,
          waitTimeMs: dependency.waitTimeMs
        })
      )
    );
    expect(
      visibleCrossProcessDependencies.map(dependency =>
        traceGraph.getDependencyId(dependency.dependencyRef)
      )
    ).toEqual((graph.crossProcessDependencies ?? []).map(dependency => dependency.dependencyId));
    const visibleDependencyIdsForBlock = (span: TraceSpan) =>
      Array.from(
        new Set(
          (['incoming', 'outgoing'] as const).flatMap(
            direction =>
              traceGraph.getVisibleDirectionalDependencyRefSlice(
                getRequiredSpanRefBySpanId(traceGraph, span.spanId),
                direction,
                Number.POSITIVE_INFINITY
              ).dependencyRefs
          )
        )
      )
        .map(dependencyRef => traceGraph.getDependencyId(dependencyRef))
        .sort();
    expect(visibleDependencyIdsForBlock(rank1BlockA)).toEqual([
      'dep-a-b' as TraceDependencyId,
      'dep-a-remote-b' as TraceDependencyId
    ]);
    expect(visibleDependencyIdsForBlock(rank1BlockB)).toEqual([
      'dep-a-b' as TraceDependencyId,
      'dep-b-c' as TraceDependencyId
    ]);
    expect(visibleDependencyIdsForBlock(rank1BlockC)).toEqual([
      'dep-b-c' as TraceDependencyId,
      'dep-c-remote-a' as TraceDependencyId
    ]);
    expect(visibleDependencyIdsForBlock(rank2BlockA)).toEqual([
      'dep-c-remote-a' as TraceDependencyId,
      'dep-remote-a-b' as TraceDependencyId
    ]);
    expect(visibleDependencyIdsForBlock(rank2BlockB)).toEqual([
      'dep-a-remote-b' as TraceDependencyId,
      'dep-remote-a-b' as TraceDependencyId
    ]);
  });

  it('resolves unfiltered same-process dependency sources without runtime process arrays', () => {
    const blockA = createBlockForProcess({
      spanId: 'span-a',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const blockB = createBlockForProcess({
      spanId: 'span-b',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const warningDependency: TraceSameProcessDependency = {
      type: 'trace-same-process-dependency',
      dependencyId: 'submit-warning' as TraceDependencyId,
      startSpanId: blockA.spanId,
      endSpanId: blockB.spanId,
      keywords: new Set(['SUBMIT']),
      waitMode: 'end-to-start',
      bidirectional: false,
      waitTimeMs: 5
    };
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-1',
          rankNum: 0,
          threadId: 'thread-1',
          spans: [blockA, blockB],
          sameProcessDependencies: [warningDependency]
        })
      ],
      [],
      {name: 'arrow-only-same-process-dependency-source'}
    );
    const traceGraph = createRuntimeTraceGraph(graph);
    expect(traceGraph.processes[0]?.sameProcessDependencies).toBeUndefined();

    const dependencyRef = Array.from(
      traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(
        getRequiredProcessRef(traceGraph, 'rank-1')
      )
    ).at(0)!;
    const dependency = traceGraph.getDependencySource(dependencyRef);

    expect(dependency).toEqual(
      expect.objectContaining({
        dependencyId: warningDependency.dependencyId,
        startSpanId: warningDependency.startSpanId,
        endSpanId: warningDependency.endSpanId,
        waitTimeMs: warningDependency.waitTimeMs
      })
    );
    expect(
      dependency?.type === 'trace-same-process-dependency' && dependency.keywords.has('SUBMIT')
    ).toBe(true);
    expect(
      dependency?.type === 'trace-same-process-dependency'
        ? getDependencyLineColor(dependency, {} as never)
        : null
    ).toEqual(TRACE_COLOR.WARNING_DEPENDENCY_LINE);
  });

  it('derives omitted ref-native same-process dependency identity columns lazily', () => {
    const parent = createBlock('parent');
    const child = createBlock('child');
    const processId = 'rank-1' as TraceProcessId;
    const traceDataset = createTraceDatasetFromJSONTraceForTest(
      createGraphWithBlocks([parent, child], [])
    );
    const dependencyRef = encodeSameProcessDependencyRef(encodeLocalSpanRef(0, 0));
    const resolvedSameProcessDependencyTable = buildArrowTraceSameProcessDependencyTableFromColumns(
      {
        startSpanRef: [encodeSpanRef(0, 0)],
        endSpanRef: [encodeSpanRef(0, 1)],
        waitMode: ['end-to-start'],
        bidirectional: [false],
        waitTimeMs: [5],
        keywords: [['PARENT']],
        hasParentKeyword: [true]
      }
    );
    const refNativeTraceDataset = {
      ...traceDataset,
      sameProcessDependencyTableMap: {
        ...traceDataset.sameProcessDependencyTableMap,
        [processId]: resolvedSameProcessDependencyTable
      }
    };
    const traceGraph = createTestTraceGraph(refNativeTraceDataset);
    const processRef = getRequiredProcessRef(traceGraph, processId);
    const visibleDependencyRef = Array.from(
      traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(processRef)
    ).at(0)!;
    const dependencyId = `same-process-dependency-ref(${dependencyRef})` as TraceDependencyId;

    expect(resolvedSameProcessDependencyTable.getChild('dependencyId')).toBeNull();
    expect(resolvedSameProcessDependencyTable.getChild('startSpanId')).toBeNull();
    expect(resolvedSameProcessDependencyTable.getChild('endSpanId')).toBeNull();
    expect(traceGraph.getDependencyId(dependencyRef)).toBe(dependencyId);
    expect(traceGraph.getDependencyStartBlockId(dependencyRef)).toBe(parent.spanId);
    expect(traceGraph.getDependencyEndBlockId(dependencyRef)).toBe(child.spanId);
    expect(traceGraph.getDependencyStartSpan(dependencyRef)).toBe(encodeSpanRef(0, 0));
    expect(traceGraph.getDependencyEndSpan(dependencyRef)).toBe(encodeSpanRef(0, 1));
    expect(traceGraph.getDependencyId(visibleDependencyRef)).toBe(dependencyId);
    expect(
      getSameProcessDependencyLookupByProcessId(traceGraph)[processId].getRowIndex(dependencyId)
    ).toBe(0);
    expect(traceGraph.getDependencySource(visibleDependencyRef)).toEqual(
      expect.objectContaining({
        dependencyId,
        startSpanId: parent.spanId,
        endSpanId: child.spanId
      })
    );
    expect(
      getTraceGraphVisibleDependencyChainForBlock(traceGraph, child, 'PARENT').map(
        span => span.spanId
      )
    ).toEqual([parent.spanId]);
  });

  it('preserves filtering behavior when the source graph is Arrow-backed', () => {
    const root = createBlock('root');
    const filteredParent = createBlock('filtered-parent');
    const child = createBlock('child');
    const graph = createGraphWithBlocks(
      [root, filteredParent, child],
      [
        createSameProcessDependency('dep-root-parent', root.spanId, filteredParent.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency('dep-parent-child', filteredParent.spanId, child.spanId, [
          'PARENT'
        ])
      ]
    );

    const plainTraceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});
    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const traceDatasetGraph = createTestTraceGraph(traceDataset, {
      spanFilters: ['filtered']
    });

    expect(
      getSpanRefProcessId(
        plainTraceGraph.processIdsByIndex,
        plainTraceGraph.getSpanRefById(child.spanId)!
      )
    ).toBe('rank-1');
    expect(getSpanRefRowIndex(plainTraceGraph.getSpanRefById(child.spanId)!)).toBe(2);
    expect(plainTraceGraph.processSpanTableMap).not.toBe(traceDataset.processSpanTableMap);
    expect(traceDatasetGraph.processSpanTableMap).toBe(traceDataset.processSpanTableMap);
    expect(
      Array.from(traceDatasetGraph.traceViewSnapshot.chunks[0]?.filterMaskByRow ?? [])
    ).toEqual(Array.from(plainTraceGraph.traceViewSnapshot.chunks[0]?.filterMaskByRow ?? []));
    expect(getVisibleProcessSnapshot(traceDatasetGraph)).toEqual(
      getVisibleProcessSnapshot(plainTraceGraph)
    );
    expect(
      Array.from(traceDatasetGraph.iterateVisibleCrossProcessDependencyRefs()).flatMap(
        dependencyRef => {
          const dependency = traceDatasetGraph.getDependencySource(dependencyRef);
          return dependency?.type === 'trace-cross-process-dependency' ? [dependency] : [];
        }
      )
    ).toEqual(
      Array.from(plainTraceGraph.iterateVisibleCrossProcessDependencyRefs()).flatMap(
        dependencyRef => {
          const dependency = plainTraceGraph.getDependencySource(dependencyRef);
          return dependency?.type === 'trace-cross-process-dependency' ? [dependency] : [];
        }
      )
    );
    expect(isTraceGraphBlockFiltered(traceDatasetGraph, filteredParent)).toBe(
      isTraceGraphBlockFiltered(plainTraceGraph, filteredParent)
    );
    expect(getTraceGraphFilteredParentSpanId(traceDatasetGraph, filteredParent)).toBe(
      getTraceGraphFilteredParentSpanId(plainTraceGraph, filteredParent)
    );
    expect(getTraceGraphVisibleDependencyChainForBlock(traceDatasetGraph, child, 'PARENT')).toEqual(
      getTraceGraphVisibleDependencyChainForBlock(plainTraceGraph, child, 'PARENT')
    );
    const traceDatasetSearchRecords: unknown[] = [];
    traceDatasetGraph.searchVisibleBlockRecords(
      () => true,
      record => {
        traceDatasetSearchRecords.push(record);
      }
    );
    const plainSearchRecords: unknown[] = [];
    plainTraceGraph.searchVisibleBlockRecords(
      () => true,
      record => {
        plainSearchRecords.push(record);
      }
    );
    expect(traceDatasetSearchRecords).toEqual(plainSearchRecords);
  });

  it('prioritizes and deduplicates exact external ids in loaded graph search', () => {
    const textMatch = createBlock('text-match');
    textMatch.name = 'Exact:Case text match';
    const exactMatch = createBlock('exact-match');
    exactMatch.name = 'Exact:Case exact target';
    const graph = createGraphWithBlocks([textMatch, exactMatch], []);
    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const spanTable = buildArrowTraceSpanTableFromRows([
      {
        ...toTraceSpanArrowRow(textMatch),
        process_ref: encodeProcessRef(0),
        thread_ref: encodeProcessThreadRef(0, 0),
        external_span_id: 'other-id'
      },
      {
        ...toTraceSpanArrowRow(exactMatch),
        process_ref: encodeProcessRef(0),
        thread_ref: encodeProcessThreadRef(0, 0),
        external_span_id: 'Exact:Case'
      }
    ]);
    const traceGraph = createTestTraceGraph({
      ...traceDataset,
      chunks: traceDataset.chunks.map(chunk => ({
        ...chunk,
        spanTable
      }))
    });
    const matchesSearchText = createTraceSpanOmniBoxSearchPredicate('  Exact:Case  ');
    if (!matchesSearchText) {
      throw new Error('Expected Omnibox search predicate');
    }
    const records: string[] = [];

    traceGraph.searchSpans(
      matchesSearchText,
      record => {
        records.push(record.blockName);
      },
      2
    );

    expect(records).toEqual(['Exact:Case exact target', 'Exact:Case text match']);
  });

  it('preserves filtering behavior when Arrow processes omit compatibility spans', () => {
    const root = createBlock('root');
    const filteredParent = createBlock('filtered-parent');
    const child = createBlock('child');
    const graph = createGraphWithBlocks(
      [root, filteredParent, child],
      [
        createSameProcessDependency('dep-root-parent', root.spanId, filteredParent.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency('dep-parent-child', filteredParent.spanId, child.spanId, [
          'PARENT'
        ])
      ]
    );

    const plainTraceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});
    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const traceDatasetGraph = createTestTraceGraph(traceDataset, {
      spanFilters: ['filtered']
    });

    expect('spanMap' in traceDataset).toBe(false);
    expect(traceDataset.processes.every(process => !('spans' in process))).toBe(true);
    expect(traceDataset.processes[0]).not.toHaveProperty('spans');
    expect(isTraceGraphBlockFiltered(traceDatasetGraph, filteredParent)).toBe(true);
    expect(
      getTraceGraphVisibleDependencyChainForBlock(traceDatasetGraph, child, 'PARENT').map(
        span => span.spanId
      )
    ).toEqual(
      getTraceGraphVisibleDependencyChainForBlock(plainTraceGraph, child, 'PARENT').map(
        span => span.spanId
      )
    );
    expect(getVisibleProcessSnapshot(traceDatasetGraph)).toEqual(
      getVisibleProcessSnapshot(plainTraceGraph)
    );
  });

  it('matches visible dependency accessors between JSON conversion and metadata-only Arrow inputs', () => {
    const root = createBlockForProcess({
      spanId: 'root',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const filteredParent = createBlockForProcess({
      spanId: 'filtered-parent',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const child = createBlockForProcess({
      spanId: 'child',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const remote = createBlockForProcess({
      spanId: 'remote',
      processId: 'rank-2',
      threadId: 'thread-2'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-1',
          rankNum: 0,
          threadId: 'thread-1',
          spans: [root, filteredParent, child],
          sameProcessDependencies: [
            createSameProcessDependency('dep-root-parent', root.spanId, filteredParent.spanId, [
              'PARENT'
            ]),
            createSameProcessDependency('dep-parent-child', filteredParent.spanId, child.spanId, [
              'CHAIN'
            ])
          ]
        }),
        createProcess({
          processId: 'rank-2',
          rankNum: 1,
          threadId: 'thread-2',
          spans: [remote]
        })
      ],
      [
        createCrossProcessDependency(
          'dep-child-remote',
          'endpoint-child-remote',
          child.spanId,
          remote.spanId,
          0,
          1,
          'rpc'
        )
      ],
      {name: 'trace-graph-arrow-runtime-parity'}
    );

    const plainTraceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});
    const metadataOnlyArrowTraceGraph = createRuntimeTraceGraph(graph, {
      spanFilters: ['filtered']
    });

    expect(
      Array.from(metadataOnlyArrowTraceGraph.iterateVisibleCrossProcessDependencyRefs())
        .flatMap(dependencyRef => {
          const dependency = metadataOnlyArrowTraceGraph.getDependencySource(dependencyRef);
          return dependency?.type === 'trace-cross-process-dependency' ? [dependency] : [];
        })
        .map(dependency => metadataOnlyArrowTraceGraph.getDependencyId(dependency.dependencyRef))
    ).toEqual(
      Array.from(plainTraceGraph.iterateVisibleCrossProcessDependencyRefs())
        .flatMap(dependencyRef => {
          const dependency = plainTraceGraph.getDependencySource(dependencyRef);
          return dependency?.type === 'trace-cross-process-dependency' ? [dependency] : [];
        })
        .map(dependency => plainTraceGraph.getDependencyId(dependency.dependencyRef))
    );
    expect(
      getTraceGraphSpanDependencies(
        metadataOnlyArrowTraceGraph,
        getRequiredVisibleDisplaySourceBySpanId(metadataOnlyArrowTraceGraph, child.spanId)
      ).inDependencies.map(dependency => dependency.dependencyId)
    ).toEqual(
      getTraceGraphSpanDependencies(
        plainTraceGraph,
        getRequiredVisibleDisplaySourceBySpanId(plainTraceGraph, child.spanId)
      ).inDependencies.map(dependency => dependency.dependencyId)
    );
    expect(
      getTraceGraphEndpointsWithDependencies(
        metadataOnlyArrowTraceGraph,
        getRequiredVisibleDisplaySourceBySpanId(metadataOnlyArrowTraceGraph, child.spanId)
      ).map(([endpoint, dependency]) => [endpoint.endpointId, dependency?.dependencyId ?? null])
    ).toEqual(
      getTraceGraphEndpointsWithDependencies(
        plainTraceGraph,
        getRequiredVisibleDisplaySourceBySpanId(plainTraceGraph, child.spanId)
      ).map(([endpoint, dependency]) => [endpoint.endpointId, dependency?.dependencyId ?? null])
    );
  });

  it('preserves filtered unresolved endpoint pairing and matched cross process dependencies', () => {
    const source = createBlockForProcess({
      spanId: 'source',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const filtered = createBlockForProcess({
      spanId: 'filtered-hidden',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const target = createBlockForProcess({
      spanId: 'target',
      processId: 'rank-2',
      threadId: 'thread-2'
    });

    source.crossProcessDependencyEndpoints = [
      {
        type: 'cross-process-dependency-endpoint',
        endpointId: 'endpoint-source-target' as TraceCrossProcessEndpointId,
        spanId: source.spanId,
        startRankNum: 0,
        endRankNum: 1,
        islandNum: 0,
        waitTimeMs: 10,
        waiting: false,
        waitNotFinished: false
      },
      {
        type: 'cross-process-dependency-endpoint',
        endpointId: 'endpoint-source-missing' as TraceCrossProcessEndpointId,
        spanId: source.spanId,
        startRankNum: 0,
        endRankNum: 2,
        islandNum: 0,
        waitTimeMs: 30,
        waiting: false,
        waitNotFinished: false
      }
    ];
    target.crossProcessDependencyEndpoints = [
      {
        type: 'cross-process-dependency-endpoint',
        endpointId: 'endpoint-source-target' as TraceCrossProcessEndpointId,
        spanId: target.spanId,
        startRankNum: 1,
        endRankNum: 0,
        islandNum: 0,
        waitTimeMs: 20,
        waiting: false,
        waitNotFinished: false
      }
    ];

    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-1',
          rankNum: 0,
          threadId: 'thread-1',
          spans: [source, filtered]
        }),
        createProcess({
          processId: 'rank-2',
          rankNum: 1,
          threadId: 'thread-2',
          spans: [target]
        })
      ],
      [
        createCrossProcessDependency(
          'dep-source-target',
          'endpoint-source-target',
          source.spanId,
          target.spanId,
          0,
          1,
          'rpc'
        )
      ],
      {name: 'trace-graph-filtered-endpoint-pairing'}
    );

    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered-hidden']});

    expect(
      getTraceGraphEndpointsWithDependencies(
        traceGraph,
        getRequiredVisibleDisplaySourceBySpanId(traceGraph, source.spanId)
      ).map(([endpoint, dependency]) => [
        endpoint.endpointId,
        endpoint.waitTimeMs,
        dependency?.dependencyId ?? null
      ])
    ).toEqual([
      ['endpoint-source-target', 10, 'dep-source-target'],
      ['endpoint-source-missing', 30, null]
    ]);
    expect(
      getTraceGraphEndpointsWithDependencies(
        traceGraph,
        getRequiredVisibleDisplaySourceBySpanId(traceGraph, target.spanId)
      ).map(([endpoint, dependency]) => [
        endpoint.endpointId,
        endpoint.waitTimeMs,
        dependency?.dependencyId ?? null
      ])
    ).toEqual([['endpoint-source-target', 20, 'dep-source-target']]);
  });

  it('projects visible process sources across repeated filtered reads', () => {
    const root = createBlockForProcess({
      spanId: 'root',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const filteredParent = createBlockForProcess({
      spanId: 'filtered-parent',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const child = createBlockForProcess({
      spanId: 'child',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const remote = createBlockForProcess({
      spanId: 'remote',
      processId: 'rank-2',
      threadId: 'thread-2'
    });
    const processA = createProcess({
      processId: 'rank-1',
      rankNum: 0,
      threadId: 'thread-1',
      spans: [root, filteredParent, child],
      sameProcessDependencies: [
        createSameProcessDependency('dep-root-parent', root.spanId, filteredParent.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency('dep-parent-child', filteredParent.spanId, child.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency('dep-root-child', root.spanId, child.spanId, ['PARENT'])
      ]
    });
    const processB = createProcess({
      processId: 'rank-2',
      rankNum: 1,
      threadId: 'thread-2',
      spans: [remote]
    });
    const graph = buildJSONTrace(
      [processA, processB],
      [
        createCrossProcessDependency(
          'dep-root-remote',
          'endpoint-root-remote',
          root.spanId,
          remote.spanId,
          0,
          1,
          'rpc'
        )
      ],
      {name: 'trace-graph-cache-test'}
    );
    const traceGraph = createRuntimeTraceGraph(graph, {
      spanFilters: ['filtered-parent']
    });

    const rank1ProcessRef = getRequiredProcessRef(traceGraph, 'rank-1');
    const rank2ProcessRef = getRequiredProcessRef(traceGraph, 'rank-2');
    const visibleGeometryBlocks = getVisibleSpanGeometrySourcesByProcess(
      traceGraph,
      rank1ProcessRef
    );
    const visibleGeometryBlocksAgain = getVisibleSpanGeometrySourcesByProcess(
      traceGraph,
      rank1ProcessRef
    );
    const visibleRenderSpans = getVisibleSpanDetailsByProcess(traceGraph, rank1ProcessRef);
    const visibleRenderSpansAgain = getVisibleSpanDetailsByProcess(traceGraph, rank1ProcessRef);
    const remoteVisibleRenderSpans = getVisibleSpanDetailsByProcess(traceGraph, rank2ProcessRef);
    const remoteVisibleGeometryBlocks = getVisibleSpanGeometrySourcesByProcess(
      traceGraph,
      rank2ProcessRef
    );
    const visibleSameProcessDependencies =
      traceGraph.getVisibleSameProcessDependencyLayoutSources(rank1ProcessRef);
    const visibleSameProcessDependenciesAgain =
      traceGraph.getVisibleSameProcessDependencyLayoutSources(rank1ProcessRef);
    const visibleTraceSameProcessDependencies = Array.from(
      traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(rank1ProcessRef)
    ).flatMap(dependencyRef => {
      const dependency = traceGraph.getDependencySource(dependencyRef);
      return dependency?.type === 'trace-same-process-dependency' ? [dependency] : [];
    });
    const visibleTraceSameProcessDependenciesAgain = Array.from(
      traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(rank1ProcessRef)
    ).flatMap(dependencyRef => {
      const dependency = traceGraph.getDependencySource(dependencyRef);
      return dependency?.type === 'trace-same-process-dependency' ? [dependency] : [];
    });
    const visibleCrossProcessDependencies = Array.from(
      traceGraph.iterateVisibleCrossProcessDependencyRefs()
    ).flatMap(dependencyRef => {
      const dependency = traceGraph.getDependencySource(dependencyRef);
      return dependency?.type === 'trace-cross-process-dependency' ? [dependency] : [];
    });
    const visibleCrossProcessDependenciesAgain = Array.from(
      traceGraph.iterateVisibleCrossProcessDependencyRefs()
    ).flatMap(dependencyRef => {
      const dependency = traceGraph.getDependencySource(dependencyRef);
      return dependency?.type === 'trace-cross-process-dependency' ? [dependency] : [];
    });

    expect(visibleGeometryBlocksAgain).toStrictEqual(visibleGeometryBlocks);
    expect(visibleRenderSpansAgain).toStrictEqual(visibleRenderSpans);
    expect(visibleGeometryBlocks.map(span => span.spanRef)).toEqual(
      visibleRenderSpans.map(span => span.spanRef)
    );
    expect(visibleRenderSpans.map(span => span.spanId)).toEqual([root.spanId, child.spanId]);
    expect(remoteVisibleRenderSpans.map(span => span.spanId)).toEqual([remote.spanId]);
    expect(remoteVisibleGeometryBlocks.map(span => span.spanRef)).toEqual(
      remoteVisibleRenderSpans.map(span => span.spanRef)
    );
    expect(visibleSameProcessDependenciesAgain).toStrictEqual(visibleSameProcessDependencies);
    expect(visibleSameProcessDependencies.map(dependency => dependency.dependencyId)).toEqual([
      'dep-root-child'
    ]);
    expect(visibleTraceSameProcessDependenciesAgain).toStrictEqual(
      visibleTraceSameProcessDependencies
    );
    expect(visibleTraceSameProcessDependencies.map(dependency => dependency.dependencyId)).toEqual([
      'dep-root-child'
    ]);
    expect(visibleCrossProcessDependenciesAgain).toStrictEqual(visibleCrossProcessDependencies);
    expect(
      visibleCrossProcessDependencies.map(dependency =>
        traceGraph.getDependencyId(dependency.dependencyRef)
      )
    ).toEqual(['dep-root-remote']);
    expect(
      (traceGraph as unknown as {visibleRuntimeCache?: unknown}).visibleRuntimeCache
    ).toBeUndefined();
  });

  it('reuses grouped metadata sources across repeated reads', () => {
    const span = createBlockForProcess({
      spanId: 'span',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const instant: TraceInstant = {
      type: 'trace-instant',
      instantId: 'instant-1' as TraceInstantId,
      threadId: 'thread-1' as TraceThreadId,
      name: 'instant-1',
      atTimeMs: 5,
      scope: 't'
    };
    const counter: TraceCounter = {
      type: 'trace-counter',
      counterId: 'counter-1' as TraceCounterId,
      threadId: 'thread-1' as TraceThreadId,
      name: 'counter-1',
      atTimeMs: 6,
      totalValue: 10,
      series: {value: 10}
    };
    const process = createProcess({
      processId: 'rank-1',
      rankNum: 0,
      threadId: 'thread-1',
      spans: [span],
      instants: [instant],
      counters: [counter]
    });
    const traceGraph = createRuntimeTraceGraph(
      buildJSONTrace([process], [], {name: 'entity-source-cache-test'})
    );

    const processRef = getRequiredProcessRef(traceGraph, 'rank-1');
    const threadRef = getRequiredThreadRef(traceGraph, 'thread-1');
    const threadSources = traceGraph.getThreadSourcesByProcessRef(processRef);
    const threadSourcesAgain = traceGraph.getThreadSourcesByProcessRef(processRef);
    const instantSources = traceGraph.getInstantSourcesByThreadRef(threadRef);
    const instantSourcesAgain = traceGraph.getInstantSourcesByThreadRef(threadRef);
    const counterSources = traceGraph.getCounterSourcesByThreadRef(threadRef);
    const counterSourcesAgain = traceGraph.getCounterSourcesByThreadRef(threadRef);
    const counterExtent = traceGraph.getCounterExtentByThreadRef(threadRef);
    const counterExtentAgain = traceGraph.getCounterExtentByThreadRef(threadRef);

    expect(threadSourcesAgain).toBe(threadSources);
    expect(threadSources).toHaveLength(1);
    expect(instantSourcesAgain).toBe(instantSources);
    expect(instantSources).toHaveLength(1);
    expect(counterSourcesAgain).toBe(counterSources);
    expect(counterSources).toHaveLength(1);
    expect(counterExtentAgain).toBe(counterExtent);
    expect(counterExtent).toEqual({min: 10, max: 10});
  });

  it('resolves span owners without source span table preflight', () => {
    const span = createBlockForProcess({
      spanId: 'span-owner-ref',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const traceGraph = createRuntimeTraceGraph(createGraphWithBlocks([span], []));
    const spanRef = getRequiredSpanRef(traceGraph, span);
    const processRef = getRequiredProcessRef(traceGraph, 'rank-1');
    const threadRef = getRequiredThreadRef(traceGraph, 'thread-1');
    const spanTableRowIndexSpy = vi.spyOn(traceGraphAccessors, 'getTraceGraphSpanTableRowIndex');

    try {
      expect(traceGraph.getProcessRefBySpanRef(spanRef)).toBe(processRef);
      expect(traceGraph.getThreadRefBySpanRef(spanRef)).toBe(threadRef);
      expect(traceGraph.getSpanOwnerRefs(spanRef)).toEqual({processRef, threadRef});
      expect(spanTableRowIndexSpy).not.toHaveBeenCalled();
    } finally {
      spanTableRowIndexSpy.mockRestore();
    }
  });

  it('treats plain filters as literal prefixes and explicit slash-delimited filters as regexes', () => {
    const literalPrefixBlock = createBlock('rpc.request_worker');
    const regexBlock = createBlock('executeRpc-1');
    const otherBlock = createBlock('renderUi');
    const graph = createGraphWithBlocks([literalPrefixBlock, regexBlock, otherBlock], []);

    const literalTraceGraph = createRuntimeTraceGraph(graph, {
      spanFilters: ['rpc.request_']
    });
    const regexTraceGraph = createRuntimeTraceGraph(graph, {
      spanFilters: ['/^executeRpc-\\d+$/']
    });
    const invalidRegexTraceGraph = createRuntimeTraceGraph(graph, {
      spanFilters: ['/executeRpc']
    });

    expect(
      getVisibleSpanDetailsByProcess(
        literalTraceGraph,
        getRequiredProcessRef(literalTraceGraph, 'rank-1')
      ).map(span => span.name)
    ).toEqual(['executeRpc-1', 'renderUi']);
    expect(
      getVisibleSpanDetailsByProcess(
        regexTraceGraph,
        getRequiredProcessRef(regexTraceGraph, 'rank-1')
      ).map(span => span.name)
    ).toEqual(['rpc.request_worker', 'renderUi']);
    expect(
      getVisibleSpanDetailsByProcess(
        invalidRegexTraceGraph,
        getRequiredProcessRef(invalidRegexTraceGraph, 'rank-1')
      ).map(span => span.name)
    ).toEqual(['rpc.request_worker', 'executeRpc-1', 'renderUi']);
  });

  it('skips unfiltered span lane probes when every process disables lane assignment', () => {
    const laneSpan = createBlockForProcess({
      spanId: 'lane-span',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    laneSpan.userData = {lane: 7};
    const graph = createGraphWithBlocks([laneSpan], []);
    graph.processes[0]!.userData = {laneAssignmentMode: 'none'};
    const laneValueSpy = vi.spyOn(traceGraphArrowFields, 'getArrowTraceSpanLaneValue');

    try {
      const traceGraph = createRuntimeTraceGraph(graph);
      const laneLayoutInfo = traceGraph.getVisibleLaneLayoutInfo();

      expect(laneLayoutInfo.threadLaneLayoutMapByRef).toBeUndefined();
      expect(laneLayoutInfo.explicitLaneValueCount).toBe(0);
      expect(laneLayoutInfo.threadsWithLaneDataCount).toBe(0);
      expect(laneValueSpy).not.toHaveBeenCalled();
    } finally {
      laneValueSpy.mockRestore();
    }
  });

  it('skips same-process dependency lane sources when the process disables lane assignment', () => {
    const parent = createBlockForProcess({
      spanId: 'parent-span',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const child = createBlockForProcess({
      spanId: 'child-span',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const graph = createGraphWithBlocks(
      [parent, child],
      [createSameProcessDependency('dep-parent-child', parent.spanId, child.spanId, ['PARENT'])]
    );
    graph.processes[0]!.userData = {laneAssignmentMode: 'none'};
    const traceGraph = createRuntimeTraceGraph(graph);
    const sameProcessDependencySourcesSpy = vi.spyOn(traceGraph, 'getDependencySource');

    try {
      expect(
        traceGraph.getVisibleSameProcessDependencyLayoutSources(
          getRequiredProcessRef(traceGraph, 'rank-1')
        )
      ).toEqual([]);
      expect(sameProcessDependencySourcesSpy).not.toHaveBeenCalled();
    } finally {
      sameProcessDependencySourcesSpy.mockRestore();
    }
  });

  it('skips filtered span lane probes when the process disables lane assignment', () => {
    const visibleLaneSpan = createBlockForProcess({
      spanId: 'visible-lane-span',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    visibleLaneSpan.userData = {lane: 7};
    const filteredLaneSpan = createBlockForProcess({
      spanId: 'filtered-lane-span',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    filteredLaneSpan.userData = {lane: 11};
    const graph = createGraphWithBlocks([visibleLaneSpan, filteredLaneSpan], []);
    graph.processes[0]!.userData = {laneAssignmentMode: 'none'};
    const laneValueSpy = vi.spyOn(traceGraphArrowFields, 'getArrowTraceSpanLaneValue');

    try {
      const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered-lane-span']});
      const laneLayoutInfo = traceGraph.getVisibleLaneLayoutInfo();

      expect(laneLayoutInfo.threadLaneLayoutMapByRef).toBeUndefined();
      expect(laneLayoutInfo.explicitLaneValueCount).toBe(0);
      expect(laneLayoutInfo.threadsWithLaneDataCount).toBe(0);
      expect(laneValueSpy).not.toHaveBeenCalled();
    } finally {
      laneValueSpy.mockRestore();
    }
  });

  it('summarizes filtered-out processes, threads, spans, and dependencies on demand', () => {
    const visibleSpan = createBlockForProcess({
      spanId: 'visible-span',
      processId: 'rank-visible',
      threadId: 'thread-visible'
    });
    const filteredLocalSpan = createBlockForProcess({
      spanId: 'filtered-local-span',
      processId: 'rank-visible',
      threadId: 'thread-visible'
    });
    const filteredRemoteSpan = createBlockForProcess({
      spanId: 'filtered-remote-span',
      processId: 'rank-filtered',
      threadId: 'thread-filtered'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-visible',
          rankNum: 0,
          threadId: 'thread-visible',
          spans: [visibleSpan, filteredLocalSpan],
          sameProcessDependencies: [
            createSameProcessDependency(
              'dep-visible-filtered',
              visibleSpan.spanId,
              filteredLocalSpan.spanId
            )
          ]
        }),
        createProcess({
          processId: 'rank-filtered',
          rankNum: 1,
          threadId: 'thread-filtered',
          spans: [filteredRemoteSpan]
        })
      ],
      [
        createCrossProcessDependency(
          'cross-visible-filtered',
          'endpoint-visible-filtered',
          visibleSpan.spanId,
          filteredRemoteSpan.spanId,
          0,
          1,
          'point-to-point'
        )
      ],
      {name: 'trace-filter-summary'}
    );
    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});

    expect(hasTraceFilteredItems([traceGraph])).toBe(true);
    expect(buildTraceFilterSummary([traceGraph])).toEqual({
      visibleProcessCount: 1,
      totalProcessCount: 2,
      filteredProcessCount: 1,
      visibleThreadCount: 1,
      totalThreadCount: 2,
      filteredThreadCount: 1,
      visibleSpanCount: 1,
      totalSpanCount: 3,
      filteredSpanCount: 2,
      visibleSameProcessDependencyCount: 0,
      totalSameProcessDependencyCount: 1,
      filteredSameProcessDependencyCount: 1,
      visibleCrossProcessDependencyCount: 0,
      totalCrossProcessDependencyCount: 1,
      filteredCrossProcessDependencyCount: 1,
      hasFilteredItems: true
    });
  });

  it('returns zero filtered-out counts without matching filters and aggregates displayed graphs', () => {
    const visibleSpan = createBlockForProcess({
      spanId: 'visible-span',
      processId: 'rank-visible',
      threadId: 'thread-visible'
    });
    const filteredSpan = createBlockForProcess({
      spanId: 'filtered-span',
      processId: 'rank-visible',
      threadId: 'thread-visible'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-visible',
          rankNum: 0,
          threadId: 'thread-visible',
          spans: [visibleSpan, filteredSpan]
        })
      ],
      [],
      {name: 'trace-filter-summary-aggregate'}
    );
    const unfilteredGraph = createRuntimeTraceGraph(graph, {spanFilters: ['not-present']});
    const filteredGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});

    expect(hasTraceFilteredItems([unfilteredGraph])).toBe(false);
    expect(buildTraceFilterSummary([unfilteredGraph])).toEqual({
      visibleProcessCount: 1,
      totalProcessCount: 1,
      filteredProcessCount: 0,
      visibleThreadCount: 1,
      totalThreadCount: 1,
      filteredThreadCount: 0,
      visibleSpanCount: 2,
      totalSpanCount: 2,
      filteredSpanCount: 0,
      visibleSameProcessDependencyCount: 0,
      totalSameProcessDependencyCount: 0,
      filteredSameProcessDependencyCount: 0,
      visibleCrossProcessDependencyCount: 0,
      totalCrossProcessDependencyCount: 0,
      filteredCrossProcessDependencyCount: 0,
      hasFilteredItems: false
    });
    expect(buildTraceFilterSummary([filteredGraph, filteredGraph])).toEqual({
      visibleProcessCount: 2,
      totalProcessCount: 2,
      filteredProcessCount: 0,
      visibleThreadCount: 2,
      totalThreadCount: 2,
      filteredThreadCount: 0,
      visibleSpanCount: 2,
      totalSpanCount: 4,
      filteredSpanCount: 2,
      visibleSameProcessDependencyCount: 0,
      totalSameProcessDependencyCount: 0,
      filteredSameProcessDependencyCount: 0,
      visibleCrossProcessDependencyCount: 0,
      totalCrossProcessDependencyCount: 0,
      filteredCrossProcessDependencyCount: 0,
      hasFilteredItems: true
    });
  });

  it('keeps active zero-match filters on canonical ref paths', () => {
    const localStart = createBlock('local-start');
    const localEnd = createBlock('local-end');
    const graph = createGraphWithBlocks(
      [localStart, localEnd],
      [createSameProcessDependency('local-dependency', localStart.spanId, localEnd.spanId)]
    );
    const unfilteredGraph = createRuntimeTraceGraph(graph);
    const zeroMatchGraph = createRuntimeTraceGraph(graph, {
      spanFilters: ['missing-filter-text']
    });
    const unfilteredProcessRef = getRequiredProcessRef(unfilteredGraph, 'rank-1');
    const zeroMatchProcessRef = getRequiredProcessRef(zeroMatchGraph, 'rank-1');

    expect(zeroMatchGraph.hasActiveSpanFilter()).toBe(true);
    expect(zeroMatchGraph.traceViewSnapshot.filteredSpanCount).toBe(0);
    expect(Array.from(zeroMatchGraph.iterateVisibleSpanRefsByProcess(zeroMatchProcessRef))).toEqual(
      Array.from(unfilteredGraph.iterateVisibleSpanRefsByProcess(unfilteredProcessRef))
    );
    expect(
      Array.from(
        zeroMatchGraph.iterateVisibleSameProcessDependencyRefsByProcess(zeroMatchProcessRef)
      )
    ).toEqual(
      Array.from(
        unfilteredGraph.iterateVisibleSameProcessDependencyRefsByProcess(unfilteredProcessRef)
      )
    );
    expect(zeroMatchGraph.getVisibleLaneLayoutInfo()).toEqual(
      unfilteredGraph.getVisibleLaneLayoutInfo()
    );
  });
});
