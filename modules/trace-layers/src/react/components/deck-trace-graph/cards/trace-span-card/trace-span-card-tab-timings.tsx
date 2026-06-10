import {compareTraceTimingKeys, formatTimeMs} from '../../../../../trace/index';
import {PrettyTable} from '../../components/pretty-table';
import {formatRelativeTraceTimeLabel} from '../trace-span-card-helpers';

import type {TraceCardSpan} from '../../../../../trace/index';
import type {TraceSpanTimingsTableData} from './trace-span-card-types';

/**
 * Props for the aggregated Timings tab content.
 */
export type TraceSpanTimingsTabProps = {
  /** Prepared timings table and aggregate metric strings to render. */
  timings: TraceSpanTimingsTableData;
  /** Optional highlighted column indexes corresponding to the active timing key. */
  highlightedColumnIndexes?: number[];
};

/**
 * Render the Timings tab content, including aggregate metric badges and the timing table.
 */
export function TraceSpanTimingsTab(props: TraceSpanTimingsTabProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {(props.timings.durationCv || props.timings.variance) && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {props.timings.durationCv && (
            <span>
              Duration CV <span className="text-foreground">{props.timings.durationCv}</span>
            </span>
          )}
          {props.timings.variance && (
            <span>
              Variance <span className="text-foreground">{props.timings.variance}</span>
            </span>
          )}
        </div>
      )}
      <div className="max-w-full flex-1 overflow-x-auto overflow-y-auto [&>small]:block [&>small]:w-full [&_table]:w-full">
        <PrettyTable
          rows={props.timings.rows}
          highlightedColumnIndexes={props.highlightedColumnIndexes}
        />
      </div>
    </div>
  );
}

/**
 * Prepare timing-table rows and aggregate metric strings for the Timings tab.
 */
export function getSpanTimingsTableRows(
  block: Pick<TraceCardSpan, 'timings' | 'userData'>,
  traceStartTimeMs: number
): null | TraceSpanTimingsTableData {
  const timingEntries = Object.entries(block.timings).filter(
    ([, timing]) => Number.isFinite(timing.startTimeMs) && Number.isFinite(timing.endTimeMs)
  );
  if (timingEntries.length <= 1) {
    return null;
  }

  timingEntries.sort(([leftKey], [rightKey]) => compareTraceTimingKeys(leftKey, rightKey));

  const aggregateVariance = (
    block.userData as {aggregates?: {variance?: number}; variance?: number} | undefined
  )?.aggregates?.variance;
  const topLevelVariance = (block.userData as {variance?: number} | undefined)?.variance;
  const variance =
    typeof aggregateVariance === 'number' && Number.isFinite(aggregateVariance)
      ? aggregateVariance
      : typeof topLevelVariance === 'number' && Number.isFinite(topLevelVariance)
        ? topLevelVariance
        : null;
  const aggregateDurationCv = (
    block.userData as {aggregates?: {duration_cv?: number}; duration_cv?: number} | undefined
  )?.aggregates?.duration_cv;
  const topLevelDurationCv = (block.userData as {duration_cv?: number} | undefined)?.duration_cv;
  const durationCv =
    typeof aggregateDurationCv === 'number' && Number.isFinite(aggregateDurationCv)
      ? aggregateDurationCv
      : typeof topLevelDurationCv === 'number' && Number.isFinite(topLevelDurationCv)
        ? topLevelDurationCv
        : null;

  return {
    rows: [
      timingEntries.map(([key]) => key),
      timingEntries.map(([, timing]) =>
        formatTimeMs(timing.durationMs, {space: false, roundDigits: 3})
      ),
      timingEntries.map(([, timing]) =>
        formatRelativeTraceTimeLabel(timing.startTimeMs, traceStartTimeMs)
      ),
      timingEntries.map(([, timing]) =>
        formatRelativeTraceTimeLabel(timing.endTimeMs, traceStartTimeMs)
      )
    ],
    timingCount: timingEntries.length,
    timingKeys: timingEntries.map(([key]) => key),
    variance: variance === null ? null : formatAggregateMetricValue(variance),
    durationCv: durationCv === null ? null : formatAggregateMetricValue(durationCv)
  };
}

/**
 * Format an aggregate metric number compactly without unnecessary trailing precision.
 */
function formatAggregateMetricValue(value: number): string {
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return parseFloat(value.toPrecision(4)).toString();
}
