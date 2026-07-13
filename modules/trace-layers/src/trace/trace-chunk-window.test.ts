import {describe, expect, it, vi} from 'vitest';

import {
  buildArrowTraceSameProcessDependencyTable,
  buildArrowTraceSameProcessDependencyTableFromColumns,
  buildArrowTraceSpanSidecarTableFromColumns,
  buildArrowTraceSpanTableFromColumns
} from './ingestion/arrow-trace';
import {buildTracePhysicalSpanChunk} from './physical-span-chunk';
import {readTraceChunkSourceDependencyRows} from './trace-chunk-data';
import {createChronologicalTraceChunkSpanBudgetPolicy, TraceChunkStore} from './trace-chunk-store';
import {
  buildHiddenTraceChunkSpanInspectorGraph,
  buildJSONTraceChunkDataFromTraceChunkData,
  buildTraceChunkDataFromJSONTraceChunkData,
  buildTraceChunkRowWindowTable,
  buildTraceChunkSourceDependencyTable,
  buildTraceChunkWindowDataset,
  getTraceChunkStoreSpanDetailSource,
  isJSONTraceChunkData,
  resolveHiddenTraceChunkSpanNavigation,
  searchHiddenTraceChunkSpans,
  searchTraceChunkStoreSpans
} from './trace-chunk-window';
import {forEachTraceDatasetActiveSpanRow, getTraceDatasetSpanRefProcessId} from './trace-dataset';
import {getTraceGraphSpanDetailSource} from './trace-graph-accessors';
import {
  getTraceSpanCardModel,
  getTraceSpanParentChainEntries
} from './trace-graph/build-trace-span-card-data';
import {TraceGraph} from './trace-graph/trace-graph';
import {getTraceSpanDependencySelection} from './trace-graph/trace-graph-selection-utils';
import {
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef
} from './trace-graph/trace-id-encoder';
import {
  createTraceSpanNameSearchPredicate,
  createTraceSpanOmniBoxSearchPredicate
} from './trace-graph/trace-span-name-search';

import type {ArrowTraceSpanTable} from './ingestion/arrow-trace';
import type {TraceChunkDescriptor} from './trace-chunk-store';
import type {
  TraceChunk,
  TraceChunkData,
  TraceChunkSourceDependencyRow,
  TraceChunkSpanOverlapRange
} from './trace-chunk-window';
import type {SpanRef, TraceProcessId, TraceSpanId, TraceThreadId} from './trace-graph/trace-types';

type TestDescriptor = TraceChunkDescriptor & {
  /** Test marker used to make descriptor types concrete. */
  readonly testKind: 'chunk';
};

type TestTraceChunkRow = {
  /** Source timing row value used to keep test data distinct from direct chunk-table rows. */
  readonly rowIndex: number;
  /** Stable external span id stored in the Arrow span table. */
  readonly externalSpanId: string;
  /** Stable external parent span id stored in chunk metadata. */
  readonly parentExternalSpanId: string | null;
  /** Optional display name stored separately from the external span id. */
  readonly name?: string;
  /** Optional source label stored in the Arrow span table. */
  readonly source: string | null;
  /** Window-overlap ranges stored in chunk metadata. */
  readonly overlapRanges: readonly TraceChunkSpanOverlapRange[];
};

