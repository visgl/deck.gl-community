import {
  encodeCounterRef,
  encodeEventRef,
  encodeInstantRef,
  isCounterRef,
  isEventRef,
  isInstantRef
} from './trace-id-encoder';
import {TraceOwnerRefRegistry} from './trace-owner-ref-registry';

import type {TraceGraphData} from '../ingestion/arrow-trace';
import type {CounterRef, EventRef, InstantRef, ProcessRef, ThreadRef} from './trace-id-encoder';
import type {TraceOwnerRefSnapshot} from './trace-owner-ref-registry';
import type {
  TraceCounterId,
  TraceEventId,
  TraceInstantId,
  TraceProcessId,
  TraceThreadId
} from './trace-types';

/** Graph-local ref tables that bridge ingestion ids to canonical runtime refs. */
export type TraceRuntimeEntityRefs = {
  /** Canonical process refs in graph order. */
  readonly processRefs: readonly ProcessRef[];
  /** Canonical thread refs in graph order. */
  readonly threadRefs: readonly ThreadRef[];
  /** Canonical event refs in graph order. */
  readonly eventRefs: readonly EventRef[];
  /** Canonical instant refs in graph order. */
  readonly instantRefs: readonly InstantRef[];
  /** Canonical counter refs in graph order. */
  readonly counterRefs: readonly CounterRef[];
  /** Process-ref lookup keyed by ingestion process id. */
  readonly processRefById: ReadonlyMap<TraceProcessId, ProcessRef>;
  /** Ingestion process id lookup keyed by process ref. */
  readonly processIdByRef: ReadonlyMap<ProcessRef, TraceProcessId>;
  /** Thread-ref lookup keyed by ingestion thread id. */
  readonly threadRefById: ReadonlyMap<TraceThreadId, ThreadRef>;
  /** Ingestion thread id lookup keyed by thread ref. */
  readonly threadIdByRef: ReadonlyMap<ThreadRef, TraceThreadId>;
  /** Owning process ref keyed by thread ref. */
  readonly processRefByThreadRef: ReadonlyMap<ThreadRef, ProcessRef>;
  /** Owning process ref keyed by ingestion thread id. */
  readonly processRefByThreadId: ReadonlyMap<TraceThreadId, ProcessRef>;
  /** Canonical thread refs grouped by owning process ref. */
  readonly threadRefsByProcessRef: ReadonlyMap<ProcessRef, readonly ThreadRef[]>;
  /** Event-ref lookup keyed by ingestion event id. */
  readonly eventRefById: ReadonlyMap<TraceEventId, EventRef>;
  /** Ingestion event id lookup keyed by event ref. */
  readonly eventIdByRef: ReadonlyMap<EventRef, TraceEventId>;
  /** Instant-ref lookup keyed by ingestion instant id. */
  readonly instantRefById: ReadonlyMap<TraceInstantId, InstantRef>;
  /** Ingestion instant id lookup keyed by instant ref. */
  readonly instantIdByRef: ReadonlyMap<InstantRef, TraceInstantId>;
  /** Counter-ref lookup keyed by ingestion counter id. */
  readonly counterRefById: ReadonlyMap<TraceCounterId, CounterRef>;
  /** Ingestion counter id lookup keyed by counter ref. */
  readonly counterIdByRef: ReadonlyMap<CounterRef, TraceCounterId>;
  /** Owning thread ref keyed by instant ref. */
  readonly threadRefByInstantRef: ReadonlyMap<InstantRef, ThreadRef>;
  /** Owning thread ref keyed by ingestion instant id. */
  readonly threadRefByInstantId: ReadonlyMap<TraceInstantId, ThreadRef>;
  /** Owning thread ref keyed by counter ref. */
  readonly threadRefByCounterRef: ReadonlyMap<CounterRef, ThreadRef>;
  /** Owning thread ref keyed by ingestion counter id. */
  readonly threadRefByCounterId: ReadonlyMap<TraceCounterId, ThreadRef>;
  /** Owning process ref keyed by instant ref. */
  readonly processRefByInstantRef: ReadonlyMap<InstantRef, ProcessRef>;
  /** Owning process ref keyed by counter ref. */
  readonly processRefByCounterRef: ReadonlyMap<CounterRef, ProcessRef>;
};

