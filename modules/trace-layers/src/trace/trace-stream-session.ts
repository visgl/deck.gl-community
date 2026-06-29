import {
  buildArrowTraceEventTableFromRows,
  buildTraceGraphData,
  buildTraceSpanSidecarsByProcessId,
  buildTraceSpanTablesByProcessId
} from './ingestion/arrow-trace';
import {createStaticTraceGraphRuntimeSource} from './trace-chunk-store';
import {TraceGraph} from './trace-graph/trace-graph';
import {
  encodeSpanRef,
  encodeVisibleCrossDependencyRef,
  encodeVisibleLocalDependencyRef
} from './trace-graph/trace-id-encoder';

import type {TraceGraphData} from './ingestion/arrow-trace';
import type {
  SpanRef,
  TraceCounter,
  TraceCrossProcessDependency,
  TraceEvent,
  TraceInstant,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceThread
} from './trace-graph/trace-types';

/**
 * Minimal metadata used to create or update one streamed process without replacing the whole trace.
 */
export type TraceStreamProcessUpsert = {
  /** Stable process identifier. */
  processId: string;
  /** Human-readable process label. */
  name: string;
  /** Stable first-seen process order. */
  rankNum?: number;
  /** Optional step number preserved in the published snapshot. */
  stepNum?: number;
  /** Optional semantic tags used by app-owned filtering or presets. */
  tags?: string[];
  /** Optional process metadata preserved in the published snapshot. */
  userData?: Record<string, unknown>;
};

/**
 * One streamed thread upsert belonging to an existing or newly created process.
 */
export type TraceStreamThreadUpsert = {
  /** Owning process identifier. */
  processId: string;
  /** Thread metadata preserved in the published snapshot. */
  thread: TraceThread;
};

/**
 * One streamed span update belonging to an existing or newly created process.
 */
export type TraceStreamSpanUpdate = {
  /** Owning process identifier. */
  processId: string;
  /** Span data preserved in the published snapshot. */
  span: TraceSpan;
};

/**
 * One streamed local dependency update belonging to an existing or newly created process.
 */
export type TraceStreamLocalDependencyUpdate = {
  /** Owning process identifier. */
  processId: string;
  /** Dependency data preserved in the published snapshot. */
  dependency: TraceLocalDependency;
};

/**
 * One streamed instant update belonging to an existing or newly created process.
 */
export type TraceStreamInstantUpdate = {
  /** Owning process identifier. */
  processId: string;
  /** Instant data preserved in the published snapshot. */
  instant: TraceInstant;
};

/**
 * One streamed counter update belonging to an existing or newly created process.
 */
export type TraceStreamCounterUpdate = {
  /** Owning process identifier. */
  processId: string;
  /** Counter data preserved in the published snapshot. */
  counter: TraceCounter;
};

/**
 * Full immutable snapshot payload used by sources that prefer replace-style publishing.
 */
export type TraceStreamReplaceSnapshot = {
  /** Human-readable trace/session name. */
  name: string;
  /** Immutable process list that should replace current mutable state. */
  processes: ReadonlyArray<TraceProcess>;
  /** Immutable cross-process dependency list that should replace current mutable state. */
  crossDependencies: ReadonlyArray<TraceCrossProcessDependency>;
  /** Optional immutable graph-global events that should replace current mutable state. */
  events?: ReadonlyArray<TraceEvent>;
};

/**
 * Normalized streaming chunk applied into one live trace session.
 */
export type TraceStreamChunk = {
  /** Optional session name override. */
  name?: string;
  /** Optional full-state replacement before any append/upsert operations are applied. */
  replaceSnapshot?: TraceStreamReplaceSnapshot;
  /** Process metadata upserts. */
  processUpserts?: ReadonlyArray<TraceStreamProcessUpsert>;
  /** Thread metadata upserts. */
  threadUpserts?: ReadonlyArray<TraceStreamThreadUpsert>;
  /** Span append operations. Existing ids are ignored when append-only behavior is requested. */
  appendSpans?: ReadonlyArray<TraceStreamSpanUpdate>;
  /** Span upserts keyed by block id. */
  upsertSpans?: ReadonlyArray<TraceStreamSpanUpdate>;
  /** Local dependency append operations. Existing ids are ignored when append-only behavior is requested. */
  appendLocalDependencies?: ReadonlyArray<TraceStreamLocalDependencyUpdate>;
  /** Local dependency upserts keyed by dependency id. */
  upsertLocalDependencies?: ReadonlyArray<TraceStreamLocalDependencyUpdate>;
  /** Cross-process dependency append operations. Existing ids are ignored when append-only behavior is requested. */
  appendCrossDependencies?: ReadonlyArray<TraceCrossProcessDependency>;
  /** Cross-process dependency upserts keyed by dependency id. */
  upsertCrossDependencies?: ReadonlyArray<TraceCrossProcessDependency>;
  /** Instant append operations. Existing ids are ignored when append-only behavior is requested. */
  appendInstants?: ReadonlyArray<TraceStreamInstantUpdate>;
  /** Instant upserts keyed by instant id. */
  upsertInstants?: ReadonlyArray<TraceStreamInstantUpdate>;
  /** Counter append operations. Existing ids are ignored when append-only behavior is requested. */
  appendCounters?: ReadonlyArray<TraceStreamCounterUpdate>;
  /** Counter upserts keyed by counter id. */
  upsertCounters?: ReadonlyArray<TraceStreamCounterUpdate>;
  /** Event append operations. Existing ids are ignored when append-only behavior is requested. */
  appendEvents?: ReadonlyArray<TraceEvent>;
  /** Event upserts keyed by event id. */
  upsertEvents?: ReadonlyArray<TraceEvent>;
};

