import {ComponentProps, ReactNode} from 'react';

import {WithTooltip} from '../../../with-tooltip';
import {TraceSpanNameBadge} from '../trace-span-name-badge';
import {DEPENDENCY_TABLE_BADGE_MAX_LABEL_LENGTH} from './trace-span-card-types';

import type {SpanRef, TraceCardSpan} from '../../../../../trace/index';
import type {TraceSpanDoubleClickAction} from '../trace-span-name-badge';
import type {
  ResolvedTraceLabels,
  TraceSpanDependencyMetricColumn,
  TraceSpanTableSpanVisibilityControl
} from './trace-span-card-types';

/**
 * Render the process badge cell used by dependency and child tabs.
 */
export function renderDependencyProcessBadge(params: {
  span: TraceCardSpan;
  currentSpan: TraceCardSpan;
  traceLabels: ResolvedTraceLabels;
}): ReactNode {
  const {span, currentSpan, traceLabels} = params;

  if (span.processName === currentSpan.processName) {
    return '<same>';
  }

  const rawProcessName = span.processName?.trim() ?? '';
  const processOrdinal = rawProcessName ? extractProcessOrdinal(rawProcessName) : null;
  const usesOrdinalProcessLabel =
    processOrdinal !== null &&
    (rawProcessName === String(processOrdinal) || /rank/i.test(rawProcessName));
  const fullLabel =
    rawProcessName && !usesOrdinalProcessLabel
      ? rawProcessName
      : processOrdinal !== null
        ? String(processOrdinal)
        : rawProcessName || '-';
  const maxProcessLabelLength = 12;
  const shortLabel =
    fullLabel.length > maxProcessLabelLength
      ? `...${fullLabel.slice(-(maxProcessLabelLength - 3))}`
      : fullLabel;
  const tooltip =
    fullLabel !== '-' && shortLabel !== fullLabel
      ? `${traceLabels.processLabel}: ${fullLabel}`
      : undefined;
  const badge = <div className="max-w-[100px] truncate pointer-events-auto">{shortLabel}</div>;

  return tooltip ? <WithTooltip tooltip={tooltip}>{badge}</WithTooltip> : badge;
}

/**
 * Render one dependency-table metric header, including the interactive timing picker when enabled.
 */
export function renderDependencyMetricHeader(column: TraceSpanDependencyMetricColumn): ReactNode {
  if (
    column.metric !== 'duration' ||
    !column.timingKey ||
    !column.timingPickerAriaLabel ||
    !column.onTimingKeyChange ||
    column.timingOptions.length <= 1
  ) {
    return column.label;
  }

  return (
    <label className="relative block w-20 max-w-full">
      <span className="sr-only">{column.timingPickerAriaLabel}</span>
      <select
        aria-label={column.timingPickerAriaLabel}
        className="block w-full min-w-0 rounded border border-border bg-background px-1 py-0.5 text-[9px] uppercase tracking-[0.04em] text-muted-foreground outline-none hover:border-foreground/30 focus:border-ring"
        value={column.timingKey}
        onChange={event => column.onTimingKeyChange?.(event.target.value)}
      >
        {column.timingOptions.map(timingKey => (
          <option key={timingKey} value={timingKey}>
            {timingKey}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Build dependency-table column classes that keep duration selectors from widening the table.
 */
export function getDependencyTableColumnClassNames(
  metricColumns: readonly TraceSpanDependencyMetricColumn[]
): string[] {
  return metricColumns.map(column => (column.metric === 'duration' ? 'w-20 max-w-20' : ''));
}

/**
 * Render the dependency-table span header, including the filtered-span selector when enabled.
 */
export function renderDependencySpanHeader(params: {
  /** Resolved singular span label used by read-only table headers. */
  spanLabel: string;
  /** Resolved plural span label used by filtered-span selector choices. */
  spanLabelPlural: string;
  /** Optional filtered-span selector state for interactive tables. */
  spanVisibilityControl?: TraceSpanTableSpanVisibilityControl | null;
}): ReactNode {
  if (!params.spanVisibilityControl) {
    return params.spanLabel;
  }

  return (
    <label className="relative">
      <span className="sr-only">{params.spanLabel} visibility</span>
      <select
        aria-label={`${params.spanLabel} visibility`}
        className="w-[6.75rem] rounded border border-border bg-background px-1 py-0.5 text-[9px] uppercase tracking-[0.04em] text-muted-foreground outline-none hover:border-foreground/30 focus:border-ring"
        value={params.spanVisibilityControl.showHiddenSpans ? 'all' : 'visible'}
        onChange={event =>
          params.spanVisibilityControl?.onShowHiddenSpansChange(event.target.value === 'all')
        }
      >
        <option value="all">All {params.spanLabelPlural}</option>
        <option value="visible">Visible {params.spanLabelPlural}</option>
      </select>
    </label>
  );
}

/** Extracts a numeric process ordinal from common encoded process names. */
function extractProcessOrdinal(value: string): number | null {
  const encodedMatch = value.match(/RankId\((\d+)\)/);
  if (encodedMatch) {
    return Number(encodedMatch[1]);
  }

  const trailingDigitsMatch = value.match(/(\d+)\s*$/);
  return trailingDigitsMatch ? Number(trailingDigitsMatch[1]) : null;
}

/**
 * Emit hover callbacks for both ends of a dependency row that already has resolved spans.
 */
export function emitDependencyHoverFromResolvedBlocks(params: {
  /** Exact dependency source block resolved for the row. */
  startSpan: Readonly<TraceCardSpan>;
  /** Exact dependency destination block resolved for the row. */
  endSpan: Readonly<TraceCardSpan>;
  /** Optional hover callback owned by the selected-card surface. */
  onBlockHover?: (spanRef: SpanRef | null) => void;
}): void {
  const {startSpan, endSpan, onBlockHover} = params;
  onBlockHover?.(null);
  onBlockHover?.(startSpan.spanRef);
  if (endSpan.spanRef !== startSpan.spanRef) {
    onBlockHover?.(endSpan.spanRef);
  }
}

/**
 * Render a trace block name badge configured for dependency-table use.
 */
export function renderDependencyNameBadge(params: {
  span: TraceCardSpan;
  colorScheme: TraceSpanNameBadgeProps['colorScheme'];
  style?: TraceSpanNameBadgeProps['style'];
  interactive?: boolean;
  filtered?: boolean;
  filteredVariant?: TraceSpanNameBadgeProps['filteredVariant'];
  filterMask?: TraceSpanNameBadgeProps['filterMask'];
  onSpanClick?: (spanRef: SpanRef) => void;
  onSpanDoubleClick?: (spanRef: SpanRef, action: TraceSpanDoubleClickAction) => void;
}): ReactNode {
  return (
    <TraceSpanNameBadge
      spanRef={params.span.spanRef}
      span={params.span}
      colorScheme={params.colorScheme}
      maxLabelLength={DEPENDENCY_TABLE_BADGE_MAX_LABEL_LENGTH}
      style={params.style}
      interactive={params.interactive}
      filtered={params.filtered}
      filteredVariant={params.filteredVariant}
      filterMask={params.filterMask}
      onSpanClick={params.onSpanClick}
      onSpanDoubleClick={params.onSpanDoubleClick}
    />
  );
}

/**
 * Local prop alias for the TraceSpanNameBadge component.
 */
type TraceSpanNameBadgeProps = ComponentProps<typeof TraceSpanNameBadge>;
