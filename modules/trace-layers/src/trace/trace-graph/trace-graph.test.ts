import {describe, expect, it, vi} from 'vitest';

import {
  buildArrowTraceSpanTableFromRows,
  buildTraceGraphDataFromJSONTrace,
  buildTraceProcessSpanRefTables,
  toTraceSpanArrowRow
} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {
  getTraceGraphSpanNameUtf8,
  iterateTraceGraphProcessSpanRefs
} from '../trace-graph-accessors';
import {getDependencyLineColor, TRACE_COLOR} from '../trace-style/trace-colors';
import {buildTraceFilterSummary, hasTraceFilteredItems} from './trace-filter-summary';
import {TraceGraph} from './trace-graph';
import {
  createArrowGraphWithoutCompatibilityBlocks,
  createBlock,
  createBlockForProcess,
  createCrossDependency,
  createGraphWithBlocks,
  createLocalDependency,
  createProcess,
  createRuntimeTraceGraph,
  getVisibleIndexForTest,
  getVisibleProcessSnapshot
} from './trace-graph-test-fixtures';
import {
  getRequiredProcessRef,
  getRequiredSpanRef,
  getRequiredSpanRefBySpanId,
  getRequiredThreadRef,
  getRequiredVisibleDisplaySourceBySpanId,
  getTraceGraphDependencyChainForBlock,
  getTraceGraphEndpointsWithDependencies,
  getTraceGraphFilteredParentSpanId,
  getTraceGraphRankNumForBlock,
  getTraceGraphSpanDependencies,
  getTraceGraphVisibleDependencyChainForBlock,
  isTraceGraphBlockFiltered
} from './trace-graph-test-utils';
import {
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_TOPOLOGY
} from './trace-graph-types';
import {buildTraceGraphView} from './trace-graph-view';
import {
  encodeChunkRef,
  encodeCounterRefFromChunkRow,
  encodeCrossDependencyRef,
  encodeEventRefFromChunkRow,
  encodeInstantRefFromChunkRow,
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef,
  getSpanRefProcessId,
  getSpanRefRowIndex
} from './trace-id-encoder';

