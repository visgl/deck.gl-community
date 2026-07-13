import * as arrow from 'apache-arrow';

import {MappedArrowTable} from '../../arrow-utils';
import {log} from '../log';
import {
  getArrowTraceSpanField,
  getUniqueTraceGraphSpanRef,
  iterateTraceGraphProcessSpanRefs
} from '../trace-graph-accessors';
import {materializeTraceCrossProcessDependencyFromArrowRow} from './trace-cross-process-dependency-table';
import {
  encodeCrossProcessDependencyRef,
  encodeLocalSpanRef,
  encodeSameProcessDependencyRef,
  getCrossProcessDependencyRefIndex,
  getProcessRefIndex,
  isCrossProcessDependencyRef,
  isSameProcessDependencyRef
} from './trace-id-encoder';
import {getPrimaryTiming} from './trace-types';

import type {ArrowTraceSameProcessDependencyTable} from '../ingestion/arrow-trace';
import type {
  TraceCrossProcessDependencyRenderSource,
  TraceSameProcessDependencySource
} from '../trace-graph-accessors';
import type {TraceGraph} from './trace-graph';
import type {
  TraceGraphChildDependency,
  TraceGraphDescendantEntry,
  TraceGraphDescendantResult,
  TraceGraphPathBlockSource,
  TraceGraphPathCrossProcessDependencySource,
  TraceGraphPathDependencySource,
  TraceGraphPathSameProcessDependencySource,
  TraceGraphSelectedCrossProcessDependencySource,
  TraceGraphSelectedSameProcessDependencySource,
  TraceSelectedDependencyDirection,
  TraceSpanDependencySelection
} from './trace-graph-types';
import type {CrossProcessDependencyRef, SameProcessDependencyRef} from './trace-id-encoder';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceDependency,
  TracePath,
  TraceProcessId,
  TraceSameProcessDependency,
  TraceSpan,
  TraceSpanId,
  TraceThreadId
} from './trace-types';

export {
  buildTraceSpanDescendants,
  endpointMatchesCrossProcessDependency,
  endpointMatchesCrossProcessDependencyValues,
  getTaggedCrossProcessDependencyRefRowIndex,
  getSameProcessDependencyLookupByProcessId,
  getOrderedVisiblePathBlockSources,
  getProcessIdByRankNum,
  getProcessScopedSpanRefsByProcessId,
  getSelectedCardSpanRef,
  getVisiblePathBlockSources,
  getVisiblePathDependencySources,
  getVisibleSelectedCrossProcessDependencySource,
  getVisibleSelectedCrossProcessDependencySourceByLegacyRowIndex,
  getVisibleSelectedSameProcessDependencySource,
  getVisibleSelectedSameProcessDependencySourceByLegacyRowIndex,
  isParentCrossProcessDependency,
  isParentDependency,
  isParentSameProcessDependency,
  isUnresolvedCrossEndpoint,
  isVisibleSpanRef,
  buildTraceSpanBySpanRef
};

type ArrowTraceSameProcessDependencyTableTypeMap =
  ArrowTraceSameProcessDependencyTable extends arrow.Table<infer TTypeMap> ? TTypeMap : never;
type TraceGraphSameProcessDependencyLookup =
  MappedArrowTable<ArrowTraceSameProcessDependencyTableTypeMap>;

/** Ref-native dependency shape sufficient for dependency-chain traversal. */
type TraceDependencyTraversalSource =
  | TraceSameProcessDependencySource
  | TraceCrossProcessDependencyRenderSource;

const PARENT_KEYWORD = 'PARENT';
const TRACE_DEPENDENCY_SELECTION_PROBE_QUERY_PARAM = 'traceDependencySelectionProbe';
const TRACE_CHILD_DEPENDENT_TRAVERSAL_PROBE_QUERY_PARAM = 'traceChildTraversalProbe';
let isTraceDependencySelectionProbeEnabledCache: boolean | null = null;
let isTraceChildDependentTraversalProbeEnabledCache: boolean | null = null;