/** Builds canonical graph-local entity-ref tables from Arrow-backed runtime tables. */
export function buildTraceRuntimeEntityRefs(
  traceGraphTables: Readonly<TraceGraphData>
): TraceRuntimeEntityRefs {
  const ownerRefSnapshot =
    traceGraphTables.ownerRefSnapshot ?? buildGraphLocalTraceOwnerRefSnapshot(traceGraphTables);
  const processRefs = [...ownerRefSnapshot.processRefs];
  const threadRefs = [...ownerRefSnapshot.threadRefs];
  const eventRefs: EventRef[] = [];
  const instantRefs: InstantRef[] = [];
  const counterRefs: CounterRef[] = [];
  const usedEventRefs = new Set<EventRef>();
  const usedInstantRefs = new Set<InstantRef>();
  const usedCounterRefs = new Set<CounterRef>();

  const processRefById = new Map(ownerRefSnapshot.processRefById);
  const processIdByRef = new Map(ownerRefSnapshot.processIdByRef);
  const threadRefById = new Map(ownerRefSnapshot.threadRefById);
  const threadIdByRef = new Map(ownerRefSnapshot.threadIdByRef);
  const processRefByThreadRef = new Map(ownerRefSnapshot.processRefByThreadRef);
  const processRefByThreadId = new Map(ownerRefSnapshot.processRefByThreadId);
  const threadRefsByProcessRef = new Map(ownerRefSnapshot.threadRefsByProcessRef);
  const eventRefById = new Map<TraceEventId, EventRef>();
  const eventIdByRef = new Map<EventRef, TraceEventId>();
  const instantRefById = new Map<TraceInstantId, InstantRef>();
  const instantIdByRef = new Map<InstantRef, TraceInstantId>();
  const counterRefById = new Map<TraceCounterId, CounterRef>();
  const counterIdByRef = new Map<CounterRef, TraceCounterId>();
  const threadRefByInstantRef = new Map<InstantRef, ThreadRef>();
  const threadRefByInstantId = new Map<TraceInstantId, ThreadRef>();
  const threadRefByCounterRef = new Map<CounterRef, ThreadRef>();
  const threadRefByCounterId = new Map<TraceCounterId, ThreadRef>();
  const processRefByInstantRef = new Map<InstantRef, ProcessRef>();
  const processRefByCounterRef = new Map<CounterRef, ProcessRef>();

  traceGraphTables.processes.forEach(process => {
    const processId = process.processId as TraceProcessId;
    const processRef = processRefById.get(processId);
    if (processRef == null) {
      return;
    }

    process.threads.forEach(thread => {
      const threadRef = findThreadRefForProcess({
        ownerRefSnapshot,
        processRef,
        threadId: thread.threadId
      });
      if (threadRef == null) {
        return;
      }

      for (const instant of traceGraphTables.threadInstantMap[thread.threadId] ?? []) {
        const instantRef =
          instant.instantRef != null &&
          isInstantRef(instant.instantRef) &&
          !usedInstantRefs.has(instant.instantRef)
            ? instant.instantRef
            : allocateNextUniqueRuntimeEntityRef(
                usedInstantRefs,
                instantRefs.length,
                encodeInstantRef
              );
        usedInstantRefs.add(instantRef);
        instantRefs.push(instantRef);
        instantRefById.set(instant.instantId, instantRef);
        instantIdByRef.set(instantRef, instant.instantId);
        threadRefByInstantRef.set(instantRef, threadRef);
        threadRefByInstantId.set(instant.instantId, threadRef);
        processRefByInstantRef.set(instantRef, processRef);
      }

      for (const counter of traceGraphTables.threadCounterMap[thread.threadId] ?? []) {
        const counterRef =
          counter.counterRef != null &&
          isCounterRef(counter.counterRef) &&
          !usedCounterRefs.has(counter.counterRef)
            ? counter.counterRef
            : allocateNextUniqueRuntimeEntityRef(
                usedCounterRefs,
                counterRefs.length,
                encodeCounterRef
              );
        usedCounterRefs.add(counterRef);
        counterRefs.push(counterRef);
        counterRefById.set(counter.counterId, counterRef);
        counterIdByRef.set(counterRef, counter.counterId);
        threadRefByCounterRef.set(counterRef, threadRef);
        threadRefByCounterId.set(counter.counterId, threadRef);
        processRefByCounterRef.set(counterRef, processRef);
      }
    });
  });

  const eventRefColumn = traceGraphTables.events.getChild('eventRef');
  const eventIdColumn = traceGraphTables.events.getChild('eventId');
  for (let rowIndex = 0; rowIndex < traceGraphTables.events.numRows; rowIndex += 1) {
    const eventId = eventIdColumn?.get(rowIndex) as TraceEventId | null;
    if (!eventId) {
      continue;
    }
    const storedEventRefValue = Number(eventRefColumn?.get(rowIndex) ?? Number.NaN);
    const eventRef =
      isEventRef(storedEventRefValue) && !usedEventRefs.has(storedEventRefValue)
        ? storedEventRefValue
        : allocateNextUniqueRuntimeEntityRef(usedEventRefs, eventRefs.length, encodeEventRef);
    usedEventRefs.add(eventRef);
    eventRefs.push(eventRef);
    eventRefById.set(eventId, eventRef);
    eventIdByRef.set(eventRef, eventId);
  }

  return {
    processRefs,
    threadRefs,
    eventRefs,
    instantRefs,
    counterRefs,
    processRefById,
    processIdByRef,
    threadRefById,
    threadIdByRef,
    processRefByThreadRef,
    processRefByThreadId,
    threadRefsByProcessRef,
    eventRefById,
    eventIdByRef,
    instantRefById,
    instantIdByRef,
    counterRefById,
    counterIdByRef,
    threadRefByInstantRef,
    threadRefByInstantId,
    threadRefByCounterRef,
    threadRefByCounterId,
    processRefByInstantRef,
    processRefByCounterRef
  };
}

