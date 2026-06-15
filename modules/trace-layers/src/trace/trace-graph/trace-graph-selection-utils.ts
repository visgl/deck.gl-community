import * as arrow from 'apache-arrow';

import {MappedArrowTable} from '../../arrow-utils/index';
import {log} from '../log';
import {
  getArrowTraceSpanField,
  getTraceGraphSpanDisplaySource,
  getUniqueTraceGraphSpanRef,
  iterateTraceGraphProcessSpanRefs
} from '../trace-graph-accessors';
import {
  encodeCrossDependencyRef,
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  getCrossDependencyRefIndex,
  getProcessRefIndex,
  isCrossDependencyRef,
  isLocalDependencyRef,
  isVisibleCrossDependencyRef,
  isVisibleLocalDependencyRef
} from './trace-id-encoder';
import {getPrimaryTiming} from './trace-types';

import type {ArrowTraceLocalDependencyTable} from '../ingestion/arrow-trace';
import type {TraceDependencySource, TraceSpanDisplaySource} from '../trace-graph-accessors';
import type {TraceGraph} from './trace-graph';
import type {
  TraceGraphChildDependency,
  TraceGraphDescendantEntry,
  TraceGraphDescendantResult,
  TraceGraphPathBlockSource,
  TraceGraphPathCrossDependencySource,
  TraceGraphPathDependencySource,
  TraceGraphPathLocalDependencySource,
  TraceGraphSelectedCrossDependencySource,
  TraceGraphSelectedLocalDependencySource,
  TraceSelectedDependencyDirection,
  TraceSpanDependencySelection
} from './trace-graph-types';
import type {
  CrossDependencyRef,
  VisibleCrossDependencyRef,
  VisibleLocalDependencyRef
} from './trace-id-encoder';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceDependency,
  TraceDependencyId,
  TraceLocalDependency,
  TracePath,
  TraceProcessId,
  TraceSpan,
  TraceSpanId,
  TraceThreadId
} from './trace-types';

export {
  buildTraceSpanDescendants,
  buildTraceSpanDependencySelection,
  endpointMatchesCrossDependency,
  endpointMatchesCrossDependencyValues,
  getTaggedCrossDependencyRefRowIndex,
  getLocalDependencyLookupByProcessId,
  getOrderedVisiblePathBlockSources,
  getProcessIdByRankNum,
  getProcessScopedSpanRefsByProcessId,
  getSelectedCardSpanRef,
  getVisiblePathBlockSources,
  getVisiblePathDependencySources,
  getVisibleSelectedCrossDependencySource,
  getVisibleSelectedCrossDependencySourceByLegacyRowIndex,
  getVisibleSelectedLocalDependencySource,
  getVisibleSelectedLocalDependencySourceByLegacyRowIndex,
  isParentCrossDependency,
  isParentDependency,
  isParentLocalDependency,
  isUnresolvedCrossEndpoint,
  isVisibleSpanRef,
  materializeTraceSpanBySpanRef
};

type ArrowTraceLocalDependencyTableTypeMap =
  ArrowTraceLocalDependencyTable extends arrow.Table<infer TTypeMap> ? TTypeMap : never;
type TraceGraphLocalDependencyLookup = MappedArrowTable<ArrowTraceLocalDependencyTableTypeMap>;

type TraceGraphProjection = {
  /** Groups incoming visible dependencies by exact span ref. */
  inDependenciesBySpanRef: ReadonlyMap<SpanRef, ReadonlyArray<TraceDependency>>;
  /** Groups outgoing visible dependencies by exact span ref. */
  outDependenciesBySpanRef: ReadonlyMap<SpanRef, ReadonlyArray<TraceDependency>>;
  /** Maps visible endpoint rows to their resolved dependency by exact span ref. */
  endpointsWithDependenciesBySpanRef: ReadonlyMap<
    SpanRef,
    ReadonlyArray<[TraceCrossProcessEndpoint, TraceCrossProcessDependency | null]>
  >;
};

const PARENT_KEYWORD = 'PARENT';
const TRACE_DEPENDENCY_SELECTION_PROBE_QUERY_PARAM = 'traceDependencySelectionProbe';
const TRACE_CHILD_DEPENDENT_TRAVERSAL_PROBE_QUERY_PARAM = 'traceChildTraversalProbe';
let isTraceDependencySelectionProbeEnabledCache: boolean | null = null;
let isTraceChildDependentTraversalProbeEnabledCache: boolean | null = null;

const localDependencyLookupByProcessIdCache = new WeakMap<
  Readonly<TraceGraph>,
  Readonly<Record<TraceProcessId, TraceGraphLocalDependencyLookup>>
>();

/** Caches process-scoped span refs keyed by process id and block id. */
const processScopedSpanRefsByProcessIdCache = new WeakMap<
  Readonly<TraceGraph>,
  Readonly<Record<TraceProcessId, ReadonlyMap<TraceSpanId, SpanRef>>>
>();

/** Caches process ids keyed by rank number for exact cross-process span resolution. */
const processIdByRankNumCache = new WeakMap<
  Readonly<TraceGraph>,
  ReadonlyMap<number, TraceProcessId>
>();

/**
 * Builds one dependency-id keyed mapped Arrow view over a canonical dependency table.
 */
function buildMappedDependencyLookup<TTypeMap extends arrow.TypeMap & {dependencyId: arrow.Utf8}>(
  table: Readonly<arrow.Table<TTypeMap>>
): MappedArrowTable<TTypeMap> {
  const dependencyIdColumn = table.getChild('dependencyId');
  const rowIndexMap = new Map<string, number>();

  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    const dependencyId =
      (dependencyIdColumn?.get(rowIndex) as TraceDependencyId | null | undefined) ?? null;
    if (dependencyId) {
      rowIndexMap.set(dependencyId, rowIndex);
    }
  }

  return new MappedArrowTable(table as arrow.Table<TTypeMap>, rowIndexMap);
}

/**
 * Returns per-process dependency-id keyed local dependency views for one trace graph.
 */
function getLocalDependencyLookupByProcessId(
  traceGraph: Readonly<TraceGraph>
): Readonly<Record<TraceProcessId, TraceGraphLocalDependencyLookup>> {
  const cachedLookup = localDependencyLookupByProcessIdCache.get(traceGraph);
  if (cachedLookup) {
    return cachedLookup;
  }

  const nextLookup = Object.fromEntries(
    traceGraph.processes.map(process => {
      const processId = process.processId as TraceProcessId;
      return [
        processId,
        buildMappedDependencyLookup(traceGraph.localDependencyTableMap[processId])
      ] as const;
    })
  ) as Readonly<Record<TraceProcessId, TraceGraphLocalDependencyLookup>>;
  localDependencyLookupByProcessIdCache.set(traceGraph, nextLookup);
  return nextLookup;
}

/**
 * Returns exact process-local span refs keyed by process id and block id.
 */
function getProcessScopedSpanRefsByProcessId(
  traceGraph: Readonly<TraceGraph>
): Readonly<Record<TraceProcessId, ReadonlyMap<TraceSpanId, SpanRef>>> {
  const cachedProcessScopedSpanRefs = processScopedSpanRefsByProcessIdCache.get(traceGraph);
  if (cachedProcessScopedSpanRefs) {
    return cachedProcessScopedSpanRefs;
  }

  const nextProcessScopedSpanRefs = Object.fromEntries(
    traceGraph.processes.map((process, processIndex) => {
      const processId = process.processId as TraceProcessId;
      const processRef = traceGraph.getProcessRefs()[processIndex] ?? null;
      const processScopedSpanRefs = new Map<TraceSpanId, SpanRef>();

      if (processRef != null) {
        for (const spanRef of iterateTraceGraphProcessSpanRefs(traceGraph, processId)) {
          const spanId = getArrowTraceSpanField(
            traceGraph,
            spanRef,
            'spanId'
          ) as TraceSpanId | null;
          if (spanId) {
            processScopedSpanRefs.set(spanId, spanRef);
          }
        }
      }

      return [processId, processScopedSpanRefs] as const;
    })
  ) as Readonly<Record<TraceProcessId, ReadonlyMap<TraceSpanId, SpanRef>>>;

  processScopedSpanRefsByProcessIdCache.set(traceGraph, nextProcessScopedSpanRefs);
  return nextProcessScopedSpanRefs;
}