import type {
  SpanRef,
  TraceCounter,
  TraceCounterId,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceEventId,
  TraceInstant,
  TraceInstantId,
  TraceLocalDependency,
  TraceProcessId,
  TraceSpan,
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

describe('TraceGraph', () => {
  it('builds a no-clone view over the cached visible index and layout projection', () => {
    const parent = createBlock('parent');
    const child = createBlock('child');
    const traceGraph = createRuntimeTraceGraph(createGraphWithBlocks([parent, child], []), {
      spanFilters: ['child']
    });

    const visibleIndex = traceGraph.getVisibleIndex();
    const view = buildTraceGraphView(traceGraph);

    expect(view.graph).toBe(traceGraph);
    expect(view.visibleIndex).toBe(visibleIndex);
    expect(view.layoutGraph.traceGraph).toBe(traceGraph);
    expect(view.layoutGraph.processes).toHaveLength(1);
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
    expect(
      buildTraceGraphView(traceGraph).layoutGraph.processes.map(process => process.name)
    ).toEqual(['rank-early', 'rank-late']);
  });

  it('reads span and cross-dependency fields through ref-native accessors', () => {
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
    const crossDependency = {
      ...createCrossDependency(
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
      [crossDependency],
      {name: 'accessor-test'}
    );

    const traceGraph = createRuntimeTraceGraph(graph);
    const spanRef = traceGraph.getSpanRefByExternalBlockId(blockA.spanId)!;
    const crossDependencyRef = encodeCrossDependencyRef(0);

    expect(traceGraph.getSpanBlockId(spanRef)).toBe(blockA.spanId);
    expect(traceGraph.getExternalBlockId(spanRef)).toBe(blockA.spanId);
    expect(traceGraph.getExternalBlockIdForUrl(spanRef)).toBe(blockA.spanId);
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
    expect(traceGraph.getSpanDisplaySource(spanRef)?.spanId).toBe(blockA.spanId);
    expect(traceGraph.getSpanBlockId(encodeSpanRef(0, 99))).toBeNull();

    expect(traceGraph.getDependencyId(crossDependencyRef)).toBe(crossDependency.dependencyId);
    expect(traceGraph.getDependencyStartBlockId(crossDependencyRef)).toBe(blockA.spanId);
    expect(traceGraph.getDependencyEndBlockId(crossDependencyRef)).toBe(blockB.spanId);
    expect(traceGraph.getDependencyWaitMode(crossDependencyRef)).toBe('end-to-end');
    expect(traceGraph.getDependencyBidirectional(crossDependencyRef)).toBe(true);
    expect(traceGraph.getDependencyWaitTimeMs(crossDependencyRef)).toBe(7);
    expect(traceGraph.getDependencyKeywords(crossDependencyRef)).toEqual(
      new Set(['PARENT', 'REMOTE'])
    );
    expect(traceGraph.getDependencyHasKeyword(crossDependencyRef, 'REMOTE')).toBe(true);
    expect(traceGraph.getDependencyHasKeyword(crossDependencyRef, 'MISSING')).toBe(false);
    expect(traceGraph.getCrossDependencyEndpointId(crossDependencyRef)).toBe(
      crossDependency.endpointId
    );
    expect(traceGraph.getCrossDependencyStartRankNum(crossDependencyRef)).toBe(0);
    expect(traceGraph.getCrossDependencyEndRankNum(crossDependencyRef)).toBe(1);
    expect(traceGraph.getCrossDependencyTopology(crossDependencyRef)).toBe('ring');
    expect(traceGraph.getCrossDependencyWaiting(crossDependencyRef)).toBe(true);
    expect(traceGraph.getCrossDependencyWaitNotFinished(crossDependencyRef)).toBe(true);
    expect(traceGraph.getCrossDependencyEndpointId(encodeCrossDependencyRef(99))).toBeNull();

    const visibleCrossDependencyRef = traceGraph.getVisibleCrossDependencyRefs()[0]!;
    expect(traceGraph.getVisibleDependencyStartBlockId(visibleCrossDependencyRef)).toBe(
      blockA.spanId
    );
    expect(traceGraph.getVisibleDependencyEndBlockId(visibleCrossDependencyRef)).toBe(
      blockB.spanId
    );
    expect(traceGraph.getVisibleDependencyStartSpan(visibleCrossDependencyRef)).toBe(
      traceGraph.getSpanRefByExternalBlockId(blockA.spanId)
    );
    expect(traceGraph.getVisibleDependencyEndSpan(visibleCrossDependencyRef)).toBe(
      traceGraph.getSpanRefByExternalBlockId(blockB.spanId)
    );
    expect(traceGraph.getVisibleDependencyWaitMode(visibleCrossDependencyRef)).toBe('end-to-end');
    expect(traceGraph.getVisibleDependencyBidirectional(visibleCrossDependencyRef)).toBe(true);
    expect(traceGraph.getVisibleDependencyWaitTimeMs(visibleCrossDependencyRef)).toBe(7);
    expect(traceGraph.getVisibleDependencyKeywords(visibleCrossDependencyRef)).toEqual(
      new Set(['PARENT', 'REMOTE'])
    );
    expect(traceGraph.getVisibleDependencyHasKeyword(visibleCrossDependencyRef, 'REMOTE')).toBe(
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
        createLocalDependency('dep-root-parent', root.spanId, filteredParent.spanId, ['PARENT']),
        createLocalDependency('dep-parent-child', filteredParent.spanId, child.spanId, ['PARENT'])
      ]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});

    expect(
      getSpanRefProcessId(
        traceGraph.processIdsByIndex,
        traceGraph.getSpanRefByExternalBlockId(root.spanId)!
      )
    ).toBe('rank-1');
    expect(getSpanRefRowIndex(traceGraph.getSpanRefByExternalBlockId(root.spanId)!)).toBe(0);
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
    expect(
      Array.from(
        traceGraph.processSpanTableMap['rank-1' as TraceProcessId]
          ?.getChild('filter_mask')
          ?.toArray() ?? []
      )
    ).toEqual([0, TRACE_SPAN_FILTER_MASK_REGEXP, 0]);
    expect(isTraceGraphBlockFiltered(traceGraph, root)).toBe(false);
    expect(isTraceGraphBlockFiltered(traceGraph, filteredParent)).toBe(true);
    expect(
      traceGraph.spanFilterReason(getRequiredSpanRef(traceGraph, filteredParent)).filterMask
    ).toBe(TRACE_SPAN_FILTER_MASK_REGEXP);
    expect(getTraceGraphFilteredParentSpanId(traceGraph, filteredParent)).toBe(root.spanId);
    expect(getTraceGraphFilteredParentSpanId(traceGraph, child)).toBeNull();
  });

  it('resolves stitched visible local parent endpoint refs through filtered spans', () => {
    const root = createBlock('root');
    const filteredParent = createBlock('filtered-parent');
    const child = createBlock('child');
    const graph = createGraphWithBlocks(
      [root, filteredParent, child],
      [
        createLocalDependency('dep-root-parent', root.spanId, filteredParent.spanId, ['PARENT']),
        createLocalDependency('dep-parent-child', filteredParent.spanId, child.spanId, ['PARENT'])
      ]
    );
    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});
    const visibleDependency = traceGraph
      .getVisibleLocalDependencySources(getRequiredProcessRef(traceGraph, 'rank-1'))
      .find(dependency => dependency.endSpanId === child.spanId);

    expect(visibleDependency).toMatchObject({
      startSpanId: root.spanId,
      endSpanId: child.spanId
    });
    expect(visibleDependency?.dependencyRef).toBeDefined();
    expect(traceGraph.getVisibleDependencyStartSpan(visibleDependency!.dependencyRef!)).toBe(
      getRequiredSpanRef(traceGraph, root)
    );
    expect(traceGraph.getVisibleDependencyEndSpan(visibleDependency!.dependencyRef!)).toBe(
      getRequiredSpanRef(traceGraph, child)
    );
  });

  it('keeps visible local dependency refs process-scoped when dependency ids repeat', () => {
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
            localDependencies: [
              createLocalDependency(sharedDependencyId, rootA.spanId, childA.spanId)
            ]
          }),
          createProcess({
            processId: 'rank-b',
            rankNum: 1,
            threadId: 'thread-b',
            spans: [rootB, childB],
            localDependencies: [
              createLocalDependency(sharedDependencyId, rootB.spanId, childB.spanId)
            ]
          })
        ],
        [],
        {name: 'duplicate-local-dependency-id-test'}
      )
    );
    const processRefA = getRequiredProcessRef(traceGraph, 'rank-a');
    const processRefB = getRequiredProcessRef(traceGraph, 'rank-b');
    const dependencyRefA = traceGraph.getVisibleLocalDependencyRefs(processRefA)[0];
    const dependencyRefB = traceGraph.getVisibleLocalDependencyRefs(processRefB)[0];

    expect(dependencyRefA).toBeDefined();
    expect(dependencyRefB).toBeDefined();
    expect(dependencyRefB).not.toBe(dependencyRefA);
    expect(traceGraph.getVisibleLocalDependencyProcessRefByRef(dependencyRefA!)).toBe(processRefA);
    expect(traceGraph.getVisibleLocalDependencyProcessRefByRef(dependencyRefB!)).toBe(processRefB);
    expect(traceGraph.getVisibleDependencySourceByRef(dependencyRefA!)).toMatchObject({
      startSpanId: rootA.spanId,
      endSpanId: childA.spanId
    });
    expect(traceGraph.getVisibleDependencySourceByRef(dependencyRefB!)).toMatchObject({
      startSpanId: rootB.spanId,
      endSpanId: childB.spanId
    });
  });

  it('omits rewritten local dependencies that collapse onto one visible span', () => {
    const root = createBlock('root');
    const filteredParent = createBlock('filtered-parent');
    const graph = createGraphWithBlocks(
      [root, filteredParent],
      [
        createLocalDependency('dep-root-parent', root.spanId, filteredParent.spanId, ['PARENT']),
        createLocalDependency('dep-filtered-root', filteredParent.spanId, root.spanId)
      ]
    );
    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});

    expect(
      traceGraph
        .getVisibleProcessRefs()
        .flatMap(processRef => traceGraph.getVisibleLocalDependencyRefs(processRef))
        .filter(
          dependencyRef =>
            traceGraph.getVisibleDependencyIdByRef(dependencyRef) ===
            ('dep-filtered-root' as TraceDependencyId)
        )
    ).toEqual([]);
  });

  it('uses a zero filter-mask column for no-filter graphs', () => {
    const root = createBlock('root');
    const child = createBlock('child');
    const graph = createGraphWithBlocks([root, child], []);

    const traceGraph = createRuntimeTraceGraph(graph);
    const rootSpanRef = traceGraph.getSpanRefByExternalBlockId(root.spanId)!;

    expect(traceGraph.hasActiveSpanFilter()).toBe(false);
    expect(traceGraph.filteredSpanRefs.size).toBe(0);
    expect(
      Array.from(
        traceGraph.processSpanTableMap['rank-1' as TraceProcessId]
          ?.getChild('filter_mask')
          ?.toArray() ?? []
      )
    ).toEqual([0, 0]);
    expect(traceGraph.spanIsFiltered(rootSpanRef)).toBe(false);
    expect(isTraceGraphBlockFiltered(traceGraph, root)).toBe(false);
    expect(traceGraph.getVisibleBlockCount()).toBe(2);
  });

  it('filters short overlapping single-parent children while preserving stitched and source chains', () => {
    const root = createBlockForProcess({
      spanId: 'root',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 0,
      endTimeMs: 10
    });
    const overlappingChild = createBlockForProcess({
      spanId: 'overlapping-child',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 5,
      endTimeMs: 5
    });
    const grandchild = createBlockForProcess({
      spanId: 'grandchild',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 6,
      endTimeMs: 7
    });
    const graph = createGraphWithBlocks(
      [root, overlappingChild, grandchild],
      [
        createLocalDependency('dep-root-child', root.spanId, overlappingChild.spanId, ['PARENT']),
        createLocalDependency('dep-child-grandchild', overlappingChild.spanId, grandchild.spanId, [
          'PARENT'
        ])
      ]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {
      overlappingParentSpanFilter: {maxChildDurationMs: 1}
    });

    expect(isTraceGraphBlockFiltered(traceGraph, overlappingChild)).toBe(true);
    expect(isTraceGraphBlockFiltered(traceGraph, grandchild)).toBe(false);
    expect(
      traceGraph.spanFilterReason(getRequiredSpanRef(traceGraph, overlappingChild)).filterMask
    ).toBe(TRACE_SPAN_FILTER_MASK_TOPOLOGY);
    expect(traceGraph.filteredSpanCountsByFilter).toEqual({
      spanFilterCount: 0,
      overlappingParentSpanFilterCount: 1,
      similarDurationChainSpanFilterCount: 0
    });
    expect(buildTraceFilterSummary([traceGraph]).filteredSpanCountsByFilter).toEqual({
      spanFilterCount: 0,
      overlappingParentSpanFilterCount: 1,
      similarDurationChainSpanFilterCount: 0
    });
    expect(
      getTraceGraphDependencyChainForBlock(traceGraph, grandchild, 'PARENT').map(
        span => span.spanId
      )
    ).toEqual([overlappingChild.spanId, root.spanId]);
    expect(
      getTraceGraphVisibleDependencyChainForBlock(traceGraph, grandchild, 'PARENT').map(
        span => span.spanId
      )
    ).toEqual([root.spanId]);
  });

  it('keeps short children visible when they do not overlap their only parent', () => {
    const root = createBlockForProcess({
      spanId: 'root',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 0,
      endTimeMs: 1
    });
    const nonOverlappingChild = createBlockForProcess({
      spanId: 'non-overlapping-child',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 2,
      endTimeMs: 2
    });
    const graph = createGraphWithBlocks(
      [root, nonOverlappingChild],
      [createLocalDependency('dep-root-child', root.spanId, nonOverlappingChild.spanId, ['PARENT'])]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {
      overlappingParentSpanFilter: {maxChildDurationMs: 1}
    });

    expect(isTraceGraphBlockFiltered(traceGraph, nonOverlappingChild)).toBe(false);
  });

  it('attributes overlapping filter matches to the first filter stage that removed them', () => {
    const root = createBlockForProcess({
      spanId: 'root',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 0,
      endTimeMs: 10
    });
    const filteredOverlappingChild = createBlockForProcess({
      spanId: 'filtered-overlapping-child',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 5,
      endTimeMs: 5
    });
    const graph = createGraphWithBlocks(
      [root, filteredOverlappingChild],
      [
        createLocalDependency('dep-root-child', root.spanId, filteredOverlappingChild.spanId, [
          'PARENT'
        ])
      ]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {
      spanFilters: ['filtered-overlapping'],
      overlappingParentSpanFilter: {maxChildDurationMs: 1}
    });

    expect(traceGraph.filteredSpanCountsByFilter).toEqual({
      spanFilterCount: 1,
      overlappingParentSpanFilterCount: 0,
      similarDurationChainSpanFilterCount: 0
    });
    expect(
      traceGraph.spanFilterReason(getRequiredSpanRef(traceGraph, filteredOverlappingChild))
        .filterMask
    ).toBe(TRACE_SPAN_FILTER_MASK_REGEXP | TRACE_SPAN_FILTER_MASK_TOPOLOGY);
  });

  it('keeps overlapping children visible when they have multiple local parents', () => {
    const firstParent = createBlockForProcess({
      spanId: 'first-parent',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 0,
      endTimeMs: 10
    });
    const secondParent = createBlockForProcess({
      spanId: 'second-parent',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 0,
      endTimeMs: 10
    });
    const overlappingChild = createBlockForProcess({
      spanId: 'overlapping-child',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 5,
      endTimeMs: 5
    });
    const graph = createGraphWithBlocks(
      [firstParent, secondParent, overlappingChild],
      [
        createLocalDependency('dep-first-child', firstParent.spanId, overlappingChild.spanId, [
          'PARENT'
        ]),
        createLocalDependency('dep-second-child', secondParent.spanId, overlappingChild.spanId, [
          'PARENT'
        ])
      ]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {
      overlappingParentSpanFilter: {maxChildDurationMs: 1}
    });

    expect(isTraceGraphBlockFiltered(traceGraph, overlappingChild)).toBe(false);
  });

  it('collapses similar-duration non-branching parent chains down to their terminal span', () => {
    const oldestParent = createBlockForProcess({
      spanId: 'oldest-parent',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 0,
      endTimeMs: 100
    });
    const middleParent = createBlockForProcess({
      spanId: 'middle-parent',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 1,
      endTimeMs: 102
    });
    const nearestParent = createBlockForProcess({
      spanId: 'nearest-parent',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 2,
      endTimeMs: 101
    });
    const terminal = createBlockForProcess({
      spanId: 'terminal',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 3,
      endTimeMs: 103
    });
    const graph = createGraphWithBlocks(
      [oldestParent, middleParent, nearestParent, terminal],
      [
        createLocalDependency('dep-oldest-middle', oldestParent.spanId, middleParent.spanId, [
          'PARENT'
        ]),
        createLocalDependency('dep-middle-nearest', middleParent.spanId, nearestParent.spanId, [
          'PARENT'
        ]),
        createLocalDependency('dep-nearest-terminal', nearestParent.spanId, terminal.spanId, [
          'PARENT'
        ])
      ]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {
      similarDurationChainSpanFilter: {maxRelativeDurationDelta: 0.1}
    });

    expect(isTraceGraphBlockFiltered(traceGraph, oldestParent)).toBe(true);
    expect(isTraceGraphBlockFiltered(traceGraph, middleParent)).toBe(true);
    expect(isTraceGraphBlockFiltered(traceGraph, nearestParent)).toBe(true);
    expect(isTraceGraphBlockFiltered(traceGraph, terminal)).toBe(false);
    expect(
      traceGraph.spanFilterReason(getRequiredSpanRef(traceGraph, nearestParent)).filterMask
    ).toBe(TRACE_SPAN_FILTER_MASK_TOPOLOGY);
    expect(traceGraph.filteredSpanCountsByFilter).toEqual({
      spanFilterCount: 0,
      overlappingParentSpanFilterCount: 0,
      similarDurationChainSpanFilterCount: 3
    });
    expect(buildTraceFilterSummary([traceGraph]).filteredSpanCountsByFilter).toEqual({
      spanFilterCount: 0,
      overlappingParentSpanFilterCount: 0,
      similarDurationChainSpanFilterCount: 3
    });
    expect(
      getTraceGraphDependencyChainForBlock(traceGraph, terminal, 'PARENT').map(span => span.spanId)
    ).toEqual([nearestParent.spanId, middleParent.spanId, oldestParent.spanId]);
    expect(
      getTraceGraphVisibleDependencyChainForBlock(traceGraph, terminal, 'PARENT').map(
        span => span.spanId
      )
    ).toEqual([]);
  });

  it('keeps parent chains visible when their durations drift beyond the similarity threshold', () => {
    const parent = createBlockForProcess({
      spanId: 'parent',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 0,
      endTimeMs: 100
    });
    const terminal = createBlockForProcess({
      spanId: 'terminal',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 0,
      endTimeMs: 130
    });
    const graph = createGraphWithBlocks(
      [parent, terminal],
      [createLocalDependency('dep-parent-terminal', parent.spanId, terminal.spanId, ['PARENT'])]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {
      similarDurationChainSpanFilter: {maxRelativeDurationDelta: 0.1}
    });

    expect(isTraceGraphBlockFiltered(traceGraph, parent)).toBe(false);
    expect(isTraceGraphBlockFiltered(traceGraph, terminal)).toBe(false);
  });

  it('collapses a similar-duration parent run before a later dissimilar continuation', () => {
    const oldestParent = createBlockForProcess({
      spanId: 'oldest-parent',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 0,
      endTimeMs: 100
    });
    const candidateParent = createBlockForProcess({
      spanId: 'candidate-parent',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 1,
      endTimeMs: 101
    });
    const dissimilarChild = createBlockForProcess({
      spanId: 'dissimilar-child',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 1,
      endTimeMs: 131
    });
    const graph = createGraphWithBlocks(
      [oldestParent, candidateParent, dissimilarChild],
      [
        createLocalDependency('dep-oldest-candidate', oldestParent.spanId, candidateParent.spanId, [
          'PARENT'
        ]),
        createLocalDependency(
          'dep-candidate-dissimilar',
          candidateParent.spanId,
          dissimilarChild.spanId,
          ['PARENT']
        )
      ]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {
      similarDurationChainSpanFilter: {maxRelativeDurationDelta: 0.1}
    });

    expect(isTraceGraphBlockFiltered(traceGraph, oldestParent)).toBe(true);
    expect(isTraceGraphBlockFiltered(traceGraph, candidateParent)).toBe(false);
    expect(isTraceGraphBlockFiltered(traceGraph, dissimilarChild)).toBe(false);
  });

  it('keeps branch-point parents visible when similar-duration chains split', () => {
    const sharedParent = createBlockForProcess({
      spanId: 'shared-parent',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 0,
      endTimeMs: 100
    });
    const leftTerminal = createBlockForProcess({
      spanId: 'left-terminal',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 0,
      endTimeMs: 100
    });
    const rightTerminal = createBlockForProcess({
      spanId: 'right-terminal',
      processId: 'rank-1',
      threadId: 'thread-1',
      startTimeMs: 0,
      endTimeMs: 100
    });
    const graph = createGraphWithBlocks(
      [sharedParent, leftTerminal, rightTerminal],
      [
        createLocalDependency('dep-parent-left', sharedParent.spanId, leftTerminal.spanId, [
          'PARENT'
        ]),
        createLocalDependency('dep-parent-right', sharedParent.spanId, rightTerminal.spanId, [
          'PARENT'
        ])
      ]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {
      similarDurationChainSpanFilter: {maxRelativeDurationDelta: 0.1}
    });

    expect(isTraceGraphBlockFiltered(traceGraph, sharedParent)).toBe(false);
    expect(isTraceGraphBlockFiltered(traceGraph, leftTerminal)).toBe(false);
    expect(isTraceGraphBlockFiltered(traceGraph, rightTerminal)).toBe(false);
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
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const traceGraph = createTestTraceGraph({
      ...traceGraphData,
      chunks: traceGraphData.chunks.map(chunk => ({
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
    const crossDependencyRef = encodeCrossDependencyRef(0);

    expect(eventRef).toBeTruthy();
    expect(instantRef).toBeTruthy();
    expect(counterRef).toBeTruthy();
    expect(traceGraph.getChunkByRef(eventRef!)?.chunkKey).toBe('rank-a');
    expect(traceGraph.getChunkByRef(crossDependencyRef)?.chunkKey).toBe('rank-a');
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
    const traceGraph = createTestTraceGraph(
      buildTraceGraphDataFromJSONTrace(
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
      )
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
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
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
      chunkIndex: 0,
      chunkRef: encodeChunkRef(0),
      chunkKey: 'shared-chunk',
      processRefs: [processRefA, processRefB],
      processId: null,
      spanTable: sharedSpanTable,
      localDependencyTable: traceGraphData.localDependencyTableMap['rank-a' as TraceProcessId]!
    };
    const traceGraph = createTestTraceGraph({
      ...traceGraphData,
      chunks: [sharedChunk],
      processSpanTableMap: buildTraceProcessSpanRefTables([sharedChunk], traceGraphData.processes, {
        processIdsByIndex: traceGraphData.processIdsByIndex
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
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
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
      chunkIndex: 0,
      chunkRef: encodeChunkRef(0),
      chunkKey: 'chunk-shared',
      processRefs: [processRefA, processRefB],
      processId: null,
      spanTable: storeSpanTable,
      localDependencyTable: traceGraphData.localDependencyTableMap['rank-a' as TraceProcessId]!
    };
    const traceGraph = createTestTraceGraph(
      {
        ...traceGraphData,
        chunks: [sharedChunk],
        processSpanTableMap: buildTraceProcessSpanRefTables(
          [sharedChunk],
          traceGraphData.processes,
          {
            processIdsByIndex: traceGraphData.processIdsByIndex
          }
        )
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
        createLocalDependency('dep-root-parent', root.spanId, filteredParent.spanId, ['PARENT']),
        createLocalDependency('dep-parent-child', filteredParent.spanId, child.spanId, ['PARENT'])
      ]
    );
    const traceGraph = createRuntimeTraceGraph(graph, {
      spanFilters: ['filtered-parent']
    });

    expect(traceGraph.getVisibleProcessRefs()).toEqual([
      getRequiredProcessRef(traceGraph, 'rank-1')
    ]);
    expect(traceGraph.getVisibleBlockCount()).toBe(2);
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
          localDependencies: [
            createLocalDependency('dep-a-b', rank1BlockA.spanId, rank1BlockB.spanId),
            createLocalDependency('dep-b-c', rank1BlockB.spanId, rank1BlockC.spanId)
          ]
        }),
        createProcess({
          processId: 'rank-2',
          rankNum: 1,
          threadId: 'thread-2',
          spans: [rank2BlockA, rank2BlockB],
          localDependencies: [
            createLocalDependency('dep-remote-a-b', rank2BlockA.spanId, rank2BlockB.spanId)
          ]
        })
      ],
      [
        createCrossDependency(
          'dep-c-remote-a',
          'endpoint-c-remote-a',
          rank1BlockC.spanId,
          rank2BlockA.spanId,
          0,
          1,
          'rpc'
        ),
        createCrossDependency(
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
    const visibleIndex = getVisibleIndexForTest(traceGraph);

    expect(visibleIndex.visibleLocalDependencyIdsByProcessId).toEqual({
      ['rank-1' as TraceProcessId]: [
        'dep-a-b' as TraceDependencyId,
        'dep-b-c' as TraceDependencyId
      ],
      ['rank-2' as TraceProcessId]: ['dep-remote-a-b' as TraceDependencyId]
    });
    expect(visibleIndex.visibleCrossDependencyIds).toEqual([
      'dep-c-remote-a' as TraceDependencyId,
      'dep-a-remote-b' as TraceDependencyId
    ]);
    expect(
      traceGraph.getVisibleLocalDependencySources(getRequiredProcessRef(traceGraph, 'rank-1'))
    ).toEqual(
      graph.processes[0]?.localDependencies?.map(dependency =>
        expect.objectContaining({
          dependencyId: dependency.dependencyId,
          type: dependency.type,
          waitTimeMs: dependency.waitTimeMs
        })
      )
    );
    expect(traceGraph.getVisibleCrossDependencySources()).toEqual(
      traceGraph.crossDependencies.map(dependency =>
        expect.objectContaining({
          dependencyId: dependency.dependencyId,
          type: dependency.type,
          waitTimeMs: dependency.waitTimeMs
        })
      )
    );
    const visibleDependencyIdsForBlock = (span: TraceSpan) =>
      visibleIndex.visibleDependencyRefsBySpanRef
        .get(getRequiredSpanRefBySpanId(traceGraph, span.spanId))
        ?.map(dependencyRef => traceGraph.getVisibleDependencyIdByRef(dependencyRef as never));
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
      'dep-remote-a-b' as TraceDependencyId,
      'dep-c-remote-a' as TraceDependencyId
    ]);
    expect(visibleDependencyIdsForBlock(rank2BlockB)).toEqual([
      'dep-remote-a-b' as TraceDependencyId,
      'dep-a-remote-b' as TraceDependencyId
    ]);
  });

  it('resolves unfiltered local dependency sources from Arrow tables when process objects are empty', () => {
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
    const warningDependency: TraceLocalDependency = {
      type: 'trace-local-dependency',
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
          localDependencies: [warningDependency]
        })
      ],
      [],
      {name: 'arrow-only-local-dependency-source'}
    );
    const traceGraph = createRuntimeTraceGraph(graph);
    traceGraph.processes[0]!.localDependencies = [];

    const dependency = traceGraph.getVisibleLocalDependencySources(
      getRequiredProcessRef(traceGraph, 'rank-1')
    )[0];

    expect(dependency).toEqual(
      expect.objectContaining({
        dependencyId: warningDependency.dependencyId,
        startSpanId: warningDependency.startSpanId,
        endSpanId: warningDependency.endSpanId,
        waitTimeMs: warningDependency.waitTimeMs
      })
    );
    expect(dependency?.keywords.has('SUBMIT')).toBe(true);
    expect(dependency ? getDependencyLineColor(dependency, {} as never) : null).toEqual(
      TRACE_COLOR.WARNING_DEPENDENCY_LINE
    );
  });

  it('keeps filtered dependency behavior on ref-native dependency accessors', () => {
    const root = createBlock('root');
    const filteredParent = createBlock('filtered-parent');
    const child = createBlock('child');
    const graph = createGraphWithBlocks(
      [root, filteredParent, child],
      [
        createLocalDependency('dep-root-parent', root.spanId, filteredParent.spanId, ['PARENT']),
        createLocalDependency('dep-parent-child', filteredParent.spanId, child.spanId, ['CHAIN'])
      ]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});

    expect(
      traceGraph.getDisplaySourceBySpanRef(
        getRequiredSpanRefBySpanId(traceGraph, filteredParent.spanId)
      )?.localDependencyIds
    ).toEqual(['dep-root-parent', 'dep-parent-child']);
  });

  it('preserves filtering behavior when the source graph is Arrow-backed', () => {
    const root = createBlock('root');
    const filteredParent = createBlock('filtered-parent');
    const child = createBlock('child');
    const graph = createGraphWithBlocks(
      [root, filteredParent, child],
      [
        createLocalDependency('dep-root-parent', root.spanId, filteredParent.spanId, ['PARENT']),
        createLocalDependency('dep-parent-child', filteredParent.spanId, child.spanId, ['PARENT'])
      ]
    );

    const plainTraceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const traceGraphDataGraph = createTestTraceGraph(traceGraphData, {
      spanFilters: ['filtered']
    });

    expect(
      getSpanRefProcessId(
        plainTraceGraph.processIdsByIndex,
        plainTraceGraph.getSpanRefByExternalBlockId(child.spanId)!
      )
    ).toBe('rank-1');
    expect(getSpanRefRowIndex(plainTraceGraph.getSpanRefByExternalBlockId(child.spanId)!)).toBe(2);
    expect(plainTraceGraph.processSpanTableMap).not.toBe(traceGraphData.processSpanTableMap);
    expect(traceGraphDataGraph.processSpanTableMap).not.toBe(traceGraphData.processSpanTableMap);
    expect(traceGraphDataGraph.processIdsByIndex).toBe(traceGraphData.processIdsByIndex);
    expect(
      Array.from(
        traceGraphDataGraph.processSpanTableMap['rank-1' as TraceProcessId]
          ?.getChild('filter_mask')
          ?.toArray() ?? []
      )
    ).toEqual(
      Array.from(
        plainTraceGraph.processSpanTableMap['rank-1' as TraceProcessId]
          ?.getChild('filter_mask')
          ?.toArray() ?? []
      )
    );
    expect(getVisibleProcessSnapshot(traceGraphDataGraph)).toEqual(
      getVisibleProcessSnapshot(plainTraceGraph)
    );
    expect(traceGraphDataGraph.getVisibleCrossDependencySources()).toEqual(
      plainTraceGraph.getVisibleCrossDependencySources()
    );
    expect(isTraceGraphBlockFiltered(traceGraphDataGraph, filteredParent)).toBe(
      isTraceGraphBlockFiltered(plainTraceGraph, filteredParent)
    );
    expect(getTraceGraphFilteredParentSpanId(traceGraphDataGraph, filteredParent)).toBe(
      getTraceGraphFilteredParentSpanId(plainTraceGraph, filteredParent)
    );
    expect(
      getTraceGraphVisibleDependencyChainForBlock(traceGraphDataGraph, child, 'PARENT')
    ).toEqual(getTraceGraphVisibleDependencyChainForBlock(plainTraceGraph, child, 'PARENT'));
    expect(traceGraphDataGraph.getFilteredSpanCountByThreadRef()).toEqual(
      plainTraceGraph.getFilteredSpanCountByThreadRef()
    );
    expect(traceGraphDataGraph.getVisibleBlockSearchRecords()).toEqual(
      plainTraceGraph.getVisibleBlockSearchRecords()
    );
  });

  it('preserves filtering behavior when Arrow processes omit compatibility spans', () => {
    const root = createBlock('root');
    const filteredParent = createBlock('filtered-parent');
    const child = createBlock('child');
    const graph = createGraphWithBlocks(
      [root, filteredParent, child],
      [
        createLocalDependency('dep-root-parent', root.spanId, filteredParent.spanId, ['PARENT']),
        createLocalDependency('dep-parent-child', filteredParent.spanId, child.spanId, ['PARENT'])
      ]
    );

    const plainTraceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});
    const traceGraphData = createArrowGraphWithoutCompatibilityBlocks(graph);
    const traceGraphDataGraph = createTestTraceGraph(traceGraphData, {
      spanFilters: ['filtered']
    });

    expect('spanMap' in traceGraphData).toBe(false);
    expect(traceGraphData.processes.every(process => !('spans' in process))).toBe(true);
    expect(traceGraphData.processes[0]).not.toHaveProperty('spans');
    expect(isTraceGraphBlockFiltered(traceGraphDataGraph, filteredParent)).toBe(true);
    expect(
      getTraceGraphVisibleDependencyChainForBlock(traceGraphDataGraph, child, 'PARENT').map(
        span => span.spanId
      )
    ).toEqual(
      getTraceGraphVisibleDependencyChainForBlock(plainTraceGraph, child, 'PARENT').map(
        span => span.spanId
      )
    );
    expect(getVisibleProcessSnapshot(traceGraphDataGraph)).toEqual(
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
          localDependencies: [
            createLocalDependency('dep-root-parent', root.spanId, filteredParent.spanId, [
              'PARENT'
            ]),
            createLocalDependency('dep-parent-child', filteredParent.spanId, child.spanId, [
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
        createCrossDependency(
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
    const metadataOnlyArrowTraceGraph = createTestTraceGraph(
      createArrowGraphWithoutCompatibilityBlocks(graph),
      {
        spanFilters: ['filtered']
      }
    );

    expect(getVisibleIndexForTest(metadataOnlyArrowTraceGraph)).toEqual(
      getVisibleIndexForTest(plainTraceGraph)
    );
    expect(
      metadataOnlyArrowTraceGraph
        .getVisibleCrossDependencySources()
        .map(dependency => dependency.dependencyId)
    ).toEqual(
      plainTraceGraph.getVisibleCrossDependencySources().map(dependency => dependency.dependencyId)
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

  it('preserves filtered unresolved endpoint pairing and matched cross dependencies', () => {
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
        createCrossDependency(
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

  it('reuses visible process and dependency arrays across repeated filtered reads', () => {
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
      localDependencies: [
        createLocalDependency('dep-root-parent', root.spanId, filteredParent.spanId, ['PARENT']),
        createLocalDependency('dep-parent-child', filteredParent.spanId, child.spanId, ['PARENT'])
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
        createCrossDependency(
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
    const visibleBlocks = traceGraph.getVisibleProcessDisplaySources(rank1ProcessRef);
    const visibleBlocksAgain = traceGraph.getVisibleProcessDisplaySources(rank1ProcessRef);
    const visibleGeometryBlocks = traceGraph.getVisibleProcessGeometrySources(rank1ProcessRef);
    const visibleGeometryBlocksAgain = traceGraph.getVisibleProcessGeometrySources(rank1ProcessRef);
    const visibleRenderSpans = traceGraph.getVisibleProcessRenderSpans(rank1ProcessRef);
    const visibleRenderSpansAgain = traceGraph.getVisibleProcessRenderSpans(rank1ProcessRef);
    const remoteVisibleBlocks = traceGraph.getVisibleProcessDisplaySources(rank2ProcessRef);
    const remoteVisibleGeometryBlocks =
      traceGraph.getVisibleProcessGeometrySources(rank2ProcessRef);
    const visibleLocalDependencies =
      traceGraph.getVisibleLocalDependencyLayoutSources(rank1ProcessRef);
    const visibleLocalDependenciesAgain =
      traceGraph.getVisibleLocalDependencyLayoutSources(rank1ProcessRef);
    const visibleTraceLocalDependencies =
      traceGraph.getVisibleLocalDependencySources(rank1ProcessRef);
    const visibleTraceLocalDependenciesAgain =
      traceGraph.getVisibleLocalDependencySources(rank1ProcessRef);
    const visibleCrossDependencies = traceGraph.getVisibleCrossDependencySources();
    const visibleCrossDependenciesAgain = traceGraph.getVisibleCrossDependencySources();

    expect(visibleBlocksAgain).toBe(visibleBlocks);
    expect(visibleGeometryBlocksAgain).toBe(visibleGeometryBlocks);
    expect(visibleRenderSpansAgain).toBe(visibleRenderSpans);
    expect(visibleBlocks.map(span => span.spanId)).toEqual([root.spanId, child.spanId]);
    expect(visibleGeometryBlocks.map(span => span.spanId)).toEqual([root.spanId, child.spanId]);
    expect(visibleRenderSpans.map(span => span.spanId)).toEqual([root.spanId, child.spanId]);
    expect(remoteVisibleBlocks.map(span => span.spanId)).toEqual([remote.spanId]);
    expect(remoteVisibleGeometryBlocks.map(span => span.spanId)).toEqual([remote.spanId]);
    expect(visibleLocalDependenciesAgain).toBe(visibleLocalDependencies);
    expect(visibleLocalDependencies.map(dependency => dependency.dependencyId)).toEqual([
      'dep-parent-child'
    ]);
    expect(visibleTraceLocalDependenciesAgain).toBe(visibleTraceLocalDependencies);
    expect(visibleTraceLocalDependencies.map(dependency => dependency.dependencyId)).toEqual([
      'dep-parent-child'
    ]);
    expect(visibleCrossDependenciesAgain).toBe(visibleCrossDependencies);
    expect(visibleCrossDependencies.map(dependency => dependency.dependencyId)).toEqual([
      'dep-root-remote'
    ]);
  });

  it('resolves visible display sources consistently before and after process display materialization', () => {
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
    const process = createProcess({
      processId: 'rank-1',
      rankNum: 0,
      threadId: 'thread-1',
      spans: [root, filteredParent, child],
      localDependencies: [
        createLocalDependency('dep-root-parent', root.spanId, filteredParent.spanId, ['PARENT']),
        createLocalDependency('dep-parent-child', filteredParent.spanId, child.spanId, ['PARENT'])
      ]
    });
    const graph = buildJSONTrace([process], [], {name: 'visible-display-source-cache-test'});

    const lookupFirstTraceGraph = createRuntimeTraceGraph(graph, {
      spanFilters: ['filtered-parent']
    });
    const lookupFirstProcessRef = getRequiredProcessRef(lookupFirstTraceGraph, 'rank-1');
    const childLookupBeforeArray = getRequiredVisibleDisplaySourceBySpanId(
      lookupFirstTraceGraph,
      child.spanId
    );
    const displaySourcesAfterLookup =
      lookupFirstTraceGraph.getVisibleProcessDisplaySources(lookupFirstProcessRef);
    const childLookupAfterArray = getRequiredVisibleDisplaySourceBySpanId(
      lookupFirstTraceGraph,
      child.spanId
    );

    expect(childLookupBeforeArray).not.toBeNull();
    expect(displaySourcesAfterLookup).toContain(childLookupBeforeArray);
    expect(childLookupAfterArray).toBe(childLookupBeforeArray);

    const arrayFirstTraceGraph = createRuntimeTraceGraph(graph, {
      spanFilters: ['filtered-parent']
    });
    const arrayFirstProcessRef = getRequiredProcessRef(arrayFirstTraceGraph, 'rank-1');
    const displaySourcesBeforeLookup =
      arrayFirstTraceGraph.getVisibleProcessDisplaySources(arrayFirstProcessRef);
    const childLookupAfterArrayBuild = getRequiredVisibleDisplaySourceBySpanId(
      arrayFirstTraceGraph,
      child.spanId
    );

    expect(childLookupAfterArrayBuild).toBe(displaySourcesBeforeLookup[1]);
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
      literalTraceGraph
        .getVisibleProcessDisplaySources(getRequiredProcessRef(literalTraceGraph, 'rank-1'))
        .map(span => span.name)
    ).toEqual(['executeRpc-1', 'renderUi']);
    expect(
      regexTraceGraph
        .getVisibleProcessDisplaySources(getRequiredProcessRef(regexTraceGraph, 'rank-1'))
        .map(span => span.name)
    ).toEqual(['rpc.request_worker', 'renderUi']);
    expect(
      invalidRegexTraceGraph
        .getVisibleProcessDisplaySources(getRequiredProcessRef(invalidRegexTraceGraph, 'rank-1'))
        .map(span => span.name)
    ).toEqual(['rpc.request_worker', 'executeRpc-1', 'renderUi']);
  });

  it('caches filtered span counts by thread id and treats blank filters as inactive', () => {
    const thread1Visible = createBlockForProcess({
      spanId: 'visible-thread-1',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const thread1Filtered = createBlockForProcess({
      spanId: 'filtered-thread-1',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const thread2FilteredA = createBlockForProcess({
      spanId: 'filtered-thread-2-a',
      processId: 'rank-2',
      threadId: 'thread-2'
    });
    const thread2FilteredB = createBlockForProcess({
      spanId: 'filtered-thread-2-b',
      processId: 'rank-2',
      threadId: 'thread-2'
    });

    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-1',
          rankNum: 0,
          threadId: 'thread-1',
          spans: [thread1Visible, thread1Filtered]
        }),
        createProcess({
          processId: 'rank-2',
          rankNum: 1,
          threadId: 'thread-2',
          spans: [thread2FilteredA, thread2FilteredB]
        })
      ],
      [],
      {name: 'filtered-counts'}
    );

    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});
    const spanIsFilteredSpy = vi.spyOn(traceGraph, 'spanIsFiltered');
    const filteredCounts = traceGraph.getFilteredSpanCountByThreadRef();

    expect(filteredCounts).toEqual(
      new Map([
        [getRequiredThreadRef(traceGraph, 'thread-1'), 1],
        [getRequiredThreadRef(traceGraph, 'thread-2'), 2]
      ])
    );
    expect(spanIsFilteredSpy).not.toHaveBeenCalled();
    expect(traceGraph.getFilteredSpanCountByThreadRef()).toBe(filteredCounts);
    spanIsFilteredSpy.mockRestore();

    const untraceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['   ']});
    expect(untraceGraph.hasActiveSpanFilter()).toBe(false);
    expect(untraceGraph.getFilteredSpanCountByThreadRef()).toEqual(new Map());
  });

  it('uses spanIsFiltered for filtered span counts when a trace store owns filtering', () => {
    const thread1Visible = createBlockForProcess({
      spanId: 'store-visible-thread-1',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const thread1Filtered = createBlockForProcess({
      spanId: 'store-filtered-thread-1',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const thread2Filtered = createBlockForProcess({
      spanId: 'store-filtered-thread-2',
      processId: 'rank-2',
      threadId: 'thread-2'
    });

    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-1',
          rankNum: 0,
          threadId: 'thread-1',
          spans: [thread1Visible, thread1Filtered]
        }),
        createProcess({
          processId: 'rank-2',
          rankNum: 1,
          threadId: 'thread-2',
          spans: [thread2Filtered]
        })
      ],
      [],
      {name: 'store-filtered-counts'}
    );
    let storeFilteredSpanRefs = new Set<SpanRef>();
    const traceStore = {
      isFiltered: vi.fn((spanRef: SpanRef) => storeFilteredSpanRefs.has(spanRef)),
      getFilterReason: vi.fn((spanRef: SpanRef) => {
        const isFiltered = storeFilteredSpanRefs.has(spanRef);
        return {
          filterMask: isFiltered ? TRACE_SPAN_FILTER_MASK_REGEXP : TRACE_SPAN_FILTER_MASK_NONE,
          isFiltered,
          state: isFiltered ? 'filtered' : 'visible'
        } as const;
      }),
      hasActiveSourceSpanFilter: vi.fn(() => true)
    };
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const traceGraph = new TraceGraph({traceGraphData, traceStore});
    storeFilteredSpanRefs = new Set([
      getRequiredSpanRef(traceGraph, thread1Filtered),
      getRequiredSpanRef(traceGraph, thread2Filtered)
    ]);
    const spanIsFilteredSpy = vi.spyOn(traceGraph, 'spanIsFiltered');

    const filteredCounts = traceGraph.getFilteredSpanCountByThreadRef();

    expect(filteredCounts).toEqual(
      new Map([
        [getRequiredThreadRef(traceGraph, 'thread-1'), 1],
        [getRequiredThreadRef(traceGraph, 'thread-2'), 1]
      ])
    );
    expect(spanIsFilteredSpy).toHaveBeenCalled();
    expect(traceStore.isFiltered).toHaveBeenCalled();
    spanIsFilteredSpy.mockRestore();
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
          localDependencies: [
            createLocalDependency(
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
        createCrossDependency(
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
      filteredSpanCountsByFilter: {
        spanFilterCount: 2,
        overlappingParentSpanFilterCount: 0,
        similarDurationChainSpanFilterCount: 0
      },
      visibleLocalDependencyCount: 0,
      totalLocalDependencyCount: 1,
      filteredLocalDependencyCount: 1,
      visibleCrossDependencyCount: 0,
      totalCrossDependencyCount: 1,
      filteredCrossDependencyCount: 1,
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
      filteredSpanCountsByFilter: {
        spanFilterCount: 0,
        overlappingParentSpanFilterCount: 0,
        similarDurationChainSpanFilterCount: 0
      },
      visibleLocalDependencyCount: 0,
      totalLocalDependencyCount: 0,
      filteredLocalDependencyCount: 0,
      visibleCrossDependencyCount: 0,
      totalCrossDependencyCount: 0,
      filteredCrossDependencyCount: 0,
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
      filteredSpanCountsByFilter: {
        spanFilterCount: 2,
        overlappingParentSpanFilterCount: 0,
        similarDurationChainSpanFilterCount: 0
      },
      visibleLocalDependencyCount: 0,
      totalLocalDependencyCount: 0,
      filteredLocalDependencyCount: 0,
      visibleCrossDependencyCount: 0,
      totalCrossDependencyCount: 0,
      filteredCrossDependencyCount: 0,
      hasFilteredItems: true
    });
  });
});
