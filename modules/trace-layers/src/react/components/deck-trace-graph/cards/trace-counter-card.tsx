import {TraceLabels} from '../../../../trace/index';

import type {TraceCounter} from '../../../../trace/index';

export type TraceCounterCardProps = {
  counter: TraceCounter;
  labels?: TraceLabels;
};

const formatNumber = (value: number) =>
  Number.isFinite(value) ? value.toLocaleString(undefined, {maximumFractionDigits: 3}) : '—';

export function TraceCounterCard({counter, labels}: TraceCounterCardProps) {
  const threadLabel = labels?.threadLabel?.trim() || 'Thread';
  const {name, atTimeMs, totalValue, threadId, series} = counter;
  const seriesEntries = Object.entries(series ?? {});

  return (
    <div className="px-3 py-2 space-y-2 min-w-[320px] max-w-[520px] bg-muted-background text-foreground text-narrow">
      <div className="flex flex-wrap items-center gap-1 text-xs font-bold">
        <div>COUNTER</div>
        <div>{name}</div>
      </div>
      <div className="text-xs space-y-1">
        <div>
          <span className="font-semibold">{threadLabel}:</span> {threadId}
        </div>
        <div>
          <span className="font-semibold">Timestamp:</span> {formatNumber(atTimeMs)} ms
        </div>
        <div>
          <span className="font-semibold">Total:</span> {formatNumber(totalValue)}
        </div>
        {seriesEntries.length > 0 && (
          <div>
            <div className="font-semibold">Series</div>
            <ul className="pl-4 space-y-0.5 list-disc">
              {seriesEntries.map(([seriesName, value]) => (
                <li key={seriesName}>
                  <span className="font-semibold text-foreground">{seriesName}:</span>{' '}
                  {formatNumber(value)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
