import {describe, expect, it, vi} from 'vitest';

import {buildTraceGraphDataFromJSONTrace} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {
  getArrowTraceSpanMaterializationCount,
  resetArrowTraceSpanMaterializationCount
} from '../trace-graph-accessors';
import {TraceGraph} from './trace-graph';
import {
  createBlock,
  createBlockForProcess,
  createCrossDependency,
  createDuplicateIdChildDependencyGraph,
  createDuplicateIdParentlessSelectionGraph,
  createDuplicateIdSelectionTraversalGraph,
  createGraphWithBlocks,
  createLocalDependency,
  createProcess,
  createProcessAwareSelectedCardGraph,
  createRuntimeTraceGraph
} from './trace-graph-test-fixtures';
import {
  getRequiredProcessRef,
  getRequiredSpanRef,
  getRequiredThreadRef,
  getRequiredVisibleDisplaySourceBySpanId,
  getTraceGraphChildDependencies,
  getTraceGraphDependencyChainForBlock,
  getTraceGraphDescendants,
  getTraceGraphEndpointsWithDependencies,
  getTraceGraphIncomingDependencyEntries,
  getTraceGraphParentChainEntries,
  getTraceGraphProcessForBlock,
  getTraceGraphSpanDependencies,
  getTraceGraphThreadForBlock,
  getTraceGraphVisibleDependencyChainForBlock,
  isTraceGraphBlockFiltered
} from './trace-graph-test-utils';
import {TRACE_SPAN_FILTER_MASK_NONE, TRACE_SPAN_FILTER_MASK_REGEXP} from './trace-graph-types';
import {encodeVisibleCrossDependencyRef, encodeVisibleLocalDependencyRef} from './trace-id-encoder';

import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceDependencyId,
  TraceLocalDependency,
  TracePath,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
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

