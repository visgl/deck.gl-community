import {encodeProcessRef, encodeProcessThreadRef} from './trace-id-encoder';

import type {ProcessRef, ThreadRef} from './trace-id-encoder';
import type {TraceProcess, TraceProcessId, TraceThread, TraceThreadId} from './trace-types';

/**
 * Trace-global process metadata kept beside one append-only owner-ref slot.
 */
export type TraceOwnerProcessMetadata = Pick<
  TraceProcess,
  'type' | 'processId' | 'name' | 'tags' | 'processOrder' | 'stepNum' | 'userData'
>;

/**
 * Trace-global process metadata materialized in stable owner-ref slot order.
 */
export type TraceOwnerProcessSnapshot = TraceOwnerProcessMetadata & {
  /** Stable append-only process slot reused by packed runtime refs. */
  readonly rankNum: number;
  /** Trace-global threads currently known for this process in append-only thread-ref slot order. */
  readonly threads: readonly TraceThread[];
  /** Trace-global thread metadata keyed by ingestion thread id. */
  readonly threadMap: Readonly<Record<TraceThreadId, TraceThread>>;
};

/**
 * Immutable trace-global process/thread owner-ref tables captured for one graph snapshot.
 */
export type TraceOwnerRefSnapshot = {
  /** Canonical process refs in append-only trace-global slot order. */
  readonly processRefs: readonly ProcessRef[];
  /** Canonical thread refs in append-only trace-global slot order. */
  readonly threadRefs: readonly ThreadRef[];
  /** Process-ref lookup keyed by ingestion process id. */
  readonly processRefById: ReadonlyMap<TraceProcessId, ProcessRef>;
  /** Ingestion process id lookup keyed by canonical process ref. */
  readonly processIdByRef: ReadonlyMap<ProcessRef, TraceProcessId>;
  /** Thread-ref lookup keyed by ingestion thread id. */
  readonly threadRefById: ReadonlyMap<TraceThreadId, ThreadRef>;
  /** Ingestion thread id lookup keyed by canonical thread ref. */
  readonly threadIdByRef: ReadonlyMap<ThreadRef, TraceThreadId>;
  /** Owning process ref keyed by canonical thread ref. */
  readonly processRefByThreadRef: ReadonlyMap<ThreadRef, ProcessRef>;
  /** Owning process ref keyed by ingestion thread id. */
  readonly processRefByThreadId: ReadonlyMap<TraceThreadId, ProcessRef>;
  /** Canonical thread refs grouped by their owning process ref. */
  readonly threadRefsByProcessRef: ReadonlyMap<ProcessRef, readonly ThreadRef[]>;
  /** Ingestion process ids indexed by append-only process-ref slot. */
  readonly processIdsByIndex: readonly TraceProcessId[];
};

type TraceOwnerProcessRecord = {
  /** Latest caller-owned metadata kept for this stable process slot. */
  metadata: TraceOwnerProcessMetadata;
  /** Canonical append-only process ref for this process id. */
  processRef: ProcessRef;
  /** Stable process-scoped thread keys in append-only slot order within this process. */
  threadKeys: string[];
};

type TraceOwnerThreadRecord = {
  /** Latest caller-owned metadata kept for this stable thread slot. */
  metadata: TraceThread;
  /** Canonical append-only thread ref for this thread id. */
  threadRef: ThreadRef;
  /** Owning append-only process ref. */
  processRef: ProcessRef;
};

/**
 * Mutable append-only registry that assigns trace-global owner refs for one trace identity.
 */
export class TraceOwnerRefRegistry {
  private readonly processRecordsById = new Map<TraceProcessId, TraceOwnerProcessRecord>();
  private readonly processIdsByIndex: TraceProcessId[] = [];
  private readonly threadRecordsByKey = new Map<string, TraceOwnerThreadRecord>();
  private readonly firstThreadRecordById = new Map<TraceThreadId, TraceOwnerThreadRecord>();

  /**
   * Allocate or update one stable process owner slot without changing its assigned ref.
   */
  upsertProcess(metadata: Readonly<TraceOwnerProcessMetadata>): ProcessRef {
    const processId = metadata.processId as TraceProcessId;
    const existing = this.processRecordsById.get(processId);
    if (existing) {
      existing.metadata = cloneTraceOwnerProcessMetadata(metadata);
      return existing.processRef;
    }

    const processIndex = this.processIdsByIndex.length;
    const processRef = encodeProcessRef(processIndex);
    this.processIdsByIndex.push(processId);
    this.processRecordsById.set(processId, {
      metadata: cloneTraceOwnerProcessMetadata(metadata),
      processRef,
      threadKeys: []
    });
    return processRef;
  }

  /**
   * Allocate or update one stable thread owner slot without changing its assigned ref.
   */
  upsertThread(thread: Readonly<TraceThread>): ThreadRef {
    const threadId = thread.threadId as TraceThreadId;
    const processId = thread.processId as TraceProcessId;
    const processRecord = this.processRecordsById.get(processId);
    if (!processRecord) {
      throw new Error(`Cannot register trace thread ${threadId} before process ${processId}.`);
    }

    const threadKey = buildTraceOwnerThreadKey(processId, threadId);
    const existing = this.threadRecordsByKey.get(threadKey);
    if (existing) {
      existing.metadata = cloneTraceThread(thread);
      return existing.threadRef;
    }

    const threadRef = encodeProcessThreadRef(
      this.processIdsByIndex.indexOf(processId),
      processRecord.threadKeys.length
    );
    processRecord.threadKeys.push(threadKey);
    const threadRecord = {
      metadata: cloneTraceThread(thread),
      threadRef,
      processRef: processRecord.processRef
    } satisfies TraceOwnerThreadRecord;
    this.threadRecordsByKey.set(threadKey, threadRecord);
    if (!this.firstThreadRecordById.has(threadId)) {
      this.firstThreadRecordById.set(threadId, threadRecord);
    }
    return threadRef;
  }

