import {describe, expect, it} from 'vitest';

import {
  buildArrowTraceLocalDependencyTable,
  buildArrowTraceSpanTableFromColumns
} from './ingestion/arrow-trace';
import {createChronologicalTraceChunkSpanBudgetPolicy, TraceChunkStore} from './trace-chunk-store';
import {
  buildHiddenTraceChunkSpanInspectorGraph,
  buildJSONTraceChunkDataFromTraceChunkData,
  buildTraceChunkDataFromJSONTraceChunkData,
  buildTraceChunkRowWindowTable,
  buildTraceChunkSourceDependencyTable,
  buildTraceChunkWindowGraphData,
  isJSONTraceChunkData,
  resolveHiddenTraceChunkSpanNavigation,
  searchHiddenTraceChunkSpans,
  searchTraceChunkStoreSpans
} from './trace-chunk-window';
import {getTraceGraphSpanDisplaySource} from './trace-graph-accessors';
import {TRACE_SPAN_FILTER_MASK_SOURCE} from './trace-graph/trace-graph-types';
import {
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef
} from './trace-graph/trace-id-encoder';

import type {TraceChunkDescriptor, TraceChunkWindowGraphMaterializer} from './trace-chunk-store';
import type {
  TraceChunk,
  TraceChunkData,
  TraceChunkSourceDependencyRow,
  TraceChunkSpanOverlapRange
} from './trace-chunk-window';
import type {
  SpanRef,
  TraceProcessId,
  TraceSpanId,
  TraceSpanTiming,
  TraceThreadId
} from './trace-graph/trace-types';

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
  /** Optional source label stored in the Arrow span table. */
  readonly source: string | null;
  /** Window-overlap ranges stored in chunk metadata. */
  readonly overlapRanges: readonly TraceChunkSpanOverlapRange[];
};

