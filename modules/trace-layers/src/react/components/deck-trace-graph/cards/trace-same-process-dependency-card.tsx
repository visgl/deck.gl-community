import {DEFAULT_SUBMIT_MIN_WAIT_TIME_MS, formatTimeMs} from '../../../../trace';
import {getTraceSpanBadgeStyleForRef} from '../../../utils/trace-span-badge-style';
import {TraceSpanNameBadge} from './trace-span-name-badge';

import type {
  SameProcessDependencyRef,
  TraceGraph,
  TraceLabels,
  TraceSameProcessDependency,
  TraceStyle,
  TraceVisSettings
} from '../../../../trace';

export type TraceSameProcessDependencyCardProps = {
  /** Compatibility object payload used when the caller has already materialized the row. */
  dependency?: TraceSameProcessDependency;
  /** Canonical Arrow dependency ref used to materialize the row from the active graph. */
  dependencyRef?: SameProcessDependencyRef;
  /** Active graph that resolves dependency refs, spans, and owner metadata. */
  traceGraph: Readonly<TraceGraph>;
  /** Optional domain labels used for thread and span copy in the card. */
  labels?: TraceLabels;
  /** Active trace style used for badges and dependency warning thresholds. */
  traceStyle: TraceStyle;
  /** Active visualization settings used when resolving span badge presentation. */
  traceSettings: TraceVisSettings;
};

export function TraceSameProcessDependencyCard({
  dependency,
  dependencyRef,
  traceGraph,
  labels,
  traceStyle,
  traceSettings
}: TraceSameProcessDependencyCardProps) {
  const threadLabel = labels?.threadLabel?.trim() || 'Thread';
  const dependencySource = dependencyRef
    ? traceGraph.getDependencySource(dependencyRef)
    : (dependency ?? null);
  if (dependencySource?.type !== 'trace-same-process-dependency') {
    return <div className="text-red-400">Error: Missing dependency data</div>;
  }
  const startSpanRef = dependencySource.startSpanRef ?? null;
  const endSpanRef = dependencySource.endSpanRef ?? null;

  const startThreadRef =
    startSpanRef == null ? null : (traceGraph.getSpanOwnerRefs(startSpanRef)?.threadRef ?? null);
  const endThreadRef =
    endSpanRef == null ? null : (traceGraph.getSpanOwnerRefs(endSpanRef)?.threadRef ?? null);
  const startStream =
    startThreadRef == null ? null : traceGraph.getThreadSourceByRef(startThreadRef);
  const endStream = endThreadRef == null ? null : traceGraph.getThreadSourceByRef(endThreadRef);
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
        <div>SAME PROCESS</div>
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