describe('Trace chunks', () => {
  it('keeps finalized chunk identity in row-selected window datasets', async () => {
    const {store} = await createLoadedStore(
      createTraceChunkData([
        createRow('visible', {overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]}),
        createRow('outside', {overlapRanges: [{startTimeMs: 0, endTimeMs: 5}]})
      ])
    );
    const selection = store.select({
      window: {startTimeMs: 10, endTimeMs: 20},
      spanBudget: null
    });
    const readyChunk = store.getReadyChunks(selection.selectedDescriptors)[0];
    const traceDataset = store.withReadyChunks(selection, ({ownerRefRegistry, readyChunks}) =>
      buildTraceChunkWindowDataset({
        name: 'chunk-test',
        ownerRefRegistry,
        window: {id: 'active', minTimeMs: 10, maxTimeMs: 20},
        readyChunks
      })
    );

    expect(traceDataset).not.toBeNull();
    expect(traceDataset?.chunks[0]).toBe(readyChunk?.payload);
    expect(traceDataset?.spanRefs).toEqual([encodeSpanRef(0, 0)]);
    expect(traceDataset?.processSpanTableMap['test-process' as TraceProcessId]?.numRows).toBe(1);
    expect(getTraceDatasetSpanRefProcessId(traceDataset!, encodeSpanRef(0, 0))).toBe(
      'test-process'
    );
    expect(getTraceDatasetSpanRefProcessId(traceDataset!, encodeSpanRef(0, 1))).toBeNull();
    const activeRows: Array<{rowIndex: number; spanRef: SpanRef}> = [];
    forEachTraceDatasetActiveSpanRow(traceDataset!, (_chunk, rowIndex, spanRef) => {
      activeRows.push({rowIndex, spanRef});
    });
    expect(activeRows).toEqual([{rowIndex: 0, spanRef: encodeSpanRef(0, 0)}]);

    const traceGraph = new TraceGraph({traceDataset: traceDataset!, traceStore: store});
    expect(traceGraph.spanRefs).toEqual([encodeSpanRef(0, 0)]);
  });

  it('resolves row-local owners in multi-process window chunks', async () => {
    const {store} = await createLoadedStore(
      buildTracePhysicalSpanChunk(
        {
          externalSpanIds: ['span-a', 'span-b'],
          processIds: ['process-a', 'process-b'],
          processNames: ['Process A', 'Process B'],
          threadIds: ['thread-a', 'thread-b'],
          names: ['Span A', 'Span B'],
          startTimeMs: [10, 11],
          endTimeMs: [12, 13]
        },
        {chunkKey: 'test-chunk'}
      )
    );
    const traceDataset = materializeTestTraceGraph(store, 'active', null)?.traceDataset;

    expect(traceDataset).not.toBeNull();
    expect(getTraceDatasetSpanRefProcessId(traceDataset!, encodeSpanRef(0, 0))).toBe('process-a');
    expect(getTraceDatasetSpanRefProcessId(traceDataset!, encodeSpanRef(0, 1))).toBe('process-b');
  });

  it('resolves exact ready span refs without rebuilding the ready chunk catalog', async () => {
    const payload = {
      ...createTraceChunkData([
        createRow('root', {overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]})
      ]),
      spanSidecarTable: buildArrowTraceSpanSidecarTableFromColumns({
        rowCount: 1,
        keywords: [[]],
        userDataJson: ['{}'],
        timings: {
          latest_start: {
            statusCode: [2],
            startTimeMs: [10.25],
            endTimeMs: [10.75],
            durationMs: [0.5]
          }
        }
      })
    } satisfies TraceChunkData;
    const {store} = await createLoadedStore(payload);
    const getReadyChunks = vi.spyOn(store, 'getReadyChunks');

    expect(getTraceChunkStoreSpanDetailSource(store, encodeTestSpanRef(0))).toMatchObject({
      name: 'root',
      timings: {
        measured: expect.objectContaining({
          status: 'finished',
          startTimeMs: 0,
          endTimeMs: 1,
          durationMs: 1
        }),
        latest_start: expect.objectContaining({
          status: 'finished',
          startTimeMs: 10.25,
          endTimeMs: 10.75,
          durationMs: 0.5
        })
      }
    });
    expect(getReadyChunks).not.toHaveBeenCalled();
  });

  it('searches ready chunk rows outside the active window without loading chunks', async () => {
    const payload = createTraceChunkData([
      createRow('root', {overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]}),
      createRow('hidden-target', {
        source: 'target_file.py:30',
        parentExternalSpanId: 'root',
        overlapRanges: [{startTimeMs: 1, endTimeMs: 2}]
      })
    ]);
    const {store, loadChunkCalls} = await createLoadedStore(payload);
    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }

    const storeResults = store.searchSpans({
      traceGraph,
      matchesSearchText: searchText => searchText.includes('target_file.py'),
      limit: 50
    });
    const results = searchHiddenTraceChunkSpans({
      traceChunkStore: store,
      traceGraph,
      matchesQuery: searchText => searchText.includes('target_file.py'),
      limit: 50
    });

    expect(loadChunkCalls).toBe(1);
    expect(storeResults).toHaveLength(1);
    expect(storeResults[0]).toMatchObject({
      blockName: 'hidden-target',
      filterReason: expect.objectContaining({
        isFiltered: true,
        state: 'outside-window'
      })
    });
    expect(getTraceSpanCardModel(traceGraph, storeResults[0]!.spanRef)?.span.name).toBe(
      'hidden-target'
    );
    expect(traceGraph.getTraceSpanFilterNavigation(storeResults[0]!.spanRef)).toMatchObject({
      reasonLabel: 'Hidden by: time window'
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      externalSpanId: 'hidden-target',
      source: 'target_file.py:30',
      reasonLabel: 'Hidden by: time window'
    });
    expect(traceGraph.spanFilterReason(encodeTestSpanRef(results[0]!.rowIndex))).toMatchObject({
      isFiltered: true,
      state: 'outside-window'
    });
  });

  it('prioritizes visible span matches over earlier hidden matches', async () => {
    const payload = createTraceChunkData([
      createRow('hidden-match', {
        rowIndex: 0,
        overlapRanges: [{startTimeMs: 1, endTimeMs: 2}]
      }),
      createRow('visible-match', {
        rowIndex: 1,
        overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
      })
    ]);
    const {store} = await createLoadedStore(payload);
    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }

    const firstResult = store.searchSpans({
      traceGraph,
      matchesSearchText: searchText => searchText.includes('match'),
      limit: 1
    });
    const allResults = store.searchSpans({
      traceGraph,
      matchesSearchText: searchText => searchText.includes('match'),
      limit: 2
    });

    expect(firstResult.map(record => record.blockName)).toEqual(['visible-match']);
    expect(firstResult[0]?.filterReason.isFiltered).toBe(false);
    expect(allResults.map(record => record.blockName)).toEqual(['visible-match', 'hidden-match']);
  });

  it('does not search unloaded descriptors or trigger chunk loads', async () => {
    const payload = createTraceChunkData([
      createRow('loaded-target', {
        source: 'loaded.py:10',
        overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
      })
    ]);
    const {store, loadChunkCalls} = await createLoadedStore(payload);
    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }
    store.replaceDescriptors([createDescriptor(), createDescriptor('unloaded-chunk')]);

    const methodResults = store.searchSpans({
      traceGraph,
      matchesSearchText: searchText => searchText.includes('target'),
      limit: 50
    });
    const helperResults = searchTraceChunkStoreSpans({
      traceChunkStore: store,
      traceGraph,
      matchesSearchText: searchText => searchText.includes('target'),
      limit: 50
    });

    expect(loadChunkCalls).toBe(1);
    expect(methodResults.map(record => record.blockName)).toEqual(['loaded-target']);
    expect(helperResults.map(record => record.blockName)).toEqual(['loaded-target']);
  });

  it('returns exact external ids before text matches without duplicating or loading chunks', async () => {
    const payload = createTraceChunkData([
      createRow('other-id', {
        name: 'Exact:Case text match',
        rowIndex: 0,
        overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
      }),
      createRow('Exact:Case', {
        name: 'Exact:Case exact target',
        rowIndex: 1,
        overlapRanges: [{startTimeMs: 0, endTimeMs: 5}]
      })
    ]);
    const {store, loadChunkCalls} = await createLoadedStore(payload);
    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }
    store.replaceDescriptors([createDescriptor(), createDescriptor('unloaded-chunk')]);
    const matchesSearchText = createTraceSpanOmniBoxSearchPredicate('  Exact:Case  ');
    if (!matchesSearchText) {
      throw new Error('Expected Omnibox search predicate');
    }

    const results = store.searchSpans({
      traceGraph,
      matchesSearchText,
      limit: 2
    });

    expect(loadChunkCalls).toBe(1);
    expect(results.map(record => record.blockName)).toEqual([
      'Exact:Case exact target',
      'Exact:Case text match'
    ]);
    expect(results[0]?.filterReason.isFiltered).toBe(true);
  });

  it('does not partially or case-insensitively match external ids', async () => {
    const payload = createTraceChunkData([
      createRow('Exact:Case', {
        name: 'unrelated target name',
        rowIndex: 0,
        overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
      })
    ]);
    const {store} = await createLoadedStore(payload);
    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }
    const prefixMatcher = createTraceSpanOmniBoxSearchPredicate('Exact:Cas');
    const lowercaseMatcher = createTraceSpanOmniBoxSearchPredicate('exact:case');
    if (!prefixMatcher || !lowercaseMatcher) {
      throw new Error('Expected Omnibox search predicates');
    }

    expect(
      store.searchSpans({
        traceGraph,
        matchesSearchText: prefixMatcher,
        limit: 1
      })
    ).toEqual([]);
    expect(
      store.searchSpans({
        traceGraph,
        matchesSearchText: lowercaseMatcher,
        limit: 1
      })
    ).toEqual([]);
  });

  it('keeps nonmatching loaded searches off rich row columns', async () => {
    const payload = createTraceChunkData([
      createRow('loaded-target', {
        source: 'loaded.py:10',
        overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
      })
    ]);
    const {store} = await createLoadedStore(payload);
    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }
    const loadedChunk = store.getLoadedChunk('test-chunk');
    if (!loadedChunk) {
      throw new Error('Expected loaded chunk');
    }
    replaceTraceChunkSpanTable(
      loadedChunk,
      guardTraceChunkRichSearchColumns(loadedChunk.spanTable)
    );

    expect(
      store.searchSpans({
        traceGraph,
        matchesSearchText: searchText => searchText.includes('missing-target'),
        limit: 50
      })
    ).toEqual([]);
    expect(
      searchHiddenTraceChunkSpans({
        traceChunkStore: store,
        traceGraph,
        matchesQuery: searchText => searchText.includes('missing-target'),
        limit: 50
      })
    ).toEqual([]);
  });

  it('checks matching plain-text loaded names before wider search fields', async () => {
    const payload = createTraceChunkData([
      createRow('loaded-target', {
        source: 'loaded.py:10',
        overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
      })
    ]);
    const {store} = await createLoadedStore(payload);
    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }
    const loadedChunk = store.getLoadedChunk('test-chunk');
    if (!loadedChunk) {
      throw new Error('Expected loaded chunk');
    }
    const columnReads: string[] = [];
    replaceTraceChunkSpanTable(
      loadedChunk,
      recordTraceChunkSpanColumnReads(loadedChunk.spanTable, columnReads)
    );
    const matchesSearchText = createTraceSpanNameSearchPredicate('loaded-target');
    if (!matchesSearchText) {
      throw new Error('Expected plain-text search predicate');
    }

    expect(
      store.searchSpans({
        traceGraph,
        matchesSearchText,
        limit: 1
      })
    ).toHaveLength(1);
    expect(columnReads[0]).toBe('name.data');
    expect(columnReads.indexOf('name.data')).toBeLessThan(columnReads.indexOf('process_ref.get'));
  });

  it('keeps matching loaded search records off row-only columns', async () => {
    const payload = createTraceChunkData([
      createRow('loaded-target', {
        source: 'loaded.py:10',
        overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
      })
    ]);
    const {store} = await createLoadedStore(payload);
    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }
    const loadedChunk = store.getLoadedChunk('test-chunk');
    if (!loadedChunk) {
      throw new Error('Expected loaded chunk');
    }
    replaceTraceChunkSpanTable(
      loadedChunk,
      guardTraceChunkSearchRecordRowOnlyColumns(loadedChunk.spanTable)
    );
    const matchesSearchText = createTraceSpanNameSearchPredicate('loaded-target');
    if (!matchesSearchText) {
      throw new Error('Expected plain-text search predicate');
    }

    expect(
      store
        .searchSpans({
          traceGraph,
          matchesSearchText,
          limit: 1
        })
        .map(record => record.blockName)
    ).toEqual(['loaded-target']);
  });

  it('keeps plain-text loaded name matches off malformed chunk rows', async () => {
    const payload = {
      ...createTraceChunkData([
        createRow('loaded-target', {
          source: 'loaded.py:10',
          overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
        })
      ]),
      processes: []
    } satisfies TraceChunkData;
    const {store} = await createLoadedStore(payload);
    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }
    const matchesSearchText = createTraceSpanNameSearchPredicate('loaded-target');
    if (!matchesSearchText) {
      throw new Error('Expected plain-text search predicate');
    }

    expect(
      store.searchSpans({
        traceGraph,
        matchesSearchText,
        limit: 1
      })
    ).toEqual([]);
  });

  it('keeps nonmatching plain-text loaded searches off metadata cell reads', async () => {
    const payload = createTraceChunkData([
      createRow('loaded-target', {
        source: 'loaded.py:10',
        overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
      })
    ]);
    const {store} = await createLoadedStore(payload);
    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }
    const loadedChunk = store.getLoadedChunk('test-chunk');
    if (!loadedChunk) {
      throw new Error('Expected loaded chunk');
    }
    const columnReads: string[] = [];
    replaceTraceChunkSpanTable(
      loadedChunk,
      recordTraceChunkSpanColumnReads(loadedChunk.spanTable, columnReads)
    );
    const matchesSearchText = createTraceSpanNameSearchPredicate('missing-target');
    if (!matchesSearchText) {
      throw new Error('Expected plain-text search predicate');
    }

    expect(
      store.searchSpans({
        traceGraph,
        matchesSearchText,
        limit: 1
      })
    ).toEqual([]);
    expect(columnReads).not.toContain('process_ref.get');
    expect(columnReads).not.toContain('thread_id.get');
  });

  it('resolves visible ancestors and descendants through chunk parent pointers', async () => {
    const payload = createTraceChunkData([
      createRow('visible-ancestor', {overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]}),
      createRow('hidden-parent', {
        parentExternalSpanId: 'visible-ancestor',
        overlapRanges: [{startTimeMs: 1, endTimeMs: 2}]
      }),
      createRow('hidden-target', {
        parentExternalSpanId: 'hidden-parent',
        overlapRanges: [{startTimeMs: 1, endTimeMs: 2}]
      }),
      createRow('visible-descendant', {
        parentExternalSpanId: 'hidden-target',
        overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
      })
    ]);
    const {store} = await createLoadedStore(payload);
    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }
    const [result] = searchHiddenTraceChunkSpans({
      traceChunkStore: store,
      traceGraph,
      matchesQuery: searchText => searchText.includes('hidden-target'),
      limit: 50
    });
    if (!result) {
      throw new Error('Expected hidden chunk result');
    }

    const navigation = resolveHiddenTraceChunkSpanNavigation({
      result,
      traceChunkStore: store,
      traceGraph
    });
    const genericNavigation = traceGraph.getTraceSpanFilterNavigation(
      encodeTestSpanRef(result.rowIndex)
    );
    const inspectorModel = buildHiddenTraceChunkSpanInspectorGraph(result);

    expect(readSpanName(traceGraph, navigation.visibleAncestorSpanRef)).toBe('visible-ancestor');
    expect(readSpanName(traceGraph, navigation.visibleDescendantSpanRef)).toBe(
      'visible-descendant'
    );
    expect(readSpanName(traceGraph, genericNavigation?.visibleAncestorSpanRef ?? null)).toBe(
      'visible-ancestor'
    );
    expect(readSpanName(traceGraph, genericNavigation?.visibleDescendantSpanRef ?? null)).toBe(
      'visible-descendant'
    );
    expect(
      getTraceGraphSpanDetailSource(inspectorModel.traceGraph, inspectorModel.spanRef)?.name
    ).toBe('hidden-target');
    expect(inspectorModel.traceGraph.traceDataset?.chunks).toHaveLength(1);
    expect(inspectorModel.traceGraph.traceDataset?.chunks[0]?.refState).toBe('store-finalized');
  });

  it('materializes every visible parent source row for dependency selection and cards', async () => {
    const payload = createTraceChunkData(
      [createRow('parent-a'), createRow('parent-b'), createRow('child')],
      {
        sourceDependencyRows: [
          createParentSourceDependencyRow('parent-a', 'child'),
          createParentSourceDependencyRow('parent-b', 'child')
        ]
      }
    );
    const {store} = await createLoadedStore(payload);
    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }
    const childSpanRef = traceGraph.getSpanRefById('child' as TraceSpanId);
    if (childSpanRef == null) {
      throw new Error('Expected child span ref');
    }

    const selection = getTraceSpanDependencySelection({
      traceGraph,
      spanRef: childSpanRef,
      keywords: new Set(['PARENT'])
    });
    const parentChainEntries = getTraceSpanParentChainEntries({
      traceGraph,
      spanRef: childSpanRef,
      includeHidden: false
    });

    expect(selection.visibleSameProcessDependencyRefs).toHaveLength(2);
    expect(selection.parentSpanRefs.map(spanRef => readSpanName(traceGraph, spanRef))).toEqual([
      'parent-a',
      'parent-b'
    ]);
    expect(
      parentChainEntries.map(entry => ({
        chainIndex: entry.chainIndex,
        name: entry.span.name
      }))
    ).toEqual([
      {chainIndex: 1, name: 'parent-a'},
      {chainIndex: 1, name: 'parent-b'}
    ]);
  });

  it('reconstructs separate-chunk parent refs from canonical dependency rows for Shift-click selection', async () => {
    const descriptors = [
      createDescriptor('parent-chunk', {sortStartTimeMs: 0}),
      createDescriptor('child-chunk', {sortStartTimeMs: 1})
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'chunk-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    store.add(
      createTraceChunkData([createRow('parent', {rowIndex: 0})], {
        chunkKey: 'parent-chunk'
      })
    );
    store.add(
      createTraceChunkData([createRow('child', {rowIndex: 0})], {
        chunkKey: 'child-chunk',
        sourceDependencyRows: [createParentSourceDependencyRow('parent', 'child')]
      })
    );
    await store.loadWindow({
      window: {id: 'active', minTimeMs: 10, maxTimeMs: 20},
      loadChunk: async () => {
        throw new Error('Chunks should already be loaded.');
      }
    });

    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }
    const parentSpanRef = traceGraph.getSpanRefById('parent' as TraceSpanId);
    const childSpanRef = traceGraph.getSpanRefById('child' as TraceSpanId);
    if (parentSpanRef == null || childSpanRef == null) {
      throw new Error('Expected parent and child span refs');
    }
    const parentChunk = store.getLoadedChunk('parent-chunk');
    const childChunk = store.getLoadedChunk('child-chunk');
    if (!parentChunk || !childChunk) {
      throw new Error('Expected loaded parent and child chunks');
    }

    const selection = getTraceSpanDependencySelection({
      traceGraph,
      spanRef: childSpanRef,
      keywords: new Set(['PARENT'])
    });

    expect(parentChunk.spanSidecarTable?.getChild('outgoingSameProcessDependencyRefs')).toBeNull();
    expect(childChunk.spanSidecarTable?.getChild('incomingSameProcessDependencyRefs')).toBeNull();
    expect(
      traceGraph.getSpanDirectionalDependencyRefs(parentSpanRef, 'outgoing')
        .sameProcessDependencyRefs
    ).toHaveLength(1);
    expect(
      traceGraph.getSpanDirectionalDependencyRefs(childSpanRef, 'incoming')
        .sameProcessDependencyRefs
    ).toHaveLength(1);
    expect(selection.parentSpanRefs).toEqual([parentSpanRef]);
    expect(selection.spanRefs).toEqual([childSpanRef, parentSpanRef]);
    expect(selection.visibleSameProcessDependencyRefs).toHaveLength(1);
  });

  it('materializes thread metadata from the current store snapshot instead of stale chunk snapshots', async () => {
    const descriptors = [
      createDescriptor('early-selected-chunk', {sortStartTimeMs: 0}),
      createDescriptor('late-selected-chunk', {sortStartTimeMs: 1})
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'chunk-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });

    store.add(
      createTraceChunkData([createRow('late-row')], {
        chunkKey: 'late-selected-chunk',
        threadId: 'thread-one',
        threadName: 'thread-one'
      })
    );
    store.add(
      createTraceChunkData([createRow('early-row')], {
        chunkKey: 'early-selected-chunk',
        threadId: 'thread-two',
        threadName: 'thread-two'
      })
    );
    await store.loadWindow({
      window: {id: 'active', minTimeMs: 10, maxTimeMs: 20},
      loadChunk: async () => {
        throw new Error('Chunks should already be loaded.');
      }
    });

    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    expect(
      traceGraph?.getThreadSourcesByProcessRef(encodeProcessRef(0)).map(thread => ({
        threadId: thread.threadId,
        name: thread.name
      }))
    ).toEqual([
      {threadId: 'thread-one', name: 'thread-one'},
      {threadId: 'thread-two', name: 'thread-two'}
    ]);
    expect(
      traceGraph
        ? getVisibleSpanDetailsByProcess(traceGraph, encodeProcessRef(0)).map(span => span.name)
        : undefined
    ).toEqual(['early-row', 'late-row']);
  });

  it('materializes window rows without deserializing full timing JSON', async () => {
    const {store} = await createLoadedStore(
      createTraceChunkData([createRow('visible-row', {rowIndex: 7})])
    );
    const loadedChunk = store.getLoadedChunk('test-chunk');
    if (!loadedChunk) {
      throw new Error('Expected loaded test chunk');
    }
    replaceTraceChunkSpanTable(
      loadedChunk,
      guardTraceChunkWindowTimingJsonColumn(loadedChunk.spanTable)
    );

    const traceGraph = materializeTestTraceGraph(store, 'active', null);

    expect(traceGraph?.stats.spanCount).toBe(1);
    expect({
      minTimeMs: traceGraph?.minTimeMs,
      maxTimeMs: traceGraph?.maxTimeMs
    }).toEqual({minTimeMs: 7, maxTimeMs: 8});
  });

  it('materializes same-process rows from multiple chunks without overwriting earlier chunks', async () => {
    const descriptors = [
      createDescriptor('same-process-a', {sortStartTimeMs: 0}),
      createDescriptor('same-process-b', {sortStartTimeMs: 1})
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'chunk-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });

    store.add(
      createTraceChunkData([createRow('same-process-a', {rowIndex: 0})], {
        chunkKey: 'same-process-a'
      })
    );
    store.add(
      createTraceChunkData([createRow('same-process-b', {rowIndex: 0})], {
        chunkKey: 'same-process-b'
      })
    );
    await store.loadWindow({
      window: {id: 'active', minTimeMs: 10, maxTimeMs: 20},
      loadChunk: async () => {
        throw new Error('Chunks should already be loaded.');
      }
    });

    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }
    const searchResults = store.searchSpans({
      traceGraph,
      matchesSearchText: searchText => searchText.includes('same-process'),
      limit: 10
    });

    expect(traceGraph.spanRefs).toEqual([encodeSpanRef(0, 0), encodeSpanRef(1, 0)]);
    expect(
      getVisibleSpanDetailsByProcess(traceGraph, encodeProcessRef(0)).map(span => span.name)
    ).toEqual(['same-process-a', 'same-process-b']);
    expect(searchResults.map(record => record.blockName)).toEqual([
      'same-process-a',
      'same-process-b'
    ]);
  });

  it('keeps chunks addressable when chronological order differs from chunk-index order', async () => {
    const descriptors = [
      createDescriptor('registered-late', {sortStartTimeMs: 20}),
      createDescriptor('registered-early', {sortStartTimeMs: 10})
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'chunk-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });

    store.add(
      createTraceChunkData([createRow('registered-late', {rowIndex: 0})], {
        chunkKey: 'registered-late'
      })
    );
    store.add(
      createTraceChunkData([createRow('registered-early', {rowIndex: 0})], {
        chunkKey: 'registered-early'
      })
    );
    await store.loadWindow({
      window: {id: 'active', minTimeMs: 10, maxTimeMs: 20},
      loadChunk: async () => {
        throw new Error('Chunks should already be loaded.');
      }
    });

    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }

    expect(traceGraph.chunks.map(chunk => chunk.chunkIndex)).toEqual([0, 1]);
    expect(traceGraph.spanRefs).toEqual([encodeSpanRef(0, 0), encodeSpanRef(1, 0)]);
    expect(
      getVisibleSpanDetailsByProcess(traceGraph, encodeProcessRef(0)).map(span => span.name)
    ).toEqual(['registered-late', 'registered-early']);
  });

  it('materializes selected rows for non-zero store process refs', async () => {
    const descriptors = [
      createDescriptor('process-zero-chunk', {sortStartTimeMs: 0}),
      createDescriptor('process-one-chunk', {sortStartTimeMs: 1})
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'chunk-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });

    store.add(
      createTraceChunkData(
        [
          createRow('outside-process-zero', {
            rowIndex: 0,
            overlapRanges: [{startTimeMs: 1, endTimeMs: 2}]
          })
        ],
        {
          chunkKey: 'process-zero-chunk',
          processId: 'process-zero' as TraceProcessId,
          processName: 'process-zero'
        }
      )
    );
    store.add(
      createTraceChunkData([createRow('visible-process-one', {rowIndex: 0})], {
        chunkKey: 'process-one-chunk',
        processId: 'process-one' as TraceProcessId,
        processName: 'process-one'
      })
    );
    await store.loadWindow({
      window: {id: 'active', minTimeMs: 10, maxTimeMs: 20},
      loadChunk: async () => {
        throw new Error('Chunks should already be loaded.');
      }
    });

    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }

    expect(traceGraph.processIdsByIndex).toEqual(['process-zero', 'process-one']);
    expect(traceGraph.processes.map(process => process.processId)).toEqual([
      'process-zero',
      'process-one'
    ]);
    expect(traceGraph.spanRefs).toEqual([encodeSpanRef(1, 0)]);
    expect(traceGraph.getVisibleProcessRefs()).toEqual([encodeProcessRef(1)]);
    expect(
      getVisibleSpanDetailsByProcess(traceGraph, encodeProcessRef(1)).map(span => span.name)
    ).toEqual(['visible-process-one']);
  });

  it('materializes JSONTraceChunkData through TraceChunkData into a TraceGraph', async () => {
    const chunkData = {
      ...createTraceChunkData([
        createRow('json-visible', {
          rowIndex: 0,
          source: 'json-source.py:10',
          overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
        })
      ]),
      spanSidecarTable: buildArrowTraceSpanSidecarTableFromColumns({
        rowCount: 1,
        keywords: [[]],
        userDataJson: ['{}'],
        timings: {
          latest_start: {
            statusCode: [2],
            startTimeMs: [10.25],
            endTimeMs: [10.75],
            durationMs: [0.5]
          }
        }
      })
    } satisfies TraceChunkData;
    const jsonChunkData = buildJSONTraceChunkDataFromTraceChunkData(chunkData);

    expect(isJSONTraceChunkData(jsonChunkData)).toBe(true);
    expect(jsonChunkData.spanSidecarColumns?.timings?.latest_start).toEqual({
      statusCode: [2],
      startTimeMs: [10.25],
      endTimeMs: [10.75],
      durationMs: [0.5]
    });

    const payload = buildTraceChunkDataFromJSONTraceChunkData(jsonChunkData);
    const {store} = await createLoadedStore(payload);
    const traceGraph = materializeTestTraceGraph(store, 'active', null);
    if (!traceGraph) {
      throw new Error('Expected active window graph');
    }

    expect(traceGraph.stats.spanCount).toBe(1);
    expect(
      getVisibleSpanDetailsByProcess(traceGraph, encodeProcessRef(0)).map(span => span.name)
    ).toEqual(['json-visible']);
    expect(getTraceGraphSpanDetailSource(traceGraph, encodeTestSpanRef(0))).toMatchObject({
      name: 'json-visible',
      source: 'json-source.py:10',
      timings: {
        latest_start: expect.objectContaining({
          status: 'finished',
          startTimeMs: 10.25,
          endTimeMs: 10.75,
          durationMs: 0.5
        })
      }
    });
  });

  it('keeps same-process dependency identity implicit through JSON chunks', () => {
    const chunkData = {
      ...createTraceChunkData([createRow('parent'), createRow('child')]),
      resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTableFromColumns({
        startSpanRef: [encodeSpanRef(0, 0)],
        endSpanRef: [encodeSpanRef(0, 1)],
        waitMode: ['end-to-start'],
        bidirectional: [false],
        waitTimeMs: [0],
        keywords: [['PARENT']],
        hasParentKeyword: [true]
      })
    } satisfies TraceChunkData;

    const roundTrippedChunkData = buildTraceChunkDataFromJSONTraceChunkData(
      buildJSONTraceChunkDataFromTraceChunkData(chunkData)
    );

    expect(
      roundTrippedChunkData.resolvedSameProcessDependencyTable.getChild('dependencyId')
    ).toBeNull();
    expect(
      roundTrippedChunkData.resolvedSameProcessDependencyTable.getChild('startSpanId')
    ).toBeNull();
    expect(
      roundTrippedChunkData.resolvedSameProcessDependencyTable.getChild('endSpanId')
    ).toBeNull();
    expect(
      roundTrippedChunkData.resolvedSameProcessDependencyTable.getChild('dependencyRef')
    ).toBeNull();
  });

  it('preserves Arrow source dependency rows through JSON chunks', () => {
    const sourceDependencyRows = [createParentSourceDependencyRow('parent', 'child')];
    const roundTrippedChunkData = buildTraceChunkDataFromJSONTraceChunkData(
      buildJSONTraceChunkDataFromTraceChunkData(
        createTraceChunkData([createRow('parent'), createRow('child')], {
          sourceDependencyRows
        })
      )
    );

    expect(
      readTraceChunkSourceDependencyRows(roundTrippedChunkData.sourceDependencyTable!)
    ).toEqual(sourceDependencyRows);
  });
});

