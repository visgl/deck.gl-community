import {describe, expect, it, vi} from 'vitest';

import {buildJSONTrace} from '../ingestion/json-trace';
import {
  buildTraceSelectedCrossProcessDependencySources,
  buildTraceSelectedSameProcessDependencySourcesByProcessId
} from '../trace-view-state/trace-view-selection';
import {
  getTraceSpanCardModel,
  getTraceSpanChildDependencies,
  getTraceSpanDependencyChain,
  getTraceSpanDescendants,
  getTraceSpanIncomingDependencyEntries,
  getTraceSpanVisibleDependencyChain
} from './build-trace-span-card-data';
import {getTraceSpanDependencySelection} from './trace-graph-selection-utils';
import {
  createBlock,
  createBlockForProcess,
  createCrossProcessDependency,
  createDuplicateIdChildDependencyGraph,
  createDuplicateIdParentlessSelectionGraph,
  createDuplicateIdSelectionTraversalGraph,
  createGraphWithBlocks,
  createProcess,
  createProcessAwareSelectedCardGraph,
  createRuntimeTraceGraph,
  createSameProcessDependency
} from './trace-graph-test-fixtures';
import {
  getRequiredSpanRef,
  getRequiredThreadRef,
  getTraceGraphChildDependencies,
  getTraceGraphDependencyChainForBlock,
  getTraceGraphDescendants,
  getTraceGraphIncomingDependencyEntries,
  getTraceGraphParentChainEntries,
  getTraceGraphProcessForBlock,
  getTraceGraphSpanDependencies,
  isTraceGraphBlockFiltered
} from './trace-graph-test-utils';
import {TRACE_SPAN_FILTER_MASK_NONE, TRACE_SPAN_FILTER_MASK_REGEXP} from './trace-graph-types';