/** Builds one dependency-id keyed mapped Arrow view over a canonical same-process dependency table. */
function buildMappedDependencyLookup(
  traceGraph: Readonly<TraceGraph>,
  processIndex: number,
  table: Readonly<ArrowTraceSameProcessDependencyTable>
): TraceGraphSameProcessDependencyLookup {
  const rowIndexMap = new Map<string, number>();

  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    const dependencyId = traceGraph.getDependencyId(
      encodeSameProcessDependencyRef(encodeLocalSpanRef(processIndex, rowIndex))
    );
    if (dependencyId) {
      rowIndexMap.set(dependencyId, rowIndex);
    }
  }

  return new MappedArrowTable(
    table as arrow.Table<ArrowTraceSameProcessDependencyTableTypeMap>,
    rowIndexMap
  );
}

/**
 * Returns per-process dependency-id keyed same-process dependency views for one trace graph.
 */
function getSameProcessDependencyLookupByProcessId(
  traceGraph: Readonly<TraceGraph>
): Readonly<Record<TraceProcessId, TraceGraphSameProcessDependencyLookup>> {
  return Object.fromEntries(
    traceGraph.processes.map((process, processIndex) => {
      const processId = process.processId as TraceProcessId;
      return [
        processId,
        buildMappedDependencyLookup(
          traceGraph,
          processIndex,
          traceGraph.sameProcessDependencyTableMap[processId]
        )
      ] as const;
    })
  ) as Readonly<Record<TraceProcessId, TraceGraphSameProcessDependencyLookup>>;
}

/**
 * Returns exact process-local span refs keyed by process id and block id.
 */
