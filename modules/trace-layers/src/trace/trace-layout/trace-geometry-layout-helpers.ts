import {TraceGraph} from '../trace-graph/trace-graph';
import {getProcessRefIndex} from '../trace-graph/trace-id-encoder';
import {getTraceLayoutBoundsFromStructure} from './trace-layout';

import type {TraceLocalDependencySource} from '../trace-graph-accessors';
import type {
  ProcessRef,
  ThreadRef,
  TraceDependencyRef,
  VisibleLocalDependencyRef
} from '../trace-graph/trace-id-encoder';
import type {
  TraceGeometryLayoutLookup,
  TraceLayoutLaneDependencySource,
  TraceLayoutLaneSpanSource,
  TraceSpanGeometrySource
} from './trace-geometry-layout-common';
import type {
  ProcessLayout,
  ThreadLayout,
  TraceLayout,
  TraceLayoutBounds,
  TraceLayoutVisibleGraph,
  TraceLayoutVisibleProcessMetadata
} from './trace-layout';

const objectIdentityIds = new WeakMap<object, number>();
let nextObjectIdentityId = 1;

/** Returns all y positions occupied by a thread layout, including expanded lanes. */
export function getThreadLayoutYPositions(layout: ThreadLayout): number[] {
  if (layout.lanes?.laneYPositions.length) {
    return layout.lanes.laneYPositions;
  }
  return [layout.yPosition];
}

/** Returns the smallest visible y position occupied by a thread layout. */
export function getThreadLayoutMinimumYPosition(layout: ThreadLayout): number {
  const laneYPositions = layout.lanes?.laneYPositions;
  if (!laneYPositions?.length) {
    return layout.yPosition;
  }

  let minimumYPosition = laneYPositions[0] ?? layout.yPosition;
  for (let index = 1; index < laneYPositions.length; index++) {
    const laneYPosition = laneYPositions[index]!;
    if (laneYPosition < minimumYPosition) {
      minimumYPosition = laneYPosition;
    }
  }
  return minimumYPosition;
}

/** Builds the visible process/dependency projection used for filtered geometry generation. */
export function buildVisibleTraceGraph(traceGraph: Readonly<TraceGraph>): TraceLayoutVisibleGraph {
  const visibleProcesses: TraceLayoutVisibleProcessMetadata[] = [];
  for (const processRef of traceGraph.getVisibleProcessRefs()) {
    const processSource = traceGraph.getVisibleProcessSourceByRef(processRef);
    const processIndex = getProcessRefIndex(processRef);
    const rawProcess = processIndex >= 0 ? traceGraph.processes[processIndex] : null;
    if (!processSource || !rawProcess) {
      continue;
    }
    visibleProcesses.push({
      processRef,
      processId: rawProcess.processId,
      processOrder: processSource.processOrder,
      name: processSource.name,
      rankNum: processSource.rankNum,
      threads: rawProcess.threads,
      threadRefs: traceGraph.getThreadRefsByProcessRef(processRef),
      userData: processSource.userData
    });
  }

  return {
    name: traceGraph.name,
    minTimeMs: traceGraph.minTimeMs,
    maxTimeMs: traceGraph.maxTimeMs,
    traceGraph,
    processes: sortVisibleTraceLayoutProcessesByProcessOrder(visibleProcesses),
    crossDependencies: traceGraph.getVisibleCrossDependencySources()
  };
}

/**
 * Returns a stable copy of visible processes sorted by rank number.
 */
export function sortVisibleTraceLayoutProcessesByProcessOrder(
  processes: readonly TraceLayoutVisibleProcessMetadata[]
): TraceLayoutVisibleProcessMetadata[] {
  return processes
    .map((process, index) => ({process, index}))
    .sort(
      (left, right) =>
        (left.process.processOrder ?? left.process.rankNum) -
          (right.process.processOrder ?? right.process.rankNum) || left.index - right.index
    )
    .map(({process}) => process);
}

/** Builds a single-process visible graph view used for process-local relative layout calculation. */
export function buildVisibleTraceGraphForProcess(params: {
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>;
  process: Readonly<TraceLayoutVisibleProcessMetadata>;
}): TraceLayoutVisibleGraph {
  return {
    name: params.visibleTraceGraph.name,
    minTimeMs: params.visibleTraceGraph.minTimeMs,
    maxTimeMs: params.visibleTraceGraph.maxTimeMs,
    traceGraph: params.visibleTraceGraph.traceGraph,
    processes: [params.process],
    crossDependencies: []
  };
}

