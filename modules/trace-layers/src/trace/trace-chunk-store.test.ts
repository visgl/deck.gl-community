import {describe, expect, it, vi} from 'vitest';

import {
  buildArrowTraceEventTableFromRows,
  buildArrowTraceSameProcessDependencyTable,
  buildArrowTraceSameProcessDependencyTableFromColumns,
  buildArrowTraceSpanSidecarTableFromColumns,
  buildArrowTraceSpanTableFromColumns
} from './ingestion/arrow-trace';
import {
  appendTraceDatasetFromReadyTraceChunks,
  buildTraceDatasetFromReadyTraceChunks,
  replaceTraceDatasetEvents
} from './trace-chunk-graph-assembler';
import {
  createChronologicalTraceChunkSpanBudgetPolicy,
  createStaticTraceChunkStore,
  TRACE_EXTERNAL_SPAN_ID_URL_CODEC,
  TraceChunkStore,
  TraceChunkStoreLoadSkippedError
} from './trace-chunk-store';
import {
  buildTraceChunkRowWindowTable,
  buildTraceChunkSourceDependencyTable
} from './trace-chunk-window';
import {forEachTraceDatasetActiveSpanRow, getTraceDatasetSpanRefProcessId} from './trace-dataset';
import {TraceGraph} from './trace-graph/trace-graph';
import {
  encodeChunkRef,
  encodeLocalSpanRef,
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSameProcessDependencyRef,
  encodeSpanRef
} from './trace-graph/trace-id-encoder';
import {buildTraceLayoutProcesses} from './trace-layout/trace-geometry-layout-helpers';
import {buildTraceViewSnapshot} from './trace-view-snapshot';

import type {ArrowTraceChunk, ArrowTraceProcessMetadata} from './ingestion/arrow-trace';
import type {TraceChunk} from './trace-chunk';
import type {TraceChunkData} from './trace-chunk-data';
import type {
  TraceChunkDescriptor,
  TraceChunkReadyMaterializerParams,
  TraceSpanUrlCodec,
  TraceSpanUrlSource
} from './trace-chunk-store';
import type {TraceDataset} from './trace-dataset';
import type {TraceOwnerRefRegistry} from './trace-graph/trace-owner-ref-registry';
import type {
  SpanRef,
  TraceCounterId,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceInstantId,
  TraceProcessId,
  TraceSpanId,
  TraceThreadId
} from './trace-graph/trace-types';

type StoredPayload = {
  /** Stable test marker kept by the generic store. */
  value: string;
};

type TestDescriptor = TraceChunkDescriptor & {
  /** Stable test marker preserved as caller-owned descriptor metadata. */
  label: string;
};

type Deferred<T> = {
  /** Promise consumed by the store call under test. */
  promise: Promise<T>;
  /** Resolve the deferred promise. */
  resolve: (value: T) => void;
  /** Reject the deferred promise. */
  reject: (error: Error) => void;
};

