import {formatTS} from '../../../../trace/index';

import type {TraceEvent, TraceLabels} from '../../../../trace/index';

export type TraceEventCardProps = {
  /** Graph-global trace event to render. */
  event: TraceEvent;
  /** Optional resolved trace labels reserved for custom card parity. */
  labels?: TraceLabels;
};

/** Renders a shared tooltip card for one graph-global trace event. */
export function TraceEventCard({event, labels: _labels}: TraceEventCardProps) {
  return (
    <div className="px-3 py-2 space-y-2 min-w-[320px] max-w-[480px] bg-muted-background text-foreground text-narrow">
      <div className="text-xs font-bold">EVENT</div>
      {event.name && <div className="text-xs text-muted-foreground">{event.name}</div>}
      <div className="text-xs space-y-1">
        <div>
          <span className="font-semibold">Timestamp:</span> {formatTS(event.atTimeMs)}
        </div>
      </div>
    </div>
  );
}
