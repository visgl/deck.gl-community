import {log} from '../log';
import {encodeVisibleCrossDependencyRef} from './trace-id-encoder';
import {encodeGlobalDependencyId} from './trace-id-utils';
import {
  type SpanRef,
  type TraceCrossProcessDependency,
  type TraceCrossProcessEndpoint,
  type TraceSpan
} from './trace-types';

// CROSS RANK DEPENDENCIES

/** Builds cross dependencies for a list of ranks */
export function buildCrossDependencies(props: {
  ranks: {
    rankNum: number;
    spans: TraceSpan[];
  }[];
}): TraceCrossProcessDependency[] {
  const crossRankEndpointsMap: Record<string, TraceCrossProcessEndpoint[]> = {};
  const spanRefByRankAndSpanId = new Map<string, SpanRef>();

  for (const {rankNum, spans} of props.ranks) {
    for (const block of spans) {
      if (block.spanRef != null) {
        spanRefByRankAndSpanId.set(
          getCrossDependencySpanLookupKey(rankNum, block.spanId),
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
  const crossDependencies = buildCrossDependenciesFromEndpoints(
    crossRankEndpointsMap,
    spanRefByRankAndSpanId
  );
  log.probe(
    1,
    `Rebuilt ${crossDependencies.length} cross dependencies for all ranks from ${totalEndpoints} endpoints (${Object.keys(crossRankEndpointsMap).length} endpointIds)`
  )();
  return crossDependencies;
}

export function buildCrossDependenciesFromEndpoints(
  crossRankEndpointsMap: Record<string, TraceCrossProcessEndpoint[]>,
  spanRefByRankAndSpanId: ReadonlyMap<string, SpanRef>
): TraceCrossProcessDependency[] {
  const crossDependenciesMap: Record<string, TraceCrossProcessDependency> = {};
  const crossRankEndpointsList = Object.values(crossRankEndpointsMap);

  for (const endpoints of crossRankEndpointsList) {
    // Generate all cross rank dependencies for one comm group.

    for (const endpoint1 of endpoints) {
      // This only matches endpoints whose counterpart in another rank are loaded.
      for (const endpoint2 of endpoints) {
        if (endpoint1 === endpoint2) {
          continue; // Skip self-comparison
        }

        if (endpoint1.spanId === endpoint2.spanId) {
          continue; // Skip same block comparison
        }

        if (!endpoint1.endpointId) {
          log.error('Missing endpointId for cross-rank endpoint', endpoint1)();
          continue;
        }

        const dependencyId = encodeGlobalDependencyId(
          endpoint1.spanId,
          endpoint2.spanId,
          'bidirectional'
        );

        const dedupId = `${dependencyId}-${endpoint1.endpointId}`;
        if (!crossDependenciesMap[dedupId]) {
          const startSpanRef =
            spanRefByRankAndSpanId.get(
              getCrossDependencySpanLookupKey(endpoint1.startRankNum, endpoint1.spanId)
            ) ?? null;
          const endSpanRef =
            spanRefByRankAndSpanId.get(
              getCrossDependencySpanLookupKey(endpoint2.startRankNum, endpoint2.spanId)
            ) ?? null;
          if (startSpanRef == null || endSpanRef == null) {
            continue;
          }
          const crossRankDependency = {
            type: 'trace-cross-process-dependency',
            dependencyRef: encodeVisibleCrossDependencyRef(
              Object.keys(crossDependenciesMap).length
            ),
            startSpanRef,
            endSpanRef,
            dependencyId,
            endpointId: endpoint1.endpointId,
            startRankNum: endpoint1.startRankNum,
            endRankNum: endpoint2.startRankNum,
            startSpanId: endpoint1.spanId,
            endSpanId: endpoint2.spanId,
            bidirectional: true,
            waitMode: 'end-to-end',
            keywords: new Set(),

            // Cross rank specifics
            topology: endpoint1.endpointId,
            waitTimeMs: endpoint1.waitTimeMs,
            waiting: endpoint1.waiting,
            waitNotFinished: endpoint1.waitNotFinished
          } satisfies TraceCrossProcessDependency;
          crossDependenciesMap[dedupId] = crossRankDependency;
        }
      }
    }
  }

  const crossDependencies: TraceCrossProcessDependency[] = Object.values(crossDependenciesMap);
  log.probe(0, 'Built cross dependencies from endpoints', {
    crossDependencyCount: crossDependencies.length,
    endpointGroupCount: crossRankEndpointsList.length
  })();
  // log.probe(1, `Build cross dependencies: ${crossDependencies.length}, deduplicated ${dedup}`)();
  return crossDependencies;
}

function getCrossDependencySpanLookupKey(rankNum: number, spanId: TraceSpan['spanId']): string {
  return `${rankNum}:${spanId}`;
}

/**
 * We can extract endpoints for each rank on load,
 * but every time the loaded ranks change, we have to rebuild the cross dependencies.
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