/**
 * Returns process ids keyed by rank number for exact cross-process span resolution.
 */
function getProcessIdByRankNum(
  traceGraph: Readonly<TraceGraph>
): ReadonlyMap<number, TraceProcessId> {
  const cachedProcessIdByRankNum = processIdByRankNumCache.get(traceGraph);
  if (cachedProcessIdByRankNum) {
    return cachedProcessIdByRankNum;
  }

  const nextProcessIdByRankNum = new Map(
    traceGraph.processes.map(
      process => [process.rankNum, process.processId as TraceProcessId] as const
    )
  );
  processIdByRankNumCache.set(traceGraph, nextProcessIdByRankNum);
  return nextProcessIdByRankNum;
}

/**
 * Materializes one exact block from a process-aware span ref.
 */
function materializeTraceSpanBySpanRef(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef
): TraceSpan | null {
  const displaySource = traceGraph.getSpanDisplaySource(spanRef);
  if (!displaySource) {
    return null;
  }

  const localDependencies = [
    ...traceGraph.getSpanDirectionalDependencySources(spanRef, 'incoming'),
    ...traceGraph.getSpanDirectionalDependencySources(spanRef, 'outgoing')
  ].filter(
    (dependency): dependency is TraceLocalDependency => dependency.type === 'trace-local-dependency'
  );
  const localDependenciesByRef = new Map(
    localDependencies.map(dependency => [
      dependency.dependencyRef ?? dependency.dependencyId,
      dependency
    ])
  );

  return {
    type: 'trace-span',
    spanRef: displaySource.spanRef,
    spanId: displaySource.spanId,
    threadId: displaySource.threadId,
    processName: displaySource.processName,
    name: displaySource.name,
    keywords: displaySource.keywords,
    primaryTimingKey: displaySource.primaryTimingKey,
    timings: displaySource.timings,
    localDependencyIds: displaySource.localDependencyIds,
    localDependencies: [...localDependenciesByRef.values()],
    crossProcessEndpointId: displaySource.crossProcessEndpointId,
    crossProcessDependencyEndpoints: displaySource.crossProcessDependencyEndpoints,
    userData: displaySource.userData
  } satisfies TraceSpan;
}

/**
 * Resolves the exact selected-card span ref from the block's owning stream/process.
 */
function getSelectedCardSpanRef(
  traceGraph: Readonly<TraceGraph>,
  block: Readonly<Pick<TraceSpan, 'spanRef' | 'spanId' | 'threadId'>>
): SpanRef | null {
  if (block.spanRef != null && spanRefMatchesBlock(traceGraph, block.spanRef, block)) {
    return block.spanRef;
  }

  return (
    getProcessScopedSpanRef(traceGraph, block.spanId, block.threadId) ??
    getUniqueTraceGraphSpanRef(traceGraph, block.spanId)
  );
}

/** Returns whether one runtime span ref still identifies the supplied materialized block. */
function spanRefMatchesBlock(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef,
  block: Readonly<Pick<TraceSpan, 'spanId' | 'threadId'>>
): boolean {
  return (
    traceGraph.getSpanBlockId(spanRef) === block.spanId &&
    traceGraph.getThreadSourceBySpanRef(spanRef)?.threadId === block.threadId
  );
}

/** Resolves one exact process-scoped span ref from the block id and owning stream id. */
function getProcessScopedSpanRef(
  traceGraph: Readonly<TraceGraph>,
  spanId: TraceSpanId,
  threadId: TraceThreadId
): SpanRef | null {
  const processId = traceGraph.threadMap[threadId]?.processId as TraceProcessId | undefined;
  if (!processId) {
    return null;
  }

  return getProcessScopedSpanRefsByProcessId(traceGraph)[processId]?.get(spanId) ?? null;
}

/**
 * Resolves the owning process id from the span row's runtime process ref.
 */
function getProcessIdBySpanRef(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef
): TraceProcessId | null {
  const processRef = traceGraph.getProcessRefBySpanRef(spanRef);
  return processRef == null
    ? null
    : (traceGraph.processIdsByIndex[getProcessRefIndex(processRef)] ?? null);
}

/** Converts Arrow `Uint64` ref values back to safe JavaScript numbers. */
/**
 * Returns whether one exact span ref remains visible after filtering.
 */
function isVisibleSpanRef(traceGraph: Readonly<TraceGraph>, spanRef: SpanRef): boolean {
  const processId = getProcessIdBySpanRef(traceGraph, spanRef);
  if (!processId) {
    return false;
  }
  return !isSpanRefFiltered(traceGraph, spanRef);
}

/**
 * Returns whether the exact span ref is filtered in the current visible graph.
 */
function isSpanRefFiltered(traceGraph: Readonly<TraceGraph>, spanRef: SpanRef): boolean {
  return traceGraph.spanIsFiltered(spanRef);
}

function hasParentKeyword(keywords: ReadonlySet<string>): boolean {
  return [...keywords].some(keyword => keyword.toUpperCase() === PARENT_KEYWORD);
}

function isParentLocalDependency(dependency: Readonly<{keywords: ReadonlySet<string>}>): boolean {
  return hasParentKeyword(dependency.keywords);
}

function isParentCrossDependency(
  dependency: Readonly<{keywords: ReadonlySet<string>; topology: string}>
): boolean {
  return hasParentKeyword(dependency.keywords) || dependency.topology === 'parent';
}

function isParentDependency(
  dependency:
    | Readonly<{type: 'trace-local-dependency'; keywords: ReadonlySet<string>}>
    | Readonly<{
        type: 'trace-cross-process-dependency';
        keywords: ReadonlySet<string>;
        topology: string;
      }>
): boolean {
  return dependency.type === 'trace-local-dependency'
    ? isParentLocalDependency(dependency)
    : isParentCrossDependency(dependency);
}

function endpointMatchesCrossDependency(params: {
  endpoint: TraceCrossProcessEndpoint;
  dependency: TraceCrossProcessDependency;
}): boolean {
  const {endpoint, dependency} = params;
  return endpointMatchesCrossDependencyValues({
    endpoint,
    endpointId: dependency.endpointId,
    startRankNum: dependency.startRankNum,
    endRankNum: dependency.endRankNum
  });
}

/**
 * Returns whether one endpoint matches the scalar identity of a cross-process dependency row.
 */
function endpointMatchesCrossDependencyValues(params: {
  endpoint: TraceCrossProcessEndpoint;
  endpointId: TraceCrossProcessEndpointId;
  startRankNum: number;
  endRankNum: number;
}): boolean {
  const {endpoint, endpointId, startRankNum, endRankNum} = params;
  return (
    endpointId === endpoint.endpointId &&
    (endRankNum === endpoint.endRankNum || startRankNum === endpoint.endRankNum)
  );
}

function isUnresolvedCrossEndpoint(params: {
  spanId: TraceSpanId;
  endpoint: TraceCrossProcessEndpoint;
  spanDependencyMap: Readonly<Record<TraceSpanId, readonly TraceDependency[]>>;
}): boolean {
  const {spanId, endpoint, spanDependencyMap} = params;
  const dependencies = spanDependencyMap[spanId] ?? [];
  return !dependencies.some(
    dependency =>
      dependency.type === 'trace-cross-process-dependency' &&
      endpointMatchesCrossDependency({
        endpoint,
        dependency
      })
  );
}

/**
 * Builds the ref-native parent/child dependency traversal used by extended selection.
 */
