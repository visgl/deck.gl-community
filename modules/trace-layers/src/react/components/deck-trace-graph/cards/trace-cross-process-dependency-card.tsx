import {
  formatTimeMs,
  hasTraceSpanRegexpFilter,
  hasTraceSpanTopologyFilter,
  TRACE_SPAN_FILTER_MASK_NONE
} from '../../../../trace/index';
import {getTraceSpanBadgeStyleForRef} from '../../../utils/trace-span-badge-style';
import {TraceSpanNameBadge} from './trace-span-name-badge';

import type {
  SpanRef,
  TraceCrossDependencySource,
  TraceCrossProcessDependency,
  TraceGraph,
  TraceLabels,
  TraceSpanFilterMask,
  TraceStyle,
  TraceVisSettings,
  VisibleCrossDependencyRef
} from '../../../../trace/index';

export type TraceCrossProcessDependencyCardProps = {
  crossDep?: TraceCrossProcessDependency;
  dependencyRef?: VisibleCrossDependencyRef;
  traceGraph: Readonly<TraceGraph>;
  labels?: TraceLabels;
  traceStyle: TraceStyle;
  traceSettings: TraceVisSettings;
};

const MAX_CONTRACTED_PARENT_BADGES = 5;

export function TraceCrossProcessDependencyCard({
  crossDep,
  dependencyRef,
  traceGraph,
  traceStyle,
  traceSettings
}: TraceCrossProcessDependencyCardProps) {
  const resolvedDependencyRef =
    dependencyRef ?? (crossDep ? traceGraph.getVisibleDependencyRefForDependency(crossDep) : null);
  const dependencySource =
    resolvedDependencyRef != null
      ? (traceGraph.getVisibleDependencySourceByRef(resolvedDependencyRef) ?? crossDep ?? null)
      : (crossDep ?? null);
  if (dependencySource?.type !== 'trace-cross-process-dependency') {
    return <div className="text-red-400">Error: Missing dependency data</div>;
  }
  const startSpanRef = dependencySource.startSpanRef ?? null;
  const endSpanRef = dependencySource.endSpanRef ?? null;
  if (startSpanRef == null || endSpanRef == null) {
    return <div className="text-red-400">Error: Missing span data</div>;
  }
  const contractedParents =
    dependencySource.topology === 'parent'
      ? traceGraph
          .getDependencyChainBySpanRef(endSpanRef, 'PARENT')
          .filter(span => span.spanRef !== startSpanRef && traceGraph.spanIsFiltered(span.spanRef))
      : [];
  const startEndpoint = getCrossDependencyCardEndpoint({
    dependencySource,
    endpoint: 'start',
    fallbackSpanRef: startSpanRef,
    traceGraph
  });
  const endEndpoint = getCrossDependencyCardEndpoint({
    dependencySource,
    endpoint: 'end',
    fallbackSpanRef: endSpanRef,
    traceGraph
  });
  const startProcess = traceGraph.getProcessSourceBySpanRef(startEndpoint.spanRef);
  const endProcess = traceGraph.getProcessSourceBySpanRef(endEndpoint.spanRef);
  const startThread = traceGraph.getThreadSourceBySpanRef(startEndpoint.spanRef);
  const endThread = traceGraph.getThreadSourceBySpanRef(endEndpoint.spanRef);
  const startProcessName = startProcess?.name?.trim() || 'n/a';
  const endProcessName = endProcess?.name?.trim() || 'n/a';
  const startThreadName = startThread?.name?.trim() || 'n/a';
  const endThreadName = endThread?.name?.trim() || 'n/a';
  const startProcessThreadLabel = `${startProcessName} / ${startThreadName}`;
  const endProcessThreadLabel = `${endProcessName} / ${endThreadName}`;
  const startDurationLabel = getSpanDurationLabel(traceGraph, startEndpoint.spanRef);
  const endDurationLabel = getSpanDurationLabel(traceGraph, endEndpoint.spanRef);
  const keywordList = [...dependencySource.keywords];
  const keywordTitle =
    keywordList.length > 0 ? keywordList.map(keyword => keyword.toUpperCase()).join(', ') : '';
  const arrow = '➡️';
  const badgeContainerClass = 'flex flex-wrap items-center gap-2 text-xs text-muted-foreground';
  const endpointMetaClass = 'flex min-w-0 max-w-[220px] items-center gap-1 text-xs';
  const visibleContractedParents = contractedParents.slice(0, MAX_CONTRACTED_PARENT_BADGES);
  const isContractedParentListTruncated = contractedParents.length > MAX_CONTRACTED_PARENT_BADGES;

  return (
    <div className="px-3 py-2 space-y-1.5 min-w-[360px] max-w-[480px] bg-muted-background text-foreground text-narrow">
      <div className="flex flex-wrap items-center gap-1 text-xs font-bold">
        <div>CROSS DEPENDENCY</div>
        {keywordTitle && <div className="text-sky-700 dark:text-sky-300">{keywordTitle}</div>}
      </div>
      <div className={badgeContainerClass}>
        <b className="font-bold text-foreground">
          {formatTimeMs(dependencySource.waitTimeMs, {roundDigits: 3})}
        </b>
        <span>WAITING: {dependencySource.waiting ? 'YES' : 'NO'}</span>
        <span>NOT FINISHED: {dependencySource.waitNotFinished ? 'YES' : 'NO'}</span>
      </div>
      <div
        className="grid gap-x-3 gap-y-0.5 items-start text-xs"
        style={{gridTemplateColumns: 'minmax(0, 1fr) max-content minmax(0, 1fr)'}}
      >
        <div className="min-w-0 overflow-hidden">
          <TraceSpanNameBadge
            traceGraph={traceGraph}
            spanRef={startEndpoint.spanRef}
            colorScheme={traceStyle.colorScheme}
            filtered={startEndpoint.filtered}
            filteredVariant={startEndpoint.filteredVariant}
            filterMask={startEndpoint.filterMask}
            interactive={false}
            style={getTraceSpanBadgeStyleForRef(
              traceGraph,
              startEndpoint.spanRef,
              traceSettings,
              traceStyle.colorScheme
            )}
          />
        </div>
        <div className="row-span-2 self-center text-sm leading-none">{arrow}</div>
        <div className="min-w-0 overflow-hidden">
          <TraceSpanNameBadge
            traceGraph={traceGraph}
            spanRef={endEndpoint.spanRef}
            colorScheme={traceStyle.colorScheme}
            filtered={endEndpoint.filtered}
            filteredVariant={endEndpoint.filteredVariant}
            filterMask={endEndpoint.filterMask}
            interactive={false}
            style={getTraceSpanBadgeStyleForRef(
              traceGraph,
              endEndpoint.spanRef,
              traceSettings,
              traceStyle.colorScheme
            )}
          />
        </div>
        <div className={endpointMetaClass} data-cross-dependency-endpoint-meta>
          <span
            className="min-w-0 max-w-[170px] truncate text-muted-foreground"
            title={startProcessThreadLabel}
            data-cross-dependency-process-thread
          >
            {startProcessThreadLabel}
          </span>
          <span className="shrink-0 font-medium text-foreground">{startDurationLabel}</span>
        </div>
        <div className={endpointMetaClass} data-cross-dependency-endpoint-meta>
          <span
            className="min-w-0 max-w-[170px] truncate text-muted-foreground"
            title={endProcessThreadLabel}
            data-cross-dependency-process-thread
          >
            {endProcessThreadLabel}
          </span>
          <span className="shrink-0 font-medium text-foreground">{endDurationLabel}</span>
        </div>
      </div>
      {contractedParents.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-bold text-muted-foreground">
            FILTERED PARENTS ({contractedParents.length})
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {visibleContractedParents.map(span => (
              <TraceSpanNameBadge
                key={span.spanRef}
                traceGraph={traceGraph}
                spanRef={span.spanRef}
                colorScheme={traceStyle.colorScheme}
                interactive={false}
                style={getTraceSpanBadgeStyleForRef(
                  traceGraph,
                  span.spanRef,
                  traceSettings,
                  traceStyle.colorScheme
                )}
              />
            ))}
            {isContractedParentListTruncated && (
              <span className="text-muted-foreground" aria-label="Filtered parents truncated">
                ...
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Returns the formatted primary duration label for one dependency endpoint span.
 */
function getSpanDurationLabel(traceGraph: Readonly<TraceGraph>, spanRef: SpanRef): string {
  const label = traceGraph.getSpanDurationLabel(spanRef);
  if (label) {
    return label;
  }
  const durationMs = traceGraph.getSpanDurationMs(spanRef);
  return durationMs == null ? 'n/a' : formatTimeMs(durationMs, {space: false, roundDigits: 3});
}

/**
 * Resolves the source span and filter metadata shown by one endpoint badge.
 */
function getCrossDependencyCardEndpoint(params: {
  /** Dependency source resolved for the hovered or selected cross-dependency row. */
  dependencySource: TraceCrossDependencySource;
  /** Endpoint side to resolve. */
  endpoint: 'start' | 'end';
  /** Visible endpoint span ref used by geometry and parent-chain layout. */
  fallbackSpanRef: SpanRef;
  /** Graph that owns both source and visible endpoint refs. */
  traceGraph: Readonly<TraceGraph>;
}): {
  /** Span ref rendered by the endpoint badge. */
  spanRef: SpanRef;
  /** Filter provenance for the rendered span ref. */
  filterMask: TraceSpanFilterMask;
  /** Whether the rendered endpoint span is filtered from the visible graph. */
  filtered: boolean;
  /** Badge outline treatment for the rendered endpoint span. */
  filteredVariant: 'regexp' | 'topology';
} {
  const sourceSpanRef =
    params.dependencySource.dependencyRef == null
      ? null
      : params.endpoint === 'start'
        ? params.traceGraph.getDependencySourceStartSpan(
            params.dependencySource.dependencyRef,
            params.dependencySource.dependencyId
          )
        : params.traceGraph.getDependencySourceEndSpan(
            params.dependencySource.dependencyRef,
            params.dependencySource.dependencyId
          );
  const sourceFilterState =
    sourceSpanRef == null
      ? EMPTY_CROSS_DEPENDENCY_CARD_FILTER_STATE
      : getCrossDependencyCardFilterState(params.traceGraph, sourceSpanRef);
  const fallbackFilterState = getCrossDependencyCardFilterState(
    params.traceGraph,
    params.fallbackSpanRef
  );
  const sourceIsFiltered =
    sourceFilterState.filtered ||
    (sourceSpanRef != null &&
      sourceSpanRef !== params.fallbackSpanRef &&
      params.traceGraph.hasActiveSpanFilter());
  const spanRef =
    sourceSpanRef != null && sourceIsFiltered ? sourceSpanRef : params.fallbackSpanRef;
  const filterState =
    spanRef === sourceSpanRef
      ? sourceFilterState.filtered
        ? sourceFilterState
        : sourceIsFiltered
          ? {
              filterMask: TRACE_SPAN_FILTER_MASK_NONE,
              filtered: true
            }
          : sourceFilterState
      : fallbackFilterState.filtered
        ? fallbackFilterState
        : fallbackFilterState;
  const filterMask = filterState.filterMask;
  const filtered = filterState.filtered;
  const filteredVariant =
    hasTraceSpanTopologyFilter(filterMask) && !hasTraceSpanRegexpFilter(filterMask)
      ? 'topology'
      : 'regexp';

  return {
    spanRef,
    filterMask,
    filtered,
    filteredVariant
  };
}

const EMPTY_CROSS_DEPENDENCY_CARD_FILTER_STATE = {
  filterMask: TRACE_SPAN_FILTER_MASK_NONE,
  filtered: false
} as const;

/**
 * Reads filter state for a span ref from both graph filter provenance and span card metadata.
 */
function getCrossDependencyCardFilterState(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef
): {
  /** Filter provenance for the rendered span ref. */
  filterMask: TraceSpanFilterMask;
  /** Whether the span is hidden from the visible graph. */
  filtered: boolean;
} {
  const filterReason = traceGraph.spanFilterReason(spanRef);
  const filterMask = filterReason.filterMask;
  const filtered =
    filterReason.isFiltered || traceGraph.getTraceSpanCardModel(spanRef)?.span.isFiltered === true;

  return {
    filterMask,
    filtered
  };
}