async function createLoadedStore(payload: TraceChunkData): Promise<{
  /** Loaded test chunk store retaining the supplied payload. */
  readonly store: TraceChunkStore<TraceChunk, TestDescriptor>;
  readonly loadChunkCalls: number;
}> {
  const descriptor = createDescriptor();
  const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
    identityKey: 'chunk-test',
    descriptors: [descriptor],
    selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
  });
  let loadChunkCalls = 0;
  await store.loadWindow({
    window: {id: 'active', minTimeMs: 10, maxTimeMs: 20},
    loadChunk: async () => {
      loadChunkCalls += 1;
      return payload;
    }
  });
  return {store, loadChunkCalls};
}

/** Materialize one registered test window into the TraceGraph runtime boundary. */
function materializeTestTraceGraph(
  store: TraceChunkStore<TraceChunk, TestDescriptor>,
  windowId: string,
  spanBudget: number | null
): TraceGraph | null {
  const selection = store.select({
    window: {startTimeMs: 10, endTimeMs: 20},
    spanBudget
  });
  const traceDataset = store.withReadyChunks(selection, ({ownerRefRegistry, readyChunks}) =>
    buildTraceChunkWindowDataset({
      name: 'chunk-test',
      ownerRefRegistry,
      window: {id: windowId, minTimeMs: 10, maxTimeMs: 20},
      readyChunks
    })
  );
  return traceDataset ? new TraceGraph({traceDataset, traceStore: store}) : null;
}

