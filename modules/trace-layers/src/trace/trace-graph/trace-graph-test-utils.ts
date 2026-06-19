import {createTraceLayoutGeometryColumn} from '../trace-layout/trace-layout';
import {
  getCrossDependencyRefChunkIndex,
  getCrossDependencyRefRowIndex,
  getLocalDependencyRefProcessIndex,
  getLocalDependencyRefRowIndex,
  getSpanRefChunkIndex,
  getSpanRefRowIndex
} from './trace-id-encoder';

import type {ArrowTraceProcessMetadata} from '../ingestion/arrow-trace';
import type {TraceSpanDisplaySource} from '../trace-graph-accessors';
import type {
  TraceLayoutDependencyGeometryChunk,
  TraceLayoutGeometryColumn,
  TraceLayoutSpanGeometryChunk
} from '../trace-layout/trace-layout';
import type {TraceGraph} from './trace-graph';
import type {
  CrossDependencyRef,
  LocalDependencyRef,
  ProcessRef,
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
  /** Visible local dependencies touching the block in either direction. */
  localDependencies: readonly Extract<TraceDependency, {type: 'trace-local-dependency'}>[];
  /** Visible cross-rank dependencies touching the block in either direction. */
  crossRankDependencies: readonly Extract<
    TraceDependency,
    {type: 'trace-cross-process-dependency'}
  >[];
};

/** Builds span geometry chunks for tests from exact encoded span refs. */
export function buildTraceLayoutSpanGeometryChunksForTest(
  entries: readonly (readonly [SpanRef, ArrayLike<number>])[]
): TraceLayoutSpanGeometryChunk[] {
  return buildTraceLayoutGeometryChunksForTest(entries, getSpanRefChunkIndex, getSpanRefRowIndex);
}

/** Merges exact span-ref geometry rows into existing test span geometry chunks. */
export function mergeTraceLayoutSpanGeometryChunksForTest(
  baseChunks: readonly TraceLayoutSpanGeometryChunk[] | undefined,
  entries: readonly (readonly [SpanRef, ArrayLike<number>])[]
): TraceLayoutSpanGeometryChunk[] {
  return mergeTraceLayoutGeometryChunksForTest(
    baseChunks,
    entries,
    getSpanRefChunkIndex,
    getSpanRefRowIndex
  );
}

/** Builds local-dependency geometry chunks for tests from exact encoded dependency refs. */
export function buildTraceLayoutLocalDependencyGeometryChunksForTest(
  entries: readonly (readonly [LocalDependencyRef, ArrayLike<number>])[]
): TraceLayoutDependencyGeometryChunk[] {
  return buildTraceLayoutGeometryChunksForTest(
    entries,
    getLocalDependencyRefProcessIndex,
    getLocalDependencyRefRowIndex
  );
}

/** Builds cross-dependency geometry chunks for tests from exact encoded dependency refs. */
export function buildTraceLayoutCrossDependencyGeometryChunksForTest(
  entries: readonly (readonly [CrossDependencyRef, ArrayLike<number>])[]
): TraceLayoutDependencyGeometryChunk[] {
  return buildTraceLayoutGeometryChunksForTest(
    entries,
    getCrossDependencyRefChunkIndex,
    getCrossDependencyRefRowIndex
  );
}

/** Builds sparse geometry chunks by writing each encoded ref into its row-aligned slot. */
function buildTraceLayoutGeometryChunksForTest<
  Ref extends number,
  Chunk extends TraceLayoutGeometryColumn
>(
  entries: readonly (readonly [Ref, ArrayLike<number>])[],
  getChunkIndex: (ref: Ref) => number,
  getRowIndex: (ref: Ref) => number
): Chunk[] {
  const chunks: Chunk[] = [];
  for (const [ref, geometry] of entries) {
    writeTraceLayoutGeometryRowForTest(
      getOrCreateTraceLayoutGeometryChunkForTest(chunks, getChunkIndex(ref), getRowIndex(ref) + 1),
      getRowIndex(ref),
      geometry
    );
  }
  return chunks;
}

/** Returns copied base chunks plus additional geometry rows for mutation-free test setup. */
function mergeTraceLayoutGeometryChunksForTest<
  Ref extends number,
  Chunk extends TraceLayoutGeometryColumn
>(
  baseChunks: readonly Chunk[] | undefined,
  entries: readonly (readonly [Ref, ArrayLike<number>])[],
  getChunkIndex: (ref: Ref) => number,
  getRowIndex: (ref: Ref) => number
): Chunk[] {
  const chunks: Chunk[] = [];
  for (const [chunkIndex, chunk] of (baseChunks ?? []).entries()) {
    if (!chunk) {
      continue;
    }
    const copy = createTraceLayoutGeometryColumn(chunk.table.numRows) as Chunk;
    copy.values.set(chunk.values);
    chunks[chunkIndex] = copy;
  }
  for (const [ref, geometry] of entries) {
    writeTraceLayoutGeometryRowForTest(
      getOrCreateTraceLayoutGeometryChunkForTest(chunks, getChunkIndex(ref), getRowIndex(ref) + 1),
      getRowIndex(ref),
      geometry
    );
  }
  return chunks;
}

/** Returns a sparse geometry chunk with at least the requested number of rows. */
function getOrCreateTraceLayoutGeometryChunkForTest<Chunk extends TraceLayoutGeometryColumn>(
  chunks: Chunk[],
  chunkIndex: number,
  rowCount: number
): Chunk {
  const existing = chunks[chunkIndex];
  if (existing && existing.table.numRows >= rowCount) {
    return existing;
  }
  const nextChunk = createTraceLayoutGeometryColumn(rowCount) as Chunk;
  if (existing) {
    nextChunk.values.set(existing.values);
  }
  chunks[chunkIndex] = nextChunk;
  return nextChunk;
}

/** Writes one four-number geometry row into a test geometry chunk. */
function writeTraceLayoutGeometryRowForTest(
  chunk: TraceLayoutGeometryColumn,
  rowIndex: number,
  geometry: ArrayLike<number>
): void {
  const offset = rowIndex * 4;
  chunk.values[offset] = geometry[0] ?? 0;
  chunk.values[offset + 1] = geometry[1] ?? 0;
  chunk.values[offset + 2] = geometry[2] ?? 0;
  chunk.values[offset + 3] = geometry[3] ?? 0;
}

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
  const inDependencies = projection.inDependenciesBySpanId[block.spanId] ?? [];
  const outDependencies = projection.outDependenciesBySpanId[block.spanId] ?? [];
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