/**
 * Immutable snapshot published by a live trace session.
 */
export type TraceStreamPublishedSnapshot = {
  /** Monotonic snapshot sequence. */
  sequence: number;
  /** Canonical TraceGraphData snapshot used by runtime consumers. */
  traceGraphData: TraceGraphData;
  /** Canonical runtime graph built from the published Arrow snapshot. */
  traceGraph: TraceGraph;
};

/**
 * Listener invoked whenever a live trace session publishes a new immutable snapshot.
 */
export type TraceStreamSessionListener = (
  snapshot: TraceStreamPublishedSnapshot
) => void | Promise<void>;

/**
 * Options for creating one live trace session.
 */
export type TraceStreamSessionOptions = {
  /** Human-readable session name used until a chunk or replacement snapshot overrides it. */
  name?: string;
  /** Minimum delay before a scheduled publish flushes dirty state into an immutable snapshot. */
  publishIntervalMs?: number;
};

/**
 * Mutable live trace session that accepts normalized append/upsert chunks and publishes immutable snapshots.
 */
export type TraceStreamSession = {
  /** Apply one normalized streaming chunk into mutable state and schedule publication when dirty. */
  applyChunk: (chunk: TraceStreamChunk) => void;
  /** Force publication of the latest dirty state and return the current immutable snapshot. */
  publishSnapshot: () => TraceStreamPublishedSnapshot | null;
  /** Read the latest published immutable snapshot when one exists. */
  getPublishedSnapshot: () => TraceStreamPublishedSnapshot | null;
  /** Subscribe to published snapshots. */
  subscribe: (listener: TraceStreamSessionListener) => () => void;
  /** Close the session and cancel any pending scheduled publish. */
  close: () => void;
};

/**
 * Create one additive live trace session that publishes immutable `TraceGraphData` and `TraceGraph` snapshots.
 */
export function createTraceStreamSession(
  options: TraceStreamSessionOptions = {}
): TraceStreamSession {
  const state = createTraceStreamSessionState(options);

  return {
    applyChunk: chunk => {
      assertTraceStreamSessionOpen(state);
      applyTraceStreamChunk(state, chunk);
      scheduleTraceStreamPublish(state);
    },
    publishSnapshot: () => {
      assertTraceStreamSessionOpen(state);
      return publishTraceStreamSnapshot(state);
    },
    getPublishedSnapshot: () => state.publishedSnapshot,
    subscribe: listener => {
      assertTraceStreamSessionOpen(state);
      state.listeners.add(listener);
      const snapshot = state.publishedSnapshot;
      if (snapshot) {
        void listener(snapshot);
      }
      return () => {
        state.listeners.delete(listener);
      };
    },
    close: () => {
      if (state.publishTimer != null) {
        clearTimeout(state.publishTimer);
      }
      state.publishTimer = null;
      state.closed = true;
      state.listeners.clear();
    }
  };
}

/**
 * Create a full replacement chunk from an immutable trace snapshot.
 */
export function createTraceStreamReplaceChunk(
  snapshot: TraceStreamReplaceSnapshot
): TraceStreamChunk {
  return {
    name: snapshot.name,
    replaceSnapshot: snapshot
  };
}

type MutableProcessState = {
  /** Stable process identifier. */
  processId: string;
  /** Stable first-seen process order. */
  rankNum: number;
  /** Mutable process metadata. */
  process: TraceProcess;
  /** Block row indexes keyed by stable block id. */
  blockIndexById: Map<string, number>;
  /** Local dependency row indexes keyed by stable dependency id. */
  localDependencyIndexById: Map<string, number>;
  /** Instant row indexes keyed by stable instant id. */
  instantIndexById: Map<string, number>;
  /** Counter row indexes keyed by stable counter id. */
  counterIndexById: Map<string, number>;
};