/**
 * Resolves the visible geometry spans for one process directly from the filtered source graph.
 */
export function getVisibleGeometrySpansForProcess(
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>,
  processId: string
): readonly TraceSpanGeometrySource[] {
  const processRef = getProcessRefByProcessId(visibleTraceGraph, processId);
  return processRef != null
    ? visibleTraceGraph.traceGraph.getVisibleProcessGeometrySources(processRef)
    : [];
}

/**
 * Resolves visible local dependencies for one process directly from the filtered source graph.
 */
export function getVisibleLocalDependenciesForProcess(
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>,
  processId: string
): ReadonlyArray<TraceLocalDependencySource> {
  const processRef = getProcessRefByProcessId(visibleTraceGraph, processId);
  return processRef != null
    ? visibleTraceGraph.traceGraph.getVisibleLocalDependencySources(processRef)
    : [];
}

/** Resolves visible local dependency refs for one process directly from the filtered graph. */
export function getVisibleLocalDependencyRefsForProcess(
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>,
  processId: string
): readonly (TraceDependencyRef | VisibleLocalDependencyRef)[] {
  const processRef = getProcessRefByProcessId(visibleTraceGraph, processId);
  if (processRef == null) {
    return [];
  }
  return visibleTraceGraph.traceGraph.hasActiveSpanFilter()
    ? visibleTraceGraph.traceGraph.getVisibleLocalDependencyRefs(processRef)
    : visibleTraceGraph.traceGraph.getLocalDependencyRefs(processRef);
}

/** Resolves lightweight visible lane spans for one process directly from the filtered source graph. */
export function getVisibleLaneSpansForProcess(
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>,
  processId: string
): readonly TraceLayoutLaneSpanSource[] {
  const processRef = getProcessRefByProcessId(visibleTraceGraph, processId);
  return processRef != null
    ? visibleTraceGraph.traceGraph.getVisibleProcessGeometrySources(processRef)
    : [];
}

/** Resolves lightweight visible lane dependencies for one process from the filtered source graph. */
export function getVisibleLaneLocalDependenciesForProcess(
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>,
  processId: string
): readonly TraceLayoutLaneDependencySource[] {
  const processRef = getProcessRefByProcessId(visibleTraceGraph, processId);
  return processRef != null
    ? visibleTraceGraph.traceGraph.getVisibleLocalDependencyLayoutSources(processRef)
    : [];
}

/** Resolves one canonical runtime process ref from a visible process rank id when present. */
export function getProcessRefByProcessId(
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>,
  processId: string
): ProcessRef | null {
  return getProcessRefsByProcessId(visibleTraceGraph).get(processId) ?? null;
}

const visibleGraphProcessRefByRankIdCache = new WeakMap<
  Readonly<TraceLayoutVisibleGraph>,
  ReadonlyMap<string, ProcessRef>
>();

/**
 * Returns a cached visible rank id to process ref index for process-local layout lookups.
 */
export function getProcessRefsByProcessId(
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>
): ReadonlyMap<string, ProcessRef> {
  const cached = visibleGraphProcessRefByRankIdCache.get(visibleTraceGraph);
  if (cached) {
    return cached;
  }
  const processRefsByRankId = new Map<string, ProcessRef>();
  for (const process of visibleTraceGraph.processes) {
    if (process.processRef != null) {
      processRefsByRankId.set(process.processId, process.processRef);
    }
  }
  visibleGraphProcessRefByRankIdCache.set(visibleTraceGraph, processRefsByRankId);
  return processRefsByRankId;
}

/** Returns a stable id for object identity within this JS runtime. */
export function getObjectIdentityId(value: object): number {
  const existingId = objectIdentityIds.get(value);
  if (existingId != null) {
    return existingId;
  }

  const nextId = nextObjectIdentityId;
  nextObjectIdentityId += 1;
  objectIdentityIds.set(value, nextId);
  return nextId;
}

/** Builds a stable cache fragment for chunks containing rows owned by one process ref. */
export function getProcessSpanChunkCacheKey(
  traceGraph: Readonly<TraceGraph>,
  processRef: ProcessRef | undefined
): string | null {
  if (processRef == null) {
    return null;
  }
  const chunks = traceGraph.chunks.filter(chunk => chunk.processRefs.includes(processRef));
  if (chunks.length === 0) {
    return null;
  }
  const processId = traceGraph.processIdsByIndex[getProcessRefIndex(processRef)];
  const spanTable = processId ? traceGraph.processSpanTableMap[processId] : undefined;
  const spanTableGeneration = processId
    ? traceGraph.processSpanTableMap[processId]?.generation
    : undefined;
  const firstChunk = chunks[0]!;
  const lastChunk = chunks[chunks.length - 1]!;
  return [
    `process=${processId ?? processRef}`,
    `chunks=${chunks.length}`,
    `first=${firstChunk.chunkRef}`,
    `last=${lastChunk.chunkRef}`,
    `rows=${spanTable?.numRows ?? 0}`,
    `spanGeneration=${spanTableGeneration ?? 'unknown'}`
  ].join('|');
}

