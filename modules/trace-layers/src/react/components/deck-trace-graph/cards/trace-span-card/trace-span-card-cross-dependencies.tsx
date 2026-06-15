import {MouseEvent, ReactNode} from 'react';
import {Navigation2} from 'lucide-react';

import {formatTimeMs} from '../../../../../trace/index';
import {CompactQueryStatus} from '../../../query-status';
import {WithTooltip} from '../../../with-tooltip';
import {PrettyTable} from '../../components/pretty-table';
import {resolveTraceSpanCardLabels} from '../trace-span-card-helpers';

import type {
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceSpanCardEndpointDependencyEntry,
  TraceSpanId
} from '../../../../../trace/index';
import type {QueryStatus} from '../../../query-status';

/**
 * Props for the compact cross-rank dependency table export.
 */
export type TraceSpanCrossDependenciesProps = {
  endpointsWithDeps: TraceSpanCardEndpointDependencyEntry[];
  /** Total cross-rank endpoint count before span-card row capping. */
  endpointCount?: number;
  maxRanks: number;
  traceLabels?: Parameters<typeof resolveTraceSpanCardLabels>[0];
};

/**
 * Render the compact cross-rank dependency summary table.
 */
export function TraceSpanCrossDependencies(props: TraceSpanCrossDependenciesProps) {
  const endpointsWithDeps = props.endpointsWithDeps.slice(0, props.maxRanks);
  const traceLabels = resolveTraceSpanCardLabels(props.traceLabels);

  const headers = ['Wait', traceLabels.processLabel, traceLabels.spanLabel, 'Mode', 'Dir'];

  const rows: ReactNode[][] = endpointsWithDeps.map(({endpoint, dependency, targetSpan}) => {
    const endBlockName = targetSpan?.name || '◯';
    return [
      formatTimeMs(endpoint.waitTimeMs, {space: false, roundDigits: 3}),
      `${endpoint.endRankNum}`,
      endBlockName,
      dependency?.waitMode || '◯',
      '↔️'
    ] satisfies ReactNode[];
  });

  const rankCount = props.endpointCount ?? props.endpointsWithDeps.length;
  if (rankCount > props.maxRanks) {
    const skippedRankCount = rankCount - props.maxRanks;
    rows.push([
      '...',
      <i>{`...${skippedRankCount} more ${traceLabels.processLabelPlural.toLowerCase()}...`}</i>,
      '...'
    ]);
  }

  return <PrettyTable headers={headers} rows={rows} />;
}

/**
 * Props for the interactive horizontal cross-rank dependency strip.
 */
export type TraceSpanCrossDependenciesHorizontalProps = {
  endpointsWithDeps: TraceSpanCardEndpointDependencyEntry[];
  /** Total cross-rank endpoint count before span-card row capping. */
  endpointCount?: number;
  maxRanks: number;
  interactive?: boolean;
  onRankClick?: (rankNum: number) => void;
  onNavigateToBlock?: (spanId: TraceSpanId, rankNum: number) => void;
  rankQueryStatusMap?: Readonly<Record<string, QueryStatus | undefined>>;
  currentSpanId: TraceSpanId;
  traceLabels?: Parameters<typeof resolveTraceSpanCardLabels>[0];
};

/**
 * Render the interactive horizontal cross-rank strip shown under block details.
 */
