import {log} from '../log';
import {encodeCrossProcessDependencyRef} from './trace-id-encoder';
import {encodeGlobalDependencyId} from './trace-id-utils';
import {
  type SpanRef,
  type TraceCrossProcessDependency,
  type TraceCrossProcessEndpoint,
  type TraceCrossProcessEndpointId,
  type TraceDependencyId,
  type TraceSpan,
  type TraceSpanId
} from './trace-types';

// CROSS RANK DEPENDENCIES

/** Resolved span refs grouped first by rank number, then by stable source span id. */
export type TraceCrossProcessDependencySpanRefLookup = ReadonlyMap<
  number,
  ReadonlyMap<TraceSpanId, SpanRef>
>;

/** Builds cross-process dependencies for a list of ranks */
export function buildCrossProcessDependencies(props: {
  ranks: {
    rankNum: number;
    spans: TraceSpan[];
  }[];
}): TraceCrossProcessDependency[] {
  const crossRankEndpointsMap: Record<string, TraceCrossProcessEndpoint[]> = {};
  const spanRefByRankAndSpanId = new Map<number, Map<TraceSpanId, SpanRef>>();

  for (const {rankNum, spans} of props.ranks) {
    for (const block of spans) {
      if (block.spanRef != null) {
        setCrossProcessDependencySpanRef(
          spanRefByRankAndSpanId,
          rankNum,
          block.spanId,
          block.spanRef
        );
      }
    }
    extractCrossRankEndpointsFromRank({rankNum, spans, crossRankEndpointsMap});
  }

  const totalEndpoints = Object.values(crossRankEndpointsMap).reduce(
    (sum, endpoints) => sum + endpoints.length,
    1
  );
  const crossProcessDependencies = buildCrossProcessDependenciesFromEndpoints(
    crossRankEndpointsMap,
    spanRefByRankAndSpanId
  );
  log.probe(
    1,
    `Rebuilt ${crossProcessDependencies.length} cross-process dependencies for all ranks from ${totalEndpoints} endpoints (${Object.keys(crossRankEndpointsMap).length} endpointIds)`
  )();
  return crossProcessDependencies;
}

export function buildCrossProcessDependenciesFromEndpoints(
  crossRankEndpointsMap: Record<string, TraceCrossProcessEndpoint[]>,
  spanRefByRankAndSpanId: TraceCrossProcessDependencySpanRefLookup,
  options: TraceCrossProcessDependencyBuildOptions = {}
): TraceCrossProcessDependency[] {
  const crossProcessDependenciesMap = buildCrossProcessDependencyMapFromEndpoints(
    crossRankEndpointsMap,
    spanRefByRankAndSpanId,
    options
  );
  const crossRankEndpointsList = Object.values(crossRankEndpointsMap);
  const crossProcessDependencies: TraceCrossProcessDependency[] = Object.values(
    crossProcessDependenciesMap
  );
  log.probe(0, 'Built cross-process dependencies from endpoints', {
    crossProcessDependencyCount: crossProcessDependencies.length,
    endpointGroupCount: crossRankEndpointsList.length
  })();
  // log.probe(1, `Build cross-process dependencies: ${crossProcessDependencies.length}, deduplicated ${dedup}`)();
  return crossProcessDependencies;
}

/** Cross-process dependency state produced while appending newly ready endpoint groups. */
export type TraceCrossProcessDependencyAppendResult = {
  /** Cross-process dependencies after appending dependencies resolved from the new endpoint groups. */
  readonly crossProcessDependencies: readonly TraceCrossProcessDependency[];
  /** Dependencies created while matching the new endpoint groups. */
  readonly newCrossProcessDependencies: readonly TraceCrossProcessDependency[];
};

/**
 * Build resolved cross-process dependencies keyed by topology-aware dependency id from endpoint groups.
 */