/** Builds ref-native lane layout lookup state for one TraceGraph/layout pair. */
export function buildTraceGeometryLayoutLookup(params: {
  /** TraceGraph that resolves visible span refs to owner process/thread refs. */
  traceGraph: Pick<TraceGraph, 'getProcessRefBySpanRef' | 'getThreadRefBySpanRef'>;
  /** Process layouts keyed by canonical runtime process ref. */
  processLayoutMapByRef: ReadonlyMap<ProcessRef, ProcessLayout>;
  /** Thread layouts keyed by canonical runtime thread ref. */
  threadLayoutMapByRef: ReadonlyMap<ThreadRef, ThreadLayout>;
}): TraceGeometryLayoutLookup {
  return {
    traceGraph: params.traceGraph,
    threadLayoutsByRef: params.threadLayoutMapByRef,
    processLayoutsByRef: params.processLayoutMapByRef
  };
}

/**
 * Narrows a global geometry lookup with process-local stream-id fallback maps.
 */
export function buildProcessGeometryLayoutLookup(params: {
  globalLookup: TraceGeometryLayoutLookup;
  processLayout?: ProcessLayout;
}): TraceGeometryLayoutLookup {
  return params.globalLookup;
}

/** Resolves a span's thread layout from its exact current-graph span ref. */
export function getThreadLayoutForGeometrySpan(params: {
  /** Span whose owning thread layout should be resolved. */
  span: TraceSpanGeometrySource;
  layoutLookup: TraceGeometryLayoutLookup;
}): ThreadLayout | undefined {
  const threadRef = params.layoutLookup.traceGraph.getThreadRefBySpanRef(params.span.spanRef);
  if (threadRef != null) {
    const refLayout = params.layoutLookup.threadLayoutsByRef.get(threadRef);
    if (refLayout) {
      return refLayout;
    }
  }
  return undefined;
}

/** Resolves a span's process layout from its exact current-graph span ref. */
export function getProcessLayoutForGeometrySpan(params: {
  /** Span whose owning process layout should be resolved. */
  span: TraceSpanGeometrySource;
  layoutLookup: TraceGeometryLayoutLookup;
}): ProcessLayout | undefined {
  const processRef = params.layoutLookup.traceGraph.getProcessRefBySpanRef(params.span.spanRef);
  if (processRef != null) {
    const refLayout = params.layoutLookup.processLayoutsByRef.get(processRef);
    if (refLayout) {
      return refLayout;
    }
  }

  return undefined;
}

/** Resolves the timing projection used by span and dependency geometry. */
export function resolveGeometrySpan(
  span: TraceSpanGeometrySource,
  timingKey?: string | null
): TraceSpanGeometrySource {
  if (!timingKey) {
    return span;
  }

  const resolvedKey = span.timings[timingKey] ? timingKey : span.primaryTimingKey;
  const resolvedTiming = span.timings[resolvedKey];
  if (!resolvedTiming) {
    return span;
  }
  if (resolvedKey === span.primaryTimingKey && Object.keys(span.timings).length === 1) {
    return span;
  }

  return {
    ...span,
    primaryTimingKey: resolvedKey,
    timings: {[resolvedKey]: resolvedTiming}
  } satisfies TraceSpanGeometrySource;
}

/**
 * Resolve the concrete timing key that geometry generation would use for one span.
 */
export function resolveGeometryTimingKey(
  span: TraceSpanGeometrySource,
  timingKey?: string | null
): string {
  if (!timingKey) {
    return span.primaryTimingKey;
  }
  return span.timings[timingKey] ? timingKey : span.primaryTimingKey;
}

/**
 * Returns true when rebuilding geometry for the requested timing key would be a no-op.
 */

export function computeTraceLayoutBounds(params: {
  traceLayout: TraceLayout;
  minTimeMs: number;
  maxTimeMs: number;
}): TraceLayoutBounds {
  return getTraceLayoutBoundsFromStructure(params);
}

/** Attaches precomputed minimap layout artifacts to already-built main trace layouts. */
