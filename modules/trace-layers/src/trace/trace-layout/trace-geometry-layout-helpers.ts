import {TraceGraph} from '../trace-graph/trace-graph';
import {getTraceGraphProcessLaneAssignmentMode} from '../trace-graph/trace-graph-runtime-helpers';
import {
  getVisibleSpanGeometrySourcesByProcess,
  getVisibleSpanLayoutLaneSourcesByProcess
} from '../trace-graph/trace-graph-visible-span-sources';
import {getProcessRefIndex} from '../trace-graph/trace-id-encoder';
import {getTraceLayoutBoundsFromStructure} from './trace-layout';

import type {ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
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
  TraceLayoutSpanLaneColumns,
  TraceLayoutVisibleProcessMetadata
} from './trace-layout';

/** Builds sorted visible process metadata used by filtered geometry generation. */
export function buildTraceLayoutProcesses(
  traceGraph: Readonly<TraceGraph>
): readonly TraceLayoutVisibleProcessMetadata[] {
  const visibleProcesses: TraceLayoutVisibleProcessMetadata[] = [];
  const visibleProcessRefs = traceGraph.getVisibleProcessRefs();
  for (const processRef of visibleProcessRefs) {
    const processSource = traceGraph.getProcessSourceByRef(processRef);
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

  return sortVisibleTraceLayoutProcessesByProcessOrder(visibleProcesses);
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

/**
 * Resolves the visible geometry spans for one process directly from the filtered source graph.
 */
export function getVisibleGeometrySpansForProcess(
  traceGraph: Readonly<TraceGraph>,
  processRef: ProcessRef
): readonly TraceSpanGeometrySource[] {
  return getVisibleSpanGeometrySourcesByProcess(traceGraph, processRef);
}

/** Resolves lightweight visible lane spans for one process directly from the filtered source graph. */
export function getVisibleLaneSpansForProcess(
  traceGraph: Readonly<TraceGraph>,
  process: Readonly<TraceLayoutVisibleProcessMetadata>
): readonly TraceLayoutLaneSpanSource[] {
  if (getTraceGraphProcessLaneAssignmentMode(process?.userData) === 'none') {
    // Lane-disabled layout only consumes span refs/timing, so keep the geometry-only source.
    return getVisibleSpanGeometrySourcesByProcess(
      traceGraph,
      process.processRef
    ) as readonly TraceLayoutLaneSpanSource[];
  }
  return getVisibleSpanLayoutLaneSourcesByProcess(traceGraph, process.processRef);
}

/** Resolves lightweight visible lane dependencies for one process from the filtered source graph. */
export function getVisibleLaneSameProcessDependenciesForProcess(
  traceGraph: Readonly<TraceGraph>,
  processRef: ProcessRef
): readonly TraceLayoutLaneDependencySource[] {
  return traceGraph.getVisibleSameProcessDependencyLayoutSources(processRef);
}

/** Builds ref-native lane layout lookup state for one TraceGraph/layout pair. */
export function buildTraceGeometryLayoutLookup(params: {
  /** TraceGraph that resolves visible span refs to owner process/thread refs. */
  traceGraph: Pick<TraceGraph, 'getProcessRefBySpanRef' | 'getThreadRefBySpanRef'>;
  /** Generated lane columns aligned with canonical Arrow span-table rows. */
  spanLaneColumnsByChunkIndex?: TraceLayoutSpanLaneColumns;
  /** Process layouts keyed by canonical runtime process ref. */
  processLayoutMapByRef: ReadonlyMap<ProcessRef, ProcessLayout>;
  /** Thread layouts keyed by canonical runtime thread ref. */
  threadLayoutMapByRef: ReadonlyMap<ThreadRef, ThreadLayout>;
}): TraceGeometryLayoutLookup {
  return {
    traceGraph: params.traceGraph,
    spanLaneColumnsByChunkIndex: params.spanLaneColumnsByChunkIndex,
    threadLayoutsByRef: params.threadLayoutMapByRef,
    processLayoutsByRef: params.processLayoutMapByRef
  };
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