export function buildCrossProcessDependencyMapFromEndpoints(
  crossRankEndpointsMap: Readonly<
    Record<TraceCrossProcessEndpointId, readonly TraceCrossProcessEndpoint[]>
  >,
  spanRefByRankAndSpanId: TraceCrossProcessDependencySpanRefLookup,
  options: TraceCrossProcessDependencyBuildOptions = {}
): Record<string, TraceCrossProcessDependency> {
  const crossProcessDependenciesMap = Object.create(null) as Record<
    string,
    TraceCrossProcessDependency
  >;
  let nextDependencyIndex = 0;
  for (const [endpointId, endpoints] of Object.entries(crossRankEndpointsMap)) {
    nextDependencyIndex = addCrossProcessDependenciesWithinEndpointGroup({
      crossProcessDependenciesMap,
      endpointId: endpointId as TraceCrossProcessEndpointId,
      endpoints,
      nextDependencyIndex,
      options,
      spanRefByRankAndSpanId
    });
  }
  return crossProcessDependenciesMap;
}

/**
 * Append dependencies resolved by newly ready endpoint groups without rematching old groups.
 */
export function appendCrossProcessDependenciesFromEndpoints(params: {
  /** Cross-process dependencies already resolved for the previous ready endpoint groups. */
  readonly crossProcessDependencies: readonly TraceCrossProcessDependency[];
  /** Endpoint groups already represented by {@link crossProcessDependencies}. */
  readonly previousEndpointsByEndpointId: Readonly<
    Record<TraceCrossProcessEndpointId, readonly TraceCrossProcessEndpoint[]>
  >;
  /** Newly ready endpoint groups that may resolve against previous or new endpoints. */
  readonly addedEndpointsByEndpointId: Readonly<
    Record<TraceCrossProcessEndpointId, readonly TraceCrossProcessEndpoint[]>
  >;
  /** Resolved span refs keyed by rank number plus source span id. */
  readonly spanRefByRankAndSpanId: TraceCrossProcessDependencySpanRefLookup;
  /** Caller-owned dependency-id hooks used while resolving endpoint groups. */
  readonly options?: TraceCrossProcessDependencyBuildOptions;
}): TraceCrossProcessDependencyAppendResult {
  const crossProcessDependenciesMap = buildCrossProcessDependencyMapFromDependencies(
    params.crossProcessDependencies
  );
  const newCrossProcessDependencies: TraceCrossProcessDependency[] = [];
  let nextDependencyIndex = params.crossProcessDependencies.length;
  for (const [endpointId, addedEndpoints] of Object.entries(params.addedEndpointsByEndpointId)) {
    const typedEndpointId = endpointId as TraceCrossProcessEndpointId;
    nextDependencyIndex = addCrossProcessDependenciesBetweenEndpointGroups({
      crossProcessDependenciesMap,
      endpointId: typedEndpointId,
      leftEndpoints: params.previousEndpointsByEndpointId[typedEndpointId] ?? [],
      newCrossProcessDependencies,
      nextDependencyIndex,
      options: params.options ?? {},
      rightEndpoints: addedEndpoints,
      spanRefByRankAndSpanId: params.spanRefByRankAndSpanId
    });
    nextDependencyIndex = addCrossProcessDependenciesWithinEndpointGroup({
      crossProcessDependenciesMap,
      endpointId: typedEndpointId,
      endpoints: addedEndpoints,
      newCrossProcessDependencies,
      nextDependencyIndex,
      options: params.options ?? {},
      spanRefByRankAndSpanId: params.spanRefByRankAndSpanId
    });
  }
  return {
    crossProcessDependencies:
      newCrossProcessDependencies.length === 0
        ? params.crossProcessDependencies
        : [...params.crossProcessDependencies, ...newCrossProcessDependencies],
    newCrossProcessDependencies
  };
}

