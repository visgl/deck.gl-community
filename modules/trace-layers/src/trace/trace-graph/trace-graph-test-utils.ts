import {
  getTraceSpanChildDependencies,
  getTraceSpanDependencyChain,
  getTraceSpanDescendants,
  getTraceSpanEndpointsWithDependencies,
  getTraceSpanIncomingDependencyEntries,
  getTraceSpanParentChainEntries,
  getTraceSpanVisibleDependencyChain
} from './build-trace-span-card-data';
import {materializeTraceCrossProcessDependencyFromArrowRow} from './trace-cross-process-dependency-table';
import {getCrossProcessDependencyRefIndex} from './trace-id-encoder';

import type {ArrowTraceProcessMetadata} from '../ingestion/arrow-trace';
import type {TraceSpanDetailSource} from '../trace-graph-accessors';
import type {TraceGraph} from './trace-graph';
import type {
  CrossProcessDependencyRef,
  ProcessRef,
  SameProcessDependencyRef,
  ThreadRef
} from './trace-id-encoder';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceDependency,
  TraceDependencyId,
  TraceSpan,
  TraceSpanId,
  TraceThread
} from './trace-types';

type TraceGraphBlockLike = Readonly<Pick<TraceSpan, 'spanId' | 'threadId'>>;

/** Groups visible dependencies attached to one block for test assertions. */
export type TraceGraphBlockDependencySnapshot = {
  /** Visible incoming dependencies keyed by the destination block. */
  inDependencies: readonly TraceDependency[];
  /** Visible outgoing dependencies keyed by the source block. */
  outDependencies: readonly TraceDependency[];
  /** Visible same-process dependencies touching the block in either direction. */
  sameProcessDependencies: readonly Extract<
    TraceDependency,
    {type: 'trace-same-process-dependency'}
  >[];
  /** Visible cross-process dependencies touching the block in either direction. */
  crossRankDependencies: readonly Extract<
    TraceDependency,
    {type: 'trace-cross-process-dependency'}
  >[];
};

/** Returns the exact runtime span ref for a source test block. */
export function getRequiredSpanRef(traceGraph: TraceGraph, block: TraceGraphBlockLike): SpanRef {
  const processId = traceGraph.threadMap[block.threadId]?.processId;
  const processRef = processId ? getRequiredProcessRef(traceGraph, processId) : null;
  const spanRef =
    processRef != null ? traceGraph.getProcessScopedSpanRef(processRef, block.spanId) : null;
  if (spanRef == null) {
    throw new Error(`Expected span ref for block ${block.spanId}`);
  }
  return spanRef;
}

/** Returns the unique visible same-process dependency ref for a fixture dependency id. */
export function getRequiredSameProcessDependencyRefById(
  traceGraph: TraceGraph,
  dependencyId: TraceDependencyId
): SameProcessDependencyRef {
  const dependencyRefs = traceGraph
    .getVisibleProcessRefs()
    .flatMap(processRef =>
      Array.from(traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(processRef))
    )
    .filter(dependencyRef => traceGraph.getDependencyId(dependencyRef) === dependencyId);
  if (dependencyRefs.length !== 1) {
    throw new Error(
      `Expected one visible same-process dependency ref for ${dependencyId}, found ${dependencyRefs.length}`
    );
  }
  return dependencyRefs[0]!;
}

/** Returns the unique visible cross-process dependency ref for a fixture dependency id. */
export function getRequiredCrossProcessDependencyRefById(
  traceGraph: TraceGraph,
  dependencyId: TraceDependencyId
): CrossProcessDependencyRef {
  const dependencyRefs = Array.from(traceGraph.iterateVisibleCrossProcessDependencyRefs()).filter(
    dependencyRef => traceGraph.getDependencyId(dependencyRef) === dependencyId
  );
  if (dependencyRefs.length !== 1) {
    throw new Error(
      `Expected one visible cross-process dependency ref for ${dependencyId}, found ${dependencyRefs.length}`
    );
  }
  return dependencyRefs[0]!;
}

/** Returns the exact runtime span ref for a known test block id. */
export function getRequiredSpanRefBySpanId(traceGraph: TraceGraph, spanId: TraceSpanId): SpanRef {
  const spanRef = traceGraph.getSpanRefById(spanId as never);
  if (spanRef == null) {
    throw new Error(`Expected span ref for block ${spanId}`);
  }
  return spanRef;
}