type TraceStreamSessionState = {
  /** Human-readable session name. */
  name: string;
  /** Minimum publish interval. */
  publishIntervalMs: number;
  /** Whether the session has been closed. */
  closed: boolean;
  /** Current mutable processes keyed by stable process id. */
  processesById: Map<string, MutableProcessState>;
  /** Stable process order. */
  processOrder: string[];
  /** Cross dependency row indexes keyed by stable dependency id. */
  crossDependencyIndexById: Map<string, number>;
  /** Mutable cross-process dependencies in stable row order. */
  crossDependencies: TraceCrossProcessDependency[];
  /** Event row indexes keyed by stable event id. */
  eventIndexById: Map<string, number>;
  /** Mutable graph-global events in stable row order. */
  events: TraceEvent[];
  /** Whether mutable state differs from the latest published snapshot. */
  dirty: boolean;
  /** Monotonic published sequence. */
  sequence: number;
  /** Latest published immutable snapshot. */
  publishedSnapshot: TraceStreamPublishedSnapshot | null;
  /** Pending publish timer. */
  publishTimer: ReturnType<typeof setTimeout> | null;
  /** Snapshot listeners. */
  listeners: Set<TraceStreamSessionListener>;
};

/**
 * Create mutable state for one live trace session.
 */
function createTraceStreamSessionState(
  options: TraceStreamSessionOptions
): TraceStreamSessionState {
  return {
    name: options.name ?? 'Live Trace',
    publishIntervalMs: normalizePublishIntervalMs(options.publishIntervalMs),
    closed: false,
    processesById: new Map(),
    processOrder: [],
    crossDependencyIndexById: new Map(),
    crossDependencies: [],
    eventIndexById: new Map(),
    events: [],
    dirty: false,
    sequence: 0,
    publishedSnapshot: null,
    publishTimer: null,
    listeners: new Set()
  };
}

/**
 * Apply one normalized streaming chunk into mutable session state.
 */
function applyTraceStreamChunk(state: TraceStreamSessionState, chunk: TraceStreamChunk): void {
  if (chunk.name) {
    state.name = chunk.name;
  }
  if (chunk.replaceSnapshot) {
    replaceTraceStreamState(state, chunk.replaceSnapshot);
  }
  chunk.processUpserts?.forEach(processUpdate => upsertTraceStreamProcess(state, processUpdate));
  chunk.threadUpserts?.forEach(threadUpdate => upsertTraceStreamThread(state, threadUpdate));
  chunk.appendSpans?.forEach(spanUpdate => appendTraceStreamSpan(state, spanUpdate));
  chunk.upsertSpans?.forEach(spanUpdate => upsertTraceStreamSpan(state, spanUpdate));
  chunk.appendLocalDependencies?.forEach(dependencyUpdate =>
    appendTraceStreamLocalDependency(state, dependencyUpdate)
  );
  chunk.upsertLocalDependencies?.forEach(dependencyUpdate =>
    upsertTraceStreamLocalDependency(state, dependencyUpdate)
  );
  chunk.appendCrossDependencies?.forEach(dependency =>
    appendTraceStreamCrossDependency(state, dependency)
  );
  chunk.upsertCrossDependencies?.forEach(dependency =>
    upsertTraceStreamCrossDependency(state, dependency)
  );
  chunk.appendInstants?.forEach(instantUpdate => appendTraceStreamInstant(state, instantUpdate));
  chunk.upsertInstants?.forEach(instantUpdate => upsertTraceStreamInstant(state, instantUpdate));
  chunk.appendCounters?.forEach(counterUpdate => appendTraceStreamCounter(state, counterUpdate));
  chunk.upsertCounters?.forEach(counterUpdate => upsertTraceStreamCounter(state, counterUpdate));
  chunk.appendEvents?.forEach(event => appendTraceStreamEvent(state, event));
  chunk.upsertEvents?.forEach(event => upsertTraceStreamEvent(state, event));
  state.dirty = true;
}

/**
 * Schedule one delayed publish when mutable state is dirty and no publish is currently pending.
 */
function scheduleTraceStreamPublish(state: TraceStreamSessionState): void {
  if (!state.dirty || state.publishTimer != null || state.closed) {
    return;
  }
  state.publishTimer = setTimeout(() => {
    state.publishTimer = null;
    if (!state.closed) {
      publishTraceStreamSnapshot(state);
    }
  }, state.publishIntervalMs);
}

/**
 * Publish the latest dirty mutable state into immutable `TraceGraphData` and `TraceGraph` snapshots.
 */