/** Caller-owned dependency-id hooks used while resolving endpoint groups. */
export type TraceCrossProcessDependencyBuildOptions = {
  /** Build one dependency id from stable source span ids when runtime refs are unavailable. */
  readonly createDependencyId?: (
    startSpanId: TraceSpan['spanId'],
    endSpanId: TraceSpan['spanId'],
    type: 'bidirectional'
  ) => TraceDependencyId;
  /** Build one dependency id from resolved runtime span refs when both refs are available. */
  readonly createDependencyIdFromSpanRefs?: (
    startSpanRef: SpanRef,
    endSpanRef: SpanRef,
    type: 'bidirectional'
  ) => TraceDependencyId;
};

type CrossProcessDependencyEndpointPairIndex = {
  /** Endpoints that explicitly target one ordered source/destination rank pair. */
  readonly endpointsByRankPair: Map<string, TraceCrossProcessEndpoint[]>;
  /** Explicitly targeted endpoints indexed by the destination rank they expect. */
  readonly targetedEndpointsByEndRankNum: Map<number, TraceCrossProcessEndpoint[]>;
  /** Wildcard endpoints indexed by their owning source rank. */
  readonly wildcardEndpointsByStartRankNum: Map<number, TraceCrossProcessEndpoint[]>;
};

/** Record one resolved runtime span ref without allocating a composite lookup key. */
export function setCrossProcessDependencySpanRef(
  spanRefByRankAndSpanId: Map<number, Map<TraceSpanId, SpanRef>>,
  rankNum: number,
  spanId: TraceSpanId,
  spanRef: SpanRef
): void {
  const spanRefBySpanId = spanRefByRankAndSpanId.get(rankNum);
  if (spanRefBySpanId) {
    spanRefBySpanId.set(spanId, spanRef);
    return;
  }
  spanRefByRankAndSpanId.set(rankNum, new Map([[spanId, spanRef]]));
}

/** Merge resolved runtime span-ref lookups without rebuilding untouched rank maps. */
export function mergeCrossProcessDependencySpanRefLookups(
  previousSpanRefByRankAndSpanId: TraceCrossProcessDependencySpanRefLookup,
  addedSpanRefByRankAndSpanId: TraceCrossProcessDependencySpanRefLookup
): TraceCrossProcessDependencySpanRefLookup {
  if (previousSpanRefByRankAndSpanId.size === 0) {
    return addedSpanRefByRankAndSpanId;
  }
  if (addedSpanRefByRankAndSpanId.size === 0) {
    return previousSpanRefByRankAndSpanId;
  }
  const mergedSpanRefByRankAndSpanId = new Map(previousSpanRefByRankAndSpanId);
  addedSpanRefByRankAndSpanId.forEach((addedSpanRefBySpanId, rankNum) => {
    const previousSpanRefBySpanId = mergedSpanRefByRankAndSpanId.get(rankNum);
    if (!previousSpanRefBySpanId) {
      mergedSpanRefByRankAndSpanId.set(rankNum, addedSpanRefBySpanId);
      return;
    }
    const mergedSpanRefBySpanId = new Map(previousSpanRefBySpanId);
    addedSpanRefBySpanId.forEach((spanRef, spanId) => {
      mergedSpanRefBySpanId.set(spanId, spanRef);
    });
    mergedSpanRefByRankAndSpanId.set(rankNum, mergedSpanRefBySpanId);
  });
  return mergedSpanRefByRankAndSpanId;
}

/** Reconstructs endpoint-aware dedupe keys from previously resolved dependencies. */
function buildCrossProcessDependencyMapFromDependencies(
  crossProcessDependencies: readonly TraceCrossProcessDependency[]
): Record<string, TraceCrossProcessDependency> {
  const crossProcessDependenciesMap = Object.create(null) as Record<
    string,
    TraceCrossProcessDependency
  >;
  crossProcessDependencies.forEach(dependency => {
    if (!dependency.endpointId) {
      return;
    }
    crossProcessDependenciesMap[`${dependency.dependencyId}-${dependency.endpointId}`] = dependency;
  });
  return crossProcessDependenciesMap;
}