import type {
  SpanRef,
  TraceDependencyId,
  TracePath,
  TraceProcess,
  TraceSpanId,
  TraceThreadId
} from './trace-types';

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
    const getSpanNameSpy = vi.spyOn(traceGraph, 'getSpanName');

    const searchRecords: unknown[] = [];
    const searchRecordCount = traceGraph.searchVisibleBlockRecords(
      () => true,
      record => {
        searchRecords.push(record);
      }
    );

    expect(searchRecordCount).toBe(1);
    expect(getSpanNameSpy).toHaveBeenCalledTimes(1);
    expect(getSpanNameSpy).toHaveBeenCalledWith(getRequiredSpanRef(traceGraph, visibleBlock));
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

    const visitedRecords: unknown[] = [];
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
        createSameProcessDependency('dep-root-filtered', root.spanId, filteredParent.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency(
          'dep-filtered-later',
          filteredParent.spanId,
          laterChild.spanId,
          ['PARENT']
        ),
        createSameProcessDependency(
          'dep-filtered-earlier',
          filteredParent.spanId,
          earlierChild.spanId,
          ['PARENT']
        )
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
        createSameProcessDependency('dep-root-filtered-leaf', root.spanId, filteredLeaf.spanId, [
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

    expect(traceGraph.getSpanRefById(selectedBlock.spanId)).toBeNull();
    expect(traceGraph.getSpanDetailSource(exactSpanRef)).toMatchObject({
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
    expect(traceGraph.getSpanOwnerRefs(999999 as SpanRef)).toBeNull();
    expect(traceGraph.getRankNumBySpanRef(999999 as SpanRef)).toBeNull();
  });

  it('walks visible dependency selection through process-local parents when span ids collide', () => {
    const {graph, selectedBlock, selectedParentBlock} = createDuplicateIdSelectionTraversalGraph();
    const traceGraph = createRuntimeTraceGraph(graph);
    const selectedSpanRef = getRequiredSpanRef(traceGraph, selectedBlock);
    expect(traceGraph.getSpanRefById(selectedParentBlock.spanId)).toBeNull();

    const selectionRefs = getTraceSpanDependencySelection({
      traceGraph,
      spanRef: selectedSpanRef,
      keywords: new Set(['PARENT'])
    });
    const selectedAncestorNames = new Set(
      selectionRefs.spanRefs.flatMap(spanRef => {
        const span = traceGraph.getSpanDetailSource(spanRef);
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

    const incomingDependencyEntries = getTraceSpanIncomingDependencyEntries({
      traceGraph,
      spanRef: selectedSpanRef,
      includeHidden: false
    });
    const selectionRefs = getTraceSpanDependencySelection({
      traceGraph,
      spanRef: selectedSpanRef,
      keywords: new Set(['PARENT'])
    });

    expect(incomingDependencyEntries).toEqual([]);
    expect(selectionRefs.parentSpanRefs).toEqual([]);
    expect(selectionRefs.visibleSameProcessDependencyRefs).toEqual([]);
    expect(selectionRefs.visibleCrossProcessDependencyRefs).toEqual([]);
  });

  it('returns span-card dependency chains and children without TraceSpan rows', () => {
    const {graph, selectedBlock, selectedParentBlock} = createDuplicateIdSelectionTraversalGraph();
    const traceGraph = createRuntimeTraceGraph(graph);
    const selectedSpanRef = getRequiredSpanRef(traceGraph, selectedBlock);
    const parentSpanRef = getRequiredSpanRef(traceGraph, selectedParentBlock);

    expect(
      getTraceSpanDependencyChain(traceGraph, selectedSpanRef, 'PARENT').map(span => span.name)
    ).toEqual(['parent-correct']);
    expect(
      getTraceSpanVisibleDependencyChain(traceGraph, selectedSpanRef, 'PARENT').map(
        span => span.name
      )
    ).toEqual(['parent-correct']);
    expect(getTraceSpanChildDependencies(traceGraph, parentSpanRef)).toMatchObject([
      {
        childSpan: {
          name: 'selected-correct'
        }
      }
    ]);
    expect(getTraceSpanDependencyChain(traceGraph, 999999 as SpanRef, 'PARENT')).toEqual([]);
    expect(getTraceSpanChildDependencies(traceGraph, 999999 as SpanRef)).toEqual([]);
  });

  it('drops dependencies whose canonical endpoint is filtered', () => {
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
          'CHAIN'
        ])
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
        createSameProcessDependency('dep-root-parent', root.spanId, filteredParent.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency(
          'dep-parent-parent2',
          filteredParent.spanId,
          filteredParent2.spanId,
          ['PARENT']
        ),
        createSameProcessDependency('dep-parent2-child', filteredParent2.spanId, child.spanId, [
          'PARENT'
        ])
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
        createSameProcessDependency('dep-root-parent', root.spanId, filteredParent.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency('dep-parent-child', filteredParent.spanId, child.spanId, [
          'PARENT'
        ])
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
    const cardModel = getTraceSpanCardModel(traceGraph, selectedSpanRef);

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

  it('caps span-card dependency rows before descriptive dependency materialization', () => {
    const selected = createBlock('selected');
    const incomingSpans = Array.from({length: 105}, (_entry, index) =>
      createBlock(`incoming-${index}`)
    );
    const outgoingSpans = Array.from({length: 105}, (_entry, index) =>
      createBlock(`outgoing-${index}`)
    );
    const graph = createGraphWithBlocks(
      [selected, ...incomingSpans, ...outgoingSpans],
      [
        ...incomingSpans.map((span, index) => ({
          ...createSameProcessDependency(`dep-incoming-${index}`, span.spanId, selected.spanId),
          waitTimeMs: index
        })),
        ...outgoingSpans.map((span, index) => ({
          ...createSameProcessDependency(`dep-outgoing-${index}`, selected.spanId, span.spanId),
          waitTimeMs: index
        }))
      ]
    );
    const traceGraph = createRuntimeTraceGraph(graph);
    const getDependencySourceSpy = vi.spyOn(traceGraph, 'getDependencySource');

    const cardModel = getTraceSpanCardModel(traceGraph, getRequiredSpanRef(traceGraph, selected));

    expect(cardModel?.visibleIncomingDependencyEntries).toHaveLength(100);
    expect(cardModel?.visibleIncomingDependencyEntries[0]?.dependency.dependencyId).toBe(
      'dep-incoming-104'
    );
    expect(
      cardModel?.visibleIncomingDependencyEntries.some(
        entry => entry.dependency.dependencyId === 'dep-incoming-0'
      )
    ).toBe(false);
    expect(cardModel?.visibleIncomingDependencyEntryCount).toBe(105);
    expect(cardModel?.visibleIncomingDependencyEntriesTruncated).toBe(true);
    expect(cardModel?.fullIncomingDependencyEntries).toHaveLength(100);
    expect(cardModel?.fullIncomingDependencyEntries[0]?.dependency.dependencyId).toBe(
      'dep-incoming-104'
    );
    expect(cardModel?.fullIncomingDependencyEntryCount).toBe(105);
    expect(cardModel?.fullIncomingDependencyEntriesTruncated).toBe(true);
    expect(cardModel?.visibleOutgoingDependencyEntries).toHaveLength(100);
    expect(cardModel?.visibleOutgoingDependencyEntries[0]?.dependency.dependencyId).toBe(
      'dep-outgoing-104'
    );
    expect(
      cardModel?.visibleOutgoingDependencyEntries.some(
        entry => entry.dependency.dependencyId === 'dep-outgoing-0'
      )
    ).toBe(false);
    expect(cardModel?.visibleOutgoingDependencyEntryCount).toBe(105);
    expect(cardModel?.visibleOutgoingDependencyEntriesTruncated).toBe(true);
    expect(cardModel?.fullOutgoingDependencyEntries).toHaveLength(100);
    expect(cardModel?.fullOutgoingDependencyEntries[0]?.dependency.dependencyId).toBe(
      'dep-outgoing-104'
    );
    expect(cardModel?.fullOutgoingDependencyEntryCount).toBe(105);
    expect(cardModel?.fullOutgoingDependencyEntriesTruncated).toBe(true);
    expect(getDependencySourceSpy).toHaveBeenCalledTimes(200);
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
        createSameProcessDependency('dep-selected-later', selected.spanId, childLater.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency('dep-selected-earlier', selected.spanId, childEarlier.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency('dep-selected-unrelated', selected.spanId, unrelated.spanId)
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
        createSameProcessDependency('dep-selected-child-one', selected.spanId, childOne.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency('dep-selected-child-two', selected.spanId, childTwo.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency(
          'dep-child-one-grandchild-one-a',
          childOne.spanId,
          grandchildOneA.spanId,
          ['PARENT']
        ),
        createSameProcessDependency(
          'dep-child-one-grandchild-one-b',
          childOne.spanId,
          grandchildOneB.spanId,
          ['PARENT']
        ),
        createSameProcessDependency(
          'dep-child-two-grandchild',
          childTwo.spanId,
          grandchildTwo.spanId,
          ['PARENT']
        )
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

  it('keeps raw descendants but drops visible traversal through filtered intermediate children', () => {
    const selected = createBlock('selected');
    const filteredChild = createBlock('filtered-child');
    const visibleGrandchild = createBlock('visible-grandchild');
    visibleGrandchild.timings.test.startTimeMs = 12;
    visibleGrandchild.timings.test.endTimeMs = 13;
    const graph = createGraphWithBlocks(
      [selected, filteredChild, visibleGrandchild],
      [
        createSameProcessDependency(
          'dep-selected-filtered',
          selected.spanId,
          filteredChild.spanId,
          ['PARENT']
        ),
        createSameProcessDependency(
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
    ).toEqual([]);
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
          sameProcessDependencies: [
            createSameProcessDependency('dep-child-grandchild', child.spanId, grandchild.spanId, [
              'PARENT'
            ])
          ]
        })
      ],
      [
        createCrossProcessDependency(
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
      type: 'trace-same-process-dependency',
      waitMode: 'start-to-start'
    });
  });

  it('safely ignores cycles when resolving descendants', () => {
    const a = createBlock('span-a');
    const b = createBlock('span-b');
    const graph = createGraphWithBlocks(
      [a, b],
      [
        createSameProcessDependency('dep-a-b', a.spanId, b.spanId, ['PARENT']),
        createSameProcessDependency('dep-b-a', b.spanId, a.spanId, ['PARENT'])
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
        createSameProcessDependency('dep-selected-left', selected.spanId, leftBranch.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency('dep-selected-right', selected.spanId, rightBranch.spanId, [
          'PARENT'
        ]),
        createSameProcessDependency(
          'dep-left-grandchild',
          leftBranch.spanId,
          sharedGrandchild.spanId,
          ['PARENT']
        ),
        createSameProcessDependency(
          'dep-right-grandchild',
          rightBranch.spanId,
          sharedGrandchild.spanId,
          ['PARENT']
        )
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
    const sameProcessDependencies = descendants.map(span =>
      createSameProcessDependency(`dep-selected-${span.spanId}`, selected.spanId, span.spanId, [
        'PARENT'
      ])
    );
    const graph = createGraphWithBlocks([selected, ...descendants], sameProcessDependencies);
    const traceGraph = createRuntimeTraceGraph(graph);

    const result = getTraceGraphDescendants(traceGraph, selected);
    expect(result.isTruncated).toBe(true);
    expect(result.limit).toBe(1000);
    expect(result.truncatedCount).toBe(1);
    expect(result.entries).toHaveLength(1000);
    expect(result.entries[0]?.childSpan.spanId).toBe('descendant-1');
    expect(result.entries[999]?.childSpan.spanId).toBe('descendant-1000');
  }, 30000);

  it('resolves recursive descendants on Arrow graphs', () => {
    const selected = createBlock('selected');
    const child = createBlock('child');
    child.timings.test.startTimeMs = 10;
    child.timings.test.endTimeMs = 11;
    const graph = createGraphWithBlocks(
      [selected, child],
      [createSameProcessDependency('dep-selected-child', selected.spanId, child.spanId, ['PARENT'])]
    );
    const traceGraph = createRuntimeTraceGraph(graph);

    const descendants = getTraceGraphDescendants(traceGraph, selected);

    expect(descendants.entries).toHaveLength(1);
    expect(descendants.entries[0]?.childSpan.spanId).toBe(child.spanId);
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
          sameProcessDependencies: [
            createSameProcessDependency('dep-root-local-child', root.spanId, localChild.spanId, [
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
        createCrossProcessDependency(
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
    const rootSpanRef = traceGraph.getSpanRefById(root.spanId)!;
    const selectionState = getTraceSpanDependencySelection({
      traceGraph,
      spanRef: rootSpanRef,
      keywords: new Set(['PARENT'])
    });

    expect(selectionState.originSpanRef).toBe(rootSpanRef);
    expect(
      new Set(
        selectionState.spanRefs.flatMap(spanRef => {
          const spanId = traceGraph.isSpanVisible(spanRef) ? traceGraph.getSpanId(spanRef) : null;
          return spanId ? [spanId] : [];
        })
      )
    ).toEqual(new Set([root.spanId, localChild.spanId, crossChild.spanId]));
    expect(
      new Set(
        selectionState.childSpanRefs.flatMap(spanRef => {
          const spanId = traceGraph.isSpanVisible(spanRef) ? traceGraph.getSpanId(spanRef) : null;
          return spanId ? [spanId] : [];
        })
      )
    ).toEqual(new Set([localChild.spanId, crossChild.spanId]));
    expect(selectionState.parentSpanRefs).toEqual([]);
    expect(
      selectionState.visibleSameProcessDependencyRefs.flatMap(dependencyRef => {
        const dependencyId = traceGraph.getDependencyId(dependencyRef);
        return dependencyId ? [dependencyId] : [];
      })
    ).toEqual(['dep-root-local-child']);
    expect(
      selectionState.childSameProcessDependencyRefs.flatMap(dependencyRef => {
        const dependencyId = traceGraph.getDependencyId(dependencyRef);
        return dependencyId ? [dependencyId] : [];
      })
    ).toEqual(['dep-root-local-child']);
    expect(
      selectionState.visibleCrossProcessDependencyRefs.flatMap(dependencyRef => {
        const dependencyId = traceGraph.getDependencyId(dependencyRef);
        return dependencyId ? [dependencyId] : [];
      })
    ).toEqual(['dep-root-cross-child']);
    expect(
      selectionState.childCrossProcessDependencyRefs.flatMap(dependencyRef => {
        const dependencyId = traceGraph.getDependencyId(dependencyRef);
        return dependencyId ? [dependencyId] : [];
      })
    ).toEqual(['dep-root-cross-child']);

    const processId = traceGraph.processIdsByIndex[0];
    const sameProcessDependencyTable = processId
      ? traceGraph.sameProcessDependencyTableMap[processId]
      : null;
    if (!sameProcessDependencyTable) {
      throw new Error('Expected same-process dependency table');
    }
    const getSameProcessDependencyColumn = sameProcessDependencyTable.getChild.bind(
      sameProcessDependencyTable
    );
    const sameProcessDependencyColumnSpy = vi
      .spyOn(sameProcessDependencyTable, 'getChild')
      .mockImplementation(fieldName => {
        if (fieldName === 'dependencyId' || fieldName === 'keywords') {
          throw new Error(`Unexpected same-process dependency descriptive read: ${fieldName}`);
        }
        return getSameProcessDependencyColumn(fieldName);
      });
    const getCrossProcessDependencyColumn = traceGraph.crossProcessDependencyTable.getChild.bind(
      traceGraph.crossProcessDependencyTable
    );
    const crossProcessDependencyColumnSpy = vi
      .spyOn(traceGraph.crossProcessDependencyTable, 'getChild')
      .mockImplementation(fieldName => {
        if (fieldName === 'dependencyId' || fieldName === 'keywords') {
          throw new Error(`Unexpected cross-process dependency descriptive read: ${fieldName}`);
        }
        return getCrossProcessDependencyColumn(fieldName);
      });
    const getDependencySourceSpy = vi.spyOn(traceGraph, 'getDependencySource');
    const sameProcessDependencyRef = selectionState.childSameProcessDependencyRefs[0]!;
    const localSourcesByProcessId = buildTraceSelectedSameProcessDependencySourcesByProcessId(
      traceGraph,
      new Set([sameProcessDependencyRef]),
      [],
      {
        selectedSameProcessDependencyDirectionByRef: new Map([
          [sameProcessDependencyRef, 'outgoing']
        ])
      }
    );
    expect(Object.values(localSourcesByProcessId).flat()).toEqual([
      expect.objectContaining({
        dependencyRef: sameProcessDependencyRef,
        selectedDirection: 'outgoing'
      })
    ]);
    expect(getDependencySourceSpy).not.toHaveBeenCalled();
    const crossProcessDependencyRef = selectionState.childCrossProcessDependencyRefs[0]!;
    expect(
      buildTraceSelectedCrossProcessDependencySources(
        traceGraph,
        new Set([crossProcessDependencyRef]),
        [],
        {
          selectedCrossProcessDependencyDirectionByRef: new Map([
            [crossProcessDependencyRef, 'outgoing']
          ])
        }
      )
    ).toEqual([
      expect.objectContaining({
        dependencyRef: crossProcessDependencyRef,
        selectedDirection: 'outgoing'
      })
    ]);
    expect(getDependencySourceSpy).not.toHaveBeenCalled();
    sameProcessDependencyColumnSpy.mockRestore();
    crossProcessDependencyColumnSpy.mockRestore();

    expect(
      getTraceSpanDescendants(traceGraph, rootSpanRef).entries.map(
        entry => entry.dependency.dependencyId
      )
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
          sameProcessDependencies: [
            createSameProcessDependency('dep-root-local-child', root.spanId, localChild.spanId, [
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
        createCrossProcessDependency(
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
    const localScanSpy = vi.spyOn(traceGraph, 'getDependencySource');
    const crossScanSpy = vi.spyOn(traceGraph, 'getDependencySource');

    const selectionState = getTraceSpanDependencySelection({
      traceGraph,
      spanRef: traceGraph.getSpanRefById(root.spanId)!,
      keywords: new Set(['PARENT'])
    });

    expect(
      selectionState.childSpanRefs.map(spanRef =>
        traceGraph.isSpanVisible(spanRef) ? traceGraph.getSpanId(spanRef) : null
      )
    ).toEqual([localChild.spanId, crossChild.spanId]);
    expect(
      selectionState.visibleSameProcessDependencyRefs.map(dependencyRef =>
        traceGraph.getDependencyId(dependencyRef)
      )
    ).toEqual(['dep-root-local-child']);
    expect(
      selectionState.visibleCrossProcessDependencyRefs.map(dependencyRef =>
        traceGraph.getDependencyId(dependencyRef)
      )
    ).toEqual(['dep-root-cross-child']);
    expect(localScanSpy).not.toHaveBeenCalled();
    expect(crossScanSpy).not.toHaveBeenCalled();
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
      visibleSameProcessDependencyRefSet: new Set(),
      visibleCrossProcessDependencyRefSet: new Set()
    };

    const pathData = traceGraph.getVisiblePathData([path]);
    expect(pathData.pathBlockSources).toHaveLength(1);
    expect(pathData.pathBlockSources[0]).toMatchObject({
      spanRef: selectedParentSpanRef,
      spanId: selectedParentBlock.spanId
    });
    expect(pathData.pathBlockSources[0]?.span.name).toBe('parent-correct');
  });
});
