import {shouldShowLocalDependencyByMode} from '../trace-layout/local-dependency-filter';

import type {TraceGraph} from '../trace-graph/trace-graph';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {TracePath} from '../trace-graph/trace-types';
import type {
  TraceOverviewLoadedContentBounds,
  TraceOverviewTimeRange,
  TracePreparedPathData,
  TraceViewBounds
} from './trace-prepared-scene';

/** Builds overview viewport bounds from an optional absolute trace time range. */
export function buildTraceOverviewBounds(
  bounds: TraceViewBounds,
  overviewTimeRange: TraceOverviewTimeRange | undefined,
  originTimeMs: number
): TraceViewBounds {
  if (!isValidTraceOverviewTimeRange(overviewTimeRange)) {
    return bounds;
  }

  return [
    [overviewTimeRange.startTimeMs - originTimeMs, bounds[0][1]],
    [overviewTimeRange.endTimeMs - originTimeMs, bounds[1][1]]
  ];
}

/** Builds the overview loaded-content bounds from an optional absolute trace time range. */
export function buildTraceOverviewLoadedContentBounds(
  overviewLoadedTimeRange: TraceOverviewTimeRange | undefined,
  originTimeMs: number
): TraceOverviewLoadedContentBounds | undefined {
  if (!isValidTraceOverviewTimeRange(overviewLoadedTimeRange)) {
    return undefined;
  }

  return {
    minX: overviewLoadedTimeRange.startTimeMs - originTimeMs,
    maxX: overviewLoadedTimeRange.endTimeMs - originTimeMs
  };
}

/** Builds the prepared path data used by path highlighting and local dependency filtering. */
export function buildTracePreparedPathData(params: {
  /** Primary graph used to resolve visible path blocks and dependencies. */
  readonly primaryTraceGraph: TraceGraph;
  /** Path definitions selected by the caller. */
  readonly paths: readonly TracePath[];
  /** Settings that decide which local dependencies remain visible. */
  readonly settings: Pick<TraceVisSettings, 'localDependencyMode'>;
}): TracePreparedPathData {
  const result = params.primaryTraceGraph.getVisiblePathData(params.paths);
  return {
    pathBlockSources: result.pathBlockSources,
    pathDependencySources: result.pathDependencySources.filter(source =>
      source.dependency.type === 'trace-local-dependency'
        ? shouldShowLocalDependencyByMode({
            keywords: source.dependency.keywords,
            waitTimeMs: source.dependency.waitTimeMs,
            mode: params.settings.localDependencyMode
          })
        : true
    )
  };
}

/** Returns whether an optional overview time range can be projected into relative bounds. */
function isValidTraceOverviewTimeRange(
  timeRange: TraceOverviewTimeRange | undefined
): timeRange is Required<TraceOverviewTimeRange> {
  return (
    timeRange?.startTimeMs != null &&
    timeRange.endTimeMs != null &&
    Number.isFinite(timeRange.startTimeMs) &&
    Number.isFinite(timeRange.endTimeMs) &&
    timeRange.endTimeMs > timeRange.startTimeMs
  );
}