/** Builds one resolved cross-process-dependency id from refs when available, then stable span ids. */
function createCrossProcessDependencyId(
  leftEndpoint: TraceCrossProcessEndpoint,
  rightEndpoint: TraceCrossProcessEndpoint,
  options: TraceCrossProcessDependencyBuildOptions
): TraceDependencyId {
  if (leftEndpoint.spanRef !== undefined && rightEndpoint.spanRef !== undefined) {
    const [startSpanRef, endSpanRef] =
      leftEndpoint.spanRef <= rightEndpoint.spanRef
        ? [leftEndpoint.spanRef, rightEndpoint.spanRef]
        : [rightEndpoint.spanRef, leftEndpoint.spanRef];
    const dependencyId = options.createDependencyIdFromSpanRefs?.(
      startSpanRef,
      endSpanRef,
      'bidirectional'
    );
    if (dependencyId) {
      return dependencyId;
    }
  }

  return (
    options.createDependencyId?.(leftEndpoint.spanId, rightEndpoint.spanId, 'bidirectional') ??
    encodeGlobalDependencyId(leftEndpoint.spanId, rightEndpoint.spanId, 'bidirectional')
  );
}

/** Adds dependencies between previously ready and newly ready endpoint groups. */
function addCrossProcessDependenciesBetweenEndpointGroups(params: {
  /** Previously ready endpoints grouped under one unresolved comm-group endpoint id. */
  readonly leftEndpoints: readonly TraceCrossProcessEndpoint[];
  /** Newly ready endpoints grouped under one unresolved comm-group endpoint id. */
  readonly rightEndpoints: readonly TraceCrossProcessEndpoint[];
  /** Mutable dependency map keyed by topology-aware dependency id. */
  readonly crossProcessDependenciesMap: Record<string, TraceCrossProcessDependency>;
  /** Shared unresolved comm-group endpoint id. */
  readonly endpointId: TraceCrossProcessEndpointId;
  /** Optional append-only list of dependencies created during one incremental update. */
  readonly newCrossProcessDependencies?: TraceCrossProcessDependency[];
  /** Next visible dependency index to assign. */
  readonly nextDependencyIndex: number;
  /** Caller-owned dependency-id hooks used while resolving endpoint groups. */
  readonly options: TraceCrossProcessDependencyBuildOptions;
  /** Resolved span refs keyed by rank number plus source span id. */
  readonly spanRefByRankAndSpanId: TraceCrossProcessDependencySpanRefLookup;
}): number {
  let nextDependencyIndex = params.nextDependencyIndex;
  const leftEndpointIndex = createCrossProcessDependencyEndpointPairIndex();
  params.leftEndpoints.forEach(endpoint =>
    addEndpointToCrossProcessDependencyPairIndex(leftEndpointIndex, endpoint)
  );
  for (const rightEndpoint of params.rightEndpoints) {
    nextDependencyIndex = addCrossProcessDependenciesForEndpointAgainstIndex({
      crossProcessDependenciesMap: params.crossProcessDependenciesMap,
      endpoint: rightEndpoint,
      endpointId: params.endpointId,
      endpointIndex: leftEndpointIndex,
      newCrossProcessDependencies: params.newCrossProcessDependencies,
      nextDependencyIndex,
      options: params.options,
      spanRefByRankAndSpanId: params.spanRefByRankAndSpanId
    });
  }
  return nextDependencyIndex;
}