function createDescriptor(
  chunkKey = 'test-chunk',
  options: Partial<Pick<TestDescriptor, 'sortStartTimeMs' | 'sortEndTimeMs'>> = {}
): TestDescriptor {
  return {
    chunkKey,
    familyKey: 'test-family',
    startTimeMs: 0,
    endTimeMs: 30,
    sortStartTimeMs: options.sortStartTimeMs ?? 0,
    sortEndTimeMs: options.sortEndTimeMs ?? 30,
    advertisedSpanCount: 4,
    testKind: 'chunk'
  };
}

function createTraceChunkData(
  rows: readonly TestTraceChunkRow[],
  options: {
    readonly chunkKey?: string;
    readonly processId?: TraceProcessId;
    readonly processName?: string;
    readonly sourceDependencyRows?: readonly TraceChunkSourceDependencyRow[];
    readonly threadId?: string;
    readonly threadName?: string;
  } = {}
): TraceChunkData {
  const processId = options.processId ?? ('test-process' as TraceProcessId);
  const threadId = (options.threadId ?? 'test-thread') as TraceThreadId;
  const sourceDependencyRows =
    options.sourceDependencyRows ??
    rows.flatMap(row =>
      row.parentExternalSpanId
        ? [createParentSourceDependencyRow(row.parentExternalSpanId, row.externalSpanId)]
        : []
    );
  const thread = {
    type: 'trace-thread',
    threadId,
    processId,
    name: options.threadName ?? 'test-thread'
  } as const;
  return {
    type: 'trace-chunk-data',
    chunkKey: options.chunkKey ?? 'test-chunk',
    processes: [
      {
        type: 'trace-process',
        processId,
        name: options.processName ?? 'test-process',
        rankNum: 0,
        stepNum: 0,
        threads: [thread],
        threadMap: {[thread.threadId]: thread},
        instants: [],
        instantMap: {},
        threadInstantMap: {},
        counters: [],
        counterMap: {},
        threadCounterMap: {},
        sameProcessDependencies: [],
        remoteDependencies: []
      }
    ],
    spanTable: buildArrowTraceSpanTableFromColumns({
      process_ref: rows.map(() => encodeProcessRef(0)),
      thread_ref: rows.map(() => encodeProcessThreadRef(0, 0)),
      span_id: rows.map(row => row.externalSpanId as TraceSpanId),
      external_span_id: rows.map(row => row.externalSpanId),
      thread_id: rows.map(() => threadId),
      name: rows.map(row => row.name ?? row.externalSpanId),
      source: rows.map(row => row.source),
      primary_timing_key: rows.map(() => 'measured'),
      status: rows.map(() => 'finished'),
      start_time_ms: rows.map(row => row.rowIndex),
      end_time_ms: rows.map(row => row.rowIndex + 1),
      duration_ms: rows.map(() => 1)
    }),
    resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTable([]),
    spanSidecarTable: buildArrowTraceSpanSidecarTableFromColumns({
      rowCount: rows.length,
      keywords: rows.map(() => []),
      userDataJson: rows.map(() => '{}')
    }),
    sourceDependencyTable: buildTraceChunkSourceDependencyTable(sourceDependencyRows),
    rowWindowTable: buildTraceChunkRowWindowTable(rows.map(row => row.overlapRanges)),
    diagnostics: {
      rowCount: rows.length,
      notStartedSpanCount: 0,
      unfinishedSpanCount: 0,
      invalidRecordCount: 0,
      minTimeMs: 0,
      maxTimeMs: 30,
      warningCounters: {}
    },
    refState: 'parser-local'
  };
}

