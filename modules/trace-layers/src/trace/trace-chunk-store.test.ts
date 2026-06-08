import {describe, expect, it, vi} from 'vitest';

import {
  buildArrowTraceLocalDependencyTable,
  buildArrowTraceSpanTableFromColumns,
  buildTraceGraphData
} from './ingestion/arrow-trace';
import {
  createChronologicalTraceChunkSpanBudgetPolicy,
  TRACE_EXTERNAL_SPAN_ID_URL_CODEC,
  TraceChunkStore
} from './trace-chunk-store';
import {
  buildTraceChunkRowWindowTable,
  buildTraceChunkSourceDependencyTable
} from './trace-chunk-window';
import {
  encodeChunkRef,
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef
} from './trace-graph/trace-id-encoder';

import type {ArrowTraceProcessMetadata} from './ingestion/arrow-trace';
import type {TraceChunk} from './trace-chunk';
import type {TraceChunkData} from './trace-chunk-data';
import type {
  TraceChunkDescriptor,
  TraceChunkWindowGraphAppendParams,
  TraceChunkWindowGraphMaterializer,
  TraceChunkWindowGraphRebuildParams,
  TraceSpanUrlCodec
} from './trace-chunk-store';
import type {TraceProcessId, TraceSpanId, TraceThreadId} from './trace-graph/trace-types';

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
  it('increments source filter revision only when source filters change', () => {
    const store = createStore([]);

    expect(store.getSourceSpanFilterRevision()).toBe(0);
    expect(store.setSourceSpanFilters(['projects/runtime/runtime-crates'])).toBe(true);
    expect(store.getSourceSpanFilterRevision()).toBe(1);
    expect(store.setSourceSpanFilters(['projects/runtime/runtime-crates'])).toBe(false);
    expect(store.getSourceSpanFilterRevision()).toBe(1);
    expect(store.setSourceSpanFilters(undefined)).toBe(true);
    expect(store.getSourceSpanFilterRevision()).toBe(2);
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
    await store.ensure({
      descriptors: store.getDescriptors(),
      loadChunk: async descriptor => ({value: descriptor.label})
    });
    const initialReadyChunk = store.getReadyChunks(store.getDescriptors())[0];

    await store.refreshDescriptors([
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
    expect(chunk.localDependencyTable).toBe(data.localDependencyTable);
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
    expect(store.getLoadedChunkBySpanRef(encodeSpanRef(0, 1))).toBe(chunk);
    expect(store.getLoadedTraceChunkBySpanRef(encodeSpanRef(0, 1))).toBe(chunk);
    expect(store.getLoadedTraceChunkBySpanRef(encodeSpanRef(0, 2))).toBeNull();
  });

  it('resolves loaded chunk display data by direct chunk row lookup', () => {
    const store = new TraceChunkStore<TraceChunk, TestDescriptor>({
      identityKey: 'trace-chunk-data-direct-display-test',
      descriptors: [],
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
    });
    store.add(createTraceChunkData('chunk-data'));

    const displaySource = store.getLoadedChunkSpanDisplaySource({
      chunkKey: 'chunk-data',
      spanRefRowIndex: 1
    });

    expect(displaySource?.spanRef).toBe(encodeSpanRef(0, 1));
    expect(displaySource?.spanId).toBe('child');
    expect(displaySource?.name).toBe('child');
    expect(displaySource?.processName).toBe('trace chunk data process');
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

    const firstChunk = store.add(firstData);
    const secondChunk = store.add(secondData);

    expect(firstChunk.spanTable).toBe(firstData.spanTable);
    expect(firstChunk.spanTable.getChild('process_ref')?.get(0)).toBe(BigInt(encodeProcessRef(0)));
    expect(firstChunk.spanTable.getChild('thread_ref')?.get(0)).toBe(
      BigInt(encodeProcessThreadRef(0, 0))
    );
    expect(secondChunk.spanTable).not.toBe(secondData.spanTable);
    expect(secondChunk.spanTable.getChild('process_ref')?.get(0)).toBe(BigInt(encodeProcessRef(1)));
    expect(secondChunk.spanTable.getChild('thread_ref')?.get(0)).toBe(
      BigInt(encodeProcessThreadRef(1, 0))
    );
    expect(secondChunk.processes.map(process => process.processId)).toEqual([
      'process-a',
      'process-b'
    ]);
    expect(secondChunk.processes.map(process => process.rankNum)).toEqual([0, 1]);
    expect(secondChunk.processRefs).toEqual([encodeProcessRef(1)]);
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

    await store.ensure({
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
    expect(chunk.localDependencyTable).toBe(data.localDependencyTable);
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

    await store.ensure({
      descriptors,
      loadChunk: async () => data
    });
    const readyChunk = store.getReadyChunks(descriptors)[0];
    if (!readyChunk) {
      throw new Error('Expected ready chunk');
    }
    const chunk = readyChunk.payload;
    const traceGraphData = buildTraceGraphData({
      name: 'external-url-codec-test',
      processes: chunk.processes,
      crossDependencies: [],
      spanTableMap: {['rank-a' as TraceProcessId]: chunk.spanTable},
      localDependencyTableMap: {
        ['rank-a' as TraceProcessId]: chunk.localDependencyTable
      },
      chunks: [chunk]
    });

    expect(store.spanUrlCodec).toBe(TRACE_EXTERNAL_SPAN_ID_URL_CODEC);
    expect(
      store.spanUrlCodec.serializeSpanRef({
        traceGraph: traceGraphData,
        spanRef: encodeSpanRef(chunk.chunkIndex, 0)
      })
    ).toBe('external-chunk-span');
    expect(
      store.spanUrlCodec.deserializeSpanRefs({
        traceGraph: traceGraphData,
        spanIds: ['external-chunk-span']
      })
    ).toEqual([encodeSpanRef(chunk.chunkIndex, 0)]);
  });

  it('reports store-backed span-ref availability for refs outside the current graph', async () => {
    const descriptors = [
      createDescriptor('chunk-a', 'head', 0, 10, 0, 10, 5),
      createDescriptor('chunk-b', 'head', 10, 20, 10, 20, 5)
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

    await store.ensure({
      descriptors: [descriptors[0]!],
      loadChunk: async () => data
    });

    expect(store.getSpanRefAvailability(encodeSpanRef(0, 0))).toBe('outside-window');
    expect(store.getSpanRefAvailability(encodeSpanRef(0, 10))).toBe('unknown');
    expect(store.getSpanRefAvailability(encodeSpanRef(1, 0))).toBe('not-loaded');
    expect(store.getSpanRefAvailability(encodeSpanRef(2, 0))).toBe('unknown');
  });

  it('deduplicates in-flight loads and reports ready progress from overlapping ensure calls', async () => {
    const store = createStore([createDescriptor('shared', 'head', 0, 10, 0, 10, 5)]);
    const deferred = createDeferred<StoredPayload>();
    const loadChunk = vi.fn(async () => deferred.promise);
    const firstProgress = vi.fn();
    const secondProgress = vi.fn();

    const firstEnsure = store.ensure({
      descriptors: store.getDescriptors(),
      loadChunk,
      onProgress: firstProgress
    });
    const secondEnsure = store.ensure({
      descriptors: store.getDescriptors(),
      loadChunk,
      onProgress: secondProgress
    });

    expect(loadChunk).toHaveBeenCalledTimes(1);
    expect(firstProgress).toHaveBeenCalledWith({loadedChunks: 0, totalChunks: 1});
    expect(secondProgress).toHaveBeenCalledWith({loadedChunks: 0, totalChunks: 1});

    deferred.resolve({value: 'shared'});
    const [firstResult, secondResult] = await Promise.all([firstEnsure, secondEnsure]);

    expect(firstResult.summary).toEqual({
      requestedChunkCount: 1,
      reusedReadyChunkCount: 0,
      reusedPendingChunkCount: 0,
      fetchedChunkCount: 1
    });
    expect(secondResult.summary).toEqual({
      requestedChunkCount: 1,
      reusedReadyChunkCount: 0,
      reusedPendingChunkCount: 1,
      fetchedChunkCount: 0
    });
    expect(firstProgress).toHaveBeenLastCalledWith({loadedChunks: 1, totalChunks: 1});
    expect(secondProgress).toHaveBeenLastCalledWith({loadedChunks: 1, totalChunks: 1});
  });

  it('counts already-ready chunks before fetching newly missing chunks', async () => {
    const descriptors = [
      createDescriptor('ready', 'head', 0, 10, 0, 10, 5),
      createDescriptor('missing', 'logical', 5, 15, 5, 15, 5)
    ];
    const store = createStore(descriptors);
    await store.ensure({
      descriptors: [descriptors[0]!],
      loadChunk: async () => ({value: 'ready'})
    });
    const onProgress = vi.fn();

    const ensureResult = await store.ensure({
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
    expect(onProgress).toHaveBeenNthCalledWith(1, {loadedChunks: 1, totalChunks: 2});
    expect(onProgress).toHaveBeenLastCalledWith({loadedChunks: 2, totalChunks: 2});
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

    await expect(store.ensure({descriptors, loadChunk})).rejects.toThrow('boom');
    expect(store.getLoadedChunk('retry')).toBeUndefined();

    await expect(store.ensure({descriptors, loadChunk})).resolves.toMatchObject({
      summary: {
        requestedChunkCount: 1,
        reusedReadyChunkCount: 0,
        reusedPendingChunkCount: 0,
        fetchedChunkCount: 1
      }
    });
    expect(store.getLoadedChunk('retry')).toEqual({value: 'retry'});
  });

  it('registers trace windows and loads the matching stored chunk union', async () => {
    const store = createStore([
      createDescriptor('left', 'head', 0, 10, 0, 10, 5),
      createDescriptor('right', 'logical', 20, 30, 20, 30, 5),
      createDescriptor('outside', 'head', 40, 50, 40, 50, 5)
    ]);
    const loadChunk = vi.fn(async (descriptor: TestDescriptor) => ({
      value: descriptor.label
    }));

    const ensureResult = await store.registerTraceWindows({
      windows: [
        {id: 'left-window', minTimeMs: 0, maxTimeMs: 10},
        {id: 'right-window', minTimeMs: 20, maxTimeMs: 30}
      ],
      loadChunk
    });

    expect(loadChunk.mock.calls.map(([descriptor]) => descriptor.chunkKey)).toEqual([
      'left',
      'right'
    ]);
    expect(ensureResult.summary).toEqual({
      requestedChunkCount: 2,
      reusedReadyChunkCount: 0,
      reusedPendingChunkCount: 0,
      fetchedChunkCount: 2
    });
    expect(store.getTraceWindows().map(window => window.id)).toEqual([
      'left-window',
      'right-window'
    ]);
  });

  it('deduplicates overlapping trace-window loads and reports per-window completion', async () => {
    const store = createStore([createDescriptor('shared', 'head', 0, 10, 0, 10, 5)]);
    const deferred = createDeferred<StoredPayload>();
    const loadChunk = vi.fn(async () => deferred.promise);
    const firstWindowArrived = vi.fn();
    const secondWindowArrived = vi.fn();

    const ensureResultPromise = store.registerTraceWindows({
      windows: [
        {
          id: 'first-window',
          minTimeMs: 0,
          maxTimeMs: 10,
          onChunksArrived: firstWindowArrived
        },
        {
          id: 'second-window',
          minTimeMs: 5,
          maxTimeMs: 15,
          onChunksArrived: secondWindowArrived
        }
      ],
      loadChunk
    });

    expect(loadChunk).toHaveBeenCalledTimes(1);
    deferred.resolve({value: 'shared'});
    await ensureResultPromise;

    expect(firstWindowArrived).toHaveBeenCalledWith({
      windowId: 'first-window',
      newReadyChunkKeys: ['shared'],
      matchedChunkCount: 1,
      readyChunkCount: 1,
      pendingChunkCount: 0,
      failedChunkCount: 0,
      isComplete: true
    });
    expect(secondWindowArrived).toHaveBeenCalledWith({
      windowId: 'second-window',
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

    await store.registerTraceWindows({
      windows: [{id: 'stable-window', minTimeMs: 0, maxTimeMs: 20}],
      loadChunk
    });
    await store.refreshDescriptors(
      [
        createDescriptor('initial', 'head', 0, 10, 0, 10, 5),
        createDescriptor('added', 'logical', 10, 20, 10, 20, 5)
      ],
      {loadChunk}
    );

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
      const ensurePromise = store.registerTraceWindows({
        windows: [
          {
            id: 'removable-window',
            minTimeMs: 0,
            maxTimeMs: 10,
            notifyIntervalMs: 5_000,
            onChunksArrived
          }
        ],
        loadChunk: vi
          .fn()
          .mockImplementationOnce(async () => firstDeferred.promise)
          .mockImplementationOnce(async () => secondDeferred.promise)
          .mockImplementationOnce(async () => thirdDeferred.promise)
      });

      firstDeferred.resolve({value: 'first'});
      await flushTraceChunkStoreMicrotasks();
      expect(onChunksArrived).toHaveBeenCalledTimes(1);

      secondDeferred.resolve({value: 'second'});
      await flushTraceChunkStoreMicrotasks();
      expect(store.removeTraceWindow('removable-window')).toBe(true);
      await vi.advanceTimersByTimeAsync(5_000);
      thirdDeferred.resolve({value: 'third'});
      await flushTraceChunkStoreMicrotasks();
      await ensurePromise;

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
      const ensurePromise = store.registerTraceWindows({
        windows: [
          {
            id: 'throttled-window',
            minTimeMs: 0,
            maxTimeMs: 10,
            notifyIntervalMs: 5_000,
            onChunksArrived
          }
        ],
        loadChunk: vi
          .fn()
          .mockImplementationOnce(async () => firstDeferred.promise)
          .mockImplementationOnce(async () => secondDeferred.promise)
          .mockImplementationOnce(async () => thirdDeferred.promise)
      });

      firstDeferred.resolve({value: 'first'});
      await flushTraceChunkStoreMicrotasks();
      expect(onChunksArrived).toHaveBeenCalledTimes(1);

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
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns partial registered-window graph snapshots as selected stored chunks become ready', async () => {
    vi.useFakeTimers();
    try {
      const firstDeferred = createDeferred<StoredPayload>();
      const secondDeferred = createDeferred<StoredPayload>();
      const rebuild = vi.fn(createGraphRebuildMaterialization);
      const spanUrlCodec = createTestSpanUrlCodec();
      const store = createGraphStore(
        [
          createDescriptor('first', 'head', 0, 10, 0, 10, 5),
          createDescriptor('second', 'logical', 0, 10, 0, 10, 5)
        ],
        {rebuild},
        spanUrlCodec
      );
      const ensurePromise = store.registerTraceWindows({
        windows: [{id: 'graph-window', minTimeMs: 0, maxTimeMs: 10}],
        loadChunk: vi
          .fn()
          .mockImplementationOnce(async () => firstDeferred.promise)
          .mockImplementationOnce(async () => secondDeferred.promise)
      });

      expect(store.getTraceGraphForWindow('graph-window', null)).toBeNull();

      firstDeferred.resolve({value: 'first'});
      await flushTraceChunkStoreMicrotasks();
      const partialSnapshot = store.getTraceGraphForWindow('graph-window', null);

      expect(partialSnapshot).toMatchObject({
        windowId: 'graph-window',
        version: 1,
        materializationMode: 'rebuild',
        readiness: {
          selectedChunkCount: 2,
          readySelectedChunkCount: 1,
          pendingSelectedChunkCount: 1,
          failedSelectedChunkCount: 0,
          missingSelectedChunkCount: 0,
          isComplete: false
        }
      });
      expect(partialSnapshot?.traceGraphData.name).toBe('graph:first');
      expect(partialSnapshot?.spanUrlCodec).toBe(spanUrlCodec);

      secondDeferred.resolve({value: 'second'});
      await ensurePromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses external span ids as the default store URL codec', () => {
    const externalSpanId = '6149800612493239450';
    const store = createStore([]);
    const traceGraphData = buildExternalSpanArrowTrace(externalSpanId);
    const spanRef = encodeSpanRef(0, 0);

    expect(store.spanUrlCodec).toBe(TRACE_EXTERNAL_SPAN_ID_URL_CODEC);
    expect(store.spanUrlCodec.serializeSpanRef({traceGraph: traceGraphData, spanRef})).toBe(
      externalSpanId
    );
    expect(
      store.spanUrlCodec.deserializeSpanRefs({traceGraph: traceGraphData, spanIds: []})
    ).toEqual([]);
    expect(
      store.spanUrlCodec.deserializeSpanRefs({
        traceGraph: traceGraphData,
        spanIds: [externalSpanId]
      })
    ).toEqual([spanRef]);
  });

  it('incrementally appends newly ready chunks when the registered-window selection stays stable', async () => {
    vi.useFakeTimers();
    try {
      const firstDeferred = createDeferred<StoredPayload>();
      const secondDeferred = createDeferred<StoredPayload>();
      const rebuild = vi.fn(createGraphRebuildMaterialization);
      const append = vi.fn(createGraphAppendMaterialization);
      const store = createGraphStore(
        [
          createDescriptor('first', 'head', 0, 10, 0, 10, 5),
          createDescriptor('second', 'logical', 0, 10, 0, 10, 5)
        ],
        {rebuild, append}
      );
      const ensurePromise = store.registerTraceWindows({
        windows: [{id: 'graph-window', minTimeMs: 0, maxTimeMs: 10}],
        loadChunk: vi
          .fn()
          .mockImplementationOnce(async () => firstDeferred.promise)
          .mockImplementationOnce(async () => secondDeferred.promise)
      });

      firstDeferred.resolve({value: 'first'});
      await flushTraceChunkStoreMicrotasks();
      expect(store.getTraceGraphForWindow('graph-window', null)?.traceGraphData.name).toBe(
        'graph:first'
      );

      secondDeferred.resolve({value: 'second'});
      await flushTraceChunkStoreMicrotasks();
      const completedSnapshot = store.getTraceGraphForWindow('graph-window', null);
      await ensurePromise;

      expect(rebuild).toHaveBeenCalledTimes(1);
      expect(append).toHaveBeenCalledTimes(1);
      expect(completedSnapshot).toMatchObject({
        windowId: 'graph-window',
        version: 2,
        materializationMode: 'append',
        readiness: {
          selectedChunkCount: 2,
          readySelectedChunkCount: 2,
          pendingSelectedChunkCount: 0,
          failedSelectedChunkCount: 0,
          missingSelectedChunkCount: 0,
          isComplete: true
        }
      });
      expect(completedSnapshot?.traceGraphData.name).toBe('graph:first,second');
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
  return new TraceChunkStore({
    identityKey: 'trace-test',
    descriptors,
    selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>()
  });
}

type GraphMaterializationState = {
  /** Stable ready chunk labels represented by the test graph snapshot. */
  chunkLabels: readonly string[];
};

/**
 * Create one chunk store configured with graph-window materialization test hooks.
 */
function createGraphStore(
  descriptors: readonly TestDescriptor[],
  materializer: TraceChunkWindowGraphMaterializer<
    StoredPayload,
    TestDescriptor,
    GraphMaterializationState
  >,
  spanUrlCodec?: TraceSpanUrlCodec
): TraceChunkStore<StoredPayload, TestDescriptor, GraphMaterializationState> {
  return new TraceChunkStore({
    identityKey: 'trace-graph-test',
    descriptors,
    selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestDescriptor>(),
    windowGraphMaterializer: materializer,
    spanUrlCodec
  });
}

/**
 * Create a minimal span URL codec used to verify window graph snapshots preserve configuration.
 */
function createTestSpanUrlCodec(): TraceSpanUrlCodec {
  return {
    serializeSpanRef: () => 'test-span',
    deserializeSpanRefs: () => []
  };
}

/**
 * Rebuild one deterministic empty Arrow graph whose name exposes the ready test chunk labels.
 */
function createGraphRebuildMaterialization(params: {
  /** Ready stored chunks passed through the generic store graph-rebuild path. */
  readyChunks: TraceChunkWindowGraphRebuildParams<StoredPayload, TestDescriptor>['readyChunks'];
}) {
  const chunkLabels = params.readyChunks.map(chunk => chunk.payload.value);
  return {
    state: {chunkLabels},
    traceGraphData: buildEmptyNamedArrowTrace(chunkLabels)
  };
}

/**
 * Append newly ready test chunk labels into one deterministic empty Arrow graph snapshot.
 */
function createGraphAppendMaterialization(params: {
  /** Previous caller-owned materialization state kept by the shared chunk store. */
  previousState: GraphMaterializationState;
  /** Newly ready stored chunks passed through the generic append path. */
  addedReadyChunks: TraceChunkWindowGraphAppendParams<
    StoredPayload,
    TestDescriptor,
    GraphMaterializationState
  >['addedReadyChunks'];
}) {
  const chunkLabels = [
    ...params.previousState.chunkLabels,
    ...params.addedReadyChunks.map(chunk => chunk.payload.value)
  ];
  return {
    state: {chunkLabels},
    traceGraphData: buildEmptyNamedArrowTrace(chunkLabels)
  };
}

/**
 * Build one structurally valid empty TraceGraphData with deterministic test-visible naming.
 */
function buildEmptyNamedArrowTrace(chunkLabels: readonly string[]) {
  return buildTraceGraphData({
    name: `graph:${chunkLabels.join(',')}`,
    processes: [],
    crossDependencies: [],
    spanTableMap: {}
  });
}

/**
 * Build one TraceGraphData with a row-level external span id for URL codec tests.
 */
function buildExternalSpanArrowTrace(externalSpanId: string) {
  const process = createArrowTraceProcessMetadata('rank-1', 0);
  return buildTraceGraphData({
    name: 'external-span-url-codec-test',
    processes: [process],
    crossDependencies: [],
    spanTableMap: {
      [process.processId]: buildArrowTraceSpanTableFromColumns({
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
      })
    } as Record<TraceProcessId, ReturnType<typeof buildArrowTraceSpanTableFromColumns>>,
    localDependencyTableMap: {
      [process.processId]: buildArrowTraceLocalDependencyTable([])
    } as Record<TraceProcessId, ReturnType<typeof buildArrowTraceLocalDependencyTable>>
  });
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
        localDependencies: [],
        remoteDependencies: []
      }
    ],
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
      duration_ms: [5, 5]
    }),
    localDependencyTable: buildArrowTraceLocalDependencyTable([]),
    sourceDependencyTable,
    rowWindowTable,
    diagnostics: {
      rowCount: 2,
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
 */
function createStoreLoadedTraceChunkData(
  chunkKey: string,
  processes: readonly ArrowTraceProcessMetadata[]
): TraceChunkData {
  const spanRowIndexes = processes.map((_, rowIndex) => rowIndex);
  return {
    type: 'trace-chunk-data',
    chunkKey,
    processes,
    spanTable: buildArrowTraceSpanTableFromColumns({
      process_ref: processes.map(process => encodeProcessRef(process.rankNum)),
      thread_ref: processes.map(process => encodeProcessThreadRef(process.rankNum, 0)),
      span_id: spanRowIndexes.map(rowIndex => `chunk-span-${rowIndex}`),
      external_span_id: spanRowIndexes.map(rowIndex =>
        rowIndex === 0 ? 'external-chunk-span' : `external-chunk-span-${rowIndex}`
      ),
      thread_id: processes.map(process => process.threads[0]?.threadId ?? 'thread-a'),
      name: spanRowIndexes.map(rowIndex => `chunk span ${rowIndex}`),
      source: spanRowIndexes.map(() => null),
      primary_timing_key: spanRowIndexes.map(() => 'primary'),
      status: spanRowIndexes.map(() => 'finished'),
      start_time_ms: spanRowIndexes.map(rowIndex => rowIndex),
      end_time_ms: spanRowIndexes.map(rowIndex => rowIndex + 1),
      duration_ms: spanRowIndexes.map(() => 1)
    }),
    localDependencyTable: buildArrowTraceLocalDependencyTable([]),
    diagnostics: {
      rowCount: processes.length,
      invalidRecordCount: 0,
      minTimeMs: processes.length > 0 ? 0 : null,
      maxTimeMs: processes.length,
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