/** Adds dependencies between endpoints within one comm-group endpoint id. */
function addCrossProcessDependenciesWithinEndpointGroup(params: {
  /** Endpoints grouped under one unresolved comm-group endpoint id. */
  readonly endpoints: readonly TraceCrossProcessEndpoint[];
  /** Mutable dependency map keyed by topology-aware dependency id. */
  readonly crossProcessDependenciesMap: Record<string, TraceCrossProcessDependency>;
  /** Shared unresolved comm-group endpoint id. */
  readonly endpointId: TraceCrossProcessEndpointId;
  /** Optional append-only list of dependencies created during one incremental update. */
  readonly newCrossProcessDependencies?: TraceCrossProcessDependency[];
  /** Next visible dependency index to assign. */
  readonly nextDependencyIndex: number;
  /** Caller-owned dependency-id hooks used while resolving endpoint groups. */
  readonly options: TraceCrossProcessDependencyBuildOptions;
  /** Resolved span refs keyed by rank number plus source span id. */
  readonly spanRefByRankAndSpanId: TraceCrossProcessDependencySpanRefLookup;
}): number {
  let nextDependencyIndex = params.nextDependencyIndex;
  const endpointIndex = createCrossProcessDependencyEndpointPairIndex();
  for (const endpoint of params.endpoints) {
    nextDependencyIndex = addCrossProcessDependenciesForEndpointAgainstIndex({
      crossProcessDependenciesMap: params.crossProcessDependenciesMap,
      endpoint,
      endpointId: params.endpointId,
      endpointIndex,
      newCrossProcessDependencies: params.newCrossProcessDependencies,
      nextDependencyIndex,
      options: params.options,
      spanRefByRankAndSpanId: params.spanRefByRankAndSpanId
    });
    addEndpointToCrossProcessDependencyPairIndex(endpointIndex, endpoint);
  }
  return nextDependencyIndex;
}

/** Adds dependencies between one endpoint and indexed endpoints that can satisfy it. */
function addCrossProcessDependenciesForEndpointAgainstIndex(params: {
  /** Mutable dependency map keyed by topology-aware dependency id. */
  readonly crossProcessDependenciesMap: Record<string, TraceCrossProcessDependency>;
  /** Newly discovered endpoint to resolve against the existing index. */
  readonly endpoint: TraceCrossProcessEndpoint;
  /** Shared unresolved comm-group endpoint id. */
  readonly endpointId: TraceCrossProcessEndpointId;
  /** Existing endpoints for the same comm-group endpoint id. */
  readonly endpointIndex: CrossProcessDependencyEndpointPairIndex;
  /** Optional append-only list of dependencies created during one incremental update. */
  readonly newCrossProcessDependencies?: TraceCrossProcessDependency[];
  /** Next visible dependency index to assign. */
  readonly nextDependencyIndex: number;
  /** Caller-owned dependency-id hooks used while resolving endpoint groups. */
  readonly options: TraceCrossProcessDependencyBuildOptions;
  /** Resolved span refs keyed by rank number plus source span id. */
  readonly spanRefByRankAndSpanId: TraceCrossProcessDependencySpanRefLookup;
}): number {
  let nextDependencyIndex = params.nextDependencyIndex;
  for (const candidateEndpoint of getCrossProcessDependencyEndpointPairCandidates(
    params.endpointIndex,
    params.endpoint
  )) {
    nextDependencyIndex = addCrossProcessDependencyForEndpointPair({
      crossProcessDependenciesMap: params.crossProcessDependenciesMap,
      endpointId: params.endpointId,
      leftEndpoint: candidateEndpoint,
      newCrossProcessDependencies: params.newCrossProcessDependencies,
      nextDependencyIndex,
      options: params.options,
      rightEndpoint: params.endpoint,
      spanRefByRankAndSpanId: params.spanRefByRankAndSpanId
    });
  }
  return nextDependencyIndex;
}