/** Builds one parent source dependency row for chunk-window tests. */
function createParentSourceDependencyRow(
  startExternalSpanId: string,
  endExternalSpanId: string
): TraceChunkSourceDependencyRow {
  return {
    dependencyKind: 'parent',
    startExternalSpanId,
    endExternalSpanId,
    waitMode: 'start-to-start'
  };
}

function createRow(
  externalSpanId: string,
  options: Partial<TestTraceChunkRow> = {}
): TestTraceChunkRow {
  const rowIndex =
    options.rowIndex ??
    (externalSpanId === 'root' || externalSpanId === 'visible-ancestor'
      ? 0
      : externalSpanId === 'hidden-parent'
        ? 1
        : externalSpanId === 'hidden-target'
          ? 2
          : 3);
  return {
    rowIndex,
    externalSpanId,
    parentExternalSpanId: options.parentExternalSpanId ?? null,
    name: options.name,
    source: options.source ?? null,
    overlapRanges: options.overlapRanges ?? [{startTimeMs: 10, endTimeMs: 20}]
  };
}

/** Replaces one loaded test chunk span table with an instrumented test table. */
function replaceTraceChunkSpanTable(payload: TraceChunk, spanTable: ArrowTraceSpanTable): void {
  (payload as {spanTable: ArrowTraceSpanTable}).spanTable = spanTable;
}