/** Returns a visible render source by source block id for test assertions. */
export function getRequiredVisibleDisplaySourceBySpanId(
  traceGraph: TraceGraph,
  spanId: TraceSpanId
): TraceSpanDetailSource {
  const spanRef = getRequiredSpanRefBySpanId(traceGraph, spanId);
  const block = traceGraph.isSpanVisible(spanRef) ? traceGraph.getSpanDetailSource(spanRef) : null;
  if (!block) {
    throw new Error(`Expected visible display source for block ${spanId}`);
  }
  return block;
}

/** Returns the canonical process ref for one ingestion rank id in tests. */
export function getRequiredProcessRef(traceGraph: TraceGraph, processId: string): ProcessRef {
  const processIndex = traceGraph.processes.findIndex(process => process.processId === processId);
  const processRef = processIndex >= 0 ? (traceGraph.getProcessRefs()[processIndex] ?? null) : null;
  if (processRef == null) {
    throw new Error(`Expected process ref for rank ${processId}`);
  }
  return processRef;
}

/** Returns the canonical thread ref for one ingestion stream id in tests. */
export function getRequiredThreadRef(traceGraph: TraceGraph, threadId: string): ThreadRef {
  for (const processRef of traceGraph.getProcessRefs()) {
    const threadRef = traceGraph
      .getThreadSourcesByProcessRef(processRef)
      .find(threadSource => threadSource.threadId === threadId)?.threadRef;
    if (threadRef != null) {
      return threadRef;
    }
  }
  throw new Error(`Expected thread ref for stream ${threadId}`);
}

/** Returns whether one source test block is filtered from the current visible graph. */
export function isTraceGraphBlockFiltered(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike
): boolean {
  return traceGraph.spanIsFiltered(getRequiredSpanRef(traceGraph, block));
}

/** Returns the nearest visible ancestor block id for a filtered test block. */
export function getTraceGraphFilteredParentSpanId(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike
): TraceSpanId | null {
  const filteredParentRef = traceGraph.getTraceSpanFilteredParentRef(
    getRequiredSpanRef(traceGraph, block)
  );
  return filteredParentRef == null || !traceGraph.isSpanVisible(filteredParentRef)
    ? null
    : traceGraph.getSpanId(filteredParentRef);
}

/** Returns the raw dependency chain for one test block using exact span refs. */
export function getTraceGraphDependencyChainForBlock(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike,
  dependencyKey: string
) {
  return getTraceSpanDependencyChain(
    traceGraph,
    getRequiredSpanRef(traceGraph, block),
    dependencyKey
  );
}

/** Returns the visible dependency chain for one test block using exact span refs. */
export function getTraceGraphVisibleDependencyChainForBlock(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike,
  dependencyKey: string
) {
  return getTraceSpanVisibleDependencyChain(
    traceGraph,
    getRequiredSpanRef(traceGraph, block),
    dependencyKey
  );
}

/** Returns visible dependency groupings for one test block. */
export function getTraceGraphSpanDependencies(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike
): TraceGraphBlockDependencySnapshot {
  const spanRef = getRequiredSpanRef(traceGraph, block);
  const inDependencies = getVisibleDependenciesForDirection(traceGraph, spanRef, 'incoming');
  const outDependencies = getVisibleDependenciesForDirection(traceGraph, spanRef, 'outgoing');
  const dependencies = dedupeDependenciesById([...inDependencies, ...outDependencies]);

  return {
    inDependencies,
    outDependencies,
    sameProcessDependencies: dependencies.filter(
      (
        dependency
      ): dependency is Extract<TraceDependency, {type: 'trace-same-process-dependency'}> =>
        dependency.type === 'trace-same-process-dependency'
    ),
    crossRankDependencies: dependencies.filter(
      (
        dependency
      ): dependency is Extract<TraceDependency, {type: 'trace-cross-process-dependency'}> =>
        dependency.type === 'trace-cross-process-dependency'
    )
  };
}