function buildTraceSpanDependencySelection(params: {
  /** Origin span ref for the traversal. */
  spanRef: SpanRef;
  /** Visible trace graph used for dependency lookup. */
  traceGraph: Readonly<TraceGraph>;
  /** Dependency keywords accepted by the traversal. */
  keywords: ReadonlySet<string>;
  /** Maximum number of ancestor spans to include. */
  upLimit?: number;
  /** Maximum number of descendant spans to include. */
  downLimit?: number;
}): TraceSpanDependencySelection {
  const {spanRef, traceGraph, keywords} = params;
  const originSpanId = traceGraph.getVisibleSpanId(spanRef);
  if (!originSpanId) {
    if (isTraceDependencySelectionProbeEnabled()) {
      log.probe(0, 'TraceGraph dependency selection', {
        stage: 'missingOrigin',
        spanRef,
        keywordCount: keywords.size
      })();
    }
    return createEmptyTraceSpanDependencySelection(spanRef);
  }

  const upLimit = params.upLimit ?? Number.POSITIVE_INFINITY;
  const downLimit = params.downLimit ?? Number.POSITIVE_INFINITY;
  const processScopedSpanRefsByProcessId = getProcessScopedSpanRefsByProcessId(traceGraph);
  const processIdByRankNum = getProcessIdByRankNum(traceGraph);
  const originProcessId = getProcessIdBySpanRef(traceGraph, spanRef);
  const spanRefs: SpanRef[] = [spanRef];
  const parentSpanRefs: SpanRef[] = [];
  const childSpanRefs: SpanRef[] = [];
  const visibleLocalDependencyRefs = new Set<VisibleLocalDependencyRef>();
  const visibleCrossDependencyRefs = new Set<VisibleCrossDependencyRef>();
  const parentLocalDependencyRefs = new Set<VisibleLocalDependencyRef>();
  const parentCrossDependencyRefs = new Set<VisibleCrossDependencyRef>();
  const childLocalDependencyRefs = new Set<VisibleLocalDependencyRef>();
  const childCrossDependencyRefs = new Set<VisibleCrossDependencyRef>();
  type TraceGraphTraversalNode = {
    /** Visible block id for this traversal frontier node. */
    spanId: TraceSpanId;
    /** Exact visible span ref for this traversal frontier node. */
    spanRef: SpanRef;
    /** Owning process id used to disambiguate duplicate block ids. */
    processId: TraceProcessId | null;
  };
  const resolveNextSpanRef = (params: {
    spanId: TraceSpanId;
    processId: TraceProcessId | null;
  }): TraceGraphTraversalNode | null => {
    const scopedSpanRef = params.processId
      ? (processScopedSpanRefsByProcessId[params.processId]?.get(params.spanId) ?? null)
      : null;
    if (scopedSpanRef != null) {
      return {
        spanId: params.spanId,
        spanRef: scopedSpanRef,
        processId: params.processId
      };
    }

    return null;
  };
  const visited = new Set<SpanRef>([spanRef]);
  const upQueue: TraceGraphTraversalNode[] = [
    {
      spanId: originSpanId,
      spanRef,
      processId: originProcessId
    }
  ];
  const downQueue: TraceGraphTraversalNode[] = [
    {
      spanId: originSpanId,
      spanRef,
      processId: originProcessId
    }
  ];
  const processedUp = new Set<SpanRef>();
  const processedDown = new Set<SpanRef>();
  let upCount = 0;
  let downCount = 0;

  const recordDependency = (dependency: TraceDependencySource, direction: 'up' | 'down') => {
    if (dependency.type === 'trace-cross-process-dependency') {
      const rawDependencyRef = dependency.dependencyRef;
      const dependencyRef =
        rawDependencyRef != null && isVisibleCrossDependencyRef(rawDependencyRef)
          ? rawDependencyRef
          : rawDependencyRef != null && isCrossDependencyRef(rawDependencyRef)
            ? traceGraph.getVisibleCrossDependencyRefBySourceRef(rawDependencyRef)
            : null;
      if (dependencyRef == null) {
        return;
      }
      visibleCrossDependencyRefs.add(dependencyRef);
      if (direction === 'up') {
        parentCrossDependencyRefs.add(dependencyRef);
      } else {
        childCrossDependencyRefs.add(dependencyRef);
      }
    } else {
      const rawDependencyRef = dependency.dependencyRef;
      const dependencyRef =
        rawDependencyRef != null && isVisibleLocalDependencyRef(rawDependencyRef)
          ? rawDependencyRef
          : rawDependencyRef != null && isLocalDependencyRef(rawDependencyRef)
            ? traceGraph.getVisibleLocalDependencyRefBySourceRef(rawDependencyRef)
            : null;
      if (dependencyRef == null) {
        return;
      }
      visibleLocalDependencyRefs.add(dependencyRef);
      if (direction === 'up') {
        parentLocalDependencyRefs.add(dependencyRef);
      } else {
        childLocalDependencyRefs.add(dependencyRef);
      }
    }
  };

  const maybeAddBlock = (
    nextNode: TraceGraphTraversalNode | null,
    direction: 'up' | 'down'
  ): TraceGraphTraversalNode | null => {
    if (nextNode == null || visited.has(nextNode.spanRef)) {
      return null;
    }
    visited.add(nextNode.spanRef);
    spanRefs.push(nextNode.spanRef);
    if (direction === 'up') {
      upCount += 1;
      parentSpanRefs.push(nextNode.spanRef);
    } else {
      downCount += 1;
      childSpanRefs.push(nextNode.spanRef);
    }
    return nextNode;
  };
  const getDependenciesForNode = (
    currentNode: TraceGraphTraversalNode,
    direction: 'incoming' | 'outgoing'
  ): TraceDependencySource[] => {
    return getVisibleDependencySourcesForSpanDirection({
      traceGraph,
      spanRef: currentNode.spanRef,
      direction
    });
  };

  while (upQueue.length > 0 && upCount < upLimit) {
    const currentNode = upQueue.shift();
    if (!currentNode || processedUp.has(currentNode.spanRef)) {
      continue;
    }
    processedUp.add(currentNode.spanRef);
    const dependenciesForBlock = getDependenciesForNode(currentNode, 'incoming');
    for (const dependency of dependenciesForBlock) {
      if (
        dependency.endSpanRef !== currentNode.spanRef ||
        !dependencyMatchesSelectionKeywords(dependency, keywords)
      ) {
        continue;
      }
      recordDependency(dependency, 'up');
      const nextSpanId = dependency.startSpanId;
      const nextNode = resolveNextSpanRef({
        spanId: nextSpanId,
        processId:
          dependency.type === 'trace-cross-process-dependency'
            ? (processIdByRankNum.get(dependency.startRankNum) ?? currentNode.processId ?? null)
            : currentNode.processId
      });
      if (upCount < upLimit) {
        const addedNode = maybeAddBlock(nextNode, 'up');
        if (addedNode && !processedUp.has(addedNode.spanRef)) {
          upQueue.push(addedNode);
        }
      }
    }
  }

  while (downQueue.length > 0 && downCount < downLimit) {
    const currentNode = downQueue.shift();
    if (!currentNode || processedDown.has(currentNode.spanRef)) {
      continue;
    }
    processedDown.add(currentNode.spanRef);
    const dependenciesForBlock = getDependenciesForNode(currentNode, 'outgoing');
    for (const dependency of dependenciesForBlock) {
      if (
        dependency.startSpanRef !== currentNode.spanRef ||
        !dependencyMatchesSelectionKeywords(dependency, keywords)
      ) {
        continue;
      }
      recordDependency(dependency, 'down');
      const nextSpanId = dependency.endSpanId;
      const nextNode = resolveNextSpanRef({
        spanId: nextSpanId,
        processId:
          dependency.type === 'trace-cross-process-dependency'
            ? (processIdByRankNum.get(dependency.endRankNum) ?? currentNode.processId ?? null)
            : currentNode.processId
      });
      if (downCount < downLimit) {
        const addedNode = maybeAddBlock(nextNode, 'down');
        if (addedNode && !processedDown.has(addedNode.spanRef)) {
          downQueue.push(addedNode);
        }
      }
    }
  }

  const selection = {
    originSpanRef: spanRef,
    parentSpanRefs,
    childSpanRefs,
    spanRefs,
    parentLocalDependencyRefs: Array.from(parentLocalDependencyRefs),
    parentCrossDependencyRefs: Array.from(parentCrossDependencyRefs),
    childLocalDependencyRefs: Array.from(childLocalDependencyRefs),
    childCrossDependencyRefs: Array.from(childCrossDependencyRefs),
    visibleLocalDependencyRefs: Array.from(visibleLocalDependencyRefs),
    visibleCrossDependencyRefs: Array.from(visibleCrossDependencyRefs)
  };
  if (isTraceDependencySelectionProbeEnabled()) {
    log.probe(0, 'TraceGraph dependency selection', {
      stage: 'end',
      originSpanRef: spanRef,
      originSpanId,
      keywordCount: keywords.size,
      parentSpanRefCount: parentSpanRefs.length,
      childSpanRefCount: childSpanRefs.length,
      spanRefCount: spanRefs.length,
      parentLocalDependencyRefCount: parentLocalDependencyRefs.size,
      parentCrossDependencyRefCount: parentCrossDependencyRefs.size,
      childLocalDependencyRefCount: childLocalDependencyRefs.size,
      childCrossDependencyRefCount: childCrossDependencyRefs.size,
      visibleLocalDependencyRefCount: visibleLocalDependencyRefs.size,
      visibleCrossDependencyRefCount: visibleCrossDependencyRefs.size,
      parentSpanIds: parentSpanRefs
        .slice(0, 10)
        .map(parentSpanRef => traceGraph.getVisibleSpanId(parentSpanRef)),
      childSpanIds: childSpanRefs
        .slice(0, 10)
        .map(childSpanRef => traceGraph.getVisibleSpanId(childSpanRef)),
      visibleLocalDependencyIds: selection.visibleLocalDependencyRefs
        .slice(0, 10)
        .map(dependencyRef => traceGraph.getVisibleDependencyIdByRef(dependencyRef)),
      visibleCrossDependencyIds: selection.visibleCrossDependencyRefs
        .slice(0, 10)
        .map(dependencyRef => traceGraph.getVisibleDependencyIdByRef(dependencyRef))
    })();
  }
  return selection;
}