/** Throws when a nonmatching search resolves columns reserved for rich row materialization. */
function guardTraceChunkRichSearchColumns(spanTable: ArrowTraceSpanTable): ArrowTraceSpanTable {
  const richColumnNames = new Set([
    'thread_ref',
    'span_id',
    'external_span_id',
    'primary_timing_key',
    'status_code',
    'start_time_ms',
    'end_time_ms',
    'duration_ms'
  ]);
  return new Proxy(spanTable, {
    get(target, property) {
      if (property !== 'getChild') {
        return Reflect.get(target, property, target);
      }
      return (columnName: string) => {
        if (richColumnNames.has(columnName)) {
          throw new Error(`Search resolved rich chunk column before matching: ${columnName}`);
        }
        return (
          target as unknown as {
            getChild(name: string): unknown;
          }
        ).getChild(columnName);
      };
    }
  });
}

/** Throws when a matched search record falls back to row-only chunk columns. */
function guardTraceChunkSearchRecordRowOnlyColumns(
  spanTable: ArrowTraceSpanTable
): ArrowTraceSpanTable {
  const rowOnlyColumnNames = new Set(['thread_ref', 'external_span_id', 'primary_timing_key']);
  return new Proxy(spanTable, {
    get(target, property) {
      if (property !== 'getChild') {
        return Reflect.get(target, property, target);
      }
      return (columnName: string) => {
        if (rowOnlyColumnNames.has(columnName)) {
          throw new Error(`Search materialized row-only chunk column: ${columnName}`);
        }
        return (
          target as unknown as {
            getChild(name: string): unknown;
          }
        ).getChild(columnName);
      };
    }
  });
}