describe('TraceGraph selection and search', () => {
  it('builds cached visible span search records with resolved names and normalized text', () => {
    const visibleBlock = createBlockForProcess({
      spanId: 'visible-span',
      processId: 'rank-visible',
      threadId: 'thread-visible'
    });
    visibleBlock.name = 'visible-op';
    visibleBlock.keywords = ['alpha', 'beta'];
    visibleBlock.timings.test.startTimeMs = 12;
    visibleBlock.timings.test.endTimeMs = 16;
    visibleBlock.timings.test.durationMs = 4;
    visibleBlock.timings.test.durationMsAsString = '4ms';

    const filteredBlock = createBlockForProcess({
      spanId: 'filtered-span',
      processId: 'rank-visible',
      threadId: 'thread-visible'
    });
    filteredBlock.name = 'filtered-op';

    const visibleProcess = {
      ...createProcess({
        processId: 'rank-visible',
        rankNum: 0,
        threadId: 'thread-visible',
        spans: [visibleBlock, filteredBlock]
      }),
      name: 'visible-process',
      threads: [
        {
          type: 'trace-thread' as const,
          name: 'visible-thread',
          threadId: 'thread-visible' as TraceThreadId,
          processId: 'rank-visible'
        }
      ]
    } satisfies TraceProcess;
    visibleProcess.threadMap = {
      ['thread-visible' as TraceThreadId]: visibleProcess.threads[0]!
    };

    const graph = buildJSONTrace([visibleProcess], [], {name: 'visible-search-records'});
    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});

    const searchRecords = traceGraph.getVisibleBlockSearchRecords();

    expect(searchRecords).toHaveLength(1);
    expect(searchRecords[0]).toMatchObject({
      spanRef: getRequiredSpanRef(traceGraph, visibleBlock),
      spanId: visibleBlock.spanId,
      blockName: visibleBlock.name,
      processName: 'visible-process',
      threadName: 'visible-thread',
      keywordsText: 'alpha beta',
      searchText: 'visible-op'
    });
    expect(traceGraph.getVisibleBlockSearchRecords()).toBe(searchRecords);

    const visitedRecords: Array<(typeof searchRecords)[number]> = [];
    const visitedCount = traceGraph.searchVisibleBlockRecords(
      searchText => searchText.includes('visible'),
      record => {
        visitedRecords.push(record);
      }
    );

    expect(visitedCount).toBe(1);
    expect(visitedRecords).toEqual(searchRecords);
  });

  it('limits streaming visible span search records without visiting later matches', () => {
    const spans = Array.from({length: 205}, (_, index) =>
      createBlockForProcess({
        spanId: `search-${index}`,
        processId: 'rank-1',
        threadId: 'thread-1',
        name: `match-${index}`
      })
    );
    const traceGraph = createRuntimeTraceGraph(createGraphWithBlocks(spans, []));
    const visitedLabels: string[] = [];

    const visitedCount = traceGraph.searchVisibleBlockRecords(
      searchText => searchText.startsWith('match-'),
      record => {
        visitedLabels.push(record.blockName);
      },
      200
    );

    expect(visitedCount).toBe(200);
    expect(visitedLabels).toHaveLength(200);
    expect(visitedLabels[0]).toBe('match-0');
    expect(visitedLabels.at(-1)).toBe('match-199');
  });

  it('searches filtered spans and resolves the first visible descendant navigation target', () => {
    const root = createBlock('root');
    const filteredParent = createBlock('filtered-parent');
    const laterChild = createBlock('later-visible-child');
    const earlierChild = createBlock('earlier-visible-child');
    laterChild.timings.test.startTimeMs = 20;
    laterChild.timings.test.endTimeMs = 21;
    earlierChild.timings.test.startTimeMs = 10;
    earlierChild.timings.test.endTimeMs = 11;
    const graph = createGraphWithBlocks(
      [root, filteredParent, laterChild, earlierChild],
      [
        createLocalDependency('dep-root-filtered', root.spanId, filteredParent.spanId, ['PARENT']),
        createLocalDependency('dep-filtered-later', filteredParent.spanId, laterChild.spanId, [
          'PARENT'
        ]),
        createLocalDependency('dep-filtered-earlier', filteredParent.spanId, earlierChild.spanId, [
          'PARENT'
        ])
      ]
    );
    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});
    const filteredParentRef = getRequiredSpanRef(traceGraph, filteredParent);
    const earlierChildRef = getRequiredSpanRef(traceGraph, earlierChild);
    const filteredRecords: Array<{
      spanRef: SpanRef;
      filterMask: number;
    }> = [];
    const visibleRecords: Array<{
      spanRef: SpanRef;
      filterMask: number;
    }> = [];

    traceGraph.searchBlockRecords(
      searchText => searchText.includes('filtered-parent'),
      record => {
        filteredRecords.push(record);
      }
    );
    traceGraph.searchBlockRecords(
      searchText => searchText.includes('earlier-visible-child'),
      record => {
        visibleRecords.push(record);
      }
    );

    expect(filteredRecords).toEqual([
      expect.objectContaining({
        spanRef: filteredParentRef,
        filterMask: TRACE_SPAN_FILTER_MASK_REGEXP
      })
    ]);
    expect(traceGraph.getTraceSpanFilterNavigation(filteredParentRef)).toEqual({
      filterMask: TRACE_SPAN_FILTER_MASK_REGEXP,
      visibleDescendantSpanRef: earlierChildRef,
      visibleAncestorSpanRef: getRequiredSpanRef(traceGraph, root)
    });
    expect(visibleRecords).toEqual([
      expect.objectContaining({
        spanRef: earlierChildRef,
        filterMask: TRACE_SPAN_FILTER_MASK_NONE
      })
    ]);
  });

  it('falls back to the nearest visible ancestor for filtered span search records', () => {
    const root = createBlock('root');
    const filteredLeaf = createBlock('filtered-leaf');
    const graph = createGraphWithBlocks(
      [root, filteredLeaf],
      [
        createLocalDependency('dep-root-filtered-leaf', root.spanId, filteredLeaf.spanId, [
          'PARENT'
        ])
      ]
    );
    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});
    const records: Array<{
      spanRef: SpanRef;
      filterMask: number;
    }> = [];

    traceGraph.searchBlockRecords(
      searchText => searchText.includes('filtered-leaf'),
      record => {
        records.push(record);
      }
    );

    expect(records).toEqual([
      expect.objectContaining({
        spanRef: getRequiredSpanRef(traceGraph, filteredLeaf),
        filterMask: TRACE_SPAN_FILTER_MASK_REGEXP
      })
    ]);
    expect(
      traceGraph.getTraceSpanFilterNavigation(getRequiredSpanRef(traceGraph, filteredLeaf))
    ).toEqual({
      filterMask: TRACE_SPAN_FILTER_MASK_REGEXP,
      visibleDescendantSpanRef: null,
      visibleAncestorSpanRef: getRequiredSpanRef(traceGraph, root)
    });
  });

  it('limits streaming all-span search records across filtered matches', () => {
    const spans = Array.from({length: 205}, (_, index) =>
      createBlockForProcess({
        spanId: `inclusive-search-${index}`,
        processId: 'rank-1',
        threadId: 'thread-1',
        name: `filtered-match-${index}`
      })
    );
    const traceGraph = createRuntimeTraceGraph(createGraphWithBlocks(spans, []), {
      spanFilters: ['filtered-match-']
    });
    const visitedLabels: string[] = [];

    const visitedCount = traceGraph.searchBlockRecords(
      searchText => searchText.startsWith('filtered-match-'),
      record => {
        visitedLabels.push(record.blockName);
      },
      200
    );

    expect(visitedCount).toBe(200);
    expect(visitedLabels).toHaveLength(200);
    expect(visitedLabels[0]).toBe('filtered-match-0');
    expect(visitedLabels.at(-1)).toBe('filtered-match-199');
  });

  it('resolves exact span refs from materialized spans when span ids collide across processes', () => {
    const {graph, selectedBlock} = createProcessAwareSelectedCardGraph();
    const traceGraph = createRuntimeTraceGraph(graph);
    const exactSpanRef = getRequiredSpanRef(traceGraph, selectedBlock);

    expect(traceGraph.getSpanRefByExternalBlockId(selectedBlock.spanId)).toBeNull();
    expect(traceGraph.getDisplaySourceBySpanRef(exactSpanRef)).toMatchObject({
      name: 'selected-correct',
      processName: 'rank-selected'
    });
  });

  it('resolves span-ref process metadata when span ids collide across processes', () => {
    const {graph, selectedBlock} = createProcessAwareSelectedCardGraph();
    const traceGraph = createRuntimeTraceGraph(graph);
    const selectedSpanRef = getRequiredSpanRef(traceGraph, selectedBlock);

    expect(getTraceGraphProcessForBlock(traceGraph, selectedBlock)?.processId).toBe(
      'rank-selected'
    );
    expect(traceGraph.getThreadRefBySpanRef(selectedSpanRef)).toBe(
      getRequiredThreadRef(traceGraph, selectedBlock.threadId)
    );
    expect(traceGraph.getRankNumBySpanRef(selectedSpanRef)).toBe(1);
    expect(traceGraph.getProcessSourceBySpanRef(999999 as SpanRef)).toBeNull();
    expect(traceGraph.getThreadSourceBySpanRef(999999 as SpanRef)).toBeNull();
    expect(traceGraph.getRankNumBySpanRef(999999 as SpanRef)).toBeNull();
  });

  it('walks visible dependency selection through process-local parents when span ids collide', () => {
    const {graph, selectedBlock, selectedParentBlock} = createDuplicateIdSelectionTraversalGraph();
    const traceGraph = createRuntimeTraceGraph(graph);
    const selectedSpanRef = getRequiredSpanRef(traceGraph, selectedBlock);
    expect(traceGraph.getSpanRefByExternalBlockId(selectedParentBlock.spanId)).toBeNull();

    const selectionRefs = traceGraph.getTraceSpanDependencySelection(selectedSpanRef, {
      keywords: new Set(['PARENT'])
    });
    const selectedAncestorNames = new Set(
      selectionRefs.spanRefs.flatMap(spanRef => {
        const span = traceGraph.getDisplaySourceBySpanRef(spanRef);
        return span ? [span.name] : [];
      })
    );
    expect(selectedAncestorNames).toContain('selected-correct');
    expect(selectedAncestorNames).toContain('parent-correct');
    expect(selectedAncestorNames).not.toContain('parent-wrong');
  });

  it('keeps parentless spans free of unrelated parent dependencies when span ids collide', () => {
    const {graph, selectedBlock} = createDuplicateIdParentlessSelectionGraph();
    const traceGraph = createRuntimeTraceGraph(graph);
    const selectedSpanRef = getRequiredSpanRef(traceGraph, selectedBlock);

    const incomingDependencyEntries =
      traceGraph.getTraceSpanIncomingDependencyEntries(selectedSpanRef);
    const selectionRefs = traceGraph.getTraceSpanDependencySelection(selectedSpanRef, {
      keywords: new Set(['PARENT'])
    });

    expect(incomingDependencyEntries).toEqual([]);
    expect(selectionRefs.parentSpanRefs).toEqual([]);
    expect(selectionRefs.visibleLocalDependencyRefs).toEqual([]);
    expect(selectionRefs.visibleCrossDependencyRefs).toEqual([]);
  });

  it('returns span-card dependency chains and children without TraceSpan rows', () => {
    const {graph, selectedBlock, selectedParentBlock} = createDuplicateIdSelectionTraversalGraph();
    const traceGraph = createRuntimeTraceGraph(graph);
    const selectedSpanRef = getRequiredSpanRef(traceGraph, selectedBlock);
    const parentSpanRef = getRequiredSpanRef(traceGraph, selectedParentBlock);

    expect(
      traceGraph.getDependencyChainBySpanRef(selectedSpanRef, 'PARENT').map(span => span.name)
    ).toEqual(['parent-correct']);
    expect(
      traceGraph
        .getVisibleDependencyChainBySpanRef(selectedSpanRef, 'PARENT')
        .map(span => span.name)
    ).toEqual(['parent-correct']);
    expect(traceGraph.getTraceSpanChildDependencies(parentSpanRef)).toMatchObject([
      {
        childSpan: {
          name: 'selected-correct'
        }
      }
    ]);
    expect(traceGraph.getDependencyChainBySpanRef(999999 as SpanRef, 'PARENT')).toEqual([]);
    expect(traceGraph.getTraceSpanChildDependencies(999999 as SpanRef)).toEqual([]);
  });

  it('exposes rewired visible dependencies through accessors without materializing a public graph', () => {
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
    const childDependencies = getTraceGraphSpanDependencies(traceGraph, child);

    expect(childDependencies.inDependencies).toEqual([]);
  });

  it('walks the full original parent chain and preserves filtered markers separately', () => {
    const root = createBlock('root');
    const filteredParent = createBlock('filtered-parent');
    const filteredParent2 = createBlock('filtered-parent-2');
    const child = createBlock('child');
    const graph = createGraphWithBlocks(
      [root, filteredParent, filteredParent2, child],
      [
        createLocalDependency('dep-root-parent', root.spanId, filteredParent.spanId, ['PARENT']),
        createLocalDependency('dep-parent-parent2', filteredParent.spanId, filteredParent2.spanId, [
          'PARENT'
        ]),
        createLocalDependency('dep-parent2-child', filteredParent2.spanId, child.spanId, ['PARENT'])
      ]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});

    expect(
      getTraceGraphDependencyChainForBlock(traceGraph, child, 'PARENT').map(span => span.spanId)
    ).toEqual([filteredParent2.spanId, filteredParent.spanId, root.spanId]);
    expect(isTraceGraphBlockFiltered(traceGraph, filteredParent)).toBe(true);
    expect(isTraceGraphBlockFiltered(traceGraph, filteredParent2)).toBe(true);
  });

  it('resolves filtered parent span refs from exact span refs', () => {
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
    const rootSpanRef = getRequiredSpanRef(traceGraph, root);
    const filteredParentSpanRef = getRequiredSpanRef(traceGraph, filteredParent);
    const childSpanRef = getRequiredSpanRef(traceGraph, child);

    expect(traceGraph.spanIsFiltered(filteredParentSpanRef)).toBe(true);
    expect(traceGraph.spanIsFiltered(childSpanRef)).toBe(false);
    expect(traceGraph.getTraceSpanFilteredParentRef(filteredParentSpanRef)).toBe(rootSpanRef);
    expect(traceGraph.getTraceSpanFilteredParentRef(childSpanRef)).toBeNull();
    expect(traceGraph.getTraceSpanFilteredParentRef(999999 as SpanRef)).toBeNull();
  });

  it('walks the visible stitched parent chain from the filtered render view', () => {
    const root = createBlock('root');
    const filteredParent = createBlock('filtered-parent');
    const visibleParent = createBlock('visible-parent');
    const filteredParent2 = createBlock('filtered-parent-2');
    const child = createBlock('child');
    const graph = createGraphWithBlocks(
      [root, filteredParent, visibleParent, filteredParent2, child],
      [
        createLocalDependency('dep-root-filtered', root.spanId, filteredParent.spanId, ['PARENT']),
        createLocalDependency('dep-filtered-visible', filteredParent.spanId, visibleParent.spanId, [
          'PARENT'
        ]),
        createLocalDependency(
          'dep-visible-filtered',
          visibleParent.spanId,
          filteredParent2.spanId,
          ['PARENT']
        ),
        createLocalDependency('dep-filtered-child', filteredParent2.spanId, child.spanId, [
          'PARENT'
        ])
      ]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});

    expect(
      getTraceGraphVisibleDependencyChainForBlock(traceGraph, child, 'PARENT').map(
        span => span.spanId
      )
    ).toEqual([visibleParent.spanId, root.spanId]);
  });

  it('stitches visible parents through many filtered ancestors', () => {
    const root = createBlock('root');
    const filteredBefore = Array.from({length: 120}, (_entry, index) =>
      createBlock(`filtered-before-${index}`)
    );
    const visibleParent = createBlock('visible-parent');
    const filteredAfter = Array.from({length: 120}, (_entry, index) =>
      createBlock(`filtered-after-${index}`)
    );
    const selected = createBlock('selected');

    const spans = [root, ...filteredBefore, visibleParent, ...filteredAfter, selected];
    const localDependencies: TraceLocalDependency[] = [];

    const chain: TraceSpan[] = [];
    for (const span of spans) {
      chain.push(span);
    }
    for (let index = 0; index < chain.length - 1; index += 1) {
      const parent = chain[index];
      const child = chain[index + 1];
      localDependencies.push(
        createLocalDependency(`dep-${index + 1}`, parent.spanId, child.spanId, ['PARENT'])
      );
    }

    const graph = createGraphWithBlocks(spans, localDependencies);
    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});

    const visibleParentChain = getTraceGraphVisibleDependencyChainForBlock(
      traceGraph,
      selected,
      'PARENT'
    ).map(span => span.spanId);
    expect(visibleParentChain).toEqual([visibleParent.spanId, root.spanId]);

    const fullParentChain = getTraceGraphDependencyChainForBlock(
      traceGraph,
      selected,
      'PARENT'
    ).map(span => span.spanId);
    expect(fullParentChain).toEqual([
      ...filteredAfter.map(span => span.spanId).reverse(),
      visibleParent.spanId,
      ...filteredBefore.map(span => span.spanId).reverse(),
      root.spanId
    ]);
  });

  it('builds selected-card parent chain entries from exact span refs when span ids collide across processes', () => {
    const {graph, selectedBlock} = createProcessAwareSelectedCardGraph();
    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['hidden-parent']});

    const rawEntries = getTraceGraphParentChainEntries(traceGraph, selectedBlock, {
      includeHidden: true
    });
    expect(
      rawEntries.map(entry => ({
        name: entry.span.name,
        processName: entry.span.processName,
        chainIndex: entry.chainIndex,
        isFiltered: entry.isFiltered
      }))
    ).toEqual([
      {
        name: 'hidden-parent-correct',
        processName: 'rank-selected',
        chainIndex: 1,
        isFiltered: true
      },
      {
        name: 'parent-correct',
        processName: 'rank-parent',
        chainIndex: 2,
        isFiltered: false
      }
    ]);

    const visibleEntries = getTraceGraphParentChainEntries(traceGraph, selectedBlock);
    expect(
      visibleEntries.map(entry => ({
        name: entry.span.name,
        processName: entry.span.processName,
        chainIndex: entry.chainIndex,
        isFiltered: entry.isFiltered
      }))
    ).toEqual([
      {
        name: 'parent-correct',
        processName: 'rank-parent',
        chainIndex: 2,
        isFiltered: false
      }
    ]);
  });

  it('builds selected-card incoming dependency entries from exact span refs when span ids collide across processes', () => {
    const {graph, selectedBlock} = createProcessAwareSelectedCardGraph();
    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['hidden-parent']});

    const incomingEntries = getTraceGraphIncomingDependencyEntries(traceGraph, selectedBlock, {
      includeHidden: true
    });
    const crossIncomingEntry = incomingEntries.find(
      entry => entry.dependency.dependencyId === ('dep-cross-incoming' as TraceDependencyId)
    );
    const localParentEntry = incomingEntries.find(
      entry => entry.dependency.dependencyId === ('dep-hidden-selected' as TraceDependencyId)
    );

    expect(crossIncomingEntry).toMatchObject({
      startSpan: {
        name: 'source-correct',
        processName: 'rank-parent'
      },
      endSpan: {
        name: 'selected-correct',
        processName: 'rank-selected'
      }
    });
    expect(localParentEntry).toMatchObject({
      startSpan: {
        name: 'hidden-parent-correct',
        processName: 'rank-selected'
      },
      endSpan: {
        name: 'selected-correct',
        processName: 'rank-selected'
      }
    });
    expect(incomingEntries.some(entry => entry.startSpan.name === 'source-wrong')).toBe(false);
    expect(incomingEntries.some(entry => entry.endSpan.name === 'selected-wrong')).toBe(false);
  });

  it('keeps selected-card dependency resolution exact when span ids collide across processes', () => {
    const {graph, selectedBlock} = createProcessAwareSelectedCardGraph();
    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['hidden-parent']});

    const selectedSpanRef = getRequiredSpanRef(traceGraph, selectedBlock);
    const cardModel = traceGraph.getTraceSpanCardModel(selectedSpanRef);

    expect(cardModel).not.toBeNull();
    expect(
      cardModel?.fullIncomingDependencyEntries.map(entry => ({
        startName: entry.startSpan.name,
        startRankName: entry.startSpan.processName,
        endName: entry.endSpan.name,
        endRankName: entry.endSpan.processName
      }))
    ).toEqual(
      expect.arrayContaining([
        {
          startName: 'hidden-parent-correct',
          startRankName: 'rank-selected',
          endName: 'selected-correct',
          endRankName: 'rank-selected'
        },
        {
          startName: 'source-correct',
          startRankName: 'rank-parent',
          endName: 'selected-correct',
          endRankName: 'rank-selected'
        }
      ])
    );
  });

  it('resolves cross-rank selected-card parent chains against the correct process when endpoint span ids collide', () => {
    const {graph, hiddenParentBlock, correctParentBlock} = createProcessAwareSelectedCardGraph();
    const traceGraph = createRuntimeTraceGraph(graph);

    const hiddenParentChain = getTraceGraphParentChainEntries(traceGraph, hiddenParentBlock, {
      includeHidden: true
    });

    expect(hiddenParentChain).toHaveLength(1);
    expect(hiddenParentChain[0]).toMatchObject({
      span: {
        spanId: correctParentBlock.spanId,
        name: 'parent-correct',
        processName: 'rank-parent'
      },
      chainIndex: 1,
      isFiltered: false
    });
  });

  it('returns visible child dependencies ordered by child timing and excludes non-parent edges', () => {
    const selected = createBlock('selected');
    const childLater = createBlock('child-later');
    const childEarlier = createBlock('child-earlier');
    const unrelated = createBlock('unrelated');
    childEarlier.timings.test.startTimeMs = 5;
    childEarlier.timings.test.endTimeMs = 6;
    childLater.timings.test.startTimeMs = 10;
    childLater.timings.test.endTimeMs = 11;
    unrelated.timings.test.startTimeMs = 1;
    unrelated.timings.test.endTimeMs = 2;

    const graph = createGraphWithBlocks(
      [selected, childLater, childEarlier, unrelated],
      [
        createLocalDependency('dep-selected-later', selected.spanId, childLater.spanId, ['PARENT']),
        createLocalDependency('dep-selected-earlier', selected.spanId, childEarlier.spanId, [
          'PARENT'
        ]),
        createLocalDependency('dep-selected-unrelated', selected.spanId, unrelated.spanId)
      ]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {});

    expect(
      getTraceGraphChildDependencies(traceGraph, selected).map(({childSpan}) => childSpan.spanId)
    ).toEqual([childEarlier.spanId, childLater.spanId]);
  });

  it('keeps child dependency lookup process-scoped when visible span ids collide across processes', () => {
    const {graph, selectedBlock, correctChildBlock} = createDuplicateIdChildDependencyGraph();
    const traceGraph = createRuntimeTraceGraph(graph);

    expect(
      getTraceGraphChildDependencies(traceGraph, selectedBlock).map(({childSpan}) => ({
        spanId: childSpan.spanId,
        processName: childSpan.processName
      }))
    ).toEqual([
      {
        spanId: correctChildBlock.spanId,
        processName: 'rank-selected'
      }
    ]);
  });

  it('returns recursive visible descendants across multiple levels with depth-first, time-ordered siblings', () => {
    const selected = createBlock('selected');
    const childOne = createBlock('child-one');
    const childTwo = createBlock('child-two');
    const grandchildOneA = createBlock('grandchild-one-a');
    const grandchildOneB = createBlock('grandchild-one-b');
    const grandchildTwo = createBlock('grandchild-two');
    childOne.timings.test.startTimeMs = 10;
    childOne.timings.test.endTimeMs = 11;
    childTwo.timings.test.startTimeMs = 20;
    childTwo.timings.test.endTimeMs = 21;
    grandchildOneA.timings.test.startTimeMs = 11;
    grandchildOneA.timings.test.endTimeMs = 12;
    grandchildOneB.timings.test.startTimeMs = 13;
    grandchildOneB.timings.test.endTimeMs = 14;
    grandchildTwo.timings.test.startTimeMs = 21;
    grandchildTwo.timings.test.endTimeMs = 22;

    const graph = createGraphWithBlocks(
      [selected, childOne, childTwo, grandchildOneA, grandchildOneB, grandchildTwo],
      [
        createLocalDependency('dep-selected-child-one', selected.spanId, childOne.spanId, [
          'PARENT'
        ]),
        createLocalDependency('dep-selected-child-two', selected.spanId, childTwo.spanId, [
          'PARENT'
        ]),
        createLocalDependency(
          'dep-child-one-grandchild-one-a',
          childOne.spanId,
          grandchildOneA.spanId,
          ['PARENT']
        ),
        createLocalDependency(
          'dep-child-one-grandchild-one-b',
          childOne.spanId,
          grandchildOneB.spanId,
          ['PARENT']
        ),
        createLocalDependency('dep-child-two-grandchild', childTwo.spanId, grandchildTwo.spanId, [
          'PARENT'
        ])
      ]
    );
    const traceGraph = createRuntimeTraceGraph(graph);
    const descendants = getTraceGraphDescendants(traceGraph, selected);

    expect(descendants.isTruncated).toBe(false);
    expect(descendants.limit).toBe(1000);
    expect(descendants.truncatedCount).toBe(0);
    expect(
      descendants.entries.map(entry => ({
        spanId: entry.childSpan.spanId,
        parentSpanId: entry.parentSpanId,
        depth: entry.depth
      }))
    ).toEqual([
      {spanId: childOne.spanId, parentSpanId: selected.spanId, depth: 1},
      {spanId: grandchildOneA.spanId, parentSpanId: childOne.spanId, depth: 2},
      {spanId: grandchildOneB.spanId, parentSpanId: childOne.spanId, depth: 2},
      {spanId: childTwo.spanId, parentSpanId: selected.spanId, depth: 1},
      {spanId: grandchildTwo.spanId, parentSpanId: childTwo.spanId, depth: 2}
    ]);
  });

  it('returns recursive visible descendants and raw descendants through filtered intermediate children', () => {
    const selected = createBlock('selected');
    const filteredChild = createBlock('filtered-child');
    const visibleGrandchild = createBlock('visible-grandchild');
    visibleGrandchild.timings.test.startTimeMs = 12;
    visibleGrandchild.timings.test.endTimeMs = 13;
    const graph = createGraphWithBlocks(
      [selected, filteredChild, visibleGrandchild],
      [
        createLocalDependency('dep-selected-filtered', selected.spanId, filteredChild.spanId, [
          'PARENT'
        ]),
        createLocalDependency(
          'dep-filtered-visible',
          filteredChild.spanId,
          visibleGrandchild.spanId,
          ['PARENT']
        )
      ]
    );
    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});
    const visibleDescendants = getTraceGraphDescendants(traceGraph, selected);
    const rawDescendants = getTraceGraphDescendants(traceGraph, selected, {includeHidden: true});

    expect(
      visibleDescendants.entries.map(entry => ({
        spanId: entry.childSpan.spanId,
        parentSpanId: entry.parentSpanId,
        depth: entry.depth
      }))
    ).toEqual([{spanId: visibleGrandchild.spanId, parentSpanId: selected.spanId, depth: 1}]);
    expect(
      rawDescendants.entries.map(entry => ({
        spanId: entry.childSpan.spanId,
        parentSpanId: entry.parentSpanId,
        depth: entry.depth
      }))
    ).toEqual([
      {spanId: filteredChild.spanId, parentSpanId: selected.spanId, depth: 1},
      {spanId: visibleGrandchild.spanId, parentSpanId: filteredChild.spanId, depth: 2}
    ]);
  });

  it('returns recursive cross-rank descendants using parent links', () => {
    const selected = createBlockForProcess({
      spanId: 'selected',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const child = createBlockForProcess({
      spanId: 'child',
      processId: 'rank-2',
      threadId: 'thread-2'
    });
    const grandchild = createBlockForProcess({
      spanId: 'grandchild',
      processId: 'rank-2',
      threadId: 'thread-2'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-1',
          rankNum: 0,
          threadId: 'thread-1',
          spans: [selected]
        }),
        createProcess({
          processId: 'rank-2',
          rankNum: 1,
          threadId: 'thread-2',
          spans: [child, grandchild],
          localDependencies: [
            createLocalDependency('dep-child-grandchild', child.spanId, grandchild.spanId, [
              'PARENT'
            ])
          ]
        })
      ],
      [
        createCrossDependency(
          'dep-selected-child',
          'endpoint-child',
          selected.spanId,
          child.spanId,
          0,
          1,
          'parent',
          ['PARENT']
        )
      ],
      {name: 'trace-graph-cross-rank-children'}
    );

    const traceGraph = createRuntimeTraceGraph(graph);
    const descendants = getTraceGraphDescendants(traceGraph, selected);

    expect(descendants.entries.map(entry => entry.childSpan.spanId)).toEqual([
      child.spanId,
      grandchild.spanId
    ]);
    expect(descendants.entries[1]?.parentSpanId).toBe(child.spanId);
    expect(descendants.entries[0]?.dependency).toMatchObject({
      type: 'trace-cross-process-dependency',
      waitMode: 'start-to-start'
    });
    expect(descendants.entries[1]?.dependency).toMatchObject({
      type: 'trace-local-dependency',
      waitMode: 'start-to-start'
    });
  });

  it('safely ignores cycles when resolving descendants', () => {
    const a = createBlock('span-a');
    const b = createBlock('span-b');
    const graph = createGraphWithBlocks(
      [a, b],
      [
        createLocalDependency('dep-a-b', a.spanId, b.spanId, ['PARENT']),
        createLocalDependency('dep-b-a', b.spanId, a.spanId, ['PARENT'])
      ]
    );
    const traceGraph = createRuntimeTraceGraph(graph);

    const descendants = getTraceGraphDescendants(traceGraph, a);
    expect(descendants.entries).toHaveLength(1);
    expect(descendants.entries[0]).toMatchObject({
      childSpan: {spanId: b.spanId},
      parentSpanId: a.spanId,
      depth: 1
    });
  });

  it('dedupes descendants reached by multiple paths and keeps the first parent edge', () => {
    const selected = createBlock('selected');
    const leftBranch = createBlock('left-branch');
    const rightBranch = createBlock('right-branch');
    const sharedGrandchild = createBlock('shared-grandchild');
    leftBranch.timings.test.startTimeMs = 10;
    leftBranch.timings.test.endTimeMs = 11;
    rightBranch.timings.test.startTimeMs = 20;
    rightBranch.timings.test.endTimeMs = 21;
    sharedGrandchild.timings.test.startTimeMs = 15;
    sharedGrandchild.timings.test.endTimeMs = 16;

    const graph = createGraphWithBlocks(
      [selected, leftBranch, rightBranch, sharedGrandchild],
      [
        createLocalDependency('dep-selected-left', selected.spanId, leftBranch.spanId, ['PARENT']),
        createLocalDependency('dep-selected-right', selected.spanId, rightBranch.spanId, [
          'PARENT'
        ]),
        createLocalDependency('dep-left-grandchild', leftBranch.spanId, sharedGrandchild.spanId, [
          'PARENT'
        ]),
        createLocalDependency('dep-right-grandchild', rightBranch.spanId, sharedGrandchild.spanId, [
          'PARENT'
        ])
      ]
    );
    const traceGraph = createRuntimeTraceGraph(graph);
    const descendants = getTraceGraphDescendants(traceGraph, selected);

    expect(
      descendants.entries.map(entry => ({
        spanId: entry.childSpan.spanId,
        parentSpanId: entry.parentSpanId,
        depth: entry.depth
      }))
    ).toEqual([
      {spanId: leftBranch.spanId, parentSpanId: selected.spanId, depth: 1},
      {spanId: sharedGrandchild.spanId, parentSpanId: leftBranch.spanId, depth: 2},
      {spanId: rightBranch.spanId, parentSpanId: selected.spanId, depth: 1}
    ]);
  });

  it('truncates recursive descendants at the configured limit with an accurate omitted count', () => {
    const selected = createBlock('selected');
    const descendants = Array.from({length: 1001}, (_, index) => {
      const spanId = `descendant-${index + 1}` as TraceSpanId;
      const span = createBlock(spanId);
      span.timings.test.startTimeMs = index + 1;
      span.timings.test.endTimeMs = index + 2;
      return span;
    });
    const localDependencies = descendants.map(span =>
      createLocalDependency(`dep-selected-${span.spanId}`, selected.spanId, span.spanId, ['PARENT'])
    );
    const graph = createGraphWithBlocks([selected, ...descendants], localDependencies);
    const traceGraph = createRuntimeTraceGraph(graph);

    const result = getTraceGraphDescendants(traceGraph, selected);
    expect(result.isTruncated).toBe(true);
    expect(result.limit).toBe(1000);
    expect(result.truncatedCount).toBe(1);
    expect(result.entries).toHaveLength(1000);
    expect(result.entries[0]?.childSpan.spanId).toBe('descendant-1');
    expect(result.entries[999]?.childSpan.spanId).toBe('descendant-1000');
  }, 15000);

  it('resolves recursive descendants without full TraceSpan materialization on Arrow graphs', () => {
    const selected = createBlock('selected');
    const child = createBlock('child');
    child.timings.test.startTimeMs = 10;
    child.timings.test.endTimeMs = 11;
    const graph = createGraphWithBlocks(
      [selected, child],
      [createLocalDependency('dep-selected-child', selected.spanId, child.spanId, ['PARENT'])]
    );
    const traceGraph = createRuntimeTraceGraph(graph);

    resetArrowTraceSpanMaterializationCount();

    const descendants = getTraceGraphDescendants(traceGraph, selected);

    expect(descendants.entries).toHaveLength(1);
    expect(descendants.entries[0]?.childSpan.spanId).toBe(child.spanId);
    expect(getArrowTraceSpanMaterializationCount()).toBe(0);
  });

  it('stitches visible child dependencies across filtered intermediate children', () => {
    const selected = createBlock('selected');
    const filteredChild = createBlock('filtered-child');
    const visibleGrandchild = createBlock('visible-grandchild');
    const graph = createGraphWithBlocks(
      [selected, filteredChild, visibleGrandchild],
      [
        createLocalDependency(
          'dep-selected-filtered-child',
          selected.spanId,
          filteredChild.spanId,
          ['PARENT']
        ),
        createLocalDependency(
          'dep-filtered-child-visible-grandchild',
          filteredChild.spanId,
          visibleGrandchild.spanId,
          ['PARENT']
        )
      ]
    );

    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});

    const stitchedChildren = getTraceGraphChildDependencies(traceGraph, selected);
    expect(stitchedChildren).toHaveLength(1);
    expect(stitchedChildren[0]).toMatchObject({
      childSpan: {spanId: visibleGrandchild.spanId},
      dependency: {
        type: 'trace-local-dependency',
        waitMode: 'start-to-start'
      }
    });
  });

  it('rewires cross-rank parent dependencies and exposes visible endpoints from filtered state', () => {
    const root = createBlockForProcess({
      spanId: 'root',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const filteredParent = createBlockForProcess({
      spanId: 'filtered-parent',
      processId: 'rank-2',
      threadId: 'thread-2'
    });
    const child = createBlockForProcess({
      spanId: 'child',
      processId: 'rank-2',
      threadId: 'thread-2'
    });

    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-1',
          rankNum: 0,
          threadId: 'thread-1',
          spans: [root]
        }),
        createProcess({
          processId: 'rank-2',
          rankNum: 1,
          threadId: 'thread-2',
          spans: [filteredParent, child],
          localDependencies: [
            createLocalDependency('dep-parent-child', filteredParent.spanId, child.spanId, [
              'PARENT'
            ])
          ]
        })
      ],
      [
        createCrossDependency(
          'dep-root-parent',
          'endpoint-root-parent',
          root.spanId,
          filteredParent.spanId,
          0,
          1,
          'parent',
          ['PARENT']
        )
      ],
      {name: 'trace-graph-cross-parent-test'}
    );

    const traceGraph = createRuntimeTraceGraph(graph, {spanFilters: ['filtered']});
    const childDependencies = getTraceGraphSpanDependencies(traceGraph, child);
    const childEndpoints = getTraceGraphEndpointsWithDependencies(traceGraph, child);

    expect(childDependencies.inDependencies).toHaveLength(1);
    expect(childDependencies.inDependencies[0]).toMatchObject({
      type: 'trace-cross-process-dependency',
      startSpanId: root.spanId,
      endSpanId: child.spanId,
      topology: 'parent'
    });
    expect(childEndpoints).toHaveLength(1);
    expect(childEndpoints[0]?.[1]).toMatchObject({
      startSpanId: root.spanId,
      endSpanId: child.spanId
    });
    expect(getTraceGraphProcessForBlock(traceGraph, child)?.processId).toBe('rank-2');
    expect(getTraceGraphThreadForBlock(traceGraph, child)?.threadId).toBe(child.threadId);
  });

  it('builds ref-native visible dependency selections', () => {
    const root = createBlockForProcess({
      spanId: 'root',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const localChild = createBlockForProcess({
      spanId: 'local-child',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const crossChild = createBlockForProcess({
      spanId: 'cross-child',
      processId: 'rank-2',
      threadId: 'thread-2'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-1',
          rankNum: 0,
          threadId: 'thread-1',
          spans: [root, localChild],
          localDependencies: [
            createLocalDependency('dep-root-local-child', root.spanId, localChild.spanId, [
              'parent'
            ])
          ]
        }),
        createProcess({
          processId: 'rank-2',
          rankNum: 1,
          threadId: 'thread-2',
          spans: [crossChild]
        })
      ],
      [
        createCrossDependency(
          'dep-root-cross-child',
          'endpoint-root-cross-child',
          root.spanId,
          crossChild.spanId,
          0,
          1,
          'parent',
          []
        )
      ],
      {name: 'trace-graph-selection-refs-test'}
    );

    const traceGraph = createRuntimeTraceGraph(graph);
    const rootSpanRef = traceGraph.getSpanRefByExternalBlockId(root.spanId)!;
    const selectionState = traceGraph.getTraceSpanDependencySelection(rootSpanRef, {
      keywords: new Set(['PARENT'])
    });

    expect(selectionState.originSpanRef).toBe(rootSpanRef);
    expect(
      new Set(
        selectionState.spanRefs.flatMap(spanRef => {
          const spanId = traceGraph.getVisibleSpanBlockId(spanRef);
          return spanId ? [spanId] : [];
        })
      )
    ).toEqual(new Set([root.spanId, localChild.spanId, crossChild.spanId]));
    expect(
      new Set(
        selectionState.childSpanRefs.flatMap(spanRef => {
          const spanId = traceGraph.getVisibleSpanBlockId(spanRef);
          return spanId ? [spanId] : [];
        })
      )
    ).toEqual(new Set([localChild.spanId, crossChild.spanId]));
    expect(selectionState.parentSpanRefs).toEqual([]);
    expect(
      selectionState.visibleLocalDependencyRefs.flatMap(dependencyRef => {
        const dependencyId = traceGraph.getVisibleDependencyIdByRef(dependencyRef);
        return dependencyId ? [dependencyId] : [];
      })
    ).toEqual(['dep-root-local-child']);
    expect(
      selectionState.childLocalDependencyRefs.flatMap(dependencyRef => {
        const dependencyId = traceGraph.getVisibleDependencyIdByRef(dependencyRef);
        return dependencyId ? [dependencyId] : [];
      })
    ).toEqual(['dep-root-local-child']);
    expect(
      selectionState.visibleCrossDependencyRefs.flatMap(dependencyRef => {
        const dependencyId = traceGraph.getVisibleDependencyIdByRef(dependencyRef);
        return dependencyId ? [dependencyId] : [];
      })
    ).toEqual(['dep-root-cross-child']);
    expect(
      selectionState.childCrossDependencyRefs.flatMap(dependencyRef => {
        const dependencyId = traceGraph.getVisibleDependencyIdByRef(dependencyRef);
        return dependencyId ? [dependencyId] : [];
      })
    ).toEqual(['dep-root-cross-child']);

    expect(
      traceGraph
        .getTraceSpanDescendants(rootSpanRef)
        .entries.map(entry => entry.dependency.dependencyId)
    ).toEqual(expect.arrayContaining(['dep-root-local-child', 'dep-root-cross-child']));
  });

  it('walks unfiltered dependency selections from span sidecar refs without visible scans', () => {
    const root = createBlockForProcess({
      spanId: 'root',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const localChild = createBlockForProcess({
      spanId: 'local-child',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const crossChild = createBlockForProcess({
      spanId: 'cross-child',
      processId: 'rank-2',
      threadId: 'thread-2'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-1',
          rankNum: 0,
          threadId: 'thread-1',
          spans: [root, localChild],
          localDependencies: [
            createLocalDependency('dep-root-local-child', root.spanId, localChild.spanId, [
              'PARENT'
            ])
          ]
        }),
        createProcess({
          processId: 'rank-2',
          rankNum: 1,
          threadId: 'thread-2',
          spans: [crossChild]
        })
      ],
      [
        createCrossDependency(
          'dep-root-cross-child',
          'endpoint-root-cross-child',
          root.spanId,
          crossChild.spanId,
          0,
          1,
          'parent',
          ['PARENT']
        )
      ],
      {name: 'trace-graph-selection-sidecar-refs-test'}
    );
    const traceGraph = createRuntimeTraceGraph(graph);
    const localScanSpy = vi.spyOn(traceGraph, 'getVisibleLocalDependencySources');
    const crossScanSpy = vi.spyOn(traceGraph, 'getVisibleCrossDependencySources');

    const selectionState = traceGraph.getTraceSpanDependencySelection(
      traceGraph.getSpanRefByExternalBlockId(root.spanId)!,
      {keywords: new Set(['PARENT'])}
    );

    expect(
      selectionState.childSpanRefs.map(spanRef => traceGraph.getVisibleSpanBlockId(spanRef))
    ).toEqual([localChild.spanId, crossChild.spanId]);
    expect(
      selectionState.visibleLocalDependencyRefs.map(dependencyRef =>
        traceGraph.getVisibleDependencyIdByRef(dependencyRef)
      )
    ).toEqual(['dep-root-local-child']);
    expect(
      selectionState.visibleCrossDependencyRefs.map(dependencyRef =>
        traceGraph.getVisibleDependencyIdByRef(dependencyRef)
      )
    ).toEqual(['dep-root-cross-child']);
    expect(localScanSpy).not.toHaveBeenCalled();
    expect(crossScanSpy).not.toHaveBeenCalled();
  });

  it('resolves cross dependencies when the cross map is missing from the source graph', () => {
    const root = createBlockForProcess({
      spanId: 'root',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const crossChild = createBlockForProcess({
      spanId: 'cross-child',
      processId: 'rank-2',
      threadId: 'thread-2'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-1',
          rankNum: 0,
          threadId: 'thread-1',
          spans: [root]
        }),
        createProcess({
          processId: 'rank-2',
          rankNum: 1,
          threadId: 'thread-2',
          spans: [crossChild]
        })
      ],
      [
        createCrossDependency(
          'dep-root-cross-child',
          'endpoint-root-cross-child',
          root.spanId,
          crossChild.spanId,
          0,
          1,
          'parent',
          ['PARENT']
        )
      ],
      {name: 'trace-graph-selection-refs-missing-map-test'}
    );
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const traceGraph = createTestTraceGraph({
      ...traceGraphData,
      crossDependencyIdToIndexMap: undefined
    });

    const selectionRefs = traceGraph.getTraceSpanDependencySelection(
      traceGraph.getSpanRefByExternalBlockId(root.spanId)!,
      {keywords: new Set(['PARENT'])}
    );

    expect(selectionRefs.visibleLocalDependencyRefs).toEqual([]);
    expect(selectionRefs.visibleCrossDependencyRefs).toHaveLength(1);
    expect(
      selectionRefs.visibleCrossDependencyRefs.flatMap(dependencyRef =>
        traceGraph.getVisibleDependencyIdByRef(dependencyRef)
      )
    ).toEqual(['dep-root-cross-child']);
  });

  it('assigns stitched visible cross-parent dependency refs when no raw cross ref exists', () => {
    const root = createBlockForProcess({
      spanId: 'head-root',
      processId: 'rank-a',
      threadId: 'thread-a'
    });
    const filteredLogical = createBlockForProcess({
      spanId: 'filtered-logical',
      processId: 'rank-b',
      threadId: 'thread-b'
    });
    const logicalChild = createBlockForProcess({
      spanId: 'logical-child',
      processId: 'rank-b',
      threadId: 'thread-b'
    });
    const localDependencyId = 'rank-b:parent-1' as TraceDependencyId;
    const crossDependencyId = 'cross:parent-stitched' as TraceDependencyId;
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-a',
          rankNum: 0,
          threadId: 'thread-a',
          spans: [root]
        }),
        createProcess({
          processId: 'rank-b',
          rankNum: 1,
          threadId: 'thread-b',
          spans: [filteredLogical, logicalChild],
          localDependencies: [
            createLocalDependency(localDependencyId, filteredLogical.spanId, logicalChild.spanId, [
              'PARENT'
            ])
          ]
        })
      ],
      [
        createCrossDependency(
          crossDependencyId,
          'endpoint-parent-stitched',
          root.spanId,
          filteredLogical.spanId,
          0,
          1,
          'parent',
          ['PARENT']
        )
      ],
      {name: 'trace-graph-selection-stitched-cross-parent-test'}
    );
    const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(graph), {
      spanFilters: ['filtered-logical']
    });
    const visibleLogicalChild = getRequiredVisibleDisplaySourceBySpanId(
      traceGraph,
      logicalChild.spanId
    );

    const stitchedDependency = getTraceGraphSpanDependencies(traceGraph, visibleLogicalChild)
      .crossRankDependencies[0];
    expect(stitchedDependency).toBeTruthy();
    expect(stitchedDependency?.dependencyId).toBe(localDependencyId);
    expect(traceGraph.getVisibleCrossDependencyRefById(localDependencyId)).toBeTruthy();

    const selectionState = traceGraph.getTraceSpanDependencySelection(visibleLogicalChild.spanRef, {
      keywords: new Set(['PARENT'])
    });

    expect(selectionState.visibleCrossDependencyRefs).toEqual([
      traceGraph.getVisibleCrossDependencyRefById(localDependencyId)
    ]);
    expect(
      selectionState.visibleCrossDependencyRefs.map(dependencyRef =>
        traceGraph.getVisibleDependencyIdByRef(dependencyRef)
      )
    ).toEqual([localDependencyId]);
    const stitchedDependencyRef = traceGraph.getVisibleCrossDependencyRefById(localDependencyId);
    expect(stitchedDependencyRef).toBeTruthy();
    expect(traceGraph.getVisibleDependencyStartSpan(stitchedDependencyRef!)).toBe(
      getRequiredSpanRef(traceGraph, root)
    );
    expect(traceGraph.getVisibleDependencyEndSpan(stitchedDependencyRef!)).toBe(
      getRequiredSpanRef(traceGraph, logicalChild)
    );
    expect(traceGraph.getDependencySourceStartSpan(stitchedDependencyRef!, localDependencyId)).toBe(
      getRequiredSpanRef(traceGraph, filteredLogical)
    );
    expect(traceGraph.getDependencySourceEndSpan(stitchedDependencyRef!, localDependencyId)).toBe(
      getRequiredSpanRef(traceGraph, logicalChild)
    );
  });

  it('prefers the current visible cross dependency ref over a stale stored visible ref', () => {
    const filteredRoot = createBlockForProcess({
      spanId: 'filtered-root',
      processId: 'rank-a',
      threadId: 'thread-a'
    });
    const visibleRoot = createBlockForProcess({
      spanId: 'visible-root',
      processId: 'rank-a',
      threadId: 'thread-a'
    });
    const filteredChild = createBlockForProcess({
      spanId: 'filtered-child',
      processId: 'rank-b',
      threadId: 'thread-b'
    });
    const visibleChild = createBlockForProcess({
      spanId: 'visible-child',
      processId: 'rank-b',
      threadId: 'thread-b'
    });
    const filteredDependency = {
      ...createCrossDependency(
        'dep-filtered',
        'endpoint-filtered',
        filteredRoot.spanId,
        filteredChild.spanId,
        0,
        1,
        'parent'
      ),
      dependencyRef: encodeVisibleCrossDependencyRef(0)
    } satisfies TraceCrossProcessDependency;
    const visibleDependency = {
      ...createCrossDependency(
        'dep-visible',
        'endpoint-visible',
        visibleRoot.spanId,
        visibleChild.spanId,
        0,
        1,
        'parent'
      ),
      dependencyRef: encodeVisibleCrossDependencyRef(1)
    } satisfies TraceCrossProcessDependency;
    const traceGraph = createTestTraceGraph(
      buildTraceGraphDataFromJSONTrace(
        buildJSONTrace(
          [
            createProcess({
              processId: 'rank-a',
              rankNum: 0,
              threadId: 'thread-a',
              spans: [filteredRoot, visibleRoot]
            }),
            createProcess({
              processId: 'rank-b',
              rankNum: 1,
              threadId: 'thread-b',
              spans: [filteredChild, visibleChild]
            })
          ],
          [filteredDependency, visibleDependency],
          {name: 'trace-graph-stale-cross-visible-ref-test'}
        )
      ),
      {spanFilters: ['filtered-']}
    );

    const currentVisibleDependency = traceGraph.getVisibleCrossDependencySources()[0];
    expect(currentVisibleDependency?.dependencyId).toBe(visibleDependency.dependencyId);
    expect(traceGraph.getVisibleCrossDependencyRefById(visibleDependency.dependencyId)).toEqual(
      encodeVisibleCrossDependencyRef(0)
    );
    expect(currentVisibleDependency?.dependencyRef).toEqual(encodeVisibleCrossDependencyRef(0));
  });

  it('prefers the current visible local dependency ref over a stale stored visible ref', () => {
    const filteredStart = createBlockForProcess({
      spanId: 'filtered-start',
      processId: 'rank-a',
      threadId: 'thread-a'
    });
    const filteredEnd = createBlockForProcess({
      spanId: 'filtered-end',
      processId: 'rank-a',
      threadId: 'thread-a'
    });
    const visibleStart = createBlockForProcess({
      spanId: 'visible-start',
      processId: 'rank-a',
      threadId: 'thread-a'
    });
    const visibleEnd = createBlockForProcess({
      spanId: 'visible-end',
      processId: 'rank-a',
      threadId: 'thread-a'
    });
    const filteredDependency = {
      ...createLocalDependency('local-filtered', filteredStart.spanId, filteredEnd.spanId),
      dependencyRef: encodeVisibleLocalDependencyRef(0)
    } satisfies TraceLocalDependency;
    const visibleDependency = {
      ...createLocalDependency('local-visible', visibleStart.spanId, visibleEnd.spanId),
      dependencyRef: encodeVisibleLocalDependencyRef(1)
    } satisfies TraceLocalDependency;
    const traceGraph = createTestTraceGraph(
      buildTraceGraphDataFromJSONTrace(
        buildJSONTrace(
          [
            createProcess({
              processId: 'rank-a',
              rankNum: 0,
              threadId: 'thread-a',
              spans: [filteredStart, filteredEnd, visibleStart, visibleEnd],
              localDependencies: [filteredDependency, visibleDependency]
            })
          ],
          [],
          {name: 'trace-graph-stale-local-visible-ref-test'}
        )
      ),
      {spanFilters: ['filtered-']}
    );

    const currentVisibleDependency = traceGraph.getVisibleLocalDependencySources(
      getRequiredProcessRef(traceGraph, 'rank-a')
    )[0];
    expect(currentVisibleDependency?.dependencyId).toBe(visibleDependency.dependencyId);
    expect(traceGraph.getVisibleLocalDependencyRefById(visibleDependency.dependencyId)).toEqual(
      encodeVisibleLocalDependencyRef(0)
    );
    expect(currentVisibleDependency?.dependencyRef).toEqual(encodeVisibleLocalDependencyRef(0));
  });

  it('prefers span-ref path membership over compatibility span ids for duplicate visible spans', () => {
    const {graph, selectedParentBlock} = createDuplicateIdSelectionTraversalGraph();
    const traceGraph = createRuntimeTraceGraph(graph);
    const selectedParentSpanRef = getRequiredSpanRef(traceGraph, selectedParentBlock);

    const path: TracePath = {
      type: 'trace-path',
      pathId: 'duplicate-visible-path',
      spanRefSet: new Set([selectedParentSpanRef]),
      orderedSpanRefs: [selectedParentSpanRef],
      visibleLocalDependencyRefSet: new Set(),
      visibleCrossDependencyRefSet: new Set()
    };

    const pathData = traceGraph.getVisiblePathData([path]);
    expect(pathData.pathBlockSources).toHaveLength(1);
    expect(pathData.pathBlockSources[0]).toMatchObject({
      spanRef: selectedParentSpanRef,
      spanId: selectedParentBlock.spanId
    });
    expect(pathData.pathBlockSources[0]?.span.name).toBe('parent-correct');
  });

  it('resolves stitched visible dependency refs for runtime path dependency overlays', () => {
    const root = createBlockForProcess({
      spanId: 'path-head-root',
      processId: 'rank-a',
      threadId: 'thread-a'
    });
    const filteredLogical = createBlockForProcess({
      spanId: 'path-filtered-logical',
      processId: 'rank-b',
      threadId: 'thread-b'
    });
    const logicalChild = createBlockForProcess({
      spanId: 'path-logical-child',
      processId: 'rank-b',
      threadId: 'thread-b'
    });
    const localDependencyId = 'rank-b:path-parent-1' as TraceDependencyId;
    const crossDependencyId = 'cross:path-parent-stitched' as TraceDependencyId;
    const traceGraph = createTestTraceGraph(
      buildTraceGraphDataFromJSONTrace(
        buildJSONTrace(
          [
            createProcess({
              processId: 'rank-a',
              rankNum: 0,
              threadId: 'thread-a',
              spans: [root]
            }),
            createProcess({
              processId: 'rank-b',
              rankNum: 1,
              threadId: 'thread-b',
              spans: [filteredLogical, logicalChild],
              localDependencies: [
                createLocalDependency(
                  localDependencyId,
                  filteredLogical.spanId,
                  logicalChild.spanId,
                  ['PARENT']
                )
              ]
            })
          ],
          [
            createCrossDependency(
              crossDependencyId,
              'endpoint-path-parent-stitched',
              root.spanId,
              filteredLogical.spanId,
              0,
              1,
              'parent',
              ['PARENT']
            )
          ],
          {name: 'trace-graph-runtime-path-visible-dependency-ref-test'}
        )
      ),
      {spanFilters: ['path-filtered-logical']}
    );
    const stitchedDependencyRef = traceGraph.getVisibleCrossDependencyRefById(localDependencyId);
    expect(stitchedDependencyRef).toBeTruthy();
    if (!stitchedDependencyRef) {
      throw new Error('Expected stitched visible dependency ref');
    }

    const path: TracePath = {
      type: 'trace-path',
      pathId: 'stitched-visible-dependency-path',
      spanRefSet: new Set(),
      visibleLocalDependencyRefSet: new Set(),
      visibleCrossDependencyRefSet: new Set([stitchedDependencyRef])
    };

    const pathData = traceGraph.getVisiblePathData([path]);
    expect(pathData.pathDependencySources).toEqual([
      expect.objectContaining({
        dependencyRef: stitchedDependencyRef,
        dependency: expect.objectContaining({
          dependencyId: localDependencyId,
          type: 'trace-cross-process-dependency'
        })
      })
    ]);
  });

  it('falls back to table scan when the stable cross map points to the wrong row', () => {
    const root = createBlockForProcess({
      spanId: 'root',
      processId: 'rank-1',
      threadId: 'thread-1'
    });
    const firstChild = createBlockForProcess({
      spanId: 'first-child',
      processId: 'rank-2',
      threadId: 'thread-2'
    });
    const secondChild = createBlockForProcess({
      spanId: 'second-child',
      processId: 'rank-3',
      threadId: 'thread-3'
    });
    const graph = buildJSONTrace(
      [
        createProcess({
          processId: 'rank-1',
          rankNum: 0,
          threadId: 'thread-1',
          spans: [root]
        }),
        createProcess({
          processId: 'rank-2',
          rankNum: 1,
          threadId: 'thread-2',
          spans: [firstChild]
        }),
        createProcess({
          processId: 'rank-3',
          rankNum: 2,
          threadId: 'thread-3',
          spans: [secondChild]
        })
      ],
      [
        createCrossDependency(
          'dep-first-child',
          'endpoint-first-child',
          root.spanId,
          firstChild.spanId,
          0,
          1,
          'parent',
          ['PARENT']
        ),
        createCrossDependency(
          'dep-second-child',
          'endpoint-second-child',
          root.spanId,
          secondChild.spanId,
          0,
          2,
          'parent',
          ['PARENT']
        )
      ],
      {name: 'trace-graph-selection-refs-mismatched-map-test'}
    );
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const traceGraph = createTestTraceGraph({
      ...traceGraphData,
      crossDependencyIdToIndexMap: {
        'dep-first-child': 1,
        'dep-second-child': 0
      } as Readonly<Record<TraceDependencyId, number>>
    });

    const selectionRefs = traceGraph.getTraceSpanDependencySelection(
      traceGraph.getSpanRefByExternalBlockId(root.spanId)!,
      {keywords: new Set(['PARENT'])}
    );

    expect(selectionRefs.visibleCrossDependencyRefs).toHaveLength(2);
    expect(
      selectionRefs.visibleCrossDependencyRefs
        .map(dependencyRef => traceGraph.getVisibleDependencyIdByRef(dependencyRef))
        .filter((dependencyId): dependencyId is TraceDependencyId => Boolean(dependencyId))
        .sort()
    ).toEqual(['dep-first-child', 'dep-second-child'].sort());
  });
});