/**
 * Builds an empty dependency-selection result for invalid or non-visible origin spans.
 */
function createEmptyTraceSpanDependencySelection(spanRef: SpanRef): TraceSpanDependencySelection {
  return {
    originSpanRef: spanRef,
    parentSpanRefs: [],
    childSpanRefs: [],
    spanRefs: [],
    parentLocalDependencyRefs: [],
    parentCrossDependencyRefs: [],
    childLocalDependencyRefs: [],
    childCrossDependencyRefs: [],
    visibleLocalDependencyRefs: [],
    visibleCrossDependencyRefs: []
  };
}

/**
 * Returns visible dependency sources attached to one span direction from sidecar refs.
 */
function getVisibleDependencySourcesForSpanDirection(params: {
  /** Trace graph that owns the selected span. */
  traceGraph: Readonly<TraceGraph>;
  /** Exact visible span ref whose dependency refs should be read. */
  spanRef: SpanRef;
  /** Directional dependency list to read. */
  direction: 'incoming' | 'outgoing';
}): TraceDependencySource[] {
  return [
    ...params.traceGraph.getSpanDirectionalDependencySources(params.spanRef, params.direction)
  ];
}

/**
 * Returns whether runtime dependency-selection probes should be emitted.
 */
function isTraceDependencySelectionProbeEnabled(): boolean {
  try {
    if (typeof globalThis !== 'undefined') {
      if (
        (globalThis as {traceLayers?: {probeDependencySelection?: boolean}}).traceLayers
          ?.probeDependencySelection === true
      ) {
        isTraceDependencySelectionProbeEnabledCache = true;
        return true;
      }
    }
  } catch {
    // no-op
  }

  if (isTraceDependencySelectionProbeEnabledCache != null) {
    return isTraceDependencySelectionProbeEnabledCache;
  }

  let enabled = false;
  try {
    const locationLike = globalThis.location;
    if (locationLike && locationLike.search) {
      const searchParams = new URL(locationLike.href).searchParams;
      enabled =
        searchParams.has(TRACE_DEPENDENCY_SELECTION_PROBE_QUERY_PARAM) ||
        searchParams.has(TRACE_CHILD_DEPENDENT_TRAVERSAL_PROBE_QUERY_PARAM);
    }
  } catch {
    enabled = false;
  }

  isTraceDependencySelectionProbeEnabledCache = enabled;
  return enabled;
}

/**
 * Returns whether a dependency should participate in a keyword-restricted selection traversal.
 */
