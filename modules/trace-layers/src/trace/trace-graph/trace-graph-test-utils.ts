import type {ArrowTraceProcessMetadata} from '../ingestion/arrow-trace';
import type {TraceSpanDisplaySource} from '../trace-graph-accessors';
import type {TraceGraph} from './trace-graph';
import type {
  ProcessRef,
  ThreadRef,
  VisibleCrossDependencyRef,
  VisibleLocalDependencyRef
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
  /** Visible local dependencies touching the block in either direction. */
  localDependencies: readonly Extract<TraceDependency, {type: 'trace-local-dependency'}>[];
  /** Visible cross-rank dependencies touching the block in either direction. */
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

/** Returns the unique visible local dependency ref for a fixture dependency id. */
export function getRequiredVisibleLocalDependencyRefById(
  traceGraph: TraceGraph,
  dependencyId: TraceDependencyId
): VisibleLocalDependencyRef {
  const dependencyRefs = traceGraph
    .getVisibleProcessRefs()
    .flatMap(processRef => traceGraph.getVisibleLocalDependencyRefs(processRef))
    .filter(
      dependencyRef => traceGraph.getVisibleDependencyIdByRef(dependencyRef) === dependencyId
    );
  if (dependencyRefs.length !== 1) {
    throw new Error(
      `Expected one visible local dependency ref for ${dependencyId}, found ${dependencyRefs.length}`
    );
  }
  return dependencyRefs[0]!;
}

/** Returns the unique visible cross dependency ref for a fixture dependency id. */
export function getRequiredVisibleCrossDependencyRefById(
  traceGraph: TraceGraph,
  dependencyId: TraceDependencyId
): VisibleCrossDependencyRef {
  const dependencyRefs = traceGraph
    .getVisibleCrossDependencyRefs()
    .filter(
      dependencyRef => traceGraph.getVisibleDependencyIdByRef(dependencyRef) === dependencyId
    );
  if (dependencyRefs.length !== 1) {
    throw new Error(
      `Expected one visible cross dependency ref for ${dependencyId}, found ${dependencyRefs.length}`
    );
  }
  return dependencyRefs[0]!;
}

/** Returns the exact runtime span ref for a known test block id. */
export function getRequiredSpanRefBySpanId(traceGraph: TraceGraph, spanId: TraceSpanId): SpanRef {
  const spanRef = traceGraph.getSpanRefByExternalBlockId(spanId as never);
  if (spanRef == null) {
    throw new Error(`Expected span ref for block ${spanId}`);
  }
  return spanRef;
}

/** Returns a visible display source by source block id for test assertions. */
export function getRequiredVisibleDisplaySourceBySpanId(
  traceGraph: TraceGraph,
  spanId: TraceSpanId
): TraceSpanDisplaySource {
  const block = traceGraph.getVisibleDisplaySourceBySpanRef(
    getRequiredSpanRefBySpanId(traceGraph, spanId)
  );
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
  return filteredParentRef == null
    ? null
    : (traceGraph.getVisibleSpanId(filteredParentRef) ?? null);
}

/** Returns the raw dependency chain for one test block using exact span refs. */
export function getTraceGraphDependencyChainForBlock(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike,
  dependencyKey: string
) {
  return traceGraph.getDependencyChainBySpanRef(
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
  return traceGraph.getVisibleDependencyChainBySpanRef(
    getRequiredSpanRef(traceGraph, block),
    dependencyKey
  );
}

/** Returns visible dependency groupings for one test block. */
export function getTraceGraphSpanDependencies(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike
): TraceGraphBlockDependencySnapshot {
  const projection = traceGraph.getProjection();
  const spanRef = getRequiredSpanRef(traceGraph, block);
  const inDependencies = projection.inDependenciesBySpanRef.get(spanRef) ?? [];
  const outDependencies = projection.outDependenciesBySpanRef.get(spanRef) ?? [];
  const dependencies = dedupeDependenciesById([...inDependencies, ...outDependencies]);

  return {
    inDependencies,
    outDependencies,
    localDependencies: dependencies.filter(
      (dependency): dependency is Extract<TraceDependency, {type: 'trace-local-dependency'}> =>
        dependency.type === 'trace-local-dependency'
    ),
    crossRankDependencies: dependencies.filter(
      (
        dependency
      ): dependency is Extract<TraceDependency, {type: 'trace-cross-process-dependency'}> =>
        dependency.type === 'trace-cross-process-dependency'
    )
  };
}

/** Returns visible endpoint/dependency pairs for one test block. */
export function getTraceGraphEndpointsWithDependencies(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike
): ReadonlyArray<[TraceCrossProcessEndpoint, TraceCrossProcessDependency | null]> {
  return traceGraph
    .getTraceSpanEndpointsWithDependencies(getRequiredSpanRef(traceGraph, block))
    .map(({endpoint, dependency}) => [endpoint, dependency]);
}

/** Returns selected-card parent-chain rows for one test block. */
export function getTraceGraphParentChainEntries(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike,
  options?: {includeHidden?: boolean}
) {
  return traceGraph.getTraceSpanParentChainEntries(getRequiredSpanRef(traceGraph, block), options);
}

/** Returns selected-card incoming dependency rows for one test block. */
export function getTraceGraphIncomingDependencyEntries(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike,
  options?: {includeHidden?: boolean}
) {
  return traceGraph.getTraceSpanIncomingDependencyEntries(
    getRequiredSpanRef(traceGraph, block),
    options
  );
}

/** Returns selected-card child-dependency rows for one test block. */
export function getTraceGraphChildDependencies(traceGraph: TraceGraph, block: TraceGraphBlockLike) {
  return traceGraph.getTraceSpanChildDependencies(getRequiredSpanRef(traceGraph, block));
}

/** Returns selected-card descendant rows for one test block. */
export function getTraceGraphDescendants(
  traceGraph: TraceGraph,
  block: TraceGraphBlockLike,
  options?: Parameters<TraceGraph['getTraceSpanDescendants']>[1]
) {
  return traceGraph.getTraceSpanDescendants(getRequiredSpanRef(traceGraph, block), options);
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