/** Throws if active-window graph materialization reads full serialized timing payloads. */
function guardTraceChunkWindowTimingJsonColumn(
  spanTable: ArrowTraceSpanTable
): ArrowTraceSpanTable {
  return new Proxy(spanTable, {
    get(target, property) {
      if (property !== 'getChild') {
        return Reflect.get(target, property, target);
      }
      return (columnName: string) => {
        if (columnName === 'timingsJson') {
          throw new Error('Window materialization deserialized full timing JSON.');
        }
        return (
          target as unknown as {
            getChild(name: string): unknown;
          }
        ).getChild(columnName);
      };
    }
  });
}

/** Records Arrow cell reads so tests can assert the first pre-match search field. */
function recordTraceChunkSpanColumnReads(
  spanTable: ArrowTraceSpanTable,
  columnReads: string[]
): ArrowTraceSpanTable {
  return new Proxy(spanTable, {
    get(target, property) {
      if (property !== 'getChild') {
        return Reflect.get(target, property, target);
      }
      return (columnName: string) => {
        const column = (
          target as unknown as {
            getChild(name: string): {get(index: number): unknown} | null | undefined;
          }
        ).getChild(columnName);
        if (!column) {
          return column;
        }
        return new Proxy(column, {
          get(columnTarget, columnProperty) {
            if (columnProperty !== 'get') {
              const columnValue = Reflect.get(columnTarget, columnProperty, columnTarget);
              if (columnProperty === 'data') {
                columnReads.push(`${columnName}.data`);
              }
              return columnValue;
            }
            return (rowIndex: number) => {
              columnReads.push(`${columnName}.get`);
              return columnTarget.get(rowIndex);
            };
          }
        });
      };
    }
  });
}

function readSpanName(
  traceGraph: Parameters<typeof getTraceGraphSpanDetailSource>[0],
  spanRef: SpanRef | null
): string | null {
  return spanRef == null
    ? null
    : (getTraceGraphSpanDetailSource(traceGraph, spanRef)?.name ?? null);
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

function encodeTestSpanRef(rowIndex: number): SpanRef {
  return encodeSpanRef(0, rowIndex);
}
