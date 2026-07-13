import {describe, expect, it} from 'vitest';

import {buildJSONTrace} from '../ingestion/json-trace';
import {TraceGraph} from './trace-graph';
import {
  createDatasetRuntimeTraceGraphForTest,
  createTraceDatasetFromJSONTraceForTest
} from './trace-graph-test-fixtures';
import {TraceOwnerRefRegistry} from './trace-owner-ref-registry';
import {brand} from './trace-types';

import type {ArrowTraceProcessMetadata} from '../ingestion/arrow-trace';
import type {TraceDataset} from '../trace-dataset';
import type {TraceThreadId} from './trace-types';

function createTestTraceGraph(
  traceDataset: TraceDataset,
  options?: Parameters<typeof createDatasetRuntimeTraceGraphForTest>[1]
): TraceGraph {
  return createDatasetRuntimeTraceGraphForTest(traceDataset, options);
}

describe('TraceOwnerRefRegistry', () => {
  it('preserves owner refs while appending owners and allows TraceGraph to reuse the snapshot', () => {
    const processAId = brand<'rank', string>('process/a');
    const processBId = brand<'rank', string>('process/b');
    const threadAId = brand<'stream', string>('process/a/thread/a');
    const threadBId = brand<'stream', string>('process/b/thread/b');
    const registry = new TraceOwnerRefRegistry();

    const processARef = registry.upsertProcess({
      type: 'trace-process',
      processId: processAId,
      name: 'Process A',
      stepNum: 0
    });
    const threadARef = registry.upsertThread({
      type: 'trace-thread',
      processId: processAId,
      threadId: threadAId,
      name: 'Thread A'
    });
    const firstSnapshot = registry.createSnapshot();

    registry.upsertProcess({
      type: 'trace-process',
      processId: processAId,
      name: 'Process A updated',
      processOrder: 4,
      stepNum: 0
    });
    registry.upsertProcess({
      type: 'trace-process',
      processId: processBId,
      name: 'Process B',
      processOrder: 0,
      stepNum: 0
    });
    const threadBRef = registry.upsertThread({
      type: 'trace-thread',
      processId: processBId,
      threadId: threadBId,
      name: 'Thread B'
    });
    const secondSnapshot = registry.createSnapshot();
    const ownerProcesses = registry.getOwnerProcessSnapshots();
    const processes = ownerProcesses.map(
      (process): ArrowTraceProcessMetadata => ({
        ...process,
        threads: [...process.threads],
        threadMap: {...process.threadMap},
        instants: [],
        instantMap: {},
        threadInstantMap: {},
        counters: [],
        counterMap: {},
        threadCounterMap: {},
        remoteDependencies: []
      })
    );
    const emptyTraceDataset = createTraceDatasetFromJSONTraceForTest(
      buildJSONTrace([], [], {name: 'owner-ref-registry-test'})
    );
    const traceDataset = {
      ...emptyTraceDataset,
      processes,
      ownerRefSnapshot: secondSnapshot,
      stats: {
        ...emptyTraceDataset.stats,
        processCount: processes.length,
        threadCount: processes.reduce((count, process) => count + process.threads.length, 0)
      }
    } satisfies TraceDataset;
    const traceGraph = createTestTraceGraph(traceDataset);

    expect(firstSnapshot.processRefById.get(processAId)).toBe(processARef);
    expect(firstSnapshot.threadRefById.get(threadAId)).toBe(threadARef);
    expect(secondSnapshot.processRefById.get(processAId)).toBe(processARef);
    expect(secondSnapshot.threadRefById.get(threadAId)).toBe(threadARef);
    expect(secondSnapshot.processRefById.get(processBId)).not.toBe(processARef);
    expect(secondSnapshot.threadRefById.get(threadBId)).toBe(threadBRef);
    expect(ownerProcesses.map(process => process.rankNum)).toEqual([0, 1]);
    expect(ownerProcesses.map(process => process.name)).toEqual(['Process A updated', 'Process B']);
    expect(traceDataset.ownerRefSnapshot.processIdsByIndex).toEqual([processAId, processBId]);
    expect(traceGraph.getProcessRefs()).toEqual(secondSnapshot.processRefs);
    expect(traceGraph.getThreadRefs()).toEqual(secondSnapshot.threadRefs);
  });

  it('keeps duplicate ingestion thread ids distinct across processes', () => {
    const processAId = brand<'rank', string>('process/a');
    const processBId = brand<'rank', string>('process/b');
    const sharedThreadId = brand<'stream', string>('shared-thread');
    const registry = new TraceOwnerRefRegistry();

    const processARef = registry.upsertProcess({
      type: 'trace-process',
      processId: processAId,
      name: 'Process A',
      stepNum: 0
    });
    const processBRef = registry.upsertProcess({
      type: 'trace-process',
      processId: processBId,
      name: 'Process B',
      stepNum: 0
    });
    const threadARef = registry.upsertThread({
      type: 'trace-thread',
      processId: processAId,
      threadId: sharedThreadId as TraceThreadId,
      name: 'Thread A'
    });
    const threadBRef = registry.upsertThread({
      type: 'trace-thread',
      processId: processBId,
      threadId: sharedThreadId as TraceThreadId,
      name: 'Thread B'
    });
    const snapshot = registry.createSnapshot();

    expect(threadARef).not.toBe(threadBRef);
    expect(snapshot.threadRefsByProcessRef.get(processARef)).toEqual([threadARef]);
    expect(snapshot.threadRefsByProcessRef.get(processBRef)).toEqual([threadBRef]);
    expect(snapshot.threadIdByRef.get(threadARef)).toBe(sharedThreadId);
    expect(snapshot.threadIdByRef.get(threadBRef)).toBe(sharedThreadId);
  });
});