describe('Trace chunks', () => {
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
    const snapshot = store.getTraceGraphForWindow('active', null);
    if (!snapshot) {
      throw new Error('Expected active window graph');
    }

    const storeResults = store.searchSpans({
      traceGraph: snapshot.traceGraph,
      matchesSearchText: searchText => searchText.includes('target_file.py'),
      limit: 50
    });
    const results = searchHiddenTraceChunkSpans({
      traceChunkStore: store,
      traceGraph: snapshot.traceGraph,
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
    expect(snapshot.traceGraph.getTraceSpanCardModel(storeResults[0]!.spanRef)?.span.name).toBe(
      'hidden-target'
    );
    expect(
      snapshot.traceGraph.getTraceSpanFilterNavigation(storeResults[0]!.spanRef)
    ).toMatchObject({
      reasonLabel: 'Hidden by: time window'
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      externalSpanId: 'hidden-target',
      source: 'target_file.py:30',
      reasonLabel: 'Hidden by: time window'
    });
    expect(
      snapshot.traceGraph.spanFilterReason(encodeTestSpanRef(results[0]!.rowIndex))
    ).toMatchObject({
      isFiltered: true,
      state: 'outside-window'
    });
  });

  it('does not search unloaded descriptors or trigger chunk loads', async () => {
    const payload = createTraceChunkData([
      createRow('loaded-target', {
        source: 'loaded.py:10',
        overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
      })
    ]);
    const {store, loadChunkCalls} = await createLoadedStore(payload);
    const snapshot = store.getTraceGraphForWindow('active', null);
    if (!snapshot) {
      throw new Error('Expected active window graph');
    }
    await store.refreshDescriptors([createDescriptor(), createDescriptor('unloaded-chunk')]);

    const methodResults = store.searchSpans({
      traceGraph: snapshot.traceGraph,
      matchesSearchText: searchText => searchText.includes('target'),
      limit: 50
    });
    const helperResults = searchTraceChunkStoreSpans({
      traceChunkStore: store,
      traceGraph: snapshot.traceGraph,
      matchesSearchText: searchText => searchText.includes('target'),
      limit: 50
    });

    expect(loadChunkCalls).toBe(1);
    expect(methodResults.map(record => record.blockName)).toEqual(['loaded-target']);
    expect(helperResults.map(record => record.blockName)).toEqual(['loaded-target']);
  });

  it('exposes source filters lazily through active graphs', async () => {
    const payload = createTraceChunkData([
      createRow('visible-target', {
        rowIndex: 0,
        source: 'projects/runtime/runtime-crates/runtime/invoke.rs:10',
        overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
      }),
      createRow('outside-target', {
        rowIndex: 1,
        source: 'projects/runtime/runtime-crates/runtime/invoke.rs:30',
        overlapRanges: [{startTimeMs: 1, endTimeMs: 2}]
      })
    ]);
    const {store, loadChunkCalls} = await createLoadedStore(payload);
    const loadedChunkBeforeFilter = store.getLoadedChunk('test-chunk');

    expect(store.setSourceSpanFilters(['projects/runtime/runtime-crates'])).toBe(true);
    expect(store.getLoadedChunk('test-chunk')).toBe(loadedChunkBeforeFilter);
    const snapshot = store.getTraceGraphForWindow('active', null);
    if (!snapshot) {
      throw new Error('Expected active window graph');
    }

    const visibleSpanRef = encodeTestSpanRef(0);
    const outsideSpanRef = encodeTestSpanRef(1);
    const hiddenResults = searchHiddenTraceChunkSpans({
      traceChunkStore: store,
      traceGraph: snapshot.traceGraph,
      matchesQuery: searchText => searchText.includes('outside-target'),
      limit: 50
    });

    expect(snapshot.traceGraphData.chunks[0]?.spanTable).toBe(payload.spanTable);
    expect(snapshot.traceGraphData.chunks[0]?.spanSidecarRows).toBe(payload.spanSidecarRows);
    expect(snapshot.traceGraphData.spanRefs).toEqual([visibleSpanRef]);
    expect(
      Array.from(
        snapshot.traceGraphData.processSpanTableMap['test-process' as TraceProcessId]
          ?.getChild('span_ref')
          ?.toArray() ?? []
      )
    ).toEqual([visibleSpanRef]);
    expect(store.getFilterReason(visibleSpanRef).filterMask).toBe(TRACE_SPAN_FILTER_MASK_SOURCE);
    expect(loadChunkCalls).toBe(1);
    expect(snapshot.traceGraph.spanFilterReason(visibleSpanRef)).toMatchObject({
      filterMask: TRACE_SPAN_FILTER_MASK_SOURCE,
      isFiltered: true,
      state: 'filtered'
    });
    expect(
      snapshot.traceGraph
        .getVisibleProcessDisplaySources(encodeProcessRef(0))
        .map(span => span.name)
    ).toEqual([]);
    expect(snapshot.traceGraph.spanFilterReason(outsideSpanRef)).toMatchObject({
      filterMask: TRACE_SPAN_FILTER_MASK_SOURCE,
      isFiltered: true,
      state: 'outside-window'
    });
    expect(hiddenResults[0]?.reasonLabel).toBe('Hidden by: time window, filename filter');
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
    const snapshot = store.getTraceGraphForWindow('active', null);
    if (!snapshot) {
      throw new Error('Expected active window graph');
    }
    const [result] = searchHiddenTraceChunkSpans({
      traceChunkStore: store,
      traceGraph: snapshot.traceGraph,
      matchesQuery: searchText => searchText.includes('hidden-target'),
      limit: 50
    });
    if (!result) {
      throw new Error('Expected hidden chunk result');
    }

    const navigation = resolveHiddenTraceChunkSpanNavigation({
      result,
      traceChunkStore: store,
      traceGraph: snapshot.traceGraph
    });
    const genericNavigation = snapshot.traceGraph.getTraceSpanFilterNavigation(
      encodeTestSpanRef(result.rowIndex)
    );
    const inspectorModel = buildHiddenTraceChunkSpanInspectorGraph(result);

    expect(readSpanName(snapshot.traceGraph, navigation.visibleAncestorSpanRef)).toBe(
      'visible-ancestor'
    );
    expect(readSpanName(snapshot.traceGraph, navigation.visibleDescendantSpanRef)).toBe(
      'visible-descendant'
    );
    expect(
      readSpanName(snapshot.traceGraph, genericNavigation?.visibleAncestorSpanRef ?? null)
    ).toBe('visible-ancestor');
    expect(
      readSpanName(snapshot.traceGraph, genericNavigation?.visibleDescendantSpanRef ?? null)
    ).toBe('visible-descendant');
    expect(
      getTraceGraphSpanDisplaySource(inspectorModel.traceGraph, inspectorModel.spanRef)?.name
    ).toBe('hidden-target');
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
    const snapshot = store.getTraceGraphForWindow('active', null);
    if (!snapshot) {
      throw new Error('Expected active window graph');
    }
    const childSpanRef = snapshot.traceGraph.getSpanRefByExternalBlockId('child' as TraceSpanId);
    if (childSpanRef == null) {
      throw new Error('Expected child span ref');
    }

    const selection = snapshot.traceGraph.getTraceSpanDependencySelection(childSpanRef, {
      keywords: new Set(['PARENT'])
    });
    const parentChainEntries = snapshot.traceGraph.getTraceSpanParentChainEntries(childSpanRef);

    expect(selection.visibleLocalDependencyRefs).toHaveLength(2);
    expect(
      selection.parentSpanRefs.map(spanRef => readSpanName(snapshot.traceGraph, spanRef))
    ).toEqual(['parent-a', 'parent-b']);
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

  it('materializes thread metadata from the current store snapshot instead of stale chunk snapshots', async () => {
    const descriptors = [
      createDescriptor('early-selected-chunk', {sortStartTimeMs: 0}),
      createDescriptor('late-selected-chunk', {sortStartTimeMs: 1})
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor, null>({
      identityKey: 'chunk-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>(),
      windowGraphMaterializer: createTestMaterializer()
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
    await store.registerTraceWindows({
      windows: [{id: 'active', minTimeMs: 10, maxTimeMs: 20}],
      loadChunk: async () => {
        throw new Error('Chunks should already be loaded.');
      }
    });

    const snapshot = store.getTraceGraphForWindow('active', null);
    expect(
      snapshot?.traceGraph.getThreadSourcesByProcessRef(encodeProcessRef(0)).map(thread => ({
        threadId: thread.threadId,
        name: thread.name
      }))
    ).toEqual([
      {threadId: 'thread-one', name: 'thread-one'},
      {threadId: 'thread-two', name: 'thread-two'}
    ]);
    expect(
      snapshot?.traceGraph
        .getVisibleProcessDisplaySources(encodeProcessRef(0))
        .map(span => span.name)
    ).toEqual(['early-row', 'late-row']);
  });

  it('materializes same-process rows from multiple chunks without overwriting earlier chunks', async () => {
    const descriptors = [
      createDescriptor('same-process-a', {sortStartTimeMs: 0}),
      createDescriptor('same-process-b', {sortStartTimeMs: 1})
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor, null>({
      identityKey: 'chunk-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>(),
      windowGraphMaterializer: createTestMaterializer()
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
    await store.registerTraceWindows({
      windows: [{id: 'active', minTimeMs: 10, maxTimeMs: 20}],
      loadChunk: async () => {
        throw new Error('Chunks should already be loaded.');
      }
    });

    const snapshot = store.getTraceGraphForWindow('active', null);
    if (!snapshot) {
      throw new Error('Expected active window graph');
    }
    const searchResults = store.searchSpans({
      traceGraph: snapshot.traceGraph,
      matchesSearchText: searchText => searchText.includes('same-process'),
      limit: 10
    });

    expect(snapshot.traceGraphData.spanRefs).toEqual([encodeSpanRef(0, 0), encodeSpanRef(1, 0)]);
    expect(
      snapshot.traceGraph
        .getVisibleProcessDisplaySources(encodeProcessRef(0))
        .map(span => span.name)
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
    const store = new TraceChunkStore<TraceChunk, TestDescriptor, null>({
      identityKey: 'chunk-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>(),
      windowGraphMaterializer: createTestMaterializer()
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
    await store.registerTraceWindows({
      windows: [{id: 'active', minTimeMs: 10, maxTimeMs: 20}],
      loadChunk: async () => {
        throw new Error('Chunks should already be loaded.');
      }
    });

    const snapshot = store.getTraceGraphForWindow('active', null);
    if (!snapshot) {
      throw new Error('Expected active window graph');
    }

    expect(snapshot.traceGraphData.chunks.map(chunk => chunk.chunkIndex)).toEqual([0, 1]);
    expect(snapshot.traceGraphData.spanRefs).toEqual([encodeSpanRef(0, 0), encodeSpanRef(1, 0)]);
    expect(
      snapshot.traceGraph
        .getVisibleProcessDisplaySources(encodeProcessRef(0))
        .map(span => span.name)
    ).toEqual(['registered-late', 'registered-early']);
  });

  it('materializes selected rows for non-zero store process refs', async () => {
    const descriptors = [
      createDescriptor('process-zero-chunk', {sortStartTimeMs: 0}),
      createDescriptor('process-one-chunk', {sortStartTimeMs: 1})
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor, null>({
      identityKey: 'chunk-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>(),
      windowGraphMaterializer: createTestMaterializer()
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
    await store.registerTraceWindows({
      windows: [{id: 'active', minTimeMs: 10, maxTimeMs: 20}],
      loadChunk: async () => {
        throw new Error('Chunks should already be loaded.');
      }
    });

    const snapshot = store.getTraceGraphForWindow('active', null);
    if (!snapshot) {
      throw new Error('Expected active window graph');
    }

    expect(snapshot.traceGraphData.processIdsByIndex).toEqual(['process-zero', 'process-one']);
    expect(snapshot.traceGraphData.processes.map(process => process.processId)).toEqual([
      'process-zero',
      'process-one'
    ]);
    expect(snapshot.traceGraphData.spanRefs).toEqual([encodeSpanRef(1, 0)]);
    expect(snapshot.traceGraph.getVisibleProcessRefs()).toEqual([encodeProcessRef(1)]);
    expect(
      snapshot.traceGraph
        .getVisibleProcessDisplaySources(encodeProcessRef(1))
        .map(span => span.name)
    ).toEqual(['visible-process-one']);
  });

  it('materializes JSONTraceChunkData through TraceChunkData into a TraceGraph', async () => {
    const jsonChunkData = buildJSONTraceChunkDataFromTraceChunkData(
      createTraceChunkData([
        createRow('json-visible', {
          rowIndex: 0,
          source: 'json-source.py:10',
          overlapRanges: [{startTimeMs: 10, endTimeMs: 20}]
        })
      ])
    );

    expect(isJSONTraceChunkData(jsonChunkData)).toBe(true);

    const payload = buildTraceChunkDataFromJSONTraceChunkData(jsonChunkData);
    const {store} = await createLoadedStore(payload);
    const snapshot = store.getTraceGraphForWindow('active', null);
    if (!snapshot) {
      throw new Error('Expected active window graph');
    }

    expect(snapshot.traceGraphData.stats.spanCount).toBe(1);
    expect(
      snapshot.traceGraph
        .getVisibleProcessDisplaySources(encodeProcessRef(0))
        .map(span => span.name)
    ).toEqual(['json-visible']);
    expect(getTraceGraphSpanDisplaySource(snapshot.traceGraph, encodeTestSpanRef(0))).toMatchObject(
      {
        name: 'json-visible',
        source: 'json-source.py:10'
      }
    );
  });
});

async function createLoadedStore(payload: TraceChunkData): Promise<{
  readonly store: TraceChunkStore<TraceChunk, TestDescriptor, null>;
  readonly loadChunkCalls: number;
}> {
  const descriptor = createDescriptor();
  const store = new TraceChunkStore<TraceChunk, TestDescriptor, null>({
    identityKey: 'chunk-test',
    descriptors: [descriptor],
    selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>(),
    windowGraphMaterializer: createTestMaterializer()
  });
  let loadChunkCalls = 0;
  await store.registerTraceWindows({
    windows: [{id: 'active', minTimeMs: 10, maxTimeMs: 20}],
    loadChunk: async () => {
      loadChunkCalls += 1;
      return payload;
    }
  });
  return {store, loadChunkCalls};
}

function createTestMaterializer(): TraceChunkWindowGraphMaterializer<
  TraceChunk,
  TestDescriptor,
  null
> {
  return {
    rebuild: ({ownerRefRegistry, readyChunks, window}) => ({
      state: null,
      traceGraphData: buildTraceChunkWindowGraphData({
        name: 'chunk-test',
        ownerRefRegistry,
        window,
        readyChunks
      })
    })
  };
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
        localDependencies: [],
        remoteDependencies: []
      }
    ],
    spanTable: buildArrowTraceSpanTableFromColumns({
      process_ref: rows.map(() => encodeProcessRef(0)),
      thread_ref: rows.map(() => encodeProcessThreadRef(0, 0)),
      span_id: rows.map(row => row.externalSpanId as TraceSpanId),
      external_span_id: rows.map(row => row.externalSpanId),
      thread_id: rows.map(() => threadId),
      name: rows.map(row => row.externalSpanId),
      source: rows.map(row => row.source),
      primary_timing_key: rows.map(() => 'measured'),
      status: rows.map(() => 'finished'),
      start_time_ms: rows.map(row => row.rowIndex),
      end_time_ms: rows.map(row => row.rowIndex + 1),
      duration_ms: rows.map(() => 1)
    }),
    localDependencyTable: buildArrowTraceLocalDependencyTable([]),
    spanSidecarRows: rows.map(row => ({
      timings: createTimings(row.rowIndex),
      userData: {},
      keywords: [],
      localDependencyIds: [],
      incomingLocalDependencyRowIndexes: [],
      outgoingLocalDependencyRowIndexes: [],
      crossProcessEndpointId: null,
      crossProcessDependencyEndpoints: []
    })),
    sourceDependencyTable: buildTraceChunkSourceDependencyTable(
      options.sourceDependencyRows ??
        rows.flatMap(row =>
          row.parentExternalSpanId
            ? [createParentSourceDependencyRow(row.parentExternalSpanId, row.externalSpanId)]
            : []
        )
    ),
    rowWindowTable: buildTraceChunkRowWindowTable(rows.map(row => row.overlapRanges)),
    diagnostics: {
      rowCount: rows.length,
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
    source: options.source ?? null,
    overlapRanges: options.overlapRanges ?? [{startTimeMs: 10, endTimeMs: 20}]
  };
}

function createTimings(rowIndex: number): Record<string, TraceSpanTiming> {
  return {
    measured: {
      status: 'finished',
      startTimeMs: rowIndex,
      endTimeMs: rowIndex + 1,
      durationMs: 1,
      durationMsAsString: '1ms'
    }
  };
}

function readSpanName(
  traceGraph: Parameters<typeof getTraceGraphSpanDisplaySource>[0],
  spanRef: SpanRef | null
): string | null {
  return spanRef == null
    ? null
    : (getTraceGraphSpanDisplaySource(traceGraph, spanRef)?.name ?? null);
}

function encodeTestSpanRef(rowIndex: number): SpanRef {
  return encodeSpanRef(0, rowIndex);
}