/** Adds one resolved dependency for an endpoint pair when it has not been emitted already. */
function addCrossProcessDependencyForEndpointPair(params: {
  /** Earlier endpoint candidate from the same comm-group endpoint id. */
  readonly leftEndpoint: TraceCrossProcessEndpoint;
  /** Newly discovered endpoint candidate from the same comm-group endpoint id. */
  readonly rightEndpoint: TraceCrossProcessEndpoint;
  /** Mutable dependency map keyed by topology-aware dependency id. */
  readonly crossProcessDependenciesMap: Record<string, TraceCrossProcessDependency>;
  /** Shared unresolved comm-group endpoint id. */
  readonly endpointId: TraceCrossProcessEndpointId;
  /** Optional append-only list of dependencies created during one incremental update. */
  readonly newCrossProcessDependencies?: TraceCrossProcessDependency[];
  /** Next visible dependency index to assign. */
  readonly nextDependencyIndex: number;
  /** Caller-owned dependency-id hooks used while resolving endpoint groups. */
  readonly options: TraceCrossProcessDependencyBuildOptions;
  /** Resolved span refs keyed by rank number plus source span id. */
  readonly spanRefByRankAndSpanId: TraceCrossProcessDependencySpanRefLookup;
}): number {
  const {leftEndpoint, rightEndpoint} = params;
  if (
    leftEndpoint.spanId === rightEndpoint.spanId ||
    leftEndpoint.startRankNum === rightEndpoint.startRankNum
  ) {
    return params.nextDependencyIndex;
  }
  const dependencyId = createCrossProcessDependencyId(leftEndpoint, rightEndpoint, params.options);
  const dedupeKey = `${dependencyId}-${params.endpointId}`;
  if (params.crossProcessDependenciesMap[dedupeKey]) {
    return params.nextDependencyIndex;
  }
  const startSpanRef = resolveCrossProcessDependencySpanRef(
    leftEndpoint,
    params.spanRefByRankAndSpanId
  );
  const endSpanRef = resolveCrossProcessDependencySpanRef(
    rightEndpoint,
    params.spanRefByRankAndSpanId
  );
  if (startSpanRef == null || endSpanRef == null) {
    return params.nextDependencyIndex;
  }
  const dependency = {
    type: 'trace-cross-process-dependency',
    dependencyRef: encodeCrossProcessDependencyRef(params.nextDependencyIndex),
    startSpanRef,
    endSpanRef,
    dependencyId,
    endpointId: params.endpointId,
    startRankNum: leftEndpoint.startRankNum,
    endRankNum: rightEndpoint.startRankNum,
    startSpanId: leftEndpoint.spanId,
    endSpanId: rightEndpoint.spanId,
    bidirectional: true,
    waitMode: 'end-to-end',
    keywords: new Set(),
    topology: params.endpointId,
    waitTimeMs: leftEndpoint.waitTimeMs,
    waiting: leftEndpoint.waiting,
    waitNotFinished: leftEndpoint.waitNotFinished
  } satisfies TraceCrossProcessDependency;
  params.crossProcessDependenciesMap[dedupeKey] = dependency;
  params.newCrossProcessDependencies?.push(dependency);
  return params.nextDependencyIndex + 1;
}

/** Resolves one endpoint's final span ref from the endpoint payload or rank/span lookup. */
function resolveCrossProcessDependencySpanRef(
  endpoint: TraceCrossProcessEndpoint,
  spanRefByRankAndSpanId: TraceCrossProcessDependencySpanRefLookup
): SpanRef | null {
  return (
    endpoint.spanRef ??
    spanRefByRankAndSpanId.get(endpoint.startRankNum)?.get(endpoint.spanId) ??
    null
  );
}

/** Creates an empty target-aware endpoint lookup. */
function createCrossProcessDependencyEndpointPairIndex(): CrossProcessDependencyEndpointPairIndex {
  return {
    endpointsByRankPair: new Map(),
    targetedEndpointsByEndRankNum: new Map(),
    wildcardEndpointsByStartRankNum: new Map()
  };
}

/** Adds one endpoint to the target-aware lookup used by cross-rank resolution. */
function addEndpointToCrossProcessDependencyPairIndex(
  endpointIndex: CrossProcessDependencyEndpointPairIndex,
  endpoint: TraceCrossProcessEndpoint
): void {
  if (isTargetedCrossProcessDependencyEndpoint(endpoint)) {
    appendMapArray(
      endpointIndex.endpointsByRankPair,
      getCrossProcessDependencyEndpointRankPairKey(endpoint.startRankNum, endpoint.endRankNum),
      endpoint
    );
    appendMapArray(endpointIndex.targetedEndpointsByEndRankNum, endpoint.endRankNum, endpoint);
    return;
  }
  appendMapArray(endpointIndex.wildcardEndpointsByStartRankNum, endpoint.startRankNum, endpoint);
}