export function TraceSpanCrossDependenciesHorizontal(
  props: TraceSpanCrossDependenciesHorizontalProps
) {
  const endpointsWithDeps = props.endpointsWithDeps;
  const endpointCount = props.endpointCount ?? props.endpointsWithDeps.length;
  const traceLabels = resolveTraceSpanCardLabels(props.traceLabels);
  const formatWaitLabel = (waitTimeMs: number) =>
    formatTimeMs(waitTimeMs, {space: false, roundDigits: 3});

  const headers: ReactNode[] = endpointsWithDeps.map(({endpoint}) => `${endpoint.endRankNum}`);
  headers.unshift(`Cross ${traceLabels.processLabel}`);

  const timeRow: ReactNode[] = endpointsWithDeps.map(({endpoint, dependency}, i) => (
    <span key={i}>
      {dependency ? (
        <b>{formatWaitLabel(endpoint.waitTimeMs)}</b>
      ) : (
        <span>{formatWaitLabel(endpoint.waitTimeMs)}</span>
      )}
    </span>
  ));
  timeRow.unshift('Wait');

  const statusRow: ReactNode[] = endpointsWithDeps.map(({endpoint, dependency, targetSpan}) => {
    const processId = String(endpoint.endRankNum);
    const queryStatus = props.rankQueryStatusMap?.[processId];
    const isInteractive = Boolean(props.interactive && !dependency);
    const navigationTarget = resolveCrossRankNavigationTarget({
      currentSpanId: props.currentSpanId,
      dependency,
      endpoint
    });
    const navigationTooltip = navigationTarget
      ? buildNavigationTooltip({
          rankNum: navigationTarget.rankNum,
          targetSpanId: navigationTarget.spanId,
          targetSpanName: targetSpan?.name,
          traceLabels
        })
      : undefined;
    const tooltip = queryStatus
      ? undefined
      : getCrossRankFallbackTooltip({
          dependency,
          interactive: props.interactive,
          processId,
          traceLabels
        });

    if (queryStatus?.error) {
      return (
        <CompactQueryStatus
          key={processId}
          className="inline-flex justify-center"
          queryStatus={queryStatus}
          fallbackStatus="error"
          tooltip={tooltip}
          interactive={isInteractive}
          onClick={
            isInteractive
              ? event => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.nativeEvent?.stopImmediatePropagation?.();
                  props.onRankClick?.(endpoint.endRankNum);
                }
              : undefined
          }
        />
      );
    }

    if (navigationTarget) {
      const canNavigate = Boolean(props.interactive && props.onNavigateToBlock);
      const handleNavigate = canNavigate
        ? (event: MouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            event.stopPropagation();
            event.nativeEvent?.stopImmediatePropagation?.();
            props.onNavigateToBlock?.(navigationTarget.spanId, navigationTarget.rankNum);
          }
        : undefined;

      return renderNavigationGlyph({
        processId,
        tooltip: navigationTooltip,
        interactive: canNavigate,
        onClick: handleNavigate
      });
    }

    const handleRankClick: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined =
      !isInteractive
        ? undefined
        : event => {
            event.preventDefault();
            event.stopPropagation();
            event.nativeEvent?.stopImmediatePropagation?.();
            props.onRankClick?.(endpoint.endRankNum);
          };

    if (!dependency && !hasQueryStarted(queryStatus)) {
      return renderIdleRankGlyph({
        interactive: isInteractive,
        onClick: handleRankClick,
        processId,
        tooltip
      });
    }

    if (!dependency && !queryStatus?.isLoading) {
      return renderUnresolvedLoadedRankGlyph({
        processId,
        tooltip: getCrossRankUnresolvedDependencyTooltip({
          processId,
          traceLabels
        })
      });
    }

    return (
      <CompactQueryStatus
        key={processId}
        className="inline-flex justify-center"
        queryStatus={queryStatus}
        fallbackStatus="loading"
        tooltip={tooltip}
        interactive={isInteractive}
        onClick={handleRankClick}
      />
    );
  });

  statusRow.unshift(
    props.interactive ? `Click to load ${traceLabels.processLabelLower}` : 'Status'
  );

  return (
    <div className="max-w-full overflow-x-auto pb-1">
      <PrettyTable headers={headers} rows={[timeRow, statusRow]} />
      {endpointCount > endpointsWithDeps.length ? (
        <div className="pt-1 text-xs text-muted-foreground">
          Showing {endpointsWithDeps.length} of {endpointCount}{' '}
          {traceLabels.processLabelPlural.toLowerCase()}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Resolve the concrete block/rank navigation target for a cross-rank endpoint.
 */
function resolveCrossRankNavigationTarget({
  currentSpanId,
  dependency,
  endpoint
}: {
  currentSpanId: TraceSpanId;
  dependency: TraceCrossProcessDependency | null;
  endpoint: TraceCrossProcessEndpoint;
}): {spanId: TraceSpanId; rankNum: number} | null {
  if (!dependency) {
    return null;
  }
  if (dependency.startSpanId === currentSpanId) {
    return {spanId: dependency.endSpanId, rankNum: dependency.endRankNum};
  }
  if (dependency.endSpanId === currentSpanId) {
    return {spanId: dependency.startSpanId, rankNum: dependency.startRankNum};
  }
  if (dependency.startSpanId === endpoint.spanId) {
    return {spanId: dependency.endSpanId, rankNum: dependency.endRankNum};
  }
  if (dependency.endSpanId === endpoint.spanId) {
    return {spanId: dependency.startSpanId, rankNum: dependency.startRankNum};
  }
  if (dependency.startRankNum === endpoint.startRankNum) {
    return {spanId: dependency.endSpanId, rankNum: dependency.endRankNum};
  }
  if (dependency.endRankNum === endpoint.startRankNum) {
    return {spanId: dependency.startSpanId, rankNum: dependency.startRankNum};
  }
  return {spanId: dependency.endSpanId, rankNum: dependency.endRankNum};
}

/**
 * Build the tooltip for a direct cross-rank navigation glyph.
 */
function buildNavigationTooltip(params: {
  rankNum: number;
  targetSpanId: TraceSpanId;
  targetSpanName?: string;
  traceLabels: ReturnType<typeof resolveTraceSpanCardLabels>;
}): string {
  const spanLabel = params.targetSpanName || params.targetSpanId;
  return `Go to ${spanLabel} on ${params.traceLabels.processLabelLower} ${params.rankNum}`;
}

/**
 * Build the fallback tooltip for an unloaded or already-loaded cross-rank endpoint.
 */
function getCrossRankFallbackTooltip(params: {
  dependency: TraceCrossProcessDependency | null;
  interactive?: boolean;
  processId: string;
  traceLabels: ReturnType<typeof resolveTraceSpanCardLabels>;
}): string {
  if (params.dependency) {
    return `${params.traceLabels.processLabel} ${params.processId} already loaded`;
  }
  if (params.interactive) {
    return `Click to load ${params.traceLabels.processLabelLower} ${params.processId}`;
  }
  return `${params.traceLabels.processLabel} ${params.processId} has not been loaded`;
}

/**
 * Build the tooltip for a loaded peer rank whose endpoint did not resolve to a dependency.
 */
function getCrossRankUnresolvedDependencyTooltip(params: {
  processId: string;
  traceLabels: ReturnType<typeof resolveTraceSpanCardLabels>;
}): string {
  return `${params.traceLabels.processLabel} ${params.processId} loaded, but no matching cross-rank dependency was resolved`;
}

/**
 * Check whether a rank query has begun, even if it has not resolved yet.
 */
function hasQueryStarted(queryStatus: QueryStatus | undefined): boolean {
  if (!queryStatus) {
    return false;
  }
  return queryStatus.isLoading || queryStatus.loadStartTimestamp !== null;
}

/**
 * Render the idle glyph for an unloaded cross-rank endpoint.
 */
function renderIdleRankGlyph(params: {
  interactive: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  processId: string;
  tooltip?: string;
}): ReactNode {
  if (params.interactive) {
    if (params.tooltip) {
      return (
        <WithTooltip key={params.processId} tooltip={params.tooltip}>
          <button
            type="button"
            className="pointer-events-auto inline-flex justify-center"
            onClick={params.onClick}
          >
            ◯
          </button>
        </WithTooltip>
      );
    }

    return (
      <button
        key={params.processId}
        type="button"
        className="pointer-events-auto inline-flex justify-center"
        onClick={params.onClick}
      >
        ◯
      </button>
    );
  }

  if (params.tooltip) {
    return (
      <WithTooltip key={params.processId} tooltip={params.tooltip}>
        <span className="inline-flex justify-center">◯</span>
      </WithTooltip>
    );
  }

  return (
    <span key={params.processId} className="inline-flex justify-center">
      ◯
    </span>
  );
}

/**
 * Render a visible status glyph for loaded ranks that did not produce a resolved dependency.
 */
function renderUnresolvedLoadedRankGlyph(params: {processId: string; tooltip: string}): ReactNode {
  const glyph = (
    <span
      className="inline-flex justify-center text-amber-500"
      role="img"
      aria-label={`No resolved dependency for process ${params.processId}`}
    >
      ⚠️
    </span>
  );

  return (
    <WithTooltip key={params.processId} tooltip={params.tooltip}>
      {glyph}
    </WithTooltip>
  );
}

/**
 * Render the navigation glyph used for direct cross-rank jumps.
 */
function renderNavigationGlyph(params: {
  interactive: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  tooltip?: string;
  processId: string;
}): ReactNode {
  const glyphClasses =
    'inline-flex items-center justify-center rounded-full bg-green-500 bg-green-50 p-0.5 shadow-sm';
  const renderIcon = () => <Navigation2 size={12} stroke="none" fill="white" />;

  const glyph =
    params.interactive && params.onClick ? (
      <button
        type="button"
        className={`pointer-events-auto ${glyphClasses} hover:bg-green-300`}
        onClick={params.onClick}
      >
        {renderIcon()}
      </button>
    ) : (
      <span className={glyphClasses}>{renderIcon()}</span>
    );

  if (params.tooltip) {
    return (
      <WithTooltip key={params.processId} tooltip={params.tooltip}>
        {glyph}
      </WithTooltip>
    );
  }

  if (params.interactive && params.onClick) {
    return (
      <button
        key={params.processId}
        type="button"
        className={`pointer-events-auto ${glyphClasses} hover:bg-green-100`}
        onClick={params.onClick}
      >
        {renderIcon()}
      </button>
    );
  }

  return (
    <span key={params.processId} className={glyphClasses}>
      {renderIcon()}
    </span>
  );
}