function publishTraceStreamSnapshot(
  state: TraceStreamSessionState
): TraceStreamPublishedSnapshot | null {
  if (!state.dirty) {
    return state.publishedSnapshot;
  }

  const processes = state.processOrder
    .map(processId => state.processesById.get(processId))
    .flatMap(processState => (processState ? [materializeTraceStreamProcess(processState)] : []));
  const crossDependencies = materializeTraceStreamCrossDependencies(state, processes);
  const traceGraphData = buildTraceGraphData({
    name: state.name,
    processes,
    crossDependencies,
    spanTableMap: buildTraceSpanTablesByProcessId(processes),
    spanSidecarMap: buildTraceSpanSidecarsByProcessId(processes),
    events: buildTraceStreamEventTable(state.events)
  });
  const snapshot: TraceStreamPublishedSnapshot = {
    sequence: state.sequence + 1,
    traceGraphData,
    traceGraph: new TraceGraph(
      createStaticTraceGraphRuntimeSource({
        identityKey: `${state.name}:stream:${state.sequence + 1}`,
        traceGraphData
      })
    )
  };

  state.sequence = snapshot.sequence;
  state.publishedSnapshot = snapshot;
  state.dirty = false;

  for (const listener of state.listeners) {
    void listener(snapshot);
  }

  return snapshot;
}

/**
 * Replace mutable session state from one full immutable snapshot payload.
 */
function replaceTraceStreamState(
  state: TraceStreamSessionState,
  snapshot: TraceStreamReplaceSnapshot
): void {
  state.name = snapshot.name;
  state.processesById = new Map();
  state.processOrder = [];
  state.crossDependencyIndexById = new Map();
  state.crossDependencies = [];
  state.eventIndexById = new Map();
  state.events = [];

  snapshot.processes.forEach(process => {
    const processId = process.processId;
    const processState = createMutableProcessState(
      processId,
      process.rankNum,
      cloneTraceProcess(process)
    );
    state.processesById.set(processId, processState);
    state.processOrder.push(processId);
  });

  snapshot.crossDependencies.forEach((dependency, dependencyIndex) => {
    state.crossDependencyIndexById.set(String(dependency.dependencyId), dependencyIndex);
    state.crossDependencies.push(cloneTraceCrossDependency(dependency));
  });

  (snapshot.events ?? []).forEach((event, eventIndex) => {
    state.eventIndexById.set(String(event.eventId), eventIndex);
    state.events.push(cloneTraceEvent(event));
  });
}

/**
 * Upsert one process metadata record while preserving first-seen ordering.
 */
function upsertTraceStreamProcess(
  state: TraceStreamSessionState,
  processUpdate: TraceStreamProcessUpsert
): MutableProcessState {
  const existing = state.processesById.get(processUpdate.processId);
  if (existing) {
    existing.process.name = processUpdate.name;
    existing.process.tags = processUpdate.tags;
    existing.process.userData = processUpdate.userData;
    existing.process.stepNum = processUpdate.stepNum ?? existing.process.stepNum;
    return existing;
  }
  const rankNum = processUpdate.rankNum ?? state.processOrder.length;
  const processState = createMutableProcessState(
    processUpdate.processId,
    rankNum,
    createEmptyTraceProcess(processUpdate, rankNum)
  );
  state.processesById.set(processUpdate.processId, processState);
  state.processOrder.push(processUpdate.processId);
  return processState;
}

/**
 * Upsert one thread metadata record into mutable process state.
 */
function upsertTraceStreamThread(
  state: TraceStreamSessionState,
  threadUpdate: TraceStreamThreadUpsert
): void {
  const processState = ensureTraceStreamProcessState(state, threadUpdate.processId);
  const existingThreadIndex = processState.process.threads.findIndex(
    thread => thread.threadId === threadUpdate.thread.threadId
  );
  const nextThread = cloneTraceThread(threadUpdate.thread);
  if (existingThreadIndex >= 0) {
    processState.process.threads[existingThreadIndex] = nextThread;
  } else {
    processState.process.threads.push(nextThread);
  }
  processState.process.threadMap[String(nextThread.threadId)] = nextThread;
}

/**
 * Append one span only when its block id has not been seen before.
 */
function appendTraceStreamSpan(
  state: TraceStreamSessionState,
  spanUpdate: TraceStreamSpanUpdate
): void {
  const processState = ensureTraceStreamProcessState(state, spanUpdate.processId);
  if (processState.blockIndexById.has(String(spanUpdate.span.spanId))) {
    return;
  }
  const span = cloneTraceSpan(spanUpdate.span);
  const rowIndex = processState.process.spans.length;
  span.spanRef = encodeSpanRef(processState.rankNum, rowIndex);
  processState.blockIndexById.set(String(span.spanId), rowIndex);
  processState.process.spans.push(span);
  processState.process.spanMap[String(span.spanId)] = span;
}

/**
 * Upsert one span keyed by its stable block id.
 */