  /**
   * Return one already allocated trace-global process ref when the process is known.
   */
  getProcessRef(processId: TraceProcessId): ProcessRef | null {
    return this.processRecordsById.get(processId)?.processRef ?? null;
  }

  /**
   * Return one already allocated trace-global thread ref when the thread is known.
   */
  getThreadRef(threadId: TraceThreadId): ThreadRef | null {
    return this.firstThreadRecordById.get(threadId)?.threadRef ?? null;
  }

  /**
   * Return one already allocated trace-global thread ref for a process-scoped thread id.
   */
  getProcessThreadRef(processId: TraceProcessId, threadId: TraceThreadId): ThreadRef | null {
    return (
      this.threadRecordsByKey.get(buildTraceOwnerThreadKey(processId, threadId))?.threadRef ?? null
    );
  }

  /**
   * Materialize currently known process/thread metadata in append-only process slot order.
   */
  getOwnerProcessSnapshots(): readonly TraceOwnerProcessSnapshot[] {
    return this.processIdsByIndex.flatMap((processId, rankNum) => {
      const processRecord = this.processRecordsById.get(processId);
      if (!processRecord) {
        return [];
      }
      const threads = processRecord.threadKeys.flatMap(threadKey => {
        const thread = this.threadRecordsByKey.get(threadKey)?.metadata;
        return thread ? [cloneTraceThread(thread)] : [];
      });
      return [
        {
          ...cloneTraceOwnerProcessMetadata(processRecord.metadata),
          rankNum,
          threads,
          threadMap: Object.fromEntries(
            threads.map(thread => [thread.threadId, thread] as const)
          ) as Readonly<Record<TraceThreadId, TraceThread>>
        }
      ];
    });
  }

  /**
   * Capture immutable trace-global owner-ref lookup tables for one Arrow/TraceGraph snapshot.
   */
  createSnapshot(): TraceOwnerRefSnapshot {
    const processRefs: ProcessRef[] = [];
    const threadRefs: ThreadRef[] = [];
    const processRefById = new Map<TraceProcessId, ProcessRef>();
    const processIdByRef = new Map<ProcessRef, TraceProcessId>();
    const threadRefById = new Map<TraceThreadId, ThreadRef>();
    const threadIdByRef = new Map<ThreadRef, TraceThreadId>();
    const processRefByThreadRef = new Map<ThreadRef, ProcessRef>();
    const processRefByThreadId = new Map<TraceThreadId, ProcessRef>();
    const threadRefsByProcessRef = new Map<ProcessRef, readonly ThreadRef[]>();

    this.processIdsByIndex.forEach(processId => {
      const processRecord = this.processRecordsById.get(processId);
      if (!processRecord) {
        return;
      }
      const processThreadRefs: ThreadRef[] = [];
      processRefs.push(processRecord.processRef);
      processRefById.set(processId, processRecord.processRef);
      processIdByRef.set(processRecord.processRef, processId);
      processRecord.threadKeys.forEach(threadKey => {
        const threadRecord = this.threadRecordsByKey.get(threadKey);
        if (!threadRecord) {
          return;
        }
        const threadId = threadRecord.metadata.threadId as TraceThreadId;
        threadRefs.push(threadRecord.threadRef);
        processThreadRefs.push(threadRecord.threadRef);
        if (!threadRefById.has(threadId)) {
          threadRefById.set(threadId, threadRecord.threadRef);
        }
        threadIdByRef.set(threadRecord.threadRef, threadId);
        processRefByThreadRef.set(threadRecord.threadRef, processRecord.processRef);
        if (!processRefByThreadId.has(threadId)) {
          processRefByThreadId.set(threadId, processRecord.processRef);
        }
      });
      threadRefsByProcessRef.set(processRecord.processRef, processThreadRefs);
    });

    return {
      processRefs,
      threadRefs,
      processRefById,
      processIdByRef,
      threadRefById,
      threadIdByRef,
      processRefByThreadRef,
      processRefByThreadId,
      threadRefsByProcessRef,
      processIdsByIndex: [...this.processIdsByIndex]
    };
  }
}

/**
 * Build one process-scoped storage key so duplicate ingestion thread ids do not alias owners.
 */
function buildTraceOwnerThreadKey(processId: TraceProcessId, threadId: TraceThreadId): string {
  return `${processId}\u0000${threadId}`;
}

/**
 * Clone caller-owned process metadata before retaining it in the long-lived owner registry.
 */
function cloneTraceOwnerProcessMetadata(
  metadata: Readonly<TraceOwnerProcessMetadata>
): TraceOwnerProcessMetadata {
  return {
    type: metadata.type,
    processId: metadata.processId,
    name: metadata.name,
    tags: metadata.tags ? [...metadata.tags] : undefined,
    processOrder: metadata.processOrder,
    stepNum: metadata.stepNum,
    userData: metadata.userData ? {...metadata.userData} : undefined
  };
}

/**
 * Clone caller-owned thread metadata before retaining it in the long-lived owner registry.
 */
function cloneTraceThread(thread: Readonly<TraceThread>): TraceThread {
  return {
    type: thread.type,
    processId: thread.processId,
    threadId: thread.threadId,
    name: thread.name
  };
}
