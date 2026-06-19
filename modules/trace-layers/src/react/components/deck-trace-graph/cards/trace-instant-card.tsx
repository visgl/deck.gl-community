import {TraceLabels} from '../../../../trace/index';

import type {TraceInstant} from '../../../../trace/index';

export type TraceInstantCardProps = {
  instant: TraceInstant;
  labels?: TraceLabels;
};

const formatMilliseconds = (value: number) =>
  Number.isFinite(value) ? value.toLocaleString(undefined, {maximumFractionDigits: 3}) : '—';

export function TraceInstantCard({instant, labels}: TraceInstantCardProps) {
  const threadLabel = labels?.threadLabel?.trim() || 'Thread';
  const {name, atTimeMs, scope, threadId} = instant;
  const userData = instant.userData ?? {};
  const scopeLabel = typeof scope === 'string' ? scope.toUpperCase() : scope;

  return (
    <div className="px-3 py-2 space-y-2 min-w-[320px] max-w-[480px] bg-muted-background text-foreground text-narrow">
      <div className="flex flex-wrap items-center gap-1 text-xs font-bold">
        <div>INSTANT / </div>
        <div>{name} / </div>
        <div>Scope {scopeLabel}</div>
      </div>
      <div className="text-xs space-y-1">
        <div>
          <span className="font-semibold">{threadLabel}:</span> {threadId}
        </div>
        <div>
          <span className="font-semibold">Timestamp:</span> {formatMilliseconds(atTimeMs)} ms
        </div>
        {'category' in userData && typeof userData.category === 'string' && userData.category && (
          <div>
            <span className="font-semibold">Category:</span> {userData.category}
          </div>
        )}
        <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
          {'pid' in userData && (
            <span>
              <span className="font-semibold text-foreground">PID:</span> {String(userData.pid)}
            </span>
          )}
          {'tid' in userData && (
            <span>
              <span className="font-semibold text-foreground">TID:</span> {String(userData.tid)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