function upsertTraceStreamSpan(
  state: TraceStreamSessionState,
  spanUpdate: TraceStreamSpanUpdate
): void {
  const processState = ensureTraceStreamProcessState(state, spanUpdate.processId);
  const existingRowIndex = processState.blockIndexById.get(String(spanUpdate.span.spanId));
  const nextSpan = cloneTraceSpan(spanUpdate.span);
  if (existingRowIndex == null) {
    const rowIndex = processState.process.spans.length;
    nextSpan.spanRef = encodeSpanRef(processState.rankNum, rowIndex);
    processState.blockIndexById.set(String(nextSpan.spanId), rowIndex);
    processState.process.spans.push(nextSpan);
  } else {
    nextSpan.spanRef = processState.process.spans[existingRowIndex]?.spanRef;
    processState.process.spans[existingRowIndex] = nextSpan;
  }
  processState.process.spanMap[String(nextSpan.spanId)] = nextSpan;
}

/**
 * Append one local dependency only when its dependency id has not been seen before.
 */
function appendTraceStreamLocalDependency(
  state: TraceStreamSessionState,
  dependencyUpdate: TraceStreamLocalDependencyUpdate
): void {
  const processState = ensureTraceStreamProcessState(state, dependencyUpdate.processId);
  if (processState.localDependencyIndexById.has(String(dependencyUpdate.dependency.dependencyId))) {
    return;
  }
  const nextDependency = cloneTraceLocalDependency(dependencyUpdate.dependency);
  const rowIndex = processState.process.localDependencies.length;
  nextDependency.dependencyRef = encodeVisibleLocalDependencyRef(rowIndex);
  processState.localDependencyIndexById.set(String(nextDependency.dependencyId), rowIndex);
  processState.process.localDependencies.push(nextDependency);
}

/**
 * Upsert one local dependency keyed by its stable dependency id.
 */
function upsertTraceStreamLocalDependency(
  state: TraceStreamSessionState,
  dependencyUpdate: TraceStreamLocalDependencyUpdate
): void {
  const processState = ensureTraceStreamProcessState(state, dependencyUpdate.processId);
  const existingRowIndex = processState.localDependencyIndexById.get(
    String(dependencyUpdate.dependency.dependencyId)
  );
  const nextDependency = cloneTraceLocalDependency(dependencyUpdate.dependency);
  if (existingRowIndex == null) {
    const rowIndex = processState.process.localDependencies.length;
    nextDependency.dependencyRef = encodeVisibleLocalDependencyRef(rowIndex);
    processState.localDependencyIndexById.set(String(nextDependency.dependencyId), rowIndex);
    processState.process.localDependencies.push(nextDependency);
    return;
  }
  nextDependency.dependencyRef =
    processState.process.localDependencies[existingRowIndex]?.dependencyRef;
  processState.process.localDependencies[existingRowIndex] = nextDependency;
}

/**
 * Append one cross-process dependency only when its dependency id has not been seen before.
 */
function appendTraceStreamCrossDependency(
  state: TraceStreamSessionState,
  dependency: TraceCrossProcessDependency
): void {
  if (state.crossDependencyIndexById.has(String(dependency.dependencyId))) {
    return;
  }
  const nextDependency = cloneTraceCrossDependency(dependency);
  const rowIndex = state.crossDependencies.length;
  nextDependency.dependencyRef = encodeVisibleCrossDependencyRef(rowIndex);
  state.crossDependencyIndexById.set(String(nextDependency.dependencyId), rowIndex);
  state.crossDependencies.push(nextDependency);
}

/**
 * Upsert one cross-process dependency keyed by its stable dependency id.
 */
function upsertTraceStreamCrossDependency(
  state: TraceStreamSessionState,
  dependency: TraceCrossProcessDependency
): void {
  const existingRowIndex = state.crossDependencyIndexById.get(String(dependency.dependencyId));
  const nextDependency = cloneTraceCrossDependency(dependency);
  if (existingRowIndex == null) {
    const rowIndex = state.crossDependencies.length;
    nextDependency.dependencyRef = encodeVisibleCrossDependencyRef(rowIndex);
    state.crossDependencyIndexById.set(String(nextDependency.dependencyId), rowIndex);
    state.crossDependencies.push(nextDependency);
    return;
  }
  nextDependency.dependencyRef = state.crossDependencies[existingRowIndex]?.dependencyRef;
  state.crossDependencies[existingRowIndex] = nextDependency;
}

/**
 * Append one instant only when its instant id has not been seen before.
 */