describe('TraceChunkStore', () => {
  it('does not expose retired chunk-local or result-specific materializers', () => {
    expect(TraceChunkStore.prototype).not.toHaveProperty('getLoadedChunkBySpanRef');
    expect(TraceChunkStore.prototype).not.toHaveProperty('getLoadedTraceChunkBySpanRef');
    expect(TraceChunkStore.prototype).not.toHaveProperty('getLoadedChunkSpanRenderSource');
    expect(TraceChunkStore.prototype).not.toHaveProperty('materializeTraceDataset');
  });

  it('materializes arbitrary ready-chunk results through one generic seam', async () => {
    const descriptor = createDescriptor('ready', 'head', 0, 10, 0, 10, 5);
    const store = createStore([descriptor]);
    const selection = store.select({
      window: {startTimeMs: 0, endTimeMs: 10},
      spanBudget: null
    });
    const materializer = vi.fn(
      ({readyChunks}: TraceChunkReadyMaterializerParams<StoredPayload, TestDescriptor>) =>
        readyChunks.map(chunk => chunk.payload.value).join(',')
    );

    expect(store.withReadyChunks(selection, materializer)).toBeNull();
    expect(materializer).not.toHaveBeenCalled();

    await loadTestWindow(store, {
      descriptors: [descriptor],
      loadChunk: async () => ({value: 'ready'})
    });
    expect(store.withReadyChunks(selection, materializer)).toBe('ready');

    const emptySelection = store.select({
      window: {startTimeMs: 20, endTimeMs: 30},
      spanBudget: null
    });
    expect(store.withReadyChunks(emptySelection, () => 'empty')).toBe('empty');
  });

  it('reports cheap TraceChunkStore retained-state diagnostics', async () => {
    const descriptors = [
      createDescriptor('chunk-a', 'head', 0, 10, 0, 10, 5),
      createDescriptor('chunk-b', 'logical', 11, 20, 11, 20, 5)
    ];
    const store = createStore(descriptors);
    const deferred = createDeferred<StoredPayload>();
    const ensurePromise = loadTestWindow(store, {
      descriptors: [descriptors[0]!],
      loadChunk: async () => deferred.promise
    });

    expect(store.getDiagnostics()).toMatchObject({
      descriptorCount: 2,
      readyChunkCount: 0,
      pendingChunkCount: 1,
      failedChunkCount: 0,
      traceWindowCount: 1
    });

    deferred.resolve({value: 'chunk-a'});
    await ensurePromise;
    await store.loadWindow({
      window: {id: 'chunk-b-window', minTimeMs: 10, maxTimeMs: 20},
      loadChunk: async descriptor => ({value: descriptor.label})
    });

    expect(store.getDiagnostics()).toEqual({
      descriptorCount: 2,
      readyChunkCount: 2,
      pendingChunkCount: 0,
      failedChunkCount: 0,
      traceWindowCount: 1
    });
  });

  it('reports per-chunk load states without exposing pending payloads', async () => {
    const descriptors = [
      createDescriptor('ready', 'head', 0, 9, 0, 9, 5),
      createDescriptor('pending', 'logical', 10, 19, 10, 19, 5),
      createDescriptor('failed', 'logical', 20, 29, 20, 29, 5),
      createDescriptor('untouched', 'logical', 30, 40, 30, 40, 5)
    ];
    const store = createStore(descriptors);
    await loadTestWindow(store, {
      descriptors: [descriptors[0]!],
      loadChunk: async () => ({value: 'ready'})
    });
    const pendingDeferred = createDeferred<StoredPayload>();
    const pendingEnsure = loadTestWindow(store, {
      descriptors: [descriptors[1]!],
      loadChunk: async () => pendingDeferred.promise
    });
    expect(store.getChunkLoadState('ready')).toBe('ready');
    expect(store.getChunkLoadState('pending')).toBe('pending');
    expect(store.getChunkLoadState('untouched')).toBe('not-loaded');

    pendingDeferred.resolve({value: 'pending'});
    await pendingEnsure;
    expect(store.getChunkLoadState('pending')).toBe('ready');

    const failedChunkError = new Error('failed chunk');
    const failedEnsure = loadTestWindow(store, {
      descriptors: [descriptors[2]!],
      loadChunk: async () => {
        throw failedChunkError;
      }
    });

    await expect(failedEnsure).rejects.toThrow('failed chunk');
    expect(store.getChunkLoadState('failed')).toBe('failed');
    expect(store.getChunkLoadError('failed')).toBe(failedChunkError);
    expect(store.getChunkLoadError('ready')).toBeNull();
    expect(store.getChunkLoadError('untouched')).toBeNull();
  });

  it('selects matching descriptors in deterministic chronological order', () => {
    const store = createStore([
      createDescriptor('late', 'head', 20, 30, 20, 30, 10),
      createDescriptor('inside-a', 'head', 10, 20, 10, 20, 10),
      createDescriptor('inside-b', 'logical', 10, 20, 10, 20, 10),
      createDescriptor('outside', 'logical', 40, 50, 40, 50, 10)
    ]);

    const selection = store.select({
      window: {startTimeMs: 5, endTimeMs: 25},
      spanBudget: null
    });

    expect(selection.matchingDescriptors.map(descriptor => descriptor.chunkKey)).toEqual([
      'inside-a',
      'inside-b',
      'late'
    ]);
    expect(selection.selectedDescriptors).toEqual(selection.matchingDescriptors);
    expect(selection.omittedDescriptors).toEqual([]);
    expect(selection.summary).toEqual({
      spanBudget: null,
      matchedSpanCount: 30,
      selectedSpanCount: 30,
      selectedChunkCount: 3,
      omittedChunkCount: 0,
      omittedSpanCount: 0,
      isSpanBudgetCapped: false
    });
  });

  it('trims latest chunks by advertised span budget while preserving one chunk per family', () => {
    const store = createStore([
      createDescriptor('head-1', 'head', 10, 20, 10, 20, 70),
      createDescriptor('logical-1', 'logical', 10, 20, 10, 20, 70),
      createDescriptor('head-2', 'head', 20, 30, 20, 30, 70),
      createDescriptor('logical-2', 'logical', 20, 30, 20, 30, 70)
    ]);

    const selection = store.select({
      window: {startTimeMs: 0, endTimeMs: 40},
      spanBudget: 140
    });

    expect(selection.selectedDescriptors.map(descriptor => descriptor.chunkKey)).toEqual([
      'head-1',
      'logical-1'
    ]);
    expect(selection.omittedDescriptors.map(descriptor => descriptor.chunkKey)).toEqual([
      'head-2',
      'logical-2'
    ]);
    expect(selection.summary).toEqual({
      spanBudget: 140,
      matchedSpanCount: 280,
      selectedSpanCount: 140,
      selectedChunkCount: 2,
      omittedChunkCount: 2,
      omittedSpanCount: 140,
      isSpanBudgetCapped: true
    });
  });

  it('refreshes descriptors without dropping already stored payloads', async () => {
    const store = createStore([createDescriptor('keep', 'head', 0, 10, 0, 10, 5)]);
    await loadTestWindow(store, {
      descriptors: store.getDescriptors(),
      loadChunk: async descriptor => ({value: descriptor.label})
    });
    const initialReadyChunk = store.getReadyChunks(store.getDescriptors())[0];

    store.replaceDescriptors([
      createDescriptor('keep', 'head', 0, 10, 0, 10, 5),
      createDescriptor('new', 'logical', 5, 15, 5, 15, 5)
    ]);
    const refreshedReadyChunk = store.getReadyChunks(store.getDescriptors())[0];

    expect(store.getLoadedChunk('keep')).toEqual({value: 'keep'});
    expect(refreshedReadyChunk?.chunkIndex).toBe(initialReadyChunk?.chunkIndex);
    expect(refreshedReadyChunk?.chunkRef).toBe(initialReadyChunk?.chunkRef);
    expect(
      store
        .select({window: {startTimeMs: 0, endTimeMs: 20}, spanBudget: null})
        .matchingDescriptors.map(descriptor => descriptor.chunkKey)
    ).toEqual(['keep', 'new']);
  });

  it('finalizes parser-local TraceChunkData while preserving non-ref table identity', () => {
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-data-add-test',
      descriptors: [],
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    const data = createTraceChunkData('chunk-data');

    const chunk = store.add(data);

    expect(chunk).toMatchObject({
      type: 'trace-chunk',
      chunkKey: 'chunk-data',
      refState: 'store-finalized',
      chunkIndex: 0,
      chunkRef: encodeChunkRef(0),
      diagnostics: data.diagnostics
    });
    expect(chunk.spanTable).toBe(data.spanTable);
    expect(chunk.resolvedSameProcessDependencyTable).toBe(data.resolvedSameProcessDependencyTable);
    expect(chunk.sourceDependencyTable).toBe(data.sourceDependencyTable);
    expect(chunk.rowWindowTable).toBe(data.rowWindowTable);
    expect(chunk.processRefs).toEqual([encodeProcessRef(0)]);
    expect(chunk.indexes.rowIndexByExternalSpanId.get('span:root')).toBe(0);
    expect(chunk.indexes.rowIndexByExternalSpanId.get('span:child')).toBe(1);
    expect(chunk.indexes.parentExternalSpanIdByRowIndex).toEqual([null, 'span:root']);
    expect(chunk.metadata).toEqual({rowCount: 2, hasWindowRows: true});
    expect(store.chunks[0]).toBe(chunk);
    expect(store.getSpanRefAvailability(encodeSpanRef(0, 1))).toBe('outside-window');
    expect(store.getSpanRefAvailability(encodeSpanRef(0, 2))).toBe('unknown');
  });

  it('resolves process-scoped chunk thread refs from thread ids when local refs are absent', () => {
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-data-thread-id-fallback-test',
      descriptors: [createDescriptor('chunk-data', 'head', 0, 10, 0, 10, 2)],
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    const data = createTraceChunkData('chunk-data');
    const threadId = data.processes[0]!.threads[0]!.threadId as TraceThreadId;
    const chunk = store.add({
      ...data,
      spanTable: buildArrowTraceSpanTableFromColumns({
        process_ref: [encodeProcessRef(0), encodeProcessRef(0)],
        thread_ref: [null, null],
        span_id: ['root' as TraceSpanId, 'child' as TraceSpanId],
        external_span_id: ['span:root', 'span:child'],
        thread_id: [threadId, threadId],
        name: ['root', 'child'],
        source: [null, null],
        primary_timing_key: ['primary', 'primary'],
        status: ['finished', 'finished'],
        start_time_ms: [0, 5],
        end_time_ms: [5, 10],
        duration_ms: [5, 5]
      })
    });

    expect(chunk.spanTable.getChild('thread_ref')?.get(0)).toBe(encodeProcessThreadRef(0, 0));
    expect(store.getSpanDetailSource(encodeSpanRef(0, 0))).toMatchObject({
      threadRef: encodeProcessThreadRef(0, 0)
    });
  });

  it('resolves store-backed span render data without same-process dependency ids', () => {
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-data-direct-render-test',
      descriptors: [createDescriptor('chunk-data', 'head', 0, 10, 0, 10, 2)],
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    store.add(createTraceChunkData('chunk-data'));

    const renderSource = store.getSpanDetailSource(encodeSpanRef(0, 1));

    expect(renderSource?.spanRef).toBe(encodeSpanRef(0, 1));
    expect(renderSource?.spanId).toBe('child');
    expect(renderSource?.name).toBe('child');
    expect(renderSource?.processName).toBe('trace chunk data process');
    expect(renderSource).not.toHaveProperty('sameProcessDependencyIds');
  });

  it('rewrites parser-local process and thread refs into store-owned refs across chunks', () => {
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-data-ref-finalization-test',
      descriptors: [],
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    const firstData = createTraceChunkData('chunk-a', {
      processId: 'process-a' as TraceProcessId,
      threadId: 'thread-a' as TraceThreadId
    });
    const secondData = createTraceChunkData('chunk-b', {
      processId: 'process-b' as TraceProcessId,
      threadId: 'thread-b' as TraceThreadId
    });
    const secondNameGet = vi.spyOn(secondData.spanTable.getChild('name')!, 'get');
    const secondStartTimeGet = vi.spyOn(secondData.spanTable.getChild('start_time_ms')!, 'get');
    const secondProcessRefData = secondData.spanTable.getChild('process_ref')?.data[0];
    const secondThreadRefData = secondData.spanTable.getChild('thread_ref')?.data[0];
    const secondProcessRefValues = secondProcessRefData?.values;
    const secondThreadRefValues = secondThreadRefData?.values;

    const firstChunk = store.add(firstData);
    const secondChunk = store.add(secondData);

    expect(firstChunk.spanTable).toBe(firstData.spanTable);
    expect(firstChunk.spanTable.getChild('process_ref')?.get(0)).toBe(encodeProcessRef(0));
    expect(firstChunk.spanTable.getChild('thread_ref')?.get(0)).toBe(encodeProcessThreadRef(0, 0));
    expect(secondChunk.spanTable).toBe(secondData.spanTable);
    expect(secondChunk.spanTable.getChild('process_ref')?.data[0]).toBe(secondProcessRefData);
    expect(secondChunk.spanTable.getChild('thread_ref')?.data[0]).toBe(secondThreadRefData);
    expect(secondChunk.spanTable.getChild('process_ref')?.data[0]?.values).toBe(
      secondProcessRefValues
    );
    expect(secondChunk.spanTable.getChild('thread_ref')?.data[0]?.values).toBe(
      secondThreadRefValues
    );
    expect(secondChunk.spanTable.getChild('process_ref')?.get(0)).toBe(encodeProcessRef(1));
    expect(secondChunk.spanTable.getChild('thread_ref')?.get(0)).toBe(encodeProcessThreadRef(1, 0));
    expect(secondChunk.processId).toBe('process-b');
    expect(secondChunk.processes.map(process => process.processId)).toEqual(['process-b']);
    expect(secondChunk.processes.map(process => process.rankNum)).toEqual([0]);
    expect(secondChunk.processRefs).toEqual([encodeProcessRef(1)]);
    expect(secondNameGet).not.toHaveBeenCalled();
    expect(secondStartTimeGet).not.toHaveBeenCalled();
  });

  it('keeps selected sparse chunk processes aligned with owner refs', () => {
    const descriptors = [
      createDescriptor('chunk-a', 'head', 0, 10, 0, 10, 2),
      createDescriptor('chunk-b', 'head', 10, 20, 10, 20, 2)
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-selected-process-owner-ref-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    store.add(
      createTraceChunkData('chunk-a', {
        processId: 'process-a' as TraceProcessId,
        threadId: 'thread-a' as TraceThreadId
      })
    );
    store.add(
      createTraceChunkData('chunk-b', {
        processId: 'process-b' as TraceProcessId,
        threadId: 'thread-b' as TraceThreadId
      })
    );
    const selection = store.select({
      window: {startTimeMs: 11, endTimeMs: 20},
      spanBudget: null
    });
    const traceDataset = store.withReadyChunks(selection, ({ownerRefRegistry, readyChunks}) =>
      buildTraceDatasetFromReadyTraceChunks({
        name: 'selected-sparse-chunk',
        ownerRefRegistry,
        readyChunks
      })
    );
    expect(traceDataset).not.toBeNull();
    if (!traceDataset) {
      throw new Error('Expected selected sparse chunk dataset.');
    }
    const traceGraph = new TraceGraph({traceDataset, traceStore: store});
    const emptyProcessChunk = {
      ...traceDataset.chunks[0]!,
      chunkIndex: 0,
      chunkRef: encodeChunkRef(0),
      chunkKey: 'empty-process-a',
      processRefs: [encodeProcessRef(0)],
      processId: 'process-a' as TraceProcessId,
      spanTable: traceDataset.chunks[0]!.spanTable.slice(0, 0)
    };
    const traceDatasetWithEmptyProcessChunk = {
      ...traceDataset,
      chunks: [emptyProcessChunk, ...traceDataset.chunks]
    } satisfies TraceDataset;
    const traceGraphWithEmptyProcessChunk = new TraceGraph({
      traceDataset: traceDatasetWithEmptyProcessChunk,
      traceStore: store
    });

    expect(traceDataset.processes.map(process => process.processId)).toEqual([
      'process-a',
      'process-b'
    ]);
    expect(traceDataset.spanRefs).toBeUndefined();
    const getVisibleProcessRefsSpy = vi.spyOn(traceGraph, 'getVisibleProcessRefs');
    expect(traceGraph.getVisibleProcessRefs()).toEqual([encodeProcessRef(1)]);
    expect(traceGraphWithEmptyProcessChunk.getVisibleProcessRefs()).toEqual([encodeProcessRef(1)]);
    getVisibleProcessRefsSpy.mockClear();
    expect(buildTraceLayoutProcesses(traceGraph).map(process => process.processId)).toEqual([
      'process-b'
    ]);
    expect(getVisibleProcessRefsSpy).toHaveBeenCalledTimes(1);
    expect(traceGraph.getStats()).toMatchObject({
      processCount: 1,
      threadCount: 1,
      laneCount: 1,
      spanCount: 2
    });
    getVisibleProcessRefsSpy.mockRestore();
  });

  it('assembles an immutable dataset without copying selected chunk tables', () => {
    const descriptors = [
      createDescriptor('chunk-a', 'head', 0, 10, 0, 10, 2),
      createDescriptor('chunk-b', 'head', 10, 20, 10, 20, 2)
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-dataset-sparse-chunk-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    store.add(
      createTraceChunkData('chunk-a', {
        processId: 'process-a' as TraceProcessId,
        threadId: 'thread-a' as TraceThreadId
      })
    );
    const selectedChunk = store.add(
      createTraceChunkData('chunk-b', {
        processId: 'process-b' as TraceProcessId,
        threadId: 'thread-b' as TraceThreadId,
        layoutTopY: [11, 12],
        layoutHeight: [1, 2]
      })
    );
    const selection = store.select({
      window: {startTimeMs: 11, endTimeMs: 20},
      spanBudget: null
    });
    const traceDataset = store.withReadyChunks(selection, ({ownerRefRegistry, readyChunks}) =>
      buildTraceDatasetFromReadyTraceChunks({
        name: 'dataset-sparse-chunk',
        ownerRefRegistry,
        readyChunks,
        timeExtents: {minTimeMs: 10, maxTimeMs: 20}
      })
    );
    if (!traceDataset) {
      throw new Error('Expected sparse dataset.');
    }
    const traceGraph = new TraceGraph({traceDataset, traceStore: store});
    const canonicalProcessSpanTableMap = traceDataset.processSpanTableMap;
    const canonicalProcessSpanTable = canonicalProcessSpanTableMap['process-b' as TraceProcessId];
    const filteredTraceGraph = new TraceGraph(
      {traceDataset, traceStore: store},
      buildTraceViewSnapshot(traceDataset, {spanFilters: ['root']})
    );
    expect(traceGraph.traceDataset).toBe(traceDataset);
    expect(traceGraph.processes).toBe(traceDataset.processes);
    expect(traceGraph.chunks[0]?.spanTable).toBe(traceDataset.chunks[0]?.spanTable);
    expect(traceGraph.processSpanTableMap).toBe(traceDataset.processSpanTableMap);
    expect(traceGraph.sameProcessDependencyTableMap).toBe(
      traceDataset.sameProcessDependencyTableMap
    );
    expect(traceGraph.crossProcessDependencyTable).toBe(traceDataset.crossProcessDependencyTable);
    expect(traceGraph.events).toBe(traceDataset.events);
    expect(traceGraph.spanSidecarTableMap).toBe(traceDataset.spanSidecarTableMap);
    expect(traceGraph.crossProcessEndpointsBySpanRef).toBe(
      traceDataset.crossProcessEndpointsBySpanRef
    );
    expect(traceGraph.processIdsByIndex).toBe(traceDataset.ownerRefSnapshot.processIdsByIndex);
    expect(traceGraph.stats).toBe(traceDataset.stats);
    expect(traceGraph.minTimeMs).toBe(traceDataset.timeExtents.minTimeMs);
    expect(traceGraph.maxTimeMs).toBe(traceDataset.timeExtents.maxTimeMs);
    expect(filteredTraceGraph.processSpanTableMap).toBe(canonicalProcessSpanTableMap);
    expect(filteredTraceGraph.traceViewSnapshot.filteredSpanCount).toBe(1);
    expect(traceDataset.processSpanTableMap).toBe(canonicalProcessSpanTableMap);
    expect(canonicalProcessSpanTable?.numRows).toBe(2);
    expect(
      canonicalProcessSpanTable?.schema.fields.some(field => field.name === 'filter_mask')
    ).toBe(false);
    expect(
      [0, 1].map(rowIndex => canonicalProcessSpanTable?.getChild('span_ref')?.get(rowIndex))
    ).toEqual([encodeSpanRef(1, 0), encodeSpanRef(1, 1)]);
    expect(traceDataset.spanRefSourcesByProcessIndex).toHaveLength(2);
    expect(Array.from(traceDataset.spanRefSourcesByProcessIndex[0]!)).toEqual([]);
    expect(Array.from(traceDataset.spanRefSourcesByProcessIndex[1]!)).toEqual([
      encodeSpanRef(1, 0),
      encodeSpanRef(1, 1)
    ]);
    expect(traceDataset.spanRefSourcesByProcessIndex[1]?.at(0)).toBe(encodeSpanRef(1, 0));
    const processBDependencyCount =
      traceDataset.sameProcessDependencyTableMap['process-b' as TraceProcessId]?.numRows ?? 0;
    expect(Array.from(traceDataset.sameProcessDependencyRefSourcesByProcessIndex[1]!)).toEqual(
      Array.from({length: processBDependencyCount}, (_, rowIndex) =>
        encodeSameProcessDependencyRef(encodeLocalSpanRef(1, rowIndex))
      )
    );
    expect(traceGraph.getProcessRefs()).toBe(traceDataset.ownerRefSnapshot.processRefs);
    expect(traceGraph.getThreadRefs()).toBe(traceDataset.ownerRefSnapshot.threadRefs);
    expect(traceDataset).toMatchObject({
      type: 'trace-dataset',
      revision: 0,
      timeExtents: {minTimeMs: 10, maxTimeMs: 20}
    });
    expect(traceDataset.chunks).toEqual([selectedChunk]);
    expect(traceDataset.chunks[0]).toBe(selectedChunk);
    expect(traceDataset).not.toHaveProperty('spanTableMap');
    expect(traceDataset).not.toHaveProperty('minTimeMs');
    expect(traceDataset).not.toHaveProperty('maxTimeMs');
    expect(traceDataset).not.toHaveProperty('processIdsByIndex');
    expect(traceDataset).not.toHaveProperty('threadMap');
    expect(traceDataset).not.toHaveProperty('eventMap');
    expect(traceDataset.events.numRows).toBe(0);
    expect(traceDataset).not.toHaveProperty('spanRefs');
    const processSpanTable = traceDataset.processSpanTableMap['process-b' as TraceProcessId];
    expect(processSpanTable?.getChild('span_ref')?.get(0)).toBe(encodeSpanRef(1, 0));
    expect(processSpanTable?.getChild('span_ref')?.get(1)).toBe(encodeSpanRef(1, 1));
    expect(getTraceDatasetSpanRefProcessId(traceDataset, encodeSpanRef(1, 0))).toBe('process-b');
    expect(getTraceDatasetSpanRefProcessId(traceDataset, encodeSpanRef(0, 0))).toBeNull();
    const activeSpanRefs: SpanRef[] = [];
    forEachTraceDatasetActiveSpanRow(traceDataset, (_chunk, _rowIndex, spanRef) => {
      activeSpanRefs.push(spanRef);
    });
    expect(activeSpanRefs).toEqual([encodeSpanRef(1, 0), encodeSpanRef(1, 1)]);
    expect(processSpanTable?.getChild('layout_top_y')?.data[0]).toBe(
      selectedChunk.spanTable.getChild('layout_top_y')?.data[0]
    );
    expect(processSpanTable?.getChild('layout_height')?.data[0]).toBe(
      selectedChunk.spanTable.getChild('layout_height')?.data[0]
    );
  });

  it('preserves chunk-owned cold process metadata and source rank numbers', () => {
    const baseChunkData = createTraceChunkData('metadata-chunk');
    const baseProcess = baseChunkData.processes[0]!;
    const baseThread = baseProcess.threads[0]!;
    const thread = {...baseThread, userData: {laneCount: 3}};
    const instant = {
      type: 'trace-instant',
      instantId: 'instant:metadata' as TraceInstantId,
      threadId: thread.threadId,
      name: 'metadata instant',
      atTimeMs: -5,
      scope: 't'
    } as const;
    const counter = {
      type: 'trace-counter',
      counterId: 'counter:metadata' as TraceCounterId,
      threadId: thread.threadId,
      name: 'metadata counter',
      atTimeMs: 25,
      totalValue: 7,
      series: {value: 7}
    } as const;
    const process = {
      ...baseProcess,
      rankNum: 7,
      processOrder: 9,
      threads: [thread],
      threadMap: {[thread.threadId]: thread},
      instants: [instant],
      instantMap: {[instant.instantId]: instant},
      threadInstantMap: {[thread.threadId]: [instant]},
      counters: [counter],
      counterMap: {[counter.counterId]: counter},
      threadCounterMap: {[thread.threadId]: [counter]}
    } satisfies ArrowTraceProcessMetadata;
    const chunkData = {
      ...baseChunkData,
      processes: [process]
    } satisfies TraceChunkData;
    const store = createStaticTraceChunkStore({
      identityKey: 'metadata-dataset-test',
      chunks: [chunkData]
    });
    const selection = store.select({window: {startTimeMs: 0, endTimeMs: 10}, spanBudget: null});
    const traceDataset = store.withReadyChunks(selection, ({ownerRefRegistry, readyChunks}) =>
      buildTraceDatasetFromReadyTraceChunks({
        name: 'metadata-dataset',
        ownerRefRegistry,
        readyChunks
      })
    );
    if (!traceDataset) {
      throw new Error('Expected metadata dataset.');
    }
    const traceGraph = new TraceGraph({traceDataset, traceStore: store});

    expect(traceDataset.processes[0]?.rankNum).toBe(7);
    expect(traceDataset.processes[0]?.processOrder).toBe(9);
    expect(traceDataset.processes[0]?.threads[0]?.userData).toEqual({laneCount: 3});
    expect(traceDataset.processes[0]?.instants).toBe(process.instants);
    expect(traceDataset.processes[0]?.counters).toBe(process.counters);
    expect(traceDataset.timeExtents).toEqual({minTimeMs: -5, maxTimeMs: 25});
    expect(traceGraph.processes).toBe(traceDataset.processes);
    expect(traceGraph.threadMap[thread.threadId]).toBe(traceDataset.processes[0]?.threads[0]);
    expect(traceGraph.threadInstantMap[thread.threadId]).toEqual([instant]);
    expect(traceGraph.threadInstantMap[thread.threadId]?.[0]).toBe(instant);
    expect(traceGraph.threadCounterMap[thread.threadId]).toEqual([counter]);
    expect(traceGraph.threadCounterMap[thread.threadId]?.[0]).toBe(counter);
    expect(traceGraph.events).toBe(traceDataset.events);
    expect(traceGraph.stats).toBe(traceDataset.stats);
    expect(traceGraph.processIdsByIndex).toBe(traceDataset.ownerRefSnapshot.processIdsByIndex);
    expect(traceGraph.minTimeMs).toBe(-5);
    expect(traceGraph.maxTimeMs).toBe(25);
    expect(traceGraph.instantMap[instant.instantId]).toBe(instant);
    expect(traceGraph.counterMap[counter.counterId]).toBe(counter);
  });

  it('rejects repeated process chunks instead of silently replacing process-local tables', () => {
    const store = createStaticTraceChunkStore({
      identityKey: 'duplicate-process-dataset-test',
      chunks: [createTraceChunkData('chunk-a'), createTraceChunkData('chunk-b')]
    });
    const selection = store.select({window: {startTimeMs: 0, endTimeMs: 10}, spanBudget: null});

    expect(() =>
      store.withReadyChunks(selection, ({ownerRefRegistry, readyChunks}) =>
        buildTraceDatasetFromReadyTraceChunks({
          name: 'duplicate-process-dataset',
          ownerRefRegistry,
          readyChunks
        })
      )
    ).toThrow('TraceDataset requires one process-scoped chunk per process');
  });

  it('appends datasets by sharing old chunks and dependency record batches', () => {
    const descriptors = [
      createDescriptor('chunk-a', 'head', 0, 10, 0, 10, 2),
      createDescriptor('chunk-b', 'head', 10, 20, 10, 20, 2)
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-dataset-append-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    store.add(
      createTraceChunkData('chunk-a', {
        processId: 'process-a' as TraceProcessId,
        threadId: 'thread-a' as TraceThreadId
      })
    );
    const firstDependency = createTestCrossProcessDependency('dependency-a');
    let previousTraceDataset!: TraceDataset;
    store.withReadyChunks(
      store.select({window: {startTimeMs: 0, endTimeMs: 10}, spanBudget: null}),
      ({ownerRefRegistry, readyChunks}) => {
        previousTraceDataset = buildTraceDatasetFromReadyTraceChunks({
          name: 'dataset-first',
          ownerRefRegistry,
          readyChunks,
          crossProcessDependencies: [firstDependency],
          timeExtents: {minTimeMs: 0, maxTimeMs: 10}
        });
        return previousTraceDataset;
      }
    );
    const previousChunk = previousTraceDataset.chunks[0];
    const previousDependencyBatch = previousTraceDataset.crossProcessDependencyTable.batches[0];

    store.add(
      createTraceChunkData('chunk-b', {
        processId: 'process-b' as TraceProcessId,
        threadId: 'thread-b' as TraceThreadId
      })
    );
    const secondDependency = createTestCrossProcessDependency('dependency-b');
    let appendedTraceDataset!: TraceDataset;
    let ownerRefRegistryForAppend!: TraceOwnerRefRegistry;
    store.withReadyChunks(
      store.select({window: {startTimeMs: 0, endTimeMs: 20}, spanBudget: null}),
      ({ownerRefRegistry, readyChunks}) => {
        ownerRefRegistryForAppend = ownerRefRegistry;
        appendedTraceDataset = appendTraceDatasetFromReadyTraceChunks({
          name: 'dataset-appended',
          ownerRefRegistry,
          previousTraceDataset,
          addedReadyChunks: readyChunks.slice(1),
          crossProcessDependencies: [firstDependency, secondDependency],
          addedCrossProcessDependencies: [secondDependency],
          timeExtents: {minTimeMs: 0, maxTimeMs: 20}
        });
        return appendedTraceDataset;
      }
    );

    expect(appendedTraceDataset.revision).toBe(1);
    expect(appendedTraceDataset.chunks[0]).toBe(previousChunk);
    expect(appendedTraceDataset.crossProcessDependencyTable.batches[0]).toBe(
      previousDependencyBatch
    );
    expect(appendedTraceDataset.crossProcessDependencyTable.numRows).toBe(2);
    expect(appendedTraceDataset.timeExtents).toEqual({minTimeMs: 0, maxTimeMs: 20});
    expect(appendedTraceDataset.stats).toMatchObject({
      spanCount: 4,
      crossProcessDependencyCount: 2,
      dependencyCount: 2
    });
    expect(Array.from(appendedTraceDataset.spanRefSourcesByProcessIndex[0]!)).toEqual([
      encodeSpanRef(0, 0),
      encodeSpanRef(0, 1)
    ]);
    expect(Array.from(appendedTraceDataset.spanRefSourcesByProcessIndex[1]!)).toEqual([
      encodeSpanRef(1, 0),
      encodeSpanRef(1, 1)
    ]);
    for (const [
      processIndex,
      source
    ] of appendedTraceDataset.sameProcessDependencyRefSourcesByProcessIndex.entries()) {
      const processId = appendedTraceDataset.ownerRefSnapshot.processIdsByIndex[processIndex];
      const rowCount = processId
        ? (appendedTraceDataset.sameProcessDependencyTableMap[processId]?.numRows ?? 0)
        : 0;
      expect(Array.from(source)).toEqual(
        Array.from({length: rowCount}, (_, rowIndex) =>
          encodeSameProcessDependencyRef(encodeLocalSpanRef(processIndex, rowIndex))
        )
      );
    }
    const unchangedTraceDataset = appendTraceDatasetFromReadyTraceChunks({
      name: 'dataset-appended',
      ownerRefRegistry: ownerRefRegistryForAppend,
      previousTraceDataset: appendedTraceDataset,
      addedReadyChunks: [],
      crossProcessDependencies: [firstDependency, secondDependency],
      addedCrossProcessDependencies: []
    });
    expect(unchangedTraceDataset).toBe(appendedTraceDataset);
  });

  it('replaces dataset events while preserving canonical row-heavy field identity', () => {
    const store = createStaticTraceChunkStore({
      identityKey: 'trace-dataset-event-replacement-test',
      chunks: [createTraceChunkData('event-chunk')]
    });
    const selection = store.select({window: {startTimeMs: 0, endTimeMs: 10}, spanBudget: null});
    const traceDataset = store.withReadyChunks(selection, ({ownerRefRegistry, readyChunks}) =>
      buildTraceDatasetFromReadyTraceChunks({
        name: 'dataset-events',
        ownerRefRegistry,
        readyChunks
      })
    );
    if (!traceDataset) {
      throw new Error('Expected event replacement dataset.');
    }
    const chunk = traceDataset.chunks[0];
    if (!chunk) {
      throw new Error('Expected event replacement chunk.');
    }
    const originalGetChild = chunk.spanTable.getChild.bind(chunk.spanTable);
    vi.spyOn(chunk.spanTable, 'getChild').mockImplementation(
      (columnName: Parameters<typeof originalGetChild>[0]) => {
        if (
          columnName === 'start_time_ms' ||
          columnName === 'end_time_ms' ||
          columnName === 'status_code'
        ) {
          throw new Error('Unexpected event replacement span read: ' + columnName);
        }
        return originalGetChild(columnName);
      }
    );
    const events = buildArrowTraceEventTableFromRows([
      {
        eventId: 'event:replacement',
        name: 'replacement',
        atTimeMs: 12,
        userDataJson: null
      }
    ]);

    const replacedTraceDataset = replaceTraceDatasetEvents({
      traceDataset,
      events,
      timeExtents: {minTimeMs: -5, maxTimeMs: 25}
    });
    const replacedTraceGraph = new TraceGraph({
      traceDataset: replacedTraceDataset,
      traceStore: store
    });

    expect(replacedTraceDataset).not.toBe(traceDataset);
    expect(replacedTraceDataset.revision).toBe(traceDataset.revision + 1);
    expect(replacedTraceDataset.events).toBe(events);
    expect(replacedTraceDataset.timeExtents).toEqual({minTimeMs: -5, maxTimeMs: 25});
    expect(replacedTraceDataset.processes).toBe(traceDataset.processes);
    expect(replacedTraceDataset.chunks).toBe(traceDataset.chunks);
    expect(replacedTraceDataset.sameProcessDependencyTableMap).toBe(
      traceDataset.sameProcessDependencyTableMap
    );
    expect(replacedTraceDataset.spanSidecarTableMap).toBe(traceDataset.spanSidecarTableMap);
    expect(replacedTraceDataset.crossProcessDependencyTable).toBe(
      traceDataset.crossProcessDependencyTable
    );
    expect(replacedTraceDataset.crossProcessEndpointsBySpanRef).toBe(
      traceDataset.crossProcessEndpointsBySpanRef
    );
    expect(replacedTraceDataset.stats).toBe(traceDataset.stats);
    expect(replacedTraceDataset.ownerRefSnapshot).toBe(traceDataset.ownerRefSnapshot);
    expect(replacedTraceDataset.processSpanTableMap).toBe(traceDataset.processSpanTableMap);
    expect(replacedTraceGraph.events).toBe(events);
  });

  it('uses exact replacement event bounds without retaining removed event extents', () => {
    const store = createStaticTraceChunkStore({
      identityKey: 'trace-dataset-event-extents-test',
      chunks: [createTraceChunkData('event-extents-chunk')]
    });
    const selection = store.select({window: {startTimeMs: 0, endTimeMs: 10}, spanBudget: null});
    const traceDataset = store.withReadyChunks(selection, ({ownerRefRegistry, readyChunks}) =>
      buildTraceDatasetFromReadyTraceChunks({
        name: 'dataset-event-extents',
        ownerRefRegistry,
        readyChunks
      })
    );
    if (!traceDataset) {
      throw new Error('Expected event extents dataset.');
    }
    const farEvents = buildArrowTraceEventTableFromRows([
      {
        eventId: 'event:far',
        name: 'far',
        atTimeMs: 100,
        userDataJson: null
      }
    ]);
    const datasetWithFarEvents = replaceTraceDatasetEvents({
      traceDataset,
      events: farEvents,
      timeExtents: {minTimeMs: 0, maxTimeMs: 100}
    });
    const nearEvents = buildArrowTraceEventTableFromRows([
      {
        eventId: 'event:near',
        name: 'near',
        atTimeMs: 5,
        userDataJson: null
      }
    ]);
    const datasetWithNearEvents = replaceTraceDatasetEvents({
      traceDataset: datasetWithFarEvents,
      events: nearEvents,
      timeExtents: {minTimeMs: 0, maxTimeMs: 10}
    });

    expect(datasetWithFarEvents.timeExtents).toEqual({minTimeMs: 0, maxTimeMs: 100});
    expect(datasetWithNearEvents.timeExtents).toEqual({minTimeMs: 0, maxTimeMs: 10});
    expect(
      replaceTraceDatasetEvents({
        traceDataset: datasetWithNearEvents,
        events: nearEvents,
        timeExtents: {minTimeMs: 0, maxTimeMs: 10}
      })
    ).toBe(datasetWithNearEvents);
  });

  it('uses finalized chunk summaries without rereading span timing or status columns', () => {
    const descriptor = createDescriptor('chunk-a', 'head', 0, 10, 0, 10, 2);
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-diagnostic-summary-test',
      descriptors: [descriptor],
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    const chunk = store.add({
      ...createTraceChunkData('chunk-a'),
      diagnostics: {
        rowCount: 2,
        notStartedSpanCount: 1,
        unfinishedSpanCount: 1,
        invalidRecordCount: 0,
        minTimeMs: -5,
        maxTimeMs: 25,
        warningCounters: {}
      }
    });
    const originalGetChild = chunk.spanTable.getChild.bind(chunk.spanTable);
    vi.spyOn(chunk.spanTable, 'getChild').mockImplementation(
      (columnName: Parameters<typeof originalGetChild>[0]) => {
        if (
          columnName === 'start_time_ms' ||
          columnName === 'end_time_ms' ||
          columnName === 'status_code'
        ) {
          throw new Error('Unexpected summarized span read: ' + columnName);
        }
        return originalGetChild(columnName);
      }
    );

    let traceDataset!: TraceDataset;
    store.withReadyChunks(
      store.select({window: {startTimeMs: 0, endTimeMs: 10}, spanBudget: null}),
      ({ownerRefRegistry, readyChunks}) => {
        traceDataset = buildTraceDatasetFromReadyTraceChunks({
          name: 'summarized',
          ownerRefRegistry,
          readyChunks
        });
        return traceDataset;
      }
    );

    expect(traceDataset.timeExtents).toEqual({minTimeMs: -5, maxTimeMs: 25});
    expect(traceDataset.stats).toMatchObject({
      spanCount: 2,
      notStartedSpanCount: 1,
      unfinishedSpanCount: 1
    });
  });

  it('merges append summaries without rereading previous span timings', () => {
    const descriptors = [
      createDescriptor('chunk-a', 'head', 0, 10, 0, 10, 2),
      createDescriptor('chunk-b', 'head', 10, 20, 10, 20, 2)
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-append-time-bounds-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    const firstChunk = store.add(
      createTraceChunkData('chunk-a', {
        processId: 'process-a' as TraceProcessId,
        threadId: 'thread-a' as TraceThreadId
      })
    );
    const firstSelection = store.select({
      window: {startTimeMs: 0, endTimeMs: 10},
      spanBudget: null
    });
    let previousTraceDataset!: TraceDataset;
    store.withReadyChunks(firstSelection, ({ownerRefRegistry, readyChunks}) => {
      previousTraceDataset = buildTraceDatasetFromReadyTraceChunks({
        name: 'first',
        ownerRefRegistry,
        readyChunks,
        timeExtents: {minTimeMs: 0, maxTimeMs: 10}
      });
      return previousTraceDataset;
    });
    const previousSpanTable = firstChunk.spanTable;
    const originalGetChild = previousSpanTable.getChild.bind(previousSpanTable);
    vi.spyOn(previousSpanTable, 'getChild').mockImplementation(
      (columnName: Parameters<typeof originalGetChild>[0]) => {
        if (
          columnName === 'start_time_ms' ||
          columnName === 'end_time_ms' ||
          columnName === 'status_code'
        ) {
          throw new Error(`Unexpected previous timing read: ${columnName}`);
        }
        return originalGetChild(columnName);
      }
    );

    store.add({
      ...createTraceChunkData('chunk-b', {
        processId: 'process-b' as TraceProcessId,
        threadId: 'thread-b' as TraceThreadId
      }),
      diagnostics: {
        rowCount: 2,
        notStartedSpanCount: 1,
        unfinishedSpanCount: 1,
        invalidRecordCount: 0,
        minTimeMs: 10,
        maxTimeMs: 20,
        warningCounters: {}
      }
    });
    const appendedTraceDataset = store.withReadyChunks(
      store.select({window: {startTimeMs: 0, endTimeMs: 20}, spanBudget: null}),
      ({ownerRefRegistry, readyChunks}) =>
        appendTraceDatasetFromReadyTraceChunks({
          name: 'appended',
          ownerRefRegistry,
          previousTraceDataset,
          addedReadyChunks: readyChunks.slice(1),
          crossProcessDependencies: [],
          addedCrossProcessDependencies: []
        })
    );

    expect(appendedTraceDataset).toMatchObject({
      timeExtents: {
        minTimeMs: 0,
        maxTimeMs: 20
      },
      stats: {
        spanCount: 4,
        notStartedSpanCount: 1,
        unfinishedSpanCount: 1
      }
    });
  });

  it('keeps implicit same-process dependency rows process-scoped in a sparse chunk slot', () => {
    const descriptors = [
      createDescriptor('missing-chunk', 'head', 0, 10, 0, 10, 5),
      createDescriptor('chunk-data', 'head', 10, 20, 10, 20, 5)
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-data-same-process-dependency-ref-finalization-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    const data = {
      ...createTraceChunkData('chunk-data'),
      resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTableFromColumns({
        dependencyId: ['dependency:root:child'],
        startSpanRef: [encodeSpanRef(0, 0)],
        startSpanId: ['root'],
        endSpanRef: [encodeSpanRef(0, 1)],
        endSpanId: ['child'],
        waitMode: ['end-to-start'],
        bidirectional: [false],
        waitTimeMs: [0],
        keywords: [[]],
        hasParentKeyword: [false]
      }),
      spanSidecarTable: buildArrowTraceSpanSidecarTableFromColumns({
        rowCount: 2
      })
    } satisfies TraceChunkData;
    const startSpanRefValues =
      data.resolvedSameProcessDependencyTable.getChild('startSpanRef')?.data[0]?.values;
    const endSpanRefValues =
      data.resolvedSameProcessDependencyTable.getChild('endSpanRef')?.data[0]?.values;

    const chunk = store.add(data);
    expect(chunk.chunkIndex).toBe(1);
    expect(chunk.processRefs).toEqual([encodeProcessRef(0)]);
    expect(chunk.resolvedSameProcessDependencyTable).toBe(data.resolvedSameProcessDependencyTable);
    expect(chunk.resolvedSameProcessDependencyTable.getChild('dependencyRef')).toBeNull();
    expect(chunk.resolvedSameProcessDependencyTable.getChild('startSpanRef')?.data[0]?.values).toBe(
      startSpanRefValues
    );
    expect(chunk.resolvedSameProcessDependencyTable.getChild('endSpanRef')?.data[0]?.values).toBe(
      endSpanRefValues
    );
    expect(chunk.resolvedSameProcessDependencyTable.getChild('startSpanRef')?.get(0)).toBe(
      encodeSpanRef(1, 0)
    );
    expect(chunk.resolvedSameProcessDependencyTable.getChild('endSpanRef')?.get(0)).toBe(
      encodeSpanRef(1, 1)
    );
    expect(chunk.spanSidecarTable?.getChild('outgoingSameProcessDependencyRefs')).toBeNull();
  });

  it('rejects non-null out-of-bounds dependency endpoint refs during finalization', () => {
    const descriptors = [createDescriptor('chunk-data', 'head', 0, 10, 0, 10, 5)];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-invalid-dense-dependency-endpoint-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    const data = {
      ...createTraceChunkData('chunk-data'),
      resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTableFromColumns({
        startSpanRef: [encodeSpanRef(0, 3)],
        endSpanRef: [encodeSpanRef(0, 1)],
        waitMode: ['end-to-start'],
        bidirectional: [false],
        waitTimeMs: [0],
        keywords: [[]],
        hasParentKeyword: [false]
      })
    } satisfies TraceChunkData;

    expect(() => store.add(data)).toThrow('Invalid finalized dense dependency row 0.');
  });

  it('rejects invalid endpoint status and wait-mode codes during finalization', () => {
    const createDependencyChunkData = () => ({
      ...createTraceChunkData('chunk-data'),
      resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTableFromColumns({
        startSpanRef: [encodeSpanRef(0, 0)],
        endSpanRef: [encodeSpanRef(0, 1)],
        waitMode: ['end-to-start'],
        bidirectional: [false],
        waitTimeMs: [0],
        keywords: [[]],
        hasParentKeyword: [false]
      })
    });
    const statusData = createDependencyChunkData();
    const statusValues = statusData.spanTable.getChild('status_code')?.data[0]?.values;
    if (!(statusValues instanceof Uint8Array)) {
      throw new Error('Expected mutable status-code test values.');
    }
    statusValues[0] = 0xff;
    const statusStore = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-invalid-dense-dependency-status-test',
      descriptors: [createDescriptor('chunk-data', 'head', 0, 10, 0, 10, 5)],
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    expect(() => statusStore.add(statusData)).toThrow('Invalid finalized dense dependency row 0.');

    const waitModeData = createDependencyChunkData();
    const waitModeValues =
      waitModeData.resolvedSameProcessDependencyTable.getChild('waitModeCode')?.data[0]?.values;
    if (!(waitModeValues instanceof Uint8Array)) {
      throw new Error('Expected mutable wait-mode test values.');
    }
    waitModeValues[0] = 0xff;
    const waitModeStore = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-invalid-dense-dependency-wait-mode-test',
      descriptors: [createDescriptor('chunk-data', 'head', 0, 10, 0, 10, 5)],
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    expect(() => waitModeStore.add(waitModeData)).toThrow(
      'Invalid finalized dense dependency row 0.'
    );
  });

  it('finalizes multi-process TraceChunkData loaded through ensure', async () => {
    const descriptors = [createDescriptor('chunk-a', 'head', 0, 10, 0, 10, 5)];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-data-ensure-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    const data = createStoreLoadedTraceChunkData('chunk-a', [
      createArrowTraceProcessMetadata('rank-a', 0),
      createArrowTraceProcessMetadata('rank-b', 1)
    ]);

    await loadTestWindow(store, {
      descriptors,
      loadChunk: async () => data
    });
    const readyChunk = store.getReadyChunks(descriptors)[0];
    if (!readyChunk) {
      throw new Error('Expected ready chunk');
    }

    const chunk = readyChunk.payload;

    expect(chunk.chunkIndex).toBe(readyChunk.chunkIndex);
    expect(chunk.chunkRef).toBe(readyChunk.chunkRef);
    expect(chunk.chunkKey).toBe('chunk-a');
    expect(chunk.processRefs).toEqual([encodeProcessRef(0), encodeProcessRef(1)]);
    expect(chunk.spanTable).toBe(data.spanTable);
    expect(chunk.spanTable.getChild('external_span_id')?.get(0)).toBe('external-chunk-span');
    expect(chunk.resolvedSameProcessDependencyTable).toBe(data.resolvedSameProcessDependencyTable);
  });

  it('aligns multi-process metadata with finalized row-owner ref order', async () => {
    const descriptors = [createDescriptor('chunk-a', 'head', 0, 10, 0, 10, 5)];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-reversed-process-row-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    const data = createStoreLoadedTraceChunkData(
      'chunk-a',
      [createArrowTraceProcessMetadata('rank-a', 0), createArrowTraceProcessMetadata('rank-b', 1)],
      [1, 0]
    );

    await loadTestWindow(store, {
      descriptors,
      loadChunk: async () => data
    });
    const chunk = store.getReadyChunks(descriptors)[0]?.payload;
    if (!chunk) {
      throw new Error('Expected ready chunk');
    }

    expect(chunk.processRefs).toEqual([encodeProcessRef(1), encodeProcessRef(0)]);
    expect(chunk.processes.map(process => process.processId)).toEqual(['rank-b', 'rank-a']);
  });

  it('uses external span ids as the default store URL codec', async () => {
    const descriptors = [createDescriptor('chunk-a', 'head', 0, 10, 0, 10, 5)];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'external-url-codec-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    const data = createStoreLoadedTraceChunkData('chunk-a', [
      createArrowTraceProcessMetadata('rank-a', 0)
    ]);

    await loadTestWindow(store, {
      descriptors,
      loadChunk: async () => data
    });
    const readyChunk = store.getReadyChunks(descriptors)[0];
    if (!readyChunk) {
      throw new Error('Expected ready chunk');
    }
    const chunk = readyChunk.payload;
    const spanUrlSource: TraceSpanUrlSource = {chunks: [chunk]};

    expect(store.spanUrlCodec).toBe(TRACE_EXTERNAL_SPAN_ID_URL_CODEC);
    expect(
      store.spanUrlCodec.serializeSpanRef({
        traceSource: spanUrlSource,
        spanRef: encodeSpanRef(chunk.chunkIndex, 0)
      })
    ).toBe('external-chunk-span');
    expect(
      store.spanUrlCodec.deserializeSpanRefs({
        traceSource: spanUrlSource,
        spanIds: ['external-chunk-span']
      })
    ).toEqual([encodeSpanRef(chunk.chunkIndex, 0)]);
  });

  it('reports store-backed span-ref availability for refs outside the current graph', async () => {
    const descriptors = [
      createDescriptor('chunk-a', 'head', 0, 10, 0, 10, 5),
      createDescriptor('chunk-b', 'head', 11, 20, 11, 20, 5)
    ];
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'span-ref-availability-test',
      descriptors,
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    const data = createStoreLoadedTraceChunkData('chunk-a', [
      createArrowTraceProcessMetadata('rank-a', 0)
    ]);

    expect(store.getSpanRefAvailability(encodeSpanRef(0, 0))).toBe('not-loaded');

    await loadTestWindow(store, {
      descriptors: [descriptors[0]!],
      loadChunk: async () => data
    });

    expect(store.getSpanRefAvailability(encodeSpanRef(0, 0))).toBe('outside-window');
    expect(store.getSpanRefAvailability(encodeSpanRef(0, 10))).toBe('unknown');
    expect(store.getSpanRefAvailability(encodeSpanRef(1, 0))).toBe('not-loaded');
    expect(store.getSpanRefAvailability(encodeSpanRef(2, 0))).toBe('unknown');
  });

  it('deduplicates in-flight loads while superseding stale active-window callers', async () => {
    const store = createStore([createDescriptor('shared', 'head', 0, 10, 0, 10, 5)]);
    const deferred = createDeferred<StoredPayload>();
    const loadChunk = vi.fn(async () => deferred.promise);
    const firstProgress = vi.fn();
    const secondProgress = vi.fn();

    const firstEnsure = loadTestWindow(store, {
      descriptors: store.getDescriptors(),
      loadChunk,
      onProgress: firstProgress
    });
    const secondEnsure = loadTestWindow(store, {
      descriptors: store.getDescriptors(),
      loadChunk,
      onProgress: secondProgress
    });
    const firstRejection = expect(firstEnsure).rejects.toThrow('load was superseded');

    expect(loadChunk).toHaveBeenCalledTimes(1);
    expect(firstProgress).toHaveBeenCalledWith({
      loadedChunks: 0,
      totalChunks: 1,
      loadedSpanCount: 0,
      totalSpanCount: 5
    });
    expect(secondProgress).toHaveBeenCalledWith({
      loadedChunks: 0,
      totalChunks: 1,
      loadedSpanCount: 0,
      totalSpanCount: 5
    });

    deferred.resolve({value: 'shared'});
    await firstRejection;
    const secondResult = await secondEnsure;

    expect(secondResult.summary).toEqual({
      requestedChunkCount: 1,
      reusedReadyChunkCount: 0,
      reusedPendingChunkCount: 1,
      fetchedChunkCount: 0
    });
    expect(firstProgress).toHaveBeenLastCalledWith({
      loadedChunks: 0,
      totalChunks: 1,
      loadedSpanCount: 0,
      totalSpanCount: 5
    });
    expect(secondProgress).toHaveBeenLastCalledWith({
      loadedChunks: 1,
      totalChunks: 1,
      loadedSpanCount: 5,
      totalSpanCount: 5
    });
  });

  it('counts already-ready chunks before fetching newly missing chunks', async () => {
    const descriptors = [
      createDescriptor('ready', 'head', 0, 10, 0, 10, 5),
      createDescriptor('missing', 'logical', 11, 20, 11, 20, 5)
    ];
    const store = createStore(descriptors);
    await loadTestWindow(store, {
      descriptors: [descriptors[0]!],
      loadChunk: async () => ({value: 'ready'})
    });
    const onProgress = vi.fn();

    const ensureResult = await loadTestWindow(store, {
      descriptors,
      loadChunk: async descriptor => ({value: descriptor.label}),
      onProgress
    });

    expect(ensureResult.summary).toEqual({
      requestedChunkCount: 2,
      reusedReadyChunkCount: 1,
      reusedPendingChunkCount: 0,
      fetchedChunkCount: 1
    });
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      loadedChunks: 1,
      totalChunks: 2,
      loadedSpanCount: 5,
      totalSpanCount: 10
    });
    expect(onProgress).toHaveBeenLastCalledWith({
      loadedChunks: 2,
      totalChunks: 2,
      loadedSpanCount: 10,
      totalSpanCount: 10
    });
  });

  it('keeps failed loads retryable without retaining rejected payloads', async () => {
    const store = createStore([createDescriptor('retry', 'head', 0, 10, 0, 10, 5)]);
    const descriptors = store.getDescriptors();
    let shouldFail = true;
    const loadChunk = vi.fn(async (_descriptor: TestDescriptor): Promise<StoredPayload> => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('boom');
      }
      return {value: 'retry'};
    });

    await expect(loadTestWindow(store, {descriptors, loadChunk})).rejects.toThrow('boom');
    expect(store.getLoadedChunk('retry')).toBeUndefined();

    await expect(loadTestWindow(store, {descriptors, loadChunk})).resolves.toMatchObject({
      summary: {
        requestedChunkCount: 1,
        reusedReadyChunkCount: 0,
        reusedPendingChunkCount: 0,
        fetchedChunkCount: 1
      }
    });
    expect(store.getLoadedChunk('retry')).toEqual({value: 'retry'});
  });

  it('leaves intentionally skipped loads retryable without failing ensure', async () => {
    const store = createStore([
      createDescriptor('ready', 'head', 0, 10, 0, 10, 5),
      createDescriptor('skipped', 'logical', 5, 15, 5, 15, 5)
    ]);
    const descriptors = store.getDescriptors();
    let shouldSkip = true;
    const loadChunk = vi.fn(async (descriptor: TestDescriptor): Promise<StoredPayload> => {
      if (descriptor.chunkKey === 'skipped' && shouldSkip) {
        shouldSkip = false;
        throw new TraceChunkStoreLoadSkippedError('skip for now');
      }
      return {value: descriptor.label};
    });

    await expect(loadTestWindow(store, {descriptors, loadChunk})).resolves.toMatchObject({
      readyChunks: [{descriptor: expect.objectContaining({chunkKey: 'ready'})}],
      summary: {
        requestedChunkCount: 2,
        reusedReadyChunkCount: 0,
        reusedPendingChunkCount: 0,
        fetchedChunkCount: 2
      }
    });
    expect(store.getLoadedChunk('ready')).toEqual({value: 'ready'});
    expect(store.getLoadedChunk('skipped')).toBeUndefined();

    await expect(loadTestWindow(store, {descriptors, loadChunk})).resolves.toMatchObject({
      summary: {
        requestedChunkCount: 2,
        reusedReadyChunkCount: 1,
        reusedPendingChunkCount: 0,
        fetchedChunkCount: 1
      }
    });
    expect(store.getLoadedChunk('skipped')).toEqual({value: 'skipped'});
  });

  it('unloads ready chunks and cancels pending loads without retaining stale completions', async () => {
    const descriptors = [
      createDescriptor('ready', 'head', 0, 9, 0, 9, 5),
      createDescriptor('pending', 'logical', 10, 19, 10, 19, 5),
      createDescriptor('failed', 'logical', 20, 29, 20, 29, 5)
    ];
    const store = createStore(descriptors);
    await loadTestWindow(store, {
      descriptors: [descriptors[0]!],
      loadChunk: async descriptor => ({value: descriptor.label})
    });
    await expect(
      loadTestWindow(store, {
        descriptors: [descriptors[2]!],
        loadChunk: async () => {
          throw new Error('failed load');
        }
      })
    ).rejects.toThrow('failed load');

    const pendingDeferred = createDeferred<StoredPayload>();
    let pendingSignal: AbortSignal | undefined;
    const pendingEnsure = loadTestWindow(store, {
      descriptors: [descriptors[1]!],
      loadChunk: async (_descriptor, context) => {
        pendingSignal = context.signal;
        return pendingDeferred.promise;
      }
    });

    expect(store.getDiagnostics()).toMatchObject({
      readyChunkCount: 1,
      pendingChunkCount: 1,
      failedChunkCount: 1
    });

    expect(store.unloadChunks(['ready', 'pending', 'failed'])).toEqual({
      requestedChunkCount: 3,
      unloadedReadyChunkCount: 1,
      cancelledPendingChunkCount: 1,
      clearedFailedChunkCount: 1
    });
    expect(pendingSignal?.aborted).toBe(true);

    pendingDeferred.resolve({value: 'stale pending'});
    await expect(pendingEnsure).resolves.toMatchObject({
      readyChunks: [],
      summary: {
        requestedChunkCount: 1,
        reusedReadyChunkCount: 0,
        reusedPendingChunkCount: 0,
        fetchedChunkCount: 1
      }
    });
    expect(store.getDiagnostics()).toMatchObject({
      readyChunkCount: 0,
      pendingChunkCount: 0,
      failedChunkCount: 0
    });
    expect(store.getLoadedChunk('ready')).toBeUndefined();
    expect(store.getLoadedChunk('pending')).toBeUndefined();

    await expect(
      loadTestWindow(store, {
        descriptors: [descriptors[1]!],
        loadChunk: async descriptor => ({value: descriptor.label})
      })
    ).resolves.toMatchObject({
      readyChunks: [{payload: {value: 'pending'}}]
    });
  });

  it('loads only descriptors matching one active window', async () => {
    const store = createStore([
      createDescriptor('left', 'head', 0, 10, 0, 10, 5),
      createDescriptor('right', 'logical', 20, 30, 20, 30, 5),
      createDescriptor('outside', 'head', 40, 50, 40, 50, 5)
    ]);
    const loadChunk = vi.fn(async (descriptor: TestDescriptor) => ({
      value: descriptor.label
    }));

    const loadResult = await store.loadWindow({
      window: {id: 'left-window', minTimeMs: 0, maxTimeMs: 10},
      loadChunk
    });

    expect(loadChunk.mock.calls.map(([descriptor]) => descriptor.chunkKey)).toEqual(['left']);
    expect(loadResult).toEqual({
      matchedChunkCount: 1,
      readyChunkCount: 1,
      reusedReadyChunkCount: 0,
      reusedPendingChunkCount: 0,
      fetchedChunkCount: 1
    });
  });

  it('cancels pending chunks outside a replacement active window', async () => {
    const store = createStore([
      createDescriptor('first', 'head', 0, 10, 0, 10, 5),
      createDescriptor('second', 'head', 20, 30, 20, 30, 5)
    ]);
    const firstDeferred = createDeferred<StoredPayload>();
    let firstSignal: AbortSignal | undefined;
    const firstLoad = store.loadWindow({
      window: {id: 'first-window', minTimeMs: 0, maxTimeMs: 10},
      loadChunk: async (_descriptor, context) => {
        firstSignal = context.signal;
        return firstDeferred.promise;
      }
    });

    const secondResult = await store.loadWindow({
      window: {id: 'second-window', minTimeMs: 20, maxTimeMs: 30},
      loadChunk: async descriptor => ({value: descriptor.label})
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(secondResult).toMatchObject({
      matchedChunkCount: 1,
      readyChunkCount: 1,
      fetchedChunkCount: 1
    });
    firstDeferred.resolve({value: 'stale'});
    await expect(firstLoad).rejects.toThrow(/cancelled|superseded/);
    expect(store.getLoadedChunk('first')).toBeUndefined();
    expect(store.getLoadedChunk('second')).toEqual({value: 'second'});
  });

  it('reports completion for the active window', async () => {
    const store = createStore([createDescriptor('shared', 'head', 0, 10, 0, 10, 5)]);
    const deferred = createDeferred<StoredPayload>();
    const loadChunk = vi.fn(async () => deferred.promise);
    const onChunksArrived = vi.fn();

    const loadResultPromise = store.loadWindow({
      window: {id: 'active-window', minTimeMs: 0, maxTimeMs: 10},
      loadChunk,
      onChunksArrived
    });

    expect(loadChunk).toHaveBeenCalledTimes(1);
    deferred.resolve({value: 'shared'});
    await loadResultPromise;

    expect(onChunksArrived).toHaveBeenCalledWith({
      windowId: 'active-window',
      newReadyChunkKeys: ['shared'],
      matchedChunkCount: 1,
      readyChunkCount: 1,
      pendingChunkCount: 0,
      failedChunkCount: 0,
      isComplete: true
    });
  });

  it('loads newly matching descriptors when registered windows survive a descriptor refresh', async () => {
    const store = createStore([createDescriptor('initial', 'head', 0, 10, 0, 10, 5)]);
    const loadChunk = vi.fn(async (descriptor: TestDescriptor) => ({
      value: descriptor.label
    }));

    await store.loadWindow({
      window: {id: 'stable-window', minTimeMs: 0, maxTimeMs: 20},
      loadChunk
    });
    store.replaceDescriptors([
      createDescriptor('initial', 'head', 0, 10, 0, 10, 5),
      createDescriptor('added', 'logical', 10, 20, 10, 20, 5)
    ]);
    await store.loadWindow({
      window: {id: 'stable-window', minTimeMs: 0, maxTimeMs: 20},
      loadChunk
    });

    expect(loadChunk.mock.calls.map(([descriptor]) => descriptor.chunkKey)).toEqual([
      'initial',
      'added'
    ]);
    expect(store.getLoadedChunk('added')).toEqual({value: 'added'});
  });

  it('stops delayed window callbacks after the window is removed', async () => {
    vi.useFakeTimers();
    try {
      const store = createStore([
        createDescriptor('first', 'head', 0, 10, 0, 10, 5),
        createDescriptor('second', 'head', 0, 10, 0, 10, 5),
        createDescriptor('third', 'head', 0, 10, 0, 10, 5)
      ]);
      const firstDeferred = createDeferred<StoredPayload>();
      const secondDeferred = createDeferred<StoredPayload>();
      const thirdDeferred = createDeferred<StoredPayload>();
      const onChunksArrived = vi.fn();
      const ensurePromise = store.loadWindow({
        window: {
          id: 'removable-window',
          minTimeMs: 0,
          maxTimeMs: 10,
          notifyIntervalMs: 5_000
        },
        onChunksArrived,
        loadChunk: vi
          .fn()
          .mockImplementationOnce(async () => firstDeferred.promise)
          .mockImplementationOnce(async () => secondDeferred.promise)
          .mockImplementationOnce(async () => thirdDeferred.promise)
      });
      const ensureRejection = expect(ensurePromise).rejects.toThrow('load was superseded');

      firstDeferred.resolve({value: 'first'});
      await flushTraceChunkStoreMicrotasks();
      expect(onChunksArrived).toHaveBeenCalledTimes(1);

      secondDeferred.resolve({value: 'second'});
      await flushTraceChunkStoreMicrotasks();
      store.clearActiveWindow();
      await vi.advanceTimersByTimeAsync(5_000);
      thirdDeferred.resolve({value: 'third'});
      await flushTraceChunkStoreMicrotasks();
      await ensureRejection;

      expect(onChunksArrived).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throttles window callbacks and immediately flushes the final completion arrival', async () => {
    vi.useFakeTimers();
    try {
      const store = createStore([
        createDescriptor('first', 'head', 0, 10, 0, 10, 5),
        createDescriptor('second', 'head', 0, 10, 0, 10, 5),
        createDescriptor('third', 'head', 0, 10, 0, 10, 5)
      ]);
      const firstDeferred = createDeferred<StoredPayload>();
      const secondDeferred = createDeferred<StoredPayload>();
      const thirdDeferred = createDeferred<StoredPayload>();
      const onChunksArrived = vi.fn();
      const selectSpy = vi.spyOn(store, 'select');
      const ensurePromise = store.loadWindow({
        window: {
          id: 'throttled-window',
          minTimeMs: 0,
          maxTimeMs: 10,
          notifyIntervalMs: 5_000
        },
        onChunksArrived,
        loadChunk: vi
          .fn()
          .mockImplementationOnce(async () => firstDeferred.promise)
          .mockImplementationOnce(async () => secondDeferred.promise)
          .mockImplementationOnce(async () => thirdDeferred.promise)
      });
      const selectionCallCountAfterRegistration = selectSpy.mock.calls.length;

      firstDeferred.resolve({value: 'first'});
      await flushTraceChunkStoreMicrotasks();
      expect(onChunksArrived).toHaveBeenCalledTimes(1);
      expect(selectSpy).toHaveBeenCalledTimes(selectionCallCountAfterRegistration);

      secondDeferred.resolve({value: 'second'});
      await flushTraceChunkStoreMicrotasks();
      expect(onChunksArrived).toHaveBeenCalledTimes(1);

      thirdDeferred.resolve({value: 'third'});
      await flushTraceChunkStoreMicrotasks();
      await ensurePromise;

      expect(onChunksArrived).toHaveBeenCalledTimes(2);
      expect(onChunksArrived).toHaveBeenLastCalledWith({
        windowId: 'throttled-window',
        newReadyChunkKeys: ['second', 'third'],
        matchedChunkCount: 3,
        readyChunkCount: 3,
        pendingChunkCount: 0,
        failedChunkCount: 0,
        isComplete: true
      });
      expect(selectSpy).toHaveBeenCalledTimes(selectionCallCountAfterRegistration);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns partial registered-window graph data as selected stored chunks become ready', async () => {
    vi.useFakeTimers();
    try {
      const firstDeferred = createDeferred<StoredPayload>();
      const secondDeferred = createDeferred<StoredPayload>();
      const materialize = vi.fn(createGraphMaterialization);
      const spanUrlCodec = createTestSpanUrlCodec();
      const store = createGraphStore(
        [
          createDescriptor('first', 'head', 0, 10, 0, 10, 5),
          createDescriptor('second', 'logical', 0, 10, 0, 10, 5)
        ],
        spanUrlCodec
      );
      const ensurePromise = store.loadWindow({
        window: {id: 'graph-window', minTimeMs: 0, maxTimeMs: 10},
        loadChunk: vi
          .fn()
          .mockImplementationOnce(async () => firstDeferred.promise)
          .mockImplementationOnce(async () => secondDeferred.promise)
      });

      expect(materializeTestWindowResult(store, materialize, 'graph-window', null)).toBeNull();

      firstDeferred.resolve({value: 'first'});
      await flushTraceChunkStoreMicrotasks();
      const partialResult = materializeTestWindowResult(store, materialize, 'graph-window', null);

      expect(partialResult?.name).toBe('graph:first');
      expect(store.spanUrlCodec).toBe(spanUrlCodec);

      secondDeferred.resolve({value: 'second'});
      await ensurePromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses external span ids as the default store URL codec', () => {
    const externalSpanId = '6149800612493239450';
    const store = createStore([]);
    const spanUrlSource = buildExternalSpanUrlSource(externalSpanId);
    const spanRef = encodeSpanRef(0, 0);

    expect(store.spanUrlCodec).toBe(TRACE_EXTERNAL_SPAN_ID_URL_CODEC);
    expect(store.spanUrlCodec.serializeSpanRef({traceSource: spanUrlSource, spanRef})).toBe(
      externalSpanId
    );
    expect(
      store.spanUrlCodec.deserializeSpanRefs({traceSource: spanUrlSource, spanIds: []})
    ).toEqual([]);
    expect(
      store.spanUrlCodec.deserializeSpanRefs({
        traceSource: spanUrlSource,
        spanIds: [externalSpanId]
      })
    ).toEqual([spanRef]);
  });

  it('materializes again when newly ready chunks extend the registered-window graph', async () => {
    vi.useFakeTimers();
    try {
      const firstDeferred = createDeferred<StoredPayload>();
      const secondDeferred = createDeferred<StoredPayload>();
      const materialize = vi.fn(createGraphMaterialization);
      const store = createGraphStore([
        createDescriptor('first', 'head', 0, 10, 0, 10, 5),
        createDescriptor('second', 'logical', 0, 10, 0, 10, 5)
      ]);
      const ensurePromise = store.loadWindow({
        window: {id: 'graph-window', minTimeMs: 0, maxTimeMs: 10},
        loadChunk: vi
          .fn()
          .mockImplementationOnce(async () => firstDeferred.promise)
          .mockImplementationOnce(async () => secondDeferred.promise)
      });

      firstDeferred.resolve({value: 'first'});
      await flushTraceChunkStoreMicrotasks();
      expect(materializeTestWindowResult(store, materialize, 'graph-window', null)?.name).toBe(
        'graph:first'
      );

      secondDeferred.resolve({value: 'second'});
      await flushTraceChunkStoreMicrotasks();
      const completedResult = materializeTestWindowResult(store, materialize, 'graph-window', null);
      await ensurePromise;

      expect(materialize).toHaveBeenCalledTimes(2);
      expect(completedResult?.name).toBe('graph:first,second');
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Create one generic chunk store configured with the chronological span-budget policy.
 */
function createStore(
  descriptors: readonly TestDescriptor[]
): TraceChunkStore<StoredPayload, TestDescriptor> {
  return new TraceChunkStore<StoredPayload, TestDescriptor>({
    identityKey: 'trace-test',
    descriptors,
    selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
  });
}

/** Loads an explicit descriptor subset through the active-window API for focused store tests. */
async function loadTestWindow<TPayload, TDescriptor extends TraceChunkDescriptor>(
  store: TraceChunkStore<TPayload, TDescriptor>,
  params: {
    /** Descriptor subset covered by the synthetic active window. */
    descriptors: readonly TDescriptor[];
    /** Test-owned descriptor loader. */
    loadChunk: Parameters<TraceChunkStore<TPayload, TDescriptor>['loadWindow']>[0]['loadChunk'];
    /** Optional progress observer. */
    onProgress?: Parameters<TraceChunkStore<TPayload, TDescriptor>['loadWindow']>[0]['onProgress'];
  }
) {
  const startTimeMs = Math.min(...params.descriptors.map(descriptor => descriptor.startTimeMs));
  const endTimeMs = Math.max(...params.descriptors.map(descriptor => descriptor.endTimeMs));
  const result = await store.loadWindow({
    window: {
      id: `test:${startTimeMs}:${endTimeMs}`,
      minTimeMs: startTimeMs,
      maxTimeMs: endTimeMs
    },
    loadChunk: params.loadChunk,
    onProgress: params.onProgress
  });
  return {
    readyChunks: store.getReadyChunks(params.descriptors),
    summary: {
      requestedChunkCount: result.matchedChunkCount,
      reusedReadyChunkCount: result.reusedReadyChunkCount,
      reusedPendingChunkCount: result.reusedPendingChunkCount,
      fetchedChunkCount: result.fetchedChunkCount
    }
  };
}

/**
 * Create one chunk store configured with graph-window materialization test hooks.
 */
function createGraphStore(
  descriptors: readonly TestDescriptor[],
  spanUrlCodec?: TraceSpanUrlCodec
): TraceChunkStore<StoredPayload, TestDescriptor> {
  return new TraceChunkStore<StoredPayload, TestDescriptor>({
    identityKey: 'trace-graph-test',
    descriptors,
    selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>(),
    spanUrlCodec
  });
}

/**
 * Materialize one caller-owned result from the test active window.
 */
function materializeTestWindowResult(
  store: TraceChunkStore<StoredPayload, TestDescriptor>,
  materializer: (
    params: TraceChunkReadyMaterializerParams<StoredPayload, TestDescriptor>
  ) => ReturnType<typeof buildEmptyNamedMaterialization>,
  _windowId: string,
  spanBudget: number | null
) {
  return store.withReadyChunks(
    store.select({
      window: {startTimeMs: 0, endTimeMs: 10},
      spanBudget
    }),
    materializer
  );
}

/**
 * Create a minimal span URL codec used to verify stores preserve source configuration.
 */
function createTestSpanUrlCodec(): TraceSpanUrlCodec {
  return {
    serializeSpanRef: () => 'test-span',
    deserializeSpanRefs: () => []
  };
}

/**
 * Build one deterministic empty Arrow graph whose name exposes the ready test chunk labels.
 */
function createGraphMaterialization(params: {
  /** Ready stored chunks passed through the generic store result-materialization path. */
  readyChunks: TraceChunkReadyMaterializerParams<StoredPayload, TestDescriptor>['readyChunks'];
}) {
  const chunkLabels = params.readyChunks.map(chunk => chunk.payload.value);
  return buildEmptyNamedMaterialization(chunkLabels);
}

/**
 * Build one deterministic empty materialization with test-visible naming.
 */
function buildEmptyNamedMaterialization(chunkLabels: readonly string[]) {
  return {name: `graph:${chunkLabels.join(',')}`};
}

/**
 * Build one narrow URL source with a row-level external span id.
 */
function buildExternalSpanUrlSource(externalSpanId: string): TraceSpanUrlSource {
  const process = createArrowTraceProcessMetadata('rank-1', 0);
  const chunk: ArrowTraceChunk = {
    chunkIndex: 0,
    chunkRef: encodeChunkRef(0),
    chunkKey: 'external-span-url-codec-test',
    processRefs: [encodeProcessRef(0)],
    processId: process.processId as TraceProcessId,
    spanTable: buildArrowTraceSpanTableFromColumns({
      process_ref: [encodeProcessRef(0)],
      thread_ref: [null],
      span_id: ['runtime-span'],
      external_span_id: [externalSpanId],
      thread_id: ['thread-1'],
      name: ['Runtime Span'],
      source: [null],
      primary_timing_key: ['measured'],
      status: ['finished'],
      start_time_ms: [0],
      end_time_ms: [1],
      duration_ms: [1]
    }),
    resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTable([])
  };
  return {chunks: [chunk]};
}

/** Build one deterministic cross-process dependency used by dataset append tests. */
function createTestCrossProcessDependency(dependencyId: string): TraceCrossProcessDependency {
  return {
    type: 'trace-cross-process-dependency',
    dependencyId: dependencyId as TraceDependencyId,
    endpointId: `endpoint:${dependencyId}` as TraceCrossProcessEndpointId,
    startRankNum: 0,
    endRankNum: 1,
    startSpanId: 'root' as TraceSpanId,
    endSpanId: 'child' as TraceSpanId,
    waitMode: 'end-to-start',
    bidirectional: false,
    topology: 'test',
    waitTimeMs: 0,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set()
  };
}

/**
 * Build parser-local chunk data for store finalization tests.
 */
function createTraceChunkData(
  chunkKey: string,
  options?: {
    /** Process id used by generated rows. */
    readonly processId?: TraceProcessId;
    /** Thread id used by generated rows. */
    readonly threadId?: TraceThreadId;
    /** Optional manual-layout top edges copied into generated span rows. */
    readonly layoutTopY?: Array<number | null>;
    /** Optional manual-layout heights copied into generated span rows. */
    readonly layoutHeight?: Array<number | null>;
  }
): TraceChunkData {
  const processId = options?.processId ?? ('trace-chunk-data-process' as TraceProcessId);
  const threadId = options?.threadId ?? ('trace-chunk-data-thread' as TraceThreadId);
  const thread = {
    type: 'trace-thread',
    threadId,
    processId,
    name: 'trace chunk data thread'
  } as const;
  const sourceDependencyTable = buildTraceChunkSourceDependencyTable([
    {
      dependencyKind: 'parent',
      startExternalSpanId: 'span:root',
      endExternalSpanId: 'span:child',
      waitMode: 'start-to-start'
    }
  ]);
  const rowWindowTable = buildTraceChunkRowWindowTable([
    [{startTimeMs: 0, endTimeMs: 5}],
    [{startTimeMs: 5, endTimeMs: 10}]
  ]);
  return {
    type: 'trace-chunk-data',
    chunkKey,
    processes: [
      {
        type: 'trace-process',
        processId,
        name: 'trace chunk data process',
        tags: [],
        rankNum: 0,
        processOrder: 0,
        stepNum: 0,
        threads: [thread],
        threadMap: {[threadId]: thread},
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
    processId,
    spanTable: buildArrowTraceSpanTableFromColumns({
      process_ref: [encodeProcessRef(0), encodeProcessRef(0)],
      thread_ref: [encodeProcessThreadRef(0, 0), encodeProcessThreadRef(0, 0)],
      span_id: ['root' as TraceSpanId, 'child' as TraceSpanId],
      external_span_id: ['span:root', 'span:child'],
      thread_id: [threadId, threadId],
      name: ['root', 'child'],
      source: [null, null],
      primary_timing_key: ['primary', 'primary'],
      status: ['finished', 'finished'],
      start_time_ms: [0, 5],
      end_time_ms: [5, 10],
      duration_ms: [5, 5],
      layout_top_y: options?.layoutTopY,
      layout_height: options?.layoutHeight
    }),
    resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTable([]),
    sourceDependencyTable,
    rowWindowTable,
    diagnostics: {
      rowCount: 2,
      notStartedSpanCount: 0,
      unfinishedSpanCount: 0,
      invalidRecordCount: 0,
      minTimeMs: 0,
      maxTimeMs: 10,
      warningCounters: {}
    },
    refState: 'parser-local'
  };
}

/**
 * Build one parser-local chunk data payload for stored chunk materialization tests.
 *
 * @param rowProcessIndexes Parser-local process indexes in emitted span-row order.
 */
function createStoreLoadedTraceChunkData(
  chunkKey: string,
  processes: readonly ArrowTraceProcessMetadata[],
  rowProcessIndexes: readonly number[] = processes.map((_, processIndex) => processIndex)
): TraceChunkData {
  const rowProcesses = rowProcessIndexes.map(processIndex => {
    const process = processes[processIndex];
    if (!process) {
      throw new Error(`Missing test process metadata for row process index ${processIndex}.`);
    }
    return process;
  });
  const spanRowIndexes = rowProcesses.map((_, rowIndex) => rowIndex);
  return {
    type: 'trace-chunk-data',
    chunkKey,
    processes,
    processId:
      processes.length === 1 ? ((processes[0]?.processId ?? null) as TraceProcessId | null) : null,
    spanTable: buildArrowTraceSpanTableFromColumns({
      process_ref: rowProcesses.map(process => encodeProcessRef(process.rankNum)),
      thread_ref: rowProcesses.map(process => encodeProcessThreadRef(process.rankNum, 0)),
      span_id: spanRowIndexes.map(rowIndex => `chunk-span-${rowIndex}`),
      external_span_id: spanRowIndexes.map(rowIndex =>
        rowIndex === 0 ? 'external-chunk-span' : `external-chunk-span-${rowIndex}`
      ),
      thread_id: rowProcesses.map(process => process.threads[0]?.threadId ?? 'thread-a'),
      name: spanRowIndexes.map(rowIndex => `chunk span ${rowIndex}`),
      source: spanRowIndexes.map(() => null),
      primary_timing_key: spanRowIndexes.map(() => 'primary'),
      status: spanRowIndexes.map(() => 'finished'),
      start_time_ms: spanRowIndexes.map(rowIndex => rowIndex),
      end_time_ms: spanRowIndexes.map(rowIndex => rowIndex + 1),
      duration_ms: spanRowIndexes.map(() => 1)
    }),
    resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTable([]),
    diagnostics: {
      rowCount: rowProcesses.length,
      notStartedSpanCount: 0,
      unfinishedSpanCount: 0,
      invalidRecordCount: 0,
      minTimeMs: rowProcesses.length > 0 ? 0 : null,
      maxTimeMs: rowProcesses.length,
      warningCounters: {}
    },
    refState: 'parser-local'
  };
}

/**
 * Build metadata-only process records for chunk data tests.
 */
function createArrowTraceProcessMetadata(
  processId: string,
  rankNum: number
): ArrowTraceProcessMetadata {
  const thread = {
    type: 'trace-thread',
    processId: processId as TraceProcessId,
    threadId: 'thread-a' as TraceThreadId,
    name: 'thread-a'
  } as const;
  return {
    type: 'trace-process',
    processId: processId as TraceProcessId,
    name: processId,
    tags: [],
    rankNum,
    processOrder: rankNum,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    remoteDependencies: []
  };
}

/**
 * Create one deterministic test descriptor.
 */
function createDescriptor(
  chunkKey: string,
  familyKey: string,
  startTimeMs: number,
  endTimeMs: number,
  sortStartTimeMs: number,
  sortEndTimeMs: number,
  advertisedSpanCount: number
): TestDescriptor {
  return {
    chunkKey,
    familyKey,
    startTimeMs,
    endTimeMs,
    sortStartTimeMs,
    sortEndTimeMs,
    advertisedSpanCount,
    label: chunkKey
  };
}

/**
 * Create a manually controlled promise for in-flight deduplication tests.
 */
function createDeferred<T>(): Deferred<T> {
  let resolvePromise: Deferred<T>['resolve'] = () => {};
  let rejectPromise: Deferred<T>['reject'] = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}

/**
 * Drain the promise chain used by stored chunk fetch finalization before asserting callbacks.
 */
async function flushTraceChunkStoreMicrotasks(): Promise<void> {
  for (let iteration = 0; iteration < 6; iteration += 1) {
    await Promise.resolve();
  }
  await vi.advanceTimersByTimeAsync(0);
}
