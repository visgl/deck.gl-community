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
import type {SpanRef, TraceThreadId} from '../trace-graph/trace-types';
import type {
  TraceGeometryLayoutLookup,
  TraceLayoutLaneBlockSource,
  TraceLayoutLaneDependencySource,
  TraceSpanGeometrySource
} from './trace-geometry-layout-common';
import type {
  ProcessLayout,
  ThreadLayout,
  TraceLayout,
  TraceLayoutBounds,
  TraceLayoutSourceProcess,
  TraceLayoutVisibleGraph,
  TraceLayoutVisibleProcessMetadata
} from './trace-layout';

const objectIdentityIds = new WeakMap<object, number>();
let nextObjectIdentityId = 1;

/** Builds process-local thread layout lookup maps without repeated linear scans. */
export function buildThreadLayoutLookup(processLayout: ProcessLayout | undefined): {
  layoutByThreadId: ReadonlyMap<TraceThreadId, ThreadLayout>;
  layoutByThreadRef: ReadonlyMap<ThreadRef, ThreadLayout>;
} {
  const layoutByThreadId = new Map<TraceThreadId, ThreadLayout>();
  const layoutByThreadRef = new Map<ThreadRef, ThreadLayout>();
  for (const threadLayout of processLayout?.threadLayouts ?? []) {
    if (threadLayout.threadId != null) {
      layoutByThreadId.set(threadLayout.threadId, threadLayout);
    }
    if (threadLayout.threadRef != null) {
      layoutByThreadRef.set(threadLayout.threadRef, threadLayout);
    }
  }
  return {layoutByThreadId, layoutByThreadRef};
}

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
      threadMap: rawProcess.threadMap,
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
 * Resolves the visible blocks for one process directly from the filtered source graph.
 */