function appendTraceStreamInstant(
  state: TraceStreamSessionState,
  instantUpdate: TraceStreamInstantUpdate
): void {
  const processState = ensureTraceStreamProcessState(state, instantUpdate.processId);
  if (processState.instantIndexById.has(String(instantUpdate.instant.instantId))) {
    return;
  }
  const nextInstant = cloneTraceInstant(instantUpdate.instant);
  const rowIndex = processState.process.instants.length;
  processState.instantIndexById.set(String(nextInstant.instantId), rowIndex);
  processState.process.instants.push(nextInstant);
  processState.process.instantMap[String(nextInstant.instantId)] = nextInstant;
}

/**
 * Upsert one instant keyed by its stable instant id.
 */
function upsertTraceStreamInstant(
  state: TraceStreamSessionState,
  instantUpdate: TraceStreamInstantUpdate
): void {
  const processState = ensureTraceStreamProcessState(state, instantUpdate.processId);
  const existingRowIndex = processState.instantIndexById.get(
    String(instantUpdate.instant.instantId)
  );
  const nextInstant = cloneTraceInstant(instantUpdate.instant);
  if (existingRowIndex == null) {
    const rowIndex = processState.process.instants.length;
    processState.instantIndexById.set(String(nextInstant.instantId), rowIndex);
    processState.process.instants.push(nextInstant);
  } else {
    processState.process.instants[existingRowIndex] = nextInstant;
  }
  processState.process.instantMap[String(nextInstant.instantId)] = nextInstant;
}

/**
 * Append one counter only when its counter id has not been seen before.
 */
function appendTraceStreamCounter(
  state: TraceStreamSessionState,
  counterUpdate: TraceStreamCounterUpdate
): void {
  const processState = ensureTraceStreamProcessState(state, counterUpdate.processId);
  if (processState.counterIndexById.has(String(counterUpdate.counter.counterId))) {
    return;
  }
  const nextCounter = cloneTraceCounter(counterUpdate.counter);
  const rowIndex = processState.process.counters.length;
  processState.counterIndexById.set(String(nextCounter.counterId), rowIndex);
  processState.process.counters.push(nextCounter);
  processState.process.counterMap[String(nextCounter.counterId)] = nextCounter;
}

/**
 * Upsert one counter keyed by its stable counter id.
 */
function upsertTraceStreamCounter(
  state: TraceStreamSessionState,
  counterUpdate: TraceStreamCounterUpdate
): void {
  const processState = ensureTraceStreamProcessState(state, counterUpdate.processId);
  const existingRowIndex = processState.counterIndexById.get(
    String(counterUpdate.counter.counterId)
  );
  const nextCounter = cloneTraceCounter(counterUpdate.counter);
  if (existingRowIndex == null) {
    const rowIndex = processState.process.counters.length;
    processState.counterIndexById.set(String(nextCounter.counterId), rowIndex);
    processState.process.counters.push(nextCounter);
  } else {
    processState.process.counters[existingRowIndex] = nextCounter;
  }
  processState.process.counterMap[String(nextCounter.counterId)] = nextCounter;
}

/**
 * Append one graph-global event only when its event id has not been seen before.
 */
function appendTraceStreamEvent(state: TraceStreamSessionState, event: TraceEvent): void {
  if (state.eventIndexById.has(String(event.eventId))) {
    return;
  }
  const nextEvent = cloneTraceEvent(event);
  const rowIndex = state.events.length;
  state.eventIndexById.set(String(nextEvent.eventId), rowIndex);
  state.events.push(nextEvent);
}

/**
 * Upsert one graph-global event keyed by its stable event id.
 */
function upsertTraceStreamEvent(state: TraceStreamSessionState, event: TraceEvent): void {
  const existingRowIndex = state.eventIndexById.get(String(event.eventId));
  const nextEvent = cloneTraceEvent(event);
  if (existingRowIndex == null) {
    const rowIndex = state.events.length;
    state.eventIndexById.set(String(nextEvent.eventId), rowIndex);
    state.events.push(nextEvent);
    return;
  }
  state.events[existingRowIndex] = nextEvent;
}

/**
 * Ensure mutable state exists for one process id.
 */
function ensureTraceStreamProcessState(
  state: TraceStreamSessionState,
  processId: string
): MutableProcessState {
  return (
    state.processesById.get(processId) ??
    upsertTraceStreamProcess(state, {
      processId: processId,
      name: processId
    })
  );
}

/**
 * Convert mutable process state into one immutable published process snapshot.
 */