/** Returns indexed endpoints that can pair with the requested endpoint. */
function getCrossProcessDependencyEndpointPairCandidates(
  endpointIndex: CrossProcessDependencyEndpointPairIndex,
  endpoint: TraceCrossProcessEndpoint
): readonly TraceCrossProcessEndpoint[] {
  if (isTargetedCrossProcessDependencyEndpoint(endpoint)) {
    return [
      ...(endpointIndex.endpointsByRankPair.get(
        getCrossProcessDependencyEndpointRankPairKey(endpoint.endRankNum, endpoint.startRankNum)
      ) ?? []),
      ...(endpointIndex.wildcardEndpointsByStartRankNum.get(endpoint.endRankNum) ?? [])
    ];
  }

  const candidates: TraceCrossProcessEndpoint[] = [
    ...(endpointIndex.targetedEndpointsByEndRankNum.get(endpoint.startRankNum) ?? [])
  ];
  for (const [startRankNum, endpoints] of endpointIndex.wildcardEndpointsByStartRankNum) {
    if (startRankNum !== endpoint.startRankNum) {
      candidates.push(...endpoints);
    }
  }
  return candidates;
}

/** Returns whether one endpoint identifies the remote rank it expects to pair with. */
function isTargetedCrossProcessDependencyEndpoint(endpoint: TraceCrossProcessEndpoint): boolean {
  return endpoint.endRankNum !== endpoint.startRankNum;
}

/** Builds one ordered source/destination rank key for target-aware endpoint lookup. */
function getCrossProcessDependencyEndpointRankPairKey(
  startRankNum: number,
  endRankNum: number
): string {
  return `${startRankNum}->${endRankNum}`;
}

/** Appends one value to a mutable array-valued map. */
function appendMapArray<KeyT, ValueT>(map: Map<KeyT, ValueT[]>, key: KeyT, value: ValueT): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
    return;
  }
  map.set(key, [value]);
}

/**
 * We can extract endpoints for each rank on load,
 * but every time the loaded ranks change, we have to rebuild the cross-process dependencies.
 */
function extractCrossRankEndpointsFromRank(params: {
  rankNum: number;
  spans: TraceSpan[];
  crossRankEndpointsMap: Record<string, TraceCrossProcessEndpoint[]>;
}): void {
  const {rankNum, spans, crossRankEndpointsMap} = params;

  let dedup = 1,
    added = 0;
  for (const block of spans) {
    const {crossProcessDependencyEndpoints, crossProcessEndpointId} = block;
    if (!crossProcessEndpointId) {
      continue;
    }

    // Add unique endpoints
    crossRankEndpointsMap[crossProcessEndpointId] ||= [];

    for (const crossRankEntry of crossProcessDependencyEndpoints) {
      // Avoid duplicates for the same end rank
      const compareEntries = (
        entry1: TraceCrossProcessEndpoint,
        entry2: TraceCrossProcessEndpoint
      ) =>
        (entry1.endRankNum === entry2.startRankNum && entry1.startRankNum === entry2.endRankNum) ||
        (entry1.endRankNum === entry2.endRankNum && entry1.startRankNum === entry2.startRankNum);

      const isAlreadyPresent =
        crossRankEndpointsMap[crossProcessEndpointId].findIndex(entry =>
          compareEntries(entry, crossRankEntry)
        ) !== -1;
      if (!isAlreadyPresent) {
        crossRankEndpointsMap[crossProcessEndpointId].push(crossRankEntry);
        added++;
      } else {
        dedup++;
      }
    }
  }
  log.probe(
    1,
    `Extracted ${added} cross rank endpoints for rank ${rankNum} (deduplicated ${dedup})`
  )();
}
