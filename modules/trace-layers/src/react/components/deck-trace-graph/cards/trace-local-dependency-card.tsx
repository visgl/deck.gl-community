import {DEFAULT_SUBMIT_MIN_WAIT_TIME_MS, formatTimeMs} from '../../../../trace/index';
import {getTraceSpanBadgeStyleForRef} from '../../../utils/trace-span-badge-style';
import {TraceSpanNameBadge} from './trace-span-name-badge';

import type {
  TraceGraph,
  TraceLabels,
  TraceLocalDependency,
  TraceStyle,
  TraceVisSettings,
  VisibleLocalDependencyRef
} from '../../../../trace/index';

export type TraceLocalDependencyCardProps = {
  dependency?: TraceLocalDependency;
  dependencyRef?: VisibleLocalDependencyRef;
  traceGraph: Readonly<TraceGraph>;
  labels?: TraceLabels;
  traceStyle: TraceStyle;
  traceSettings: TraceVisSettings;
};

export function TraceLocalDependencyCard({
  dependency,
  dependencyRef,
  traceGraph,
  labels,
  traceStyle,
  traceSettings
}: TraceLocalDependencyCardProps) {
  const threadLabel = labels?.threadLabel?.trim() || 'Thread';
  const dependencySource = dependencyRef
    ? traceGraph.getVisibleDependencySourceByRef(dependencyRef)
    : (dependency ?? null);
  if (dependencySource?.type !== 'trace-local-dependency') {
    return <div className="text-red-400">Error: Missing dependency data</div>;
  }
  const startSpanRef = dependencySource.startSpanRef ?? null;
  const endSpanRef = dependencySource.endSpanRef ?? null;

  const startStream =
    startSpanRef != null ? traceGraph.getThreadSourceBySpanRef(startSpanRef) : null;
  const endStream = endSpanRef != null ? traceGraph.getThreadSourceBySpanRef(endSpanRef) : null;
  if (startSpanRef == null || endSpanRef == null || !startStream || !endStream) {
    return <div className="text-red-400">Error: Missing span or stream data</div>;
  }

  const arrow = dependencySource.bidirectional ? '↔️' : '➡️';
  const keywordList = [...dependencySource.keywords];
  const isSubmit = dependencySource.keywords?.has?.('SUBMIT') ?? keywordList.includes('SUBMIT');

  const keywordTitle =
    keywordList.length > 0
      ? `{${keywordList.map(keyword => keyword.toUpperCase()).join(', ')}}`
      : '';
  const gpuIdleWarning =
    isSubmit &&
    dependencySource.waitTimeMs <
      (traceStyle.SUBMIT_MIN_WAIT_TIME_MS ?? DEFAULT_SUBMIT_MIN_WAIT_TIME_MS);
  const badgeContainerClass = 'flex flex-wrap items-center gap-1 text-xs text-muted-foreground';

  return (
    <div className="px-3 py-2 space-y-2 min-w-[400px] max-w-[500px] bg-muted-background text-foreground text-narrow ">
      <div className="flex flex-wrap items-center gap-1 text-xs font-bold">
        <div>DEPENDENCY</div>
        {keywordTitle && <div>{keywordTitle}</div>}
      </div>
      <div className={badgeContainerClass}>
        <b className="font-bold text-foreground">
          {formatTimeMs(dependencySource.waitTimeMs, {roundDigits: 3})}
        </b>
        <span>{dependencySource.waitMode.toUpperCase()}</span>
        <span>{dependencySource.bidirectional ? 'BIDIRECTIONAL' : 'UNIDIRECTIONAL'}</span>
      </div>
      <div
        className="grid gap-1 items-top justify-start text-xs"
        style={{gridTemplateColumns: '1fr max-content 1fr'}}
      >
        <div className="min-w-0 break-all">
          {threadLabel}: {startStream?.name}
        </div>
        <div />
        <div className="min-w-0 break-all">
          {threadLabel}: {endStream?.name}
        </div>
        <div className="min-w-0 overflow-hidden ">
          <TraceSpanNameBadge
            traceGraph={traceGraph}
            spanRef={startSpanRef}
            colorScheme={traceStyle.colorScheme}
            interactive={false}
            style={getTraceSpanBadgeStyleForRef(
              traceGraph,
              startSpanRef,
              traceSettings,
              traceStyle.colorScheme
            )}
          />
        </div>
        {arrow}
        <div className="min-w-0 overflow-hidden ">
          <TraceSpanNameBadge
            traceGraph={traceGraph}
            spanRef={endSpanRef}
            colorScheme={traceStyle.colorScheme}
            interactive={false}
            style={getTraceSpanBadgeStyleForRef(
              traceGraph,
              endSpanRef,
              traceSettings,
              traceStyle.colorScheme
            )}
          />
        </div>
      </div>

      {gpuIdleWarning && (
        <div className="text-red-400 text-xs">
          ⚠️ GPU Idle Warning: Submit completed quickly, was GPU queue drained?
        </div>
      )}
    </div>
  );
}