function materializeTraceStreamProcess(processState: MutableProcessState): TraceProcess {
  const process = cloneTraceProcess(processState.process);
  process.rankNum = processState.rankNum;
  process.threadMap = Object.fromEntries(
    process.threads.map(thread => [String(thread.threadId), thread])
  );
  process.spans = process.spans.map((block, rowIndex) => ({
    ...cloneTraceSpan(block),
    spanRef: encodeSpanRef(processState.rankNum, rowIndex),
    processName: block.processName || process.name,
    localDependencyIds: [],
    localDependencies: []
  }));
  process.spanMap = Object.fromEntries(process.spans.map(block => [String(block.spanId), block]));
  process.localDependencies = process.localDependencies.map((dependency, dependencyIndex) => {
    const clonedDependency = cloneTraceLocalDependency(dependency);
    clonedDependency.dependencyRef = encodeVisibleLocalDependencyRef(dependencyIndex);
    clonedDependency.startSpanRef = process.spanMap[String(clonedDependency.startSpanId)]?.spanRef;
    clonedDependency.endSpanRef = process.spanMap[String(clonedDependency.endSpanId)]?.spanRef;
    return clonedDependency;
  });
  process.localDependencies.forEach(dependency => {
    const startBlock = process.spanMap[String(dependency.startSpanId)];
    const endBlock = process.spanMap[String(dependency.endSpanId)];
    if (startBlock) {
      startBlock.localDependencyIds.push(dependency.dependencyId);
      startBlock.localDependencies.push(dependency);
    }
    if (endBlock) {
      endBlock.localDependencyIds.push(dependency.dependencyId);
      endBlock.localDependencies.push(dependency);
    }
  });
  process.instantMap = Object.fromEntries(
    process.instants.map(instant => [String(instant.instantId), instant])
  );
  process.threadInstantMap = buildTraceStreamItemsByThread(process.instants, 'threadId');
  process.counterMap = Object.fromEntries(
    process.counters.map(counter => [String(counter.counterId), counter])
  );
  process.threadCounterMap = buildTraceStreamItemsByThread(process.counters, 'threadId');
  return process;
}

/**
 * Convert mutable cross dependencies into immutable published cross dependencies with stable refs.
 */
function materializeTraceStreamCrossDependencies(
  state: TraceStreamSessionState,
  processes: readonly TraceProcess[]
): TraceCrossProcessDependency[] {
  const processByRankNum = new Map(processes.map(process => [process.rankNum, process] as const));
  const spanByRef = new Map<SpanRef, TraceSpan>();
  processes.forEach(process => {
    process.spans.forEach(block => {
      if (block.spanRef != null) {
        spanByRef.set(block.spanRef, block);
      }
    });
  });
  /** Resolves one streamed cross-dependency endpoint by exact ref or its declared process row. */
  const getEndpointSpan = (params: {
    /** Exact streamed endpoint span ref when the dependency already carries one. */
    spanRef: SpanRef | undefined;
    /** Declared endpoint process rank used for process-scoped id fallback before refs exist. */
    rankNum: number;
    /** Process-scoped endpoint span id used before the dependency carries a span ref. */
    spanId: TraceSpan['spanId'];
  }): TraceSpan | null => {
    if (params.spanRef != null) {
      return spanByRef.get(params.spanRef) ?? null;
    }
    return processByRankNum.get(params.rankNum)?.spanMap[String(params.spanId)] ?? null;
  };
  return state.crossDependencies.map((dependency, dependencyIndex) => {
    const clonedDependency = cloneTraceCrossDependency(dependency);
    clonedDependency.dependencyRef = encodeVisibleCrossDependencyRef(dependencyIndex);
    clonedDependency.startSpanRef = getEndpointSpan({
      spanRef: clonedDependency.startSpanRef,
      rankNum: clonedDependency.startRankNum,
      spanId: clonedDependency.startSpanId
    })?.spanRef;
    clonedDependency.endSpanRef = getEndpointSpan({
      spanRef: clonedDependency.endSpanRef,
      rankNum: clonedDependency.endRankNum,
      spanId: clonedDependency.endSpanId
    })?.spanRef;
    return clonedDependency;
  });
}

/**
 * Build an event table from immutable graph-global events.
 */
function buildTraceStreamEventTable(events: readonly TraceEvent[]) {
  return buildArrowTraceEventTableFromRows(
    events.map(event => ({
      eventId: String(event.eventId),
      name: event.name,
      atTimeMs: event.atTimeMs,
      userDataJson: JSON.stringify(event.userData ?? null)
    }))
  );
}

/**
 * Normalize the configured publish interval.
 */
function normalizePublishIntervalMs(publishIntervalMs: number | undefined): number {
  if (publishIntervalMs == null || !Number.isFinite(publishIntervalMs) || publishIntervalMs < 0) {
    return 100;
  }
  return Math.max(0, Math.floor(publishIntervalMs));
}

/**
 * Throw when callers use a session after it has been closed.
 */
function assertTraceStreamSessionOpen(state: TraceStreamSessionState): void {
  if (state.closed) {
    throw new Error('TraceStreamSession has already been closed.');
  }
}

/**
 * Create one empty mutable process state.
 */