/**
 * Resolve one process-scoped thread ref without assuming ingestion thread ids are graph-global.
 */
function findThreadRefForProcess(params: {
  /** Trace-global owner refs kept for the current graph snapshot. */
  ownerRefSnapshot: Readonly<TraceOwnerRefSnapshot>;
  /** Owning process ref for the desired thread. */
  processRef: ProcessRef;
  /** Ingestion thread id to match within the process. */
  threadId: TraceThreadId;
}): ThreadRef | null {
  for (const threadRef of params.ownerRefSnapshot.threadRefsByProcessRef.get(params.processRef) ??
    []) {
    if (params.ownerRefSnapshot.threadIdByRef.get(threadRef) === params.threadId) {
      return threadRef;
    }
  }
  return null;
}

/**
 * Allocates the next unused legacy graph-local entity ref without colliding with supplied refs.
 */
function allocateNextUniqueRuntimeEntityRef<RefT extends number>(
  usedRefs: ReadonlySet<RefT>,
  startingIndex: number,
  encodeRef: (index: number) => RefT
): RefT {
  let index = startingIndex;
  for (;;) {
    const ref = encodeRef(index);
    if (!usedRefs.has(ref)) {
      return ref;
    }
    index += 1;
  }
}

/**
 * Build legacy graph-local owner refs when a TraceGraphData has no shared preallocated owner table.
 */
function buildGraphLocalTraceOwnerRefSnapshot(
  traceGraphTables: Readonly<TraceGraphData>
): TraceOwnerRefSnapshot {
  const registry = new TraceOwnerRefRegistry();
  traceGraphTables.processes.forEach(process => {
    registry.upsertProcess(process);
    process.threads.forEach(thread => {
      registry.upsertThread({
        ...thread,
        processId: thread.processId ?? process.processId
      });
    });
  });
  return registry.createSnapshot();
}