function getProcessScopedSpanRefsByProcessId(
  traceGraph: Readonly<TraceGraph>
): Readonly<Record<TraceProcessId, ReadonlyMap<TraceSpanId, SpanRef>>> {
  return Object.fromEntries(
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
}

/**
 * Returns process ids keyed by rank number for exact cross-process span resolution.
 */
function getProcessIdByRankNum(
  traceGraph: Readonly<TraceGraph>
): ReadonlyMap<number, TraceProcessId> {
  return new Map(
    traceGraph.processes.map(
      process => [process.rankNum, process.processId as TraceProcessId] as const
    )
  );
}

/**
 * Builds one card-compatible block from a process-aware span ref.
 */
function buildTraceSpanBySpanRef(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef
): TraceSpan | null {
  const spanSource = traceGraph.getSpanDetailSource(spanRef);
  if (!spanSource) {
    return null;
  }

  const sameProcessDependencies = [
    ...traceGraph.getSpanDirectionalDependencySources(spanRef, 'incoming'),
    ...traceGraph.getSpanDirectionalDependencySources(spanRef, 'outgoing')
  ].filter(
    (dependency): dependency is TraceSameProcessDependency =>
      dependency.type === 'trace-same-process-dependency'
  );
  const sameProcessDependenciesByRef = new Map(
    sameProcessDependencies.map(dependency => [
      dependency.dependencyRef ?? dependency.dependencyId,
      dependency
    ])
  );

  return {
    type: 'trace-span',
    spanRef: spanSource.spanRef,
    spanId: spanSource.spanId,
    threadId: spanSource.threadId,
    processName: spanSource.processName,
    name: spanSource.name,
    keywords: spanSource.keywords,
    primaryTimingKey: spanSource.primaryTimingKey,
    timings: spanSource.timings,
    sameProcessDependencyIds: [...sameProcessDependenciesByRef.values()].map(
      dependency => dependency.dependencyId
    ),
    sameProcessDependencies: [...sameProcessDependenciesByRef.values()],
    crossProcessEndpointId: spanSource.crossProcessEndpointId,
    crossProcessDependencyEndpoints: spanSource.crossProcessDependencyEndpoints,
    userData: spanSource.userData
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
  const threadRef = traceGraph.getSpanOwnerRefs(spanRef)?.threadRef ?? null;
  return (
    traceGraph.getSpanId(spanRef) === block.spanId &&
    threadRef != null &&
    traceGraph.getThreadSourceByRef(threadRef)?.threadId === block.threadId
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
  return !traceGraph.spanIsFiltered(spanRef);
}

function hasParentKeyword(keywords: ReadonlySet<string>): boolean {
  return [...keywords].some(keyword => keyword.toUpperCase() === PARENT_KEYWORD);
}

function isParentSameProcessDependency(
  dependency: Readonly<{keywords: ReadonlySet<string>}>
): boolean {
  return hasParentKeyword(dependency.keywords);
}

function isParentCrossProcessDependency(
  dependency: Readonly<{keywords: ReadonlySet<string>; topology: string}>
): boolean {
  return hasParentKeyword(dependency.keywords) || dependency.topology === 'parent';
}

function isParentDependency(
  dependency:
    | Readonly<{type: 'trace-same-process-dependency'; keywords: ReadonlySet<string>}>
    | Readonly<{
        type: 'trace-cross-process-dependency';
        keywords: ReadonlySet<string>;
        topology: string;
      }>
): boolean {
  return dependency.type === 'trace-same-process-dependency'
    ? isParentSameProcessDependency(dependency)
    : isParentCrossProcessDependency(dependency);
}

function endpointMatchesCrossProcessDependency(params: {
  endpoint: TraceCrossProcessEndpoint;
  dependency: TraceCrossProcessDependency;
}): boolean {
  const {endpoint, dependency} = params;
  return endpointMatchesCrossProcessDependencyValues({
    endpoint,
    endpointId: dependency.endpointId,
    startRankNum: dependency.startRankNum,
    endRankNum: dependency.endRankNum
  });
}

/**
 * Returns whether one endpoint matches the scalar identity of a cross-process dependency row.
 */
function endpointMatchesCrossProcessDependencyValues(params: {
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
      endpointMatchesCrossProcessDependency({
        endpoint,
        dependency
      })
  );
}

/** Builds parent/child dependency traversal over visible dependencies keyed by span refs. */
export function getTraceSpanDependencySelection(params: {
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
  const originSpanId = traceGraph.isSpanVisible(spanRef) ? traceGraph.getSpanId(spanRef) : null;
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
  const visibleSameProcessDependencyRefs = new Set<SameProcessDependencyRef>();
  const visibleCrossProcessDependencyRefs = new Set<CrossProcessDependencyRef>();
  const parentSameProcessDependencyRefs = new Set<SameProcessDependencyRef>();
  const parentCrossProcessDependencyRefs = new Set<CrossProcessDependencyRef>();
  const childSameProcessDependencyRefs = new Set<SameProcessDependencyRef>();
  const childCrossProcessDependencyRefs = new Set<CrossProcessDependencyRef>();
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

  const recordDependency = (
    dependency: TraceDependencyTraversalSource,
    direction: 'up' | 'down'
  ) => {
    if (dependency.type === 'trace-cross-process-dependency') {
      const dependencyRef = dependency.dependencyRef;
      if (
        dependencyRef == null ||
        !isCrossProcessDependencyRef(dependencyRef) ||
        !traceGraph.isDependencyVisible(dependencyRef)
      ) {
        return;
      }
      visibleCrossProcessDependencyRefs.add(dependencyRef);
      if (direction === 'up') {
        parentCrossProcessDependencyRefs.add(dependencyRef);
      } else {
        childCrossProcessDependencyRefs.add(dependencyRef);
      }
    } else {
      const dependencyRef = dependency.dependencyRef;
      if (
        dependencyRef == null ||
        !isSameProcessDependencyRef(dependencyRef) ||
        !traceGraph.isDependencyVisible(dependencyRef)
      ) {
        return;
      }
      visibleSameProcessDependencyRefs.add(dependencyRef);
      if (direction === 'up') {
        parentSameProcessDependencyRefs.add(dependencyRef);
      } else {
        childSameProcessDependencyRefs.add(dependencyRef);
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
  ): TraceDependencyTraversalSource[] => {
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
        !dependencyTraversalSourceMatchesSelectionKeywords(traceGraph, dependency, keywords)
      ) {
        continue;
      }
      recordDependency(dependency, 'up');
      const nextSpanId =
        dependency.type === 'trace-cross-process-dependency'
          ? traceGraph.getDependencyStartBlockId(dependency.dependencyRef)
          : dependency.startSpanId;
      if (nextSpanId == null) {
        continue;
      }
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
        !dependencyTraversalSourceMatchesSelectionKeywords(traceGraph, dependency, keywords)
      ) {
        continue;
      }
      recordDependency(dependency, 'down');
      const nextSpanId =
        dependency.type === 'trace-cross-process-dependency'
          ? traceGraph.getDependencyEndBlockId(dependency.dependencyRef)
          : dependency.endSpanId;
      if (nextSpanId == null) {
        continue;
      }
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
    parentSameProcessDependencyRefs: Array.from(parentSameProcessDependencyRefs),
    parentCrossProcessDependencyRefs: Array.from(parentCrossProcessDependencyRefs),
    childSameProcessDependencyRefs: Array.from(childSameProcessDependencyRefs),
    childCrossProcessDependencyRefs: Array.from(childCrossProcessDependencyRefs),
    visibleSameProcessDependencyRefs: Array.from(visibleSameProcessDependencyRefs),
    visibleCrossProcessDependencyRefs: Array.from(visibleCrossProcessDependencyRefs)
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
      parentSameProcessDependencyRefCount: parentSameProcessDependencyRefs.size,
      parentCrossProcessDependencyRefCount: parentCrossProcessDependencyRefs.size,
      childSameProcessDependencyRefCount: childSameProcessDependencyRefs.size,
      childCrossProcessDependencyRefCount: childCrossProcessDependencyRefs.size,
      visibleSameProcessDependencyRefCount: visibleSameProcessDependencyRefs.size,
      visibleCrossProcessDependencyRefCount: visibleCrossProcessDependencyRefs.size,
      parentSpanIds: parentSpanRefs
        .slice(0, 10)
        .map(parentSpanRef =>
          traceGraph.isSpanVisible(parentSpanRef) ? traceGraph.getSpanId(parentSpanRef) : null
        ),
      childSpanIds: childSpanRefs
        .slice(0, 10)
        .map(childSpanRef =>
          traceGraph.isSpanVisible(childSpanRef) ? traceGraph.getSpanId(childSpanRef) : null
        ),
      visibleSameProcessDependencyIds: selection.visibleSameProcessDependencyRefs
        .slice(0, 10)
        .map(dependencyRef => traceGraph.getDependencyId(dependencyRef)),
      visibleCrossProcessDependencyIds: selection.visibleCrossProcessDependencyRefs
        .slice(0, 10)
        .map(dependencyRef => traceGraph.getDependencyId(dependencyRef))
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
    parentSameProcessDependencyRefs: [],
    parentCrossProcessDependencyRefs: [],
    childSameProcessDependencyRefs: [],
    childCrossProcessDependencyRefs: [],
    visibleSameProcessDependencyRefs: [],
    visibleCrossProcessDependencyRefs: []
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
}): TraceDependencyTraversalSource[] {
  const dependencies: TraceDependencyTraversalSource[] = [];
  for (const dependencySource of params.traceGraph.getSpanDirectionalDependencySources(
    params.spanRef,
    params.direction
  )) {
    if (dependencySource.type === 'trace-same-process-dependency') {
      if (dependencySource.dependencyRef != null) {
        dependencies.push(dependencySource);
      }
      continue;
    }
    if (dependencySource.dependencyRef == null) {
      continue;
    }
    dependencies.push(dependencySource);
  }
  return dependencies;
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
 * Returns whether one ref-native traversal source carries an accepted selection keyword.
 */
function dependencyTraversalSourceMatchesSelectionKeywords(
  traceGraph: Readonly<TraceGraph>,
  dependency: TraceDependencyTraversalSource,
  keywords: ReadonlySet<string>
): boolean {
  if (dependency.type === 'trace-same-process-dependency') {
    return dependencyMatchesSelectionKeywords(dependency, keywords);
  }
  if (keywords.size === 0) {
    return true;
  }
  const dependencyKeywords = traceGraph.getDependencyKeywords(dependency.dependencyRef);
  if (dependencyKeywords == null) {
    return false;
  }
  const topology = traceGraph.getCrossProcessDependencyTopology(dependency.dependencyRef) ?? '';
  if (
    hasParentKeyword(keywords) &&
    isParentCrossProcessDependency({keywords: dependencyKeywords, topology})
  ) {
    return true;
  }
  for (const keyword of keywords) {
    if (hasCaseInsensitiveKeyword(dependencyKeywords, keyword)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns whether a dependency should participate in a keyword-restricted selection traversal.
 */
function dependencyMatchesSelectionKeywords(
  dependency:
    | Readonly<{type: 'trace-same-process-dependency'; keywords: ReadonlySet<string>}>
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
 * Builds the selected-overlay source for one visible same-process dependency ref.
 */
function getVisibleSelectedSameProcessDependencySource(params: {
  /** Trace graph containing visible dependency lookup tables. */
  traceGraph: Readonly<TraceGraph>;
  /** Visible same-process dependency ref to resolve. */
  dependencyRef: SameProcessDependencyRef;
  /** Direction of the selected dependency relative to the selected origin span. */
  selectedDirection?: TraceSelectedDependencyDirection;
}): TraceGraphSelectedSameProcessDependencySource | null {
  if (!params.traceGraph.isDependencyVisible(params.dependencyRef)) {
    return null;
  }
  const processRef = params.traceGraph.getSameProcessDependencyProcessRefByRef(
    params.dependencyRef
  );
  if (processRef == null) {
    return null;
  }
  return {
    dependencyRef: params.dependencyRef,
    processRef,
    selectedDirection: params.selectedDirection ?? 'incoming',
    waitTimeMs: params.traceGraph.getDependencyWaitTimeMs(params.dependencyRef) ?? 0,
    bidirectional: params.traceGraph.getDependencyBidirectional(params.dependencyRef) === true
  };
}

/**
 * Resolves a locally-scoped dependency id from an unbranded row index.
 */
function getVisibleSelectedSameProcessDependencySourceByLegacyRowIndex(params: {
  /** Trace graph containing process-local same-process-dependency tables. */
  traceGraph: Readonly<TraceGraph>;
  /** Unbranded same-process dependency row index. */
  dependencyRowIndex: number;
}): TraceGraphSelectedSameProcessDependencySource | null {
  if (!Number.isSafeInteger(params.dependencyRowIndex) || params.dependencyRowIndex < 0) {
    return null;
  }

  for (const [processIndex, processId] of params.traceGraph.processIdsByIndex.entries()) {
    const dependencyTable = params.traceGraph.sameProcessDependencyTableMap[processId];
    if (!dependencyTable || params.dependencyRowIndex >= dependencyTable.numRows) {
      continue;
    }

    const sourceDependencyRef = encodeSameProcessDependencyRef(
      encodeLocalSpanRef(processIndex, params.dependencyRowIndex)
    );
    const source = params.traceGraph.isDependencyVisible(sourceDependencyRef)
      ? getVisibleSelectedSameProcessDependencySource({
          traceGraph: params.traceGraph,
          dependencyRef: sourceDependencyRef,
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
 * Builds the selected-overlay source for one visible cross-process dependency ref.
 */
function getVisibleSelectedCrossProcessDependencySource(params: {
  /** Trace graph containing visible dependency lookup tables. */
  traceGraph: Readonly<TraceGraph>;
  /** Visible cross-process dependency ref to resolve. */
  dependencyRef: CrossProcessDependencyRef;
  /** Direction of the selected dependency relative to the selected origin span. */
  selectedDirection?: TraceSelectedDependencyDirection;
}): TraceGraphSelectedCrossProcessDependencySource | null {
  if (!params.traceGraph.isDependencyVisible(params.dependencyRef)) {
    return null;
  }

  return {
    dependencyRef: params.dependencyRef,
    selectedDirection: params.selectedDirection ?? 'incoming',
    waitTimeMs: params.traceGraph.getDependencyWaitTimeMs(params.dependencyRef) ?? 0,
    bidirectional: params.traceGraph.getDependencyBidirectional(params.dependencyRef) === true
  };
}

/**
 * Resolves a visible cross-process-dependency source from an unbranded row index.
 */
function getVisibleSelectedCrossProcessDependencySourceByLegacyRowIndex(params: {
  /** Trace graph containing cross-process-dependency rows. */
  traceGraph: Readonly<TraceGraph>;
  /** Unbranded cross-process-dependency table row index. */
  dependencyRowIndex: number;
}): TraceGraphSelectedCrossProcessDependencySource | null {
  const rowIndex = params.dependencyRowIndex;
  if (
    !Number.isSafeInteger(rowIndex) ||
    rowIndex < 0 ||
    rowIndex >= params.traceGraph.crossProcessDependencyTable.numRows
  ) {
    return null;
  }

  const sourceDependencyRef = encodeCrossProcessDependencyRef(rowIndex);
  return params.traceGraph.isDependencyVisible(sourceDependencyRef)
    ? getVisibleSelectedCrossProcessDependencySource({
        traceGraph: params.traceGraph,
        dependencyRef: sourceDependencyRef,
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
  if (!params.traceGraph.isSpanVisible(params.spanRef)) {
    return null;
  }
  const span = params.traceGraph.getSpanDetailSource(params.spanRef);
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
 * Builds a path dependency source from an exact visible same-process dependency ref.
 */
function getVisiblePathSameProcessDependencySourceByRef(params: {
  /** Trace graph containing visible dependency lookup tables. */
  traceGraph: Readonly<TraceGraph>;
  /** Exact visible same-process dependency ref to resolve. */
  dependencyRef: SameProcessDependencyRef;
}): TraceGraphPathSameProcessDependencySource | null {
  if (!params.traceGraph.isDependencyVisible(params.dependencyRef)) {
    return null;
  }
  const dependency = params.traceGraph.getDependencySource(params.dependencyRef);
  if (!dependency || dependency.type !== 'trace-same-process-dependency') {
    return null;
  }
  return {
    dependencyRef: params.dependencyRef,
    dependency
  };
}

/**
 * Builds a path dependency source from an exact visible cross-process dependency ref.
 */
function getVisiblePathCrossProcessDependencySourceByRef(params: {
  /** Trace graph containing visible dependency lookup tables. */
  traceGraph: Readonly<TraceGraph>;
  /** Exact visible cross-process dependency ref to resolve. */
  dependencyRef: CrossProcessDependencyRef;
}): TraceGraphPathCrossProcessDependencySource | null {
  if (!params.traceGraph.isDependencyVisible(params.dependencyRef)) {
    return null;
  }
  const dependency = params.traceGraph.getDependencySource(params.dependencyRef);
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
    (params.path.visibleSameProcessDependencyRefSet?.size ?? 0) > 0 ||
    (params.path.visibleCrossProcessDependencyRefSet?.size ?? 0) > 0
  ) {
    return [
      ...getRuntimePathVisibleSameProcessDependencyRefs(params.path).flatMap(dependencyRef => {
        const source = getVisiblePathSameProcessDependencySourceByRef({
          traceGraph: params.traceGraph,
          dependencyRef
        });
        return source ? [source] : [];
      }),
      ...getRuntimePathVisibleCrossProcessDependencyRefs(params.path).flatMap(dependencyRef => {
        const source = getVisiblePathCrossProcessDependencySourceByRef({
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
 * Returns visible same-process dependency refs for a path, falling back to dependency ids when needed.
 */
function getRuntimePathVisibleSameProcessDependencyRefs(
  path: Readonly<TracePath>
): SameProcessDependencyRef[] {
  if ((path.visibleSameProcessDependencyRefSet?.size ?? 0) > 0) {
    return Array.from(path.visibleSameProcessDependencyRefSet);
  }
  return [];
}

/**
 * Returns visible cross-process dependency refs for a path, falling back to dependency ids when needed.
 */
function getRuntimePathVisibleCrossProcessDependencyRefs(
  path: Readonly<TracePath>
): CrossProcessDependencyRef[] {
  if ((path.visibleCrossProcessDependencyRefSet?.size ?? 0) > 0) {
    return Array.from(path.visibleCrossProcessDependencyRefSet);
  }
  return [];
}

/**
 * Resolves a tagged cross-process-dependency reference to a row index.
 */
function getTaggedCrossProcessDependencyRefRowIndex(
  dependencyRef: CrossProcessDependencyRef,
  traceGraph: Readonly<TraceGraph>
): number | null {
  if (!isCrossProcessDependencyRef(dependencyRef)) {
    return null;
  }

  const rowIndex = getCrossProcessDependencyRefIndex(dependencyRef);
  return rowIndex < traceGraph.crossProcessDependencyTable.numRows ? rowIndex : null;
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
  /** Trace graph supplying visible/source dependency refs. */
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
      dependencyView: includeHidden ? 'source' : 'visible',
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
    traceGraph,
    includeHidden,
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
    const shouldEmit = includeHidden || traceGraph.isSpanVisible(childSpanRef);
    if (shouldEmit) {
      stats.blockLookupCalls += 1;
      emittedChildBlock = getTraceGraphDescendantBlock({
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
      traceGraph,
      includeHidden,
      keywords,
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
 * Resolves a lightweight descendant block from ref-native graph accessors.
 */
function getTraceGraphDescendantBlock(params: {
  traceGraph: Readonly<TraceGraph>;
  /** Descendant span ref resolved into a lightweight block. */
  spanRef: SpanRef;
}): TraceSpan | null {
  return buildTraceSpanBySpanRef(params.traceGraph, params.spanRef);
}

/**
 * Returns outgoing parent dependencies eligible for descendant traversal.
 */
function getTraceGraphDescendantChildDependencies(params: {
  /** Exact current span ref whose outgoing dependencies should be inspected. */
  spanRef: SpanRef;
  /** Graph whose canonical refs are scanned for hidden-span traversal. */
  traceGraph: Readonly<TraceGraph>;
  /** Whether traversal should include filtered source dependencies. */
  includeHidden: boolean;
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
  const dependencies = getTouchedTraceGraphDependenciesForSpanDirection({
    traceGraph: params.traceGraph,
    spanRef: params.spanRef,
    direction: 'outgoing',
    visibleOnly: !params.includeHidden
  });
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

/** Materializes only dependency rows touched by one directional traversal step. */
function getTouchedTraceGraphDependenciesForSpanDirection(params: {
  /** Graph whose directional dependency refs should be read. */
  traceGraph: Readonly<TraceGraph>;
  /** Exact span ref whose incoming or outgoing dependencies should be inspected. */
  spanRef: SpanRef;
  /** Direction relative to the selected span. */
  direction: 'incoming' | 'outgoing';
  /** Whether only dependencies with visible canonical endpoints should participate. */
  visibleOnly: boolean;
}): readonly TraceDependency[] {
  const {traceGraph, spanRef, direction, visibleOnly} = params;
  const dependencyRefs = visibleOnly
    ? traceGraph.getVisibleDirectionalDependencyRefSlice(
        spanRef,
        direction,
        Number.POSITIVE_INFINITY
      ).dependencyRefs
    : (() => {
        const sourceDependencyRefs = traceGraph.getSpanDirectionalDependencyRefs(
          spanRef,
          direction
        );
        return [
          ...sourceDependencyRefs.sameProcessDependencyRefs,
          ...sourceDependencyRefs.crossProcessDependencyRefs
        ];
      })();
  const dependencies: TraceDependency[] = [];
  for (const dependencyRef of dependencyRefs) {
    if (isSameProcessDependencyRef(dependencyRef)) {
      const dependencySource = traceGraph.getDependencySource(dependencyRef);
      if (dependencySource?.type !== 'trace-same-process-dependency') {
        continue;
      }
      dependencies.push({
        ...dependencySource,
        keywords: new Set(dependencySource.keywords)
      } satisfies TraceSameProcessDependency);
      continue;
    }

    if (!isCrossProcessDependencyRef(dependencyRef)) {
      continue;
    }
    const dependency = materializeTraceCrossProcessDependencyFromArrowRow({
      crossProcessDependencyTable: traceGraph.crossProcessDependencyTable,
      rowIndex: getCrossProcessDependencyRefIndex(dependencyRef)
    });
    dependencies.push(dependency);
  }
  return dependencies;
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
  const outgoingDependencies = getTouchedTraceGraphDependenciesForSpanDirection({
    traceGraph,
    spanRef: blockSpanRef,
    direction: 'outgoing',
    visibleOnly: true
  });

  return [...outgoingDependencies]
    .filter(dependency => getDependencyStartSpanRef(traceGraph, dependency) === blockSpanRef)
    .filter(isParentDependency)
    .map(dependency => {
      const childBlock = getTraceGraphDescendantBlock({
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
function getDependencyStartSpanRef(
  traceGraph: Readonly<TraceGraph>,
  dependency: Readonly<TraceDependency>
): SpanRef | null {
  if (dependency.startSpanRef != null) {
    return dependency.startSpanRef;
  }

  const dependencyRef = dependency.dependencyRef;
  if (
    dependencyRef == null ||
    (!isSameProcessDependencyRef(dependencyRef) && !isCrossProcessDependencyRef(dependencyRef)) ||
    !traceGraph.isDependencyVisible(dependencyRef)
  ) {
    return null;
  }

  return traceGraph.getDependencyStartSpan(dependencyRef);
}