function createMutableProcessState(
  processId: string,
  rankNum: number,
  process: TraceProcess
): MutableProcessState {
  return {
    processId,
    rankNum,
    process,
    blockIndexById: new Map(
      process.spans.map((block, index) => [String(block.spanId), index] as const)
    ),
    localDependencyIndexById: new Map(
      process.localDependencies.map(
        (dependency, index) => [String(dependency.dependencyId), index] as const
      )
    ),
    instantIndexById: new Map(
      process.instants.map((instant, index) => [String(instant.instantId), index] as const)
    ),
    counterIndexById: new Map(
      process.counters.map((counter, index) => [String(counter.counterId), index] as const)
    )
  };
}

/**
 * Create one empty compatibility process used as mutable backing state for streamed updates.
 */
function createEmptyTraceProcess(
  processUpdate: TraceStreamProcessUpsert,
  rankNum: number
): TraceProcess {
  return {
    type: 'trace-process',
    processId: processUpdate.processId,
    name: processUpdate.name,
    tags: processUpdate.tags,
    rankNum,
    stepNum: processUpdate.stepNum ?? 0,
    threads: [],
    threadMap: {},
    spans: [],
    spanMap: {},
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: [],
    remoteDependencies: [],
    userData: processUpdate.userData
  };
}

/**
 * Clone one process object deeply enough for safe mutable session updates.
 */
function cloneTraceProcess(process: TraceProcess): TraceProcess {
  return {
    ...process,
    threads: process.threads.map(cloneTraceThread),
    threadMap: {},
    spans: process.spans.map(cloneTraceSpan),
    spanMap: {},
    instants: process.instants.map(cloneTraceInstant),
    instantMap: {},
    threadInstantMap: {},
    counters: process.counters.map(cloneTraceCounter),
    counterMap: {},
    threadCounterMap: {},
    localDependencies: process.localDependencies.map(cloneTraceLocalDependency),
    remoteDependencies: process.remoteDependencies.map(dependency => ({...dependency})),
    userData: cloneUserData(process.userData)
  };
}

/**
 * Clone one thread object.
 */
function cloneTraceThread(thread: TraceThread): TraceThread {
  return {
    ...thread,
    userData: cloneUserData(thread.userData)
  };
}

/**
 * Clone one span object.
 */
function cloneTraceSpan(block: TraceSpan): TraceSpan {
  return {
    ...block,
    timings: Object.fromEntries(
      Object.entries(block.timings).map(([timingKey, timing]) => [timingKey, {...timing}])
    ),
    keywords: block.keywords ? [...block.keywords] : undefined,
    localDependencyIds: [...block.localDependencyIds],
    localDependencies: [...block.localDependencies],
    crossProcessDependencyEndpoints: block.crossProcessDependencyEndpoints.map(endpoint => ({
      ...endpoint,
      userData: cloneUserData(endpoint.userData)
    })),
    userData: cloneUserData(block.userData)
  };
}

/**
 * Clone one local dependency object.
 */
function cloneTraceLocalDependency(dependency: TraceLocalDependency): TraceLocalDependency {
  return {
    ...dependency,
    keywords: new Set([...dependency.keywords]),
    userData: cloneUserData(dependency.userData)
  };
}

/**
 * Clone one cross-process dependency object.
 */
function cloneTraceCrossDependency(
  dependency: TraceCrossProcessDependency
): TraceCrossProcessDependency {
  return {
    ...dependency,
    keywords: new Set([...dependency.keywords]),
    userData: cloneUserData(dependency.userData)
  };
}

/**
 * Clone one instant object.
 */
function cloneTraceInstant(instant: TraceInstant): TraceInstant {
  return {
    ...instant,
    userData: cloneUserData(instant.userData)
  };
}

/**
 * Clone one counter object.
 */
function cloneTraceCounter(counter: TraceCounter): TraceCounter {
  return {
    ...counter,
    series: {...counter.series},
    userData: cloneUserData(counter.userData)
  };
}

/**
 * Clone one graph-global event object.
 */
function cloneTraceEvent(event: TraceEvent): TraceEvent {
  return {
    ...event,
    userData: cloneUserData(event.userData)
  };
}

/**
 * Group thread-owned items by their stream id.
 */
function buildTraceStreamItemsByThread<
  ItemT extends {
    threadId: string;
  }
>(items: readonly ItemT[], threadIdKey: 'threadId'): Record<string, ItemT[]> {
  const groupedItems: Record<string, ItemT[]> = {};
  items.forEach(item => {
    const threadId = String(item[threadIdKey]);
    groupedItems[threadId] = [...(groupedItems[threadId] ?? []), item];
  });
  return groupedItems;
}

/**
 * Clone app-owned metadata objects shallowly.
 */
function cloneUserData(
  userData: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  return userData ? {...userData} : undefined;
}