export function getVisibleBlocksForProcess(
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

/** Resolves lightweight visible lane blocks for one process directly from the filtered source graph. */
export function getVisibleLaneBlocksForProcess(
  visibleTraceGraph: Readonly<TraceLayoutVisibleGraph>,
  processId: string
): readonly TraceLayoutLaneBlockSource[] {
  const processRef = getProcessRefByProcessId(visibleTraceGraph, processId);
  return processRef != null
    ? visibleTraceGraph.traceGraph.getVisibleProcessLayoutBlocks(processRef)
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

/** Builds a process-layout lookup keyed by process-local stream id. */
export function buildStreamToProcessLayoutMap(
  processes: readonly Pick<TraceLayoutSourceProcess, 'processId' | 'threads'>[],
  processLayouts: readonly ProcessLayout[]
): Record<TraceThreadId, ProcessLayout> {
  return processLayouts.reduce(
    (acc, processLayout, processIndex) => {
      const process = processes[processIndex];
      if (!process) {
        return acc;
      }

      for (const thread of process.threads) {
        acc[thread.threadId] = processLayout;
      }

      return acc;
    },
    {} as Record<TraceThreadId, ProcessLayout>
  );
}

/**
 * Builds ref-native layout lookup maps for one visible TraceGraph/layout pair.
 */
export function buildTraceGeometryLayoutLookup(params: {
  visibleTraceGraph: TraceLayoutVisibleGraph;
  processLayouts: readonly ProcessLayout[];
  fallbackThreadLayoutMap?: Readonly<Record<TraceThreadId, ThreadLayout>>;
  fallbackStreamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
}): TraceGeometryLayoutLookup {
  const threadLayoutsBySpanRef = new Map<SpanRef, ThreadLayout>();
  const processLayoutsBySpanRef = new Map<SpanRef, ProcessLayout>();
  const threadLayoutsByRef = new Map<ThreadRef, ThreadLayout>();
  const processLayoutsByRef = new Map<ProcessRef, ProcessLayout>();

  params.visibleTraceGraph.processes.forEach((process, processIndex) => {
    const processLayout = params.processLayouts[processIndex];
    if (!processLayout) {
      return;
    }
    if (process.processRef != null) {
      processLayoutsByRef.set(process.processRef, processLayout);
    }
    if (processLayout.threadLayouts.length === 1) {
      const combinedThreadLayout = processLayout.threadLayouts[0];
      if (combinedThreadLayout) {
        process.threadRefs?.forEach(threadRef => {
          threadLayoutsByRef.set(threadRef, combinedThreadLayout);
        });
      }
      return;
    }

    const {layoutByThreadId, layoutByThreadRef} = buildThreadLayoutLookup(processLayout);
    for (const [threadIndex, thread] of process.threads.entries()) {
      const threadRef = process.threadRefs?.[threadIndex];
      if (threadRef == null) {
        continue;
      }
      const threadLayout =
        layoutByThreadId.get(thread.threadId) ?? layoutByThreadRef.get(threadRef);
      if (threadLayout) {
        threadLayoutsByRef.set(threadRef, threadLayout);
      }
    }
  });

  return {
    traceGraph: params.visibleTraceGraph.traceGraph,
    threadLayoutsBySpanRef,
    processLayoutsBySpanRef,
    threadLayoutsByRef,
    processLayoutsByRef,
    fallbackThreadLayoutMap: params.fallbackThreadLayoutMap,
    fallbackStreamToProcessLayoutMap: params.fallbackStreamToProcessLayoutMap
  };
}

/**
 * Narrows a global geometry lookup with process-local stream-id fallback maps.
 */
export function buildProcessGeometryLayoutLookup(params: {
  globalLookup: TraceGeometryLayoutLookup;
  process: TraceLayoutVisibleProcessMetadata;
  processLayout?: ProcessLayout;
}): TraceGeometryLayoutLookup {
  if (!params.processLayout) {
    return params.globalLookup;
  }

  const fallbackThreadLayoutMap: Record<TraceThreadId, ThreadLayout> = {};
  const fallbackStreamToProcessLayoutMap: Record<TraceThreadId, ProcessLayout> = {};
  const {layoutByThreadId, layoutByThreadRef} = buildThreadLayoutLookup(params.processLayout);
  params.process.threads.forEach((thread, threadIndex) => {
    const threadRef = params.process.threadRefs?.[threadIndex];
    const threadLayout =
      params.processLayout!.threadLayouts.length === 1
        ? params.processLayout!.threadLayouts[0]
        : (layoutByThreadId.get(thread.threadId) ??
          (threadRef != null ? layoutByThreadRef.get(threadRef) : undefined) ??
          params.processLayout!.threadLayouts[threadIndex]);
    if (threadLayout) {
      const globalFallbackLayout = params.globalLookup.fallbackThreadLayoutMap?.[thread.threadId];
      fallbackThreadLayoutMap[thread.threadId] =
        globalFallbackLayout && !globalFallbackLayout.visible ? globalFallbackLayout : threadLayout;
    }
    fallbackStreamToProcessLayoutMap[thread.threadId] = params.processLayout!;
  });

  return {
    ...params.globalLookup,
    fallbackThreadLayoutMap,
    fallbackStreamToProcessLayoutMap
  };
}

/**
 * Resolves a block's thread layout from span refs before using compatibility stream ids.
 */
export function getThreadLayoutForGeometryBlock(params: {
  block: TraceSpanGeometrySource;
  fallbackThreadLayoutMap?: Readonly<Record<TraceThreadId, ThreadLayout>>;
  layoutLookup: TraceGeometryLayoutLookup;
}): ThreadLayout | undefined {
  const fallbackLayout =
    params.layoutLookup.fallbackThreadLayoutMap?.[params.block.threadId] ??
    params.fallbackThreadLayoutMap?.[params.block.threadId];
  if (
    fallbackLayout &&
    !fallbackLayout.visible &&
    (params.block.threadRef == null || fallbackLayout.threadRef === params.block.threadRef)
  ) {
    return fallbackLayout;
  }

  if (params.block.threadRef != null) {
    const refLayout = params.layoutLookup.threadLayoutsByRef.get(params.block.threadRef);
    if (refLayout) {
      return refLayout;
    }
  }
  if (params.block.spanRef != null) {
    const spanLayout = params.layoutLookup.threadLayoutsBySpanRef.get(params.block.spanRef);
    if (spanLayout) {
      return spanLayout;
    }
    const threadRef = params.layoutLookup.traceGraph.getThreadRefBySpanRef(params.block.spanRef);
    if (threadRef != null) {
      const refLayout = params.layoutLookup.threadLayoutsByRef.get(threadRef);
      if (refLayout) {
        return refLayout;
      }
    }
  }

  return fallbackLayout;
}

/**
 * Resolves a block's process layout from span refs before using compatibility stream ids.
 */
export function getProcessLayoutForGeometryBlock(params: {
  block: TraceSpanGeometrySource;
  fallbackStreamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
  layoutLookup: TraceGeometryLayoutLookup;
}): ProcessLayout | undefined {
  if (params.block.processRef != null) {
    const refLayout = params.layoutLookup.processLayoutsByRef.get(params.block.processRef);
    if (refLayout) {
      return refLayout;
    }
  }
  if (params.block.spanRef != null) {
    const spanLayout = params.layoutLookup.processLayoutsBySpanRef.get(params.block.spanRef);
    if (spanLayout) {
      return spanLayout;
    }
    const processRef = params.layoutLookup.traceGraph.getProcessRefBySpanRef(params.block.spanRef);
    if (processRef != null) {
      const refLayout = params.layoutLookup.processLayoutsByRef.get(processRef);
      if (refLayout) {
        return refLayout;
      }
    }
  }

  return (
    params.layoutLookup.fallbackStreamToProcessLayoutMap?.[params.block.threadId] ??
    params.fallbackStreamToProcessLayoutMap?.[params.block.threadId]
  );
}

/** Resolves the timing projection used by block and dependency geometry. */
export function resolveGeometryBlock(
  block: TraceSpanGeometrySource,
  timingKey?: string | null
): TraceSpanGeometrySource {
  if (!timingKey) {
    return block;
  }

  const resolvedKey = block.timings[timingKey] ? timingKey : block.primaryTimingKey;
  const resolvedTiming = block.timings[resolvedKey];
  if (!resolvedTiming) {
    return block;
  }
  if (resolvedKey === block.primaryTimingKey && Object.keys(block.timings).length === 1) {
    return block;
  }

  return {
    ...block,
    primaryTimingKey: resolvedKey,
    timings: {[resolvedKey]: resolvedTiming}
  } satisfies TraceSpanGeometrySource;
}

/**
 * Resolve the concrete timing key that geometry generation would use for one block.
 */
export function resolveGeometryTimingKey(
  block: TraceSpanGeometrySource,
  timingKey?: string | null
): string {
  if (!timingKey) {
    return block.primaryTimingKey;
  }
  return block.timings[timingKey] ? timingKey : block.primaryTimingKey;
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