function dependencyMatchesSelectionKeywords(
  dependency:
    | Readonly<{type: 'trace-local-dependency'; keywords: ReadonlySet<string>}>
    | Readonly<{
        type: 'trace-cross-process-dependency';
        keywords: ReadonlySet<string>;
        topology: string;
      }>,
  keywords: ReadonlySet<string>
): boolean {
  if (keywords.size === 0) {
    return true;
  }
  if (hasParentKeyword(keywords) && isParentDependency(dependency)) {
    return true;
  }
  for (const keyword of keywords) {
    if (hasCaseInsensitiveKeyword(dependency.keywords, keyword)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns whether a keyword set contains the target keyword without requiring exact casing.
 */
function hasCaseInsensitiveKeyword(keywords: ReadonlySet<string>, targetKeyword: string): boolean {
  const normalizedTargetKeyword = targetKeyword.toUpperCase();
  return [...keywords].some(keyword => keyword.toUpperCase() === normalizedTargetKeyword);
}

/**
 * Builds the selected-overlay source for one visible local dependency ref.
 */
function getVisibleSelectedLocalDependencySource(params: {
  /** Trace graph containing visible dependency lookup tables. */
  traceGraph: Readonly<TraceGraph>;
  /** Visible local dependency ref to resolve. */
  dependencyRef: VisibleLocalDependencyRef;
  /** Direction of the selected dependency relative to the selected origin span. */
  selectedDirection?: TraceSelectedDependencyDirection;
}): TraceGraphSelectedLocalDependencySource | null {
  const processRef = params.traceGraph.getVisibleLocalDependencyProcessRefByRef(
    params.dependencyRef
  );
  if (processRef == null) {
    return null;
  }
  return {
    dependencyRef: params.dependencyRef,
    processRef,
    selectedDirection: params.selectedDirection ?? 'incoming',
    waitTimeMs: params.traceGraph.getVisibleDependencyWaitTimeMs(params.dependencyRef) ?? 0,
    bidirectional:
      params.traceGraph.getVisibleDependencyBidirectional(params.dependencyRef) === true
  };
}

/**
 * Resolves a locally-scoped dependency id from an unbranded row index.
 */
function getVisibleSelectedLocalDependencySourceByLegacyRowIndex(params: {
  /** Trace graph containing process-local local-dependency tables. */
  traceGraph: Readonly<TraceGraph>;
  /** Unbranded process-local dependency row index. */
  dependencyRowIndex: number;
}): TraceGraphSelectedLocalDependencySource | null {
  if (!Number.isSafeInteger(params.dependencyRowIndex) || params.dependencyRowIndex < 0) {
    return null;
  }

  for (const [processIndex, processId] of params.traceGraph.processIdsByIndex.entries()) {
    const dependencyTable = params.traceGraph.localDependencyTableMap[processId];
    if (!dependencyTable || params.dependencyRowIndex >= dependencyTable.numRows) {
      continue;
    }

    const sourceDependencyRef = encodeLocalDependencyRef(
      encodeLocalSpanRef(processIndex, params.dependencyRowIndex)
    );
    const dependencyRef =
      params.traceGraph.getVisibleLocalDependencyRefBySourceRef(sourceDependencyRef);
    const source = dependencyRef
      ? getVisibleSelectedLocalDependencySource({
          traceGraph: params.traceGraph,
          dependencyRef,
          selectedDirection: 'incoming'
        })
      : null;
    if (source) {
      return source;
    }
  }

  return null;
}

/**
 * Builds the selected-overlay source for one visible cross dependency ref.
 */
function getVisibleSelectedCrossDependencySource(params: {
  /** Trace graph containing visible dependency lookup tables. */
  traceGraph: Readonly<TraceGraph>;
  /** Visible cross dependency ref to resolve. */
  dependencyRef: VisibleCrossDependencyRef;
  /** Direction of the selected dependency relative to the selected origin span. */
  selectedDirection?: TraceSelectedDependencyDirection;
}): TraceGraphSelectedCrossDependencySource | null {
  const visibleDependency = params.traceGraph.getVisibleDependencyRenderSourceByRef(
    params.dependencyRef
  );
  if (!visibleDependency || visibleDependency.type !== 'trace-cross-process-dependency') {
    return null;
  }

  return {
    dependencyRef: params.dependencyRef,
    selectedDirection: params.selectedDirection ?? 'incoming',
    waitTimeMs: typeof visibleDependency.waitTimeMs === 'number' ? visibleDependency.waitTimeMs : 0,
    bidirectional: visibleDependency.bidirectional === true
  };
}

/**
 * Resolves a visible cross-dependency source from an unbranded row index.
 */
function getVisibleSelectedCrossDependencySourceByLegacyRowIndex(params: {
  /** Trace graph containing cross-dependency rows. */
  traceGraph: Readonly<TraceGraph>;
  /** Unbranded cross-dependency table row index. */
  dependencyRowIndex: number;
}): TraceGraphSelectedCrossDependencySource | null {
  const rowIndex = params.dependencyRowIndex;
  if (
    !Number.isSafeInteger(rowIndex) ||
    rowIndex < 0 ||
    rowIndex >= params.traceGraph.crossDependencyTable.numRows
  ) {
    return null;
  }

  const sourceDependencyRef = encodeCrossDependencyRef(rowIndex);
  const dependencyRef =
    params.traceGraph.getVisibleCrossDependencyRefBySourceRef(sourceDependencyRef);
  return dependencyRef
    ? getVisibleSelectedCrossDependencySource({
        traceGraph: params.traceGraph,
        dependencyRef,
        selectedDirection: 'incoming'
      })
    : null;
}

/**
 * Builds a path block source from an exact visible span ref.
 */
function getVisiblePathBlockSourceBySpanRef(params: {
  /** Trace graph containing visible span lookup tables. */
  traceGraph: Readonly<TraceGraph>;
  /** Exact visible span ref to resolve. */
  spanRef: SpanRef;
}): TraceGraphPathBlockSource | null {
  const span = getTraceGraphSpanDisplaySource(params.traceGraph, params.spanRef);
  const spanId = span?.spanId ?? null;
  if (!span || !spanId) {
    return null;
  }
  return {
    spanRef: params.spanRef,
    spanId,
    span
  };
}

/**
 * Builds a path dependency source from an exact visible local dependency ref.
 */
function getVisiblePathLocalDependencySourceByRef(params: {
  /** Trace graph containing visible dependency lookup tables. */
  traceGraph: Readonly<TraceGraph>;
  /** Exact visible local dependency ref to resolve. */
  dependencyRef: VisibleLocalDependencyRef;
}): TraceGraphPathLocalDependencySource | null {
  const dependency = params.traceGraph.getVisibleDependencySourceByRef(params.dependencyRef);
  if (!dependency || dependency.type !== 'trace-local-dependency') {
    return null;
  }
  return {
    dependencyRef: params.dependencyRef,
    dependency
  };
}

/**
 * Builds a path dependency source from an exact visible cross dependency ref.
 */
function getVisiblePathCrossDependencySourceByRef(params: {
  /** Trace graph containing visible dependency lookup tables. */
  traceGraph: Readonly<TraceGraph>;
  /** Exact visible cross dependency ref to resolve. */
  dependencyRef: VisibleCrossDependencyRef;
}): TraceGraphPathCrossDependencySource | null {
  const dependency = params.traceGraph.getVisibleDependencySourceByRef(params.dependencyRef);
  if (!dependency || dependency.type !== 'trace-cross-process-dependency') {
    return null;
  }
  return {
    dependencyRef: params.dependencyRef,
    dependency
  };
}

/**
 * Resolves all visible path block sources for a runtime path.
 */
function getVisiblePathBlockSources(params: {
  /** Path carrying ref-native or compatibility block identifiers. */
  path: Readonly<TracePath>;
  /** Trace graph used to resolve path refs. */
  traceGraph: Readonly<TraceGraph>;
}): TraceGraphPathBlockSource[] {
  return getRuntimePathSpanRefs(params.path).flatMap(spanRef => {
    const blockSource = getVisiblePathBlockSourceBySpanRef({
      traceGraph: params.traceGraph,
      spanRef
    });
    return blockSource ? [blockSource] : [];
  });
}

/**
 * Resolves visible path block sources in path order when ordered refs are available.
 */
function getOrderedVisiblePathBlockSources(params: {
  /** Path carrying ref-native or compatibility block identifiers. */
  path: Readonly<TracePath>;
  /** Trace graph used to resolve path refs. */
  traceGraph: Readonly<TraceGraph>;
}): TraceGraphPathBlockSource[] {
  return getOrderedRuntimePathSpanRefs(params.path).flatMap(spanRef => {
    const blockSource = getVisiblePathBlockSourceBySpanRef({
      traceGraph: params.traceGraph,
      spanRef
    });
    return blockSource ? [blockSource] : [];
  });
}

/**
 * Resolves visible path dependency sources from ref-native fields with ID fallback.
 */
function getVisiblePathDependencySources(params: {
  /** Path carrying ref-native or compatibility dependency identifiers. */
  path: Readonly<TracePath>;
  /** Trace graph used to resolve path dependency refs. */
  traceGraph: Readonly<TraceGraph>;
}): TraceGraphPathDependencySource[] {
  if (
    (params.path.visibleLocalDependencyRefSet?.size ?? 0) > 0 ||
    (params.path.visibleCrossDependencyRefSet?.size ?? 0) > 0
  ) {
    return [
      ...getRuntimePathVisibleLocalDependencyRefs(params.path).flatMap(dependencyRef => {
        const source = getVisiblePathLocalDependencySourceByRef({
          traceGraph: params.traceGraph,
          dependencyRef
        });
        return source ? [source] : [];
      }),
      ...getRuntimePathVisibleCrossDependencyRefs(params.path).flatMap(dependencyRef => {
        const source = getVisiblePathCrossDependencySourceByRef({
          traceGraph: params.traceGraph,
          dependencyRef
        });
        return source ? [source] : [];
      })
    ];
  }
  return [];
}

/**
 * Returns visible span refs for a path, falling back to compatibility block ids when needed.
 */
function getRuntimePathSpanRefs(path: Readonly<TracePath>): SpanRef[] {
  if ((path.spanRefSet?.size ?? 0) > 0) {
    return Array.from(path.spanRefSet);
  }
  return [];
}

/**
 * Returns ordered visible span refs for a path, falling back to ordered compatibility ids.
 */
function getOrderedRuntimePathSpanRefs(path: Readonly<TracePath>): SpanRef[] {
  if (path.orderedSpanRefs && path.orderedSpanRefs.length > 0) {
    return path.orderedSpanRefs;
  }
  if ((path.spanRefSet?.size ?? 0) > 0) {
    return Array.from(path.spanRefSet);
  }
  return [];
}

/**
 * Returns visible local dependency refs for a path, falling back to dependency ids when needed.
 */
function getRuntimePathVisibleLocalDependencyRefs(
  path: Readonly<TracePath>
): VisibleLocalDependencyRef[] {
  if ((path.visibleLocalDependencyRefSet?.size ?? 0) > 0) {
    return Array.from(path.visibleLocalDependencyRefSet);
  }
  return [];
}

/**
 * Returns visible cross dependency refs for a path, falling back to dependency ids when needed.
 */
function getRuntimePathVisibleCrossDependencyRefs(
  path: Readonly<TracePath>
): VisibleCrossDependencyRef[] {
  if ((path.visibleCrossDependencyRefSet?.size ?? 0) > 0) {
    return Array.from(path.visibleCrossDependencyRefSet);
  }
  return [];
}

/**
 * Resolves a tagged cross-dependency reference to a row index.
 */
function getTaggedCrossDependencyRefRowIndex(
  dependencyRef: CrossDependencyRef,
  traceGraph: Readonly<TraceGraph>
): number | null {
  if (!isCrossDependencyRef(dependencyRef)) {
    return null;
  }

  const rowIndex = getCrossDependencyRefIndex(dependencyRef);
  return rowIndex < traceGraph.crossDependencyTable.numRows ? rowIndex : null;
}

function setTraceChildDependencyTraversalProbe(enabled: boolean): void {
  try {
    if (typeof globalThis === 'undefined') {
      return;
    }
    const traceLayersObject = (
      globalThis as {traceLayers?: {probeChildDependencyTraversal?: boolean}}
    ).traceLayers;
    if (!traceLayersObject) {
      return;
    }
    if (enabled) {
      traceLayersObject.probeChildDependencyTraversal = true;
    }
  } catch {
    // no-op
  }
}

/**
 * Allows forcing traversal probes in environments where conditional probe thresholds filter logs.
 *
 * - Set `?traceChildTraversalProbe=1` in the page URL.
 * - Set `globalThis.traceLayers?.probeChildDependencyTraversal = true`.
 */
function isTraceChildDependentTraversalProbeEnabled(): boolean {
  try {
    if (typeof globalThis !== 'undefined') {
      if (
        (globalThis as {traceLayers?: {probeChildDependencyTraversal?: boolean}}).traceLayers
          ?.probeChildDependencyTraversal === true
      ) {
        isTraceChildDependentTraversalProbeEnabledCache = true;
        return true;
      }
    }
  } catch {
    // no-op
  }

  if (isTraceChildDependentTraversalProbeEnabledCache != null) {
    return isTraceChildDependentTraversalProbeEnabledCache;
  }

  let enabled = false;
  try {
    const locationLike = globalThis.location;
    if (locationLike && locationLike.search) {
      enabled = new URL(locationLike.href).searchParams.has(
        TRACE_CHILD_DEPENDENT_TRAVERSAL_PROBE_QUERY_PARAM
      );
    }
  } catch {
    enabled = false;
  }

  isTraceChildDependentTraversalProbeEnabledCache = enabled;
  if (enabled) {
    setTraceChildDependencyTraversalProbe(true);
  }
  return enabled;
}

/**
 * Builds recursive descendant rows and truncation metadata for a selected block.
 */
function buildTraceSpanDescendants(params: {
  /** Origin block whose descendants should be traversed. */
  block: Readonly<TraceSpan>;
  /** Trace graph supplying visible/source dependency projections. */
  traceGraph: Readonly<TraceGraph>;
  /** Whether hidden spans should be included in traversal output. */
  includeHidden: boolean;
  /** Dependency keywords accepted by the traversal. */
  keywords: ReadonlySet<string>;
  /** Maximum emitted descendant rows. */
  limit: number;
  /** Whether to compute the exact count of omitted descendants. */
  computeExactTruncatedCount?: boolean;
  /** Optional hard cap for visited traversal nodes. */
  maxTraversalNodes?: number;
}): TraceGraphDescendantResult {
  const {block, traceGraph, includeHidden, keywords} = params;
  const normalizedLimit =
    Number.isFinite(params.limit) && params.limit >= 0 ? Math.floor(params.limit) : 0;
  const computeExactTruncatedCount = params.computeExactTruncatedCount !== false;
  const normalizedMaxTraversalNodes =
    computeExactTruncatedCount ||
    !Number.isFinite(params.maxTraversalNodes as number) ||
    (params.maxTraversalNodes as number) <= 0
      ? Number.POSITIVE_INFINITY
      : Math.floor(params.maxTraversalNodes as number);
  const projection = includeHidden ? traceGraph.getSourceProjection() : traceGraph.getProjection();
  const blockSpanRef = getSelectedCardSpanRef(traceGraph, block);
  if (blockSpanRef == null) {
    return {
      entries: [],
      isTruncated: false,
      truncatedCount: 0,
      truncationCountIsExact: true,
      limit: normalizedLimit
    };
  }
  const traversalStartTimeMs = performance.now();
  const stats = createTraceGraphDescendantTraversalStats();
  const shouldLogTraversal = isTraceChildDependentTraversalProbeEnabled();
  if (shouldLogTraversal) {
    log.probe(0, 'TraceGraph getTraceSpanDescendants', {
      stage: 'start',
      spanId: block.spanId,
      includeHidden,
      limit: normalizedLimit,
      maxTraversalNodes: normalizedMaxTraversalNodes,
      projection: includeHidden ? 'source' : 'visible',
      keywordCount: keywords.size
    })();
  }

  const visited = new Set<SpanRef>([blockSpanRef]);
  const discovered = new Set<SpanRef>([blockSpanRef]);
  const sortKeyCacheBySpanRef = new Map<SpanRef, TraceGraphDescendantChildSortKey | null>();
  let traversalStopReason: 'complete' | 'resultLimit' | 'traversalLimit' = 'complete';
  const getChildSortKey = (spanRef: SpanRef): TraceGraphDescendantChildSortKey | null => {
    const cached = sortKeyCacheBySpanRef.get(spanRef);
    if (cached !== undefined) {
      return cached;
    }

    const sortKey = getDescendantChildSortKeys(traceGraph, spanRef);
    sortKeyCacheBySpanRef.set(spanRef, sortKey);
    return sortKey;
  };
  const initialChildDependencies = getTraceGraphDescendantChildDependencies({
    spanRef: blockSpanRef,
    projection,
    keywords,
    getChildSortKey,
    sort: true,
    stats
  });
  if (shouldLogTraversal) {
    log.probe(0, 'TraceGraph getTraceSpanDescendants', {
      stage: 'initialChildren',
      spanId: block.spanId,
      initialChildDependencyCount: initialChildDependencies.length
    })();
  }
  const stack: {
    dependency: TraceDependency;
    childSpanId: TraceSpanId;
    /** Child span ref queued for descendant traversal. */
    childSpanRef: SpanRef;
    parentSpanId: TraceSpanId;
    depth: number;
  }[] = [];
  for (let index = initialChildDependencies.length - 1; index >= 0; index -= 1) {
    const childDependency = initialChildDependencies[index];
    if (!childDependency || discovered.has(childDependency.childSpanRef)) {
      continue;
    }
    discovered.add(childDependency.childSpanRef);
    stack.push({
      dependency: childDependency.dependency,
      childSpanId: childDependency.childSpanId,
      childSpanRef: childDependency.childSpanRef,
      parentSpanId: block.spanId,
      depth: 1
    });
  }
  const allEntries: TraceGraphDescendantEntry[] = [];
  let emittedEntryCount = 0;
  let visitedDescendantCount = 0;
  let isTraversalBudgeted = false;
  let stoppedByResultLimit = false;

  while (stack.length > 0) {
    const currentEntry = stack.pop();
    if (!currentEntry) {
      continue;
    }

    stats.maxStackDepth = Math.max(stats.maxStackDepth, stack.length + 1);
    const childSpanId = currentEntry.childSpanId;
    const childSpanRef = currentEntry.childSpanRef;
    if (visited.has(childSpanRef) || childSpanRef === blockSpanRef) {
      continue;
    }
    visited.add(childSpanRef);
    visitedDescendantCount += 1;
    stats.visitedBlocks += 1;
    stats.maxDepth = Math.max(stats.maxDepth, currentEntry.depth);

    let emittedChildBlock: TraceSpan | null = null;
    const shouldEmit =
      includeHidden || traceGraph.getVisibleDisplaySourceBySpanRef(childSpanRef) != null;
    if (shouldEmit) {
      stats.blockLookupCalls += 1;
      emittedChildBlock = getTraceGraphDescendantDisplayBlock({
        traceGraph,
        spanRef: childSpanRef
      });
      if (emittedChildBlock) {
        emittedEntryCount += 1;
        if (allEntries.length < normalizedLimit) {
          allEntries.push({
            dependency: currentEntry.dependency,
            childBlock: emittedChildBlock,
            depth: currentEntry.depth,
            parentSpanId: currentEntry.parentSpanId
          });
        }
      } else {
        stats.missingBlockCalls += 1;
      }
    }

    if (!computeExactTruncatedCount && emittedEntryCount >= normalizedLimit) {
      traversalStopReason = 'resultLimit';
      stoppedByResultLimit = true;
      isTraversalBudgeted = true;
      break;
    }

    if (visitedDescendantCount >= normalizedMaxTraversalNodes) {
      traversalStopReason = 'traversalLimit';
      isTraversalBudgeted = true;
      break;
    }

    const childDependencies = getTraceGraphDescendantChildDependencies({
      spanRef: childSpanRef,
      keywords,
      projection,
      getChildSortKey,
      sort: emittedEntryCount < normalizedLimit,
      sortBudget: Math.max(0, normalizedLimit - emittedEntryCount),
      stats
    });
    for (let index = childDependencies.length - 1; index >= 0; index -= 1) {
      const childDependency = childDependencies[index];
      if (!childDependency) {
        continue;
      }
      if (discovered.has(childDependency.childSpanRef)) {
        continue;
      }
      discovered.add(childDependency.childSpanRef);
      stack.push({
        dependency: childDependency.dependency,
        childSpanId: childDependency.childSpanId,
        childSpanRef: childDependency.childSpanRef,
        parentSpanId: childSpanId,
        depth: currentEntry.depth + 1
      });
      stats.stackPushes += 1;
      stats.maxStackDepth = Math.max(stats.maxStackDepth, stack.length);
    }
  }

  const traversalDurationMs = performance.now() - traversalStartTimeMs;
  const isTruncated = computeExactTruncatedCount
    ? emittedEntryCount > normalizedLimit
    : stoppedByResultLimit || isTraversalBudgeted;
  const truncatedCount =
    isTraversalBudgeted && !computeExactTruncatedCount
      ? Math.max(1, Math.max(visitedDescendantCount, emittedEntryCount) - normalizedLimit)
      : Math.max(0, emittedEntryCount - normalizedLimit);
  if (
    shouldLogTraceSpanDescendantTraversal({
      traversalDurationMs,
      entries: emittedEntryCount,
      visited: visited.size,
      stats,
      forceLog: shouldLogTraversal
    })
  ) {
    log.probe(0, 'TraceGraph getTraceSpanDescendants', {
      spanId: block.spanId,
      stage: 'end',
      stopReason: traversalStopReason,
      includeHidden,
      limit: normalizedLimit,
      durationMs: Number(traversalDurationMs.toFixed(3)),
      entries: emittedEntryCount,
      isTruncated,
      truncatedCount,
      returnedEntries: allEntries.length,
      truncationCountIsExact: !isTraversalBudgeted,
      visitedBlockCount: visited.size,
      depth: stats.maxDepth,
      maxStackDepth: stats.maxStackDepth,
      candidateDependencies: stats.candidateDependencyCount,
      validDependencies: stats.validDependencyCount,
      missingBlockCalls: stats.missingBlockCalls,
      blockLookupCalls: stats.blockLookupCalls,
      stackPushes: stats.stackPushes,
      sortDurationMs: Number(stats.sortDurationMs.toFixed(3)),
      sortCalls: stats.sortCalls,
      maxTraversalNodes: normalizedMaxTraversalNodes
    })();
  }

  return {
    entries: allEntries,
    isTruncated,
    truncatedCount,
    truncationCountIsExact: !isTraversalBudgeted,
    limit: normalizedLimit
  };
}

/** Internal DFS edge candidate used while traversing descendant parent links. */
type TraceGraphDescendantTraversalDependency = {
  /** Dependency edge used to reach the candidate child. */
  dependency: TraceDependency;
  /** Candidate child block id reached by the dependency. */
  childSpanId: TraceSpanId;
  /** Exact candidate child span ref reached by the dependency. */
  childSpanRef: SpanRef;
  /** Sort key for stable sibling ordering. */
  childSortKey: TraceGraphDescendantChildSortKey;
};
/** Time-based sort key used to order descendant siblings. */
type TraceGraphDescendantChildSortKey = {
  /** Candidate child start time in milliseconds. */
  startTimeMs: number;
  /** Candidate child end time in milliseconds. */
  endTimeMs: number;
};

/**
 * Resolves the time sort key for one descendant candidate.
 */
function getDescendantChildSortKeys(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef
): TraceGraphDescendantChildSortKey | null {
  const startTimeMs = getArrowTraceSpanField(traceGraph, spanRef, 'startTimeMs');
  const endTimeMs = getArrowTraceSpanField(traceGraph, spanRef, 'endTimeMs');
  if (typeof startTimeMs !== 'number' || typeof endTimeMs !== 'number') {
    return null;
  }
  return {
    startTimeMs,
    endTimeMs
  };
}

/**
 * Builds a lightweight block-shaped row from an Arrow display source for descendant rendering.
 */
function buildTraceSpanFromDisplaySource(sourceBlock: Readonly<TraceSpanDisplaySource>): TraceSpan {
  return {
    type: 'trace-span',
    spanRef: sourceBlock.spanRef,
    spanId: sourceBlock.spanId,
    threadId: sourceBlock.threadId,
    processName: sourceBlock.processName,
    name: sourceBlock.name,
    keywords: [...sourceBlock.keywords],
    primaryTimingKey: sourceBlock.primaryTimingKey,
    timings: sourceBlock.timings,
    localDependencyIds: [...sourceBlock.localDependencyIds],
    localDependencies: [],
    crossProcessEndpointId: sourceBlock.crossProcessEndpointId,
    crossProcessDependencyEndpoints: [...sourceBlock.crossProcessDependencyEndpoints],
    userData: sourceBlock.userData
  } satisfies TraceSpan;
}

/**
 * Resolves a lightweight descendant block without paying full TraceSpan compatibility cost.
 */
function getTraceGraphDescendantDisplayBlock(params: {
  traceGraph: Readonly<TraceGraph>;
  /** Descendant span ref resolved into a lightweight display block. */
  spanRef: SpanRef;
}): TraceSpan | null {
  const sourceBlock = getTraceGraphSpanDisplaySource(params.traceGraph, params.spanRef);
  return sourceBlock ? buildTraceSpanFromDisplaySource(sourceBlock) : null;
}

/**
 * Returns outgoing parent dependencies eligible for descendant traversal.
 */
function getTraceGraphDescendantChildDependencies(params: {
  /** Exact current span ref whose outgoing dependencies should be inspected. */
  spanRef: SpanRef;
  /** Dependency projection used for visible or source traversal. */
  projection: TraceGraphProjection;
  /** Dependency keywords accepted by the traversal. */
  keywords: ReadonlySet<string>;
  /** Resolver for stable child sort keys. */
  getChildSortKey: (spanRef: SpanRef) => TraceGraphDescendantChildSortKey | null;
  /** Whether to sort candidate children by time. */
  sort: boolean;
  /** Optional cap on sorted candidates when only the first rows can be emitted. */
  sortBudget?: number;
  /** Optional traversal metrics accumulator. */
  stats?: TraceGraphDescendantTraversalStats;
}): TraceGraphDescendantTraversalDependency[] {
  if (params.stats) {
    params.stats.outgoingTraversalCalls += 1;
  }
  const dependencies = params.projection.outDependenciesBySpanRef.get(params.spanRef) ?? [];
  if (params.stats) {
    params.stats.candidateDependencyCount += dependencies.length;
  }

  const filteredDependencies = [] as TraceGraphDescendantTraversalDependency[];
  for (const dependency of dependencies) {
    if (
      dependency.startSpanRef !== params.spanRef ||
      !dependencyMatchesKeywords(dependency, params.keywords) ||
      !isParentDependency(dependency)
    ) {
      continue;
    }

    const childSpanRef = dependency.endSpanRef ?? null;
    const childSortKey = childSpanRef == null ? null : params.getChildSortKey(childSpanRef);
    if (childSpanRef == null || childSortKey == null) {
      if (params.stats) {
        params.stats.invalidSortKeys += 1;
      }
      continue;
    }
    filteredDependencies.push({
      dependency,
      childSpanId: dependency.endSpanId,
      childSpanRef,
      childSortKey
    });
  }

  if (params.sort && filteredDependencies.length > 1) {
    const sortStartTimeMs = performance.now();
    if (params.sortBudget != null && params.sortBudget >= 0) {
      const budget = Math.max(0, Math.floor(params.sortBudget));
      if (budget === 0) {
        filteredDependencies.length = 0;
      } else if (budget < filteredDependencies.length) {
        filteredDependencies.sort((left, right) =>
          compareTraceGraphDescendantChildKeys(
            left.childSortKey,
            right.childSortKey,
            left.childSpanId,
            right.childSpanId
          )
        );
        filteredDependencies.length = budget;
      } else {
        filteredDependencies.sort((left, right) =>
          compareTraceGraphDescendantChildKeys(
            left.childSortKey,
            right.childSortKey,
            left.childSpanId,
            right.childSpanId
          )
        );
      }
    } else {
      filteredDependencies.sort((left, right) =>
        compareTraceGraphDescendantChildKeys(
          left.childSortKey,
          right.childSortKey,
          left.childSpanId,
          right.childSpanId
        )
      );
    }
    if (params.stats) {
      params.stats.sortCalls += 1;
      params.stats.sortDurationMs += performance.now() - sortStartTimeMs;
    }
  }

  if (params.stats) {
    params.stats.validDependencyCount += filteredDependencies.length;
  }
  return filteredDependencies;
}

/** Captures descendant traversal metrics for optional trace logging. */
function createTraceGraphDescendantTraversalStats(): TraceGraphDescendantTraversalStats {
  return {
    outgoingTraversalCalls: 0,
    stackPushes: 0,
    candidateDependencyCount: 0,
    validDependencyCount: 0,
    blockLookupCalls: 0,
    missingBlockCalls: 0,
    visitedBlocks: 1,
    maxDepth: 1,
    maxStackDepth: 0,
    sortCalls: 0,
    invalidSortKeys: 0,
    sortDurationMs: 0
  };
}

/** Captures optional child-search tracing metadata used for internal performance visibility. */
type TraceGraphDescendantTraversalStats = {
  /** Number of times outgoing dependencies were collected for one block during traversal. */
  outgoingTraversalCalls: number;
  /** Number of dependency entries pushed onto the DFS stack. */
  stackPushes: number;
  /** Number of candidate outgoing edges inspected for the traversal. */
  candidateDependencyCount: number;
  /** Number of outgoing parent-edges that passed keyword/visibility filtering. */
  validDependencyCount: number;
  /** Number of `getSpan` checks performed while filtering child targets. */
  blockLookupCalls: number;
  /** Number of filtered child targets that failed block lookup. */
  missingBlockCalls: number;
  /** Number of distinct block ids added to the visited set. */
  visitedBlocks: number;
  /** Deepest tree depth reached during traversal. */
  maxDepth: number;
  /** Largest DFS stack size seen while traversing. */
  maxStackDepth: number;
  /** Number of dependency sorts required for stable traversal order. */
  sortCalls: number;
  /** Number of candidate child spans that failed to resolve sort keys. */
  invalidSortKeys: number;
  /** Total time spent sorting outgoing dependency lists in ms. */
  sortDurationMs: number;
};

/** Decides whether child-search traversal diagnostics should be logged. */
function shouldLogTraceSpanDescendantTraversal(params: {
  /** Elapsed traversal time in milliseconds. */
  traversalDurationMs: number;
  /** Number of entries emitted before truncation. */
  entries: number;
  /** Number of unique spans visited while walking descendants. */
  visited: number;
  /** Traversal counters for sorting and edge-inspection cost. */
  stats: TraceGraphDescendantTraversalStats;
  /** Forces probe logging even when normal thresholds fail. */
  forceLog?: boolean;
}): boolean {
  if (params.forceLog) {
    return true;
  }
  if (params.traversalDurationMs > 2) {
    return true;
  }
  if (params.entries > 50 || params.visited > 200) {
    return true;
  }
  if (params.stats.sortCalls > 30 || params.stats.candidateDependencyCount > 5_000) {
    return true;
  }
  if (params.stats.invalidSortKeys > 0) {
    return true;
  }

  return false;
}

/**
 * Returns whether a dependency carries at least one accepted keyword.
 */
function dependencyMatchesKeywords(
  dependency: TraceDependency,
  keywords: ReadonlySet<string>
): boolean {
  return dependencyMatchesSelectionKeywords(dependency, keywords);
}

/**
 * Compares spans by primary timing and then stable block id.
 */
function compareTraceSpansByTime(left: Readonly<TraceSpan>, right: Readonly<TraceSpan>): number {
  return (
    getPrimaryTiming(left).startTimeMs - getPrimaryTiming(right).startTimeMs ||
    getPrimaryTiming(left).endTimeMs - getPrimaryTiming(right).endTimeMs ||
    left.spanId.localeCompare(right.spanId)
  );
}

/**
 * Compares two descendant sort keys for deterministic tree-order sibling sorting.
 */
function compareTraceGraphDescendantChildKeys(
  leftChildKey: Readonly<TraceGraphDescendantChildSortKey>,
  rightChildKey: Readonly<TraceGraphDescendantChildSortKey>,
  leftChildSpanId: TraceSpanId,
  rightChildSpanId: TraceSpanId
): number {
  return (
    leftChildKey.startTimeMs - rightChildKey.startTimeMs ||
    leftChildKey.endTimeMs - rightChildKey.endTimeMs ||
    leftChildSpanId.localeCompare(rightChildSpanId)
  );
}

/** Returns visible child dependencies through the filtered graph wrapper. */
export function getTraceSpanChildDependenciesFromTraceGraph(
  block: Readonly<TraceSpan>,
  traceGraph: Readonly<TraceGraph>
): TraceGraphChildDependency[] {
  const blockSpanRef = getSelectedCardSpanRef(traceGraph, block);
  if (blockSpanRef == null) {
    return [];
  }
  const outgoingDependencies =
    traceGraph.getProjection().outDependenciesBySpanRef.get(blockSpanRef) ?? [];

  return [...outgoingDependencies]
    .filter(dependency => getVisibleDependencyStartSpanRef(traceGraph, dependency) === blockSpanRef)
    .filter(isParentDependency)
    .map(dependency => {
      const childBlock = getTraceGraphDescendantDisplayBlock({
        traceGraph,
        spanRef: dependency.endSpanRef!
      });
      if (!childBlock || childBlock.spanId === block.spanId) {
        return null;
      }
      return {dependency, childBlock};
    })
    .filter((entry): entry is TraceGraphChildDependency => Boolean(entry))
    .sort((left, right) => compareTraceSpansByTime(left.childBlock, right.childBlock));
}

/**
 * Resolves the visible source span ref for one dependency after filtered-view rewrites.
 */
function getVisibleDependencyStartSpanRef(
  traceGraph: Readonly<TraceGraph>,
  dependency: Readonly<TraceDependency>
): SpanRef | null {
  if (dependency.startSpanRef != null) {
    return dependency.startSpanRef;
  }

  const visibleDependencyRef = traceGraph.getVisibleDependencyRefForDependency(dependency);
  if (visibleDependencyRef == null) {
    return null;
  }

  return traceGraph.getVisibleDependencyStartSpan(visibleDependencyRef);
}