/** Materializes only visible dependency rows touching one test span in one direction. */
function getVisibleDependenciesForDirection(
  traceGraph: TraceGraph,
  spanRef: SpanRef,
  direction: 'incoming' | 'outgoing'
): readonly TraceDependency[] {
  return traceGraph
    .getVisibleDirectionalDependencyRefSlice(spanRef, direction, Number.POSITIVE_INFINITY)
    .dependencyRefs.flatMap((dependencyRef): TraceDependency[] => {
      const dependencySource = traceGraph.getDependencySource(dependencyRef);
      if (dependencySource?.type === 'trace-same-process-dependency') {
        return [
          {
            ...dependencySource,
            keywords: new Set(dependencySource.keywords)
          } satisfies TraceDependency
        ];
      }
      if (dependencySource?.type !== 'trace-cross-process-dependency') {
        return [];
      }
      const dependency = materializeTraceCrossProcessDependencyFromArrowRow({
        crossProcessDependencyTable: traceGraph.crossProcessDependencyTable,
        rowIndex: getCrossProcessDependencyRefIndex(dependencyRef as CrossProcessDependencyRef)
      });
      return [dependency];
    });
}

/** Returns visible endpoint/dependency pairs for one test block. */
export function getTraceGraphEndpointsWithDependencies(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike
): ReadonlyArray<[TraceCrossProcessEndpoint, TraceCrossProcessDependency | null]> {
  return getTraceSpanEndpointsWithDependencies(
    traceGraph,
    getRequiredSpanRef(traceGraph, block)
  ).map(({endpoint, dependency}) => [endpoint, dependency]);
}

/** Returns selected-card parent-chain rows for one test block. */
export function getTraceGraphParentChainEntries(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike,
  options?: {includeHidden?: boolean}
) {
  return getTraceSpanParentChainEntries({
    traceGraph,
    spanRef: getRequiredSpanRef(traceGraph, block),
    includeHidden: options?.includeHidden ?? false
  });
}

/** Returns selected-card incoming dependency rows for one test block. */
export function getTraceGraphIncomingDependencyEntries(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike,
  options?: {includeHidden?: boolean}
) {
  return getTraceSpanIncomingDependencyEntries({
    traceGraph,
    spanRef: getRequiredSpanRef(traceGraph, block),
    includeHidden: options?.includeHidden ?? false
  });
}

/** Returns selected-card child-dependency rows for one test block. */
export function getTraceGraphChildDependencies(traceGraph: TraceGraph, block: TraceGraphBlockLike) {
  return getTraceSpanChildDependencies(traceGraph, getRequiredSpanRef(traceGraph, block));
}

/** Returns selected-card descendant rows for one test block. */
export function getTraceGraphDescendants(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike,
  options?: Parameters<typeof getTraceSpanDescendants>[2]
) {
  return getTraceSpanDescendants(traceGraph, getRequiredSpanRef(traceGraph, block), options);
}

/** Returns the owning process metadata for one test block. */
export function getTraceGraphProcessForBlock(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike
): ArrowTraceProcessMetadata | null {
  const processRef = traceGraph.getProcessRefBySpanRef(getRequiredSpanRef(traceGraph, block));
  if (processRef == null) {
    return null;
  }
  return traceGraph.processes[traceGraph.getProcessRefs().indexOf(processRef)] ?? null;
}

/** Returns the owning thread metadata for one test block. */
export function getTraceGraphThreadForBlock(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike
): TraceThread | null {
  const threadRef = traceGraph.getThreadRefBySpanRef(getRequiredSpanRef(traceGraph, block));
  if (threadRef == null) {
    return null;
  }
  for (const processRef of traceGraph.getProcessRefs()) {
    const processIndex = traceGraph.getProcessRefs().indexOf(processRef);
    const threadIndex = traceGraph.getThreadRefsByProcessRef(processRef).indexOf(threadRef);
    if (threadIndex >= 0) {
      return traceGraph.processes[processIndex]?.threads[threadIndex] ?? null;
    }
  }
  return null;
}

/** Returns the owning rank number for one test block. */
export function getTraceGraphRankNumForBlock(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike
): number | null {
  return traceGraph.getRankNumBySpanRef(getRequiredSpanRef(traceGraph, block));
}

function dedupeDependenciesById(
  dependencies: readonly TraceDependency[]
): readonly TraceDependency[] {
  const dependencyMap = new Map<TraceDependencyId, TraceDependency>();

  for (const dependency of dependencies) {
    dependencyMap.set(dependency.dependencyId, dependency);
  }

  return [...dependencyMap.values()];
}
